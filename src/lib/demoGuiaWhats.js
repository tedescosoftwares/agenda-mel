// O WhatsApp do guia no modo demonstração (3.48, migração 195): a configuração, os pedidos e as conversas de mentira,
// as RPCs da Plataforma e a função guia-whats (conectar, simular com uma Mel de roteiro, reenviar). O site lê
// guia_contato_config daqui: no demo o recurso nasce ligado, com WhatsApp e Ligar pela MIMO (o "Quero marcar" fica no
// formulário, para a demo dele continuar valendo).

import { simularOnboarding, reiniciarOnboarding } from './demoGuiaOnboarding'
import { GUIA_LUGARES } from './demoGuia.js'
import { COMERCIAL_RPC } from './demoComercial'

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

// 3.76 (migração 221): quem pergunta da MIMO Agenda vai para o comercial (os textos padrão são os do banco)
const MSG_SOBRE_AGENDA = 'Esse número é o da Mel, para clientes que marcam horário pelos salões do guia 💗 Para saber da MIMO Agenda (como funciona, os planos, como colocar o seu salão), quem atende é a {nome}, no WhatsApp comercial da MIMO: {link}\n\n{marcar}'
const MSG_SOBRE_AGENDA_SITE = 'Esse número é o da Mel, para clientes que marcam horário pelos salões do guia 💗 Para saber da MIMO Agenda (como funciona, os planos, como colocar o seu salão), é por aqui: {link}\n\n{marcar}'
// as frases óbvias (a regra de verdade, mais completa, está em supabase/functions/_shared/guia_whats.ts, SOBRE_AGENDA)
const SOBRE_AGENDA = /\bmimo agenda\b|\bsistema (?:da |de |do )?(?:mimo|voces|agendamento|agenda)\b|\bquanto custa (?:a |o )?(?:mimo|sistema|plano)\b|\b(?:sou|eu sou) (?:a |o )?(?:dona|dono) (?:de|do|da|desse|deste)\b|\btenho (?:um |uma )?(?:salao|studio|estudio|barbearia|esmalteria)\b|\b(?:cadastrar|colocar|incluir) (?:o |a )?(?:meu|minha|nosso|nossa) (?:salao|studio|estudio|barbearia|esmalteria)\b|\bsou (?:manicure|cabeleireira|cabeleireiro|esteticista|autonoma)\b|\bparceria\b/
const palavraDemo = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

