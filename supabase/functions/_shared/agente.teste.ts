// Testes do agente do WhatsApp (3.95), sem rede e sem banco:
//
//   node --experimental-strip-types supabase/functions/_shared/agente.teste.ts
//
// O banco (bot_*) e os provedores (Claude, Groq) são de mentira. Confere: o pedido ao Claude (sem temperatura, esforço
// baixo, cache na parte fixa e na última mensagem, raciocínio devolvido inteiro com as ferramentas), a reserva no Groq,
// que depois de marcar ninguém recomeça em outro provedor, o que o salão desligou, o ensaio e a personalidade.
import assert from 'node:assert/strict'
import { conversar, mensagensDaConversa, textoSalao, textoNucleo, custoClaude, corpoClaude, registroDaConversa, type Ctx } from './agente.ts'

let ok = 0
async function caso(nome: string, f: () => Promise<void> | void) {
  try { await f(); ok++; console.log('  ✓', nome) } catch (e) { console.error('  ✗', nome); throw e }
}

const SALAO = 's-1'
function ctxDe(extra: Partial<Ctx> = {}): Ctx {
  return {
    permitido: true, provedor: 'claude', modelo: 'openai/gpt-oss-120b', modelo_claude: 'claude-haiku-5-5',
    orientacao: 'Você atende as clientes de um salão.', orientacao_salao: null,
    assistente: { nome: 'Bia', tom: 'profissional', emojis: 'nenhum', tratamento: 'voce', tamanho: 'curtas', preco: 'informa', pode_marcar: true, pode_remarcar: true, pode_cancelar: true },
    numero_proprio: true,
    salao: { id: SALAO, nome: 'Studio Rosa', cidade: 'Santos', endereco: 'Rua A, 1', tipo: 'salao', app: 'https://mimo.com.vc', horario: 'seg 09:00–18:00; dom fechado', aberto_agora: true },
    agora: { data: '2026-11-17', hora: '10:00', dia_semana: 'terça-feira', texto: '17/11/2026 10:00' },
    cliente: { id: 'c-1', nome: 'Ana Souza', primeiro_nome: 'Ana', vinculada: true },
    proximos: [], historico: [{ quem: 'cliente', texto: 'oi, tem horário amanhã?' }],
    ...extra,
  }
}

// o banco: devolve o contexto e anota as chamadas
function bancoDe(ctx: Ctx | null, extra: Record<string, unknown> = {}) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = []
  return {
    chamadas,
    rpc: async (nome: string, args: Record<string, unknown> = {}) => {
      chamadas.push({ nome, args })
      if (nome === 'bot_contexto') return { data: ctx, error: null }
      if (nome === 'bot_servicos') return { data: [{ servico_id: 'sv1', nome: 'Escova', preco: 60, a_partir: false, minutos: 45 }], error: null }
      if (nome === 'bot_marcar') return { data: { ok: true, appointment_id: 'ap1', status: 'confirmado', servico: 'Escova', profissional: 'Carla', dia: '18/11', hora: '10:00', aviso: 'já está confirmado' }, error: null }
      if (nome in extra) return { data: extra[nome], error: null }
      return { data: { ok: true }, error: null }
    },
  }
}

type Resp = { status: number; corpo: unknown }
function provedorDe(respostas: Record<string, Resp[]>) {
  const pedidos: Array<{ url: string; corpo: Record<string, unknown> }> = []
  const fetcher = async (url: string, init: Record<string, unknown>) => {
    const corpo = JSON.parse(String(init.body))
    pedidos.push({ url, corpo })
    const fila = respostas[url.includes('anthropic') ? 'claude' : 'groq'] ?? []
    const r = fila.shift() ?? { status: 500, corpo: { error: { message: 'sem resposta preparada' } } }
    return { status: r.status, text: async () => JSON.stringify(r.corpo) }
  }
  return { pedidos, fetcher }
}
const amb = (v: Record<string, string>) => ({ get: (n: string) => v[n] })
const AMBOS = amb({ ANTHROPIC_API_KEY: 'sk-ant-x', GROQ_API_KEY: 'gsk-x' })
const usoClaude = { input_tokens: 300, output_tokens: 40, cache_read_input_tokens: 1200, cache_creation_input_tokens: 0 }
const textoClaude = (t: string) => ({ status: 200, corpo: { content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: t }], stop_reason: 'end_turn', usage: usoClaude } })
const ferramentaClaude = (nome: string, input: Record<string, unknown>, id = 'tu1') => ({ status: 200, corpo: { content: [{ type: 'thinking', thinking: '', signature: 'sig-1' }, { type: 'tool_use', id, name: nome, input }], stop_reason: 'tool_use', usage: usoClaude } })

