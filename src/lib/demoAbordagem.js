// A abordagem dos donos no modo demonstração (3.12): a mesma fila que
// guia_fila_abordagem() monta no banco (migração 158), com a mesma conta de
// prioridade e os mesmos motivos em palavras. Os números de cada salão vêm
// de demoDesempenho (src/lib/demoMetricas.js), então batem com a aba
// Desempenho. O que a pessoa faz na tela (status, nota, lembrete, WhatsApp)
// fica guardado aqui em memória enquanto a página estiver aberta.
import { GUIA_LUGARES, GUIA_INTERESSES } from './demoGuia.js'
import { demoDesempenho } from './demoMetricas.js'

const CANAIS = ['whatsapp', 'ligacao', 'instagram', 'presencial', 'email']
const STATUS = ['a_abordar', 'abordado', 'respondeu', 'negociando', 'cliente', 'sem_interesse', 'nao_abordar']
const CONTATO = {
  whatsapp: ['tocou no WhatsApp', 'tocaram no WhatsApp'], ligar: ['tocou para ligar', 'tocaram para ligar'], mapa: ['pediu a rota', 'pediram a rota'],
  instagram: ['abriu o Instagram', 'abriram o Instagram'], site: ['abriu o site', 'abriram o site'], agendar_mimo: ['tocou em Agendar', 'tocaram em Agendar'],
  email: ['tocou no e-mail', 'tocaram no e-mail'],
}
const EU = 'Bruno Tedesco'

// as datas como o banco: o dia de São Paulo
const diaSP = (d) => new Date(new Date(d).getTime() - 3 * 3600e3).toISOString().slice(0, 10)
const hojeSP = () => diaSP(Date.now())
const somaDias = (dia, n) => new Date(new Date(`${dia}T12:00:00Z`).getTime() + n * 86400e3).toISOString().slice(0, 10)
const entre = (a, b) => Math.round((new Date(`${a}T12:00:00Z`) - new Date(`${b}T12:00:00Z`)) / 86400e3)
const haDias = (n, horas = 0) => new Date(Date.now() - n * 86400e3 - horas * 3600e3).toISOString()
const ddmm = (dia) => { const [, m, d] = dia.split('-'); return `${d}/${m}` }

const etapaDe = (s) => ({ a_abordar: 0, abordado: 1, respondeu: 2, sem_interesse: 2, negociando: 3, cliente: 4 })[s] ?? null
const temZap = (l) => !!String(l.whatsapp ?? '').trim() || (() => { const d = String(l.telefone ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); return d.length === 11 && d[2] === '9' })()

