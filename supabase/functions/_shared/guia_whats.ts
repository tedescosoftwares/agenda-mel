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

import { iaJsonDe, type Ambiente, type Fetch, type Mensagem } from './ia_json.ts'
export type { Ambiente, Mensagem } from './ia_json.ts'

export type Resultado = { ok: true; providerId: string | null } | { ok: false; erro: string }
export type PedidoIa = { provedor: string; modelo: string; sistema: string; mensagens: Mensagem[] }
export type LeituraIa = {
  resposta: string; nome: string; servico: string; preferencia: string; observacao: string
  cliente_confirmou_envio: boolean; cancelar: boolean; quer_apagar_dados: boolean
  // 3.76: quem escreve quer saber da MIMO Agenda (não marcar horário); e se disse que é deste salão
  sobre_agenda: boolean; dona_do_salao: boolean
}
export type Deps = {
  rpc: (nome: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>
  ia: (p: PedidoIa) => Promise<{ leitura: LeituraIa | null; erro?: string; modelo?: string }>
  enviar: (instancia: string, telefone: string, texto: string) => Promise<Resultado>
  // 3.57: a enquete "vai atender?" que vai logo depois do pedido ao salão (sendPoll da Evolution); opcional (sem ela, só o texto)
  enviarEnquete?: (instancia: string, telefone: string, pergunta: string, opcoes: string[]) => Promise<Resultado>
  agora?: () => Date
}
// enquete: a chave da mensagem da enquete quando a entrada é um VOTO (pollUpdateMessage) — o texto vem "1"/"2" ou o nome da opção
export type Entrada = { telefone: string; texto: string; nomePerfil?: string | null; citado?: string | null; enquete?: string | null }
export type Saida = {
  responder: string | null
  acao: string
  previaSalao?: string | null
  previaAviso?: string | null
  // 3.57: no simulador, a enquete que iria junto do pedido; e, no voto simulado, a mensagem que a cliente receberia
  previaEnquete?: { pergunta: string; opcoes: string[] } | null
  previaCliente?: string | null
  estado?: string
  dados?: Dados
  erro?: string
}
// 3.77: opcoes = os salões que a Mel ofereceu (o resgate ou o "não" do salão), resgate_de = o pedido de origem,
// salao_anterior = o salão que não respondeu (ou disse não)
export type Opcao = { id: string; nome: string; bairro?: string | null; km?: number | null; agendar?: string | null }
type Dados = {
  nome?: string; servico?: string; preferencia?: string; observacao?: string; pos_envio?: number; sem_avanco?: number; dona?: boolean; salao_recusou?: string; comercial?: number
  opcoes?: Opcao[]; resgate_de?: number; salao_anterior?: string
  // 3.77.1 (migração 223): por que a Mel ofereceu (demora, sem_contato, falhou, nao): só na demora dá para "esperar"
  oferta_motivo?: string
}
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
  // 3.57: o retorno do salão — a enquete "vai atender?", as respostas e os avisos (tudo editável na aba WhatsApp)
  enquete_ativa?: boolean; enquete_pergunta?: string | null; enquete_sim?: string | null; enquete_nao?: string | null
  msg_salao_vai_atender?: string | null; msg_salao_nao_atende?: string | null
  avisar_cliente_nao?: boolean; msg_cliente_nao_atende?: string | null
  aviso_nao_atende?: boolean; msg_aviso_nao_atende?: string | null
  aviso_demora_min?: number | null; msg_aviso_demora?: string | null; cutucar_salao_min?: number | null; msg_cutucar_salao?: string | null
  // 3.76 (migração 221): quem pergunta da MIMO Agenda vai para o WhatsApp comercial (ou para o site, com ele desligado)
  sobre_agenda?: boolean | null; msg_sobre_agenda?: string | null; msg_sobre_agenda_site?: string | null
  // 3.77 (migração 222): o resgate da cliente quando o salão não dá sinal
  resgate_min?: number | null; resgate_opcoes?: number | null; msg_resgate?: string | null
}
// o pedido como o banco devolve (guia_whats_lead_criar / guia_whats_voto / guia_whats_pendentes): o que as mensagens usam
export type Pedido = {
  id: number; salao_nome: string; cidade?: string | null; cliente_nome?: string | null; cliente_tel: string; servico?: string | null
  preferencia?: string | null; observacao?: string | null; salao_tel?: string | null; token?: string | null; status?: string; conversa_id?: number | null
  resgate_em?: string | null // 3.77: a Mel já ofereceu outros salões à cliente
}
type LeadSalao = { id: number; salao_nome: string; status: string; ja_respondeu: boolean; voto?: string | null }

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

