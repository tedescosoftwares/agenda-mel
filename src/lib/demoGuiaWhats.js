// O WhatsApp do guia no modo demonstração (3.48, migração 195): a configuração, os pedidos e as conversas de mentira,
// as RPCs da Plataforma e a função guia-whats (conectar, simular com uma Mel de roteiro, reenviar). O site lê
// guia_contato_config daqui: no demo o recurso nasce ligado, com WhatsApp e Ligar pela MIMO (o "Quero marcar" fica no
// formulário, para a demo dele continuar valendo).

const h = (min) => new Date(Date.now() - min * 60e3).toISOString()

export const ORIENTACAO_PADRAO = `Você é a Mel, assistente da MIMO, um guia de salões de beleza. Quem escreve encontrou o {salao} no guia da MIMO e quer marcar um horário. Você não é o salão: você anota o pedido e passa para o salão, que chama a cliente aqui no WhatsApp para combinar.

Como conversar:
- Na primeira resposta, diga quem você é: que é a Mel, da MIMO, o guia onde ela encontrou o {salao}, e que anota o pedido e passa para o salão, que chama ela aqui no WhatsApp. Com suas palavras, curto.
- Descubra, numa conversa curta e simpática, o nome dela, o serviço que quer e a preferência de dia e horário (pode ser "qualquer dia de manhã"). Uma pergunta por vez. Mensagens curtas, como no WhatsApp.
- Use os dados do salão para dúvidas simples (endereço, bairro, serviços do cadastro, horário de funcionamento). Não invente preço, vaga, promoção nem profissional: diga que o salão confirma.
- Nunca diga que o horário está marcado: quem confirma é o salão.
- Se ela quiser outro salão, peça o nome ou o link da página no guia.
- Português do Brasil, no máximo um emoji por mensagem.`

export const MSG_SALAO_PADRAO = `💗 Novo pedido de atendimento pela MIMO

Cliente: {cliente}
Serviço: {servico}
Preferência: {preferencia}
Observação: {observacao}
Contato: {contato}

Ela encontrou seu salão pela MIMO e quer combinar esse atendimento com você.

👉 Falar com a cliente: {link}

E uma dica: pedidos como esse podem chegar de forma muito mais organizada quando você usa a MIMO como agenda do salão.

Se esse atendimento der certo e você quiser entender como funciona, chama a gente por aqui.

Para não receber mais pedidos pela MIMO, responda SAIR.`