// ---- o começo: algumas conversas já andando, para a tela ter o que mostrar ----------------------
const ABORDAGENS = new Map()
const ACOES = []
let proximoId = 1
function semear() {
  const hoje = hojeSP()
  const conversa = (lugar_id, campos, acoes) => {
    ABORDAGENS.set(lugar_id, { lugar_id, status: 'a_abordar', proximo_contato: null, nota: null, ultimo_contato_em: null, atualizado_por_nome: EU, ...campos })
    for (const a of acoes) ACOES.push({ id: proximoId++, lugar_id, de_status: null, para_status: null, texto: null, proximo_contato: null, dados: {}, por_nome: EU, ...a })
  }
  // Studio Lírio: mandou os números, ficou de ver com a sócia; o lembrete venceu ontem
  conversa('gl1', { status: 'abordado', proximo_contato: somaDias(hoje, -1), nota: 'Mandei os números da página. Ficou de ver com a sócia e responder.', ultimo_contato_em: haDias(5), atualizado_em: haDias(5) }, [
    { tipo: 'whatsapp', de_status: 'a_abordar', para_status: 'abordado', texto: 'Oi! Tudo bem? Aqui é da MIMO, um guia de salões de Itanhaém...', proximo_contato: somaDias(hoje, -1), dados: { dias: 30, para: 'salao' }, em: haDias(5) },
    { tipo: 'nota', de_status: 'abordado', texto: 'Mandei os números da página. Ficou de ver com a sócia e responder.', em: haDias(5, -1) },
  ])
  // Olhar Lash: respondeu animada; volta a falar daqui a dois dias
  conversa('gl4', { status: 'respondeu', proximo_contato: somaDias(hoje, 2), nota: 'Respondeu animada. Pediu para mostrar como fica a agenda num sábado cheio.', ultimo_contato_em: haDias(3), atualizado_em: haDias(1) }, [
    { tipo: 'whatsapp', de_status: 'a_abordar', para_status: 'abordado', texto: 'Oi! Tudo bem? Aqui é da MIMO...', em: haDias(3) },
    { tipo: 'status', de_status: 'abordado', para_status: 'respondeu', em: haDias(1, 2) },
    { tipo: 'lembrete', de_status: 'respondeu', proximo_contato: somaDias(hoje, 2), em: haDias(1, 1) },
    { tipo: 'nota', de_status: 'respondeu', texto: 'Respondeu animada. Pediu para mostrar como fica a agenda num sábado cheio.', em: haDias(1) },
  ])
  // Studio Mel: a abordagem que deu certo (hoje agenda pela MIMO)
  conversa('gl5', { status: 'cliente', nota: 'Fechou o plano do salão depois do teste.', ultimo_contato_em: haDias(38), atualizado_em: haDias(30) }, [
    { tipo: 'whatsapp', de_status: 'a_abordar', para_status: 'abordado', texto: 'Oi! Tudo bem? Aqui é da MIMO...', em: haDias(45) },
    { tipo: 'status', de_status: 'abordado', para_status: 'respondeu', em: haDias(44) },
    { tipo: 'presencial', de_status: 'respondeu', para_status: 'negociando', texto: 'Mostrei a agenda no salão.', em: haDias(38) },
    { tipo: 'status', de_status: 'negociando', para_status: 'cliente', em: haDias(30) },
  ])
  // Salão Bem-Me-Quer (ainda fora do ar, sem WhatsApp): ligou, a dona chega à tarde; lembrete para hoje
  conversa('gl8', { status: 'abordado', proximo_contato: hoje, nota: 'Atendeu a recepcionista. A dona chega depois das 14h.', ultimo_contato_em: haDias(9), atualizado_em: haDias(9) }, [
    { tipo: 'ligacao', de_status: 'a_abordar', para_status: 'abordado', proximo_contato: hoje, em: haDias(9) },
    { tipo: 'nota', de_status: 'abordado', texto: 'Atendeu a recepcionista. A dona chega depois das 14h.', em: haDias(9, -1) },
  ])
  // Make by Duda (fora do ar): negociando, sem lembrete marcado
  conversa('gl10', { status: 'negociando', nota: 'Quer testar com as noivas de dezembro. Mandar o link do teste.', ultimo_contato_em: haDias(4), atualizado_em: haDias(2) }, [
    { tipo: 'instagram', de_status: 'a_abordar', para_status: 'abordado', texto: 'Oi, Duda! Aqui é da MIMO...', em: haDias(6) },
    { tipo: 'whatsapp', de_status: 'abordado', para_status: 'negociando', texto: 'Te mando como fica a agenda para as noivas.', em: haDias(4) },
    { tipo: 'nota', de_status: 'negociando', texto: 'Quer testar com as noivas de dezembro. Mandar o link do teste.', em: haDias(2) },
  ])
  // Unhas da Praia: não quer
  conversa('gl7', { status: 'sem_interesse', nota: 'Disse que só atende por indicação e não quer agenda online.', ultimo_contato_em: haDias(12), atualizado_em: haDias(11) }, [
    { tipo: 'whatsapp', de_status: 'a_abordar', para_status: 'abordado', texto: 'Oi! Tudo bem? Aqui é da MIMO...', em: haDias(12) },
    { tipo: 'status', de_status: 'abordado', para_status: 'sem_interesse', em: haDias(11) },
  ])
  // Estética Vênus: fechou; não abordar
  conversa('gl11', { status: 'nao_abordar', nota: 'Fechou, segundo o Instagram.', atualizado_em: haDias(6) }, [
    { tipo: 'status', de_status: 'a_abordar', para_status: 'nao_abordar', em: haDias(6) },
  ])
}
semear()

