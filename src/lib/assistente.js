// 3.95: a assistente do WhatsApp do salão. As opções da tela e a prévia da conversa, que muda na hora a cada escolha
// (sem IA: é só para a dona sentir a diferença entre os jeitos; o "Testar de verdade" é que chama a assistente).

export const PADRAO = {
  nome: 'Mel', tom: 'acolhedora', emojis: 'poucos', tratamento: 'nome', tamanho: 'curtas', preco: 'informa',
  pode_marcar: true, pode_remarcar: true, pode_cancelar: true, quando: 'sempre', espera_min: 10, saudacao: '',
}

export const SUGESTOES_DE_NOME = ['Mel', 'Bia', 'Luna', 'Clara', 'Lia', 'Sofia']

export const TONS = [
  { id: 'acolhedora', rotulo: 'Acolhedora', texto: 'Calorosa e gentil, como uma recepcionista querida.' },
  { id: 'profissional', rotulo: 'Profissional', texto: 'Educada e objetiva, sem intimidade.' },
  { id: 'descontraida', rotulo: 'Descontraída', texto: 'Leve e animada, bem próxima.' },
]
export const EMOJIS = [
  { id: 'nenhum', rotulo: 'Nenhum' },
  { id: 'poucos', rotulo: 'Poucos' },
  { id: 'avontade', rotulo: 'À vontade' },
]
export const TRATAMENTOS = [
  { id: 'nome', rotulo: 'Pelo nome' },
  { id: 'voce', rotulo: 'Por "você"' },
]
export const TAMANHOS = [
  { id: 'curtas', rotulo: 'Curtinhas' },
  { id: 'normais', rotulo: 'Mais completas' },
]
export const PRECOS = [
  { id: 'informa', rotulo: 'Informa o preço' },
  { id: 'a_partir', rotulo: 'Só "a partir de"' },
  { id: 'nao_fala', rotulo: 'Não fala de preço' },
]
export const ESPERAS = [5, 10, 15, 30]

// o que veio do banco, com os padrões por baixo e só o que a tela conhece
export function configDe(c) {
  const x = { ...PADRAO }
  for (const k of Object.keys(PADRAO)) if (c && c[k] != null) x[k] = c[k]
  x.saudacao = x.saudacao ?? ''
  return x
}

// "ABCD1234" → "ABCD-1234"
export function codigoBonito(c) {
  const t = String(c ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase()
  return t.length === 8 ? `${t.slice(0, 4)}-${t.slice(4)}` : t
}

export function primeiroNome(n) {
  return String(n ?? '').trim().split(/\s+/)[0] || ''
}

// a prévia: duas trocas de mensagem no jeito escolhido
const EMOJI = {
  acolhedora: ['💕', '😊', '✨'],
  profissional: ['🙂', '📅', '✅'],
  descontraida: ['✨', '🥰', '💅'],
}
function comEmoji(texto, tom, nivel, i) {
  if (nivel === 'nenhum') return texto
  if (nivel === 'poucos' && i !== 0) return texto
  const e = EMOJI[tom] ?? EMOJI.acolhedora
  return nivel === 'avontade' ? `${texto} ${e[i % e.length]}${i === 0 ? e[(i + 1) % e.length] : ''}` : `${texto} ${e[i % e.length]}`
}

export function previa(cfg, { salao = 'seu salão', proprio = true, autonoma = false, cliente = 'Ana' } = {}) {
  const c = configDe(cfg)
  // no número da casa ela é a Mel, da MIMO, no jeito padrão
  const p = proprio ? c : { ...PADRAO, preco: c.preco, pode_marcar: c.pode_marcar, pode_remarcar: c.pode_remarcar, pode_cancelar: c.pode_cancelar }
  const nome = String(p.nome || 'Mel').trim() || 'Mel'
  const casa = `${autonoma ? 'da' : 'do'} ${salao}`
  const vocativo = p.tratamento === 'nome' ? `, ${cliente}` : ''
  const ola = { acolhedora: `Oi${vocativo}! Que bom falar com você.`, profissional: `Olá${vocativo}, tudo bem?`, descontraida: `Oiê${vocativo}!` }[p.tom]
  const quem = proprio
    ? (p.saudacao?.trim() ? p.saudacao.trim() : `${ola} Aqui é a ${nome}, assistente virtual ${casa}.`)
    : `${ola} Aqui é a Mel, assistente da MIMO, falando em nome ${casa}.`
  const preco = { informa: 'A escova sai R$ 60 e leva uns 45 minutos.', a_partir: 'A escova é a partir de R$ 60; o valor final o salão confirma na hora.', nao_fala: 'O valor, alguém do salão te passa certinho.' }[p.preco]
  const horarios = {
    acolhedora: 'Amanhã a Carla tem 10h, 14h ou 16h30. Qual fica melhor pra você?',
    profissional: 'Amanhã há horários com a Carla às 10h, 14h ou 16h30. Qual prefere?',
    descontraida: 'Amanhã a Carla tem 10h, 14h ou 16h30. Bora?',
  }[p.tom]
  const extra = p.tamanho === 'normais' ? ' Se preferir outro dia, é só me dizer.' : ''
  const primeira = p.tamanho === 'normais'
    ? `${comEmoji(quem, p.tom, p.emojis, 0)}\n\n${preco} ${horarios}${extra}`
    : `${comEmoji(quem, p.tom, p.emojis, 0)}\n${preco} ${horarios}`
  const confirma = p.pode_marcar
    ? { acolhedora: 'Perfeito! Confirmando: escova com a Carla amanhã às 10h. Posso marcar?', profissional: 'Confirmando: escova com a Carla amanhã às 10h. Posso marcar?', descontraida: 'Fechou! Escova com a Carla amanhã às 10h. Marco pra você?' }[p.tom]
    : { acolhedora: 'Ótimo! Vou chamar alguém da equipe pra confirmar esse horário com você, tá?', profissional: 'Certo. Vou pedir para alguém da equipe confirmar esse horário com você.', descontraida: 'Show! Já chamo alguém da equipe pra confirmar com você.' }[p.tom]
  return [
    { quem: 'cliente', texto: 'Oi! Tem horário pra escova amanhã?' },
    { quem: 'assistente', texto: primeira },
    { quem: 'cliente', texto: 'Às 10h, por favor' },
    { quem: 'assistente', texto: comEmoji(confirma, p.tom, p.emojis, 1) },
  ]
}

// o que mostrar como "quando responde"
export function textoQuando(c) {
  if (c.quando === 'fora_do_horario') return 'Só fora do horário do salão; no horário, a equipe responde.'
  if (c.quando === 'sem_resposta') return `No horário do salão, espera a equipe por ${c.espera_min} min; fora dele, responde na hora.`
  return 'Sempre, na hora.'
}