let CFG = {
  id: 1, ligado: true, numero: '5513999990000', instancia: 'mimo-guia', botoes: ['ligar', 'whatsapp'], provedor: 'groq', modelo: null,
  orientacao: ORIENTACAO_PADRAO, msg_cliente: 'Olá! Vi o {salao} no guia da MIMO e quero marcar um horário.', msg_salao: MSG_SALAO_PADRAO,
  msg_salao_resposta: 'Obrigada pelo retorno! 💗 Se quiser receber pedidos assim direto na agenda do salão, com link próprio para as clientes marcarem e lembretes automáticos, responda QUERO que a equipe da MIMO te chama. Para não receber mais pedidos por aqui, responda SAIR.',
  msg_encerramento: 'Tudo bem! 💗 Quando quiser marcar, é só me chamar aqui que eu te ajudo. Até logo!',
  msg_ocioso: 'Oi! Vi que a gente parou por aqui 💗 Quer que eu envie seu pedido ao salão agora, ou prefere continuar depois? Se não puder responder, eu encerro por aqui — é só me chamar quando quiser.',
  numero_avisos: null,
  mostrar_contato_salao: false, exigir_preferencia: false, ocioso_ativo: false, limite_dia: 40, limite_respostas: 30, pos_envio: 3, max_sem_avanco: 6, ocioso_horas: 24, ocioso_perguntar_min: 60, ocioso_encerrar_min: 120, retencao_dias: 90, atualizado_em: h(60 * 24 * 3),
}
let ESTADO = 'open'
const CONVERSAS = [
  { id: 1, telefone: '5513988887777', lugar_id: 'gl1', estado: 'enviado', dados: { nome: 'Ana Paula', servico: 'Progressiva', preferencia: 'sexta-feira à tarde' }, lead_id: 1, teste: false, criada_em: h(95), atualizada_em: h(90),
    mensagens: [
      { q: 'cliente', t: 'Olá! Vi o Studio Lírio no guia da MIMO e quero marcar um horário.\n\n(código: itanhaem/studio-lirio)', em: h(95) },
      { q: 'mel', t: 'Oi! Aqui é a Mel, da MIMO 💗, o guia onde você encontrou o Studio Lírio. Eu anoto seu pedido e passo para o salão, que te chama aqui no WhatsApp. Como é seu nome?', em: h(95) },
      { q: 'cliente', t: 'Ana Paula', em: h(94) }, { q: 'mel', t: 'Prazer, Ana Paula! Qual serviço você quer marcar?', em: h(94) },
      { q: 'cliente', t: 'progressiva, pode ser sexta à tarde', em: h(92) },
      { q: 'mel', t: 'Anotei assim:\n• Nome: Ana Paula\n• Serviço: Progressiva\n• Preferência: sexta-feira à tarde\n\nPosso enviar seu nome, este WhatsApp e o pedido para o Studio Lírio? Eles te chamam aqui para combinar. É só responder *sim*.', em: h(92) },
      { q: 'cliente', t: 'sim', em: h(90) }, { q: 'mel', t: 'Pronto, Ana! 💗 Enviei seu pedido para o Studio Lírio. Eles vão te chamar aqui no WhatsApp para combinar o horário.', em: h(90) },
    ] },
  { id: 2, telefone: '5513977776666', lugar_id: 'gl2', estado: 'conversando', dados: { nome: 'Bia' }, lead_id: null, teste: false, criada_em: h(12), atualizada_em: h(10),
    mensagens: [
      { q: 'cliente', t: 'Olá! Vi o Ateliê Cabelo & Arte no guia da MIMO e quero marcar um horário.\n\n(código: itanhaem/atelie-cabelo-e-arte)', em: h(12) },
      { q: 'mel', t: 'Oi! Aqui é a Mel, da MIMO 💗. Eu anoto seu pedido e passo para o Ateliê Cabelo & Arte, que te chama aqui. Como é seu nome?', em: h(12) },
      { q: 'cliente', t: 'Bia', em: h(10) }, { q: 'mel', t: 'Prazer, Bia! Qual serviço você quer marcar?', em: h(10) },
    ] },
  { id: 3, telefone: '5513966665555', lugar_id: 'gl1', estado: 'enviado', dados: { nome: 'Carla', servico: 'Manicure e pedicure', preferencia: 'sábado de manhã', observacao: 'prefere a Rô' }, lead_id: 2, teste: false, criada_em: h(60 * 26), atualizada_em: h(60 * 25),
    mensagens: [{ q: 'cliente', t: 'Olá! Vi o Studio Lírio no guia da MIMO e quero marcar um horário.\n\n(código: itanhaem/studio-lirio)', em: h(60 * 26) }, { q: 'mel', t: 'Oi! Aqui é a Mel, da MIMO 💗. Como é seu nome?', em: h(60 * 26) }, { q: 'cliente', t: 'Carla, manicure e pedicure, sábado de manhã, se puder com a Rô', em: h(60 * 25) }, { q: 'mel', t: 'Anotei assim:\n• Nome: Carla\n• Serviço: Manicure e pedicure\n• Preferência: sábado de manhã\n• Observação: prefere a Rô\n\nPosso enviar para o Studio Lírio? É só responder *sim*.', em: h(60 * 25) }, { q: 'cliente', t: 'sim', em: h(60 * 25) }, { q: 'mel', t: 'Pronto, Carla! 💗 Enviei seu pedido para o Studio Lírio.', em: h(60 * 25) }] },
]
const LEADS = [
  { id: 1, conversa_id: 1, lugar_id: 'gl1', salao_nome: 'Studio Lírio', cidade: 'Itanhaém', cliente_nome: 'Ana Paula', cliente_tel: '5513988887777', servico: 'Progressiva', preferencia: 'sexta-feira à tarde', observacao: null, salao_tel: '5513990001101', status: 'salao_quer_conhecer', erro: null, enviado_em: h(90), salao_respondeu_em: h(40), resposta_salao: 'Obrigada! Vou chamar ela.\nQUERO', atendido: false, criado_em: h(90), token: 'demotoken1', cliques: 2, clicou_em: h(88), salao_mensagens: [{ em: h(40), texto: 'Oi! Pode marcar sim, que horário ela prefere?' }, { em: h(38), texto: 'QUERO conhecer a MIMO' }] },
  { id: 2, conversa_id: 3, lugar_id: 'gl1', salao_nome: 'Studio Lírio', cidade: 'Itanhaém', cliente_nome: 'Carla', cliente_tel: '5513966665555', servico: 'Manicure e pedicure', preferencia: 'sábado de manhã', observacao: 'prefere a Rô', salao_tel: '5513990001101', status: 'salao_respondeu', erro: null, enviado_em: h(60 * 25), salao_respondeu_em: h(60 * 24), resposta_salao: 'Recebido, obrigada', atendido: true, criado_em: h(60 * 25), token: 'demotoken2', cliques: 1, clicou_em: h(60 * 20), salao_mensagens: [{ em: h(60 * 18), texto: 'Recebido, vou chamar a Carla agora.' }] },
  { id: 3, conversa_id: null, lugar_id: 'gl2', salao_nome: 'Ateliê Cabelo & Arte', cidade: 'Itanhaém', cliente_nome: 'Dani', cliente_tel: '5513955554444', servico: 'Corte e escova', preferencia: 'quinta à noite', observacao: null, salao_tel: '5513990002202', status: 'falhou', erro: 'Connection Closed', enviado_em: null, salao_respondeu_em: null, resposta_salao: null, atendido: false, criado_em: h(60 * 49), token: 'demotoken3', cliques: 0, clicou_em: null, salao_mensagens: [] },
  { id: 4, conversa_id: null, lugar_id: null, salao_nome: 'Espaço Bela Praia', cidade: 'Mongaguá', cliente_nome: 'Eva', cliente_tel: '5513944443333', servico: 'Design de sobrancelha', preferencia: 'qualquer dia de manhã', observacao: null, salao_tel: null, status: 'sem_contato', erro: null, enviado_em: null, salao_respondeu_em: null, resposta_salao: null, atendido: false, criado_em: h(60 * 70), token: 'demotoken4', cliques: 0, clicou_em: null, salao_mensagens: [] },
]
const publico = () => (CFG.ligado && CFG.numero ? { ligado: true, numero: CFG.numero, botoes: CFG.botoes, msg_cliente: CFG.msg_cliente } : { ligado: false })
export const demoContatoConfig = publico