let CFG = {
  id: 1, ligado: true, numero: '5513999990000', instancia: 'mimo-guia', botoes: ['ligar', 'whatsapp'], provedor: 'groq', modelo: null,
  orientacao: ORIENTACAO_PADRAO, msg_cliente: 'Olá! Vi o {salao} no guia da MIMO e quero marcar um horário.', msg_salao: MSG_SALAO_PADRAO,
  msg_salao_resposta: 'Obrigada pelo retorno! 💗 Se quiser receber pedidos assim direto na agenda do salão, com link próprio para as clientes marcarem e lembretes automáticos, responda QUERO que a equipe da MIMO te chama. Para não receber mais pedidos por aqui, responda SAIR.',
  msg_encerramento: 'Tudo bem! 💗 Quando quiser marcar, é só me chamar aqui que eu te ajudo. Até logo!',
  msg_ocioso: 'Oi! Vi que a gente parou por aqui 💗 Quer que eu envie seu pedido ao salão agora, ou prefere continuar depois? Se não puder responder, eu encerro por aqui — é só me chamar quando quiser.',
  msg_dona: 'Oi! 💗 Esse número é o mesmo que o {salao} tem cadastrado no guia da MIMO — então acho que é você, do salão! Quando uma cliente te encontra no guia e pede horário, chega assim pra você:\n\n{exemplo}\n\nA MIMO leva clientes até você, de graça. E tem a MIMO Agenda pra organizar tudo, com link pras clientes marcarem sozinhas (salão e autônoma). Nossa equipe vai te chamar pra mostrar. 💗',
  numero_avisos: '5513999991111',
  sobre_agenda: true, msg_sobre_agenda: MSG_SOBRE_AGENDA, msg_sobre_agenda_site: MSG_SOBRE_AGENDA_SITE,
  // 3.77 (migração 222): o resgate da cliente e o relógio da VPS
  resgate_min: 30, resgate_inicio: '08:00:00', resgate_fim: '21:00:00', resgate_opcoes: 3,
  msg_resgate: 'Oi, {nome}! O {salao} ainda não respondeu o seu pedido 😕\n\n{opcoes}\n\nSe preferir esperar o {salao}, é só me dizer 💗', relogio_em: h(3),
  // 3.57: o retorno do salão (migração 205)
  enquete_ativa: true, enquete_pergunta: 'Vai atender a {cliente}?', enquete_sim: 'Sim, vou atender', enquete_nao: 'Não vou conseguir',
  msg_salao_vai_atender: 'Combinado! 💗 A {cliente} está esperando seu contato: {link}\n\nSe no fim não for conseguir atender, é só me avisar por aqui.',
  msg_salao_nao_atende: 'Tudo bem, obrigada por avisar! 💗 Eu aviso a {cliente}. Os próximos pedidos continuam chegando por aqui; para não receber mais, responda SAIR.',
  avisar_cliente_nao: true, msg_cliente_nao_atende: 'Oi, {nome}! O {salao} não vai conseguir te atender agora 😕\n\n{opcoes}',
  aviso_nao_atende: true, msg_aviso_nao_atende: '❌ MIMO — salão não vai atender\n{salao} · {cidade} respondeu que não vai atender.\nCliente: {cliente} ({contato})\nPedido: {servico} · {preferencia}',
  aviso_demora_min: 120, msg_aviso_demora: '⏳ MIMO — salão sem resposta\n{salao} · {cidade} recebeu o pedido há {tempo} e ainda não abriu o link nem respondeu.\nCliente: {cliente} ({contato})\nPedido: {servico} · {preferencia}',
  cutucar_salao_min: 0, msg_cutucar_salao: 'Oi! A {cliente} ainda está esperando seu retorno sobre {servico} 💗 Vai dar pra atender? É só tocar no link: {link}',
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
  { id: 2, telefone: '5513977776666', lugar_id: 'gl3', estado: 'conversando', dados: { nome: 'Bia' }, lead_id: null, teste: false, criada_em: h(12), atualizada_em: h(10),
    mensagens: [
      { q: 'cliente', t: 'Olá! Vi o Ateliê Cabelo & Arte no guia da MIMO e quero marcar um horário.\n\n(código: itanhaem/atelie-cabelo-e-arte)', em: h(12) },
      { q: 'mel', t: 'Oi! Aqui é a Mel, da MIMO 💗. Eu anoto seu pedido e passo para o Ateliê Cabelo & Arte, que te chama aqui. Como é seu nome?', em: h(12) },
      { q: 'cliente', t: 'Bia', em: h(10) }, { q: 'mel', t: 'Prazer, Bia! Qual serviço você quer marcar?', em: h(10) },
    ] },
  { id: 3, telefone: '5513966665555', lugar_id: 'gl1', estado: 'enviado', dados: { nome: 'Carla', servico: 'Manicure e pedicure', preferencia: 'sábado de manhã', observacao: 'prefere a Rô' }, lead_id: 2, teste: false, criada_em: h(60 * 26), atualizada_em: h(60 * 25),
    mensagens: [{ q: 'cliente', t: 'Olá! Vi o Studio Lírio no guia da MIMO e quero marcar um horário.\n\n(código: itanhaem/studio-lirio)', em: h(60 * 26) }, { q: 'mel', t: 'Oi! Aqui é a Mel, da MIMO 💗. Como é seu nome?', em: h(60 * 26) }, { q: 'cliente', t: 'Carla, manicure e pedicure, sábado de manhã, se puder com a Rô', em: h(60 * 25) }, { q: 'mel', t: 'Anotei assim:\n• Nome: Carla\n• Serviço: Manicure e pedicure\n• Preferência: sábado de manhã\n• Observação: prefere a Rô\n\nPosso enviar para o Studio Lírio? É só responder *sim*.', em: h(60 * 25) }, { q: 'cliente', t: 'sim', em: h(60 * 25) }, { q: 'mel', t: 'Pronto, Carla! 💗 Enviei seu pedido para o Studio Lírio.', em: h(60 * 25) }] },
]
const LEADS = [
  { id: 1, conversa_id: 1, lugar_id: 'gl1', salao_nome: 'Studio Lírio', cidade: 'Itanhaém', cliente_nome: 'Ana Paula', cliente_tel: '5513988887777', servico: 'Progressiva', preferencia: 'sexta-feira à tarde', observacao: null, salao_tel: '5513990001101', status: 'salao_quer_conhecer', erro: null, enviado_em: h(90), salao_respondeu_em: h(40), resposta_salao: 'Obrigada! Vou chamar ela.\nQUERO', atendido: false, criado_em: h(90), token: 'demotoken1', cliques: 2, clicou_em: h(88), salao_mensagens: [{ em: h(40), texto: 'Oi! Pode marcar sim, que horário ela prefere?' }, { em: h(38), texto: 'QUERO conhecer a MIMO' }],
    com_enquete: true, voto: 'sim', voto_origem: 'enquete', votou_em: h(87), voto_atual: 'sim', voto_mudou_em: null, aviso_demora_em: null, cutucado_em: null },
  { id: 2, conversa_id: 3, lugar_id: 'gl1', salao_nome: 'Studio Lírio', cidade: 'Itanhaém', cliente_nome: 'Carla', cliente_tel: '5513966665555', servico: 'Manicure e pedicure', preferencia: 'sábado de manhã', observacao: 'prefere a Rô', salao_tel: '5513990001101', status: 'salao_vai_atender', erro: null, enviado_em: h(60 * 25), salao_respondeu_em: h(60 * 24), resposta_salao: 'Recebido, obrigada', atendido: true, criado_em: h(60 * 25), token: 'demotoken2', cliques: 1, clicou_em: h(60 * 20), salao_mensagens: [{ em: h(60 * 18), texto: 'Recebido, vou chamar a Carla agora.' }],
    com_enquete: true, voto: 'sim', voto_origem: 'texto', votou_em: h(60 * 18), voto_atual: 'nao', voto_mudou_em: h(60 * 10), aviso_demora_em: null, cutucado_em: null },
  { id: 3, conversa_id: null, lugar_id: 'gl3', salao_nome: 'Ateliê Cabelo & Arte', cidade: 'Itanhaém', cliente_nome: 'Dani', cliente_tel: '5513955554444', servico: 'Corte e escova', preferencia: 'quinta à noite', observacao: null, salao_tel: '5513990002202', status: 'falhou', erro: 'Connection Closed', enviado_em: null, salao_respondeu_em: null, resposta_salao: null, atendido: false, criado_em: h(60 * 49), token: 'demotoken3', cliques: 0, clicou_em: null, salao_mensagens: [], com_enquete: false, voto: null },
  { id: 4, conversa_id: null, lugar_id: null, salao_nome: 'Espaço Bela Praia', cidade: 'Mongaguá', cliente_nome: 'Eva', cliente_tel: '5513944443333', servico: 'Design de sobrancelha', preferencia: 'qualquer dia de manhã', observacao: null, salao_tel: null, status: 'sem_contato', erro: null, enviado_em: null, salao_respondeu_em: null, resposta_salao: null, atendido: false, criado_em: h(60 * 70), token: 'demotoken4', cliques: 0, clicou_em: null, salao_mensagens: [], com_enquete: false, voto: null },
  // 3.57: o salão disse não (pela enquete): a equipe foi avisada e a cliente recebeu a oferta de outro salão
  { id: 5, conversa_id: null, lugar_id: 'gl3', salao_nome: 'Ateliê Cabelo & Arte', cidade: 'Itanhaém', cliente_nome: 'Fernanda', cliente_tel: '5513933332222', servico: 'Coloração', preferencia: 'sábado', observacao: null, salao_tel: '5513990002202', status: 'salao_nao_atende', erro: null, enviado_em: h(60 * 5), salao_respondeu_em: h(60 * 4), resposta_salao: null, atendido: false, criado_em: h(60 * 5), token: 'demotoken5', cliques: 1, clicou_em: h(60 * 4 + 30), salao_mensagens: [],
    com_enquete: true, voto: 'nao', voto_origem: 'enquete', votou_em: h(60 * 4), voto_atual: 'nao', voto_mudou_em: null, aviso_demora_em: null, cutucado_em: null },
  // e um pedido parado: enviado há 3 h, sem clique, sem voto, sem resposta — o relógio avisou a equipe
  { id: 6, conversa_id: null, lugar_id: 'gl1', salao_nome: 'Studio Lírio', cidade: 'Itanhaém', cliente_nome: 'Gabi', cliente_tel: '5513922221111', servico: 'Escova', preferencia: 'hoje à tarde', observacao: null, salao_tel: '5513990001101', status: 'enviado', erro: null, enviado_em: h(180), salao_respondeu_em: null, resposta_salao: null, atendido: false, criado_em: h(180), token: 'demotoken6', cliques: 0, clicou_em: null, salao_mensagens: [],
    com_enquete: true, voto: null, voto_origem: null, votou_em: null, voto_atual: null, voto_mudou_em: null, aviso_demora_em: h(60), cutucado_em: null,
    // 3.77: a Mel ofereceu outros salões à Gabi, que escolheu o Ateliê (pedido 7)
    resgate_em: h(150), resgate_motivo: 'demora', resgate_opcoes: [{ id: 'gl3', nome: 'Ateliê Cabelo & Arte', bairro: 'Centro', km: 0.8, agendar: null }, { id: 'gl2', nome: 'Espaço Bela', bairro: 'Belas Artes', km: 2.4, agendar: null }] },
  { id: 7, conversa_id: null, lugar_id: 'gl3', salao_nome: 'Ateliê Cabelo & Arte', cidade: 'Itanhaém', cliente_nome: 'Gabi', cliente_tel: '5513922221111', servico: 'Escova', preferencia: 'hoje à tarde', observacao: null, salao_tel: '5513990002202', status: 'salao_vai_atender', erro: null, enviado_em: h(140), salao_respondeu_em: h(120), resposta_salao: null, atendido: false, criado_em: h(141), token: 'demotoken7', cliques: 1, clicou_em: h(125), salao_mensagens: [],
    com_enquete: true, voto: 'sim', voto_origem: 'enquete', votou_em: h(120), voto_atual: 'sim', voto_mudou_em: null, aviso_demora_em: null, cutucado_em: null, resgate_de: 6 },
]
// 3.59: a fila de abordagem (demoAbordagem) lê os pedidos daqui para os sinais da Mel
export const GUIA_WHATS_LEADS = LEADS
const semDono = (l) => ['sem_contato', 'falhou', 'salao_saiu', 'fora_do_limite', 'salao_nao_atende'].includes(l.status) || l.voto === 'nao'
  || (l.status === 'enviado' && !l.voto && !l.clicou_em && !l.salao_respondeu_em && l.enviado_em && Date.now() - new Date(l.enviado_em).getTime() > 24 * 3600e3)