// ---- a fila (o mesmo formato e a mesma conta de guia_fila_abordagem) ------------------------------
function fila({ dias = 30, lugar_ = null } = {}) {
  const n = Math.max(1, Math.min(Number(dias) || 30, 400))
  const hoje = hojeSP()
  const de = somaDias(hoje, -(n - 1))
  const des = demoDesempenho({ dias: n }, GUIA_LUGARES, GUIA_INTERESSES)
  const numeros = new Map()
  for (const p of des.paginas) if (p.lugar_id && !numeros.has(p.lugar_id)) numeros.set(p.lugar_id, p)
  const itens = []
  for (const l of GUIA_LUGARES) {
    if (l.status === 'removido' || (lugar_ && l.id !== lugar_)) continue
    const ab = ABORDAGENS.get(l.id)
    const abertos = GUIA_INTERESSES.filter((i) => i.lugar_id === l.id && !i.atendido_em)
    const conta = (t) => abertos.filter((i) => i.tipo === t).length
    const pend = { quero_marcar: conta('quero_marcar'), sou_dono: conta('sou_dono'), remover: conta('remover'), corrigir: conta('corrigir') }
    if (l.status !== 'publicado' && !ab && pend.quero_marcar + pend.sou_dono === 0) continue
    const dono = abertos.filter((i) => i.tipo === 'sou_dono' && (i.contato || i.email)).sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)))[0]
    const p = numeros.get(l.id) ?? {}
    const visitas = p.visitas ?? 0
    const contatos = p.contatos ?? 0
    const eventos = p.eventos ?? {}
    const status = l.salon_id ? 'cliente' : ab?.status ?? 'a_abordar'
    const acoes = ACOES.filter((a) => a.lugar_id === l.id).sort((a, b) => String(b.em).localeCompare(String(a.em)) || b.id - a.id)
    const tentativas = acoes.filter((a) => CANAIS.includes(a.tipo)).length
    const etapaHist = acoes.reduce((m, a) => Math.max(m, etapaDe(a.para_status) ?? -1), -1)
    const desde = ab?.ultimo_contato_em ? entre(hoje, diaSP(ab.ultimo_contato_em)) : null
    const prox = ab?.proximo_contato ?? null
    const plural = (k, um, varios) => (k === 1 ? um : varios)

    // os motivos e o peso de cada um (o mesmo da 158)
    const m = []
    if (pend.sou_dono) m.push(['dono', 120 + 20 * Math.min(pend.sou_dono - 1, 2), pend.sou_dono === 1 ? 'o dono pediu contato' : `${pend.sou_dono} pedidos de dono abertos`])
    if (pend.quero_marcar) m.push(['pedido', 40 * Math.min(pend.quero_marcar, 5), `${pend.quero_marcar} ${plural(pend.quero_marcar, 'pessoa pediu', 'pessoas pediram')} para marcar`])
    if (prox && prox <= hoje) { const atraso = entre(hoje, prox); m.push(['lembrete', 80 + Math.min(20, 2 * atraso), atraso === 0 ? 'lembrete para hoje' : atraso === 1 ? 'lembrete vencido ontem' : `lembrete vencido há ${atraso} dias`]) }
    if (status === 'negociando') m.push(['status', 50, 'em negociação'])
    if (status === 'respondeu') m.push(['status', 40, 'respondeu: falta o próximo passo'])
    if (visitas > 0) m.push(['visita', Math.min(40, Math.floor((visitas + 1) / 2)), `${visitas} ${plural(visitas, 'visita', 'visitas')} em ${n} ${plural(n, 'dia', 'dias')}`])
    if (prox && prox > hoje) m.push(['espera', -60, prox === somaDias(hoje, 1) ? 'lembrete para amanhã' : `lembrete para ${ddmm(prox)}`])
    if (!prox && status === 'abordado' && desde != null && desde >= 0 && desde <= 2) m.push(['espera', -40, `${desde === 0 ? 'abordado hoje' : desde === 1 ? 'abordado ontem' : `abordado há ${desde} dias`}, esperando resposta`])
    if (!temZap(l)) m.push(['sem_zap', -10, 'sem WhatsApp divulgado'])
    if (l.status !== 'publicado') m.push(['info', 0, 'página fora do ar'])
    Object.entries(eventos).filter(([t, k]) => CONTATO[t] && k > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2)
      .forEach(([t, k]) => m.push(['contato', Math.min(90, 3 * k), k === 1 ? `1 pessoa ${CONTATO[t][0]}` : `${k} ${CONTATO[t][1]}`]))
    const prioridade = m.filter(([t]) => t !== 'contato' && t !== 'info').reduce((s, [, peso]) => s + peso, 0) + Math.min(90, 3 * contatos)
    const motivos = m.map(([tipo, peso, texto]) => ({ tipo, peso, texto })).sort((a, b) => b.peso - a.peso || a.texto.localeCompare(b.texto))
    if (!motivos.some((x) => x.peso > 0)) motivos.push({ tipo: 'info', peso: 0, texto: `sem pedidos nem contatos em ${n} ${plural(n, 'dia', 'dias')}` })
    const fora = status === 'cliente' ? 'cliente' : pend.remover ? 'remover' : ['sem_interesse', 'nao_abordar'].includes(status) ? status : null
    const etapaSalva = etapaDe(ab?.status) ?? -1
    const etapa = Math.max(0, etapaSalva, etapaHist, tentativas ? 1 : 0, l.salon_id && (tentativas || etapaHist > 0 || etapaSalva > 0) ? 4 : 0)
    const ultima = acoes[0]

    itens.push({
      lugar_id: l.id, nome: l.nome, slug: l.slug, cidade: l.cidade, cidade_slug: l.cidade_slug, bairro: l.bairro, categoria: l.categoria,
      status_pagina: l.status, pagina: `/saloes/${l.cidade_slug}/${l.slug}`, whatsapp: l.whatsapp, telefone: l.telefone, instagram: l.instagram, site: l.site,
      tem_zap: temZap(l), na_mimo: !!l.salon_id, nota_google: l.nota, avaliacoes: l.avaliacoes,
      status, status_salvo: ab?.status ?? null, tem_registro: !!ab, proximo_contato: prox, nota: ab?.nota ?? null, ultimo_contato_em: ab?.ultimo_contato_em ?? null,
      atualizado_em: ab?.atualizado_em ?? null, atualizado_por_nome: ab ? ab.atualizado_por_nome : null, tentativas,
      ultima_acao: ultima ? { id: ultima.id, tipo: ultima.tipo, em: ultima.em, texto: ultima.texto ? ultima.texto.slice(0, 160) : null, para_status: ultima.para_status, proximo_contato: ultima.proximo_contato } : null,
      visitas, visitantes: p.visitantes ?? 0, contatos, eventos, interesses: p.interesses ?? {},
      pendentes: pend, dono: dono ? { nome: dono.nome, contato: dono.contato ?? null, email: dono.email ?? null, ligacao: dono.ligacao ?? null, mensagem: dono.mensagem, em: dono.criado_em } : null,
      fila: fora ? 'fora' : 'principal', fora_motivo: fora, prioridade, motivos, etapa, ja_cliente: !!l.salon_id && etapa < 4,
    })
  }
  itens.sort((a, b) => (a.fila === 'fora') - (b.fila === 'fora') || b.prioridade - a.prioridade || (b.nota_google ?? -1) - (a.nota_google ?? -1) || (b.avaliacoes ?? -1) - (a.avaliacoes ?? -1) || a.nome.localeCompare(b.nome, 'pt-BR'))
  return { dias: n, de, ate: hoje, hoje, itens }
}