const SALOES = { gl1: ['Studio Lírio', 'Itanhaém'], gl2: ['Ateliê Cabelo & Arte', 'Itanhaém'] }
function painel({ dias_ = 7 } = {}) {
  const desde = Date.now() - Math.max(1, Math.min(dias_ ?? 7, 90)) * 86400e3
  const pedidos = LEADS.filter((l) => new Date(l.criado_em).getTime() >= desde)
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  return {
    config: { ...CFG },
    totais: {
      conversas: CONVERSAS.filter((c) => !c.teste && new Date(c.criada_em).getTime() >= desde).length,
      pedidos: pedidos.length, enviados: pedidos.filter((l) => l.enviado_em).length,
      falhas: pedidos.filter((l) => ['falhou', 'fora_do_limite'].includes(l.status)).length,
      sem_contato: pedidos.filter((l) => l.status === 'sem_contato').length,
      responderam: pedidos.filter((l) => l.salao_respondeu_em).length, querem: pedidos.filter((l) => l.status === 'salao_quer_conhecer').length,
      abriram: pedidos.filter((l) => l.clicou_em).length,
      enviados_hoje: LEADS.filter((l) => l.enviado_em && new Date(l.enviado_em) >= hoje).length, saloes_sairam: 0,
    },
    pedidos: [...pedidos].sort((a, b) => b.criado_em.localeCompare(a.criado_em)),
    conversas: CONVERSAS.filter((c) => !c.teste && new Date(c.atualizada_em).getTime() >= desde).map((c) => ({ id: c.id, telefone: c.telefone, estado: c.estado, atualizada_em: c.atualizada_em, criada_em: c.criada_em, lead_id: c.lead_id, salao: SALOES[c.lugar_id]?.[0] ?? null, cidade: SALOES[c.lugar_id]?.[1] ?? null, n: c.mensagens.length, ultima: c.mensagens.at(-1)?.t ?? null })).sort((a, b) => b.atualizada_em.localeCompare(a.atualizada_em)),
  }
}
function salvar({ c }) {
  const n = { ...CFG }
  if (c.numero !== undefined) { let d = String(c.numero ?? '').replace(/\D/g, ''); if (d.length === 10 || d.length === 11) d = '55' + d; if (d && !/^[1-9][0-9]{9,14}$/.test(d)) throw new Error('número inválido: use DDD e número (com 55 na frente, se quiser)'); n.numero = d || null }
  if (c.numero_avisos !== undefined) { let d = String(c.numero_avisos ?? '').replace(/\D/g, ''); if (d.length === 10 || d.length === 11) d = '55' + d; if (d && !/^[1-9][0-9]{9,14}$/.test(d)) throw new Error('número de avisos inválido: use DDD e número (com 55 na frente, se quiser)'); n.numero_avisos = d || null }
  for (const k of ['ligado', 'mostrar_contato_salao', 'exigir_preferencia', 'ocioso_ativo']) if (typeof c[k] === 'boolean') n[k] = c[k]
  for (const k of ['instancia', 'provedor', 'orientacao', 'msg_cliente', 'msg_salao', 'msg_salao_resposta', 'msg_encerramento', 'msg_ocioso']) if (typeof c[k] === 'string' && c[k].trim()) n[k] = c[k].trim()
  if (c.modelo !== undefined) n.modelo = String(c.modelo ?? '').trim() || null
  if (Array.isArray(c.botoes)) n.botoes = [...new Set(c.botoes.filter((b) => ['whatsapp', 'ligar', 'quero_marcar'].includes(b)))].sort()
  if (c.limite_dia !== undefined) { const v = Number(c.limite_dia); if (!(v >= 1 && v <= 1000)) throw new Error('limite por dia: de 1 a 1000'); n.limite_dia = v }
  if (c.limite_respostas !== undefined) { const v = Number(c.limite_respostas); if (!(v >= 1 && v <= 500)) throw new Error('respostas por número por dia: de 1 a 500'); n.limite_respostas = v }
  if (c.pos_envio !== undefined) { const v = Number(c.pos_envio); if (!(v >= 0 && v <= 20)) throw new Error('dúvidas depois do envio: de 0 a 20'); n.pos_envio = v }
  if (c.max_sem_avanco !== undefined) { const v = Number(c.max_sem_avanco); if (!(v >= 2 && v <= 50)) throw new Error('mensagens sem avançar antes de encerrar: de 2 a 50'); n.max_sem_avanco = v }
  if (c.ocioso_horas !== undefined) { const v = Number(c.ocioso_horas); if (!(v >= 1 && v <= 168)) throw new Error('horas para esquecer a conversa parada: de 1 a 168'); n.ocioso_horas = v }
  if (c.ocioso_perguntar_min !== undefined) { const v = Number(c.ocioso_perguntar_min); if (!(v >= 5 && v <= 10080)) throw new Error('minutos parada antes de perguntar: de 5 a 10080'); n.ocioso_perguntar_min = v }
  if (c.ocioso_encerrar_min !== undefined) { const v = Number(c.ocioso_encerrar_min); if (!(v >= 5 && v <= 10080)) throw new Error('minutos desde a pergunta antes de encerrar: de 5 a 10080'); n.ocioso_encerrar_min = v }
  if (c.retencao_dias !== undefined) { const v = Number(c.retencao_dias); if (!(v >= 7 && v <= 730)) throw new Error('guardar as conversas: de 7 a 730 dias'); n.retencao_dias = v }
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(n.instancia)) throw new Error('instância inválida: letras minúsculas, números, - e _ (2 a 40)')
  if (n.ligado && !n.numero) { n.ligado = false; CFG = { ...n, atualizado_em: new Date().toISOString() }; throw new Error('para ligar, informe o número do WhatsApp do guia') }
  CFG = { ...n, atualizado_em: new Date().toISOString() }
  return { ...CFG }
}

