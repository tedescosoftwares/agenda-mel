// O agente de onboarding pelo WhatsApp no modo demonstração (3.55, migração 203; 3.56, migração 204): a configuração e os leads de mentira,
// as RPCs da Plataforma e do site (guia_onboarding_*) e o simulador — um agente de roteiro, sem IA, que anda pelos
// mesmos passos do motor de verdade (tipo → CNPJ/CPF → endereço → nome → profissionais → serviços → horários → e-mail →
// explicações → link), com a mesma tolerância. CNPJs do demo: 11.222.333/0001-81 (ativo, Studio Demo) e
// 11.444.777/0001-61 (baixado); qualquer outro válido de dígito "não existe".
import { cnpjValido, cpfValido, soDigitos } from './cnpj'

const h = (min) => new Date(Date.now() - min * 60e3).toISOString()
const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const palavra = (t) => semAcento(t).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

export const ORIENTACAO_ONB = `Você é a Mel, da MIMO. Aqui você NÃO está anotando pedido de cliente: está ajudando uma profissional de beleza (dona de salão ou autônoma) a criar a conta dela na MIMO Agenda, conversando pelo WhatsApp.

Como conversar:
- Uma pergunta por vez. Mensagens curtas, como no WhatsApp. Português do Brasil, no máximo um emoji por mensagem.
- Siga o passo atual que o sistema indica. Não pule passo nem peça dois dados de uma vez.
- Nunca peça senha e nunca peça cartão. A senha e o aceite dos termos ela faz no link seguro que você manda no fim.
- Se ela disser que não é profissional (é cliente), o sistema devolve ela ao atendimento de cliente.
- Não invente preço, prazo nem funcionalidade. Se não souber, diga que a equipe da MIMO confirma.`