// 3.57: troca todos os {campos} (sem derrubar linha); um campo vazio leva junto o separador " · " ou os parênteses que o
// cercavam ("{salao} · {cidade}" sem cidade vira "{salao}"), e {nome} vazio leva a vírgula ("Oi, {nome}!" → "Oi!")
export function trocarTudo(modelo: string, valores: Record<string, string | null | undefined>): string {
  let s = String(modelo ?? '')
  for (const [k, bruto] of Object.entries(valores)) {
    const v = String(bruto ?? '').trim()
    if (!v) {
      s = s.replace(new RegExp(`\\s*·\\s*\\{${k}\\}`, 'g'), '').replace(new RegExp(`\\{${k}\\}\\s*·\\s*`, 'g'), '')
        .replace(new RegExp(`\\s*\\(\\{${k}\\}\\)`, 'g'), '').replace(new RegExp(`,?\\s*\\{${k}\\}`, 'g'), '')
    } else {
      s = s.replaceAll(`{${k}}`, v)
    }
  }
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
// 40 → "40 min"; 90 → "1 h 30"; 120 → "2 h"; 3000 → "2 dias"
export function tempoBonito(minutos: number): string {
  const m = Math.max(0, Math.round(Number(minutos) || 0))
  if (m < 60) return `${m} min`
  if (m < 48 * 60) { const h = Math.floor(m / 60), r = m % 60; return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h` }
  return `${Math.floor(m / (24 * 60))} dias`
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

// ---- 3.57: o retorno do salão -----------------------------------------------------------------------------------------
const PADRAO_ENQUETE = { pergunta: 'Vai atender a {cliente}?', sim: 'Sim, vou atender', nao: 'Não vou conseguir' }
// a enquete que vai logo depois do pedido: pergunta (até 255, limite do WhatsApp) e as duas opções, da Plataforma
export function enqueteDoPedido(cfg: Pick<Config, 'enquete_pergunta' | 'enquete_sim' | 'enquete_nao'>, p: Pick<Pedido, 'cliente_nome' | 'salao_nome' | 'servico'>): { pergunta: string; opcoes: string[] } {
  const pergunta = trocarTudo(String(cfg.enquete_pergunta ?? '').trim() || PADRAO_ENQUETE.pergunta, { cliente: p.cliente_nome || 'cliente', salao: p.salao_nome, servico: p.servico ?? '' }).slice(0, 255)
  return { pergunta, opcoes: [limpo(cfg.enquete_sim, 100) || PADRAO_ENQUETE.sim, limpo(cfg.enquete_nao, 100) || PADRAO_ENQUETE.nao] }
}
// o voto como a Evolution entrega: "1"/"2" (a posição) ou o nome da opção → 'sim' | 'nao' | null
export function votoDe(texto: string, cfg: Pick<Config, 'enquete_sim' | 'enquete_nao'>): 'sim' | 'nao' | null {
  const t = String(texto ?? '').trim()
  if (t === '1') return 'sim'
  if (t === '2') return 'nao'
  const p = palavra(t)
  if (!p) return null
  if (p === palavra(cfg.enquete_sim || PADRAO_ENQUETE.sim) || p === palavra(PADRAO_ENQUETE.sim)) return 'sim'
  if (p === palavra(cfg.enquete_nao || PADRAO_ENQUETE.nao) || p === palavra(PADRAO_ENQUETE.nao)) return 'nao'
  return null
}
// o "não vou conseguir" / "vou atender" claros, por texto (só quando o pedido ainda não tem voto). Conservador de
// propósito: na dúvida, não é voto — fica na thread para a equipe ler.
const NAO_ATENDE = /\bnao (vou|vamos) (conseguir|poder|dar|atender|pegar|ter como)\b|\bnao (consigo|conseguimos|posso|podemos|da|dá|vai dar|tem como|tem vaga|tenho vaga|tenho agenda|temos agenda|temos vaga|tenho horario|temos horario)\b|\bsem (vaga|agenda|horario)\b|\bagenda (cheia|lotada|fechada)\b|^(nao|nao nao|nao obrigada|nao obrigado|nao da|nao vai dar|infelizmente nao)$/
const VAI_ATENDER = /\b(vou|vamos) (atender|chamar|falar|responder|entrar em contato|mandar mensagem|marcar|encaixar)\b|\bpode deixar\b|\bja (chamei|falei|respondi|mandei|entrei em contato|marquei|marcamos|atendi|atendemos)\b|\b(consigo|conseguimos|posso|podemos|da|vai dar) (atender|sim|encaixar)\b|\batendo sim\b|^(sim|sim sim|sim claro|claro|claro que sim|consigo|vou sim|combinado|fechado|bora|pode deixar|com certeza|atendo)$/
export function votoDoTexto(texto: string): 'sim' | 'nao' | null {
  const p = palavra(texto)
  if (!p) return null
  if (NAO_ATENDE.test(p)) return 'nao'
  if (VAI_ATENDER.test(p)) return 'sim'
  return null
}
// as mensagens de um voto: a resposta ao salão; no não, a da cliente (se ligada) e o aviso à equipe (se ligado)
export function respostasDoVoto(cfg: Config, p: Pedido, voto: 'sim' | 'nao', opcoes: Opcao[] = []): { salao: string; cliente: string | null; aviso: string | null } {
  const link = p.token ? linkDoPedido(p.token) : linkParaCliente(p.cliente_tel, p.cliente_nome ?? '', p.salao_nome, p.servico ?? '')
  const base = { cliente: p.cliente_nome || 'cliente', salao: p.salao_nome, servico: p.servico ?? '', preferencia: p.preferencia ?? '', link, contato: telefoneBonito(p.cliente_tel), cidade: p.cidade ?? '' }
  if (voto === 'sim') return { salao: trocarTudo(cfg.msg_salao_vai_atender || 'Combinado! 💗 A {cliente} está esperando seu contato: {link}', base), cliente: null, aviso: null }
  const primeiro = primeiroNome(p.cliente_nome)
  // 3.77: {opcoes} vira os salões sugeridos (ou o pedido de outro pelo nome); um texto antigo, sem {opcoes}, ganha a lista no fim
  const modeloCliente = ajustarNome(cfg.msg_cliente_nao_atende || 'Oi, {nome}! O {salao} não vai conseguir te atender agora 😕\n\n{opcoes}')
  const cliente = trocarTudo(modeloCliente, { ...base, nome: primeiro, opcoes: textoOpcoes(opcoes, p.servico) })
    + (!modeloCliente.includes('{opcoes}') && opcoes.length ? `\n\n${textoOpcoes(opcoes, p.servico)}` : '')
  return {
    salao: trocarTudo(cfg.msg_salao_nao_atende || 'Tudo bem, obrigada por avisar! 💗 Eu aviso a {cliente}.', base),
    cliente: cfg.avisar_cliente_nao === false ? null : cliente,
    aviso: cfg.aviso_nao_atende === false || !cfg.numero_avisos ? null : trocarTudo(cfg.msg_aviso_nao_atende || '❌ MIMO — salão não vai atender\n{salao} · {cidade}\nCliente: {cliente} ({contato})\nPedido: {servico} · {preferencia}', { ...base, cliente: p.cliente_nome || 'sem nome', servico: p.servico || 'sem serviço', preferencia: p.preferencia || 'sem preferência' }),
  }
}
// o relógio (guia_whats_pendentes): o aviso à equipe de que o salão não deu sinal, e a cutucada no salão
export function avisoDemora(modelo: string | null | undefined, p: Pedido & { minutos?: number }): string {
  return trocarTudo(modelo || '⏳ MIMO — salão sem resposta\n{salao} · {cidade} recebeu o pedido há {tempo} e ainda não abriu o link nem respondeu.\nCliente: {cliente} ({contato})\nPedido: {servico} · {preferencia}', {
    salao: p.salao_nome, cidade: p.cidade ?? '', cliente: p.cliente_nome || 'sem nome', contato: telefoneBonito(p.cliente_tel),
    servico: p.servico || 'sem serviço', preferencia: p.preferencia || 'sem preferência', tempo: tempoBonito(Number(p.minutos ?? 0)),
  })
}
export function cutucadaSalao(modelo: string | null | undefined, p: Pedido & { minutos?: number }): string {
  const link = p.token ? linkDoPedido(p.token) : linkParaCliente(p.cliente_tel, p.cliente_nome ?? '', p.salao_nome, p.servico ?? '')
  return trocarTudo(modelo || 'Oi! A {cliente} ainda está esperando seu retorno sobre {servico} 💗 Vai dar pra atender? É só tocar no link: {link}', {
    cliente: p.cliente_nome || 'cliente', salao: p.salao_nome, servico: p.servico || 'o pedido', preferencia: p.preferencia ?? '', link, tempo: tempoBonito(Number(p.minutos ?? 0)),
  })
}
// ---- 3.77: o resgate da cliente ---------------------------------------------------------------------------------------
// "Oi{nome}!" (o texto de fábrica da 205) vira "Oi, {nome}!": sem isso a cliente lia "OiAna!"
export const ajustarNome = (modelo: string) => String(modelo ?? '').replace(/([A-Za-zÀ-ÿ])\{nome\}/g, '$1, {nome}')
const primeiroNome = (nome: string | null | undefined) => String(nome ?? '').trim().split(/\s+/)[0] ?? ''
const kmBonito = (km: number) => (km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${km.toFixed(1).replace('.', ',')} km`)
export const MSG_RESGATE = 'Oi, {nome}! O {salao} ainda não respondeu o seu pedido 😕\n\n{opcoes}\n\nSe preferir esperar o {salao}, é só me dizer 💗'
// o pedido nem chegou ao salão (sem WhatsApp, o envio falhou, o limite do dia): "ainda não respondeu" não seria verdade
const MSG_RESGATE_NAO_CHEGOU = 'Oi, {nome}! Não consegui passar o seu pedido para o {salao} pelo WhatsApp 😕\n\n{opcoes}'
// os salões sugeridos, numerados, e a pergunta; sem nenhum, o pedido de outro salão pelo nome
export function textoOpcoes(opcoes: Opcao[] | null | undefined, servico?: string | null): string {
  const lista = (opcoes ?? []).filter((o) => o?.id && o?.nome)
  if (!lista.length) return 'Quer que eu te ajude com outro salão? Me manda o nome ou o link de outro salão do guia que eu passo o seu pedido pra ele.'
  const linhas = lista.map((o, i) => `${i + 1}) ${o.nome}${o.bairro ? ` · ${o.bairro}` : ''}${typeof o.km === 'number' ? ` · ${kmBonito(o.km)}` : ''}${o.agendar ? ' — agenda pela MIMO, você marca na hora' : ''}`)
  const para = String(servico ?? '').trim() ? ` para ${String(servico).trim().toLowerCase()}` : ''
  return [`Achei ${lista.length === 1 ? 'este salão' : 'estes salões'} ali perto${para}:`, '', ...linhas, '', `Quer que eu passe o seu pedido para ${lista.length === 1 ? 'ele' : 'um deles'}? É só responder o número.`].join('\n')
}
export function mensagemResgate(modelo: string | null | undefined, x: { cliente_nome?: string | null; salao_nome: string; servico?: string | null; status?: string }, opcoes: Opcao[]): string {
  const naoChegou = x.status === 'sem_contato' || x.status === 'falhou' || x.status === 'fora_do_limite'
  const base = naoChegou ? MSG_RESGATE_NAO_CHEGOU : (String(modelo ?? '').trim() || MSG_RESGATE)
  return trocarTudo(ajustarNome(base), { nome: primeiroNome(x.cliente_nome), salao: x.salao_nome, servico: x.servico ?? '', opcoes: textoOpcoes(opcoes, x.servico) })
}
// o relógio: oferece outros salões a uma cliente cujo pedido ficou sem sinal; só marca (e reabre a conversa) se saiu
export async function resgatarCliente(deps: Pick<Deps, 'rpc' | 'enviar'>, o: { instancia: string; modelo?: string | null; n?: number | null },
  x: Pedido & { status?: string }): Promise<{ ok: boolean; texto: string; opcoes: Opcao[]; erro?: string }> {
  let opcoes: Opcao[] = []
  try { opcoes = ((await chamar(deps, 'guia_whats_alternativas', { lead_: x.id, n_: Math.max(1, Math.min(5, Number(o.n) || 3)) })) as Opcao[] | null) ?? [] } catch { opcoes = [] }
  const texto = mensagemResgate(o.modelo, x, opcoes)
  const env = await deps.enviar(o.instancia, x.cliente_tel, texto)
  if (!env.ok) return { ok: false, texto, opcoes, erro: env.erro }
  const motivo = x.status === 'sem_contato' ? 'sem_contato' : x.status === 'falhou' || x.status === 'fora_do_limite' ? 'falhou' : 'demora'
  await chamar(deps, 'guia_whats_oferecer', { lead_: x.id, texto_: texto, opcoes_: opcoes, motivo_: motivo })
  return { ok: true, texto, opcoes }
}
// a cliente responde à oferta: o número (1, "o 2", "opção 3", 2️⃣) ou o nome de um dos salões
export function escolhaDe(texto: string, opcoes: Opcao[]): Opcao | null {
  const p = palavra(texto)
  const m = p.match(/^(?:(?:quero|prefiro|pode ser|vou de|manda pro|manda para o|manda pra|opcao|numero|o|a|no|na)\s+)*([1-9])(?:\s|$)/)
    ?? p.match(/\b(?:opcao|numero|o|a|no|na|pro|pra)\s+([1-9])(?:\s|$)/)
  if (m) return opcoes[Number(m[1]) - 1] ?? null
  const achados = opcoes.filter((o) => { const n = palavra(o.nome); return n.length >= 4 && (` ${p} `).includes(` ${n} `) })
  return achados.length === 1 ? achados[0] : null
}
const ESPERAR_SIM = /\b(vou esperar|vou aguardar|prefiro esperar|prefiro aguardar|espero|esperar|aguardo|aguardar|nao precisa|nao quero outro|deixa ele|fico com ele)\b/
const ESPERAR_NAO = /\b(nao|sem) (quero |vou |posso |da pra |consigo )?(esperar|aguardar)\b/
const ESPERAR = { test: (p: string) => ESPERAR_SIM.test(p) && !ESPERAR_NAO.test(p) }
// 3.77.1: a cliente topou outro salão sem dizer qual ("pode enviar para outros", "qualquer um", "pode mandar")
const CONSENTE = /\b(pode|podem|manda|mande|mandar|envia|envie|enviar|qualquer|tanto faz|outro|outros|outra|outras|sim|quero|ok|bora|claro|beleza)\b/
// o salão respondeu depois que a cliente já fez o pedido em outro salão
export const salaoAtrasado = (p: Pick<Pedido, 'cliente_nome'>) =>
  `Obrigada pelo retorno! 💗 ${p.cliente_nome ? `A ${primeiroNome(p.cliente_nome)}` : 'A cliente'} já seguiu com outro salão desta vez. Os próximos pedidos continuam chegando por aqui.`
// 3.77: o voto que a Evolution não conseguiu decifrar (o webhook marca assim): a Mel pede por texto
export const VOTO_ILEGIVEL = '[voto ilegivel]'

// manda o pedido ao salão (o texto) e, se ligada, a enquete logo depois; registra o resultado e a chave da enquete no
// pedido. Usado no "sim" da cliente e no "Reenviar" da Plataforma. A enquete é um extra: se não sair, o pedido já foi.
export async function despacharPedido(deps: Deps, cfg: Config, l: { nome: string }, p: Pedido & { salao_tel: string }): Promise<{ ok: boolean; erro?: string; status?: string; texto: string; enquete: string | null }> {
  const texto = mensagemDoSalao(cfg, l, p)
  const env = await deps.enviar(cfg.instancia, p.salao_tel, texto)
  // 3.72: o banco decide o status do pedido; "não existe no WhatsApp" vira sem_contato (migração 216)
  const res = (await chamar(deps, 'guia_whats_lead_resultado', { lead_: p.id, ok_: env.ok, provider_: env.ok ? env.providerId : null, erro_: env.ok ? null : env.erro, mensagem_: texto })) as { status?: string } | null
  const status = env.ok ? 'enviado' : (res?.status ?? 'falhou')
  let enquete: string | null = null
  if (env.ok && cfg.enquete_ativa !== false && deps.enviarEnquete) {
    try {
      const e = enqueteDoPedido(cfg, p)
      const r = await deps.enviarEnquete(cfg.instancia, p.salao_tel, e.pergunta, e.opcoes)
      if (r.ok && r.providerId) { enquete = r.providerId; await chamar(deps, 'guia_whats_lead_enquete', { lead_: p.id, enquete_: enquete }) }
    } catch { /* a enquete não saiu: o texto já foi, e o voto por texto continua valendo */ }
  }
  return { ok: env.ok, erro: env.ok ? undefined : env.erro, status, texto, enquete }
}

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
    ...(cfg.sobre_agenda !== false ? [
      '- sobre_agenda: true se quem escreve não quer marcar horário, e sim saber da MIMO Agenda: é dona, dono ou profissional de beleza perguntando do sistema de agendamento da MIMO, dos planos ou do preço da MIMO, de como contratar, de como colocar o salão dela na MIMO ou no guia, ou propondo parceria. Perguntas sobre ESTE salão (preço de um serviço, horário, endereço, se tem vaga) não contam. Quando for true, deixe a resposta curta: o sistema manda o contato certo.',
      '- dona_do_salao: true só se ela disse que é a dona ou que trabalha NESTE salão.',
    ] : ['- sobre_agenda e dona_do_salao: sempre false.']),
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
    sobre_agenda: { type: 'boolean' },
    dona_do_salao: { type: 'boolean' },
  },
  required: ['resposta', 'nome', 'servico', 'preferencia', 'observacao', 'cliente_confirmou_envio', 'cancelar', 'quer_apagar_dados', 'sobre_agenda', 'dona_do_salao'],
}