const MOTIVO = (l) => (l.status === 'salao_nao_atende' || l.voto === 'nao' ? 'o salão disse que não vai atender' : l.status === 'sem_contato' ? 'o salão não tem WhatsApp' : l.status === 'falhou' ? 'o envio não saiu'
  : l.status === 'salao_saiu' ? 'o salão pediu SAIR' : l.status === 'fora_do_limite' ? 'fora do limite do dia' : 'sem resposta do salão há mais de 24 h')
// as clientes que pediram (por telefone), como guia_whats_clientes (206)
function clientes({ dias_ = 30 } = {}) {
  const desde = Date.now() - Math.max(1, Math.min(dias_ ?? 30, 365)) * 86400e3
  const por = new Map()
  for (const l of LEADS.filter((x) => new Date(x.criado_em).getTime() >= desde).sort((a, b) => b.criado_em.localeCompare(a.criado_em))) {
    const c = por.get(l.cliente_tel) ?? { chave: l.cliente_tel, nome: l.cliente_nome, telefone: l.cliente_tel, pedidos: 0, saloes: [], saloes_n: 0, ultimo: l.criado_em, servico: l.servico, atendida: false, recusados: 0, aguardando: 0, sem_dono: 0, abriram: false }
    c.pedidos++
    if (!c.saloes.some((s) => s.nome === l.salao_nome)) c.saloes.push({ nome: l.salao_nome, cidade: l.cidade })
    c.saloes_n = c.saloes.length
    if (l.voto === 'sim' || l.status === 'salao_vai_atender') c.atendida = true
    if (l.voto === 'nao' || l.status === 'salao_nao_atende') c.recusados++
    if (l.status === 'enviado' && !l.voto && !l.clicou_em && !l.salao_respondeu_em && Date.now() - new Date(l.enviado_em).getTime() <= 24 * 3600e3) c.aguardando++
    if (semDono(l)) c.sem_dono++
    if (l.clicou_em) c.abriram = true
    por.set(l.cliente_tel, c)
  }
  return [...por.values()].sort((a, b) => b.pedidos - a.pedidos || b.ultimo.localeCompare(a.ultimo))
}
// a demanda sem dono por bairro, como guia_demanda_sem_dono (206)
function demandaSemDono({ dias_ = 30, cidade_ = null } = {}) {
  const n = Math.max(1, Math.min(dias_ ?? 30, 365))
  const desde = Date.now() - n * 86400e3
  const sd = LEADS.filter((l) => new Date(l.criado_em).getTime() >= desde && semDono(l)).map((l) => {
    const lg = GUIA_LUGARES.find((x) => x.id === l.lugar_id)
    return { ...l, bairro: lg?.bairro ?? 'sem bairro', cidade: lg?.cidade ?? l.cidade, cidade_slug: lg?.cidade_slug ?? null, motivo: MOTIVO(l) }
  }).filter((l) => !cidade_ || l.cidade_slug === cidade_)
  const grupos = new Map()
  for (const l of sd) {
    const k = `${l.cidade}|${l.bairro}`
    const g = grupos.get(k) ?? { bairro: l.bairro, cidade: l.cidade, clientes: new Set(), pedidos: 0, saloes: new Set(), servicos: {} }
    g.clientes.add(l.cliente_tel); g.pedidos++; g.saloes.add(l.lugar_id); if (l.servico) g.servicos[l.servico] = (g.servicos[l.servico] ?? 0) + 1
    grupos.set(k, g)
  }
  return {
    dias: n, cidade: cidade_ || null, pedidos_n: sd.length, clientes_n: new Set(sd.map((l) => l.cliente_tel)).size,
    por_bairro: [...grupos.values()].map((g) => ({ bairro: g.bairro, cidade: g.cidade, clientes: g.clientes.size, pedidos: g.pedidos, saloes: g.saloes.size, servicos: Object.entries(g.servicos).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s).join(', ') || null })).sort((a, b) => b.clientes - a.clientes || b.pedidos - a.pedidos),
    pedidos: sd.sort((a, b) => b.criado_em.localeCompare(a.criado_em)).slice(0, 40).map((l) => ({ id: l.id, cliente_nome: l.cliente_nome, cliente_tel: l.cliente_tel, servico: l.servico, preferencia: l.preferencia, salao_nome: l.salao_nome, lugar_id: l.lugar_id, bairro: l.bairro, cidade: l.cidade, status: l.status, voto: l.voto, motivo: l.motivo, criado_em: l.criado_em })),
  }
}
const publico = () => (CFG.ligado && CFG.numero ? { ligado: true, numero: CFG.numero, botoes: CFG.botoes, msg_cliente: CFG.msg_cliente } : { ligado: false })
export const demoContatoConfig = publico

