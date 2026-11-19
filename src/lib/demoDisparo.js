// O disparo (4.4) no demo: as RPCs da Plataforma (a lista, salvar, disparar, pausar, acompanhar) e a função disparo
// (números, IA, teste, envio), com tudo em memória. O envio de mentira marca entregue, viu e clicou aos poucos, para a
// tela de acompanhar ter o que mostrar. Nomes e números inventados.

const agora = () => Date.now()
const iso = (ms) => new Date(ms).toISOString()
const DIA = 86400e3
const NOMES = ['Ana Paula', 'Carla Mendes', null, 'Fernanda Rocha', 'Bia', 'Patrícia Nunes', 'Renata', null, 'Luana Prado', 'Camila Reis', 'Juliana Alves', 'Mariana Costa',
  'Débora Lima', 'Tatiane Souza', null, 'Gabriela Martins', 'Sabrina Rocha', 'Aline Ferreira', 'Priscila Gomes', 'Vanessa Dias', null, 'Letícia Araújo', 'Roberta Silva', 'Karina Melo']
const WHATS = { 2: 'Ju 💅', 4: 'Bia Souza', 6: 'Rê', 7: 'Mari', 14: 'Dani', 20: 'Lu ✨' }
const CIDADES = [['Santos', 'Studio Lírio'], ['São Vicente', 'Espaço Bella'], ['Santos', null], ['Praia Grande', 'Nail Studio Fê'], ['Guarujá', null], ['Santos', 'Studio Lírio'],
  ['Santos', 'Casa da Sobrancelha'], ['Cubatão', null], ['Santos', 'Espaço Bella'], ['São Vicente', 'Studio Lírio']]
const PESSOAS = NOMES.map((nome, i) => {
  const [cidade, salao] = CIDADES[i % CIDADES.length]
  return {
    chave: `5513${String(99700000 + i * 1371).slice(0, 8)}`, telefone: `+55139${String(97100000 + i * 13719).slice(0, 8)}`,
    nome, nome_whats: WHATS[i] ?? null, cidade, salao, ultimo: iso(agora() - (2 + i * 2.4) * DIA), pedido: !!salao, disparos: i === 6 ? 1 : 0,
    ultimo_disparo: i === 6 ? iso(agora() - 7 * DIA) : null,
  }
})

const S = {
  numeros: [{ instancia: 'mimo-disparo', rotulo: 'Chip 2', numero: '5511988880000' }],
  disparos: [],
  envios: [],
  id: 1,
}
// um disparo antigo, para o histórico
;(() => {
  const id = 'd-antigo'
  S.disparos.push({ id, nome: 'Salões novos em Santos', mensagem: 'Oi, {nome}! Chegaram salões novos em {cidade} no guia da MIMO 💗 Dá uma olhada: {link}', destino: 'https://mimo.com.vc/saloes/santos',
    previa_titulo: 'Salões novos em Santos', previa_texto: 'Veja quem chegou no guia.', previa_imagem: null, numeros: ['mimo-disparo'], alternar: true, ritmo_s: 40,
    status: 'concluido', motivo_pausa: null, criado_em: iso(agora() - 7 * DIA), iniciado_em: iso(agora() - 7 * DIA), concluido_em: iso(agora() - 7 * DIA + 3600e3) })
  for (let i = 0; i < 40; i++) {
    const p = PESSOAS[i % PESSOAS.length]
    const t = agora() - 7 * DIA + i * 60e3
    S.envios.push({ id: S.id++, disparo_id: id, chave: `${p.chave}-${i}`, telefone: p.telefone, nome: p.nome ?? p.nome_whats, cidade: p.cidade, salao: p.salao, instancia: 'mimo-disparo', status: 'enviado', erro: null,
      enviado_em: iso(t), entregue_em: iso(t + 5e3), lida_em: i % 3 !== 2 ? iso(t + 600e3) : null, clicou_em: i % 4 === 0 || i === 3 || i === 9 ? iso(t + 700e3) : null, cliques: 1, respondeu_em: i % 8 === 0 ? iso(t + 900e3) : null })
  }
})()