// ---- a conversa -----------------------------------------------------------------------------------------------------
const SAIR = /^(sair|parar|pare|stop|cancelar avisos|nao quero receber|descadastrar)$/
const VOLTAR = /^(voltar|voltar a receber)$/
const QUERO = /\bquero\b/
const APAGAR = /\b(apag|exclu|delet|remov)[a-z]*\b.*\b(dados|conversa|numero|informac)/
const limpo = (t: unknown, n: number) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

async function chamar(deps: Pick<Deps, 'rpc'>, nome: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await deps.rpc(nome, args)
  if (error) throw new Error(`${nome}: ${error.message ?? 'erro'}`)
  return data
}

// 3.74: o WhatsApp comercial (migração 218). Quando está ligado, a dona que a Mel reconhece e o salão que responde QUERO
// recebem o link da assistente comercial, já com a frase que diz de onde vieram (o motor dela lê "para o {salão} ({cidade})").
// Num banco sem a 218, ou desligado, não há link e a Mel fala como antes.
type Comercial = { ligado: boolean; numero?: string; nome?: string }
async function comercialPublico(deps: { rpc: Deps['rpc'] }): Promise<Comercial> {
  try {
    const c = (await deps.rpc('comercial_publico', {})).data as Comercial | null
    return c?.ligado && c.numero ? { ligado: true, numero: so(c.numero), nome: c.nome || '' } : { ligado: false }
  } catch { return { ligado: false } }
}
export async function comercialLigado(deps: { rpc: Deps['rpc'] }): Promise<boolean> {
  return (await comercialPublico(deps)).ligado
}
const linkWa = (numero: string, frase: string) => `https://wa.me/${so(numero)}?text=${encodeURIComponent(frase)}`
export async function linkComercial(deps: Deps, salao: { nome: string; cidade?: string | null }, quero = false): Promise<string> {
  const c = await comercialPublico(deps)
  if (!c.ligado || !c.numero) return ''
  const frase = `${quero ? 'Oi! Respondi QUERO ao pedido da MIMO:' : 'Oi! Vim pelo guia da MIMO:'} quero conhecer a MIMO Agenda para o ${salao.nome}${salao.cidade ? ` (${salao.cidade})` : ''}.`
  return `Para conhecer a MIMO Agenda, fala com a ${c.nome || 'nossa consultora'} no WhatsApp comercial da MIMO: ${linkWa(c.numero, frase)}`
}

