// 3.99 (migração 248): a demo dos limites da assistente, do saldo extra comprado por Pix e dos números que ela não
// responde. O estado vive só enquanto a página está aberta.
const PACOTES = [
  { respostas: 500, valor_cents: 1990 },
  { respostas: 1000, valor_cents: 3490, destaque: 'mais escolhido' },
  { respostas: 2000, valor_cents: 5990, destaque: 'melhor preço' },
]
const emHoras = (h) => new Date(Date.now() + h * 3600e3).toISOString()
const chave = (t) => String(t ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')

const estado = {
  usadas: 32,
  teto: 200,
  extras: 0,
  pausas: [
    { telefone: '5511976187038', nome: 'Bruna Tavares', tipo: 'chamou_equipe', ate: emHoras(1.6) },
    { telefone: '5513997835339', nome: 'Ana Lima', tipo: 'equipe_respondeu', ate: emHoras(1.2) },
    { telefone: '5511987900115', nome: null, tipo: 'ofensiva', ate: emHoras(19) },
  ],
  compras: [],
  ignora_equipe: true,
  equipe: [
    { nome: 'Mel Tedesco', telefone: '(13) 99120-3410', voce: true },
    { nome: 'Ana Paula', telefone: '(13) 99000-9994', voce: false },
    { nome: 'Bia Souza', telefone: '(13) 99000-9995', voce: false },
  ],
  lista: [{ id: 'nr1', nome: 'Fornecedor de produtos', telefone: '5513988771122' }],
  compra: null,
}

const limites = () => ({ usadas: estado.usadas, teto: estado.teto, extras: estado.extras, pacotes: PACOTES, pausas: estado.pausas, compras: estado.compras })
const semResposta = () => ({ ignora_equipe: estado.ignora_equipe, equipe: estado.equipe, lista: estado.lista })

export const RESPOSTAS_RPC = {
  respostas_pacotes: () => PACOTES,
  assistente_limites: () => limites(),
  assistente_voltar_a_responder: ({ tel }) => { estado.pausas = estado.pausas.filter((p) => chave(p.telefone) !== chave(tel)); return limites() },
  assistente_sem_resposta: () => semResposta(),
  assistente_sem_resposta_salvar: ({ tel, nome_ }) => {
    const d = chave(tel)
    if (d.length < 10) throw new Error('Confira o WhatsApp: DDD e número (ex.: 13 99999-1234).')
    const ja = estado.lista.find((n) => chave(n.telefone) === d)
    if (ja) { if (nome_) ja.nome = nome_ } else estado.lista.unshift({ id: 'nr' + Date.now(), nome: nome_ || null, telefone: '55' + d })
    return semResposta()
  },
  assistente_sem_resposta_tirar: ({ item }) => { estado.lista = estado.lista.filter((n) => n.id !== item); return semResposta() },
  salao_ignora_equipe: ({ liga }) => { estado.ignora_equipe = Boolean(liga); return semResposta() },
}

// a função respostas-extras na demo: o Pix sai na hora; o "Já paguei" (ou a conferência sozinha, a partir da
// segunda) dá como pago
export function demoRespostasExtras(corpo) {
  // 4.10: as agendas a mais do plano usam a mesma função (tipo 'agendas')
  if (corpo?.tipo === 'agendas') {
    if (corpo.acao === 'pix') {
      const n = Math.max(1, Number(corpo.agendas) || 1)
      estado.agendas = { id: 'ag-demo', agendas: n, meses: 1, valor_cents: n * 990, status: 'aguardando', cobranca_id: 'pay_demo_ag', conferidas: 0, sandbox: true,
        copia_cola: '00020126580014br.gov.bcb.pix0136demo-mimo-agendas-' + n + '5204000053039865802BR5904MIMO6009SAO PAULO62070503***6304ABCD' }
      return { ok: true, compra: { ...estado.agendas, imagem: null } }
    }
    const c = estado.agendas
    if (!c) return { ok: true, compra: null }
    c.conferidas += 1
    if (c.status === 'aguardando' && (corpo.manual || c.conferidas > 2)) c.status = 'pago'
    return { ok: true, compra: { ...c, liberadas: 5 + c.agendas } }
  }
  if (corpo?.acao === 'pix') {
    const p = PACOTES.find((x) => x.respostas === Number(corpo.respostas)) ?? PACOTES[1]
    estado.compra = { id: 'rc-demo', respostas: p.respostas, valor_cents: p.valor_cents, status: 'aguardando', cobranca_id: 'pay_demo', conferidas: 0, sandbox: true,
      copia_cola: '00020126580014br.gov.bcb.pix0136demo-mimo-respostas-' + p.respostas + '52040000530398654' + String(p.valor_cents / 100).length + (p.valor_cents / 100).toFixed(2) + '5802BR5904MIMO6006Santos62070503***6304ABCD' }
    return { ok: true, compra: { ...estado.compra, imagem: null } }
  }
  if (corpo?.acao === 'conferir' || corpo?.acao === 'simular') {
    const c = estado.compra
    if (!c) return { ok: true, compra: null }
    c.conferidas += 1
    if (c.status === 'aguardando' && (corpo.manual || c.conferidas > 2)) {
      c.status = 'pago'
      estado.extras += c.respostas
      estado.compras.unshift({ respostas: c.respostas, valor_cents: c.valor_cents, pago_em: new Date().toISOString() })
    }
    return { ok: true, compra: { ...c, extras: estado.extras } }
  }
  return { ok: true }
}