console.log('agente.teste.ts')

await caso('a conversa começa e termina na cliente, juntando as seguidas', () => {
  const m = mensagensDaConversa([{ quem: 'mimo', texto: 'lembrete' }, { quem: 'cliente', texto: 'oi' }, { quem: 'cliente', texto: 'tem horário?' }], 'tem horário?')
  assert.deepEqual(m, [{ role: 'user', content: 'oi\ntem horário?' }])
  const n = mensagensDaConversa([{ quem: 'cliente', texto: 'oi' }, { quem: 'mimo', texto: 'Oi! Em que posso ajudar?' }], 'quero escova')
  assert.equal(n.length, 3); assert.equal(n[2].role, 'user')
})

await caso('no número do salão: o nome e o tom escolhidos; no da casa: a Mel, da MIMO', () => {
  const proprio = textoSalao(ctxDe())
  assert.match(proprio, /Seu nome é Bia/); assert.match(proprio, /assistente virtual do Studio Rosa/)
  assert.match(proprio, /profissional: educada/); assert.match(proprio, /não use emoji/); assert.match(proprio, /por "você"/)
  assert.match(proprio, /Horário de funcionamento: seg 09:00–18:00/)
  const casa = textoSalao(ctxDe({ numero_proprio: false }))
  assert.match(casa, /Você é a Mel, assistente virtual da MIMO, atendendo em nome do Studio Rosa/)
  assert.doesNotMatch(casa, /Bia/)
  const autonoma = textoSalao(ctxDe({ salao: { ...ctxDe().salao, tipo: 'autonoma', nome: 'Carla Nails' } }))
  assert.match(autonoma, /assistente virtual da Carla Nails/)
})

await caso('o que o salão desligou aparece no texto; valores estranhos voltam ao padrão', () => {
  const t = textoSalao(ctxDe({ assistente: { pode_marcar: false, preco: 'nao_fala', tom: 'xyz', nome: '   ' } }))
  assert.match(t, /Marcar: NÃO/); assert.match(t, /Não informe preços/)
  assert.match(t, /Seu nome é Mel/); assert.match(t, /acolhedora: calorosa/)
})

await caso('a parte fixa é igual para todos os salões (é ela que vai no cache)', () => {
  assert.equal(textoNucleo(ctxDe()), textoNucleo(ctxDe({ salao: { ...ctxDe().salao, nome: 'Outro' }, assistente: { nome: 'Lu' } })))
})

await caso('o custo do Haiku: entrada, saída, cache lido (0,1) e gravado (1,25)', () => {
  assert.equal(custoClaude('claude-haiku-5-5', { input_tokens: 1_000_000 }), 0.1)
  assert.equal(custoClaude('claude-haiku-5-5', { output_tokens: 1_000_000 }), 0.5)
  assert.equal(custoClaude('claude-haiku-5-5', { cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }), 0.135)
  assert.equal(custoClaude('modelo-que-nao-existe', { input_tokens: 10 }), null)
})