// 3.76: quem escreve para a Mel querendo saber da MIMO Agenda (a dona ou a profissional que viu o guia, quem quer contratar)
// recebe o link do WhatsApp comercial, com a frase "Vim pela Mel" (o motor da assistente marca a origem "mel"); com o
// comercial desligado, o site. A conversa não fecha: se era uma cliente, ela segue marcando. A equipe não é avisada.
export const MSG_SOBRE_AGENDA = 'Esse número é o da Mel, para clientes que marcam horário pelos salões do guia 💗 Para saber da MIMO Agenda (como funciona, os planos, como colocar o seu salão), quem atende é a {nome}, no WhatsApp comercial da MIMO: {link}\n\n{marcar}'
export const MSG_SOBRE_AGENDA_SITE = 'Esse número é o da Mel, para clientes que marcam horário pelos salões do guia 💗 Para saber da MIMO Agenda (como funciona, os planos, como colocar o seu salão), é por aqui: {link}\n\n{marcar}'
export const SITE_AGENDA = `https://${RAIZ_SITE}`
// as frases que não deixam dúvida (o texto já normalizado por palavra()): falam da MIMO Agenda, do sistema, de contratar,
// de pôr o salão na MIMO, ou dizem que quem escreve é do ramo. "Agenda" sozinha não conta (a cliente pergunta da agenda do
// salão), nem "agenda da MIMO" (a cliente de um salão com o selo "Agenda pela MIMO"). As frases de "criar conta" são os
// gatilhos do onboarding: o webhook passa opcoes.sobreAgenda quando um deles chega com o comercial ligado.
const NEGOCIO = '(?:salao|studio|estudio|barbearia|esmalteria|clinica|negocio|atelie|atelier)'
const SOBRE_AGENDA = new RegExp([
  '\\bmimo agenda\\b',
  '\\bsistema (?:da |de |do )?(?:mimo|voces|agendamento|agenda)\\b',
  '\\b(?:contratar|assinar|assinatura|mensalidade|planos?|preco|valor|valores) (?:da |do |de |a |o )?(?:mimo|sistema|aplicativo da mimo|app da mimo)\\b',
  '\\bquanto custa (?:a |o )?(?:mimo|sistema|plano)\\b',
  '\\b(?:sou|eu sou) (?:a |o )?(?:dona|dono|proprietaria|proprietario|socia|socio) (?:de |do |da |desse |deste |dessa |desta |de um |de uma )',
  `\\btenho (?:um |uma )?${NEGOCIO}\\b`,
  `\\b(?:cadastrar|colocar|incluir|anunciar|divulgar|inscrever|botar|por) (?:o |a )?(?:meu|minha|nosso|nossa) ${NEGOCIO}\\b`,
  `\\b(?:meu|minha|nosso|nossa) ${NEGOCIO} (?:no|na) (?:guia|mimo)\\b`,
  '\\bsou (?:manicure|cabeleireira|cabeleireiro|esteticista|maquiadora|barbeira|barbeiro|lash designer|designer de sobrancelhas?|profissional autonoma|profissional de beleza|autonoma)\\b',
  '\\btrabalhar com voces\\b', '\\bparceria\\b',
].join('|'))
export function sobreAgendaDe(texto: string): boolean {
  return SOBRE_AGENDA.test(palavra(texto))
}
// o texto: o da Plataforma na primeira vez; depois, só o link (curto). {marcar} é a volta para quem era cliente.
export async function textoSobreAgenda(deps: { rpc: Deps['rpc'] }, cfg: Config, o: { lugar?: Lugar | null; dona?: boolean; curta?: boolean } = {}): Promise<string> {
  const c = await comercialPublico(deps)
  const l = o.lugar ?? null
  const marcar = l
    ? `Se você queria marcar um horário no ${l.nome}, é só me dizer o serviço que eu sigo com você.`
    : 'Se você queria marcar um horário, me manda o nome do salão (ou o link da página dele no guia) que eu sigo com você.'
  const frase = `Oi! Vim pela Mel, do guia da MIMO: quero conhecer a MIMO Agenda${o.dona && l ? ` para o ${l.nome}${l.cidade ? ` (${l.cidade})` : ''}` : ''}.`
  const link = c.ligado && c.numero ? linkWa(c.numero, frase) : SITE_AGENDA
  const nome = c.nome || 'nossa consultora'
  const modelo = o.curta
    ? (c.ligado ? 'Para a MIMO Agenda, quem te atende é a {nome}, no WhatsApp comercial: {link} 💗\n\n{marcar}' : 'Para a MIMO Agenda, é por aqui: {link} 💗\n\n{marcar}')
    : (c.ligado ? (String(cfg.msg_sobre_agenda ?? '').trim() || MSG_SOBRE_AGENDA) : (String(cfg.msg_sobre_agenda_site ?? '').trim() || MSG_SOBRE_AGENDA_SITE))
  return modelo.replaceAll('{nome}', nome).replaceAll('{link}', link).replaceAll('{marcar}', marcar).replace(/\n{3,}/g, '\n\n').trim()
}

