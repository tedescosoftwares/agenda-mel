// guia-whats (3.48, migração 195): o que a Plataforma pede ao WhatsApp do guia.
//
//   estado       a instância da Evolution está conectada? Os segredos estão no lugar?
//   conectar     cria a instância do guia (se não existe), aponta o webhook e devolve o código de pareamento e o QR
//   desconectar  desliga o número (logout da instância)
//   simular      conversa com a Mel como se fosse uma cliente, sem enviar nada a ninguém (a prévia do salão volta)
//   reiniciar    apaga a conversa de teste de quem está simulando
//   reenviar     manda de novo um pedido ao salão (um que falhou, ou que ficou fora do limite)
//
// Quem chama é a Plataforma logada (eh_plataforma, como no guia-gerar); o resto roda com a chave de serviço. A Evolution
// é a mesma dos salões (EVOLUTION_URL, EVOLUTION_API_KEY); a instância do guia é a da configuração (guia_whats_config),
// e o webhook é o mesmo whatsapp-webhook (EVOLUTION_WEBHOOK_TOKEN), que reconhece a instância e manda para a Mel.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enviarPor } from '../_shared/canais.ts'
import { atenderGuia, iaDe, mensagemDaCliente, despacharPedido, simularVoto, type Deps, type Pedido } from '../_shared/guia_whats.ts'
import { atenderOnboarding, iaOnbDe, consultarCnpjDe, consultarCepDe, consultarRuaDe, type Deps as DepsOnb } from '../_shared/guia_onboarding.ts'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? ''
const CHAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const CHAVE_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const v = (n: string) => String(Deno.env.get(n) ?? '').trim()

type Config = { ligado: boolean; numero: string | null; instancia: string; msg_cliente: string; msg_salao: string; enquete_ativa?: boolean }

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