let CFG = {
  id: 1, ligado: true, provedor: 'groq', modelo: null, orientacao: ORIENTACAO_ONB,
  gatilhos: ['quero criar minha conta na mimo agenda', 'quero criar minha conta', 'criar minha conta na mimo', 'criar conta na mimo', 'quero a mimo agenda', 'quero usar a mimo agenda', 'quero me cadastrar na mimo', 'cadastrar meu salao na mimo'],
  tolerancia: 3, tolerancia_cnpj: 3, link_dias: 7, numero_atendimento: '5513999990001', pausa_seg: 2, bolhas: true,
  com_servicos: true, com_horarios: true, com_email: true, com_telefone: true, com_explicacoes: true, com_resumo: true,
  passo_telefone: 'O sistema pergunta se o WhatsApp do salão é o número de onde ela está falando ou outro, e se ela quer cadastrar mais um telefone. Se ela tiver dúvida, explique curto: precisa ser o WhatsApp do salão (o que as clientes usam) porque a MIMO se conecta a ele para mandar confirmações e lembretes automáticos.',
  passo_resumo: 'Ela está conferindo o resumo do cadastro. Se disser que algo está errado, anote o campo corrigido; se confirmar que está tudo certo, passo_concluido = true.',
  passo_tipo: 'Pergunte se ela atende sozinha, como autônoma, ou se tem um salão com equipe. Diga em uma frase que a MIMO serve para as duas.',
  passo_documento: 'Pergunte o CNPJ do negócio (só os números). Diga que, se ela não tiver CNPJ, é só responder "não tenho" que você pede o CPF, necessário para o pagamento da assinatura.',
  passo_endereco: 'Se o sistema trouxe o endereço do CNPJ, ele mesmo mostra e pede confirmação. Sem CNPJ, pergunte o endereço onde ela atende (rua, número, bairro e cidade).',
  passo_nome: 'Pergunte o nome do negócio como as clientes conhecem. Se o CNPJ trouxe um nome, sugira e pergunte se é esse mesmo.',
  passo_profissionais: 'Pergunte quantas profissionais atendem no espaço, contando ela. Autônoma é 1.',
  passo_servicos: 'Pergunte os 3 a 5 serviços principais. Explique, curto, que a lista completa — com preço e duração — ela cadastra no painel depois de entrar, em "Serviços".',
  passo_horarios: 'Pergunte os dias e horários de atendimento (ex.: segunda a sexta 9h às 19h, sábado 9h às 14h).',
  passo_email: 'Pergunte o e-mail que vai ser o login da conta. Peça para conferir a digitação.',
  passo_explicacoes: 'Antes do link, explique: (1) no painel ela gera um link próprio (nome.mimo.com.vc) e um QR code para as clientes marcarem sozinhas; (2) as clientes recebem lembretes automáticos; (3) o próximo passo é só criar a senha no link seguro. Pergunte se ficou alguma dúvida.',
  msg_confirmar: 'Oi! Aqui é a Mel, da MIMO 💗 Pelo que você escreveu, parece que você é profissional de beleza e quer criar sua conta na MIMO Agenda — é isso? Se for, me responde *sim* que eu já começo seu cadastro por aqui. Se você é cliente querendo marcar um horário, me diz de qual salão.',
  msg_boas_vindas: 'Oi! Aqui é a Mel, da MIMO 💗 Que bom que você quer a MIMO Agenda! Vou fazer seu cadastro por aqui mesmo, em poucos passos — no fim te mando um link seguro só pra você criar a senha. Vamos começar?',
  msg_nao_sou: 'Sem problema! 💗 Então vamos ao seu horário: de qual salão você quer marcar? Me manda o nome como aparece no guia ou o link da página dele.',
  msg_cnpj_invalido: 'Hmm, esse CNPJ não passou: {motivo}. Para criar a conta preciso de um CNPJ válido e ativo na Receita. Confere e me manda de novo (só os números)? Se você não tem CNPJ, responde *não tenho*.',
  msg_cpf_invalido: 'Esse CPF não parece válido 😅 Confere os 11 números e me manda de novo?',
  msg_email_invalido: 'Esse e-mail não parece certo 😅 Confere e me manda de novo?',
  msg_endereco_confirmar: 'Achei na Receita! 📍 O endereço do CNPJ é:\n{endereco}\n\nÉ aí que você atende? Responde *sim* ou me manda o endereço certo.',
  msg_link: 'Prontinho! 💗 O cadastro de *{nome}* está anotado. Agora é só criar sua senha e aceitar os termos neste link seguro (vale {dias} dias):\n{link}\n\nQualquer dúvida, me chama por aqui.',
  msg_encerrar: 'Acho que não estou conseguindo te ajudar direito por aqui 💗 Vou pedir para alguém da equipe da MIMO te chamar e fazer o cadastro com você, tá? Até já!',
  msg_numero_em_uso: 'Esse número já está cadastrado na MIMO{salao} 💗 Para entrar na sua conta ou recuperar o acesso, fale com o atendimento: {atendimento}',
  msg_nome_em_uso: 'Já existe um salão chamado *{nome}* na MIMO{cidade}, e o endereço nome.mimo.com.vc precisa ser único. Quer usar outro nome, ou acrescentar o bairro ou a cidade (tipo "{nome} Centro")?',
  msg_email_em_uso: 'O e-mail {email} já tem conta na MIMO. Se é o seu, você já tem conta — fale com o atendimento: {atendimento}. Se quiser usar outro e-mail, é só me mandar.',
  msg_documento_em_uso: 'Esse {documento} já está cadastrado na MIMO — então você já tem conta! 💗 Para entrar ou recuperar o acesso, fale com o atendimento: {atendimento}',
  msg_email_confirmar: 'Anotei *{email}* — está certinho? Responde *sim* ou me manda o e-mail certo.',
  msg_cep: 'Me manda o CEP de onde você atende (só os números) que eu puxo o endereço. Se não souber o CEP, responde *não sei* que a gente escreve o endereço.',
  msg_cep_invalido: 'Não achei esse CEP: {motivo}. Confere os 8 números e me manda de novo? Se não souber, responde *não sei*.',
  msg_cep_numero: 'Achei! 📍 {endereco}\n\nQual é o número (e o complemento, se tiver)?',
  msg_telefone: 'O WhatsApp do salão vai ser este número de onde você está falando, {numero}? Ele precisa ser o WhatsApp do salão — o que as clientes usam —, porque a MIMO se conecta a ele para mandar as confirmações e os lembretes automáticos. Responde *sim* ou me manda o número certo, com DDD.',
  msg_telefone_extra: 'Quer cadastrar mais algum telefone (fixo ou outro WhatsApp)? Me manda o número com DDD, ou responde *não*.',
  msg_telefone_invalido: 'Esse número não parece certo 😅 Me manda com DDD, tipo (13) 99999-0000.',
  msg_resumo: 'Antes do link, confere se está tudo certo:\n\n{resumo}\n\nResponde *sim* que eu mando o link, ou me diz o que quer corrigir.',
  atualizado_em: h(60 * 24 * 2),
}
const MEL = { ligado: true, numero: '5513999990000', numero_avisos: null }
const END_DEMO = { logradouro: 'Rua das Flores', numero: '10', complemento: '', bairro: 'Centro', cidade: 'Itanhaém', uf: 'SP', cep: '11740000' }
const LEADS = [
  { id: 1, telefone: '5513988881111', chave: '551388881111', origem: 'cta', estado: 'concluido', dados: { passo: 'link', tipo: 'salao', cnpj: '11222333000181', razao_social: 'STUDIO DEMO LTDA', nome_fantasia: 'Studio Demo', nome: 'Studio Demo Beleza', endereco: END_DEMO, profissionais: 4, servicos: ['corte', 'escova', 'unhas'], horarios: 'seg a sex 9h-19h, sáb 9h-14h', email: 'contato@studiodemo.com.br', link_enviado: true },
    mensagens: [{ q: 'cliente', t: 'Quero criar minha conta na MIMO Agenda', em: h(60 * 30) }, { q: 'mel', t: 'Oi! Aqui é a Mel, da MIMO 💗 Que bom que você quer a MIMO Agenda! Vou fazer seu cadastro por aqui mesmo. Você atende sozinha, como autônoma, ou tem um salão com equipe?', em: h(60 * 30) }, { q: 'cliente', t: 'tenho um salão', em: h(60 * 29) }, { q: 'mel', t: 'Ótimo! Qual é o CNPJ do salão (só os números)? Se não tiver, responde "não tenho".', em: h(60 * 29) }, { q: 'cliente', t: '11222333000181', em: h(60 * 29) }, { q: 'mel', t: 'Achei na Receita! 📍 O endereço do CNPJ é:\nRua das Flores, 10 · Centro · Itanhaém-SP · CEP 11740-000\n\nÉ aí que você atende? Responde *sim* ou me manda o endereço certo.', em: h(60 * 29) }, { q: 'cliente', t: 'sim', em: h(60 * 28) }, { q: 'mel', t: 'Prontinho! 💗 O cadastro de *Studio Demo Beleza* está anotado. Agora é só criar sua senha e aceitar os termos neste link seguro (vale 7 dias):\nhttps://mimo.com.vc/comecar?c=demotokenonb1', em: h(60 * 27) }],
    token: 'demotokenonb1', token_expira: h(-60 * 24 * 6), aberto_em: h(60 * 26), concluido_em: h(60 * 25), salao_id: 'salao-demo', teste: false, criado_em: h(60 * 30), atualizada_em: h(60 * 25) },
  { id: 2, telefone: '5513977772222', chave: '551377772222', origem: 'intencao', estado: 'enviado', dados: { passo: 'link', tipo: 'autonoma', sem_cnpj: true, cpf: '52998224725', nome: 'Ana Nails', endereco: { texto: 'Rua B 5, Guaraú', cidade: 'Peruíbe' }, profissionais: 1, servicos: ['unhas em gel', 'alongamento'], horarios: 'ter a sáb 10h-19h', email: 'ana.nails@gmail.com', telefone_salao: '5513977772222', link_enviado: true },
    mensagens: [{ q: 'cliente', t: 'oi, quero criar minha conta', em: h(200) }, { q: 'mel', t: CFG.msg_confirmar, em: h(200) }, { q: 'cliente', t: 'sim', em: h(198) }, { q: 'mel', t: 'Que bom! Você atende sozinha, como autônoma, ou tem um salão com equipe?', em: h(198) }, { q: 'cliente', t: 'sou autônoma, não tenho cnpj', em: h(197) }, { q: 'mel', t: 'Sem problema! Então me manda seu CPF (só os números) — é para o pagamento da assinatura.', em: h(197) }, { q: 'cliente', t: '529.982.247-25', em: h(196) }, { q: 'mel', t: 'Anotado! E qual o endereço onde você atende?', em: h(196) }, { q: 'cliente', t: 'Rua B 5, Guaraú, Peruíbe', em: h(195) }, { q: 'mel', t: 'Prontinho! 💗 O cadastro de *Ana Nails* está anotado. Agora é só criar sua senha e aceitar os termos neste link seguro (vale 7 dias):\nhttps://mimo.com.vc/comecar?c=demotokenonb2', em: h(190) }],
    token: 'demotokenonb2', token_expira: h(-60 * 24 * 6), aberto_em: null, concluido_em: null, salao_id: null, teste: false, criado_em: h(200), atualizada_em: h(190) },
  { id: 3, telefone: '5513966663333', chave: '551366663333', origem: 'cta', estado: 'encerrada', dados: { passo: 'documento', tipo: 'salao', erros_cnpj: 3, encerrada_por: 'cnpj' },
    mensagens: [{ q: 'cliente', t: 'Quero criar minha conta na MIMO Agenda', em: h(60 * 50) }, { q: 'mel', t: 'Oi! Você atende sozinha ou tem um salão?', em: h(60 * 50) }, { q: 'cliente', t: 'salão', em: h(60 * 49) }, { q: 'mel', t: 'Qual é o CNPJ?', em: h(60 * 49) }, { q: 'cliente', t: '11444777000161', em: h(60 * 49) }, { q: 'mel', t: 'Hmm, esse CNPJ não passou: a situação dele na Receita é BAIXADA, e só CNPJ ativo entra. Confere e me manda de novo?', em: h(60 * 49) }, { q: 'cliente', t: '11444777000161', em: h(60 * 48) }, { q: 'mel', t: 'Hmm, esse CNPJ não passou: a situação dele na Receita é BAIXADA, e só CNPJ ativo entra. Confere e me manda de novo?', em: h(60 * 48) }, { q: 'cliente', t: '11444777000161', em: h(60 * 48) }, { q: 'mel', t: 'Hmm, esse CNPJ não passou: a situação dele na Receita é BAIXADA, e só CNPJ ativo entra.\n\n' + CFG.msg_encerrar, em: h(60 * 48) }],
    token: 'demotokenonb3', token_expira: null, aberto_em: null, concluido_em: null, salao_id: null, teste: false, criado_em: h(60 * 50), atualizada_em: h(60 * 48) },
]