export const GUIA_WHATS_RPC = {
  guia_contato_config: () => publico(),
  guia_whats_painel: (a) => painel(a ?? {}),
  guia_whats_lead_do_salao: ({ token_ }) => { const l = LEADS.find((x) => x.token === token_); return l ? l.id : null },
  guia_whats_clique: ({ token_ }) => { const l = LEADS.find((x) => x.token === token_); if (!l) return { ok: false }; l.cliques = (l.cliques ?? 0) + 1; l.clicou_em = l.clicou_em ?? new Date().toISOString(); return { ok: true, cliente_tel: l.cliente_tel, cliente_nome: l.cliente_nome, salao: l.salao_nome, servico: l.servico } },
  guia_whats_salvar: (a) => salvar(a ?? { c: {} }),
  guia_whats_lead_atendido: ({ id_, atendido_ }) => { const l = LEADS.find((x) => x.id === id_); if (l) l.atendido = atendido_ !== false; return null },
  guia_whats_conversa: ({ id_ }) => { const c = CONVERSAS.find((x) => x.id === id_); return c ? { ...c, salao: SALOES[c.lugar_id]?.[0] ?? null, cidade: SALOES[c.lugar_id]?.[1] ?? null } : null },
}

// ---- a função guia-whats no demo -------------------------------------------------------------------------------------
const preencher = (modelo, valores) => String(modelo ?? '').split('\n').filter((linha) => !/\{([a-z_]+)\}/.test(linha) || linha.replace(/\{([a-z_]+)\}/g, (x, k) => (k in valores ? String(valores[k] ?? '').trim() : x)).trim().split(':').slice(1).join(':').trim() !== '')
  .map((linha) => linha.replace(/\{([a-z_]+)\}/g, (x, k) => (k in valores ? String(valores[k] ?? '').trim() : x))).join('\n').replace(/\n{3,}/g, '\n\n').trim()
