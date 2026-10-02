// A Mel (2.88): o que ela fala agora para esta pessoa, neste salão.
//
//   fatos  (RPC mel_contexto, como a pessoa logada)
//     → momentos (momentos.ts: detectar, prioridade, cooldown)
//       → frase (mel_frases: ramo, tipo, clima, período, peso, sem repetir)
//         → avatar_key + ação semântica
//           → registra em mel_exibicoes (snapshot do template)
//
// Chamada pelo app logado: POST { salao: uuid, tour_feito?: boolean, tela?: '/admin/servicos' }. Resposta:
//   { bubble: { exibicao, chave, categoria, nivel, texto, tom, avatar_key, acao } | null,
//     card:   { exibicao, chave, texto } | null,
//     clima:  o que está no cache (a função clima enche) }
// O texto vem sempre da biblioteca; sem frase para o momento vencedor, o
// próximo da fila assume. Sem frase nenhuma, bubble é null e o app usa o
// de sempre.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { avaliar, pendencias, type Ctx, type Vencedor } from './momentos.ts'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? ''
const CHAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const CHAVE_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' },
  })
}

type Frase = { id: string; chave: string; superficie: string; texto: string; ramos: string[] | null; tipos: string[] | null; contextos_clima: string[] | null; periodos: string[] | null; tom: string; peso: number }

// '{cliente} chega às {hora}' + dados → texto; placeholder sem valor fica em branco
export function preencher(texto: string, dados: Record<string, unknown>): string {
  return texto.replace(/\{([^{}]*)\}/g, (_t, nome) => (dados[nome] != null ? String(dados[nome]) : '')).replace(/\s{2,}/g, ' ').trim()
}

// a frase para o momento: ramo específico > genérica; respeita tipo, clima
// e período; evita as 3 últimas usadas desta chave; sorteia pelo peso
export function escolherFrase(frases: Frase[], chave: string, superficie: string, c: Ctx, sorte = Math.random()): Frase | null {
  const clima = c.clima?.condicao ?? null
  const condicao = clima === 'noite' ? null : clima
  const base = frases.filter((f) => f.chave === chave && f.superficie === superficie
    && (!f.tipos?.length || f.tipos.includes(c.salao.tipo))
    && (!f.contextos_clima?.length || (condicao != null && f.contextos_clima.includes(condicao)))
    && (!f.periodos?.length || f.periodos.includes(c.agora.periodo)))
  if (!base.length) return null
  const doRamo = base.filter((f) => f.ramos?.includes(c.salao.ramo))
  let candidatas = doRamo.length ? doRamo : base.filter((f) => !f.ramos?.length)
  if (!candidatas.length) candidatas = base
  const usadas = c.historico.recentes.filter((r) => r.chave === chave && r.frase_id).slice(0, 3).map((r) => r.frase_id)
  const frescas = candidatas.filter((f) => !usadas.includes(f.id))
  const lista = frescas.length ? frescas : candidatas
  const total = lista.reduce((s, f) => s + Math.max(1, Number(f.peso) || 1), 0)
  let alvo = sorte * total
  for (const f of lista) { alvo -= Math.max(1, Number(f.peso) || 1); if (alvo <= 0) return f }
  return lista[lista.length - 1]
}

export function avatarKey(c: Ctx, tom: string): string {
  const clima = c.clima?.condicao ?? (c.agora.periodo === 'noite' ? 'noite' : 'ensolarado')
  return `${clima}_${tom}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true })
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return json({ erro: 'não autorizado' }, 401)
  let corpo: { salao?: string; tour_feito?: boolean; tela?: string } = {}
  try { corpo = await req.json() } catch { /* vazio */ }
  const salao = String(corpo.salao ?? '')
  if (!salao) return json({ erro: 'salao obrigatório' }, 400)

  // os fatos, como a pessoa logada (a RPC filtra pelo papel dela)
  const quem = createClient(URL_SUPABASE, CHAVE_ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const [{ data: ctx, error }, { data: passos }] = await Promise.all([quem.rpc('mel_contexto', { salao }), quem.rpc('primeiros_passos', { salao })])
  if (error) return json({ erro: error.message }, 400)
  const c = { ...(ctx as Ctx), configuracao: passos ?? null, extra: { tour_feito: corpo.tour_feito, tela: String(corpo.tela ?? '').split('?')[0] } } as Ctx

  // a biblioteca (o motor lê tudo; RLS é para a Plataforma)
  const servico = createClient(URL_SUPABASE, CHAVE_SERVICO, { auth: { persistSession: false } })
  const { data: frases } = await servico.from('mel_frases').select('id, chave, superficie, texto, ramos, tipos, contextos_clima, periodos, tom, peso').eq('ativa', true)
  const biblioteca = (frases ?? []) as Frase[]

  const resposta: Record<string, unknown> = { clima: c.clima ?? null, bubble: null, card: null }
  const registros: Array<Record<string, unknown>> = []
  for (const superficie of ['mel_bubble', 'weather_card'] as const) {
    const fila = avaliar(c, superficie)
    let escolhido: { v: Vencedor; f: Frase } | null = null
    for (const v of fila) {
      const f = escolherFrase(biblioteca, v.momento.chave, superficie, c)
      if (f) { escolhido = { v, f }; break }
    }
    if (!escolhido) continue
    const { v, f } = escolhido
    const texto = preencher(f.texto, { ...v.dados, nome: c.pessoa.nome ?? '' })
    const registro = {
      salon_id: salao, user_id: c.pessoa.user_id, chave: v.momento.chave, identidade: v.identidade, superficie,
      frase_id: f.id, texto_template_snapshot: f.texto, avatar_key: avatarKey(c, v.tom), acao: v.acao,
    }
    registros.push(registro)
    const saida = { chave: v.momento.chave, categoria: v.momento.categoria, nivel: v.momento.nivel, texto, tom: v.tom, avatar_key: registro.avatar_key, acao: v.acao, pontos: v.pontos, pendencias: v.momento.categoria === 'configuracao' ? pendencias(c) : undefined }
    if (superficie === 'mel_bubble') resposta.bubble = saida; else resposta.card = { chave: saida.chave, texto }
  }
  if (registros.length) {
    const { data: gravados } = await servico.from('mel_exibicoes').insert(registros).select('id, superficie')
    for (const g of gravados ?? []) {
      if (g.superficie === 'mel_bubble' && resposta.bubble) (resposta.bubble as Record<string, unknown>).exibicao = g.id
      if (g.superficie === 'weather_card' && resposta.card) (resposta.card as Record<string, unknown>).exibicao = g.id
    }
  }
  return json(resposta)
})