// a Evolution: o mesmo servidor dos salões
async function evolution(caminho: string, metodo = 'GET', corpo?: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | unknown[] | null; erro?: string }> {
  const base = v('EVOLUTION_URL'), chave = v('EVOLUTION_API_KEY')
  if (!base || !chave) return { ok: false, status: 0, json: null, erro: 'a Evolution não está configurada (EVOLUTION_URL e EVOLUTION_API_KEY nos segredos)' }
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}${caminho}`, {
      method: metodo, headers: { apikey: chave, 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(25_000),
    })
    const texto = await r.text()
    let j: Record<string, unknown> | unknown[] | null = null
    try { j = JSON.parse(texto) } catch { j = null }
    const erro = !r.ok ? String((j as Record<string, unknown> | null)?.message ?? (((j as Record<string, unknown> | null)?.response as Record<string, unknown> | undefined)?.message) ?? texto).slice(0, 200) : undefined
    return { ok: r.ok, status: r.status, json: j, erro }
  } catch (e) {
    return { ok: false, status: 0, json: null, erro: `a Evolution não respondeu: ${String((e as Error)?.message ?? e).slice(0, 120)}` }
  }
}
const estadoDa = (j: unknown) => String(((j as Record<string, unknown> | null)?.instance as Record<string, unknown> | undefined)?.state ?? '')

async function estado(cfg: Config) {
  const r = await evolution(`/instance/connectionState/${encodeURIComponent(cfg.instancia)}`)
  const st = r.status === 404 ? 'nao_existe' : r.ok ? (estadoDa(r.json) || 'desconhecido') : 'erro'
  return {
    instancia: cfg.instancia, numero: cfg.numero, estado: st, erro: r.ok || r.status === 404 ? null : r.erro,
    segredos: { evolution: !!(v('EVOLUTION_URL') && v('EVOLUTION_API_KEY')), webhook: !!v('EVOLUTION_WEBHOOK_TOKEN'), groq: !!v('GROQ_API_KEY'), claude: !!v('ANTHROPIC_API_KEY') },
  }
}

async function conectar(cfg: Config) {
  if (!cfg.numero) return { erro: 'informe o número do WhatsApp do guia e salve antes de conectar' }
  const inst = encodeURIComponent(cfg.instancia)
  const atual = await evolution(`/instance/connectionState/${inst}`)
  if (!atual.ok && atual.status !== 404) return { erro: atual.erro }
  if (atual.status === 404) {
    const c = await evolution('/instance/create', 'POST', { instanceName: cfg.instancia, integration: 'WHATSAPP-BAILEYS', qrcode: true, number: cfg.numero })
    if (!c.ok && !/already|exists|já existe/i.test(c.erro ?? '')) return { erro: `a Evolution não criou a instância: ${c.erro}` }
  }
  // o webhook: o mesmo dos salões, que reconhece a instância do guia
  let webhook: string | null = null
  const token = v('EVOLUTION_WEBHOOK_TOKEN')
  if (token && URL_SUPABASE) {
    const w = await evolution(`/webhook/set/${inst}`, 'POST', { webhook: { enabled: true, url: `${URL_SUPABASE}/functions/v1/whatsapp-webhook?token=${token}`, byEvents: false, base64: false, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'] } })
    webhook = w.ok ? 'ok' : `a Evolution recusou o webhook: ${w.erro}`
  } else {
    webhook = 'sem EVOLUTION_WEBHOOK_TOKEN nos segredos: aponte o webhook pelo Manager da Evolution'
  }
  if (estadoDa(atual.json) === 'open') return { estado: 'open', webhook }
  const c = await evolution(`/instance/connect/${inst}?number=${encodeURIComponent(cfg.numero)}`)
  const j = (c.json ?? {}) as Record<string, unknown>
  const base64 = typeof j.base64 === 'string' ? j.base64 : null
  return {
    estado: c.ok ? 'connecting' : 'erro', webhook, erro: c.ok ? null : c.erro,
    pairingCode: typeof j.pairingCode === 'string' ? j.pairingCode : null,
    qr: base64 ? (base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`) : null,
  }
}

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
  if (erroPapel || plataforma !== true) return json({ erro: 'só a Plataforma mexe no WhatsApp do guia' }, 403)
  const { data: usuario } = await quem.auth.getUser()
  const uid = usuario?.user?.id ?? ''
  const servico = createClient(URL_SUPABASE, CHAVE_SERVICO, { auth: { persistSession: false } })
  const { data: cfgRaw, error: erroCfg } = await servico.from('guia_whats_config').select('*').eq('id', 1).maybeSingle()
  if (erroCfg || !cfgRaw) return json({ erro: 'o banco ainda não tem a migração 195 (rode o bat B)' }, 500)
  const cfg = cfgRaw as Config
  const deps = (): Deps => ({
    rpc: (nome, args) => servico.rpc(nome, args) as unknown as Promise<{ data: unknown; error: { message?: string } | null }>,
    ia: iaDe(Deno.env, fetch as unknown as Parameters<typeof iaDe>[1]),
    enviar: (instancia, telefone, texto) => enviarPor('evolution', { telefone, corpo: texto, identificador: instancia }),
    // 3.57: a enquete "vai atender?" (sendPoll), igual ao webhook
    enviarEnquete: (instancia, telefone, pergunta, opcoes) => enviarPor('evolution', { telefone, corpo: pergunta, estilo: 'enquete', identificador: instancia, botoes: opcoes.map((o, i) => ({ type: 'reply' as const, displayText: o, id: String(i + 1) })) }),
  })
  const telTeste = `teste-${uid.replace(/-/g, '').slice(0, 12) || 'plataforma'}`
  // 3.55: o agente de onboarding no simulador da aba Onboarding — a consulta do CNPJ é a de verdade (BrasilAPI, dado
  // público), para testar o fluxo real sem celular; nada sai para ninguém (teste: os avisos voltam como prévia)
  const depsOnb = (): DepsOnb => ({
    rpc: (nome, args) => servico.rpc(nome, args) as unknown as Promise<{ data: unknown; error: { message?: string } | null }>,
    ia: iaOnbDe(Deno.env, fetch as unknown as Parameters<typeof iaOnbDe>[1]),
    enviar: (instancia, telefone, texto) => enviarPor('evolution', { telefone, corpo: texto, identificador: instancia }),
    consultarCnpj: consultarCnpjDe(fetch as unknown as Parameters<typeof consultarCnpjDe>[0]),
    consultarCep: consultarCepDe(fetch as unknown as Parameters<typeof consultarCepDe>[0]),
    consultarRua: consultarRuaDe(fetch as unknown as Parameters<typeof consultarRuaDe>[0]),
  })

  try {
    if (acao === 'simular_onboarding') {
      const texto = String(corpo.texto ?? '').slice(0, 1500)
      if (!texto) return json({ erro: 'mande o texto' }, 400)
      // a primeira mensagem diz por onde ela entrou: pelo botão (cta: começa direto) ou por intenção (pergunta antes)
      const origem = corpo.origem === 'cta' || corpo.origem === 'intencao' ? corpo.origem : undefined
      const r = await atenderOnboarding(depsOnb(), { telefone: telTeste, texto, nomePerfil: 'Você' }, { teste: true, origem })
      return json({ ok: true, texto, ...r })
    }
    if (acao === 'reiniciar_onboarding') {
      await servico.rpc('guia_onboarding_apagar', { tel_: telTeste })
      return json({ ok: true })
    }
    if (acao === 'estado') return json(await estado(cfg))
    if (acao === 'conectar') return json(await conectar(cfg))
    if (acao === 'desconectar') {
      const r = await evolution(`/instance/logout/${encodeURIComponent(cfg.instancia)}`, 'DELETE')
      return json(r.ok || r.status === 404 ? { ok: true } : { erro: r.erro })
    }
    if (acao === 'simular') {
      // a primeira mensagem do simulador é a que o botão do site mandaria (com o código do salão)
      let texto = String(corpo.texto ?? '').slice(0, 1500)
      const lugar = corpo.lugar as { nome?: string; cidade_slug?: string; slug?: string } | undefined
      if (!texto && lugar?.cidade_slug && lugar?.slug) texto = mensagemDaCliente(cfg.msg_cliente, String(lugar.nome ?? ''), lugar.cidade_slug, lugar.slug)
      if (!texto) return json({ erro: 'mande o texto (ou o salão, para a primeira mensagem)' }, 400)
      const r = await atenderGuia(deps(), { telefone: telTeste, texto, nomePerfil: 'Você' }, { teste: true, comoDona: !!corpo.comoDona })
      return json({ ok: true, texto, ...r })
    }
    if (acao === 'reiniciar') {
      await servico.rpc('guia_whats_apagar', { tel_: telTeste })
      return json({ ok: true })
    }
    // 3.57: no simulador, "o salão votou sim/não": o que o salão, a cliente e a equipe receberiam (nada sai)
    if (acao === 'simular_voto') {
      const voto = corpo.voto === 'nao' ? 'nao' : 'sim'
      return json({ ok: true, ...(await simularVoto(deps(), telTeste, voto)) })
    }
    if (acao === 'reenviar') {
      const id = Number(corpo.lead)
      if (!Number.isInteger(id)) return json({ erro: 'pedido inválido' }, 400)
      const { data: ld } = await servico.rpc('guia_whats_reenvio', { lead_: id })
      const pedido = ld as (Pedido & { salao_tel: string }) | null
      if (!pedido) return json({ erro: 'não dá para reenviar: o salão pediu para não receber ou não tem WhatsApp' }, 400)
      // 3.57: o texto e a enquete, como no envio normal (despacharPedido registra o resultado e a chave da enquete)
      const d = await despacharPedido(deps(), cfg as unknown as Parameters<typeof despacharPedido>[1], { nome: pedido.salao_nome }, pedido)
      return json(d.ok ? { ok: true, enquete: !!d.enquete } : { erro: `não saiu: ${d.erro}` })
    }
    return json({ erro: 'ação desconhecida' }, 400)
  } catch (e) {
    return json({ erro: String((e as Error)?.message ?? e).slice(0, 300) }, 500)
  }
})