const bonito = (d) => `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`
let SIM = null // a conversa do simulador: { lugar, dados, estado, mensagens }
function simular({ texto, lugar }) {
  const inicio = !texto && lugar
  const NOMES0 = { 'studio-lirio': 'Studio Lírio', 'atelie-cabelo-e-arte': 'Ateliê Cabelo & Arte' }
  const nome0 = inicio ? (lugar.nome && lugar.nome !== lugar.slug ? lugar.nome : (NOMES0[lugar.slug] ?? lugar.nome ?? lugar.slug)) : ''
  const msg = inicio ? `${CFG.msg_cliente.replaceAll('{salao}', nome0)}\n\n(código: ${lugar.cidade_slug}/${lugar.slug})` : String(texto ?? '')
  // o nome do salão: o que veio; se veio só o slug, o nome do demo (no banco de verdade a função lê o salão)
  const NOMES = { 'studio-lirio': 'Studio Lírio', 'atelie-cabelo-e-arte': 'Ateliê Cabelo & Arte' }
  const l = lugar ? { ...lugar, nome: lugar.nome && lugar.nome !== lugar.slug ? lugar.nome : (NOMES[lugar.slug] ?? lugar.nome ?? lugar.slug) } : null
  if (inicio || !SIM) SIM = { lugar: l ?? SIM?.lugar ?? { nome: 'Studio Lírio', cidade_slug: 'itanhaem', slug: 'studio-lirio' }, dados: {}, estado: 'conversando', mensagens: [] }
  const s = SIM
  const t = msg.trim()
  s.mensagens.push({ q: 'cliente', t })
  let resposta, acao = 'conversa', previaSalao = null
  const resumo = () => `Anotei assim:\n• Nome: ${s.dados.nome}\n• Serviço: ${s.dados.servico}${s.dados.preferencia ? `\n• Preferência: ${s.dados.preferencia}` : ''}\n\nPosso enviar seu nome, este WhatsApp e o pedido para o ${s.lugar.nome}? Eles te chamam aqui para combinar. É só responder *sim*.`
  if (/\(código:/.test(t) || s.mensagens.length === 1) { resposta = `Oi! Aqui é a Mel, da MIMO 💗, o guia onde você encontrou o ${s.lugar.nome}. Eu anoto seu pedido e passo para o salão, que te chama aqui no WhatsApp. Como é seu nome?` }
  else if (s.estado === 'confirmando' && /^(sim|pode|ok|isso|claro)\b/i.test(t)) {
    s.estado = 'enviado'; acao = 'enviado_teste'
    previaSalao = preencher(CFG.msg_salao, { salao: s.lugar.nome, cliente: s.dados.nome, servico: s.dados.servico, preferencia: s.dados.preferencia, observacao: '', contato: bonito('5513999990000'), link: 'https://mimo.com.vc/r/demotoken-previa' })
    resposta = `Pronto, ${s.dados.nome.split(' ')[0]}! 💗 Enviei seu pedido para o ${s.lugar.nome}. Eles vão te chamar aqui no WhatsApp para combinar o horário.`
  } else if (s.estado === 'enviado') { resposta = 'Seu pedido já foi para o salão, que vai te chamar aqui. Posso ajudar em mais alguma coisa?' }
  else if (!s.dados.nome) { s.dados.nome = t.slice(0, 60); resposta = `Prazer, ${s.dados.nome}! Qual serviço você quer marcar?` }
  else if (!s.dados.servico) {
    s.dados.servico = t.slice(0, 80)
    // o essencial para enviar: nome e serviço; só pede a preferência se a Plataforma exigir (exigir_preferencia)
    if (CFG.exigir_preferencia) { resposta = 'E qual a sua preferência de dia e horário? Pode ser algo como "sexta à tarde" ou "qualquer dia de manhã".' }
    else { s.estado = 'confirmando'; acao = 'resumo'; resposta = resumo() }
  }
  else { s.dados.preferencia = t.slice(0, 80); s.estado = 'confirmando'; acao = 'resumo'; resposta = resumo() }
  s.mensagens.push({ q: 'mel', t: resposta })
  return { ok: true, texto: t, responder: resposta, acao, previaSalao, estado: s.estado, dados: { ...s.dados } }
}

export function demoGuiaWhats(corpo) {
  const acao = corpo?.acao
  if (acao === 'estado') return { instancia: CFG.instancia, numero: CFG.numero, estado: CFG.numero ? ESTADO : 'nao_existe', erro: null, segredos: { evolution: true, webhook: true, groq: true, claude: false } }
  if (acao === 'conectar') { if (!CFG.numero) throw new Error('informe o número do WhatsApp do guia e salve antes de conectar'); ESTADO = 'connecting'; setTimeout(() => { ESTADO = 'open' }, 8000); return { estado: 'connecting', webhook: 'ok', erro: null, pairingCode: 'MIMO-GUIA', qr: null } }
  if (acao === 'desconectar') { ESTADO = 'close'; return { ok: true } }
  if (acao === 'simular') return simular(corpo)
  if (acao === 'reiniciar') { SIM = null; return { ok: true } }
  if (acao === 'reenviar') { const l = LEADS.find((x) => x.id === Number(corpo.lead)); if (!l || !l.salao_tel) throw new Error('não dá para reenviar: o salão pediu para não receber ou não tem WhatsApp'); l.status = 'enviado'; l.erro = null; l.enviado_em = new Date().toISOString(); return { ok: true } }
  throw new Error('ação desconhecida')
}