// opcoes.sobreAgenda (3.76): o webhook avisa que a mensagem trouxe um gatilho do onboarding com o comercial ligado
export async function atenderGuia(deps: Deps, e: Entrada, opcoes: { teste?: boolean; comoDona?: boolean; sobreAgenda?: boolean } = {}): Promise<Saida> {
  const teste = !!opcoes.teste
  const agora = deps.agora?.() ?? new Date()
  const tel = teste ? e.telefone : so(e.telefone)
  const texto = String(e.texto ?? '').trim().slice(0, 1500)
  if (!tel || !texto) return { responder: null, acao: 'vazio' }
  const ctx = (await chamar(deps, 'guia_whats_contexto', { tel_: tel })) as { config: Config; saida: string | null; conversa: Conversa | null; respostas_hoje?: number; lead_salao: LeadSalao | null }
  const cfg = ctx?.config
  if (!cfg) return { responder: null, acao: 'sem_config' }
  if (!cfg.ligado && !teste) return { responder: null, acao: 'desligado' }
  const p = palavra(texto)
  const codigo = codigoDoTexto(texto)
  // 3.77.1: a resposta à oferta de outros salões (o número, um "pode enviar", "vou esperar") vale mesmo se a conversa
  // já foi encerrada (pelo relógio, antes da 223): ela reabre em vez de a Mel recomeçar do zero
  const ofertaFechada = (c: Conversa | null) => !!c && c.estado === 'encerrada' && !codigo && Array.isArray(c.dados?.opcoes) && c.dados.opcoes.length > 0
    && (!!escolhaDe(texto, c.dados.opcoes) || CONSENTE.test(p) || ESPERAR.test(p))
  const conversaAberta = ctx.conversa && (ctx.conversa.estado !== 'encerrada' || ofertaFechada(ctx.conversa)) ? ctx.conversa : null
  const em = agora.toISOString()

  // 0. (3.57) o VOTO do salão na enquete "vai atender?". A chave da enquete amarra ao pedido certo; se ela não casar
  // (a chave não foi guardada), vale o pedido que o contexto escolheu para este número, desde que ainda sem voto.
  if (!teste && e.enquete) {
    const voto = votoDe(texto, cfg)
    if (!voto) {
      // 3.77: a Evolution não decifrou o voto (a enquete foi enviada antes de ela guardar as mensagens, por exemplo):
      // a Mel pede por texto, se o pedido do salão ainda não tem voto
      if (texto === VOTO_ILEGIVEL && ctx.lead_salao && !ctx.lead_salao.voto) {
        return { responder: 'Recebi o seu voto, mas não consegui ler aqui 😅 Me responde por texto, por favor: *1* se vai atender, *2* se não vai conseguir.', acao: 'voto_ilegivel' }
      }
      return { responder: null, acao: 'voto_ignorado' }
    }
    let r = (await chamar(deps, 'guia_whats_voto', { tel_: tel, voto_: voto, enquete_: e.enquete, lead_: null, origem_: 'enquete' })) as (Pedido & { primeiro: boolean }) | null
    if (!r && ctx.lead_salao && !ctx.lead_salao.voto) {
      r = (await chamar(deps, 'guia_whats_voto', { tel_: tel, voto_: voto, enquete_: null, lead_: ctx.lead_salao.id, origem_: 'enquete' })) as (Pedido & { primeiro: boolean }) | null
    }
    if (!r) return { responder: null, acao: 'voto_sem_pedido' }
    if (!r.primeiro) return { responder: null, acao: 'voto_repetido' }
    return await efeitosDoVoto(deps, cfg, r, voto)
  }

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
      if (quer) {
        // 3.74: com o WhatsApp comercial ligado, o caminho é a assistente de vendas; senão, a equipe chama por aqui
        const com = await linkComercial(deps, { nome: ctx.lead_salao.salao_nome ?? 'seu salão' }, true)
        return { responder: com ? `Que bom! 💗 ${com}\n\nSe preferir, alguém da equipe da MIMO te chama por aqui.` : 'Combinado! 💗 Alguém da equipe da MIMO vai te chamar por aqui.', acao: 'salao_quer_conhecer' }
      }
      // 3.57: um "não vou conseguir" / "vou atender" claro, por texto, vale como o voto (só o primeiro; a chave da enquete
      // não precisa casar). Um pedido que já tem voto não troca por texto: fica na thread para a equipe.
      const vt = alvo === ctx.lead_salao.id && ctx.lead_salao.voto ? null : (p === '1' ? 'sim' : p === '2' ? 'nao' : votoDoTexto(texto))
      if (vt) {
        const r = (await chamar(deps, 'guia_whats_voto', { tel_: tel, voto_: vt, enquete_: null, lead_: alvo, origem_: 'texto' })) as (Pedido & { primeiro: boolean }) | null
        if (r?.primeiro) return await efeitosDoVoto(deps, cfg, r, vt)
      }
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
    const id = await chamar(deps, 'guia_whats_conversa_salvar', { id_: conversa?.id ?? null, tel_: tel, lugar_: lugarId, estado_: estado, dados_: dados, novas_: [...novas], teste_: teste })
    novas.length = 0 // 3.77.1: o que foi gravado não vai de novo (o "sim" da cliente aparecia duas vezes na conversa)
    if (!conversa) conversa = { id: Number(id), telefone: tel, lugar_id: lugarId, estado, dados, mensagens: [] }
  }
  // 3.76: quem quer saber da MIMO Agenda: o link do comercial (ou do site). A conversa segue no estado em que estava —
  // se era uma cliente no meio do pedido, ela continua de onde parou.
  const agendaLigada = cfg.sobre_agenda !== false
  const sobreAgenda = async (dona: boolean): Promise<Saida> => {
    // o teto do dia por número (o mesmo do passo 5) vale aqui também: passou dele, silêncio
    if (!teste && Number(ctx.respostas_hoje ?? 0) >= Math.max(1, Number(cfg.limite_respostas) || 30)) return { responder: null, acao: 'limite_respostas' }
    const antes: Dados = { ...(conversa?.dados ?? {}) }
    const vezes = Number(antes.comercial ?? 0)
    const resposta = await textoSobreAgenda(deps, cfg, { lugar, dona, curta: vezes > 0 })
    const estado = conversa && conversa.estado !== 'encerrada' ? conversa.estado : 'conversando'
    const dados: Dados = { ...antes, comercial: vezes + 1 }
    await guardar(resposta, estado, dados, lugar?.id ?? null)
    return { responder: resposta, acao: 'sobre_agenda', estado, dados }
  }
  // 3.77: a cliente respondendo à oferta de outros salões (o resgate ou o "não" do salão): o número (ou o nome) escolhe;
  // com os dados completos vai direto ao resumo com o salão novo, e o pedido só sai com o "sim" dela
  const oferecidas = (!lugar && !codigo ? (conversa?.dados?.opcoes ?? []) : []) as Opcao[]
  const semOpcoes = (d: Dados): Dados => { const { opcoes: _o, ...resto } = d; return resto }
  if (oferecidas.length && conversa) {
    const escolha = escolhaDe(texto, oferecidas)
    const l = escolha ? ((await chamar(deps, 'guia_whats_lugar', { cidade_: null, slug_: null, id_: escolha.id })) as Lugar | null) : null
    if (l) {
      lugar = l
      conversa = { ...conversa, dados: semOpcoes(conversa.dados ?? {}), lugar: l, lugar_id: l.id }
      const dd: Dados = { ...conversa.dados, sem_avanco: 0 }
      if (!l.agendar && dd.nome && dd.servico && (!cfg.exigir_preferencia || dd.preferencia)) {
        const resposta = resumo(dd, l.nome)
        await guardar(resposta, 'confirmando', dd, l.id)
        return { responder: resposta, acao: 'escolheu', estado: 'confirmando', dados: dd }
      }
      // salão com agenda pela MIMO: o passo 4 manda o link; faltando algo, a conversa segue e a Mel pede
    } else if (!escolha && (ESPERAR.test(p) || NAO_CURTO.test(p))) {
      const anterior = conversa.dados?.salao_anterior || 'salão'
      // 3.77.1: esperar só faz sentido na demora; o salão que nem recebeu o pedido (ou que disse não) não vai chamar
      const motivo = conversa.dados?.oferta_motivo
      const resposta = !motivo || motivo === 'demora'
        ? `Combinado! 💗 Vou deixar o seu pedido com o ${anterior}. Se mudar de ideia, é só me mandar o número de um dos salões.`
        : NAO_CURTO.test(p) && !ESPERAR.test(p)
          ? `Tudo bem! 💗 Se mudar de ideia, é só me mandar o número de um dos salões ou o nome de outro salão do guia.`
          : motivo === 'nao'
            ? `O ${anterior} avisou que não vai conseguir atender desta vez 😕 Se quiser, me responde o número de um dos salões, ou me manda o nome de outro salão do guia.`
            : `Não consigo passar pedidos para o ${anterior} pelo WhatsApp 😕 Se quiser, me responde o número de um dos salões, ou me manda o nome de outro salão do guia.`
      await guardar(resposta, 'conversando', conversa.dados ?? {}, null)
      return { responder: resposta, acao: 'vai_esperar', estado: 'conversando' }
    }
  }
  // achou o salão de outro jeito (o código, o nome): as opções antigas saem
  if (lugar && conversa?.dados?.opcoes) conversa = { ...conversa, dados: semOpcoes(conversa.dados) }

  // a própria dona (o número é o cadastrado do salão) segue para o passo 4.5, que já apresenta a MIMO Agenda com o link
  const ehDonaDe = (l: Lugar | null) => !!l && ((teste && !!opcoes.comoDona) || (!teste && !!l.salao_tel && !!chaveDe(tel) && chaveDe(tel) === chaveDe(l.salao_tel)))
  if (agendaLigada && (opcoes.sobreAgenda || sobreAgendaDe(texto)) && !ehDonaDe(lugar)) return await sobreAgenda(false)

  if (!lugar) {
    const achados = p.length >= 4 ? ((await chamar(deps, 'guia_whats_buscar', { texto_: texto })) as Array<{ id: string; nome: string; cidade: string }>) : []
    if (achados?.length === 1) {
      lugar = (await chamar(deps, 'guia_whats_lugar', { cidade_: null, slug_: null, id_: achados[0].id })) as Lugar | null
    }
    if (!lugar) {
      // 3.76: quem já recebeu o link do comercial e segue sem salão: o lembrete curto, em vez de "de qual salão?"
      if (agendaLigada && !achados?.length && Number(conversa?.dados?.comercial ?? 0) > 0) return await sobreAgenda(false)
      // 3.77: quem está escolhendo entre os salões oferecidos e escreveu outra coisa: como responder
      if (oferecidas.length && !achados?.length) {
        // 3.77.1: "pode enviar", "qualquer um", "para outros": a Mel pede o número com a lista de novo (decisão da equipe:
        // não manda para todos de uma vez); o "vou esperar" só é lembrado quando o salão só está demorando
        const motivo = conversa?.dados?.oferta_motivo
        const lista = oferecidas.map((o, i) => `${i + 1}) ${o.nome}${o.bairro ? ` · ${o.bairro}` : ''}`).join('\n')
        const resposta = CONSENTE.test(p)
          ? `Claro! 💗 Para qual deles? Me responde o número:\n\n${lista}`
          : `É só me responder o número do salão (de 1 a ${oferecidas.length}) que eu passo o seu pedido 💗${!motivo || motivo === 'demora' ? ` Se preferir esperar o ${conversa?.dados?.salao_anterior || 'salão'}, me diz "vou esperar".` : ''}`
        await guardar(resposta, 'conversando', conversa?.dados ?? {}, null)
        return { responder: resposta, acao: 'escolhendo', estado: 'conversando' }
      }
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
  // No simulador (teste), o botão "testar como a dona" liga o opcoes.comoDona (sem comparar número); aí o aviso à equipe
  // não é enviado de verdade — volta como prévia.
  if (ehDonaDe(lugar)) {
    const exemplo = mensagemDoSalao(cfg, lugar, { cliente_nome: 'Maria (exemplo)', servico: 'Corte e escova', preferencia: 'sexta à tarde', observacao: null, cliente_tel: '5513999990000' })
    const resposta = (String(cfg.msg_dona ?? '').trim() || `Oi! 💗 Esse número é o que o ${lugar.nome} tem cadastrado no guia da MIMO. Assim chega um pedido de cliente pra você:\n\n{exemplo}\n\nA MIMO leva clientes até você, de graça — e tem a MIMO Agenda pra organizar tudo (salão e autônoma). A equipe vai te chamar pra mostrar. 💗`)
      .replaceAll('{salao}', lugar.nome).replaceAll('{exemplo}', exemplo)
      + (await linkComercial(deps, { nome: lugar.nome, cidade: lugar.cidade }).then((l) => (l ? `\n\n${l}` : '')))
    const jaAvisou = (ctx.conversa?.dados as Dados | undefined)?.dona === true
    const aviso = cfg.numero_avisos ? avisoDona(lugar, teste ? '5513999990000' : tel) : null
    await guardar(resposta, 'encerrada', { dona: true }, lugar.id)
    if (!teste && !jaAvisou && aviso) {
      try { await deps.enviar(cfg.instancia, so(cfg.numero_avisos!), aviso) } catch { /* o aviso é melhor-esforço */ }
    }
    return { responder: resposta, acao: 'dona', estado: 'encerrada', dados: { dona: true }, previaAviso: teste ? aviso : null }
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
    r = { leitura: { resposta: '', nome: '', servico: '', preferencia: '', observacao: '', cliente_confirmou_envio: curto === 'sim', cancelar: curto === 'nao', quer_apagar_dados: false, sobre_agenda: false, dona_do_salao: false } }
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
  // 3.76: a IA percebeu que é alguém do ramo querendo a MIMO Agenda (a frase não era das óbvias)
  if (lido.sobre_agenda && agendaLigada) return await sobreAgenda(!!lido.dona_do_salao)
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
      const pedidoTeste: Pedido = { id: 0, salao_nome: lugar.nome, cidade: lugar.cidade, cliente_nome: dados.nome, servico: dados.servico, preferencia: dados.preferencia, observacao: dados.observacao, cliente_tel: '5513999990000' }
      const previa = mensagemDoSalao(cfg, lugar, pedidoTeste)
      const resposta = confirmacao(cfg, lugar, dados, true)
      await guardar(resposta, 'enviado', dados, lugar.id)
      return { responder: resposta, acao: 'enviado_teste', previaSalao: previa, previaEnquete: cfg.enquete_ativa === false ? null : enqueteDoPedido(cfg, pedidoTeste), estado: 'enviado', dados }
    }
    await guardar(null, 'enviado', dados, lugar.id)
    const ld = (await chamar(deps, 'guia_whats_lead_criar', { conversa_: conversa!.id })) as (Pedido & { status: string; salao_tel: string | null; repetido: boolean })
    let ok = false
    let previa: string | null = null
    let statusFinal: string | undefined
    if (ld?.status === 'pendente' && ld.salao_tel) {
      // 3.57: o texto do pedido e, logo atrás, a enquete "vai atender?" (despacharPedido registra os dois)
      const d = await despacharPedido(deps, cfg, lugar, { ...ld, salao_tel: ld.salao_tel })
      ok = d.ok
      previa = d.texto
      statusFinal = d.status
      // 3.72: o número do salão não existe no WhatsApp (ou o envio falhou): a cliente segue normal e a equipe é
      // avisada no nosso número, como no caso sem número — o pedido não fica no vazio
      if (!ok && cfg.numero_avisos) {
        const motivo = d.status === 'sem_contato'
          ? `o número ${telefoneBonito(ld.salao_tel)} do cadastro não tem WhatsApp`
          : `o envio para ${telefoneBonito(ld.salao_tel)} falhou${d.erro ? ` (${String(d.erro).slice(0, 120)})` : ''}`
        try { await deps.enviar(cfg.instancia, so(cfg.numero_avisos), avisoEquipe(lugar, ld, motivo)) } catch { /* segue sem o aviso */ }
      }
    } else if (ld?.repetido) {
      ok = ld.status !== 'falhou'
    } else if (ld?.status === 'sem_contato' && cfg.numero_avisos) {
      // o salão não tem WhatsApp (ou o número é o da própria cliente): a cliente segue normal, mas avisamos a equipe no
      // nosso número, para não ficar um pedido no vazio e para dar para medir. O aviso é melhor-esforço (não trava a cliente).
      try { await deps.enviar(cfg.instancia, so(cfg.numero_avisos), avisoEquipe(lugar, ld)) } catch { /* segue sem o aviso */ }
    }
    // 3.77.1: o pedido não chegou ao salão (sem WhatsApp, o envio falhou, o salão pediu SAIR): em vez de "vou passar e
    // eles te chamam" (e o resgate só meia hora depois), a Mel já oferece os outros salões. Com o resgate desligado
    // (resgate_min = 0), ou num banco sem a 222, fica como era.
    const st = statusFinal ?? ld?.status ?? ''
    if (!ok && ld?.id && !ld.repetido && ['sem_contato', 'falhou', 'salao_saiu'].includes(st) && Number(cfg.resgate_min ?? 30) > 0) {
      try {
        const opcoes = ((await chamar(deps, 'guia_whats_alternativas', { lead_: ld.id, n_: Math.max(1, Math.min(5, Number(cfg.resgate_opcoes) || 3)) })) as Opcao[] | null) ?? []
        const nome = dados.nome ? `, ${primeiroNome(dados.nome)}` : ''
        const texto = `Anotei seu pedido${nome}! 💗 Mas não consegui passar para o ${lugar.nome} pelo WhatsApp 😕\n\n${textoOpcoes(opcoes, dados.servico)}`
        await chamar(deps, 'guia_whats_oferecer', { lead_: ld.id, texto_: texto, opcoes_: opcoes, motivo_: st === 'falhou' ? 'falhou' : 'sem_contato' })
        return { responder: texto, acao: 'oferta_na_hora', previaSalao: previa, estado: 'conversando', dados: { ...dados, opcoes, salao_anterior: lugar.nome, oferta_motivo: st === 'falhou' ? 'falhou' : 'sem_contato' } }
      } catch { /* sem as funções da 222: a resposta de antes */ }
    }
    const resposta = confirmacao(cfg, lugar, dados, ok)
    await guardar(resposta, 'enviado', dados, lugar.id)
    return { responder: resposta, acao: ok ? 'enviado' : `pedido_${statusFinal ?? ld?.status ?? 'erro'}`, previaSalao: previa, estado: 'enviado', dados }
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

// 3.57: o que acontece no PRIMEIRO voto do salão (pela enquete ou por texto). Sim: a Mel responde ao salão com o link de
// novo. Não: agradece ao salão, avisa a equipe (numero_avisos) e, se ligado, avisa a cliente e reabre a conversa dela
// sem salão (guia_whats_conversa_reabrir), para ela escolher outro. Os envios laterais são melhor-esforço: nunca
// derrubam a resposta ao salão.
async function efeitosDoVoto(deps: Deps, cfg: Config, p: Pedido, voto: 'sim' | 'nao'): Promise<Saida> {
  // 3.77: a cliente já fez o pedido em outro salão (depois do resgate): o salão recebe um obrigado, sem o link e sem aviso
  let seguiu = false
  try { seguiu = (await chamar(deps, 'guia_whats_cliente_seguiu', { lead_: p.id })) === true } catch { seguiu = false }
  if (seguiu) {
    return voto === 'sim'
      ? { responder: salaoAtrasado(p), acao: 'salao_vai_atender_tarde' }
      : { responder: respostasDoVoto(cfg, p, 'nao').salao, acao: 'salao_nao_atende' }
  }
  if (voto === 'nao') {
    // 3.77: o "não" já sugere os salões (os mesmos critérios do resgate)
    let opcoes: Opcao[] = []
    if (cfg.avisar_cliente_nao !== false) {
      try { opcoes = ((await chamar(deps, 'guia_whats_alternativas', { lead_: p.id, n_: Math.max(1, Math.min(5, Number(cfg.resgate_opcoes) || 3)) })) as Opcao[] | null) ?? [] } catch { opcoes = [] }
    }
    const r = respostasDoVoto(cfg, p, voto, opcoes)
    if (r.aviso && cfg.numero_avisos) {
      try { await deps.enviar(cfg.instancia, so(cfg.numero_avisos), r.aviso) } catch { /* melhor-esforço */ }
    }
    if (r.cliente) {
      try {
        try { await chamar(deps, 'guia_whats_oferecer', { lead_: p.id, texto_: r.cliente, opcoes_: opcoes, motivo_: 'nao' }) }
        catch { await chamar(deps, 'guia_whats_conversa_reabrir', { lead_: p.id, texto_: r.cliente }) } // num banco sem a 222
        await deps.enviar(cfg.instancia, p.cliente_tel, r.cliente)
      } catch (e) { return { responder: r.salao, acao: 'salao_nao_atende', erro: `aviso à cliente: ${String((e as Error)?.message ?? e).slice(0, 200)}` } }
    }
    return { responder: r.salao, acao: 'salao_nao_atende', previaCliente: r.cliente, previaAviso: r.aviso }
  }
  const r = respostasDoVoto(cfg, p, voto)
  // 3.77: a Mel já tinha oferecido outros salões e a cliente ainda não escolheu: ela fica sabendo, e a conversa volta
  if (p.resgate_em) {
    const aviso = `Boa notícia${p.cliente_nome ? `, ${primeiroNome(p.cliente_nome)}` : ''}! 💗 O ${p.salao_nome} respondeu e vai te chamar aqui no WhatsApp para combinar o horário.`
    try {
      const voltou = await chamar(deps, 'guia_whats_conversa_voltou', { lead_: p.id, texto_: aviso })
      if (voltou) await deps.enviar(cfg.instancia, p.cliente_tel, aviso)
    } catch { /* melhor-esforço: o salão recebe a resposta de qualquer jeito */ }
  }
  return { responder: r.salao, acao: 'salao_vai_atender' }
}

// o simulador da Plataforma: como se o salão tivesse votado no pedido da conversa de teste — devolve o que o salão, a
// cliente e a equipe receberiam (nada é enviado; não existe pedido de verdade na conversa de teste)
export async function simularVoto(deps: Deps, tel: string, voto: 'sim' | 'nao'): Promise<Saida> {
  const ctx = (await chamar(deps, 'guia_whats_contexto', { tel_: tel })) as { config: Config; conversa: Conversa | null }
  const cfg = ctx?.config
  const cv = ctx?.conversa
  if (!cfg || !cv?.lugar) return { responder: null, acao: 'sem_conversa_teste' }
  const d = cv.dados ?? {}
  const p: Pedido = { id: 0, salao_nome: cv.lugar.nome, cidade: cv.lugar.cidade, cliente_nome: d.nome, cliente_tel: '5513999990000', servico: d.servico, preferencia: d.preferencia, observacao: d.observacao }
  const opcoes = voto === 'nao' ? await alternativasDoTeste(deps, cfg, cv) : []
  const r = respostasDoVoto(cfg, p, voto, opcoes)
  return { responder: r.salao, acao: voto === 'sim' ? 'salao_vai_atender' : 'salao_nao_atende', previaCliente: r.cliente, previaAviso: r.aviso, previaEnquete: enqueteDoPedido(cfg, p) }
}
async function alternativasDoTeste(deps: Pick<Deps, 'rpc'>, cfg: Config, cv: Conversa): Promise<Opcao[]> {
  try {
    return ((await chamar(deps, 'guia_whats_alternativas_de', { lugar_: cv.lugar!.id, servico_: cv.dados?.servico ?? null, chave_: null, n_: Math.max(1, Math.min(5, Number(cfg.resgate_opcoes) || 3)) })) as Opcao[] | null) ?? []
  } catch { return [] }
}
// 3.77: no simulador, "e se o salão não responder?": a mensagem do resgate entra na conversa de teste, que reabre com as
// opções (dá para seguir respondendo o número, como a cliente faria). Nada é enviado.
export async function simularResgate(deps: Deps, tel: string): Promise<Saida> {
  const ctx = (await chamar(deps, 'guia_whats_contexto', { tel_: tel })) as { config: Config; conversa: Conversa | null }
  const cfg = ctx?.config
  const cv = ctx?.conversa
  if (!cfg || !cv?.lugar) return { responder: null, acao: 'sem_conversa_teste' }
  const opcoes = await alternativasDoTeste(deps, cfg, cv)
  const texto = mensagemResgate(cfg.msg_resgate, { cliente_nome: cv.dados?.nome, salao_nome: cv.lugar.nome, servico: cv.dados?.servico }, opcoes)
  await chamar(deps, 'guia_whats_teste_oferecer', { tel_: tel, texto_: texto, opcoes_: opcoes, salao_: cv.lugar.nome })
  return { responder: texto, acao: 'resgate', estado: 'conversando', dados: { ...(cv.dados ?? {}), opcoes } }
}

// 3.53: o aviso interno à equipe quando o salão não tem WhatsApp para receber o pedido (ou o número é o da própria
// cliente). Vai para o nosso número (numero_avisos), nunca para a cliente. É um recado de operação, não um texto dela.
export function avisoEquipe(l: Lugar, ld: { cliente_nome?: string | null; cliente_tel?: string | null; servico?: string | null; preferencia?: string | null; cidade?: string | null }, motivo?: string | null): string {
  const onde = [l.nome, ld.cidade ?? l.cidade].filter(Boolean).join(' · ')
  return [
    '⚠️ MIMO — salão sem WhatsApp',
    motivo ? `${onde}: ${motivo}.` : `${onde} não tem WhatsApp para receber o pedido.`,
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
// A chamada em si (esquema estrito, failed_generation, json_object de reserva) mora em ia_json.ts (3.55: é a mesma do
// agente de onboarding); aqui ficam só o esquema da Mel-cliente, a frase dos campos e o leitor.
const CAMPOS_JSON = 'Responda só com um objeto JSON com exatamente estes campos: "resposta" (texto), "nome", "servico", "preferencia", "observacao" (textos; "" quando não souber), "cliente_confirmou_envio", "cancelar", "quer_apagar_dados", "sobre_agenda", "dona_do_salao" (true ou false).'

function montarLeitura(lido: Record<string, unknown>): LeituraIa | null {
  if (typeof lido?.resposta !== 'string') return null
  return {
    resposta: lido.resposta, nome: String(lido.nome ?? ''), servico: String(lido.servico ?? ''), preferencia: String(lido.preferencia ?? ''),
    observacao: String(lido.observacao ?? ''), cliente_confirmou_envio: lido.cliente_confirmou_envio === true, cancelar: lido.cancelar === true,
    quer_apagar_dados: lido.quer_apagar_dados === true, sobre_agenda: lido.sobre_agenda === true, dona_do_salao: lido.dona_do_salao === true,
  }
}

export function iaDe(env: Ambiente, fetcher: Fetch): Deps['ia'] {
  return iaJsonDe<LeituraIa>(env, fetcher, { esquema: ESQUEMA, campos: CAMPOS_JSON, montar: montarLeitura })
}