const erro = (msg) => { throw new Error(msg) }

// ---- registrar uma ação (as mesmas regras de guia_abordagem_registrar) ---------------------------
function registrar({ lugar_, acao_, status_ = null, texto_ = null, proximo_contato_ = null, dados_ = null, dias_ = 30 } = {}) {
  const hoje = hojeSP()
  if (!CANAIS.includes(acao_) && !['status', 'nota', 'lembrete'].includes(acao_)) erro(`ação desconhecida: ${acao_}`)
  if (status_ && !STATUS.includes(status_)) erro(`status desconhecido: ${status_}`)
  if (proximo_contato_ && (proximo_contato_ < hoje || proximo_contato_ > somaDias(hoje, 400))) erro('o lembrete precisa ser de hoje até um ano para a frente')
  const l = GUIA_LUGARES.find((x) => x.id === lugar_ && x.status !== 'removido')
  if (!l) erro('salão não encontrado')
  const criado = !ABORDAGENS.has(lugar_)
  const a = ABORDAGENS.get(lugar_) ?? { lugar_id: lugar_, status: 'a_abordar', proximo_contato: null, nota: null, ultimo_contato_em: null }
  const texto = String(texto_ ?? '').trim().slice(0, 2000) || null
  const antes = { novo: criado, status: a.status, proximo_contato: a.proximo_contato, nota: a.nota, ultimo_contato_em: a.ultimo_contato_em }
  const novo = { ...a }
  if (CANAIS.includes(acao_)) {
    novo.status = status_ ?? (a.status === 'a_abordar' ? 'abordado' : a.status)
    novo.proximo_contato = proximo_contato_ ?? (a.proximo_contato && a.proximo_contato > hoje ? a.proximo_contato : null)
    novo.ultimo_contato_em = new Date().toISOString()
  } else if (acao_ === 'status') {
    if (!status_) erro('diga o status novo')
    novo.status = status_
    novo.proximo_contato = ['cliente', 'sem_interesse', 'nao_abordar'].includes(status_) ? null : proximo_contato_ ?? a.proximo_contato
  } else if (acao_ === 'nota') {
    novo.nota = texto
  } else {
    novo.proximo_contato = proximo_contato_ || null
  }
  if (!CANAIS.includes(acao_) && novo.status === a.status && novo.proximo_contato === a.proximo_contato && novo.nota === a.nota) {
    return { ok: true, acao_id: null, item: fila({ dias: dias_, lugar_ }).itens[0] ?? null }
  }
  ABORDAGENS.set(lugar_, { ...novo, atualizado_por_nome: EU, atualizado_em: new Date().toISOString() })
  const dados = dados_ && typeof dados_ === 'object' ? { ...dados_ } : {}
  delete dados.antes
  const id = proximoId++
  ACOES.push({
    id, lugar_id: lugar_, tipo: acao_, de_status: a.status, para_status: novo.status !== a.status ? novo.status : null,
    texto: acao_ === 'nota' ? novo.nota : CANAIS.includes(acao_) ? texto : null, proximo_contato: novo.proximo_contato,
    dados: { ...dados, antes }, por_nome: EU, em: new Date().toISOString(),
  })
  return { ok: true, acao_id: id, item: fila({ dias: dias_, lugar_ }).itens[0] ?? null }
}