await caso('o pedido ao Claude: sem temperatura, esforço baixo, cache só na parte fixa e na última mensagem', () => {
  const c = corpoClaude('claude-haiku-5-5', 'NUCLEO', 'SALAO', [{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'olá' }, { role: 'user', content: 'quero escova' }])
  assert.equal(c.temperature, undefined)
  assert.deepEqual(c.output_config, { effort: 'low' })
  const sys = c.system as Array<Record<string, unknown>>
  assert.deepEqual(sys[0].cache_control, { type: 'ephemeral' }); assert.equal(sys[1].cache_control, undefined)
  const msgs = c.messages as Array<{ content: unknown }>
  assert.equal(typeof msgs[0].content, 'string')
  assert.deepEqual(msgs[2].content, [{ type: 'text', text: 'quero escova', cache_control: { type: 'ephemeral' } }])
  assert.equal((c.tools as unknown[]).length, 7)
})

await caso('Claude com ferramenta: lista os serviços, devolve o raciocínio inteiro e responde; soma uso e custo', async () => {
  const db = bancoDe(ctxDe())
  const p = provedorDe({ claude: [ferramentaClaude('listar_servicos', {}), textoClaude('Temos escova por R$ 60.')] })
  const r = await conversar(db, SALAO, '+5513999990000', 'oi, tem horário amanhã?', { ambiente: AMBOS, fetcher: p.fetcher })
  assert.equal(r.resposta, 'Temos escova por R$ 60.')
  assert.equal(r.provedor, 'claude'); assert.equal(r.modelo, 'claude-haiku-5-5')
  assert.deepEqual(r.ferramentas, ['listar_servicos'])
  assert.equal(p.pedidos.length, 2)
  const segunda = p.pedidos[1].corpo.messages as Array<{ role: string; content: unknown }>
  // o raciocínio (com a assinatura) e a chamada voltam exatamente como vieram
  assert.deepEqual(segunda[1], { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'sig-1' }, { type: 'tool_use', id: 'tu1', name: 'listar_servicos', input: {} }] })
  const res = segunda[2].content as Array<Record<string, unknown>>
  assert.equal(res[0].type, 'tool_result'); assert.equal(res[0].tool_use_id, 'tu1')
  assert.deepEqual(res[res.length - 1].cache_control, { type: 'ephemeral' })
  // o marcador da rodada anterior não fica para trás (no máximo 2 por pedido)
  const marcas = JSON.stringify(p.pedidos[1].corpo).split('cache_control').length - 1
  assert.equal(marcas, 2)
  assert.equal(r.tokensEntrada, 600); assert.equal(r.cacheLidos, 2400); assert.equal(r.tokensSaida, 80)
  assert.equal(r.custoUsd, custoClaude('claude-haiku-5-5', { input_tokens: 600, output_tokens: 80, cache_read_input_tokens: 2400 }))
  const reg = registroDaConversa(SALAO, '+5513999990000', r)
  assert.equal(reg.provedor_, 'claude'); assert.equal(reg.respondeu_, true); assert.equal(reg.ensaio_, false)
})

await caso('Claude fora do ar (duas vezes): a reserva no Groq responde', async () => {
  const db = bancoDe(ctxDe())
  const p = provedorDe({
    claude: [{ status: 529, corpo: { error: { message: 'overloaded' } } }, { status: 529, corpo: { error: { message: 'overloaded' } } }],
    groq: [{ status: 200, corpo: { choices: [{ message: { content: 'Oi! Tenho às 10h e às 14h.' } }], usage: { prompt_tokens: 900, completion_tokens: 30 } } }],
  })
  const r = await conversar(db, SALAO, '+5513999990000', 'tem horário?', { ambiente: AMBOS, fetcher: p.fetcher })
  assert.equal(r.resposta, 'Oi! Tenho às 10h e às 14h.')
  assert.equal(r.provedor, 'groq'); assert.equal(r.falhas.length, 1); assert.match(r.falhas[0], /Claude 529/)
  assert.equal(r.custoUsd, 0)   // o Claude não cobrou nada (sem uso) e o Groq não tem preço aqui
  const g = p.pedidos.find((x) => x.url.includes('groq'))!
  assert.match(String((g.corpo.messages as Array<{ content: string }>)[0].content), /Seu nome é Bia/)
})

