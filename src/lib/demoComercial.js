// A assistente comercial no modo demonstração (3.74, migração 218): a configuração e as conversas de mentira, as RPCs da
// Plataforma e do site (comercial_*) e o simulador — um roteiro sem IA que anda como o motor de verdade: apresentação →
// nome/cidade/salão (acha o Studio Lírio no guia) → planos → "quero começar" (a equipe) / e-mail (as fotos).
const h = (min) => new Date(Date.now() - min * 60e3).toISOString()
const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export const ORIENTACAO_COM = `Você é a {nome}, consultora da MIMO: um sistema de agendamento para salões de beleza e profissionais autônomas, com um guia de salões onde as clientes encontram e marcam. Seu tom: feminino, decidido e firme, mas delicado; direto ao ponto, caloroso, sem bajular. Mensagens curtas, uma pergunta por vez, no máximo um emoji. Português do Brasil.`
let CFG = {
  id: 1, ligado: true, nome: 'Lia', numero: '5513991150218', instancia: 'mimo-comercial', numero_avisos: '5513999990001', provedor: 'groq', modelo: null, vendas_ligadas: true,
  orientacao: ORIENTACAO_COM,
  conhecimento: 'A MIMO Agenda organiza os agendamentos do salão num lugar só: link próprio (nome.mimo.com.vc), QR Code, lembretes automáticos, lista de espera, equipe com permissões, comanda e caixa. O guia de salões (mimo.com.vc/saloes) é grátis. 7 dias grátis; mensalidade por Pix, pré-pago, cancela quando quiser.',
  faq: 'Quanto custa? A tabela de planos, pelo número de agendas.\nTem teste grátis? 7 dias, sem cartão.\nPreciso de computador? Não, o painel abre no celular.',
  objecoes: 'Está caro. Uma cliente a mais por mês já paga o plano.\nNão tenho tempo de configurar. A equipe monta com você em uns 20 minutos.',
  msg_apresentacao: 'Oi! Eu sou a {nome}, da MIMO 💗 A gente ajuda salões e profissionais de beleza a organizar a agenda e a receber clientes pelo guia. Me conta: qual é o seu nome, de que cidade você fala e como se chama o seu salão (ou você é autônoma)?',
  msg_vendas_desligadas: 'Que bom que você chegou até aqui! 💗 A MIMO Agenda está em fase de testes com um grupo de salões. Posso anotar o seu interesse? Me diz o seu nome, a cidade e o nome do salão.',
  suporte_numero: '5513999990002', msg_suporte: 'Oi! Esse número é o comercial da MIMO. Para suporte da sua agenda, fala com a gente em {suporte}.',
  encaminhar_numero: null, msg_equipe: 'Vou chamar alguém da equipe para continuar com você por aqui. A equipe atende {horario}; se for fora desse horário, respondemos assim que abrir.{encaminhar}',
  msg_cliente_final: 'Oi! Esse número é da equipe comercial da MIMO. Para marcar um horário, é pelo guia: mimo.com.vc/saloes 💗',
  msg_achei_no_guia: 'Achei o {salao} no nosso guia: {link} 💗 A página já está no ar, de graça. Quer colocar fotos ou corrigir alguma coisa? Me passa um e-mail seu que eu mando o pedido para a equipe.',
  msg_salao_na_mimo: 'O {salao} já usa a MIMO Agenda! Se você é da equipe dele e precisa de suporte, fala com a gente em {suporte}.',
  msg_nao_achei: 'Não achei o {salao} no guia de {cidade}. Quer que a equipe inclua? Me manda o bairro e o endereço.',
  msg_cidade_fora: 'O guia da MIMO ainda não chegou em {cidade}, mas a agenda funciona em qualquer cidade.',
  msg_fotos_enviado: 'Pronto! Mandei para {email} um e-mail para confirmar que você responde pelo {salao}. Assim que a equipe confirmar, chega o link para você enviar as fotos 💗',
  equipe_dias: 'seg-sex', equipe_inicio: '09:00:00', equipe_fim: '18:00:00', silencio_min: 30, cadencia_dias: [1, 3, 7],
  msg_cadencia_1: 'Oi{nome_lead}! Passando para saber se ficou alguma dúvida sobre a MIMO 💗', msg_cadencia_2: 'Lembrei de você: os 7 dias grátis continuam valendo quando quiser testar.', msg_cadencia_3: 'Vou deixar você à vontade por aqui. Quando fizer sentido, é só me chamar.',
  pausa_seg: 2, bolhas: true, limite_respostas: 40, retencao_dias: 180, atualizado_em: h(60 * 30),
}
let ESTADO = 'open'
const PLANOS = [
  { plano: 'autonoma', nome: 'Autônoma', base_cents: 0, inclusas: 1, extra_cents: 0, ate: 1 },
  { plano: 'pro', nome: 'MIMO Pro', base_cents: 4990, inclusas: 3, extra_cents: 990, ate: 10 },
  { plano: 'promais', nome: 'MIMO Pro+', base_cents: 14990, inclusas: 11, extra_cents: 790, ate: null },
]
const LINK_LIRIO = '/saloes/itanhaem/studio-lirio'
const CONVERSAS = [
  { id: 1, telefone: '5513988001111', nome_perfil: 'Carla Mendes', origem: 'botao', situacao: 'interessada', lugar_id: 'gl1', pausada: false, humano_ate: null, cadencia_etapa: 0, avisada_em: null, teste: false,
    dados: { nome: 'Carla', cidade: 'Itanhaém', salao: 'Studio Lírio', autonoma: false, interesse: 'alto', guia: { lugar_id: 'gl1', nome: 'Studio Lírio', link: LINK_LIRIO, na_mimo: false, fotos_n: 3 }, guia_informado: true, cidade_coberta: true },
    criado_em: h(50), atualizada_em: h(12), ultima_lead_em: h(12), ultima_nossa_em: h(12),
    mensagens: [
      { q: 'lead', t: 'Oi! Quero conhecer a MIMO Agenda.', em: h(50) },
      { q: 'ia', t: 'Oi! Eu sou a Lia, da MIMO 💗 A gente ajuda salões e profissionais de beleza a organizar a agenda e a receber clientes pelo guia. Me conta: qual é o seu nome, de que cidade você fala e como se chama o seu salão?', em: h(50) },
      { q: 'lead', t: 'Carla, do Studio Lírio em Itanhaém. Somos 3.', em: h(40) },
      { q: 'ia', t: 'Prazer, Carla! Com 3 profissionais, o plano é o MIMO Pro: R$ 49,90 por mês, com 7 dias grátis para testar. Como as suas clientes marcam hoje?', em: h(40) },
      { q: 'ia', t: `Achei o Studio Lírio no nosso guia: https://mimo.com.vc${LINK_LIRIO} 💗 A página já está no ar, de graça. Quer colocar fotos ou corrigir alguma coisa? Me passa um e-mail seu que eu mando o pedido para a equipe.`, em: h(40) },
      { q: 'lead', t: 'Pelo WhatsApp mesmo, é uma loucura. Vou pensar no plano.', em: h(12) },
      { q: 'ia', t: 'Entendo! A diferença é que você para de responder "tem vaga?" dez vezes por dia: elas veem o horário livre e marcam sozinhas. Posso te mandar o link da página do seu salão enquanto você pensa?', em: h(12) },
    ] },
  { id: 2, telefone: '5513977002222', nome_perfil: 'Dani', origem: 'mel', situacao: 'quer_comecar', lugar_id: 'gl3', pausada: false, humano_ate: new Date(Date.now() + 22 * 60e3).toISOString(), cadencia_etapa: 0, avisada_em: h(8), teste: false,
    dados: { nome: 'Daniela', cidade: 'Itanhaém', salao: 'Ateliê Cabelo & Arte', autonoma: false, interesse: 'alto', guia: { lugar_id: 'gl3', nome: 'Ateliê Cabelo & Arte', link: '/saloes/itanhaem/atelie-cabelo-e-arte', na_mimo: false, fotos_n: 0 }, guia_informado: true, cidade_coberta: true },
    criado_em: h(60 * 3), atualizada_em: h(8), ultima_lead_em: h(9), ultima_nossa_em: h(8),
    mensagens: [
      { q: 'lead', t: 'Oi! Vim pelo guia da MIMO: quero conhecer a MIMO Agenda para o Ateliê Cabelo & Arte (Itanhaém).', em: h(60 * 3) },
      { q: 'ia', t: 'Oi! Eu sou a Lia, da MIMO 💗 Me conta: qual é o seu nome?', em: h(60 * 3) },
      { q: 'ia', t: 'Achei o Ateliê Cabelo & Arte no nosso guia: https://mimo.com.vc/saloes/itanhaem/atelie-cabelo-e-arte 💗 A página já está no ar, de graça.', em: h(60 * 3) },
      { q: 'lead', t: 'Daniela. Quero testar os 7 dias!', em: h(9) },
      { q: 'ia', t: 'Vou chamar alguém da equipe para continuar com você por aqui. A equipe atende de segunda a sexta, das 9h às 18h.', em: h(9) },
      { q: 'equipe', t: 'Oi, Daniela! Aqui é o Bruno, da MIMO. Vamos montar a sua agenda agora? Me passa o e-mail que você quer usar.', em: h(8) },
    ] },
  { id: 3, telefone: '5513966003333', nome_perfil: 'Rô', origem: 'direto', situacao: 'cliente', lugar_id: null, pausada: false, humano_ate: null, cadencia_etapa: 0, avisada_em: null, teste: false,
    dados: { suporte_informado: true }, criado_em: h(60 * 26), atualizada_em: h(60 * 26), ultima_lead_em: h(60 * 26), ultima_nossa_em: h(60 * 26),
    mensagens: [
      { q: 'lead', t: 'minha agenda não está abrindo', em: h(60 * 26) },
      { q: 'ia', t: 'Oi! Esse número é o comercial da MIMO. Para suporte da sua agenda, fala com a gente em https://wa.me/5513999990002.', em: h(60 * 26) },
    ] },
  { id: 4, telefone: '5513955004444', nome_perfil: null, origem: 'botao', situacao: 'perdido', lugar_id: null, pausada: false, humano_ate: null, cadencia_etapa: 3, avisada_em: null, teste: false,
    dados: { nome: 'Fê', cidade: 'Curitiba', salao: 'Bela Vida', cidade_coberta: false, guia_informado: true }, criado_em: h(60 * 24 * 12), atualizada_em: h(60 * 24 * 4), ultima_lead_em: h(60 * 24 * 11), ultima_nossa_em: h(60 * 24 * 4),
    mensagens: [
      { q: 'lead', t: 'Oi! Quero conhecer a MIMO Agenda.', em: h(60 * 24 * 12) }, { q: 'ia', t: 'Oi! Eu sou a Lia, da MIMO 💗 Me conta: qual é o seu nome, de que cidade você fala e como se chama o seu salão?', em: h(60 * 24 * 12) },
      { q: 'lead', t: 'Fê, Bela Vida, Curitiba', em: h(60 * 24 * 11) }, { q: 'ia', t: 'Prazer, Fê! Quantas profissionais atendem com você?', em: h(60 * 24 * 11) },
      { q: 'ia', t: 'O guia da MIMO ainda não chegou em Curitiba, mas a agenda funciona em qualquer cidade.', em: h(60 * 24 * 11) },
      { q: 'ia', t: 'Oi, Fê! Passando para saber se ficou alguma dúvida sobre a MIMO 💗', em: h(60 * 24 * 10), cadencia: 1 },
      { q: 'ia', t: 'Lembrei de você: os 7 dias grátis continuam valendo quando quiser testar.', em: h(60 * 24 * 8), cadencia: 2 },
      { q: 'ia', t: 'Vou deixar você à vontade por aqui. Quando fizer sentido, é só me chamar.', em: h(60 * 24 * 4), cadencia: 3 },
    ] },
]
const LUGAR = { gl1: { id: 'gl1', nome: 'Studio Lírio', cidade: 'Itanhaém', cidade_slug: 'itanhaem', slug: 'studio-lirio', na_mimo: false }, gl3: { id: 'gl3', nome: 'Ateliê Cabelo & Arte', cidade: 'Itanhaém', cidade_slug: 'itanhaem', slug: 'atelie-cabelo-e-arte', na_mimo: false } }