const contas = (d) => {
  const e = S.envios.filter((x) => x.disparo_id === d.id && !x.teste)
  return { total: e.length, enviados: e.filter((x) => x.status === 'enviado').length, falhas: e.filter((x) => x.status === 'falhou').length, fila: e.filter((x) => x.status === 'fila').length,
    entregues: e.filter((x) => x.entregue_em).length, lidas: e.filter((x) => x.lida_em).length, clicaram: e.filter((x) => x.clicou_em).length, responderam: e.filter((x) => x.respondeu_em).length }
}
const hojeDe = (inst) => S.envios.filter((x) => x.instancia === inst && x.status === 'enviado' && Date.parse(x.enviado_em) > agora() - DIA).length + (inst === 'mimo-guia' ? 14 : 9)

export const DISPARO_RPC = {
  disparo_pessoas: ({ dias_ } = {}) => {
    const desde = dias_ ? agora() - dias_ * DIA : -Infinity
    return { pessoas: PESSOAS.filter((p) => Date.parse(p.ultimo) >= desde), fora: { salao: 4, teste: 2, nossos: 1 }, dias: dias_ }
  },
  disparo_salvar: ({ d }) => {
    let dp = d?.id && S.disparos.find((x) => x.id === d.id)
    if (!dp) { dp = { id: `d-${S.id++}`, status: 'rascunho', criado_em: iso(agora()), motivo_pausa: null, iniciado_em: null, concluido_em: null }; S.disparos.push(dp) }
    if (dp.status === 'rascunho') Object.assign(dp, { nome: d.nome ?? dp.nome, mensagem: d.mensagem ?? dp.mensagem, destino: d.destino ?? null, previa_titulo: d.previa_titulo ?? null, previa_texto: d.previa_texto ?? null, previa_imagem: d.previa_imagem ?? null })
    if (Array.isArray(d.numeros) && d.numeros.length) dp.numeros = d.numeros
    if (d.alternar != null) dp.alternar = d.alternar
    if (d.ritmo_s) dp.ritmo_s = d.ritmo_s
    return dp.id
  },
  disparo_comecar: ({ id_, chaves_ }) => {
    const dp = S.disparos.find((x) => x.id === id_)
    let novos = 0
    for (const k of chaves_ ?? []) {
      const p = PESSOAS.find((x) => x.chave === k)
      if (!p || S.envios.some((e) => e.disparo_id === id_ && e.chave === k)) continue
      S.envios.push({ id: S.id++, disparo_id: id_, chave: k, telefone: p.telefone, nome: p.nome ?? p.nome_whats, cidade: p.cidade, salao: p.salao, instancia: null, status: 'fila', erro: null, enviado_em: null, entregue_em: null, lida_em: null, clicou_em: null, cliques: 0, respondeu_em: null })
      novos++
    }
    Object.assign(dp, { status: 'enviando', iniciado_em: dp.iniciado_em ?? iso(agora()), concluido_em: null, motivo_pausa: null })
    return { ok: true, novos, fila: S.envios.filter((e) => e.disparo_id === id_ && e.status === 'fila').length }
  },
  disparo_pausar: ({ id_, pausar_ }) => { const dp = S.disparos.find((x) => x.id === id_); if (dp && dp.status !== 'concluido') dp.status = pausar_ ? 'pausado' : 'enviando'; return { ok: true } },
  disparo_painel: () => ({
    guia: { instancia: 'mimo-guia', numero: '5513999990000', hoje: hojeDe('mimo-guia') },
    numeros: S.numeros.map((n) => ({ ...n, hoje: hojeDe(n.instancia) })),
    disparos: [...S.disparos].sort((a, b) => b.criado_em.localeCompare(a.criado_em)).map((d) => ({ ...d, ...contas(d) })),
  }),
  // o link de uma pessoa (o site, /c/<token>): no demo, sempre o Instagram da MIMO
  disparo_link: () => ({ destino: 'https://www.instagram.com/mimo.com.vc/' }),
  disparo_detalhe: ({ id_ }) => {
    const d = S.disparos.find((x) => x.id === id_)
    return d ? { disparo: d, envios: S.envios.filter((e) => e.disparo_id === id_ && !e.teste) } : null
  },
}