await caso('Claude recusou: a reserva responde', async () => {
  const db = bancoDe(ctxDe())
  const p = provedorDe({
    claude: [{ status: 200, corpo: { content: [], stop_reason: 'refusal', usage: { input_tokens: 10, output_tokens: 0 } } }],
    groq: [{ status: 200, corpo: { choices: [{ message: { content: 'Posso ajudar com horários!' } }] } }],
  })
  const r = await conversar(db, SALAO, '+55', 'oi', { ambiente: AMBOS, fetcher: p.fetcher })
  assert.equal(r.provedor, 'groq'); assert.match(r.falhas[0], /recusou/)
})

await caso('marcou e o Claude caiu depois: não recomeça no Groq (marcaria de novo); responde o resumo', async () => {
  const db = bancoDe(ctxDe())
  const p = provedorDe({
    claude: [ferramentaClaude('marcar', { profissional_id: 'p1', servico_id: 'sv1', dia: '2026-11-18', hora: '10:00', cliente_confirmou: true }),
             { status: 500, corpo: { error: { message: 'boom' } } }, { status: 500, corpo: { error: { message: 'boom' } } }],
    groq: [{ status: 200, corpo: { choices: [{ message: { content: 'NÃO DEVIA CHAMAR' } }] } }],
  })
  const r = await conversar(db, SALAO, '+55', 'sim, pode marcar', { ambiente: AMBOS, fetcher: p.fetcher })
  assert.match(String(r.resposta), /Pronto! Escova com Carla no dia 18\/11 às 10:00/)
  assert.equal(r.acoes.marcou, 1)
  assert.equal(p.pedidos.filter((x) => x.url.includes('groq')).length, 0)
  assert.equal(db.chamadas.filter((c) => c.nome === 'bot_marcar').length, 1)
})

await caso('o salão não deixa marcar: a ferramenta recusa e o banco nem é chamado', async () => {
  const db = bancoDe(ctxDe({ assistente: { pode_marcar: false } }))
  const p = provedorDe({ claude: [ferramentaClaude('marcar', { profissional_id: 'p1', servico_id: 'sv1', dia: '2026-11-18', hora: '10:00', cliente_confirmou: true }), textoClaude('Vou chamar alguém da equipe para confirmar.')] })
  const r = await conversar(db, SALAO, '+55', 'pode marcar', { ambiente: AMBOS, fetcher: p.fetcher })
  assert.equal(db.chamadas.filter((c) => c.nome === 'bot_marcar').length, 0)
  const res = (p.pedidos[1].corpo.messages as Array<{ content: Array<Record<string, unknown>> }>)[2].content[0]
  assert.match(String(res.content), /não deixa você marcar/)
  assert.equal(r.acoes.marcou, 0)
})

await caso('sem falar preço: listar_servicos chega sem o preço', async () => {
  const db = bancoDe(ctxDe({ assistente: { preco: 'nao_fala' } }))
  const p = provedorDe({ claude: [ferramentaClaude('listar_servicos', {}), textoClaude('Temos escova! O valor o salão te passa.')] })
  await conversar(db, SALAO, '+55', 'quanto é a escova?', { ambiente: AMBOS, fetcher: p.fetcher })
  const res = (p.pedidos[1].corpo.messages as Array<{ content: Array<Record<string, unknown>> }>)[2].content[0]
  assert.doesNotMatch(String(res.content), /preco/)
})

