// comercial (3.74, migração 218): o que a Plataforma pede ao WhatsApp comercial (a assistente de vendas).
//
//   estado       a instância da Evolution está conectada? Os segredos estão no lugar?
//   conectar     cria a instância do comercial (se não existe), aponta o webhook e devolve o código de pareamento e o QR
//   desconectar  desliga o número (logout da instância)
//   simular      conversa com a assistente como se fosse uma dona de salão, sem enviar nada a ninguém (os avisos voltam como prévia)
//   reiniciar    apaga a conversa de teste de quem está simulando
//   enviar       a equipe responde por uma conversa de dentro do painel: sai pela Evolution, fica gravado, a assistente cala
//
// Quem chama é a Plataforma logada (eh_plataforma); o resto roda com a chave de serviço. A Evolution é a mesma dos salões
// e da Mel (EVOLUTION_URL, EVOLUTION_API_KEY); a instância é a da configuração (comercial_config), e o webhook é o mesmo
// whatsapp-webhook (EVOLUTION_WEBHOOK_TOKEN), que reconhece a instância e manda para a assistente.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enviarPor } from '../_shared/canais.ts'
import { atenderComercial, iaComercialDe, type Deps } from '../_shared/comercial.ts'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? ''
const CHAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const CHAVE_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const v = (n: string) => String(Deno.env.get(n) ?? '').trim()

type Config = { ligado: boolean; numero: string | null; instancia: string; nome: string }

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
    const erro = !r.ok ? String((j as Record<string, unknown> | null)?.message ?? (((j as Record<string, unknown> | null)?.response as Record<string, unknown> | undefined)?.message) ?? texto).slice(0, 300) : undefined
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
  if (!cfg.numero) return { erro: 'informe o número do WhatsApp comercial e salve antes de conectar' }
  const inst = encodeURIComponent(cfg.instancia)
  const atual = await evolution(`/instance/connectionState/${inst}`)
  if (!atual.ok && atual.status !== 404) return { erro: atual.erro }
  if (atual.status === 404) {
    const c = await evolution('/instance/create', 'POST', { instanceName: cfg.instancia, integration: 'WHATSAPP-BAILEYS', qrcode: true, number: cfg.numero })
    if (!c.ok && !/already|exists|já existe/i.test(c.erro ?? '')) return { erro: `a Evolution não criou a instância: ${c.erro}` }
  }
  // o webhook: o mesmo dos salões e da Mel, que reconhece a instância comercial (inclusive o que sai do nosso número: fromMe)
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
  if (erroPapel || plataforma !== true) return json({ erro: 'só a Plataforma mexe no WhatsApp comercial' }, 403)
  const { data: usuario } = await quem.auth.getUser()
  const uid = usuario?.user?.id ?? ''
  const servico = createClient(URL_SUPABASE, CHAVE_SERVICO, { auth: { persistSession: false } })
  const { data: cfgRaw, error: erroCfg } = await servico.from('comercial_config').select('ligado, numero, instancia, nome').eq('id', 1).maybeSingle()
  if (erroCfg || !cfgRaw) return json({ erro: 'o banco ainda não tem a migração 218 (rode o bat B)' }, 500)
  const cfg = cfgRaw as Config
  const deps = (): Deps => ({
    rpc: (nome, args) => servico.rpc(nome, args) as unknown as Promise<{ data: unknown; error: { message?: string } | null }>,
    ia: iaComercialDe(Deno.env, fetch as unknown as Parameters<typeof iaComercialDe>[1]),
    enviar: (instancia, telefone, texto) => enviarPor('evolution', { telefone, corpo: texto, identificador: instancia }),
  })
  const telTeste = `teste-${uid.replace(/-/g, '').slice(0, 12) || 'plataforma'}`

  try {
    if (acao === 'estado') return json(await estado(cfg))
    if (acao === 'conectar') return json(await conectar(cfg))
    if (acao === 'desconectar') {
      const r = await evolution(`/instance/logout/${encodeURIComponent(cfg.instancia)}`, 'DELETE')
      return json(r.ok || r.status === 404 ? { ok: true } : { erro: r.erro })
    }
    if (acao === 'simular') {
      const texto = String(corpo.texto ?? '').slice(0, 2000)
      if (!texto) return json({ erro: 'mande o texto' }, 400)
      const r = await atenderComercial(deps(), { telefone: telTeste, texto, nomePerfil: 'Você' }, { teste: true })
      return json({ ok: true, texto, ...r })
    }
    if (acao === 'reiniciar') {
      await servico.rpc('comercial_apagar', { tel_: telTeste })
      return json({ ok: true })
    }
    // a equipe responde de dentro do painel: manda pela Evolution e grava (a assistente cala por silencio_min)
    if (acao === 'enviar') {
      const id = Number(corpo.conversa)
      const texto = String(corpo.texto ?? '').trim().slice(0, 4000)
      if (!Number.isInteger(id) || !texto) return json({ erro: 'conversa e texto são obrigatórios' }, 400)
      const { data: cv, error: ec } = await servico.from('comercial_conversas').select('id, telefone, teste').eq('id', id).maybeSingle()
      if (ec || !cv) return json({ erro: 'conversa não encontrada' }, 404)
      const c = cv as { id: number; telefone: string; teste: boolean }
      if (c.teste) return json({ erro: 'essa é uma conversa de teste do simulador' }, 400)
      const env = await enviarPor('evolution', { telefone: c.telefone, corpo: texto, identificador: cfg.instancia })
      if (!env.ok) return json({ erro: `não saiu: ${env.erro}` }, 502)
      const { data: g } = await servico.rpc('comercial_equipe_mensagem', { id_: id, texto_: texto })
      return json({ ok: true, ...(g as Record<string, unknown> ?? {}) })
    }
    return json({ erro: 'ação desconhecida' }, 400)
  } catch (e) {
    return json({ erro: String((e as Error)?.message ?? e).slice(0, 300) }, 500)
  }
})
