// O agente (069): conversa de verdade, com ferramentas.
//
// O modelo (Groq, compatível com a API da OpenAI) recebe a orientação,
// os fatos do salão, a conversa recente e um conjunto de ferramentas.
// Ele decide o que chamar; o banco executa (bot_*), com as regras de
// sempre. Até 5 rodadas de ferramenta por mensagem; depois disso, ou
// em qualquer erro, devolve null e o webhook segue o caminho antigo.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Ctx = {
  permitido: boolean; motivo?: string; modelo: string; orientacao: string; orientacao_salao: string | null
  salao: { id: string; nome: string; cidade: string | null; endereco: string | null; tipo: string; app: string }
  agora: { data: string; hora: string; dia_semana: string; texto: string }
  cliente: { id: string; nome: string | null; primeiro_nome: string | null; vinculada: boolean } | null
  proximos: Array<Record<string, unknown>>
  historico: Array<{ quem: 'cliente' | 'mimo'; texto: string; quando: string }>
}

export type Conversa = {
  resposta: string | null
  ferramentas: string[]
  modelo: string
  ms: number
  motivo?: string
  erro?: string
}

const FERRAMENTAS = [
  { type: 'function', function: { name: 'listar_servicos', description: 'Serviços do salão com preço, duração e quem faz cada um. Use antes de falar de preço ou de marcar.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'listar_profissionais', description: 'Profissionais ativas do salão.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'horarios_livres', description: 'Horários livres de uma profissional num dia. Sempre consulte antes de oferecer horário.', parameters: { type: 'object', properties: { profissional_id: { type: 'string' }, dia: { type: 'string', description: 'YYYY-MM-DD' }, servico_id: { type: 'string', description: 'opcional; ajusta a duração' } }, required: ['profissional_id', 'dia'], additionalProperties: false } } },
  { type: 'function', function: { name: 'marcar', description: 'Marca um horário. SÓ depois que a cliente confirmou serviço, profissional, dia e hora com um sim.', parameters: { type: 'object', properties: { profissional_id: { type: 'string' }, servico_id: { type: 'string' }, dia: { type: 'string', description: 'YYYY-MM-DD' }, hora: { type: 'string', description: 'HH:MM' }, cliente_confirmou: { type: 'boolean', description: 'true só se ela disse sim ao resumo' } }, required: ['profissional_id', 'servico_id', 'dia', 'hora', 'cliente_confirmou'], additionalProperties: false } } },
  { type: 'function', function: { name: 'cancelar', description: 'Cancela um horário da cliente. SÓ depois que ela confirmou.', parameters: { type: 'object', properties: { appointment_id: { type: 'string' }, cliente_confirmou: { type: 'boolean' } }, required: ['appointment_id', 'cliente_confirmou'], additionalProperties: false } } },
  { type: 'function', function: { name: 'remarcar', description: 'Pede a troca de um horário da cliente para outro dia/hora. SÓ depois que ela confirmou. A profissional pode precisar aceitar.', parameters: { type: 'object', properties: { appointment_id: { type: 'string' }, dia: { type: 'string', description: 'YYYY-MM-DD' }, hora: { type: 'string', description: 'HH:MM' }, cliente_confirmou: { type: 'boolean' } }, required: ['appointment_id', 'dia', 'hora', 'cliente_confirmou'], additionalProperties: false } } },
  { type: 'function', function: { name: 'chamar_humano', description: 'Avisa uma pessoa do salão e para de responder por 2 horas. Use quando a cliente pedir, estiver irritada, ou você não conseguir resolver.', parameters: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'], additionalProperties: false } } },
]

function sistema(ctx: Ctx): string {
  const s = ctx.salao
  const cli = ctx.cliente
  const proximos = ctx.proximos?.length
    ? ctx.proximos.map((p) => `- ${p.servico} com ${p.profissional} em ${p.dia_semana} ${p.dia} às ${p.hora} (${p.status}; appointment_id ${p.appointment_id})`).join('\n')
    : '- nenhum'
  return [
    ctx.orientacao,
    ctx.orientacao_salao ? `\nSobre este salão, nas palavras da dona:\n${ctx.orientacao_salao}` : '',
    `\nFATOS\n- Salão: ${s.nome}${s.cidade ? `, ${s.cidade}` : ''}${s.endereco ? `. Endereço: ${s.endereco}` : ''}${s.tipo === 'autonoma' ? ' (profissional autônoma; fale dela, não de "salão")' : ''}.`,
    `- Agora: ${ctx.agora.dia_semana}, ${ctx.agora.texto} (horário de Brasília). Datas nas ferramentas em YYYY-MM-DD, horas em HH:MM.`,
    `- App para a cliente ver e marcar sozinha: ${s.app}`,
    cli
      ? `- Cliente: ${cli.nome ?? 'sem nome'} (id ${cli.id})${cli.vinculada ? '' : '; ainda não entrou na agenda deste salão pelo app'}.\n- Horários dela aqui:\n${proximos}`
      : '- Quem escreve NÃO tem cadastro no MIMO. Você pode tirar dúvidas de serviço, preço e horário, mas não pode marcar: explique que ela entra pelo app (o link acima) ou pelo QR/código da profissional, e que leva um minuto.',
    '\nUse as ferramentas para tudo que envolva dados. Responda só o texto da mensagem para a cliente, sem prefixo, sem markdown de título.',
  ].join('\n')
}

export async function conversar(db: SupabaseClient, salao: string, telefone: string, texto: string): Promise<Conversa> {
  const t0 = Date.now()
  const chave = Deno.env.get('GROQ_API_KEY')
  const { data: ctxRaw, error } = await db.rpc('bot_contexto', { salao, tel: telefone })
  const ctx = ctxRaw as Ctx
  if (error || !ctx) return { resposta: null, ferramentas: [], modelo: '', ms: Date.now() - t0, erro: error?.message ?? 'sem contexto' }
  if (!ctx.permitido) return { resposta: null, ferramentas: [], modelo: '', ms: Date.now() - t0, motivo: ctx.motivo }
  if (!chave) return { resposta: null, ferramentas: [], modelo: ctx.modelo, ms: Date.now() - t0, erro: 'GROQ_API_KEY não configurada' }

  const mensagens: Array<Record<string, unknown>> = [{ role: 'system', content: sistema(ctx) }]
  for (const h of ctx.historico ?? []) {
    if (!h.texto) continue
    mensagens.push({ role: h.quem === 'cliente' ? 'user' : 'assistant', content: String(h.texto).slice(0, 800) })
  }
  // a mensagem atual já pode estar no histórico (o inbox grava antes); evita duplicar
  const ultima = mensagens[mensagens.length - 1]
  if (!(ultima?.role === 'user' && ultima?.content === texto)) mensagens.push({ role: 'user', content: texto })

  const usadas: string[] = []
  const cli = ctx.cliente?.id ?? null

  async function ferramenta(nome: string, args: Record<string, unknown>): Promise<unknown> {
    usadas.push(nome)
    const confirmou = args.cliente_confirmou === true
    switch (nome) {
      case 'listar_servicos': return (await db.rpc('bot_servicos', { salao })).data
      case 'listar_profissionais': return (await db.rpc('bot_profissionais', { salao })).data
      case 'horarios_livres': return (await db.rpc('bot_horarios', { salao, profissional_id: args.profissional_id, dia: args.dia, servico_id: args.servico_id ?? null })).data
      case 'marcar':
        if (!confirmou) return { erro: 'peça a confirmação da cliente antes: repita serviço, profissional, dia e hora e espere o sim' }
        return (await db.rpc('bot_marcar', { salao, cliente: cli, profissional_id: args.profissional_id, servico_id: args.servico_id, dia: args.dia, hora: args.hora })).data
      case 'cancelar':
        if (!confirmou) return { erro: 'peça a confirmação da cliente antes de cancelar' }
        return (await db.rpc('bot_cancelar', { salao, cliente: cli, appt: args.appointment_id })).data
      case 'remarcar':
        if (!confirmou) return { erro: 'peça a confirmação da cliente antes de remarcar' }
        return (await db.rpc('bot_remarcar', { salao, cliente: cli, appt: args.appointment_id, dia: args.dia, hora: args.hora })).data
      case 'chamar_humano': return (await db.rpc('bot_chamar_humano', { salao, tel: telefone, motivo: String(args.motivo ?? '') })).data
      default: return { erro: 'ferramenta desconhecida' }
    }
  }

  try {
    for (let rodada = 0; rodada < 5; rodada++) {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: ctx.modelo, temperature: 0.3, max_tokens: 600, messages: mensagens, tools: FERRAMENTAS, tool_choice: 'auto',
          // gpt-oss pensa antes de falar; 'low' basta para atendimento e poupa a cota
          ...(ctx.modelo.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}) }),
        signal: AbortSignal.timeout(20_000),
      })
      const json = await r.json()
      if (json?.error) return { resposta: null, ferramentas: usadas, modelo: ctx.modelo, ms: Date.now() - t0, erro: String(json.error.message ?? 'erro da API') }
      const msg = json?.choices?.[0]?.message
      if (!msg) return { resposta: null, ferramentas: usadas, modelo: ctx.modelo, ms: Date.now() - t0, erro: 'resposta vazia' }
      const chamadas = msg.tool_calls ?? []
      if (!chamadas.length) {
        const texto = String(msg.content ?? '').trim()
        return { resposta: texto || null, ferramentas: usadas, modelo: ctx.modelo, ms: Date.now() - t0 }
      }
      mensagens.push(msg)
      for (const c of chamadas) {
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(c.function?.arguments || '{}') } catch { args = {} }
        let resultado: unknown
        try { resultado = await ferramenta(c.function?.name, args) } catch (e) { resultado = { erro: String(e).slice(0, 200) } }
        mensagens.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(resultado ?? null).slice(0, 4000) })
        if (c.function?.name === 'chamar_humano') {
          // depois de chamar gente, uma frase curta e fim
          mensagens.push({ role: 'system', content: 'Você chamou uma pessoa. Diga em uma frase que alguém do salão vai falar com ela em breve, e nada mais.' })
        }
      }
    }
    return { resposta: null, ferramentas: usadas, modelo: ctx.modelo, ms: Date.now() - t0, erro: 'muitas rodadas' }
  } catch (e) {
    return { resposta: null, ferramentas: usadas, modelo: ctx.modelo, ms: Date.now() - t0, erro: String(e).slice(0, 200) }
  }
}