// a função disparo
export function demoDisparo(c) {
  const acao = c?.acao
  if (acao === 'estado') {
    const p = DISPARO_RPC.disparo_painel()
    return { numeros: [{ instancia: 'mimo-guia', rotulo: 'Mel do guia', numero: p.guia.numero, hoje: p.guia.hoje, tipo: 'guia', estado: 'open' }, ...p.numeros.map((n) => ({ ...n, tipo: 'chip', estado: 'open' }))],
      disparos: p.disparos, segredos: { evolution: true, webhook: true, ia: true } }
  }
  if (acao === 'conectar') {
    const inst = c.instancia || `mimo-disparo-${S.numeros.length + 1}`
    if (!S.numeros.some((n) => n.instancia === inst)) S.numeros.push({ instancia: inst, rotulo: c.rotulo || 'Chip', numero: String(c.numero ?? '').replace(/\D/g, '') || null })
    return { instancia: inst, estado: 'connecting', webhook: 'ok', pairingCode: 'MIMO-7Q2K', qr: null }
  }
  if (acao === 'desconectar') return { ok: true }
  if (acao === 'remover') { S.numeros = S.numeros.filter((n) => n.instancia !== c.instancia); return { ok: true } }
  if (acao === 'escrever') {
    return { ok: true, texto: 'Oi, {nome}! Aqui é a Mel, da MIMO 💗 Lembra que você procurou salão em {cidade} pelo nosso guia?\n\nPosso te pedir uma ajudinha? O Instagram da MIMO acabou de nascer, e cada pessoa que segue ajuda o guia a chegar a mais salões de {cidade}. Leva 2 segundos 👉 {link}',
      titulo: 'Siga a MIMO no Instagram 💗', descricao: 'Ajude o guia de salões a crescer e veja primeiro os salões mais bem avaliados da sua cidade.' }
  }
  if (acao === 'nomes') return { ok: true, pessoas: 6, gravados: 3, paginas: 2 }
  if (acao === 'teste') return { ok: true, enviado: { id: 0 } }
  if (acao === 'enviar') {
    const dp = S.disparos.find((x) => x.id === c.disparo)
    if (!dp) return Promise.reject(new Error('disparo não encontrado'))
    if (dp.status !== 'enviando') return { ok: true, parado: true, status: dp.status }
    // o que já saiu vai sendo entregue, visto e clicado
    for (const e of S.envios.filter((x) => x.disparo_id === dp.id && x.status === 'enviado')) {
      if (!e.entregue_em) e.entregue_em = iso(agora())
      else if (!e.lida_em && e.id % 3 !== 2) e.lida_em = iso(agora())
      else if (e.lida_em && !e.clicou_em && e.id % 3 === 0) { e.clicou_em = iso(agora()); e.cliques = 1 }
      else if (e.clicou_em && !e.respondeu_em && e.id % 6 === 0) e.respondeu_em = iso(agora())
    }
    const prox = S.envios.find((x) => x.disparo_id === dp.id && x.status === 'fila')
    if (!prox) { dp.status = 'concluido'; dp.concluido_em = iso(agora()); return { ok: true, fim: true } }
    const nums = dp.alternar ? dp.numeros : dp.numeros.slice(0, 1)
    const feitas = S.envios.filter((x) => x.disparo_id === dp.id && x.status !== 'fila').length
    prox.instancia = nums[feitas % nums.length]
    prox.enviado_em = iso(agora())
    if (prox.id % 11 === 4) { prox.status = 'falhou'; prox.erro = 'número sem WhatsApp' } else prox.status = 'enviado'
    return { ok: true, enviado: { id: prox.id, instancia: prox.instancia } }
  }
  return Promise.reject(new Error('ação desconhecida'))
}
