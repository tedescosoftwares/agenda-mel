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
export type Entrada = { telefone: string; texto: string; nomePerfil?: string | null }
export type Saida = {
  responder: string | null
  acao: string
  previaSalao?: string | null
  estado?: string
  dados?: Dados
  erro?: string
}
type Dados = { nome?: string; servico?: string; preferencia?: string; observacao?: string }
type Lugar = {
  id: string; nome: string; categoria?: string | null; cidade?: string | null; cidade_slug?: string; slug?: string; uf?: string | null
  bairro?: string | null; endereco?: string | null; servicos?: string[] | null; horarios?: unknown; telefone?: string | null; whatsapp?: string | null
  salao_tel?: string | null; salao_saiu?: boolean; agendar?: string | null
}
type Conversa = { id: number; telefone: string; lugar_id: string | null; estado: string; dados: Dados; mensagens: Array<{ q: string; t: string; em?: string }>; lugar?: Lugar | null }
type Config = {
  ligado: boolean; numero: string | null; instancia: string; provedor: string; modelo: string | null; orientacao: string
  msg_cliente: string; msg_salao: string; msg_salao_resposta: string; mostrar_contato_salao: boolean
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

// o código do salão na mensagem: "código: itanhaem/studio-lirio", "ref itanhaem/studio-lirio" ou o link da página
export function codigoDoTexto(texto: string): { cidade: string; slug: string } | null {
  const t = String(texto ?? '')
  const m = t.match(/(?:c[oó]digo|ref)\s*[:#]?\s*([a-z0-9-]{2,60})\/([a-z0-9-]{2,80})/i) ?? t.match(/\/saloes\/([a-z0-9-]{2,60})\/([a-z0-9-]{2,80})/i)
  if (!m) return null
  const cidade = m[1].toLowerCase(), slug = m[2].toLowerCase()
  if (['bairro', 'horario', 'regiao'].includes(slug) || cidade === 'regiao') return null
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
export function linkParaCliente(clienteTel: string, nome: string, salao: string, servico: string): string {
  const frase = `Olá${nome ? `, ${nome}` : ''}! Aqui é do ${salao}. Recebi seu pedido${servico ? ` de ${servico}` : ''} pela MIMO.`
  return `https://wa.me/${so(clienteTel)}?text=${encodeURIComponent(frase)}`
}

export function mensagemDoSalao(cfg: Pick<Config, 'msg_salao'>, l: { nome: string }, d: { cliente_nome?: string | null; servico?: string | null; preferencia?: string | null; observacao?: string | null; cliente_tel: string }): string {
  return preencher(cfg.msg_salao, {
    salao: l.nome,
    cliente: d.cliente_nome ?? '',
    servico: d.servico ?? '',
    preferencia: d.preferencia ?? '',
    observacao: d.observacao ?? '',
    contato: telefoneBonito(d.cliente_tel),
    link: linkParaCliente(d.cliente_tel, d.cliente_nome ?? '', l.nome, d.servico ?? ''),
  })
}

export function resumo(d: Dados, salao: string): string {
  return [
    'Anotei assim:',
    `• Nome: ${d.nome}`,
    `• Serviço: ${d.servico}`,
    `• Preferência: ${d.preferencia}`,
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
  const ctx = (await chamar(deps, 'guia_whats_contexto', { tel_: tel })) as { config: Config; saida: string | null; conversa: Conversa | null; lead_salao: { id: number; salao_nome: string; status: string; ja_respondeu: boolean } | null }
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
      await chamar(deps, 'guia_whats_salao_respondeu', { lead_: ctx.lead_salao.id, texto_: texto, quer_: quer })
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

  // 4. salão que já agenda pela MIMO, que pediu para não receber, ou sem WhatsApp: a cliente vai direto
  if (lugar.agendar) {
    const resposta = `Oi! Aqui é a Mel, da MIMO 💗. O ${lugar.nome} já agenda pela MIMO: é só escolher o serviço e o horário aqui 👉 https://${lugar.agendar}.${RAIZ_SITE}`
    await guardar(resposta, 'encerrada', {}, lugar.id)
    return { responder: resposta, acao: 'agenda_mimo', estado: 'encerrada' }
  }
  if (lugar.salao_saiu || !lugar.salao_tel) {
    const contato = contatoDoSalao(lugar)
    const resposta = contato
      ? `Oi! Aqui é a Mel, da MIMO 💗. O ${lugar.nome} atende direto: ${contato}`
      : `Oi! Aqui é a Mel, da MIMO 💗. Não tenho um WhatsApp do ${lugar.nome} para passar o seu pedido, desculpa.${lugar.endereco ? ` O endereço é ${lugar.endereco}${lugar.bairro ? `, ${lugar.bairro}` : ''}.` : ''}`
    await guardar(resposta, 'encerrada', {}, lugar.id)
    return { responder: resposta, acao: lugar.salao_saiu ? 'salao_saiu' : 'sem_contato', estado: 'encerrada' }
  }

  // 5. a conversa com a Mel
  const estadoAntes = conversa?.estado ?? 'conversando'
  const dadosAntes: Dados = { ...(conversa?.dados ?? {}) }
  const historico: Mensagem[] = (conversa?.mensagens ?? []).slice(-20).map((m) => ({ role: m.q === 'cliente' ? 'user' as const : 'assistant' as const, content: String(m.t ?? '').slice(0, 800) }))
  historico.push({ role: 'user', content: texto })
  const r = await deps.ia({ provedor: cfg.provedor, modelo: cfg.modelo || MODELO_PADRAO[cfg.provedor] || MODELO_PADRAO.groq, sistema: sistema(cfg, lugar, dadosAntes, estadoAntes, e.nomePerfil, agora), mensagens: historico })
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
  const completo = !!(dados.nome && dados.servico && dados.preferencia)

  if (lido.cancelar && estadoAntes !== 'enviado') {
    const resposta = limpo(lido.resposta, 1200) || 'Tudo bem! Se quiser marcar depois, é só chamar. 💗'
    await guardar(resposta, 'encerrada', dados, lugar.id)
    return { responder: resposta, acao: 'cancelou', estado: 'encerrada', dados }
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
    const ld = (await chamar(deps, 'guia_whats_lead_criar', { conversa_: conversa!.id })) as { id: number; status: string; salao_tel: string | null; cliente_nome: string | null; servico: string | null; preferencia: string | null; observacao: string | null; cliente_tel: string; repetido: boolean }
    let ok = false
    let previa: string | null = null
    if (ld?.status === 'pendente' && ld.salao_tel) {
      previa = mensagemDoSalao(cfg, lugar, ld)
      const env = await deps.enviar(cfg.instancia, ld.salao_tel, previa)
      ok = env.ok
      await chamar(deps, 'guia_whats_lead_resultado', { lead_: ld.id, ok_: env.ok, provider_: env.ok ? env.providerId : null, erro_: env.ok ? null : env.erro, mensagem_: previa })
    } else if (ld?.repetido) {
      ok = ld.status !== 'falhou'
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

function confirmacao(cfg: Config, l: Lugar, d: Dados, enviado: boolean): string {
  const nome = d.nome ? `, ${d.nome.split(' ')[0]}` : ''
  const base = enviado
    ? `Pronto${nome}! 💗 Enviei seu pedido para o ${l.nome}. Eles vão te chamar aqui no WhatsApp para combinar o horário.`
    : `Anotei seu pedido${nome}! 💗 Vou passar para o ${l.nome} e eles te chamam aqui no WhatsApp para combinar.`
  const contato = cfg.mostrar_contato_salao ? contatoDoSalao(l) : ''
  return contato ? `${base}\nSe preferir, o contato deles é ${contato}.` : base
}

// ---- a IA: Groq (compatível com a OpenAI) ou Claude (API de Messages), com a resposta no esquema acima ---------------
export type Ambiente = { get(nome: string): string | undefined | null }
type Fetch = (url: string, init: Record<string, unknown>) => Promise<{ status: number; text(): Promise<string> }>

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
    let url: string, headers: Record<string, string>, corpo: Record<string, unknown>
    if (claude) {
      url = 'https://api.anthropic.com/v1/messages'
      const workspace = String(env.get('ANTHROPIC_WORKSPACE_ID') ?? '').trim()
      headers = { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', ...(workspace ? { 'anthropic-workspace-id': workspace } : {}) }
      corpo = { model: p.modelo, max_tokens: 1200, system: p.sistema, messages: msgs, output_config: { format: { type: 'json_schema', schema: ESQUEMA } } }
    } else {
      url = 'https://api.groq.com/openai/v1/chat/completions'
      headers = { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' }
      corpo = { model: p.modelo, temperature: 0.4, max_tokens: 1200, messages: [{ role: 'system', content: p.sistema }, ...msgs],
        response_format: { type: 'json_schema', json_schema: { name: 'resposta', strict: true, schema: ESQUEMA } },
        ...(p.modelo.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}) }
    }
    try {
      const r = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(corpo), signal: AbortSignal.timeout(25_000) })
      const cru = await r.text()
      let j: Record<string, unknown> | null = null
      try { j = JSON.parse(cru) } catch { j = null }
      if (r.status < 200 || r.status >= 300) {
        const err = (j?.error ?? null) as { message?: string } | null
        return { leitura: null, erro: `IA respondeu ${r.status}: ${String(err?.message ?? cru).slice(0, 200)}`, modelo: p.modelo }
      }
      const texto = claude
        ? ((j?.content ?? []) as Array<{ type: string; text?: string }>).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
        : String(((j?.choices ?? []) as Array<{ message?: { content?: string } }>)[0]?.message?.content ?? '')
      const lido = JSON.parse(texto.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
      if (typeof lido?.resposta !== 'string') return { leitura: null, erro: 'a IA não devolveu a resposta', modelo: p.modelo }
      return {
        leitura: {
          resposta: lido.resposta, nome: String(lido.nome ?? ''), servico: String(lido.servico ?? ''), preferencia: String(lido.preferencia ?? ''),
          observacao: String(lido.observacao ?? ''), cliente_confirmou_envio: lido.cliente_confirmou_envio === true, cancelar: lido.cancelar === true,
          quer_apagar_dados: lido.quer_apagar_dados === true,
        },
        modelo: p.modelo,
      }
    } catch (e) {
      return { leitura: null, erro: String((e as Error)?.message ?? e).slice(0, 200), modelo: p.modelo }
    }
  }
}
