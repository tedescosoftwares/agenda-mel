// assistente (3.95, migração 235): o que a tela "Assistente do WhatsApp" do salão pede.
//
//   estado       o número do salão está conectado? Se a Evolution diz que sim e o banco ainda não sabia, anota (o canal
//                do salão passa a ser a instância dele).
//   conectar     cria a instância do salão (se não existe), aponta o webhook e devolve o código de pareamento e o QR
//                (novo: true recomeça do zero, para o "Gerar outro código")
//   desconectar  desliga o número do salão (logout e apaga a instância); o salão volta para o número da casa
//   testar       conversa com a assistente como se fosse uma cliente, com a personalidade da tela (mesmo a não salva).
//                Lê serviços, equipe e horários de verdade; não marca nada nem chama ninguém. Tem teto: 40 por hora.
//
// Quem chama é quem administra o salão (is_admin_do_salao, com o token dela); o resto roda com a chave de serviço.
// A Evolution é a mesma de sempre (EVOLUTION_URL, EVOLUTION_API_KEY); o webhook é o whatsapp-webhook
// (EVOLUTION_WEBHOOK_TOKEN), que reconhece a instância do salão pelo canal dele.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { conversar, registroDaConversa } from '../_shared/agente.ts'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? ''
const CHAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const CHAVE_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const v = (n: string) => String(Deno.env.get(n) ?? '').trim()

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

type Resposta = { ok: boolean; status: number; json: Record<string, unknown> | unknown[] | null; erro?: string }
async function evolution(caminho: string, metodo = 'GET', corpo?: unknown): Promise<Resposta> {
  const base = v('EVOLUTION_URL'), chave = v('EVOLUTION_API_KEY')
  if (!base || !chave) return { ok: false, status: 0, json: null, erro: 'o WhatsApp da MIMO não está configurado (EVOLUTION_URL e EVOLUTION_API_KEY nos segredos)' }
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
    return { ok: false, status: 0, json: null, erro: `o servidor do WhatsApp não respondeu: ${String((e as Error)?.message ?? e).slice(0, 120)}` }
  }
}
const estadoDa = (j: unknown) => String(((j as Record<string, unknown> | null)?.instance as Record<string, unknown> | undefined)?.state ?? '')
export const instanciaDo = (salao: string) => `salao-${salao.replace(/-/g, '').toLowerCase()}`

// 3.96.2: o código de pareamento e o QR de uma resposta da Evolution: o /instance/connect devolve solto
// ({ pairingCode, base64 }); o /instance/create devolve dentro de qrcode
export function codigoDa(j: unknown): { pairingCode: string | null; qr: string | null } {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>
  const q = (o.qrcode && typeof o.qrcode === 'object' ? o.qrcode : o) as Record<string, unknown>
  const pairingCode = typeof q.pairingCode === 'string' && q.pairingCode ? q.pairingCode : null
  const b = typeof q.base64 === 'string' && q.base64 ? q.base64 : null
  return { pairingCode, qr: b ? (b.startsWith('data:') ? b : `data:image/png;base64,${b}`) : null }
}
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

// só dígitos, com o 55 na frente quando vier com DDD e sem país
export function numeroLimpo(n: unknown): string | null {
  let d = String(n ?? '').replace(/\D/g, '')
  if (d.length === 10 || d.length === 11) d = '55' + d
  return d.length >= 12 && d.length <= 15 ? d : null
}
export function numeroBonito(d: string): string {
  if (d.startsWith('55') && d.length === 13) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`
  if (d.startsWith('55') && d.length === 12) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`
  return `+${d}`
}