export const publicoOnb = () => (CFG.ligado && MEL.ligado && MEL.numero ? { ligado: true, numero: MEL.numero, frase: CFG.gatilhos[0] } : { ligado: false })

function painel({ dias_ = 30 } = {}) {
  const desde = Date.now() - Math.max(1, Math.min(dias_ ?? 30, 365)) * 86400e3
  const no = LEADS.filter((l) => !l.teste && new Date(l.criado_em).getTime() >= desde)
  const porOrigem = {}
  for (const l of no) porOrigem[l.origem] = (porOrigem[l.origem] ?? 0) + 1
  return {
    config: { ...CFG }, mel: { ...MEL },
    totais: {
      entraram: no.length, confirmaram: no.filter((l) => l.estado !== 'confirmando' && !(l.estado === 'encerrada' && !l.dados.passo)).length,
      link_enviado: no.filter((l) => l.token_expira).length, abriram: no.filter((l) => l.aberto_em).length,
      concluiram: no.filter((l) => l.estado === 'concluido').length, encerradas: no.filter((l) => l.estado === 'encerrada').length, por_origem: porOrigem,
    },
    leads: LEADS.filter((l) => !l.teste && new Date(l.atualizada_em).getTime() >= desde).map((l) => ({
      id: l.id, telefone: l.telefone, origem: l.origem, estado: l.estado, passo: l.dados.passo ?? null, tipo: l.dados.tipo ?? null, nome: l.dados.nome ?? null,
      cnpj: l.dados.cnpj ?? null, email: l.dados.email ?? null, cidade: l.dados.endereco?.cidade ?? null, token_expira: l.token_expira, aberto_em: l.aberto_em,
      concluido_em: l.concluido_em, salao_id: l.salao_id, n: l.mensagens.length, ultima: l.mensagens.at(-1)?.t ?? null, criado_em: l.criado_em, atualizada_em: l.atualizada_em,
      atendido: l.dados.atendido ?? false,
    })).sort((a, b) => b.atualizada_em.localeCompare(a.atualizada_em)),
  }
}
function salvar({ c }) {
  const n = { ...CFG }
  if (Array.isArray(c.gatilhos)) {
    const vistos = new Set(); const g = []
    for (const x of c.gatilhos) { const p = palavra(x); if (p.length >= 4 && p.length <= 80 && !vistos.has(p)) { vistos.add(p); g.push(p) } }
    if (!g.length) throw new Error('informe pelo menos um gatilho (a frase do botão)')
    n.gatilhos = g
  }
  for (const k of ['ligado', 'bolhas', 'com_servicos', 'com_horarios', 'com_email', 'com_telefone', 'com_explicacoes', 'com_resumo']) if (typeof c[k] === 'boolean') n[k] = c[k]
  if (c.numero_atendimento !== undefined) { let d = String(c.numero_atendimento ?? '').replace(/\D/g, ''); if (d.length === 10 || d.length === 11) d = '55' + d; if (d && !/^[1-9][0-9]{9,14}$/.test(d)) throw new Error('número de atendimento inválido: use DDD e número (com 55 na frente, se quiser)'); n.numero_atendimento = d || null }
  if (c.provedor !== undefined) { if (!['groq', 'claude'].includes(c.provedor)) throw new Error('IA: groq ou claude'); n.provedor = c.provedor }
  if (c.modelo !== undefined) n.modelo = String(c.modelo ?? '').trim() || null
  for (const k of Object.keys(CFG).filter((k) => k === 'orientacao' || k.startsWith('passo_') || k.startsWith('msg_'))) if (typeof c[k] === 'string' && c[k].trim()) n[k] = c[k].trim()
  if (n.orientacao.length < 20 || n.orientacao.length > 8000) throw new Error('a orientação do agente: de 20 a 8000 letras')
  if (!n.msg_link.includes('{link}') || n.msg_link.length < 10 || n.msg_link.length > 2000) throw new Error('a mensagem do link precisa ter {link} e de 10 a 2000 letras')
  if (!n.msg_resumo.includes('{resumo}') || n.msg_resumo.length < 10 || n.msg_resumo.length > 2000) throw new Error('a mensagem do resumo precisa ter {resumo} e de 10 a 2000 letras')
  for (const k of Object.keys(n).filter((k) => k.startsWith('passo_'))) if (n[k].length < 5 || n[k].length > 2000) throw new Error('o texto de um passo: de 5 a 2000 letras')
  for (const k of Object.keys(n).filter((k) => k.startsWith('msg_'))) if (n[k].length < 10 || n[k].length > 2000) throw new Error('mensagem curta ou longa demais (10 a 2000 letras)')
  const faixa = (k, a, b, rotulo) => { if (c[k] !== undefined) { const v = Number(c[k]); if (!Number.isInteger(v) || v < a || v > b) throw new Error(rotulo); n[k] = v } }
  faixa('tolerancia_cnpj', 1, 20, 'tolerância do CNPJ: de 1 a 20 tentativas')
  faixa('tolerancia', 1, 20, 'tolerância: de 1 a 20 respostas inválidas')
  faixa('link_dias', 1, 60, 'validade do link: de 1 a 60 dias')
  faixa('pausa_seg', 0, 30, 'pausa entre as mensagens: de 0 a 30 segundos')
  if (n.ligado && !(MEL.ligado && MEL.numero)) { n.ligado = false; CFG = { ...n, atualizado_em: new Date().toISOString() }; throw new Error('para ligar o onboarding, o WhatsApp do guia (a Mel) precisa estar ligado e com número') }
  CFG = { ...n, atualizado_em: new Date().toISOString() }
  return { ...CFG }
}