await caso('ensaio: marcar e chamar alguém só fingem; a conversa do teste vem de fora', async () => {
  const db = bancoDe(ctxDe({ ensaio: true }))
  const p = provedorDe({ claude: [ferramentaClaude('marcar', { profissional_id: 'p1', servico_id: 'sv1', dia: '2026-11-18', hora: '10:00', cliente_confirmou: true }), ferramentaClaude('chamar_humano', { motivo: 'teste' }, 'tu2'), textoClaude('Marcado (teste)!')] })
  const r = await conversar(db, SALAO, 'ensaio', 'sim', { ambiente: AMBOS, fetcher: p.fetcher, rascunho: { assistente: { nome: 'Lu' } }, historico: [{ quem: 'cliente', texto: 'quero escova amanhã 10h' }, { quem: 'mimo', texto: 'Posso marcar?' }] })
  assert.equal(r.resposta, 'Marcado (teste)!')
  assert.equal(db.chamadas.filter((c) => ['bot_marcar', 'bot_chamar_humano'].includes(c.nome)).length, 0)
  assert.equal(r.acoes.marcou, 1); assert.equal(r.acoes.chamou, 1)
  const ctxPedido = db.chamadas.find((c) => c.nome === 'bot_contexto')!
  assert.deepEqual(ctxPedido.args.rascunho, { assistente: { nome: 'Lu' } })
  const primeira = p.pedidos[0].corpo.messages as Array<{ role: string; content: unknown }>
  assert.equal(primeira.length, 3)
  // depois de chamar alguém, o lembrete vai junto dos resultados
  const terceira = p.pedidos[2].corpo.messages as Array<{ content: Array<Record<string, unknown>> }>
  assert.match(JSON.stringify(terceira[terceira.length - 1].content), /Você chamou uma pessoa/)
})

await caso('esperar a equipe: o motivo e a hora voltam para o webhook, sem chamar modelo', async () => {
  const db = bancoDe({ permitido: false, motivo: 'esperar', responder_em: '2026-11-17T13:10:00Z' } as unknown as Ctx)
  const p = provedorDe({})
  const r = await conversar(db, SALAO, '+55', 'oi', { ambiente: AMBOS, fetcher: p.fetcher, instancia: 'salao-x' })
  assert.equal(r.motivo, 'esperar'); assert.equal(r.responderEm, '2026-11-17T13:10:00Z'); assert.equal(r.provedor, null)
  assert.equal(p.pedidos.length, 0)
  assert.equal(db.chamadas[0].args.instancia, 'salao-x')
})

await caso('Groq escolhido na Plataforma: ele primeiro; sem chave nenhuma: erro claro', async () => {
  const p = provedorDe({ groq: [{ status: 200, corpo: { choices: [{ message: { content: 'oi!' } }] } }] })
  const r = await conversar(bancoDe(ctxDe({ provedor: 'groq' })), SALAO, '+55', 'oi', { ambiente: AMBOS, fetcher: p.fetcher })
  assert.equal(r.provedor, 'groq'); assert.equal(p.pedidos.length, 1)
  const s = await conversar(bancoDe(ctxDe()), SALAO, '+55', 'oi', { ambiente: amb({}), fetcher: p.fetcher })
  assert.match(String(s.erro), /nenhuma chave/)
})

await caso('banco sem a 235: cai no contexto antigo (salao, tel)', async () => {
  const chamadas: Array<Record<string, unknown>> = []
  const db = { rpc: async (nome: string, args: Record<string, unknown>) => {
    chamadas.push(args)
    if (nome === 'bot_contexto' && 'instancia' in args) return { data: null, error: { message: 'Could not find the function public.bot_contexto(instancia, rascunho, salao, sem_espera, tel)' } }
    if (nome === 'bot_contexto') return { data: ctxDe({ assistente: undefined, numero_proprio: undefined, provedor: undefined, modelo_claude: undefined }), error: null }
    return { data: null, error: null }
  } }
  const p = provedorDe({ claude: [textoClaude('Oi!')] })
  const r = await conversar(db, SALAO, '+55', 'oi', { ambiente: AMBOS, fetcher: p.fetcher })
  assert.equal(r.resposta, 'Oi!'); assert.deepEqual(chamadas[1], { salao: SALAO, tel: '+55' })
  assert.equal(p.pedidos[0].corpo.model, 'claude-haiku-5-5')
})

console.log(`\n${ok} casos ok`)