// o número que conectou, pelo ownerJid da instância
async function numeroDaInstancia(inst: string): Promise<string | null> {
  const r = await evolution(`/instance/fetchInstances?instanceName=${encodeURIComponent(inst)}`)
  const lista = Array.isArray(r.json) ? r.json : r.json ? [r.json] : []
  const i = (lista[0] ?? {}) as Record<string, unknown>
  const dentro = (i.instance ?? {}) as Record<string, unknown>
  const jid = String(i.ownerJid ?? dentro.owner ?? i.number ?? '')
  const d = jid.split('@')[0].replace(/\D/g, '')
  return d.length >= 10 ? numeroBonito(d) : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true })
  if (req.method !== 'POST') return json({ erro: 'use POST' }, 405)
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return json({ erro: 'não autorizado' }, 401)
  let corpo: Record<string, unknown> = {}
  try { corpo = await req.json() } catch { /* vazio */ }
  const acao = String(corpo.acao ?? '')
  const salao = String(corpo.salao ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(salao)) return json({ erro: 'qual salão?' }, 400)

  const quem = createClient(URL_SUPABASE, CHAVE_ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: admin, error: erroPapel } = await quem.rpc('is_admin_do_salao', { salao })
  if (erroPapel || admin !== true) return json({ erro: 'só quem administra o salão mexe na assistente' }, 403)
  const servico = createClient(URL_SUPABASE, CHAVE_SERVICO, { auth: { persistSession: false } })
  const inst = instanciaDo(salao)
  const segredos = { evolution: !!(v('EVOLUTION_URL') && v('EVOLUTION_API_KEY')), webhook: !!v('EVOLUTION_WEBHOOK_TOKEN'), ia: !!(v('ANTHROPIC_API_KEY') || v('GROQ_API_KEY')) }

  try {
    if (acao === 'estado') {
      const r = await evolution(`/instance/connectionState/${encodeURIComponent(inst)}`)
      const estado = r.status === 404 ? 'nao_existe' : r.ok ? (estadoDa(r.json) || 'desconhecido') : 'erro'
      let numero: string | null = null
      if (estado === 'open') {
        numero = await numeroDaInstancia(inst)
        const { error } = await servico.rpc('assistente_numero_conectado', { salao, instancia_: inst, numero_: numero })
        if (error) return json({ erro: `conectou, mas o banco não anotou: ${error.message} (a migração 235 rodou?)` }, 500)
      }
      return json({ estado, numero, erro: r.ok || r.status === 404 ? null : r.erro, segredos })
    }

    if (acao === 'conectar') {
      const numero = numeroLimpo(corpo.numero)
      if (!numero) return json({ erro: 'confira o número: DDD e celular, só números (ex.: 13 99999-9999)' }, 400)
      let atual = await evolution(`/instance/connectionState/${encodeURIComponent(inst)}`)
      if (!atual.ok && atual.status !== 404) return json({ erro: atual.erro }, 502)
      // 3.96.2: "Gerar outro código" (novo: true) recomeça do zero: apaga a conexão que não chegou a abrir e cria outra
      if (corpo.novo === true && atual.status !== 404 && estadoDa(atual.json) !== 'open') {
        await evolution(`/instance/logout/${encodeURIComponent(inst)}`, 'DELETE')
        await evolution(`/instance/delete/${encodeURIComponent(inst)}`, 'DELETE')
        await espera(1500)
        atual = { ok: false, status: 404, json: null }
      }
      // 3.96.2: na primeira vez, a criação já devolve o código. Pedir outro logo em seguida (o connect) às vezes
      // invalidava o primeiro ou chegava antes de a conexão subir: o código da tela não funcionava no celular
      let codigo: { pairingCode: string | null; qr: string | null } = { pairingCode: null, qr: null }
      const criou = atual.status === 404
      if (criou) {
        const c = await evolution('/instance/create', 'POST', { instanceName: inst, integration: 'WHATSAPP-BAILEYS', qrcode: true, number: numero })
        if (!c.ok && !/already|exists|já existe/i.test(c.erro ?? '')) return json({ erro: `não deu para preparar o número: ${c.erro}` }, 502)
        if (c.ok) codigo = codigoDa(c.json)
      }
      const token = v('EVOLUTION_WEBHOOK_TOKEN')
      if (!token || !URL_SUPABASE) return json({ erro: 'falta o EVOLUTION_WEBHOOK_TOKEN nos segredos da MIMO: avise o suporte' }, 500)
      const w = await evolution(`/webhook/set/${encodeURIComponent(inst)}`, 'POST', { webhook: { enabled: true, url: `${URL_SUPABASE}/functions/v1/whatsapp-webhook?token=${token}`, byEvents: false, base64: false, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'] } })
      if (!w.ok) return json({ erro: `não deu para ligar as mensagens deste número: ${w.erro}` }, 502)
      if (estadoDa(atual.json) === 'open') {
        const n = await numeroDaInstancia(inst)
        await servico.rpc('assistente_numero_conectado', { salao, instancia_: inst, numero_: n ?? numeroBonito(numero) })
        return json({ estado: 'open', numero: n ?? numeroBonito(numero) })
      }
      if (!codigo.pairingCode) {
        if (criou) await espera(1500)   // a conexão recém-criada ainda está subindo
        const c = await evolution(`/instance/connect/${encodeURIComponent(inst)}?number=${encodeURIComponent(numero)}`)
        if (!c.ok) return json({ erro: `não deu para gerar o código: ${c.erro}` }, 502)
        codigo = codigoDa(c.json)
      }
      return json({ estado: 'connecting', numero: numeroBonito(numero), pairingCode: codigo.pairingCode, qr: codigo.qr })
    }

    if (acao === 'desconectar') {
      const r = await evolution(`/instance/logout/${encodeURIComponent(inst)}`, 'DELETE')
      if (!r.ok && r.status !== 404 && r.status !== 400) return json({ erro: r.erro }, 502)
      await evolution(`/instance/delete/${encodeURIComponent(inst)}`, 'DELETE')
      const { error } = await servico.rpc('assistente_numero_desligado', { salao })
      if (error) return json({ erro: error.message }, 500)
      return json({ ok: true })
    }

    if (acao === 'testar') {
      const lista = (Array.isArray(corpo.mensagens) ? corpo.mensagens : []).slice(-30) as Array<{ quem?: string; texto?: string }>
      const msgs = lista.map((m) => ({ quem: m.quem === 'cliente' ? 'cliente' as const : 'mimo' as const, texto: String(m.texto ?? '').slice(0, 500).trim() })).filter((m) => m.texto)
      const ultima = msgs[msgs.length - 1]
      if (!ultima || ultima.quem !== 'cliente') return json({ erro: 'escreva a mensagem da cliente' }, 400)
      const r0 = (corpo.rascunho ?? {}) as Record<string, unknown>
      const rascunho = { assistente: r0.assistente ?? {}, ...(typeof r0.recado === 'string' ? { recado: r0.recado.slice(0, 1200) } : {}), cliente_nome: String(r0.cliente_nome ?? '').slice(0, 60) }
      const ag = await conversar(servico, salao, 'ensaio', ultima.texto, { rascunho, historico: msgs.slice(0, -1) })
      if (ag.provedor || ag.erro) await servico.rpc('registrar_chamada_ia', registroDaConversa(salao, 'ensaio', ag, true)).then(() => {}, () => {})
      if (ag.motivo === 'teto_do_teste') return json({ erro: 'Muitos testes em uma hora. Espere um pouco e teste de novo.' }, 429)
      if (!ag.resposta) return json({ erro: ag.erro ? 'A assistente não conseguiu responder agora. Tente de novo em instantes.' : 'Sem resposta.', detalhe: ag.erro ?? ag.motivo ?? null }, 502)
      return json({ ok: true, resposta: ag.resposta, ferramentas: ag.ferramentas, acoes: ag.acoes, provedor: ag.provedor, modelo: ag.modelo, ms: ag.ms })
    }

    return json({ erro: 'ação desconhecida' }, 400)
  } catch (e) {
    return json({ erro: String((e as Error)?.message ?? e).slice(0, 300) }, 500)
  }
})