function desfazer({ acao_, dias_ = 30 } = {}) {
  const x = ACOES.find((a) => a.id === acao_)
  if (!x) erro('essa ação não existe mais')
  const depois = ACOES.some((a) => a.lugar_id === x.lugar_id && (a.em > x.em || (a.em === x.em && a.id > x.id)))
  if (depois) erro('só dá para desfazer a última ação deste salão')
  const antes = x.dados?.antes
  if (!antes) erro('essa ação não guarda o estado de antes')
  if (antes.novo && !ACOES.some((a) => a.lugar_id === x.lugar_id && a.id !== x.id)) ABORDAGENS.delete(x.lugar_id)
  else ABORDAGENS.set(x.lugar_id, { ...ABORDAGENS.get(x.lugar_id), status: antes.status ?? 'a_abordar', proximo_contato: antes.proximo_contato, nota: antes.nota, ultimo_contato_em: antes.ultimo_contato_em, atualizado_por_nome: EU, atualizado_em: new Date().toISOString() })
  ACOES.splice(ACOES.indexOf(x), 1)
  return { ok: true, lugar_id: x.lugar_id, item: fila({ dias: dias_, lugar_: x.lugar_id }).itens[0] ?? null }
}

function historico({ lugar_ } = {}) {
  return ACOES.filter((a) => a.lugar_id === lugar_)
    .sort((a, b) => String(b.em).localeCompare(String(a.em)) || b.id - a.id)
    .slice(0, 200)
    .map(({ dados, ...a }) => { const d = { ...dados }; delete d.antes; return { ...a, dados: d } })
}

// erro de regra (status desconhecido, desfazer fora de ordem) sobe como exceção: a
// chamada no demo.js rejeita e a tela mostra a mensagem, como faria com o erro do banco
export const ABORDAGEM_RPC = {
  guia_fila_abordagem: (a) => fila(a ?? {}),
  guia_abordagem_registrar: (a) => registrar(a ?? {}),
  guia_abordagem_desfazer: (a) => desfazer(a ?? {}),
  guia_abordagem_historico: (a) => historico(a ?? {}),
}
