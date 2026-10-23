// O WhatsApp do guia (3.48, migração 195): a Mel pré-atende quem veio de um salão do guia e passa o pedido ao salão.
//
// A cliente toca em WhatsApp, Ligar ou "Quero marcar" na página de um salão que ainda não está na MIMO e abre uma
// conversa com o NOSSO número, com o código do salão na mensagem ("código: itanhaem/studio-lirio"). A Mel diz quem é,
// anota nome, serviço e preferência, mostra o resumo e pede licença para enviar. Com o "sim", o pedido sai do nosso
// número para o WhatsApp do salão, com o link para falar com a cliente. O salão que responde ao pedido recebe uma
// resposta uma vez só (QUERO: a equipe da MIMO chama; SAIR: para de receber; VOLTAR: volta a receber).
//
// Este arquivo não fala com a rede nem com o banco por conta própria: recebe tudo em `Deps` (o webhook e a função
// guia-whats montam as de verdade; os testes, as de mentira). As regras de dado (quem saiu, limite do dia, um pedido por
// conversa) moram no banco (guia_whats_*), como no resto do WhatsApp.

export type Resultado = { ok: true; providerId: string | null } | { ok: false; erro: string }
export type Mensagem = { role: 'user' | 'assistant'; content: string }
export type PedidoIa = { provedor: string; modelo: string; sistema: string; mensagens: Mensagem[] }
export type LeituraIa = {
  resposta: string; nome: string; servico: string; preferencia: string; observacao: string
  cliente_confirmou_envio: boolean; cancelar: boolean; quer_apagar_dados: boolean
}
export type Deps = {
  rpc: (nome: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>
  ia: (p: PedidoIa) => Promise<{ leitura: LeituraIa | null; erro?: string; modelo?: string }>
  enviar: (instancia: string, telefone: string, texto: string) => Promise<Resultado>
  agora?: () => Date
}
export type Entrada = { telefone: string; texto: string; nomePerfil?: string | null; citado?: string | null }
export type Saida = {
  responder: string | null
  acao: string
  previaSalao?: string | null
  estado?: string
  dados?: Dados
  erro?: string
}
type Dados = { nome?: string; servico?: string; preferencia?: string; observacao?: string; pos_envio?: number; sem_avanco?: number; dona?: boolean }
type Lugar = {
  id: string; nome: string; categoria?: string | null; cidade?: string | null; cidade_slug?: string; slug?: string; uf?: string | null
  bairro?: string | null; endereco?: string | null; servicos?: string[] | null; horarios?: unknown; telefone?: string | null; whatsapp?: string | null
  salao_tel?: string | null; salao_saiu?: boolean; agendar?: string | null
}
type Conversa = { id: number; telefone: string; lugar_id: string | null; estado: string; dados: Dados; mensagens: Array<{ q: string; t: string; em?: string }>; lugar?: Lugar | null }
type Config = {
  ligado: boolean; numero: string | null; numero_avisos?: string | null; instancia: string; provedor: string; modelo: string | null; orientacao: string
  msg_cliente: string; msg_salao: string; msg_salao_resposta: string; mostrar_contato_salao: boolean; limite_respostas?: number | null
  // 3.51: o ciclo da conversa, configurável na Plataforma (os números abaixo têm padrão quando a config não trouxe)
  msg_encerramento?: string | null; exigir_preferencia?: boolean; pos_envio?: number | null; max_sem_avanco?: number | null; ocioso_horas?: number | null
  // 3.54: a mensagem que a Mel manda quando reconhece a própria dona testando o salão ({salao} e {exemplo})
  msg_dona?: string | null
}

export const MODELO_PADRAO: Record<string, string> = { groq: 'openai/gpt-oss-120b', claude: 'claude-haiku-5-5' }
export const RAIZ_SITE = 'mimo.com.vc'

// ---- textos e números ----------------------------------------------------------------------------------------------
export const so = (t: unknown) => String(t ?? '').replace(/\D/g, '')
// '5513999998888' → '(13) 99999-8888' (fora do Brasil, + e os dígitos)
export function telefoneBonito(e164: string | null | undefined): string {
  const d = so(e164)
  if (d.length === 13 && d.startsWith('55')) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`
  if (d.length === 12 && d.startsWith('55')) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`
  return d ? `+${d}` : ''
}
// minúsculo, sem acento, sem pontuação nas pontas (para reconhecer SAIR, QUERO, VOLTAR...)
export const palavra = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

// a mesma "chave" do banco (telefone_e164 + guia_whats_chave): normaliza para comparar o número de quem escreve com o
// cadastrado do salão (celular com e sem o 9º dígito batem). Usada para reconhecer a dona testando o próprio salão (3.54).
function e164Local(bruto: string | null | undefined): string | null {
  const d = so(bruto).replace(/^0+/, '')
  if (d.length < 10) return null
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d
  if (d.length === 10 || d.length === 11) return '55' + d
  return null
}
export function chaveDe(tel: string | null | undefined): string | null {
  const d = e164Local(tel)
  if (d === null) return String(tel ?? '').trim() || null
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') return d.slice(0, 4) + d.slice(5)
  return d
}

// 3.49.2: o que dispensa a IA (token à toa). Depois do resumo, um "sim" ou "não" seco (ou um 👍) já decide; depois do
// envio, a Mel responde mais POS_ENVIO vezes e fica quieta; só emoji não vai à IA; e o teto do dia (limite_respostas)
const SIM_CURTO = /^(sim|s|ss|sim sim|sim pode|sim quero|ok|okay|okey|pode|pode sim|pode ser|pode enviar|pode mandar|pode manda|pode ir|isso|isso mesmo|isso ai|claro|claro que sim|confirmo|confirmado|manda|manda sim|envia|enviar|certo|beleza|bora|vai|vamos|yes|uhum|aham|correto|perfeito|otimo|top|show|fechado|fechou|combinado|quero|quero sim)$/
const NAO_CURTO = /^(nao|n|nao quero|nao precisa|nao obrigada|nao obrigado|nao nao|cancela|cancelar|cancele|desisto|desisti|deixa|deixa pra la|esquece|esqueca)$/
const SIM_EMOJI = /^(?:\s|👍|✅|👌|🙏|💗|\u2764|\uFE0F|🥰|😊|[\u{1F3FB}-\u{1F3FF}])+$/u
export const POS_ENVIO = 3

// o código do salão na mensagem: "código: itanhaem/studio-lirio", "ref itanhaem/studio-lirio", o link da página ou,
// desde a 3.49.2, um "itanhaem/studio-lirio" solto (datas como 15/10 e 24/7 não contam)
// 3.49.7: o token do pedido dentro de um texto (o link mimo.com.vc/r/<token> que vai na mensagem ao salão). Serve
// para amarrar a resposta do salão ao pedido certo quando ele responde citando a nossa mensagem.
export function tokenDoTexto(texto: string): string | null {
  const m = String(texto ?? '').match(/\/r\/([a-zA-Z0-9]{8,40})/)
  return m ? m[1] : null
}

export function codigoDoTexto(texto: string): { cidade: string; slug: string } | null {
  const t = String(texto ?? '')
  const m = t.match(/(?:c[oó]digo|ref)\s*[:#]?\s*([a-z0-9-]{2,60})\/([a-z0-9-]{2,80})/i) ?? t.match(/\/saloes\/([a-z0-9-]{2,60})\/([a-z0-9-]{2,80})/i)
    ?? t.match(/(?:^|[\s(:,"'])([a-z0-9][a-z0-9-]{1,59})\/([a-z0-9][a-z0-9-]{1,79})(?=$|[\s).,!?;"'])/i)
  if (!m) return null
  const cidade = m[1].toLowerCase(), slug = m[2].toLowerCase()
  if (['bairro', 'horario', 'regiao'].includes(slug) || cidade === 'regiao' || cidade === 'saloes') return null
  if (/^\d+$/.test(cidade) || /^\d+$/.test(slug)) return null
  return { cidade, slug }
}

// a mensagem pronta do site (src/lib/guiaContato.js monta igual): a frase da Plataforma + o código do salão
export function mensagemDaCliente(modelo: string, salao: string, cidadeSlug: string, slug: string): string {
  return `${String(modelo || '').replaceAll('{salao}', salao).trim()}\n\n(código: ${cidadeSlug}/${slug})`
}

// preenche um modelo da Plataforma; a linha cujo campo veio vazio sai inteira ("Observação: {observacao}" sem observação)
export function preencher(modelo: string, valores: Record<string, string | null | undefined>): string {
  const linhas = String(modelo ?? '').split('\n')
  const saida: string[] = []
  for (const linha of linhas) {
    let vazio = false
    const nova = linha.replace(/\{([a-z_]+)\}/g, (inteiro, chave: string) => {
      if (!(chave in valores)) return inteiro
      const v = String(valores[chave] ?? '').trim()
      if (!v) vazio = true
      return v
    })
    if (!vazio) saida.push(nova)
  }
  return saida.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// o link para o salão falar com a cliente, já com a primeira frase
// 3.49.6: o link rastreável do pedido, no nosso domínio. O site (rota /r/:token) registra o clique e redireciona
// para a conversa com a cliente. Um por pedido; só serve para ele e some quando o pedido expira.
export function linkDoPedido(token: string): string {
  return `https://${RAIZ_SITE}/r/${token}`
}

export function linkParaCliente(clienteTel: string, nome: string, salao: string, servico: string): string {
  const frase = `Olá${nome ? `, ${nome}` : ''}! Aqui é do ${salao}. Recebi seu pedido${servico ? ` de ${servico}` : ''} pela MIMO.`
  return `https://wa.me/${so(clienteTel)}?text=${encodeURIComponent(frase)}`
}

export function mensagemDoSalao(cfg: Pick<Config, 'msg_salao'>, l: { nome: string }, d: { cliente_nome?: string | null; servico?: string | null; preferencia?: string | null; observacao?: string | null; cliente_tel: string; token?: string | null }): string {
  return preencher(cfg.msg_salao, {
    salao: l.nome,
    cliente: d.cliente_nome ?? '',
    servico: d.servico ?? '',
    preferencia: d.preferencia ?? '',
    observacao: d.observacao ?? '',
    contato: telefoneBonito(d.cliente_tel),
    // 3.49.6: com token, o link vira o rastreável (mimo.com.vc/r/<token>): registra o clique do salão e leva à cliente.
    // Sem token (prévia do simulador), o wa.me direto, como antes.
    link: d.token ? linkDoPedido(d.token) : linkParaCliente(d.cliente_tel, d.cliente_nome ?? '', l.nome, d.servico ?? ''),
  })}

export function resumo(d: Dados, salao: string): string {
  return [
    'Anotei assim:',
    `• Nome: ${d.nome}`,
    `• Serviço: ${d.servico}`,
    ...(d.preferencia ? [`• Preferência: ${d.preferencia}`] : []),
    ...(d.observacao ? [`• Observação: ${d.observacao}`] : []),
    '',
    `Posso enviar seu nome, este WhatsApp e o pedido para o ${salao}? Eles te chamam aqui para combinar. É só responder *sim*.`,
  ].join('\n')
}

function contatoDoSalao(l: Lugar): string {
  if (l.whatsapp) return `${telefoneBonito(l.salao_tel ?? so(l.whatsapp))} (WhatsApp): https://wa.me/${so(l.salao_tel ?? l.whatsapp)}`
  if (l.telefone) return telefoneBonito(so(l.telefone).length >= 12 ? so(l.telefone) : `55${so(l.telefone)}`)
  return ''
}

// ---- o que a Mel sabe a cada mensagem ---------------------------------------------------------------------------------
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
function agoraTexto(d: Date): string {
  const sp = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  return `${DIAS[sp.getDay()]}, ${sp.toLocaleDateString('pt-BR')} ${String(sp.getHours()).padStart(2, '0')}:${String(sp.getMinutes()).padStart(2, '0')}`
}
export function sistema(cfg: Config, l: Lugar, d: Dados, estado: string, nomePerfil: string | null | undefined, agora: Date): string {
  const servicos = (l.servicos ?? []).filter(Boolean).slice(0, 25).join(', ')
  const horario = l.horarios ? JSON.stringify(l.horarios).slice(0, 600) : ''
  return [
    String(cfg.orientacao).replaceAll('{salao}', l.nome),
    '',
    'O SALÃO (onde ela quer marcar)',
    `- Nome: ${l.nome}${l.categoria ? ` (${l.categoria})` : ''}`,
    `- Onde: ${[l.endereco, l.bairro, l.cidade && `${l.cidade}${l.uf ? `-${l.uf}` : ''}`].filter(Boolean).join(', ') || 'não informado'}`,
    servicos ? `- Serviços no cadastro: ${servicos}` : '- Serviços: não informados no cadastro',
    horario ? `- Horário de funcionamento (do cadastro): ${horario}` : '- Horário de funcionamento: não informado',
    `- Agora: ${agoraTexto(agora)} (horário de Brasília)`,
    '',
    'O QUE JÁ ANOTEI',
    `- Nome: ${d.nome || 'ainda não sei'}${!d.nome && nomePerfil ? ` (o perfil do WhatsApp diz "${nomePerfil}"; confirme antes de usar)` : ''}`,
    `- Serviço: ${d.servico || 'ainda não sei'}`,
    `- Preferência de dia e horário: ${d.preferencia || 'ainda não sei'}`,
    `- Observação: ${d.observacao || 'nenhuma'}`,
    `- Estado: ${estado === 'confirmando' ? 'confirmando (já mostrei o resumo e perguntei se posso enviar ao salão)' : estado === 'enviado' ? 'enviado (o pedido já foi para o salão; só tire dúvidas, não peça os dados de novo)' : 'conversando'}`,
    `- Para enviar ao salão, o essencial é ${cfg.exigir_preferencia ? 'o nome, o serviço e a preferência de dia e horário' : 'o nome e o serviço (a preferência de dia e horário é um extra: se ela não disser, tudo bem, dá para enviar assim mesmo)'}. Se faltar o essencial, peça com gentileza; não repita a mesma pergunta várias vezes seguidas.`,
    '',
    'RESPONDA SÓ COM OS CAMPOS',
    '- resposta: a mensagem para a cliente.',
    '- nome, servico, preferencia, observacao: o que ela disse nesta conversa (texto vazio se não disse; não invente; preferência é dia e/ou período, como "sexta à tarde").',
    '- cliente_confirmou_envio: true só se o estado é confirmando e ela respondeu que sim, que pode enviar.',
    '- cancelar: true se ela desistiu do pedido.',
    '- quer_apagar_dados: true se ela pediu para apagar os dados dela.',
  ].join('\n')
}

export const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    resposta: { type: 'string' },
    nome: { type: 'string' },
    servico: { type: 'string' },
    preferencia: { type: 'string' },
    observacao: { type: 'string' },
    cliente_confirmou_envio: { type: 'boolean' },
    cancelar: { type: 'boolean' },
    quer_apagar_dados: { type: 'boolean' },
  },
  required: ['resposta', 'nome', 'servico', 'preferencia', 'observacao', 'cliente_confirmou_envio', 'cancelar', 'quer_apagar_dados'],
}

// ---- a conversa -----------------------------------------------------------------------------------------------------
const SAIR = /^(sair|parar|pare|stop|cancelar avisos|nao quero receber|descadastrar)$/
const VOLTAR = /^(voltar|voltar a receber)$/
const QUERO = /\bquero\b/
const APAGAR = /\b(apag|exclu|delet|remov)[a-z]*\b.*\b(dados|conversa|numero|informac)/
const limpo = (t: unknown, n: number) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

async function chamar(deps: Deps, nome: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await deps.rpc(nome, args)
  if (error) throw new Error(`${nome}: ${error.message ?? 'erro'}`)
  return data
}

export async function atenderGuia(deps: Deps, e: Entrada, opcoes: { teste?: boolean } = {}): Promise<Saida> {
  const teste = !!opcoes.teste
  const agora = deps.agora?.() ?? new Date()
  const tel = teste ? e.telefone : so(e.telefone)
  const texto = String(e.texto ?? '').trim().slice(0, 1500)
  if (!tel || !texto) return { responder: null, acao: 'vazio' }
  const ctx = (await chamar(deps, 'guia_whats_contexto', { tel_: tel })) as { config: Config; saida: string | null; conversa: Conversa | null; respostas_hoje?: number; lead_salao: { id: number; salao_nome: string; status: string; ja_respondeu: boolean } | null }
  const cfg = ctx?.config
  if (!cfg) return { responder: null, acao: 'sem_config' }
  if (!cfg.ligado && !teste) return { responder: null, acao: 'desligado' }
  const p = palavra(texto)
  const codigo = codigoDoTexto(texto)
  const conversaAberta = ctx.conversa && ctx.conversa.estado !== 'encerrada' ? ctx.conversa : null
  const em = agora.toISOString()

  // 1. o salão respondendo ao pedido que recebeu (sem conversa de cliente aberta neste número)
  if (!teste && !conversaAberta && !codigo) {
    if (ctx.saida === 'salao' && VOLTAR.test(p)) {
      await chamar(deps, 'guia_whats_sair', { tel_: tel, quem_: 'salao', sair_: false })
      return { responder: 'Pronto! 💗 Você volta a receber os pedidos das clientes que te encontram pela MIMO.', acao: 'salao_voltou' }
    }
    if (ctx.lead_salao) {
      if (SAIR.test(p)) {
        await chamar(deps, 'guia_whats_sair', { tel_: tel, quem_: 'salao', sair_: true })
        return { responder: 'Combinado, você não vai mais receber pedidos da MIMO por aqui. Se mudar de ideia, é só escrever VOLTAR.', acao: 'salao_saiu' }
      }
      const quer = QUERO.test(p)
      // a qual pedido esta resposta se refere: a mensagem citada (com o token) manda; senão o pedido que o contexto
      // escolheu (o que o salão tocou por último, ou o mais recente)
      let alvo = ctx.lead_salao.id
      const tk = e.citado ? tokenDoTexto(e.citado) : null
      if (tk) { const id = await chamar(deps, 'guia_whats_lead_do_salao', { tel_: tel, token_: tk }); if (id) alvo = Number(id) }
      await chamar(deps, 'guia_whats_salao_respondeu', { lead_: alvo, texto_: texto, quer_: quer })
      if (quer) return { responder: 'Combinado! 💗 Alguém da equipe da MIMO vai te chamar por aqui.', acao: 'salao_quer_conhecer' }
      // responde uma vez só: depois disso, o que o salão escrever fica guardado para a equipe ver
      return { responder: ctx.lead_salao.ja_respondeu ? null : cfg.msg_salao_resposta, acao: 'salao_respondeu' }
    }
  }

  // 2. "apagar meus dados"
  if (!teste && APAGAR.test(p)) {
    await chamar(deps, 'guia_whats_apagar', { tel_: tel })
    return { responder: 'Pronto, apaguei seus dados e esta conversa aqui na MIMO. 💗 Se precisar de novo, é só chamar.', acao: 'apagou' }
  }

  // 3. de qual salão é a conversa: o código manda; sem código, a conversa aberta; sem nada, pelo nome
  let conversa: Conversa | null = conversaAberta
  let lugar: Lugar | null = conversa?.lugar ?? null
  if (codigo && (!lugar || lugar.cidade_slug !== codigo.cidade || lugar.slug !== codigo.slug)) {
    const l = (await chamar(deps, 'guia_whats_lugar', { cidade_: codigo.cidade, slug_: codigo.slug })) as Lugar | null
    if (l) { lugar = l; conversa = null }
  }
  const novas: Array<{ q: string; t: string; em: string }> = [{ q: 'cliente', t: texto, em }]
  const guardar = async (resposta: string | null, estado: string, dados: Dados, lugarId: string | null) => {
    if (resposta) novas.push({ q: 'mel', t: resposta, em })
    const id = await chamar(deps, 'guia_whats_conversa_salvar', { id_: conversa?.id ?? null, tel_: tel, lugar_: lugarId, estado_: estado, dados_: dados, novas_: novas, teste_: teste })
    if (!conversa) conversa = { id: Number(id), telefone: tel, lugar_id: lugarId, estado, dados, mensagens: [] }
  }

  if (!lugar) {
    const achados = p.length >= 4 ? ((await chamar(deps, 'guia_whats_buscar', { texto_: texto })) as Array<{ id: string; nome: string; cidade: string }>) : []
    if (achados?.length === 1) {
      lugar = (await chamar(deps, 'guia_whats_lugar', { cidade_: null, slug_: null, id_: achados[0].id })) as Lugar | null
    }
    if (!lugar) {
      const resposta = achados?.length > 1
        ? `Oi! Aqui é a Mel, da MIMO 💗. Encontrei mais de um salão com esse nome: ${achados.map((a) => `${a.nome} (${a.cidade})`).join(', ')}. Qual deles? Se puder, me manda o link da página do salão no guia.`
        : 'Oi! Aqui é a Mel, da MIMO 💗, o guia de salões. De qual salão você quer marcar? Me manda o nome como aparece no guia ou o link da página do salão.'
      await guardar(resposta, 'conversando', conversa?.dados ?? {}, null)
      return { responder: resposta, acao: 'sem_salao', estado: 'conversando' }
    }
  }

  // 4. salão que já agenda pela MIMO: o link da agenda. (Salão sem WhatsApp no cadastro, ou que pediu para não receber,
  // é atendido do mesmo jeito: a Mel anota, o envio é tentado no número que há, e o que não sai fica para a equipe na
  // Plataforma. Nunca se passa o telefone do salão à cliente.)
  if (lugar.agendar) {
    const resposta = `Oi! Aqui é a Mel, da MIMO 💗. O ${lugar.nome} já agenda pela MIMO: é só escolher o serviço e o horário aqui 👉 https://${lugar.agendar}.${RAIZ_SITE}`
    await guardar(resposta, 'encerrada', {}, lugar.id)
    return { responder: resposta, acao: 'agenda_mimo', estado: 'encerrada' }
  }

  // 4.5: a própria dona testando (o número de quem escreve é o mesmo cadastrado do salão). Em vez do fluxo de cliente, a
  // Mel reconhece, mostra como um pedido chegaria (o exemplo) e apresenta a MIMO Agenda; avisa a equipe uma vez (3.54).
  if (!teste && lugar.salao_tel && chaveDe(tel) && chaveDe(tel) === chaveDe(lugar.salao_tel)) {
    const exemplo = mensagemDoSalao(cfg, lugar, { cliente_nome: 'Maria (exemplo)', servico: 'Corte e escova', preferencia: 'sexta à tarde', observacao: null, cliente_tel: '5513999990000' })
    const resposta = (String(cfg.msg_dona ?? '').trim() || `Oi! 💗 Esse número é o que o ${lugar.nome} tem cadastrado no guia da MIMO. Assim chega um pedido de cliente pra você:\n\n{exemplo}\n\nA MIMO leva clientes até você, de graça — e tem a MIMO Agenda pra organizar tudo (salão e autônoma). A equipe vai te chamar pra mostrar. 💗`)
      .replaceAll('{salao}', lugar.nome).replaceAll('{exemplo}', exemplo)
    const jaAvisou = (ctx.conversa?.dados as Dados | undefined)?.dona === true
    await guardar(resposta, 'encerrada', { dona: true }, lugar.id)
    if (!jaAvisou && cfg.numero_avisos) {
      try { await deps.enviar(cfg.instancia, so(cfg.numero_avisos), avisoDona(lugar, tel)) } catch { /* o aviso é melhor-esforço */ }
    }
    return { responder: resposta, acao: 'dona', estado: 'encerrada', dados: { dona: true } }
  }

  // 5. a conversa com a Mel
  const estadoAntes = conversa?.estado ?? 'conversando'
  const dadosAntes: Dados = { ...(conversa?.dados ?? {}) }
  // 3.49.2: o teto do dia por número (a Plataforma configura): avisa uma vez, depois silêncio
  const limite = Math.max(1, Number(cfg.limite_respostas) || 30)
  const hoje = Number(ctx.respostas_hoje ?? 0)
  if (!teste && hoje >= limite) {
    if (hoje > limite) return { responder: null, acao: 'limite_respostas', estado: estadoAntes }
    const resposta = `Por hoje já conversamos bastante por aqui 💗 Amanhã a gente continua. Se já me passou seu pedido, o ${lugar.nome} te chama.`
    await guardar(resposta, estadoAntes, dadosAntes, lugar.id)
    return { responder: resposta, acao: 'limite_respostas', estado: estadoAntes }
  }
  // depois do envio: mais pos_envio respostas (dúvidas), uma despedida e silêncio (a Plataforma configura; padrão POS_ENVIO)
  const posEnvioMax = Math.max(0, Number(cfg.pos_envio ?? POS_ENVIO))
  const depois = Number(dadosAntes.pos_envio ?? 0)
  if (estadoAntes === 'enviado' && depois >= posEnvioMax) {
    if (depois > posEnvioMax) return { responder: null, acao: 'pos_envio', estado: estadoAntes }
    const resposta = `O ${lugar.nome} já recebeu seu pedido e vai te chamar por aqui 💗 Se quiser marcar em outro salão, me manda o link da página dele no guia.`
    await guardar(resposta, estadoAntes, { ...dadosAntes, pos_envio: depois + 1 }, lugar.id)
    return { responder: resposta, acao: 'pos_envio', estado: estadoAntes }
  }
  // o "sim"/"não" seco depois do resumo decide sem IA; só emoji (fora disso) não vai à IA
  const curto = estadoAntes === 'confirmando' ? (SIM_CURTO.test(p) || (!p && SIM_EMOJI.test(texto)) ? 'sim' : NAO_CURTO.test(p) ? 'nao' : null) : null
  if (!p && !curto) {
    const resposta = 'Só consigo ler texto por aqui 😅 Me escreve o que você precisa?'
    await guardar(resposta, estadoAntes, dadosAntes, lugar.id)
    return { responder: resposta, acao: 'sem_texto', estado: estadoAntes }
  }
  let r: Awaited<ReturnType<typeof deps.ia>>
  if (curto) {
    r = { leitura: { resposta: '', nome: '', servico: '', preferencia: '', observacao: '', cliente_confirmou_envio: curto === 'sim', cancelar: curto === 'nao', quer_apagar_dados: false } }
  } else {
    const historico: Mensagem[] = (conversa?.mensagens ?? []).slice(-12).map((m) => ({ role: m.q === 'cliente' ? 'user' as const : 'assistant' as const, content: String(m.t ?? '').slice(0, 500) }))
    historico.push({ role: 'user', content: texto })
    r = await deps.ia({ provedor: cfg.provedor, modelo: cfg.modelo || MODELO_PADRAO[cfg.provedor] || MODELO_PADRAO.groq, sistema: sistema(cfg, lugar, dadosAntes, estadoAntes, e.nomePerfil, agora), mensagens: historico })
  }
  if (!r.leitura) {
    const resposta = 'Desculpa, me enrolei aqui. Pode me mandar de novo?'
    await guardar(resposta, estadoAntes, dadosAntes, lugar.id)
    return { responder: resposta, acao: 'erro_ia', erro: r.erro, estado: estadoAntes, dados: dadosAntes }
  }
  const lido = r.leitura
  if (lido.quer_apagar_dados && !teste) {
    await chamar(deps, 'guia_whats_apagar', { tel_: tel })
    return { responder: 'Pronto, apaguei seus dados e esta conversa aqui na MIMO. 💗 Se precisar de novo, é só chamar.', acao: 'apagou' }
  }
  const dados: Dados = { ...dadosAntes }
  for (const k of ['nome', 'servico', 'preferencia', 'observacao'] as const) {
    const v = limpo(lido[k], k === 'observacao' ? 300 : 120)
    if (v) dados[k] = v
  }
  const mudou = (['nome', 'servico', 'preferencia', 'observacao'] as const).some((k) => (dados[k] ?? '') !== (dadosAntes[k] ?? ''))
  if (estadoAntes === 'enviado') dados.pos_envio = depois + 1
  // o essencial para enviar: nome e serviço. A preferência de dia/horário só trava o envio se a Plataforma pedir.
  const exigirPreferencia = !!cfg.exigir_preferencia
  const maxSemAvanco = Math.max(2, Number(cfg.max_sem_avanco ?? 6))
  const completo = !!(dados.nome && dados.servico && (!exigirPreferencia || dados.preferencia))

  if (lido.cancelar && estadoAntes !== 'enviado') {
    const resposta = limpo(lido.resposta, 1200) || 'Tudo bem! Se quiser marcar depois, é só chamar. 💗'
    await guardar(resposta, 'encerrada', dados, lugar.id)
    return { responder: resposta, acao: 'cancelou', estado: 'encerrada', dados }
  }

  // sem avançar: se a cliente escreve e a conversa não anda (sem dado novo e ainda sem o essencial), a Mel insiste com
  // gentileza; depois de max_sem_avanco mensagens assim, encerra com a mensagem configurada. Não vale no resumo
  // (confirmando) nem depois do envio — lá quem decide são o "sim/não" e o pos_envio.
  if (!completo && estadoAntes !== 'confirmando' && estadoAntes !== 'enviado' && !lido.cliente_confirmou_envio) {
    const semAvanco = mudou ? 0 : Number(dadosAntes.sem_avanco ?? 0) + 1
    dados.sem_avanco = semAvanco
    if (semAvanco >= maxSemAvanco) {
      const resposta = limpo(cfg.msg_encerramento, 1000) || 'Tudo bem! 💗 Quando quiser marcar, é só me chamar aqui. Até logo!'
      await guardar(resposta, 'encerrada', { ...dados, sem_avanco: 0 }, lugar.id)
      return { responder: resposta, acao: 'sem_avanco', estado: 'encerrada', dados }
    }
  } else {
    dados.sem_avanco = 0
  }

  // o "sim" depois do resumo: o pedido vai para o salão
  if (estadoAntes === 'confirmando' && lido.cliente_confirmou_envio && completo && !mudou) {
    if (teste) {
      const previa = mensagemDoSalao(cfg, lugar, { cliente_nome: dados.nome, servico: dados.servico, preferencia: dados.preferencia, observacao: dados.observacao, cliente_tel: '5513999990000' })
      const resposta = confirmacao(cfg, lugar, dados, true)
      await guardar(resposta, 'enviado', dados, lugar.id)
      return { responder: resposta, acao: 'enviado_teste', previaSalao: previa, estado: 'enviado', dados }
    }
    await guardar(null, 'enviado', dados, lugar.id)
    const ld = (await chamar(deps, 'guia_whats_lead_criar', { conversa_: conversa!.id })) as { id: number; status: string; token?: string | null; salao_tel: string | null; cliente_nome: string | null; servico: string | null; preferencia: string | null; observacao: string | null; cliente_tel: string; repetido: boolean }
    let ok = false
    let previa: string | null = null
    if (ld?.status === 'pendente' && ld.salao_tel) {
      previa = mensagemDoSalao(cfg, lugar, ld)
      const env = await deps.enviar(cfg.instancia, ld.salao_tel, previa)
      ok = env.ok
      await chamar(deps, 'guia_whats_lead_resultado', { lead_: ld.id, ok_: env.ok, provider_: env.ok ? env.providerId : null, erro_: env.ok ? null : env.erro, mensagem_: previa })
    } else if (ld?.repetido) {
      ok = ld.status !== 'falhou'
    } else if (ld?.status === 'sem_contato' && cfg.numero_avisos) {
      // o salão não tem WhatsApp (ou o número é o da própria cliente): a cliente segue normal, mas avisamos a equipe no
      // nosso número, para não ficar um pedido no vazio e para dar para medir. O aviso é melhor-esforço (não trava a cliente).
      try { await deps.enviar(cfg.instancia, so(cfg.numero_avisos), avisoEquipe(lugar, ld)) } catch { /* segue sem o aviso */ }
    }
    const resposta = confirmacao(cfg, lugar, dados, ok)
    await guardar(resposta, 'enviado', dados, lugar.id)
    return { responder: resposta, acao: ok ? 'enviado' : `pedido_${ld?.status ?? 'erro'}`, previaSalao: previa, estado: 'enviado', dados }
  }

  // tudo anotado (ou mudou algo depois do resumo): o resumo e o pedido de licença, com as nossas palavras
  if (completo && estadoAntes !== 'enviado' && (estadoAntes === 'conversando' || mudou)) {
    const resposta = resumo(dados, lugar.nome)
    await guardar(resposta, 'confirmando', dados, lugar.id)
    return { responder: resposta, acao: 'resumo', estado: 'confirmando', dados }
  }

  const resposta = limpo(lido.resposta, 1500) || 'Me conta mais um pouquinho?'
  const estado = estadoAntes === 'enviado' ? 'enviado' : completo ? estadoAntes : 'conversando'
  await guardar(resposta, estado, dados, lugar.id)
  return { responder: resposta, acao: 'conversa', estado, dados }
}

// 3.53: o aviso interno à equipe quando o salão não tem WhatsApp para receber o pedido (ou o número é o da própria
// cliente). Vai para o nosso número (numero_avisos), nunca para a cliente. É um recado de operação, não um texto dela.
function avisoEquipe(l: Lugar, ld: { cliente_nome?: string | null; cliente_tel?: string | null; servico?: string | null; preferencia?: string | null; cidade?: string | null }): string {
  const onde = [l.nome, ld.cidade ?? l.cidade].filter(Boolean).join(' · ')
  return [
    '⚠️ MIMO — salão sem WhatsApp',
    `${onde} não tem WhatsApp para receber o pedido.`,
    `Cliente: ${ld.cliente_nome || 'sem nome'}${ld.cliente_tel ? ` (${telefoneBonito(ld.cliente_tel)})` : ''}`,
    `Pedido: ${[ld.servico, ld.preferencia].filter(Boolean).join(' · ') || 'sem detalhes'}`,
    'Fale com a cliente e, se der, convide o salão para a MIMO.',
  ].join('\n')
}

// 3.54: o aviso interno quando a própria dona testa o guia pelo número cadastrado — boa hora para apresentar a MIMO
// Agenda. Vai para o nosso número (numero_avisos), nunca para a dona.
function avisoDona(l: Lugar, tel: string): string {
  const onde = [l.nome, l.cidade && `${l.cidade}${l.uf ? `-${l.uf}` : ''}`].filter(Boolean).join(' · ')
  return [
    '🎉 MIMO — dona testando o guia',
    `${onde}: a dona está escrevendo pela Mel do número cadastrado. Boa hora para apresentar a MIMO Agenda.`,
    `Número: ${telefoneBonito(tel)}`,
  ].join('\n')
}

function confirmacao(cfg: Config, l: Lugar, d: Dados, enviado: boolean): string {
  const nome = d.nome ? `, ${d.nome.split(' ')[0]}` : ''
  const base = enviado
    ? `Pronto${nome}! 💗 Enviei seu pedido para o ${l.nome}. Eles vão te chamar aqui no WhatsApp para combinar o horário.`
    : `Anotei seu pedido${nome}! 💗 Vou passar para o ${l.nome} e eles te chamam aqui no WhatsApp para combinar.`
  const contato = cfg.mostrar_contato_salao ? contatoDoSalao(l) : ''
  return contato ? `${base}\nSe preferir, o contato deles é ${contato}.` : base
}

// ---- a IA: Groq (compatível com a OpenAI) ou Claude (API de Messages), com a resposta no esquema acima ---------------
// No Groq o esquema estrito às vezes recusa o que o modelo escreveu (json_validate_failed: o modelo devolveu um JSON
// fora do esquema, ou nada, quando o raciocínio comeu o espaço). Aí, como no guia-gerar: lê o que veio em
// failed_generation se der; senão pede de novo no modo JSON simples (json_object), com os campos pedidos no prompt.
export type Ambiente = { get(nome: string): string | undefined | null }
type Fetch = (url: string, init: Record<string, unknown>) => Promise<{ status: number; text(): Promise<string> }>
const CAMPOS_JSON = 'Responda só com um objeto JSON com exatamente estes campos: "resposta" (texto), "nome", "servico", "preferencia", "observacao" (textos; "" quando não souber), "cliente_confirmou_envio", "cancelar", "quer_apagar_dados" (true ou false).'

function lerJson(texto: string): Record<string, unknown> | null {
  const t = String(texto ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  if (!t) return null
  try { return JSON.parse(t) } catch { /* talvez venha texto antes ou depois do objeto */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)) } catch { return null } }
  return null
}
function montarLeitura(lido: Record<string, unknown>): LeituraIa | null {
  if (typeof lido?.resposta !== 'string') return null
  return {
    resposta: lido.resposta, nome: String(lido.nome ?? ''), servico: String(lido.servico ?? ''), preferencia: String(lido.preferencia ?? ''),
    observacao: String(lido.observacao ?? ''), cliente_confirmou_envio: lido.cliente_confirmou_envio === true, cancelar: lido.cancelar === true,
    quer_apagar_dados: lido.quer_apagar_dados === true,
  }
}

export function iaDe(env: Ambiente, fetcher: Fetch): Deps['ia'] {
  return async (p) => {
    const claude = p.provedor === 'claude'
    const chave = String(env.get(claude ? 'ANTHROPIC_API_KEY' : 'GROQ_API_KEY') ?? '').trim()
    if (!chave) return { leitura: null, erro: `${claude ? 'ANTHROPIC_API_KEY' : 'GROQ_API_KEY'} não configurada`, modelo: p.modelo }
    // o Claude quer começar com a cliente e alternar os papéis: junta as seguidas do mesmo lado
    const msgs: Mensagem[] = []
    for (const m of p.mensagens) {
      if (!m.content) continue
      const ultima = msgs[msgs.length - 1]
      if (ultima && ultima.role === m.role) ultima.content += `\n${m.content}`
      else msgs.push({ ...m })
    }
    while (msgs.length && msgs[0].role !== 'user') msgs.shift()
    const sistema = `${p.sistema}\n\n${CAMPOS_JSON}`

    const pedir = async (formato: 'json_schema' | 'json_object') => {
      let url: string, headers: Record<string, string>, corpo: Record<string, unknown>
      if (claude) {
        url = 'https://api.anthropic.com/v1/messages'
        const workspace = String(env.get('ANTHROPIC_WORKSPACE_ID') ?? '').trim()
        headers = { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', ...(workspace ? { 'anthropic-workspace-id': workspace } : {}) }
        corpo = { model: p.modelo, max_tokens: 1500, system: sistema, messages: msgs, ...(formato === 'json_schema' ? { output_config: { format: { type: 'json_schema', schema: ESQUEMA } } } : {}) }
      } else {
        url = 'https://api.groq.com/openai/v1/chat/completions'
        headers = { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' }
        corpo = { model: p.modelo, temperature: 0.4, max_tokens: 2500, messages: [{ role: 'system', content: sistema }, ...msgs],
          response_format: formato === 'json_schema' ? { type: 'json_schema', json_schema: { name: 'resposta', strict: true, schema: ESQUEMA } } : { type: 'json_object' },
          ...(p.modelo.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}) }
      }
      const r = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(corpo), signal: AbortSignal.timeout(25_000) })
      const cru = await r.text()
      let j: Record<string, unknown> | null = null
      try { j = JSON.parse(cru) } catch { j = null }
      const err = (j?.error ?? null) as { code?: string; message?: string; failed_generation?: string } | null
      const texto = claude
        ? ((j?.content ?? []) as Array<{ type: string; text?: string }>).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
        : String(((j?.choices ?? []) as Array<{ message?: { content?: string } }>)[0]?.message?.content ?? '')
      return { status: r.status, cru, err, texto }
    }

    try {
      let r = await pedir('json_schema')
      if (r.status >= 200 && r.status < 300 && !r.err) {
        const leitura = montarLeitura(lerJson(r.texto) ?? {})
        if (leitura) return { leitura, modelo: p.modelo }
        // veio vazio ou fora do esquema (o Groq às vezes aceita e devolve ""): de novo, no modo simples
        r = await pedir('json_object')
      } else if (r.status === 400 && (r.err?.code === 'json_validate_failed' || /response_format|json_schema|structured|strict|schema/i.test(r.err?.message ?? ''))) {
        // o que o modelo escreveu, se der para ler; senão de novo sem o esquema estrito
        const salvo = typeof r.err?.failed_generation === 'string' ? montarLeitura(lerJson(r.err.failed_generation) ?? {}) : null
        if (salvo) return { leitura: salvo, modelo: p.modelo }
        r = await pedir('json_object')
      }
      if (r.status < 200 || r.status >= 300 || r.err) return { leitura: null, erro: `IA respondeu ${r.status}: ${String(r.err?.message ?? r.cru).slice(0, 200)}`, modelo: p.modelo }
      const leitura = montarLeitura(lerJson(r.texto) ?? {})
      if (!leitura) return { leitura: null, erro: 'a IA não devolveu a resposta', modelo: p.modelo }
      return { leitura, modelo: p.modelo }
    } catch (e) {
      return { leitura: null, erro: String((e as Error)?.message ?? e).slice(0, 200), modelo: p.modelo }
    }
  }
}