const SALOES = { gl1: ['Studio Lírio', 'Itanhaém'], gl3: ['Ateliê Cabelo & Arte', 'Itanhaém'] }
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
      vao_atender: pedidos.filter((l) => l.voto === 'sim').length, nao_atendem: pedidos.filter((l) => l.voto === 'nao').length, demoraram: pedidos.filter((l) => l.aviso_demora_em).length,
      resgatados: pedidos.filter((l) => l.resgate_em).length, recuperados: pedidos.filter((l) => l.resgate_de).length,
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
  for (const k of ['ligado', 'mostrar_contato_salao', 'exigir_preferencia', 'ocioso_ativo', 'enquete_ativa', 'avisar_cliente_nao', 'aviso_nao_atende', 'sobre_agenda']) if (typeof c[k] === 'boolean') n[k] = c[k]
  // 3.77: o resgate
  if (c.resgate_min !== undefined) { const v = Number(c.resgate_min); if (!(v === 0 || (v >= 5 && v <= 1440))) throw new Error('oferecer outro salão depois de: 0 (desligado) ou de 5 a 1440 minutos'); n.resgate_min = v }
  if (c.resgate_opcoes !== undefined) { const v = Number(c.resgate_opcoes); if (!(v >= 1 && v <= 5)) throw new Error('quantos salões sugerir: de 1 a 5'); n.resgate_opcoes = v }
  for (const k of ['resgate_inicio', 'resgate_fim']) if (typeof c[k] === 'string' && /^\d{2}:\d{2}/.test(c[k])) n[k] = `${c[k].slice(0, 5)}:00`
  if (n.resgate_inicio >= n.resgate_fim) throw new Error('a janela do resgate: o começo antes do fim (ex.: 08:00 a 21:00)')
  if (typeof c.msg_resgate === 'string' && c.msg_resgate.trim()) { const v = c.msg_resgate.trim(); if (v.length < 10 || !v.includes('{opcoes}')) throw new Error('a mensagem do resgate: de 10 a 1500 letras, com {opcoes}'); n.msg_resgate = v }
  for (const [k, rot] of [['msg_sobre_agenda', 'a mensagem da MIMO Agenda'], ['msg_sobre_agenda_site', 'a mensagem da MIMO Agenda com o comercial desligado']]) {
    const v = typeof c[k] === 'string' ? c[k].trim() : ''
    if (v && (v.length < 10 || v.length > 2000 || !v.includes('{link}'))) throw new Error(`${rot}: de 10 a 2000 letras, com {link}`)
    if (v) n[k] = v
  }
  for (const k of ['instancia', 'provedor', 'orientacao', 'msg_cliente', 'msg_salao', 'msg_salao_resposta', 'msg_encerramento', 'msg_ocioso', 'msg_dona', 'msg_salao_vai_atender', 'msg_salao_nao_atende', 'msg_cliente_nao_atende', 'msg_aviso_nao_atende', 'msg_aviso_demora', 'msg_cutucar_salao', 'enquete_pergunta', 'enquete_sim', 'enquete_nao']) if (typeof c[k] === 'string' && c[k].trim()) n[k] = c[k].trim()
  if (typeof c.enquete_pergunta === 'string' && c.enquete_pergunta.trim() && c.enquete_pergunta.trim().length < 3) throw new Error('a pergunta da enquete: de 3 a 200 letras')
  for (const k of ['enquete_sim', 'enquete_nao']) if (typeof c[k] === 'string' && c[k].trim() && c[k].trim().length < 2) throw new Error('cada opção da enquete: de 2 a 60 letras')
  if (c.aviso_demora_min !== undefined) { const v = Number(c.aviso_demora_min); if (!(v === 0 || (v >= 5 && v <= 10080))) throw new Error('avisar a equipe da demora: 0 (desligado) ou de 5 a 10080 minutos'); n.aviso_demora_min = v }
  if (c.cutucar_salao_min !== undefined) { const v = Number(c.cutucar_salao_min); if (!(v === 0 || (v >= 5 && v <= 10080))) throw new Error('cutucar o salão: 0 (desligado) ou de 5 a 10080 minutos'); n.cutucar_salao_min = v }
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
  // 3.59
  guia_whats_clientes: (a) => clientes(a ?? {}),
  guia_demanda_sem_dono: (a) => demandaSemDono(a ?? {}),
  // 3.77
  guia_whats_sem_resposta: () => SEM_RESPOSTA.map((x) => ({ ...x, conferido_em: CONFERIDOS[x.lugar_id]?.em ?? null, conferido_nota: CONFERIDOS[x.lugar_id]?.nota ?? null })),
  guia_whats_conferir: ({ lugar_, nota_, desfazer_ }) => { if (desfazer_) delete CONFERIDOS[lugar_]; else CONFERIDOS[lugar_] = { em: new Date().toISOString(), nota: String(nota_ ?? '').trim() || null }; return { ok: true } },
}
// 3.77: os salões que deixaram clientes sem resposta (o Studio Lírio com a Gabi; o Espaço Bela Praia nem tem WhatsApp)
const CONFERIDOS = {}
const SEM_RESPOSTA = [
  { lugar_id: 'gl9', nome: 'Espaço Bela Praia', cidade: 'Mongaguá', cidade_slug: 'mongagua', slug: 'espaco-bela-praia', bairro: 'Centro', telefone: '1334481234', whatsapp: null, numero: null, invalido: false, invalido_motivo: null, na_mimo: false,
    pedidos: 3, clientes: 3, sem_resposta: 0, nao_chegou: 3, responderam: 0, ofereceu_outro: 2, ultimo: h(60 * 70) },
  { lugar_id: 'gl1', nome: 'Studio Lírio', cidade: 'Itanhaém', cidade_slug: 'itanhaem', slug: 'studio-lirio', bairro: 'Centro', telefone: null, whatsapp: '13990001101', numero: '5513990001101', invalido: false, invalido_motivo: null, na_mimo: false,
    pedidos: 4, clientes: 4, sem_resposta: 1, nao_chegou: 0, responderam: 3, ofereceu_outro: 1, ultimo: h(180) },
]