const publico = () => (CFG.ligado && CFG.numero ? { ligado: true, numero: CFG.numero, nome: CFG.nome } : { ligado: false })
const resumo = (c) => ({
  id: c.id, telefone: c.telefone, nome_perfil: c.nome_perfil, origem: c.origem, situacao: c.situacao, lugar_id: c.lugar_id, lugar_nome: LUGAR[c.lugar_id]?.nome ?? null, lugar_cidade: LUGAR[c.lugar_id]?.cidade ?? null,
  nome: c.dados.nome ?? null, cidade: c.dados.cidade ?? null, salao: c.dados.salao ?? null, autonoma: c.dados.autonoma == null ? null : String(c.dados.autonoma), email: c.dados.email ?? null, interesse: c.dados.interesse ?? null,
  humano_ate: c.humano_ate, pausada: c.pausada, cadencia_etapa: c.cadencia_etapa, avisada_em: c.avisada_em, ultima_lead_em: c.ultima_lead_em, ultima_nossa_em: c.ultima_nossa_em,
  n: c.mensagens.length, ultima: c.mensagens.at(-1)?.t ?? null, ultima_de: c.mensagens.at(-1)?.q ?? null, criado_em: c.criado_em, atualizada_em: c.atualizada_em,
})
function painel({ dias_ = 30 } = {}) {
  const desde = Date.now() - Math.max(1, Math.min(dias_ ?? 30, 365)) * 86400e3
  const lista = CONVERSAS.filter((c) => !c.teste && new Date(c.criado_em).getTime() >= desde)
  const n = (f) => lista.filter(f).length
  return {
    config: { ...CFG }, planos: PLANOS,
    totais: {
      conversas: lista.length, novas: n((c) => c.situacao === 'novo'), conversando: n((c) => c.situacao === 'conversando'), interessadas: n((c) => c.situacao === 'interessada'),
      quer_comecar: n((c) => c.situacao === 'quer_comecar'), clientes: n((c) => c.situacao === 'cliente'), perdidas: n((c) => c.situacao === 'perdido'), sem_interesse: n((c) => c.situacao === 'sem_interesse'),
      no_guia: n((c) => c.lugar_id), com_equipe: n((c) => c.humano_ate && new Date(c.humano_ate) > new Date()), pausadas: n((c) => c.pausada),
      por_origem: lista.reduce((m, c) => ({ ...m, [c.origem]: (m[c.origem] ?? 0) + 1 }), {}),
    },
    conversas: CONVERSAS.filter((c) => !c.teste).sort((a, b) => b.atualizada_em.localeCompare(a.atualizada_em)).map(resumo),
  }
}
const achar = (id) => CONVERSAS.find((c) => c.id === Number(id))
function salvar({ c = {} } = {}) {
  const limpo = (v) => (v == null ? null : String(v).replace(/\D/g, '') || null)
  if (c.cadencia_dias) { const d = c.cadencia_dias.map(Number); if (d.length !== 3 || !(d[0] < d[1] && d[1] < d[2])) throw new Error('cadência: três prazos crescentes, em dias (ex.: 1, 3 e 7)') }
  if (c.ligado && !limpo(c.numero ?? CFG.numero)) throw new Error('para ligar a assistente, informe o número do WhatsApp comercial')
  CFG = { ...CFG, ...c, numero: 'numero' in c ? limpo(c.numero) : CFG.numero, numero_avisos: 'numero_avisos' in c ? limpo(c.numero_avisos) : CFG.numero_avisos,
    suporte_numero: 'suporte_numero' in c ? limpo(c.suporte_numero) : CFG.suporte_numero, encaminhar_numero: 'encaminhar_numero' in c ? limpo(c.encaminhar_numero) : CFG.encaminhar_numero, atualizado_em: new Date().toISOString() }
  return { ...CFG }
}