const EM_USO = { numeros: new Set(['551388881111']), emails: new Set(['contato@studiodemo.com.br']), documentos: new Set(['12345678000195']), nomes: new Map([['studio-demo-beleza', 'Itanhaém']]) }
const slugDe = (t) => semAcento(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const chaveTel = (t) => { const d = soDigitos(t); return d.length === 13 && d.startsWith('55') && d[4] === '9' ? d.slice(0, 4) + d.slice(5) : d }
function conferir({ tel_, email_, documento_, nome_ } = {}) {
  const r = {}
  if (tel_ != null) { const k = chaveTel(tel_); r.numero = { em_uso: EM_USO.numeros.has(k), salao: EM_USO.numeros.has(k) ? 'Studio Demo Beleza' : null, cidade: EM_USO.numeros.has(k) ? 'Itanhaém' : null } }
  if (email_ != null) r.email = { em_uso: EM_USO.emails.has(String(email_).toLowerCase().trim()) }
  if (documento_ != null) { const d = soDigitos(documento_); r.documento = { em_uso: EM_USO.documentos.has(d), tipo: d.length === 14 ? 'cnpj' : d.length === 11 ? 'cpf' : null, salao: EM_USO.documentos.has(d) ? 'Studio Demo Beleza' : null } }
  if (nome_ != null) { const k = slugDe(nome_); r.nome = { em_uso: EM_USO.nomes.has(k), nome: EM_USO.nomes.has(k) ? nome_ : null, cidade: EM_USO.nomes.get(k) ?? null } }
  return r
}

export const GUIA_ONBOARDING_RPC = {
  guia_onboarding_publico: () => publicoOnb(),
  guia_onboarding_conferir: (a) => conferir(a ?? {}),
  guia_onboarding_painel: (a) => painel(a ?? {}),
  guia_onboarding_config_salvar: (a) => salvar(a ?? { c: {} }),
  guia_onboarding_lead: ({ id_ }) => { const l = LEADS.find((x) => x.id === id_); return l ? { ...l, salao: l.salao_id ? 'Studio Demo Beleza' : null } : null },
  guia_onboarding_lead_atendido: ({ id_, atendido_ }) => { const l = LEADS.find((x) => x.id === id_); if (l) l.dados = { ...l.dados, atendido: atendido_ !== false }; return null },
  guia_onboarding_por_token: ({ token_ }) => {
    const l = LEADS.find((x) => x.token === token_)
    if (!l || !l.token_expira) return { ok: false, motivo: 'nao_existe' }
    if (l.estado === 'concluido') return { ok: false, motivo: 'concluido' }
    l.aberto_em = l.aberto_em ?? new Date().toISOString()
    const d = l.dados
    return { ok: true, expira: l.token_expira, dados: { tipo: d.tipo ?? null, cnpj: d.cnpj ?? null, cpf: d.cpf ?? null, razao_social: d.razao_social ?? null, nome: d.nome ?? null, endereco: d.endereco ?? null, profissionais: d.profissionais ?? null, servicos: d.servicos ?? null, horarios: d.horarios ?? null, email: d.email ?? null, whatsapp: l.telefone } }
  },
  guia_onboarding_concluir: ({ token_ }) => { const l = LEADS.find((x) => x.token === token_ && x.token_expira); if (!l) return false; l.estado = 'concluido'; l.concluido_em = l.concluido_em ?? new Date().toISOString(); return true },
}

// ---- o simulador: um agente de roteiro (sem IA) que anda pelos passos do motor --------------------------------------
const SIM_CURTO = /^(sim|s|ok|pode|isso|claro|certo|certinho|beleza|bora|vamos|quero|e esse|esse mesmo|exato|tudo certo|entendi|ta bom|manda|pode mandar|ta certo|esta certo)$/
const NAO_CURTO = /^(nao|n|nao quero|cancela|desisto|deixa|agora nao|depois|errado|ta errado|nao e esse)$/
const SO_ESSE = /^(nao|n|so esse|so este|nenhum|nenhum outro|e so|nao tem outro|nao tenho outro|nao precisa)$/
const CLIENTE = /\b(sou cliente|quero marcar|marcar (um )?horario|agendar|nao tenho salao|nao sou profissional)\b/
const NAO_TENHO = /\b(nao tenho( cnpj)?|sem cnpj|so (tenho )?cpf|tenho so cpf)\b/
const NAO_SEI = /\b(nao sei|nao lembro|sem cep|nao tenho (o )?cep)\b/
const telefoneDe = (b) => { const d = soDigitos(b).replace(/^0+/, ''); if (d.length === 10 || d.length === 11) return '55' + d; if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d; return null }
const bonito = (d) => (d && d.length === 13 ? `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}` : d && d.length === 12 ? `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}` : d ?? '')
const cnpjBonito = (d) => `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
const cpfBonito = (d) => `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
const trocar = (modelo, valores) => Object.entries(valores).reduce((t, [k, v]) => t.replaceAll(`{${k}}`, v), String(modelo ?? ''))
const preencher = (modelo, v) => String(modelo ?? '').split('\n')
  .filter((l) => { let vazio = false; l.replace(/\{([a-z_]+)\}/g, (x, k) => { if (k in v && !String(v[k] ?? '').trim()) vazio = true; return x }); return !vazio })
  .map((l) => l.replace(/\{([a-z_]+)\}/g, (x, k) => (k in v ? String(v[k] ?? '').trim() : x))).join('\n').replace(/\n{3,}/g, '\n\n').trim()
const endTexto = (e) => (!e ? '' : e.texto ? [e.texto, e.cidade].filter(Boolean).join(', ') : [[e.logradouro, e.numero].filter(Boolean).join(', ') + (e.complemento ? ` ${e.complemento}` : ''), e.bairro, [e.cidade, e.uf].filter(Boolean).join('-'), e.cep ? `CEP ${e.cep.slice(0, 5)}-${e.cep.slice(5)}` : ''].filter(Boolean).join(' · '))
const montarResumo = (d) => [
  `• Tipo: ${d.tipo === 'autonoma' ? 'autônoma' : 'salão'}`, d.cnpj ? `• CNPJ: ${cnpjBonito(d.cnpj)}${d.razao_social ? ` (${d.razao_social})` : ''}` : d.cpf ? `• CPF: ${cpfBonito(d.cpf)}` : null,
  d.nome ? `• Nome: ${d.nome}` : null, d.endereco ? `• Endereço: ${endTexto(d.endereco)}` : null, d.profissionais ? `• Profissionais: ${d.profissionais}` : null,
  d.servicos?.length ? `• Serviços: ${d.servicos.join(', ')}` : null, d.horarios ? `• Horários: ${d.horarios}` : null, d.email ? `• E-mail: ${d.email}` : null,
  d.telefone_salao ? `• WhatsApp do salão: ${bonito(d.telefone_salao)}${d.telefone_extra ? ` · outro: ${bonito(d.telefone_extra)}` : ''}` : null,
].filter(Boolean).join('\n')
const PERGUNTA = {
  tipo: 'Você atende sozinha, como autônoma, ou tem um salão com equipe? (A MIMO serve para as duas.)',
  documento: 'Qual é o CNPJ do negócio (só os números)? Se você não tem CNPJ, é só responder *não tenho* que eu uso o seu CPF.',
  cpf: 'Sem problema! Então me manda o seu CPF (só os números) — é para o pagamento da assinatura.',
  endereco: 'Então me escreve o endereço onde você atende (rua, número, bairro e cidade)?',
  nome: 'Qual é o nome do negócio, do jeito que as clientes conhecem?',
  profissionais: 'Quantas profissionais atendem aí, contando você? (Autônoma é 1.)',
  servicos: 'Quais são os 3 a 5 serviços principais que você oferece? A lista completa, com preço e duração, você cadastra depois no painel, em "Serviços" — é rápido.',
  horarios: 'Quais são os dias e horários de atendimento? (ex.: segunda a sexta 9h às 19h, sábado 9h às 14h)',
  email: 'Qual e-mail vai ser o login da sua conta? Confere a digitação, tá? 💗',
  explicacoes: 'Antes do link, duas coisas rápidas:\n\n1) No painel você gera um link próprio (nome.mimo.com.vc) e um QR code para as clientes marcarem sozinhas — dá para imprimir e colar no salão ou mandar no WhatsApp.\n\n2) As clientes recebem lembretes automáticos.\n\nO próximo passo é só criar a senha no link seguro que vou te mandar. Ficou alguma dúvida?',
}
const NUMERO_DELA = '5513999990000'
const CEP_DEMO = { logradouro: 'Rua das Flores', bairro: 'Centro', cidade: 'Itanhaém', uf: 'SP', cep: '11740000' }
let SIM = null
export function simularOnboarding({ texto, origem }) {
  const t = String(texto ?? '').trim()
  const p = palavra(t)
  if (!SIM) {
    const o = origem === 'intencao' ? 'intencao' : 'cta'
    SIM = { origem: o, estado: o === 'cta' ? 'coletando' : 'confirmando', dados: {}, mensagens: [], passo: 'tipo' }
  }
  const s = SIM
  s.mensagens.push({ q: 'cliente', t })
  const passos = ['tipo', 'documento', 'endereco', 'nome', 'profissionais', ...(CFG.com_servicos ? ['servicos'] : []), ...(CFG.com_horarios ? ['horarios'] : []), ...(CFG.com_email ? ['email'] : []), ...(CFG.com_telefone ? ['telefone'] : []), ...(CFG.com_explicacoes ? ['explicacoes'] : []), ...(CFG.com_resumo ? ['resumo'] : []), 'link']
  const d = s.dados
  const atendimento = () => (CFG.numero_atendimento ? `https://wa.me/${CFG.numero_atendimento}` : 'a equipe da MIMO vai te chamar por aqui')
  const dividir = (x) => (CFG.bolhas === false ? [x] : x.split(/\n{2,}/).map((y) => y.trim()).filter(Boolean))
  const sair = (resposta, acao, extra = {}) => { s.mensagens.push({ q: 'mel', t: resposta }); return { ok: true, texto: t, responder: resposta, acao, estado: s.estado, passo: s.passo, dados: { ...d }, bolhas: dividir(resposta), pausa: CFG.pausa_seg, ...extra } }
  const encerrar = (motivo, prefixo, semDespedida) => {
    s.estado = 'encerrada'
    const aviso = `⚠️ MIMO — onboarding encerrado\n${d.nome || 'sem nome ainda'}${d.tipo ? ` (${d.tipo === 'autonoma' ? 'autônoma' : 'salão'})` : ''}\nMotivo: ${motivo}. Parou no passo: ${s.passo}.\nNúmero: ${bonito(NUMERO_DELA)} — vale um humano chamar.`
    return sair(semDespedida ? prefixo : `${prefixo ? `${prefixo}\n\n` : ''}${CFG.msg_encerrar}`, `encerrou_${motivo}`, { previaAviso: aviso })
  }
  const feito = (k) => ({ tipo: !!d.tipo, documento: !!d.cnpj || (d.sem_cnpj && !!d.cpf), endereco: !!d.endereco && !d.confirmando_endereco && !d.pedindo_numero, nome: !!d.nome, profissionais: d.profissionais > 0, servicos: d.servicos?.length > 0, horarios: !!d.horarios, email: !!d.email && !d.confirmando_email, telefone: !!d.telefone_salao && !!d.telefones_ok, explicacoes: !!d.explicacoes_ok, resumo: !!d.resumo_ok })[k]
  const proximo = () => passos.find((k) => !feito(k)) ?? 'link'
  const perguntar = (prefixo) => {
    s.passo = proximo()
    const junto = (q) => sair(prefixo ? `${prefixo}\n\n${q}` : q, 'conversa')
    if (s.passo === 'link') {
      s.estado = 'enviado'; d.link_enviado = true
      const link = 'https://mimo.com.vc/comecar?c=demo-onb-teste'
      const msg = preencher(CFG.msg_link, { link, nome: d.nome || d.nome_fantasia || 'seu negócio', dias: String(CFG.link_dias) })
      const aviso = `🎉 MIMO — novo cadastro pelo WhatsApp\n${d.nome || 'sem nome'}${d.tipo ? ` (${d.tipo === 'autonoma' ? 'autônoma' : 'salão'})` : ''}${d.endereco?.cidade ? ` · ${d.endereco.cidade}` : ''}\n${d.cnpj ? `CNPJ ${cnpjBonito(d.cnpj)}` : d.cpf ? 'CPF anotado' : 'sem documento'}${d.email ? ` · ${d.email}` : ''}${d.telefone_salao ? ` · WhatsApp do salão ${bonito(d.telefone_salao)}` : ''}\nO link para criar a senha foi enviado (vale ${CFG.link_dias} dias).`
      return sair(prefixo ? `${prefixo}\n\n${msg}` : msg, 'link', { link, previaAviso: aviso })
    }
    if (s.passo === 'documento' && d.sem_cnpj) return junto(PERGUNTA.cpf)
    if (s.passo === 'endereco') {
      if (d.confirmando_endereco) return junto(preencher(CFG.msg_endereco_confirmar, { endereco: endTexto(d.endereco_cnpj) }))
      if (d.pedindo_numero) return junto(preencher(CFG.msg_cep_numero, { endereco: endTexto(d.endereco_cep) }))
      if (d.sem_cep) return junto(PERGUNTA.endereco)
      d.pedindo_cep = true; return junto(CFG.msg_cep)
    }
    if (s.passo === 'telefone') {
      if (!d.telefone_salao) return junto(trocar(CFG.msg_telefone, { numero: bonito(NUMERO_DELA) }))
      return junto(CFG.msg_telefone_extra)
    }
    if (s.passo === 'resumo') { d.resumo_mostrado = true; return junto(trocar(CFG.msg_resumo, { resumo: montarResumo(d) })) }
    if (s.passo === 'explicacoes') d.explicou = true
    return junto(PERGUNTA[s.passo])
  }
  const erros = () => { d.erros = (d.erros ?? 0) + 1; return d.erros >= CFG.tolerancia }
  const invalido = (msg) => (erros() ? encerrar('tolerancia', msg) : sair(msg, 'validacao'))
  const tratarEmail = (m) => {
    const v = m.toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) return invalido(CFG.msg_email_invalido)
    if (conferir({ email_: v }).email.em_uso) return sair(trocar(CFG.msg_email_em_uso, { email: v, atendimento: atendimento() }), 'validacao')
    d.email = v; d.confirmando_email = true; d.erros = 0; s.passo = 'email'
    return sair(trocar(CFG.msg_email_confirmar, { email: v }), 'validacao')
  }
  const tratarTelefone = (bruto, extra) => {
    const n = telefoneDe(bruto)
    if (!n) return invalido(CFG.msg_telefone_invalido)
    if (!extra && n !== NUMERO_DELA && conferir({ tel_: n }).numero.em_uso) return sair(`Esse número já está cadastrado em outra conta da MIMO 😕 Me manda outro WhatsApp para o salão, ou fale com o atendimento: ${atendimento()}`, 'validacao')
    if (extra) { d.telefone_extra = n; d.telefones_ok = true } else d.telefone_salao = n
    d.erros = 0
    return perguntar(extra ? 'Anotado! 💗' : 'Perfeito! 💗')
  }

  if (s.estado === 'confirmando') {
    if (s.mensagens.length === 1) return sair(CFG.msg_confirmar, 'confirmar')
    if (NAO_CURTO.test(p) || CLIENTE.test(p)) { s.estado = 'encerrada'; return sair(CFG.msg_nao_sou, 'nao_e_profissional') }
    if (!SIM_CURTO.test(p) && !/\b(tenho|sou|quero|salao|autonoma|cabeleireira|manicure)\b/.test(p)) return sair('Só para eu entender: você é profissional de beleza e quer criar sua conta na MIMO Agenda? Me responde *sim* ou *não*. 💗', 'confirmar')
    s.estado = 'coletando'
    return perguntar('Que bom! 💗')
  }
  if (s.estado === 'enviado') {
    if (/\b(nao recebi|nao chegou|manda de novo|reenvia|expirou|nao abre)\b/.test(p)) return sair(preencher(CFG.msg_link, { link: 'https://mimo.com.vc/comecar?c=demo-onb-teste', nome: d.nome || 'seu negócio', dias: String(CFG.link_dias) }), 'link_reenviado', { link: 'https://mimo.com.vc/comecar?c=demo-onb-teste' })
    return sair('Boa pergunta! No painel tem um guia passo a passo pra isso. Se preferir, a equipe da MIMO te ajuda por aqui. Mais alguma coisa? 💗', 'conversa')
  }
  if (s.estado !== 'coletando') return { ok: true, texto: t, responder: null, acao: 'passa' }
  if (s.mensagens.length === 1) return perguntar(CFG.msg_boas_vindas)   // cta: boas-vindas + a primeira pergunta

  const digitos = soDigitos(t)
  const soNumero = /^[\d.\-/\s()+]+$/.test(t)
  const disseSim = SIM_CURTO.test(p)
  switch (s.passo) {
    case 'tipo':
      if (/\b(autonoma|sozinha|so eu|em casa|domicilio)\b/.test(p)) d.tipo = 'autonoma'
      else if (/\b(salao|equipe|estudio|studio|clinica|espaco)\b/.test(p)) d.tipo = 'salao'
      else return sair('Me ajuda: você atende *sozinha* (autônoma) ou tem um *salão* com equipe?', 'conversa')
      return perguntar(d.tipo === 'autonoma' ? 'Legal, autônoma! 💗' : 'Legal, um salão! 💗')
    case 'documento': {
      if (NAO_TENHO.test(p) && !digitos) { d.sem_cnpj = true; return perguntar() }
      if (soNumero && digitos.length === 14 && !d.sem_cnpj) {
        const inv = (motivo) => { d.erros_cnpj = (d.erros_cnpj ?? 0) + 1; const m = preencher(CFG.msg_cnpj_invalido, { motivo }); return d.erros_cnpj >= CFG.tolerancia_cnpj ? encerrar('cnpj', m) : sair(m, 'validacao') }
        if (!cnpjValido(digitos)) return inv('o dígito verificador não bate (parece mal digitado)')
        if (conferir({ documento_: digitos }).documento.em_uso) return encerrar('ja_cadastrado', trocar(CFG.msg_documento_em_uso, { documento: 'CNPJ', atendimento: atendimento() }), true)
        if (digitos === '11444777000161') return inv('a situação dele na Receita é BAIXADA, e só CNPJ ativo entra')
        if (digitos !== '11222333000181') return inv('não encontrei esse CNPJ na Receita')
        d.cnpj = digitos; d.razao_social = 'STUDIO DEMO LTDA'; d.nome_fantasia = 'Studio Demo'; d.endereco_cnpj = { ...CEP_DEMO, numero: '10' }; d.confirmando_endereco = true; d.erros_cnpj = 0
        return perguntar()
      }
      if (soNumero && digitos.length === 11) {
        if (!cpfValido(digitos)) return invalido(CFG.msg_cpf_invalido)
        if (conferir({ documento_: digitos }).documento.em_uso) return encerrar('ja_cadastrado', trocar(CFG.msg_documento_em_uso, { documento: 'CPF', atendimento: atendimento() }), true)
        d.cpf = digitos; d.sem_cnpj = true; d.erros = 0; return perguntar('Anotado! 💗')
      }
      if (soNumero) return invalido(d.sem_cnpj ? CFG.msg_cpf_invalido : preencher(CFG.msg_cnpj_invalido, { motivo: 'um CNPJ tem 14 números' }))
      return sair(d.sem_cnpj ? PERGUNTA.cpf : PERGUNTA.documento, 'conversa')
    }
    case 'endereco':
      if (d.confirmando_endereco) {
        if (disseSim) { d.endereco = d.endereco_cnpj; d.confirmando_endereco = false; return perguntar('Perfeito! 💗') }
        if (NAO_CURTO.test(p)) { d.confirmando_endereco = false; return perguntar() }
        d.endereco = { texto: t.slice(0, 160), cidade: d.endereco_cnpj?.cidade ?? '' }; d.confirmando_endereco = false; return perguntar('Anotado! 💗')
      }
      if (d.pedindo_cep) {
        if (NAO_SEI.test(p)) { d.pedindo_cep = false; d.sem_cep = true; return perguntar() }
        if (!soNumero || digitos.length !== 8) return invalido(preencher(CFG.msg_cep_invalido, { motivo: digitos.length === 8 ? 'não existe na base dos Correios' : 'um CEP tem 8 números' }))
        if (digitos !== '11740000') return invalido(preencher(CFG.msg_cep_invalido, { motivo: 'não existe na base dos Correios' }))
        d.endereco_cep = CEP_DEMO; d.pedindo_cep = false; d.pedindo_numero = true; d.erros = 0
        return perguntar()
      }
      if (d.pedindo_numero) {
        const m = t.match(/\d+\s*[a-zA-Z]?\b/)
        if (/\b(sem numero|s\/n|sn)\b/.test(p)) { d.endereco = { ...d.endereco_cep, numero: 's/n' }; d.pedindo_numero = false; return perguntar('Anotado! 💗') }
        if (!m) return sair('Me manda só o número do endereço (ou *sem número*, se não tiver)?', 'conversa')
        const complemento = t.replace(m[0], '').replace(/^[,\-–. ]+/, '').trim()
        d.endereco = { ...d.endereco_cep, numero: m[0].trim(), complemento: complemento || undefined }; d.pedindo_numero = false
        return perguntar('Anotado! 💗')
      }
      d.endereco = { texto: t.slice(0, 160), cidade: (t.match(/(?:em|,)\s*([A-Za-zÀ-ú ]+)$/) ?? [])[1]?.trim() ?? '' }
      return perguntar('Anotado! 💗')
    case 'nome': {
      const nome = disseSim && (d.nome_fantasia || d.razao_social) ? (d.nome_fantasia || d.razao_social) : t.slice(0, 80)
      const ja = conferir({ nome_: nome }).nome
      if (ja.em_uso) return sair(trocar(CFG.msg_nome_em_uso, { nome, cidade: ja.cidade ? ` (em ${ja.cidade})` : '' }), 'validacao')
      d.nome = nome
      return perguntar(`${d.nome}, lindo nome! 💗`)
    }
    case 'profissionais': {
      const n = Number((p.match(/\b(\d{1,3})\b/) ?? [])[1]) || (/\b(so eu|sozinha|uma|um)\b/.test(p) ? 1 : 0)
      if (!n) return sair('Me diz um número: quantas profissionais atendem aí, contando você?', 'conversa')
      d.profissionais = n; return perguntar()
    }
    case 'servicos': d.servicos = t.split(/[,;\n]| e /).map((x) => x.trim()).filter(Boolean).slice(0, 12); return perguntar('Ótimo! 💗')
    case 'horarios': d.horarios = t.slice(0, 200); return perguntar()
    case 'email': {
      const m = t.match(/[^\s@<>()]+@[^\s@<>()]+/)
      if (d.confirmando_email) {
        if (disseSim) { d.confirmando_email = false; return perguntar('Perfeito! 💗') }
        if (m) return tratarEmail(m[0].replace(/[.,;!?]+$/, ''))
        if (NAO_CURTO.test(p)) { delete d.email; d.confirmando_email = false; return sair('Sem problema! Me manda o e-mail certo?', 'conversa') }
        return sair(trocar(CFG.msg_email_confirmar, { email: d.email }), 'conversa')
      }
      if (!m) return invalido(CFG.msg_email_invalido)
      return tratarEmail(m[0].replace(/[.,;!?]+$/, ''))
    }
    case 'telefone':
      if (!d.telefone_salao) {
        if (disseSim) { d.telefone_salao = NUMERO_DELA; return perguntar() }
        if (digitos.length >= 10) return tratarTelefone(t, false)
        return invalido(CFG.msg_telefone_invalido)
      }
      if (SO_ESSE.test(p) || NAO_CURTO.test(p)) { d.telefones_ok = true; return perguntar('Combinado! 💗') }
      if (digitos.length >= 10) return tratarTelefone(t, true)
      return invalido(CFG.msg_telefone_invalido)
    case 'explicacoes':
      if (disseSim || NAO_CURTO.test(p) || /\b(sem duvida|tudo certo|entendi|pode mandar|manda o link)\b/.test(p)) { d.explicacoes_ok = true; return perguntar() }
      return sair('Boa pergunta! A equipe da MIMO confirma os detalhes com você. Mais alguma dúvida, ou posso mandar o link?', 'conversa')
    case 'resumo': {
      if (disseSim) { d.resumo_ok = true; return perguntar() }
      const m = t.match(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i)
      if (m) { d.resumo_mostrado = false; return tratarEmail(m[0]) }
      const nm = t.match(/nome (?:certo )?(?:é|e) (.+)$/i)
      if (nm) { d.nome = nm[1].trim().slice(0, 80); return perguntar() }
      const nprof = p.match(/\b(\d{1,3}) profissiona/); if (nprof) { d.profissionais = Number(nprof[1]); return perguntar() }
      return sair('Me diz o que está errado — o nome, o endereço, o e-mail, o telefone, os serviços ou os horários — e o certo, que eu arrumo. 💗', 'conversa')
    }
    default: return perguntar()
  }
}
export function reiniciarOnboarding() { SIM = null }