// ---- a função guia-whats no demo -------------------------------------------------------------------------------------
const preencher = (modelo, valores) => String(modelo ?? '').split('\n').filter((linha) => !/\{([a-z_]+)\}/.test(linha) || linha.replace(/\{([a-z_]+)\}/g, (x, k) => (k in valores ? String(valores[k] ?? '').trim() : x)).trim().split(':').slice(1).join(':').trim() !== '')
  .map((linha) => linha.replace(/\{([a-z_]+)\}/g, (x, k) => (k in valores ? String(valores[k] ?? '').trim() : x))).join('\n').replace(/\n{3,}/g, '\n\n').trim()
const bonito = (d) => `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`
// 3.57: troca todos os {campos}; um campo vazio leva o " · " ou os parênteses junto, e {nome} vazio leva a vírgula
const trocar = (modelo, valores) => {
  let s = String(modelo ?? '')
  for (const [k, bruto] of Object.entries(valores)) {
    const v = String(bruto ?? '').trim()
    s = v ? s.replaceAll(`{${k}}`, v) : s.replace(new RegExp(`\\s*·\\s*\\{${k}\\}`, 'g'), '').replace(new RegExp(`\\{${k}\\}\\s*·\\s*`, 'g'), '').replace(new RegExp(`\\s*\\(\\{${k}\\}\\)`, 'g'), '').replace(new RegExp(`,?\\s*\\{${k}\\}`, 'g'), '')
  }
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
const enqueteDe = (p) => ({ pergunta: trocar(CFG.enquete_pergunta || 'Vai atender a {cliente}?', { cliente: p.cliente || 'cliente', salao: p.salao, servico: p.servico ?? '' }).slice(0, 255), opcoes: [CFG.enquete_sim || 'Sim, vou atender', CFG.enquete_nao || 'Não vou conseguir'] })
// o voto simulado: o que o salão, a cliente e a equipe receberiam (nada sai)
function simularVoto({ voto }) {
  const s = SIM
  if (!s?.lugar) return { ok: true, responder: null, acao: 'sem_conversa_teste' }
  const p = { cliente: s.dados.nome ?? '', salao: s.lugar.nome, servico: s.dados.servico ?? '', preferencia: s.dados.preferencia ?? '', link: 'https://wa.me/5513999990000', contato: bonito('5513999990000'), cidade: 'Itanhaém' }
  if (voto !== 'nao') return { ok: true, acao: 'salao_vai_atender', responder: trocar(CFG.msg_salao_vai_atender, p), previaCliente: null, previaAviso: null, previaEnquete: enqueteDe(p) }
  return {
    ok: true, acao: 'salao_nao_atende', responder: trocar(CFG.msg_salao_nao_atende, p), previaEnquete: enqueteDe(p),
    previaCliente: CFG.avisar_cliente_nao === false ? null : trocar(CFG.msg_cliente_nao_atende, { ...p, nome: p.cliente.split(' ')[0], opcoes: opcoesTexto(OPCOES_DEMO, p.servico) }),
    previaAviso: CFG.aviso_nao_atende === false || !CFG.numero_avisos ? null : trocar(CFG.msg_aviso_nao_atende, { ...p, cliente: p.cliente || 'sem nome', servico: p.servico || 'sem serviço', preferencia: p.preferencia || 'sem preferência' }),
  }
}
// 3.77: os salões que a Mel sugere no demo (a regra de verdade está em guia_whats_alternativas, migração 222)
const OPCOES_DEMO = [{ id: 'gl3', nome: 'Ateliê Cabelo & Arte', bairro: 'Centro', km: 0.8, agendar: null }, { id: 'gl2', nome: 'Espaço Bela', bairro: 'Belas Artes', km: 2.4, agendar: 'espacobela' }]
const opcoesTexto = (ops, servico) => ops.length
  ? [`Achei ${ops.length === 1 ? 'este salão' : 'estes salões'} ali perto${servico ? ` para ${String(servico).toLowerCase()}` : ''}:`, '', ...ops.map((o, i) => `${i + 1}) ${o.nome}${o.bairro ? ` · ${o.bairro}` : ''}${o.km != null ? ` · ${String(o.km.toFixed(1)).replace('.', ',')} km` : ''}${o.agendar ? ' — agenda pela MIMO, você marca na hora' : ''}`), '', `Quer que eu passe o seu pedido para ${ops.length === 1 ? 'ele' : 'um deles'}? É só responder o número.`].join('\n')
  : 'Quer que eu te ajude com outro salão? Me manda o nome ou o link de outro salão do guia que eu passo o seu pedido pra ele.'
function simularResgate() {
  const s = SIM
  if (!s?.lugar) return { ok: true, responder: null, acao: 'sem_conversa_teste' }
  const resposta = trocar(CFG.msg_resgate, { nome: (s.dados.nome ?? '').split(' ')[0], salao: s.lugar.nome, opcoes: opcoesTexto(OPCOES_DEMO, s.dados.servico) })
  s.anterior = s.lugar.nome; s.opcoes = OPCOES_DEMO; s.estado = 'conversando'; s.mensagens.push({ q: 'mel', t: resposta })
  return { ok: true, responder: resposta, acao: 'resgate', estado: 'conversando' }
}
let SIM = null // a conversa do simulador: { lugar, dados, estado, mensagens }
function simular({ texto, lugar, comoDona }) {
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
  let resposta, acao = 'conversa', previaSalao = null, previaEnquete = null
  const resumo = () => `Anotei assim:\n• Nome: ${s.dados.nome}\n• Serviço: ${s.dados.servico}${s.dados.preferencia ? `\n• Preferência: ${s.dados.preferencia}` : ''}\n\nPosso enviar seu nome, este WhatsApp e o pedido para o ${s.lugar.nome}? Eles te chamam aqui para combinar. É só responder *sim*.`
  // 3.54: testar como a dona (o número de quem escreve é o cadastrado do salão): a Mel reconhece e apresenta a MIMO Agenda
  if (comoDona) {
    const exemplo = preencher(CFG.msg_salao, { salao: s.lugar.nome, cliente: 'Maria (exemplo)', servico: 'Corte e escova', preferencia: 'sexta à tarde', observacao: '', contato: bonito('5513999990000'), link: 'https://wa.me/5513999990000' })
    resposta = (CFG.msg_dona || 'Oi {salao}! 💗 Assim chega um pedido pra você:\n{exemplo}\nConheça a MIMO Agenda.').replaceAll('{salao}', s.lugar.nome).replaceAll('{exemplo}', exemplo)
    const previaAviso = CFG.numero_avisos ? `🎉 MIMO — dona testando o guia\n${s.lugar.nome}: a dona está escrevendo pela Mel do número cadastrado. Boa hora para apresentar a MIMO Agenda.\nNúmero: ${bonito('5513999990000')}` : null
    s.estado = 'encerrada'; s.mensagens.push({ q: 'mel', t: resposta })
    return { ok: true, texto: t, responder: resposta, acao: 'dona', previaSalao: null, previaAviso, estado: 'encerrada', dados: { dona: true } }
  }
  // 3.76: quem pergunta da MIMO Agenda: o link do comercial (ou o site); a conversa segue
  if (!inicio && CFG.sobre_agenda !== false && SOBRE_AGENDA.test(palavraDemo(t))) {
    const c = COMERCIAL_RPC.comercial_publico()
    const vezes = s.dados.comercial ?? 0
    const marcar = `Se você queria marcar um horário no ${s.lugar.nome}, é só me dizer o serviço que eu sigo com você.`
    const link = c?.ligado ? `https://wa.me/${c.numero}?text=${encodeURIComponent('Oi! Vim pela Mel, do guia da MIMO: quero conhecer a MIMO Agenda.')}` : 'https://mimo.com.vc'
    const modelo = vezes > 0 ? (c?.ligado ? 'Para a MIMO Agenda, quem te atende é a {nome}, no WhatsApp comercial: {link} 💗\n\n{marcar}' : 'Para a MIMO Agenda, é por aqui: {link} 💗\n\n{marcar}') : (c?.ligado ? CFG.msg_sobre_agenda : CFG.msg_sobre_agenda_site)
    resposta = modelo.replaceAll('{nome}', c?.nome || 'nossa consultora').replaceAll('{link}', link).replaceAll('{marcar}', marcar).replace(/\n{3,}/g, '\n\n').trim()
    s.dados.comercial = vezes + 1
    s.mensagens.push({ q: 'mel', t: resposta })
    return { ok: true, texto: t, responder: resposta, acao: 'sobre_agenda', previaSalao: null, previaEnquete: null, estado: s.estado, dados: { ...s.dados } }
  }
  // 3.77: escolhendo entre os salões oferecidos
  if (s.opcoes?.length && !inicio) {
    const n = Number((palavraDemo(t).match(/^(?:o |a |opcao )?([1-9])\b/) ?? [])[1])
    const o = s.opcoes[n - 1]
    if (o) {
      s.opcoes = null
      s.lugar = { nome: o.nome, cidade_slug: 'itanhaem', slug: o.id }
      if (o.agendar) { s.estado = 'encerrada'; resposta = `Oi! Aqui é a Mel, da MIMO 💗. O ${o.nome} já agenda pela MIMO: é só escolher o serviço e o horário aqui 👉 https://${o.agendar}.mimo.com.vc`; s.mensagens.push({ q: 'mel', t: resposta }); return { ok: true, texto: t, responder: resposta, acao: 'agenda_mimo', estado: s.estado, dados: { ...s.dados } } }
      s.estado = 'confirmando'; acao = 'escolheu'; resposta = resumo()
      s.mensagens.push({ q: 'mel', t: resposta })
      return { ok: true, texto: t, responder: resposta, acao, estado: s.estado, dados: { ...s.dados } }
    }
    if (/\b(esperar|aguardar|nao)\b/.test(palavraDemo(t))) { s.opcoes = null; resposta = `Combinado! 💗 Vou deixar o seu pedido com o ${s.anterior}. Se mudar de ideia, é só me mandar o número de um dos salões.`; s.mensagens.push({ q: 'mel', t: resposta }); return { ok: true, texto: t, responder: resposta, acao: 'vai_esperar', estado: s.estado, dados: { ...s.dados } } }
    resposta = `É só me responder o número do salão (de 1 a ${s.opcoes.length}) que eu passo o seu pedido 💗 Se preferir esperar o ${s.anterior}, me diz "vou esperar".`
    s.mensagens.push({ q: 'mel', t: resposta })
    return { ok: true, texto: t, responder: resposta, acao: 'escolhendo', estado: s.estado, dados: { ...s.dados } }
  }
  if (/\(código:/.test(t) || s.mensagens.length === 1) { resposta = `Oi! Aqui é a Mel, da MIMO 💗, o guia onde você encontrou o ${s.lugar.nome}. Eu anoto seu pedido e passo para o salão, que te chama aqui no WhatsApp. Como é seu nome?` }
  else if (s.estado === 'confirmando' && /^(sim|pode|ok|isso|claro)\b/i.test(t)) {
    s.estado = 'enviado'; acao = 'enviado_teste'
    previaSalao = preencher(CFG.msg_salao, { salao: s.lugar.nome, cliente: s.dados.nome, servico: s.dados.servico, preferencia: s.dados.preferencia, observacao: '', contato: bonito('5513999990000'), link: 'https://mimo.com.vc/r/demotoken-previa' })
    if (CFG.enquete_ativa !== false) previaEnquete = enqueteDe({ cliente: s.dados.nome, salao: s.lugar.nome, servico: s.dados.servico })
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
  return { ok: true, texto: t, responder: resposta, acao, previaSalao, previaEnquete, estado: s.estado, dados: { ...s.dados } }
}

export function demoGuiaWhats(corpo) {
  const acao = corpo?.acao
  if (acao === 'estado') return { instancia: CFG.instancia, numero: CFG.numero, estado: CFG.numero ? ESTADO : 'nao_existe', erro: null, segredos: { evolution: true, webhook: true, groq: true, claude: false } }
  if (acao === 'conectar') { if (!CFG.numero) throw new Error('informe o número do WhatsApp do guia e salve antes de conectar'); ESTADO = 'connecting'; setTimeout(() => { ESTADO = 'open' }, 8000); return { estado: 'connecting', webhook: 'ok', erro: null, pairingCode: 'MIMO-GUIA', qr: null } }
  if (acao === 'desconectar') { ESTADO = 'close'; return { ok: true } }
  if (acao === 'simular') return simular(corpo)
  if (acao === 'reiniciar') { SIM = null; return { ok: true } }
  if (acao === 'simular_voto') return simularVoto(corpo)
  if (acao === 'simular_resgate') return simularResgate()
  // 3.55: o agente de onboarding (a aba Onboarding), um roteiro à parte (src/lib/demoGuiaOnboarding.js)
  if (acao === 'simular_onboarding') return simularOnboarding(corpo)
  if (acao === 'reiniciar_onboarding') { reiniciarOnboarding(); return { ok: true } }
  if (acao === 'reenviar') { const l = LEADS.find((x) => x.id === Number(corpo.lead)); if (!l || !l.salao_tel) throw new Error('não dá para reenviar: o salão pediu para não receber ou não tem WhatsApp'); l.status = 'enviado'; l.erro = null; l.enviado_em = new Date().toISOString(); return { ok: true } }
  throw new Error('ação desconhecida')
}