export const COMERCIAL_RPC = {
  comercial_publico: () => publico(),
  comercial_painel: (a) => painel(a ?? {}),
  comercial_conversa: ({ id_ }) => { const c = achar(id_); return c ? { ...c, lugar: LUGAR[c.lugar_id] ?? null } : null },
  comercial_config_salvar: (a) => salvar(a ?? {}),
  comercial_situacao: ({ id_, situacao_ }) => { const c = achar(id_); if (c) { c.situacao = situacao_; c.atualizada_em = new Date().toISOString() } return null },
  comercial_pausar: ({ id_, pausar_ }) => { const c = achar(id_); if (c) c.pausada = !!pausar_; return null },
  comercial_intervir: ({ id_, minutos_ }) => { const c = achar(id_); if (!c) return null; c.humano_ate = new Date(Date.now() + (minutos_ ?? CFG.silencio_min) * 60e3).toISOString(); return c.humano_ate },
  comercial_reativar: ({ id_ }) => { const c = achar(id_); if (c) { c.humano_ate = null; c.pausada = false } return null },
}

// ---- a função "comercial" (conectar, simular, enviar) ----
let SIM = null
const P = (t) => semAcento(t).replace(/[^a-z0-9@. ]+/g, ' ').replace(/\s+/g, ' ').trim()
const fill = (m, v) => String(m).replace(/\{([a-z_]+)\}/g, (x, k) => (k in v ? String(v[k] ?? '') : x)).trim()
function simular({ texto }) {
  const t = String(texto ?? '').trim()
  const nome = CFG.nome
  if (!SIM) {
    SIM = { dados: {}, n: 0, situacao: 'novo' }
    const primeira = CFG.vendas_ligadas ? CFG.msg_apresentacao : (CFG.msg_vendas_desligadas.includes('{nome}') ? CFG.msg_vendas_desligadas : `Oi! Eu sou a {nome}, da MIMO 💗 ${CFG.msg_vendas_desligadas}`)
    return { ok: true, texto: t, acao: 'apresentou', situacao: 'novo', bolhas: [fill(primeira, { nome })], responder: fill(primeira, { nome }), pausa: CFG.pausa_seg, origem: 'teste' }
  }
  const p = P(t)
  const d = SIM.dados
  const bolhas = []
  let acao = 'conversou', previaAviso = null
  const email = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.exec(t)?.[0]
  if (email) d.email = email.toLowerCase()
  if (/\bitanhaem\b/.test(p) && !d.cidade) d.cidade = 'Itanhaém'
  if (/studio lirio|lirio/.test(p) && !d.salao) d.salao = 'Studio Lírio'
  if (/\bautonoma\b/.test(p)) d.autonoma = true
  if (/\b(sou|me chamo|aqui e|aqui eh)\s+([a-z]+)/.test(p) && !d.nome) { const m = /\b(sou|me chamo|aqui e|aqui eh)\s+(a\s+)?([a-z]+)/.exec(p); d.nome = m[3].charAt(0).toUpperCase() + m[3].slice(1) }
  if (/marcar (um )?horario|quero marcar|agendar (um )?horario/.test(p) && !/minha agenda|meu salao/.test(p)) {
    SIM.situacao = 'sem_interesse'
    return { ok: true, texto: t, acao: 'cliente_final', situacao: SIM.situacao, bolhas: [CFG.msg_cliente_final], responder: CFG.msg_cliente_final, pausa: CFG.pausa_seg }
  }
  // quem já tem agenda na MIMO: pelo que diz, ou pelo nome do salão na cidade (na demo, o Studio Demo Beleza)
  if (/ja uso|ja sou cliente|minha agenda nao|suporte/.test(p) || (/studio demo/.test(p) && /itanhaem|santos/.test(p))) {
    SIM.situacao = 'cliente'
    const m = /studio demo/.test(p) ? fill(CFG.msg_salao_na_mimo, { salao: 'Studio Demo Beleza', suporte: CFG.suporte_numero ? `https://wa.me/${CFG.suporte_numero}` : 'o nosso atendimento' }) : fill(CFG.msg_suporte, { suporte: CFG.suporte_numero ? `https://wa.me/${CFG.suporte_numero}` : 'o nosso atendimento' })
    return { ok: true, texto: t, acao: 'suporte', situacao: SIM.situacao, bolhas: [m], responder: m, pausa: CFG.pausa_seg }
  }
  if (/quero comecar|quero testar|bora|vamos comecar|falar com (uma pessoa|alguem|atendente)/.test(p)) {
    SIM.situacao = 'quer_comecar'
    bolhas.push(d.nome ? `Que ótimo, ${d.nome}!` : 'Que ótimo!')
    const horario = { 'seg-sex': 'de segunda a sexta', 'seg-sab': 'de segunda a sábado', todos: 'todos os dias' }[CFG.equipe_dias] + `, das ${String(CFG.equipe_inicio).slice(0, 2).replace(/^0/, '')}h às ${String(CFG.equipe_fim).slice(0, 2).replace(/^0/, '')}h`
    bolhas.push(fill(CFG.msg_equipe, { horario, encaminhar: CFG.encaminhar_numero ? ` Se preferir, o contato direto da equipe é https://wa.me/${CFG.encaminhar_numero}.` : '' }))
    previaAviso = `💼 Comercial (${nome}): quer começar / testar a MIMO Agenda\nQuem: ${d.nome || 'sem nome ainda'} · (13) 99999-0000\nNegócio: ${d.salao || 'não disse'}${d.cidade ? ` · ${d.cidade}` : ''}\nDisse: “${t}”\nResponder: https://wa.me/5513999990000`
    acao = 'quer_comecar'
  } else if (/quanto custa|preco|valor|plano/.test(p)) {
    bolhas.push(CFG.vendas_ligadas
      ? 'Os planos são por agenda: Autônoma, grátis; MIMO Pro, R$ 49,90 por mês até 3 agendas (mais R$ 9,90 por agenda da 4ª à 10ª); MIMO Pro+, R$ 149,90 até 11. E 7 dias grátis para testar, sem cartão.\n\nQuantas profissionais atendem com você?'
      : fill(CFG.msg_vendas_desligadas, { nome }))
    if (SIM.situacao === 'novo' || SIM.situacao === 'conversando') SIM.situacao = 'interessada'
  } else if (d.email && d.salao && !d.fotos_pedidas) {
    d.fotos_pedidas = true
    bolhas.push(fill(CFG.msg_fotos_enviado, { email: d.email, salao: d.salao }))
  } else if (!d.nome) {
    bolhas.push('Que bom ter você aqui! Como é o seu nome?')
  } else if (!d.cidade || !(d.salao || d.autonoma)) {
    bolhas.push(`Prazer, ${d.nome}! De que cidade você fala, e como se chama o seu salão (ou você atende sozinha)?`)
  } else {
    bolhas.push(`Legal, ${d.nome}! Como as suas clientes marcam hoje: WhatsApp, telefone, agenda de papel?`)
  }
  if (d.cidade && d.salao && !d.guia_informado) {
    d.guia_informado = true
    bolhas.push(fill(CFG.msg_achei_no_guia, { salao: d.salao, link: `https://mimo.com.vc${LINK_LIRIO}` }))
  }
  if (SIM.situacao === 'novo') SIM.situacao = 'conversando'
  SIM.n++
  return { ok: true, texto: t, acao, situacao: SIM.situacao, dados: { ...d }, bolhas, responder: bolhas.join('\n\n'), pausa: CFG.pausa_seg, previaAviso }
}
export function demoComercial(corpo) {
  const acao = corpo?.acao
  if (acao === 'estado') return { instancia: CFG.instancia, numero: CFG.numero, estado: CFG.numero ? ESTADO : 'nao_existe', erro: null, segredos: { evolution: true, webhook: true, groq: true, claude: true } }
  if (acao === 'conectar') { if (!CFG.numero) throw new Error('informe o número do WhatsApp comercial e salve antes de conectar'); ESTADO = 'connecting'; setTimeout(() => { ESTADO = 'open' }, 8000); return { estado: 'connecting', webhook: 'ok', pairingCode: 'MIMO-2180', qr: null } }
  if (acao === 'desconectar') { ESTADO = 'close'; return { ok: true } }
  if (acao === 'simular') return simular(corpo)
  if (acao === 'reiniciar') { SIM = null; return { ok: true } }
  if (acao === 'enviar') {
    const c = achar(corpo.conversa)
    if (!c) throw new Error('conversa não encontrada')
    c.mensagens.push({ q: 'equipe', t: String(corpo.texto ?? ''), em: new Date().toISOString() })
    c.humano_ate = new Date(Date.now() + CFG.silencio_min * 60e3).toISOString(); c.ultima_nossa_em = new Date().toISOString(); c.atualizada_em = c.ultima_nossa_em
    if (c.situacao === 'novo') c.situacao = 'conversando'
    return { ok: true, telefone: c.telefone, humano_ate: c.humano_ate }
  }
  throw new Error('ação desconhecida')
}
