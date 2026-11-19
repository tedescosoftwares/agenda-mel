/* eslint-disable no-undef -- Deno é global no runtime das Edge Functions */
// disparo (4.4, migração 254): a mensagem da Plataforma para quem já conversou com a Mel. Quem chama é a Plataforma
// logada (JWT normal; a função confere eh_plataforma); o envio roda com a chave de serviço, pela mesma Evolution dos
// salões. A tela (Plataforma › Guia › WhatsApp › Disparo) chama "enviar" de tempos em tempos enquanto a aba está aberta:
// cada chamada manda UMA mensagem, pelo número da vez (o banco escolhe e segura o ritmo de cada número).
//
// POST JSON { acao, ... }:
//   estado                          os números (a Mel do guia e os chips de disparo), conectados ou não, e quantos hoje
//   conectar  { instancia?, rotulo, numero, trocar? }   um chip novo (sem instancia) ou o mesmo chip com outro número
//                                   (trocar: desconecta antes); devolve o QR e o código de pareamento
//   desconectar / remover { instancia }                  só os chips de disparo (a Mel se conecta na Conexão)
//   escrever  { pedido, atual? }    a IA escreve a mensagem (com {nome}, {cidade}, {salao} e {link}) e a prévia do link
//   nomes                           puxa da Evolution o nome do perfil de quem escreveu para a Mel (o histórico guardado)
//   teste     { disparo, telefone, nome?, cidade?, salao? }   manda a mensagem para o número de quem está montando
//   enviar    { disparo }           manda a próxima da fila; { espera_s } / { fim } / { parado } quando não é a vez

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { iaJsonDe } from '../_shared/ia_json.ts'
import { MODELO_PADRAO } from '../_shared/guia_whats.ts'
import { montarMensagem, linkDoEnvio, lerErroDoEnvio } from '../_shared/disparo_texto.js'

const v = (k: string) => Deno.env.get(k) ?? ''
const URL_SUPABASE = v('SUPABASE_URL')
const CHAVE_ANON = v('SUPABASE_ANON_KEY')
const CHAVE_SERVICO = v('SUPABASE_SERVICE_ROLE_KEY')

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })
}

type Resposta = { ok: boolean; status: number; json: Record<string, unknown> | unknown[] | null; texto: string; erro?: string }
async function evolution(caminho: string, metodo = 'GET', corpo?: unknown): Promise<Resposta> {
  const base = v('EVOLUTION_URL'), chave = v('EVOLUTION_API_KEY')
  if (!base || !chave) return { ok: false, status: 0, json: null, texto: '', erro: 'a Evolution não está configurada (EVOLUTION_URL e EVOLUTION_API_KEY nos segredos)' }
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}${caminho}`, {
      method: metodo, headers: { apikey: chave, 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(25_000),
    })
    const texto = await r.text()
    let j: Record<string, unknown> | unknown[] | null = null
    try { j = JSON.parse(texto) } catch { j = null }
    const erro = !r.ok ? String((j as Record<string, unknown> | null)?.message ?? (((j as Record<string, unknown> | null)?.response as Record<string, unknown> | undefined)?.message) ?? texto).slice(0, 200) : undefined
    return { ok: r.ok, status: r.status, json: j, texto, erro }
  } catch (e) {
    return { ok: false, status: 0, json: null, texto: '', erro: `a Evolution não respondeu: ${String((e as Error)?.message ?? e).slice(0, 120)}` }
  }
}
const estadoDa = (j: unknown) => String(((j as Record<string, unknown> | null)?.instance as Record<string, unknown> | undefined)?.state ?? '')
const soDigitos = (t: string) => String(t ?? '').replace(/\D/g, '')

async function estadoDe(instancia: string) {
  const r = await evolution(`/instance/connectionState/${encodeURIComponent(instancia)}`)
  return r.status === 404 ? 'nao_existe' : r.ok ? (estadoDa(r.json) || 'desconhecido') : 'erro'
}

// cria (se preciso), aponta o webhook (o mesmo dos salões: ele reconhece o chip e não responde ninguém por ele) e pede
// o QR e o código de pareamento
async function conectarInstancia(instancia: string, numero: string | null) {
  const inst = encodeURIComponent(instancia)
  const atual = await evolution(`/instance/connectionState/${inst}`)
  if (!atual.ok && atual.status !== 404) return { erro: atual.erro }
  if (atual.status === 404) {
    const c = await evolution('/instance/create', 'POST', { instanceName: instancia, integration: 'WHATSAPP-BAILEYS', qrcode: true, ...(numero ? { number: numero } : {}) })
    if (!c.ok && !/already|exists|já existe/i.test(c.erro ?? '')) return { erro: `a Evolution não criou o número: ${c.erro}` }
  }
  let webhook: string | null = null
  const token = v('EVOLUTION_WEBHOOK_TOKEN')
  if (token && URL_SUPABASE) {
    const w = await evolution(`/webhook/set/${inst}`, 'POST', { webhook: { enabled: true, url: `${URL_SUPABASE}/functions/v1/whatsapp-webhook?token=${token}`, byEvents: false, base64: false, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'] } })
    webhook = w.ok ? 'ok' : `a Evolution recusou o webhook: ${w.erro}`
  } else {
    webhook = 'sem EVOLUTION_WEBHOOK_TOKEN nos segredos: sem ele, não dá para saber quem viu e quem respondeu'
  }
  if (estadoDa(atual.json) === 'open') return { estado: 'open', webhook }
  const c = await evolution(`/instance/connect/${inst}${numero ? `?number=${encodeURIComponent(numero)}` : ''}`)
  const j = (c.json ?? {}) as Record<string, unknown>
  const base64 = typeof j.base64 === 'string' ? j.base64 : null
  return {
    estado: c.ok ? 'connecting' : 'erro', webhook, erro: c.ok ? null : c.erro,
    pairingCode: typeof j.pairingCode === 'string' ? j.pairingCode : null,
    qr: base64 ? (base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`) : null,
  }
}

// manda pela Evolution; a prévia do link (linkPreview) a própria Evolution monta, buscando mimo.com.vc/c/<token>
async function mandar(instancia: string, telefone: string, texto: string) {
  const r = await evolution(`/message/sendText/${encodeURIComponent(instancia)}`, 'POST', {
    number: soDigitos(telefone), text: texto, linkPreview: true, delay: 1200 + Math.round(Math.random() * 1600),
  })
  if (r.ok) return { ok: true as const, id: String(((r.json as Record<string, unknown> | null)?.key as Record<string, unknown> | undefined)?.id ?? '') || null }
  return { ok: false as const, ...lerErroDoEnvio(r.status, r.texto || r.erro) }
}

// ---- a IA escreve ------------------------------------------------------------------------------------------------------
type Escrita = { texto: string; titulo: string; descricao: string }
const ESQUEMA = {
  type: 'object', additionalProperties: false, required: ['texto', 'titulo', 'descricao'],
  properties: { texto: { type: 'string' }, titulo: { type: 'string' }, descricao: { type: 'string' } },
}
const CAMPOS = 'Responda só com um objeto JSON com exatamente estes campos: "texto" (a mensagem), "titulo" (o título da prévia do link, até 60 caracteres) e "descricao" (o texto da prévia do link, até 120 caracteres).'
const SISTEMA = [
  'Você escreve mensagens de WhatsApp da Mel, a assistente do guia de salões da MIMO (mimo.com.vc), para pessoas que já conversaram com ela procurando salão de beleza.',
  'Regras:',
  '- Português do Brasil, tom carinhoso e leve, de quem já conversou com a pessoa. Curta: até 450 caracteres. Emojis com moderação (1 a 3).',
  '- Use {nome} para o primeiro nome (no começo, como "Oi, {nome}!"). Pode usar {cidade} (a cidade que ela procurou) e {salao} (o salão). Use {link} uma vez, onde o link deve aparecer. Não invente outras variáveis.',
  '- Não invente fatos, números, promoções nem histórias (nada de "perdemos o Instagram antigo"). Não prometa o que não foi pedido.',
  '- Não peça para responder SAIR nem PARAR: ninguém vai atender respostas automáticas.',
  '- Sem link encurtado, sem hashtag, sem texto em maiúsculas.',
].join('\n')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true })
  if (req.method !== 'POST') return json({ erro: 'use POST' }, 405)
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return json({ erro: 'não autorizado' }, 401)
  let corpo: Record<string, unknown> = {}
  try { corpo = await req.json() } catch { /* vazio */ }
  const acao = String(corpo.acao ?? '')

  const quem = createClient(URL_SUPABASE, CHAVE_ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: plataforma, error: erroPapel } = await quem.rpc('eh_plataforma')
  if (erroPapel || plataforma !== true) return json({ erro: 'só a Plataforma dispara' }, 403)
  const servico = createClient(URL_SUPABASE, CHAVE_SERVICO, { auth: { persistSession: false } })
  const { data: cfg } = await servico.from('guia_whats_config').select('instancia, numero, provedor, modelo').eq('id', 1).maybeSingle()
  const guia = (cfg ?? {}) as { instancia?: string; numero?: string; provedor?: string; modelo?: string }

  try {
    if (acao === 'estado') {
      const { data: painel, error } = await quem.rpc('disparo_painel')
      if (error) return json({ erro: /disparo_painel|schema cache|does not exist/i.test(error.message) ? 'o banco ainda não tem a migração 254 (rode o bat B)' : error.message }, 500)
      const p = painel as { guia: { instancia: string; numero: string | null; hoje: number }; numeros: { instancia: string; rotulo: string; numero: string | null; hoje: number }[]; disparos: unknown[] }
      const lista = [
        ...(p.guia?.instancia ? [{ instancia: p.guia.instancia, rotulo: 'Mel do guia', numero: p.guia.numero, hoje: p.guia.hoje, tipo: 'guia' }] : []),
        ...p.numeros.map((n) => ({ ...n, tipo: 'chip' })),
      ]
      const estados = await Promise.all(lista.map((n) => estadoDe(n.instancia)))
      return json({
        numeros: lista.map((n, i) => ({ ...n, estado: estados[i] })), disparos: p.disparos,
        segredos: { evolution: !!(v('EVOLUTION_URL') && v('EVOLUTION_API_KEY')), webhook: !!v('EVOLUTION_WEBHOOK_TOKEN'), ia: !!(v('ANTHROPIC_API_KEY') || v('GROQ_API_KEY')) },
      })
    }

    if (acao === 'conectar') {
      const numero = soDigitos(String(corpo.numero ?? ''))
      let instancia = String(corpo.instancia ?? '')
      if (instancia && instancia === guia.instancia) return json({ erro: 'a Mel do guia se conecta em Configuração › Conexão' }, 400)
      if (!instancia) {
        // o próximo nome livre: mimo-disparo, mimo-disparo-2, -3...
        const { data: painel } = await quem.rpc('disparo_painel')
        const usados = new Set(((painel as { numeros?: { instancia: string }[] } | null)?.numeros ?? []).map((n) => n.instancia))
        instancia = 'mimo-disparo'
        for (let i = 2; usados.has(instancia); i++) instancia = `mimo-disparo-${i}`
      } else if (corpo.trocar === true) {
        await evolution(`/instance/logout/${encodeURIComponent(instancia)}`, 'DELETE')
      }
      const { data: salvo, error } = await quem.rpc('disparo_numero_salvar', { instancia_: instancia, rotulo_: String(corpo.rotulo ?? '') || null, numero_: numero || null })
      if (error) return json({ erro: error.message }, 400)
      const tel = (salvo as { numero?: string | null } | null)?.numero ?? null
      return json({ instancia, ...(await conectarInstancia(instancia, tel)) })
    }

    if (acao === 'desconectar' || acao === 'remover') {
      const instancia = String(corpo.instancia ?? '')
      if (!/^mimo-disparo(-[a-z0-9]{1,20})?$/.test(instancia)) return json({ erro: 'só os chips de disparo saem por aqui' }, 400)
      const r = await evolution(`/instance/logout/${encodeURIComponent(instancia)}`, 'DELETE')
      if (acao === 'remover') {
        await evolution(`/instance/delete/${encodeURIComponent(instancia)}`, 'DELETE')
        const { error } = await quem.rpc('disparo_numero_apagar', { instancia_: instancia })
        if (error) return json({ erro: error.message }, 400)
        return json({ ok: true })
      }
      return json(r.ok || r.status === 404 ? { ok: true } : { erro: r.erro })
    }

    if (acao === 'escrever') {
      const pedido = String(corpo.pedido ?? '').trim().slice(0, 600)
      if (!pedido) return json({ erro: 'diga o que a mensagem tem que dizer' }, 400)
      const atual = String(corpo.atual ?? '').trim().slice(0, 2000)
      const provedor = guia.provedor === 'claude' && v('ANTHROPIC_API_KEY') ? 'claude' : v('GROQ_API_KEY') ? 'groq' : v('ANTHROPIC_API_KEY') ? 'claude' : ''
      if (!provedor) return json({ erro: 'sem chave de IA nos segredos (ANTHROPIC_API_KEY ou GROQ_API_KEY)' }, 500)
      const modelo = (provedor === guia.provedor && guia.modelo) || MODELO_PADRAO[provedor]
      const ia = iaJsonDe<Escrita>(Deno.env, fetch as unknown as Parameters<typeof iaJsonDe>[1], {
        esquema: ESQUEMA, campos: CAMPOS, maxTokens: { claude: 1200, groq: 2000 },
        montar: (o) => (typeof o.texto === 'string' && o.texto.trim() ? { texto: o.texto.trim().slice(0, 2000), titulo: String(o.titulo ?? '').trim().slice(0, 120), descricao: String(o.descricao ?? '').trim().slice(0, 300) } : null),
      })
      const r = await ia({ provedor, modelo, sistema: SISTEMA, mensagens: [{ role: 'user', content: atual ? `O texto de agora:\n${atual}\n\nO que mudar: ${pedido}` : `O que a mensagem tem que dizer: ${pedido}` }] })
      if (!r.leitura) return json({ erro: `a IA não respondeu: ${r.erro ?? 'resposta vazia'}` }, 502)
      return json({ ok: true, ...r.leitura, modelo: r.modelo })
    }

    if (acao === 'nomes') {
      // o histórico que a Evolution guarda (90 dias, limpar-mensagens.sh): o nome do perfil de cada um que escreveu
      if (!guia.instancia) return json({ erro: 'a Mel do guia não tem instância' }, 400)
      const porJid = new Map<string, { telefone: string; nome: string; em: string; instancia: string }>()
      let paginas = 0, erro: string | null = null
      for (let pagina = 1; pagina <= 40; pagina++) {
        const r = await evolution(`/chat/findMessages/${encodeURIComponent(guia.instancia)}`, 'POST', { where: { key: { fromMe: false } }, page: pagina, offset: 250 })
        if (!r.ok) { erro = r.erro ?? `a Evolution respondeu ${r.status}`; break }
        const m = (r.json as Record<string, unknown> | null)?.messages as Record<string, unknown> | unknown[] | undefined
        const registros = (Array.isArray(m) ? m : (m?.records as unknown[] | undefined)) ?? []
        paginas++
        for (const x of registros as Record<string, unknown>[]) {
          const chave = (x.key ?? {}) as Record<string, unknown>
          const jid = String(chave.remoteJid ?? '')
          const nome = typeof x.pushName === 'string' ? x.pushName.trim() : ''
          if (chave.fromMe || !jid.endsWith('@s.whatsapp.net') || !nome) continue
          const ts = Number(x.messageTimestamp ?? 0)
          const em = new Date((ts > 1e12 ? ts : ts * 1000) || Date.now()).toISOString()
          const ant = porJid.get(jid)
          if (!ant || ant.em < em) porJid.set(jid, { telefone: '+' + jid.split('@')[0], nome: nome.slice(0, 60), em, instancia: guia.instancia })
        }
        const total = Number((m as Record<string, unknown> | undefined)?.pages ?? 0)
        if (!registros.length || (total && pagina >= total)) break
      }
      const itens = [...porJid.values()]
      const { data: n, error } = itens.length ? await servico.rpc('disparo_perfis_gravar', { itens_: itens }) : { data: 0, error: null }
      if (error) return json({ erro: error.message }, 500)
      return json({ ok: true, pessoas: itens.length, gravados: n ?? 0, paginas, erro })
    }

    if (acao === 'teste' || acao === 'enviar') {
      const disparo = String(corpo.disparo ?? '')
      if (!/^[0-9a-f-]{36}$/.test(disparo)) return json({ erro: 'disparo inválido' }, 400)
      let envio: number | null = null
      if (acao === 'teste') {
        const { data: t, error } = await quem.rpc('disparo_teste', { id_: disparo, telefone_: String(corpo.telefone ?? ''), nome_: String(corpo.nome ?? ''), cidade_: String(corpo.cidade ?? ''), salao_: String(corpo.salao ?? '') })
        if (error) return json({ erro: error.message }, 400)
        envio = Number((t as { envio: number }).envio)
      }
      const { data: vez, error: erroVez } = await servico.rpc('disparo_pegar', { id_: disparo, envio_: envio })
      if (erroVez) return json({ erro: erroVez.message }, 500)
      const x = vez as { erro?: string; parado?: boolean; status?: string; motivo?: string; fim?: boolean; espera_s?: number; instancia?: string; mensagem?: string; destino?: string | null; envio?: { id: number; telefone: string; nome: string | null; cidade: string | null; salao: string | null; token: string } }
      if (x.erro) return json({ erro: x.erro }, 400)
      if (!x.envio) return json({ ok: true, ...x })
      const texto = montarMensagem(x.mensagem, x.envio, x.destino ? linkDoEnvio(x.envio.token) : null)
      const r = await mandar(x.instancia!, x.envio.telefone, texto)
      if (r.ok) {
        await servico.rpc('disparo_resultado', { envio_: x.envio.id, ok_: true, msg_id_: r.id, erro_: null, voltar_: false })
        return json({ ok: true, enviado: { id: x.envio.id, instancia: x.instancia } })
      }
      const { data: res } = await servico.rpc('disparo_resultado', { envio_: x.envio.id, ok_: false, msg_id_: null, erro_: r.voltar ? `${x.instancia}: ${r.erro}` : r.erro, voltar_: r.voltar })
      return json({ ok: false, erro: r.erro, instancia: x.instancia, pausado: !!(res as { pausado?: boolean } | null)?.pausado, envio: x.envio.id })
    }

    return json({ erro: 'ação desconhecida' }, 400)
  } catch (e) {
    return json({ erro: String((e as Error)?.message ?? e).slice(0, 300) }, 500)
  }
})
