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
  // 4.2 (migração 252): uma segunda mensagem, uns segundos depois da resposta (o convite do Instagram no fim da conversa)
  depois?: string | null
  // 4.8 (migração 263): a conversa em que a segunda mensagem deve ficar guardada
  conversaId?: number | null
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
export type Opcao = { id: string; nome: string; bairro?: string | null; cidade?: string | null; km?: number | null; agendar?: string | null }
type Dados = {
  nome?: string; servico?: string; preferencia?: string; observacao?: string; pos_envio?: number; sem_avanco?: number; dona?: boolean; salao_recusou?: string; comercial?: number
  opcoes?: Opcao[]; resgate_de?: number; salao_anterior?: string
  // 3.77.1 (migração 223): por que a Mel ofereceu (demora, sem_contato, falhou, nao): só na demora dá para "esperar"
  oferta_motivo?: string
  // 4.6: os salões achados pelo nome, esperando a cliente confirmar qual é; quantas vezes a Mel já pediu o salão sem achar;
  // e a marca de quem pediu para parar
  candidatos?: Opcao[]; sem_salao?: number; parou?: boolean
  // 4.7: o que a cliente sem salão já disse, para a Mel indicar: a cidade, o serviço (a categoria e a frase), o bairro e os
  // salões já mostrados
  busca?: { cidade?: string; cidade_slug?: string; categoria?: string | null; servico?: string; tem_servico?: boolean; bairro?: string | null; vistos?: string[] }
}
// 4.7 (migração 262): o que a Mel lembra de quem escreve: o último pedido das últimas 48 h e o nome dos últimos 60 dias
export type LeadMemoria = {
  id: number; conversa_id?: number | null; lugar_id?: string | null; salao_nome: string; cidade?: string | null; cliente_nome?: string | null
  servico?: string | null; status: string; voto?: string | null; viu?: boolean; ofereceu?: boolean; minutos?: number
}
type Memoria = { lead?: LeadMemoria | null; nome?: string | null }
export type Indicacao = { cidade: { slug: string; nome: string } | null; presumida?: boolean; categoria?: string | null; bairro?: string | null; tem_servico?: boolean; servico_agora?: boolean; opcoes?: Opcao[] }
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
  // 4.2 (migração 252): o convite do Instagram no fim da conversa ("sim" e "não") e de quanto em quanto tempo por número
  insta_ligado?: boolean | null; insta_dias?: number | null; msg_insta_sim?: string | null; msg_insta_nao?: string | null
  // 4.7 (migração 262): o aviso à cliente quando o salão vota "sim"
  avisar_cliente_sim?: boolean | null; msg_cliente_vai_atender?: string | null
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
// 3.78: a autônoma sai do cadastro por enquanto. A Mel não pergunta mais "salão ou autônoma" no cadastro pelo
// WhatsApp (todo cadastro é salão; quem atende sozinha diz 1 profissional), e a Lia não oferece o plano Autônoma.
// Para voltar a oferecer: true aqui e em src/pages/Onboarding.jsx.
export const AUTONOMA_NO_CADASTRO = false

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
const SIM_EMOJI = /^(?:\s|👍|✅|👌|🙏|💗|🆗|\u2764|\uFE0F|🥰|😊|[\u{1F3FB}-\u{1F3FF}])+$/u
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
// ---- 4.6: o pacote 1 das conversas reais -----------------------------------------------------------------------------
// A resposta automática do WhatsApp Business (fora do horário, boas-vindas, "em breve estarei com você", menu de opções).
// Ela chega do salão logo depois do pedido, ou cai aqui como se fosse uma cliente. Não é resposta do salão, nem voto
// (um "no momento não consigo atender" automático virava o "não" do salão), nem pedido de cliente.
const AUTOMATICA = [
  /\b(mensagem|resposta) automatica\b/,
  /\bfora do (nosso |meu )?(horario|expediente)\b/,
  /\bsejam? bem vind[oa]s?\b/,
  /\b(estou|estamos) (ausente|ausentes|indisponivel|indisponiveis|offline)\b/,
  /\bno momento (nao )?(estou|estamos|me encontro|nos encontramos) (ausente|ausentes|indisponivel|indisponiveis|offline|fora)\b/,
  /\b(em breve|logo|ja ja) (estarei|estaremos) (com voce|contigo|com vc|disponivel|disponiveis)\b/,
  /\b(retornarei|retornaremos|responderei|responderemos|te respondo|te retorno|retorno|respondo) (assim que (possivel|puder|eu (retornar|voltar|puder))|o mais (breve|rapido) possivel)\b/,
  /\bassim que (eu )?(retornar|voltar|estiver disponivel)\b.*\b(respond|retorn|atend)/,
  /\b(digite|escolha|selecione) (uma das opcoes|uma opcao|o numero|a opcao)\b/,
  /\bdeixe (sua|seu|a sua|o seu) (mensagem|recado)\b/,
]
export const ehRespostaAutomatica = (texto: string) => { const p = palavra(texto); return !!p && AUTOMATICA.some((r) => r.test(p)) }

// "parar", "encerrar", "para de mandar mensagem", "me tira da lista": a Mel encerra e não manda mais nada por conta própria
const PARAR = /^(parar|pare|para|parem|stop|sair|encerrar|encerra|encerre|chega|descadastrar|descadastra|me descadastra|bloquear)( (por favor|pf|pfv|obrigad[ao]))?$|\b(para|pare|parem|parar) de (me )?(mandar|enviar|manda|envia|mandando|enviando)\b|\bnao (me )?(mande|mandem|envie|enviem|manda|envia) mais\b|\b(me )?(tira|tirem|remove|remova|removam|exclui|exclua) (da|dessa|desta) lista\b|\b(tira|tirem|remove|remova|exclui|exclua) (o )?meu (numero|contato)\b|\bnao quero (mais )?receber\b|\bencerr(ar|a|e) (a |essa |esta |nossa )?conversa\b/
export const pedidoDeParar = (texto: string) => PARAR.test(palavra(texto))
export const MSG_PAROU = 'Tudo bem! 💗 Encerrei por aqui e não te mando mais mensagens. Se quiser marcar um horário depois, é só me chamar.'

// a cliente desistiu de vez (na oferta de outros salões): "desisto, obrigada", "já consegui", "deixa pra lá"
const DESISTE = /\b(desisto|desisti|desistir|deixa (pra|para) la|esquece|esqueca|nao (quero|preciso) mais|nao vou (mais )?(querer|precisar)|ja (consegui|marquei|resolvi|achei|agendei)|nao precisa mais)\b/
export const desistiu = (p: string) => DESISTE.test(p)
// "não, obrigada" é um "não": a gentileza no fim não muda a resposta
const semCortesia = (p: string) => p.replace(/\s+(obrigad[ao]|brigad[ao]|obg|valeu|vlw)( mesmo)?$/, '').trim()

// mais de um número na resposta à oferta ("1 e 3", "o 2 ou o 3"): a Mel passa para um por vez, começando pelo primeiro.
// Só vale quando a frase é a lista de números (em "pode ser às 3" o 3 é hora, não salão).
const ENCHIMENTO = /\b(o|a|os|as|e|ou|opcao|opcoes|numero|numeros|quero|manda|mande|pode|ser|pro|pra|pros|pras|para|no|na|nos|nas|salao|saloes|sim|por favor)\b/g
export function escolhasDe(texto: string, opcoes: Opcao[]): Opcao[] {
  const resto = palavra(texto).replace(ENCHIMENTO, ' ').replace(/\s+/g, ' ').trim()
  if (!/^[1-9](?: [1-9])+$/.test(resto)) return []
  const nums = [...new Set(resto.split(' ').map(Number))].filter((n) => n >= 1 && n <= opcoes.length)
  return nums.map((n) => opcoes[n - 1]).filter(Boolean)
}
// "manda pros 3", "todos", "os dois": a Mel explica que é um por vez e pergunta qual primeiro
const TODOS = /\b(todos|todas|ambos|ambas|os (2|3|4|5|dois|tres)|as (2|3|duas|tres)|pros (2|3|dois|tres|todos)|pras (2|3|duas|tres|todas)|para (os|todos) (2|3|dois|tres)|para todos|pra todos)\b/

// os salões achados pelo nome, para a cliente confirmar antes de a Mel seguir
const ondeFica = (o: Opcao) => [o.bairro, o.cidade].filter(Boolean).join(', ')
// "é esse", "esse mesmo", "exato": o sim de quem confirma o salão
const E_ESSE = /^(e |sim )?(esse|essa|este|esta|ele|ela|isso|exato|exatamente|correto|certinho)( mesmo| mesma| ai| sim| ai mesmo)?( sim)?$/
export const MSG_OI = 'Oi! Aqui é a Mel, da MIMO 💗, o guia de salões.'
export function textoCandidatos(c: Opcao[], primeira: boolean): string {
  const oi = primeira ? `${MSG_OI} ` : ''
  if (c.length === 1) return `${oi}É o *${c[0].nome}*${ondeFica(c[0]) ? ` (${ondeFica(c[0])})` : ''}? Me responde *sim* que eu sigo com o seu pedido.`
  return [`${oi}Achei mais de um salão com esse nome:`, '', ...c.map((o, i) => `${i + 1}) ${o.nome}${ondeFica(o) ? ` · ${ondeFica(o)}` : ''}`), '', 'Qual deles? Me responde o número.'].join('\n')
}
export const MSG_SEM_SALAO = `${MSG_OI} Me conta o serviço que você quer e a sua cidade que eu te indico salões. Se já tem um salão em mente, me manda o nome ou o link da página dele.`
export const MSG_SEM_SALAO_DICA = `Ainda não sei de qual salão é 😕 O jeito mais fácil: abra a página do salão em ${RAIZ_SITE} e toque em *WhatsApp*. A mensagem já vem com o código dele e eu sigo daqui. Se preferir, me manda o nome do salão do jeito que aparece no guia.`

// 4.6: o lembrete da conversa parada, conforme a etapa. No resumo (confirmando), o texto da Plataforma (msg_ocioso); antes
// dele, o que falta para o pedido sair. O relógio só cutuca conversa com salão (migração 261).
export function textoOcioso(base: string | null | undefined, c: { estado?: string | null; salao?: string | null; nome?: string | null; servico?: string | null; preferencia?: string | null }, exigirPreferencia = false): string {
  const nome = primeiroNome(c.nome)
  const oi = `Oi${nome ? `, ${nome}` : ''}!`
  const salao = c.salao || 'salão'
  if (c.estado === 'confirmando') {
    const t = String(base ?? '').trim()
    return t ? trocarTudo(ajustarNome(t), { nome, salao: c.salao ?? '' }) : `${oi} Seu pedido para o ${salao} está pronto 💗 Posso enviar? É só responder *sim*. Se preferir deixar pra depois, tudo bem: é só me chamar quando quiser.`
  }
  const falta = [!c.nome && 'o seu nome', !c.servico && 'o serviço que você quer', exigirPreferencia && !c.preferencia && 'o dia e o horário de preferência'].filter(Boolean) as string[]
  if (!falta.length) return `${oi} Ainda quer marcar no ${salao}? 💗 É só me responder por aqui. Se preferir deixar pra depois, tudo bem.`
  const lista = falta.length === 1 ? falta[0] : `${falta.slice(0, -1).join(', ')} e ${falta[falta.length - 1]}`
  return `${oi} Ficou faltando só ${lista} para eu passar o seu pedido para o ${salao} 💗 Se preferir continuar depois, tudo bem: é só me chamar.`
}

// ---- 4.7: o pacote 2 das conversas reais (indicar, lembrar, avisar do "sim") ------------------------------------------
// A cliente sem salão definido recebe indicações (guia_whats_indicar, migração 262): a Mel pergunta o que falta (a cidade
// ou o serviço) e mostra até 3 salões numerados; "outros" mostra mais.
const DE_CATEGORIA: Record<string, string> = { unhas: ' de unhas', cabelo: ' de cabelo', cilios: ' de cílios', sobrancelhas: ' de sobrancelhas', maquiagem: ' de maquiagem', estetica: ' de estética' }
const deCategoria = (c: string | null | undefined) => DE_CATEGORIA[String(c ?? '')] ?? ''
export function textoIndicados(ind: Indicacao, primeira: boolean, mais = false): string {
  const ops = (ind.opcoes ?? []).filter((o) => o?.id && o?.nome)
  const cidade = ind.cidade?.nome ?? ''
  const um = ops.length === 1
  const cab = mais ? (um ? 'Tenho mais este' : 'Tenho mais estes') : (um ? 'Achei este salão' : 'Achei estes salões')
  const linhas = ops.map((o, i) => `${i + 1}) ${o.nome}${o.bairro ? ` · ${o.bairro}` : ''}${o.agendar ? ' — agenda pela MIMO, você marca na hora' : ''}`)
  return [
    `${primeira ? `${MSG_OI} ` : ''}${cab}${deCategoria(ind.categoria)} em ${cidade}:`, '', ...linhas, '',
    um ? 'Quer marcar nele? Me responde *sim* 💗 Se quiser ver outros, me diz *outros*.' : 'Em qual deles você quer marcar? Me responde o número 💗 Se quiser ver outros, me diz *outros*.',
    ...(ind.presumida && !mais ? ['', `(Procurei em ${cidade}, onde foi o seu último pedido. Se for em outra cidade, me diz qual.)`] : []),
  ].join('\n')
}
const SERVICOS_EXEMPLO = 'unha, cabelo, cílios, sobrancelha, maquiagem, depilação, massagem'
export const perguntaServico = (ind: Indicacao, primeira: boolean, deNovo = false) => deNovo
  ? `Não entendi o serviço 😅 Me diz, por exemplo: ${SERVICOS_EXEMPLO}.`
  : `${primeira ? `${MSG_OI} ` : ''}Qual serviço você quer fazer em ${ind.cidade?.nome}? (${SERVICOS_EXEMPLO}…) Eu te indico salões 💗${ind.presumida ? ' Se for em outra cidade, me diz qual.' : ''}`
export const perguntaCidade = (ind: Indicacao, primeira: boolean, deNovo = false) => deNovo
  ? `Não achei essa cidade no guia 😕 Me manda o nome da cidade de novo? As cidades do guia estão em ${RAIZ_SITE}/saloes`
  : `${primeira ? `${MSG_OI} ` : ''}Em qual cidade você está? Eu te indico salões${deCategoria(ind.categoria)} por aí 💗`
const linkDaCidade = (ind: Indicacao) => `https://${RAIZ_SITE}/saloes/${ind.cidade?.slug}`
export const semIndicacao = (ind: Indicacao, primeira: boolean) =>
  `${primeira ? `${MSG_OI} ` : ''}Ainda não tenho salão${deCategoria(ind.categoria)} em ${ind.cidade?.nome} que receba pedido por aqui 😕 Dá para ver todos os de ${ind.cidade?.nome} no guia: ${linkDaCidade(ind)}\n\nSe tiver um salão em mente, me manda o nome ou o link da página dele.`
// "outros", "nenhum", "tem mais?": a cliente quer ver mais indicações
const MAIS = /\b(outros|outras|outro|outra|nenhum|nenhuma|mais opcoes|mais saloes|ver mais|tem mais|mostra mais|manda mais)\b/

// A memória: "o salão respondeu?", "até agora nada", "ninguém me chamou" pedem a situação do pedido; "outro" pede outro salão
const STATUS = /\b(respondeu|responderam|retornou|retornaram|chamou|chamaram|novidade|novidades|noticia|noticias)\b|\b(algum|alguma|teve|tem|tive|recebi|sem|nenhum|nenhuma|aguardo|aguardando|esperando) (o |a |um |uma )?(retorno|resposta|contato|novidade|noticia)\b|\b(ninguem|nada) (me )?(respondeu|chamou|falou|retornou|ate agora|ainda)\b|\bate agora (nada|ninguem|nao)\b|\b(entrou|entraram) em contato\b|\bdemorando\b|\bvai demorar\b|\bdemora muito\b|^e ai$/
const QUER_OUTRO = /\b(outro salao|outra opcao|outras opcoes|outros saloes|outro lugar|quero outro|quero outra|tem outro|tem outra|(mostra|manda|indica|ve|ver) outr[oa]s?)\b|^(outro|outra|outros|outras)$/
export const perguntaDoPedido = (texto: string) => STATUS.test(palavra(texto))
export const querOutroSalao = (texto: string) => QUER_OUTRO.test(palavra(texto))
// só um obrigada, um ok: de quem já foi atendida, não pede resposta
const AGRADECE = /^(muito |muit[ao] )?(obrigad[ao]|brigad[ao]|obg|obgd|valeu|vlw|ok|okay|ta|ta bom|ta bem|ta otimo|beleza|blz|certo|combinado|perfeito|otimo|show|imagina|de nada|tchau|ate mais|ate logo)( mesmo| viu| ta| entao)?( obrigad[ao])?$/
export type Situacao = 'nao_chegou' | 'nao' | 'sim' | 'viu' | 'recente' | 'sem_sinal'
// a situação do pedido, pelo que o banco sabe (nada inventado): tipo, a frase para a IA e a frase para a cliente
export function situacaoDoPedido(ld: LeadMemoria): { tipo: Situacao; curta: string; texto: string } {
  const s = ld.salao_nome
  const ha = tempoBonito(Number(ld.minutos ?? 0))
  if (['sem_contato', 'falhou', 'fora_do_limite', 'salao_saiu'].includes(ld.status)) return { tipo: 'nao_chegou', curta: 'não deu para entregar o pedido ao salão pelo WhatsApp', texto: `Não consegui passar o seu pedido para o ${s} pelo WhatsApp 😕` }
  if (ld.voto === 'nao' || ld.status === 'salao_nao_atende') return { tipo: 'nao', curta: 'o salão avisou que não vai conseguir atender', texto: `O ${s} avisou que não vai conseguir te atender desta vez 😕` }
  if (ld.voto === 'sim' || ld.status === 'salao_vai_atender') return { tipo: 'sim', curta: 'o salão confirmou que vai atender e vai chamar a cliente no WhatsApp', texto: `O ${s} confirmou que vai te atender 💗 Eles te chamam aqui no WhatsApp para combinar o horário. Se ainda não chamaram e você preferir outro salão, me diz *outro*.` }
  if (ld.viu || ['salao_respondeu', 'salao_quer_conhecer'].includes(ld.status)) return { tipo: 'viu', curta: `o salão já viu o pedido (enviado há ${ha}), mas ainda não confirmou se vai atender`, texto: `O ${s} já viu o seu pedido (enviei há ${ha}), mas ainda não confirmou se vai atender 😕 Se preferir não esperar, me diz *outro* que eu te mostro outros salões.` }
  if (Number(ld.minutos ?? 0) < 20) return { tipo: 'recente', curta: `enviado há ${ha}; o salão ainda não respondeu`, texto: `Enviei o seu pedido para o ${s} há ${ha} e ele ainda não respondeu. Salão costuma levar um tempinho 💗 Se preferir não esperar, me diz *outro* que eu te mostro outros salões.` }
  return { tipo: 'sem_sinal', curta: `enviado há ${ha}; o salão ainda não respondeu`, texto: `O ${s} ainda não respondeu o seu pedido (enviei há ${ha}) 😕` }
}
export const MSG_CLIENTE_VAI_ATENDER = 'Boa notícia, {nome}! 💗 O {salao} confirmou que vai te atender e vai te chamar aqui no WhatsApp para combinar o horário.'
export const avisoDoSim = (cfg: Pick<Config, 'msg_cliente_vai_atender'>, p: Pick<Pedido, 'cliente_nome' | 'salao_nome' | 'servico'>) =>
  trocarTudo(ajustarNome(String(cfg.msg_cliente_vai_atender ?? '').trim() || MSG_CLIENTE_VAI_ATENDER), { nome: primeiroNome(p.cliente_nome), salao: p.salao_nome, servico: p.servico ?? '' })

// ---- 4.8: o resto do pacote 2 (começo mais curto, complemento do pedido) -----------------------------------------------
// O nome do perfil do WhatsApp, quando parece nome de gente ("Bia Souza 💕" → "Bia Souza"; "Studio Bella", "Mãe da Lu",
// "." e números não valem). Ele entra no pedido sem pergunta: aparece no resumo, e a cliente corrige se quiser.
const NAO_E_NOME = /\b(salao|studio|estudio|beauty|nails?|hair|lash|make|estetica|esmalteria|loja|store|oficial|vendas|atendimento|delivery|ltda|mei|imoveis|consultoria|advocacia|clinica|espaco|atelie|doces|bolos|moda|mae|pai|filh[ao]|mamae|vovo|tia|tio|amor|vida|deus|jesus|familia|casa|trabalho|whatsapp|zap|cliente|contato)\b/
export function nomeDoPerfil(perfil: string | null | undefined): string {
  const limpo = String(perfil ?? '').normalize('NFC').replace(/[^\p{L}\s'.-]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (limpo.length < 2 || limpo.length > 40) return ''
  const partes = limpo.split(' ')
  if (partes.length > 4 || partes[0].replace(/[^\p{L}]/gu, '').length < 2) return ''
  if (NAO_E_NOME.test(palavra(limpo))) return ''
  // tudo em maiúsculas ou em minúsculas vira "Bia Souza"
  const igual = limpo === limpo.toUpperCase() || limpo === limpo.toLowerCase()
  return igual ? partes.map((w) => (w.length <= 2 && partes.length > 1 && w !== partes[0] ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ') : limpo
}
// a primeira resposta a quem chega pelo botão do site (a mensagem pronta, sem mais nada): curta e já com a pergunta do
// serviço. Antes era um parágrafo que terminava em "Qual é o seu nome?", e 81 de 279 clientes paravam ali.
export function aberturaCurta(l: { nome: string }, nome: string): string {
  const primeiro = primeiroNome(nome)
  return primeiro
    ? `Oi, ${primeiro}! Aqui é a Mel, da MIMO 💗 Eu passo o seu pedido para o ${l.nome} e eles te chamam aqui no WhatsApp para combinar. Qual serviço você quer fazer? Se já souber o dia, me conta também.`
    : `Oi! Aqui é a Mel, da MIMO 💗 Eu passo o seu pedido para o ${l.nome} e eles te chamam aqui no WhatsApp para combinar. Me conta o seu nome e o serviço que você quer fazer?`
}
// o complemento que vai ao salão quando a cliente diz o dia, o horário ou um detalhe depois que o pedido já foi
export function complementoDoSalao(p: { cliente_nome?: string | null; cliente_tel: string; salao_nome: string; servico?: string | null; token?: string | null }, novo: { servico?: string; preferencia?: string; observacao?: string }): string {
  const link = p.token ? linkDoPedido(p.token) : linkParaCliente(p.cliente_tel, p.cliente_nome ?? '', p.salao_nome, p.servico ?? '')
  return [
    `💗 MIMO — complemento do pedido ${p.cliente_nome ? `da ${primeiroNome(p.cliente_nome)}` : 'da cliente'}`,
    ...(novo.servico ? [`Serviço: ${novo.servico}`] : []),
    ...(novo.preferencia ? [`Preferência: ${novo.preferencia}`] : []),
    ...(novo.observacao ? [`Observação: ${novo.observacao}`] : []),
    `Para falar com ela: ${link}`,
  ].join('\n')
}

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
export function sistema(cfg: Config, l: Lugar, d: Dados, estado: string, nomePerfil: string | null | undefined, agora: Date, situacao?: string | null): string {
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
    `- Nome: ${d.nome || 'ainda não sei'}${!d.nome && nomePerfil ? ` (o perfil do WhatsApp diz "${nomePerfil}"; confirme antes de usar)` : ''}${d.nome ? ' (já anotado: não pergunte nem peça para confirmar; ele aparece no resumo e ela corrige se quiser)' : ''}`,
    `- Serviço: ${d.servico || 'ainda não sei'}`,
    `- Preferência de dia e horário: ${d.preferencia || 'ainda não sei'}`,
    `- Observação: ${d.observacao || 'nenhuma'}`,
    `- Estado: ${estado === 'confirmando' ? 'confirmando (já mostrei o resumo e perguntei se posso enviar ao salão)' : estado === 'enviado' ? 'enviado (o pedido já foi para o salão; só tire dúvidas, não peça os dados de novo)' : 'conversando'}`,
    ...(estado === 'enviado' && situacao ? [`- Situação do pedido (é o que se sabe de verdade; pode dizer à cliente, sem inventar nada além disso): ${situacao}.`] : []),
    '- Nunca gaste uma mensagem só para pedir o nome: se ainda não souber, peça junto com o serviço. A apresentação é uma frase curta, só na primeira resposta.',
    ...(estado === 'enviado' ? ['- Se ela disser agora um dia, um horário ou um detalhe novo, diga só que anotou. Não diga que vai passar, avisar ou repassar ao salão: quando o aviso sai, o sistema acrescenta essa frase.'] : []),
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
  const ctx = (await chamar(deps, 'guia_whats_contexto', { tel_: tel })) as { config: Config; saida: string | null; conversa: Conversa | null; respostas_hoje?: number; lead_salao: LeadSalao | null; memoria?: Memoria | null }
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
      // 4.6 (migração 261): a resposta automática do WhatsApp Business não é resposta do salão nem voto. Fica guardada na
      // conversa do salão, marcada, e o resgate da cliente continua contando. A Mel não responde a ela.
      if (ehRespostaAutomatica(texto)) {
        try { await chamar(deps, 'guia_whats_salao_respondeu', { lead_: ctx.lead_salao.id, texto_: texto, quer_: false, auto_: true }) } catch { /* banco sem a 261: não marca nada */ }
        return { responder: null, acao: 'salao_automatica' }
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

  // 4.6: a resposta automática de um WhatsApp Business que caiu aqui como se fosse cliente (o salão respondendo de outro
  // número, uma loja que recebeu mensagem nossa). Sem conversa com salão, a Mel fica quieta: era ela que puxava a busca
  // por nome ("Seja bem-vinda ao Studio X") e o lembrete "quer que eu envie seu pedido?".
  if (!codigo && !conversaAberta?.lugar && ehRespostaAutomatica(texto)) return { responder: null, acao: 'resposta_automatica' }

  let conversa: Conversa | null = conversaAberta
  let lugar: Lugar | null = conversa?.lugar ?? null
  const novas: Array<{ q: string; t: string; em: string }> = [{ q: 'cliente', t: texto, em }]
  const guardar = async (resposta: string | null, estado: string, dados: Dados, lugarId: string | null) => {
    if (resposta) novas.push({ q: 'mel', t: resposta, em })
    const id = await chamar(deps, 'guia_whats_conversa_salvar', { id_: conversa?.id ?? null, tel_: tel, lugar_: lugarId, estado_: estado, dados_: dados, novas_: [...novas], teste_: teste })
    novas.length = 0 // 3.77.1: o que foi gravado não vai de novo (o "sim" da cliente aparecia duas vezes na conversa)
    if (!conversa) conversa = { id: Number(id), telefone: tel, lugar_id: lugarId, estado, dados, mensagens: [] }
  }
  const semOpcoes = (d: Dados): Dados => { const { opcoes: _o, ...resto } = d; return resto }
  const semCandidatos = (d: Dados): Dados => { const { candidatos: _c, ...resto } = d; return resto }
  const semBusca = (d: Dados): Dados => { const { busca: _b, ...resto } = d; return resto }
  // 4.7 (migração 262): o que a Mel lembra desta pessoa (o simulador não tem pedido de verdade, então não lembra)
  const mem: Memoria | null = teste ? null : (ctx.memoria ?? null)
  const pedidoRecente: LeadMemoria | null = mem?.lead?.id ? mem.lead : null
  // só um "obrigada" ou um "ok" de quem já foi atendida e não tem conversa aberta: não pede resposta
  if (!conversaAberta && !codigo && pedidoRecente && AGRADECE.test(p)) return { responder: null, acao: 'agradeceu' }

  // 4.6: "parar", "encerrar", "para de mandar mensagem": a Mel encerra, sai da lista dos lembretes e das ofertas
  // (guia_whats_saidas, quem = 'cliente') e só volta a falar quando a pessoa escrever de novo. Responde uma vez.
  if (pedidoDeParar(texto)) {
    if (!teste && ctx.saida !== 'salao') { try { await chamar(deps, 'guia_whats_sair', { tel_: tel, quem_: 'cliente', sair_: true }) } catch { /* segue */ } }
    if (ctx.saida === 'cliente' && !conversaAberta) return { responder: null, acao: 'parou_de_novo' }
    const dados: Dados = { ...semCandidatos(semOpcoes(conversa?.dados ?? {})), parou: true }
    await guardar(MSG_PAROU, 'encerrada', dados, conversa?.lugar_id ?? lugar?.id ?? null)
    return { responder: MSG_PAROU, acao: 'parou', estado: 'encerrada', dados }
  }
  // quem tinha pedido para parar e escreveu de novo volta a ser atendida normalmente
  if (!teste && ctx.saida === 'cliente') { try { await chamar(deps, 'guia_whats_sair', { tel_: tel, quem_: 'cliente', sair_: false }) } catch { /* segue */ } }

  // 3. de qual salão é a conversa: o código manda; sem código, a conversa aberta; sem nada, pelo nome (confirmado)
  if (codigo && (!lugar || lugar.cidade_slug !== codigo.cidade || lugar.slug !== codigo.slug)) {
    const l = (await chamar(deps, 'guia_whats_lugar', { cidade_: codigo.cidade, slug_: codigo.slug })) as Lugar | null
    if (l) { lugar = l; conversa = null }
  }

  // o pedido vai para o salão: o "sim" depois do resumo, ou (4.6) o número escolhido na oferta de outros salões, que já é
  // a licença ("quer que eu passe o seu pedido? é só responder o número"). extra: a frase que vai depois da confirmação.
  const enviarAoSalao = async (l: Lugar, dados: Dados, acaoOk = 'enviado', extra = ''): Promise<Saida> => {
    if (teste) {
      const pedidoTeste: Pedido = { id: 0, salao_nome: l.nome, cidade: l.cidade, cliente_nome: dados.nome, servico: dados.servico, preferencia: dados.preferencia, observacao: dados.observacao, cliente_tel: '5513999990000' }
      const previa = mensagemDoSalao(cfg, l, pedidoTeste)
      const resposta = confirmacao(cfg, l, dados, true) + extra
      await guardar(resposta, 'enviado', dados, l.id)
      return { responder: resposta, depois: await conviteInsta(deps, cfg, l, dados, tel, teste, 'sim'), conversaId: conversa?.id ?? null, acao: `${acaoOk}_teste`, previaSalao: previa, previaEnquete: cfg.enquete_ativa === false ? null : enqueteDoPedido(cfg, pedidoTeste), estado: 'enviado', dados }
    }
    await guardar(null, 'enviado', dados, l.id)
    const ld = (await chamar(deps, 'guia_whats_lead_criar', { conversa_: conversa!.id })) as (Pedido & { status: string; salao_tel: string | null; repetido: boolean })
    let ok = false
    let previa: string | null = null
    let statusFinal: string | undefined
    if (ld?.status === 'pendente' && ld.salao_tel) {
      // 3.57: o texto do pedido e, logo atrás, a enquete "vai atender?" (despacharPedido registra os dois)
      const d = await despacharPedido(deps, cfg, l, { ...ld, salao_tel: ld.salao_tel })
      ok = d.ok
      previa = d.texto
      statusFinal = d.status
      // 3.72: o número do salão não existe no WhatsApp (ou o envio falhou): a cliente segue normal e a equipe é
      // avisada no nosso número, como no caso sem número — o pedido não fica no vazio
      if (!ok && cfg.numero_avisos) {
        const motivo = d.status === 'sem_contato'
          ? `o número ${telefoneBonito(ld.salao_tel)} do cadastro não tem WhatsApp`
          : `o envio para ${telefoneBonito(ld.salao_tel)} falhou${d.erro ? ` (${String(d.erro).slice(0, 120)})` : ''}`
        try { await deps.enviar(cfg.instancia, so(cfg.numero_avisos), avisoEquipe(l, ld, motivo)) } catch { /* segue sem o aviso */ }
      }
    } else if (ld?.repetido) {
      ok = ld.status !== 'falhou'
    } else if (ld?.status === 'sem_contato' && cfg.numero_avisos) {
      // o salão não tem WhatsApp (ou o número é o da própria cliente): a cliente segue normal, mas avisamos a equipe no
      // nosso número, para não ficar um pedido no vazio e para dar para medir. O aviso é melhor-esforço (não trava a cliente).
      try { await deps.enviar(cfg.instancia, so(cfg.numero_avisos), avisoEquipe(l, ld)) } catch { /* segue sem o aviso */ }
    }
    // 3.77.1: o pedido não chegou ao salão (sem WhatsApp, o envio falhou, o salão pediu SAIR): em vez de "vou passar e
    // eles te chamam" (e o resgate só meia hora depois), a Mel já oferece os outros salões. Com o resgate desligado
    // (resgate_min = 0), ou num banco sem a 222, fica como era.
    const st = statusFinal ?? ld?.status ?? ''
    if (!ok && ld?.id && !ld.repetido && ['sem_contato', 'falhou', 'salao_saiu'].includes(st) && Number(cfg.resgate_min ?? 30) > 0) {
      try {
        const opcoesNovas = ((await chamar(deps, 'guia_whats_alternativas', { lead_: ld.id, n_: Math.max(1, Math.min(5, Number(cfg.resgate_opcoes) || 3)) })) as Opcao[] | null) ?? []
        const nome = dados.nome ? `, ${primeiroNome(dados.nome)}` : ''
        const texto = `Anotei seu pedido${nome}! 💗 Mas não consegui passar para o ${l.nome} pelo WhatsApp 😕\n\n${textoOpcoes(opcoesNovas, dados.servico)}`
        await chamar(deps, 'guia_whats_oferecer', { lead_: ld.id, texto_: texto, opcoes_: opcoesNovas, motivo_: st === 'falhou' ? 'falhou' : 'sem_contato' })
        return { responder: texto, acao: 'oferta_na_hora', previaSalao: previa, estado: 'conversando', dados: { ...dados, opcoes: opcoesNovas, salao_anterior: l.nome, oferta_motivo: st === 'falhou' ? 'falhou' : 'sem_contato' } }
      } catch { /* sem as funções da 222: a resposta de antes */ }
    }
    const resposta = confirmacao(cfg, l, dados, ok) + (ok ? extra : '')
    await guardar(resposta, 'enviado', dados, l.id)
    // 4.2: com o pedido no salão (ou anotado), o convite do Instagram vem logo atrás, numa mensagem só dele
    const depois = await conviteInsta(deps, cfg, l, dados, tel, teste, 'sim')
    return { responder: resposta, depois, conversaId: conversa?.id ?? null, acao: ok ? acaoOk : `pedido_${statusFinal ?? ld?.status ?? 'erro'}`, previaSalao: previa, estado: 'enviado', dados }
  }
  const completoPara = (d: Dados) => !!(d.nome && d.servico && (!cfg.exigir_preferencia || d.preferencia))

  // 4.7: "o salão respondeu?", "até agora nada", "quero outro salão": a Mel responde com a situação de verdade do último
  // pedido (48 h). Sem sinal do salão (ou com o "não", ou sem entrega), já oferece outros salões, como o resgate faria.
  const acompanhar = async (ld: LeadMemoria, querOutro: boolean): Promise<Saida> => {
    if (Number(ctx.respostas_hoje ?? 0) >= Math.max(1, Number(cfg.limite_respostas) || 30)) return { responder: null, acao: 'limite_respostas' }
    const sit = situacaoDoPedido(ld)
    const oferece = querOutro || sit.tipo === 'sem_sinal' || sit.tipo === 'nao' || sit.tipo === 'nao_chegou'
    const minhas = novas.map((m) => ({ ...m }))
    if (!oferece) {
      if (conversa) await guardar(sit.texto, conversa.estado, conversa.dados ?? {}, conversa.lugar_id)
      else {
        const id = await chamar(deps, 'guia_whats_conversa_anotar', { lead_: ld.id, novas_: [...minhas, { q: 'mel', t: sit.texto, em }] })
        if (!id) await guardar(sit.texto, 'conversando', {}, null)
      }
      return { responder: sit.texto, acao: 'situacao', estado: conversa?.estado }
    }
    let ops: Opcao[] = []
    try { ops = ((await chamar(deps, 'guia_whats_alternativas', { lead_: ld.id, n_: Math.max(1, Math.min(5, Number(cfg.resgate_opcoes) || 3)) })) as Opcao[] | null) ?? [] } catch { ops = [] }
    const motivo = sit.tipo === 'nao_chegou' ? 'sem_contato' : sit.tipo === 'nao' ? 'nao' : 'demora'
    const cabeca = querOutro && (sit.tipo === 'sim' || sit.tipo === 'viu' || sit.tipo === 'recente') ? 'Claro! 💗' : sit.texto
    const resposta = `${cabeca}\n\n${textoOpcoes(ops, ld.servico)}${motivo === 'demora' && ops.length ? `\n\nSe preferir esperar o ${ld.salao_nome}, é só me dizer 💗` : ''}`
    // a pergunta dela fica na conversa do pedido, que reabre com as opções (guia_whats_oferecer também marca o resgate)
    if (conversa) await guardar(null, conversa.estado, conversa.dados ?? {}, conversa.lugar_id)
    else if (ld.conversa_id) await chamar(deps, 'guia_whats_conversa_anotar', { lead_: ld.id, novas_: minhas })
    const reabriu = await chamar(deps, 'guia_whats_oferecer', { lead_: ld.id, texto_: resposta, opcoes_: ops, motivo_: motivo })
    const dados: Dados = { nome: ld.cliente_nome ?? undefined, servico: ld.servico ?? undefined, opcoes: ops, salao_anterior: ld.salao_nome, resgate_de: ld.id, oferta_motivo: motivo }
    if (!reabriu) { conversa = null; novas.length = 0; novas.push(...minhas); await guardar(resposta, 'conversando', dados, null) }
    return { responder: resposta, acao: 'situacao_oferta', estado: 'conversando', dados }
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
  // 3.77: a cliente respondendo à oferta de outros salões (o resgate ou o "não" do salão): o número (ou o nome) escolhe.
  // 4.6: com os dados completos, o número já envia (antes ela precisava dizer "sim" de novo, e algumas sumiam aí); mais de
  // um número vai para o primeiro, um por vez; "desisto" encerra.
  const oferecidas = (!lugar && !codigo ? (conversa?.dados?.opcoes ?? []) : []) as Opcao[]
  if (oferecidas.length && conversa) {
    // "desisto", "já marquei com o 2": vale antes do número (senão o 2 viraria um pedido novo)
    if (desistiu(p)) {
      const resposta = 'Tudo bem! 💗 Se precisar de um salão depois, é só me chamar aqui.'
      await guardar(resposta, 'encerrada', semOpcoes(conversa.dados ?? {}), null)
      return { responder: resposta, acao: 'desistiu', estado: 'encerrada' }
    }
    const varias = escolhasDe(texto, oferecidas)
    const escolha = varias[0] ?? escolhaDe(texto, oferecidas)
    if (!escolha && TODOS.test(p)) {
      const lista = oferecidas.map((o, i) => `${i + 1}) ${o.nome}${o.bairro ? ` · ${o.bairro}` : ''}`).join('\n')
      const resposta = `Eu passo o seu pedido para um salão por vez, assim quem aceitar não fica esperando à toa 💗 Qual você quer primeiro? Me responde o número:\n\n${lista}`
      await guardar(resposta, 'conversando', conversa.dados ?? {}, null)
      return { responder: resposta, acao: 'escolhendo', estado: 'conversando' }
    }
    const l = escolha ? ((await chamar(deps, 'guia_whats_lugar', { cidade_: null, slug_: null, id_: escolha.id })) as Lugar | null) : null
    if (l) {
      lugar = l
      conversa = { ...conversa, dados: semOpcoes(conversa.dados ?? {}), lugar: l, lugar_id: l.id }
      const dd: Dados = { ...conversa.dados, sem_avanco: 0 }
      if (!l.agendar && completoPara(dd)) {
        const extra = varias.length > 1 ? `\n\nPasso para um salão por vez: comecei pelo ${l.nome}. Se ele não responder, eu te mostro outras opções 💗` : ''
        return await enviarAoSalao(l, dd, 'escolheu', extra)
      }
      // salão com agenda pela MIMO: o passo 4 manda o link; faltando algo, a conversa segue e a Mel pede
    } else if (!escolha && (ESPERAR.test(p) || NAO_CURTO.test(semCortesia(p)))) {
      const anterior = conversa.dados?.salao_anterior || 'salão'
      // 3.77.1: esperar só faz sentido na demora; o salão que nem recebeu o pedido (ou que disse não) não vai chamar
      const motivo = conversa.dados?.oferta_motivo
      const nao = NAO_CURTO.test(semCortesia(p)) && !ESPERAR.test(p)
      const resposta = !motivo || motivo === 'demora'
        ? `Combinado! 💗 Vou deixar o seu pedido com o ${anterior}. Se mudar de ideia, é só me mandar o número de um dos salões.`
        : nao
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

  // 4.6: o salão achado pelo nome espera a confirmação da cliente: "sim" (com um só), o número ou o nome escolhe; "não"
  // pede o nome de novo; outra coisa vira busca nova
  const candidatos = (!lugar && !codigo ? (conversa?.dados?.candidatos ?? []) : []) as Opcao[]
  // 4.7: quando a mensagem só escolhe o salão ("2", "sim"), a IA recebe o que ela quis dizer ("Quero marcar no X", com o
  // serviço que ela já tinha dito), em vez do número solto. Na conversa fica guardado o que ela escreveu de verdade.
  let paraIa: string | null = null
  if (candidatos.length && conversa) {
    const certo = candidatos.length === 1 && (SIM_CURTO.test(semCortesia(p)) || E_ESSE.test(semCortesia(p)) || (!p && SIM_EMOJI.test(texto))) ? candidatos[0] : escolhaDe(texto, candidatos)
    const l = certo ? ((await chamar(deps, 'guia_whats_lugar', { cidade_: null, slug_: null, id_: certo.id })) as Lugar | null) : null
    if (l) {
      lugar = l
      const dito = String(conversa.dados?.busca?.servico ?? '').trim()
      paraIa = `Quero marcar no ${l.nome}.${dito ? ` O que eu disse antes: "${dito}"` : ''}`
      conversa = { ...conversa, dados: { ...semBusca(semCandidatos(conversa.dados ?? {})), sem_salao: 0 }, lugar: l, lugar_id: l.id }
    } else if (conversa.dados?.busca?.cidade_slug && MAIS.test(p) && !/\bnao quero\b/.test(p)) {
      // 4.7: a lista veio de uma indicação e ela quer ver outros: os próximos, sem repetir os já mostrados
      const b = conversa.dados.busca
      let ind: Indicacao | null = null
      try { ind = (await chamar(deps, 'guia_whats_indicar', { texto_: '', cidade_: b.cidade_slug, categoria_: b.categoria ?? null, servico_: b.servico ?? null, chave_: teste ? null : chaveDe(tel), fora_: b.vistos ?? [], n_: 3 })) as Indicacao | null } catch { ind = null }
      if (ind?.cidade && ind.opcoes?.length) {
        const cand = ind.opcoes.slice(0, 3)
        const dados: Dados = { ...conversa.dados, candidatos: cand, busca: { ...b, vistos: [...(b.vistos ?? []), ...cand.map((o) => o.id)].slice(-30) } }
        const resposta = textoIndicados({ ...ind, presumida: false }, false, true)
        await guardar(resposta, 'conversando', dados, null)
        return { responder: resposta, acao: 'indicou_mais', estado: 'conversando', dados }
      }
      const resposta = `Esses eram os que eu tinha${deCategoria(b.categoria)} em ${b.cidade} por enquanto 😕 Dá para ver todos no guia: https://${RAIZ_SITE}/saloes/${b.cidade_slug}\n\nSe gostar de algum, me manda o nome ou o link da página dele que eu sigo com o seu pedido.`
      await guardar(resposta, 'conversando', conversa.dados ?? {}, null)
      return { responder: resposta, acao: 'indicou_fim', estado: 'conversando' }
    } else if (NAO_CURTO.test(semCortesia(p)) || /\b(nenhum|nenhuma|nao e (esse|essa|nenhum|nenhuma|ele|ela)|outro salao)\b/.test(p)) {
      const resposta = conversa.dados?.busca?.cidade_slug
        ? 'Tudo bem! 💗 Se quiser ver outros salões, me diz *outros*. Se já tem um em mente, me manda o nome ou o link da página dele.'
        : 'Tudo bem! 💗 Me manda o nome do salão do jeito que aparece no guia, ou o link da página dele, que eu procuro de novo.'
      await guardar(resposta, 'conversando', semCandidatos(conversa.dados ?? {}), null)
      return { responder: resposta, acao: 'nao_era', estado: 'conversando' }
    }
  }

  // a própria dona (o número é o cadastrado do salão) segue para o passo 4.5, que já apresenta a MIMO Agenda com o link
  const ehDonaDe = (l: Lugar | null) => !!l && ((teste && !!opcoes.comoDona) || (!teste && !!l.salao_tel && !!chaveDe(tel) && chaveDe(tel) === chaveDe(l.salao_tel)))
  if (agendaLigada && (opcoes.sobreAgenda || sobreAgendaDe(texto)) && !ehDonaDe(lugar)) return await sobreAgenda(false)

  // 4.7: sem conversa aberta com salão, a pergunta sobre o pedido das últimas 48 h ("o salão respondeu?", "a Bianca
  // respondeu?") recebe a situação dele. Vem antes da busca por nome, que acharia uma lista de Biancas.
  if (!lugar && !codigo && !oferecidas.length && !candidatos.length && pedidoRecente && (perguntaDoPedido(texto) || querOutroSalao(texto))) {
    return await acompanhar(pedidoRecente, querOutroSalao(texto))
  }
  // emoji sozinho, sem salão e sem nada pendente: não pede resposta
  if (!lugar && !p && !oferecidas.length) return { responder: null, acao: 'so_emoji' }

  if (!lugar) {
    // 4.6: o nome achado não vira o salão na hora: a Mel pergunta "é o X (bairro, cidade)?" ou lista até 3, numerados.
    // Antes, uma palavra solta bastava ("como funciona" foi para o "Não funciona mais").
    const achados = p.length >= 4 ? (((await chamar(deps, 'guia_whats_buscar', { texto_: texto })) as Array<{ id: string; nome: string; cidade?: string | null; bairro?: string | null }> | null) ?? []) : []
    // a Mel perguntou "é o X?" (ou mostrou a lista) e a resposta não decidiu nem trouxe outro nome: pergunta de novo
    if (!achados.length && candidatos.length && conversa && !conversa.dados?.busca?.cidade_slug) {
      const resposta = candidatos.length === 1
        ? `É o *${candidatos[0].nome}*${ondeFica(candidatos[0]) ? ` (${ondeFica(candidatos[0])})` : ''}? Me responde *sim* ou *não* 💗`
        : `Me responde o número do salão (de 1 a ${candidatos.length}) 💗 Se não for nenhum deles, me manda o nome do jeito que aparece no guia.`
      await guardar(resposta, 'conversando', conversa.dados ?? {}, null)
      return { responder: resposta, acao: 'confirmar_salao', estado: 'conversando' }
    }
    if (achados.length) {
      const cand: Opcao[] = achados.slice(0, 3).map((a) => ({ id: a.id, nome: a.nome, bairro: a.bairro ?? null, cidade: a.cidade ?? null }))
      const dados: Dados = { ...semCandidatos(conversa?.dados ?? {}), candidatos: cand, sem_salao: 0 }
      const resposta = textoCandidatos(cand, !conversa)
      await guardar(resposta, 'conversando', dados, null)
      return { responder: resposta, acao: 'confirmar_salao', estado: 'conversando', dados }
    }
    // 3.76: quem já recebeu o link do comercial e segue sem salão: o lembrete curto, em vez de "de qual salão?"
    if (agendaLigada && Number(conversa?.dados?.comercial ?? 0) > 0) return await sobreAgenda(false)
    // 3.77: quem está escolhendo entre os salões oferecidos e escreveu outra coisa: como responder
    if (oferecidas.length) {
      // 3.77.1: "pode enviar", "qualquer um", "para outros": a Mel pede o número com a lista de novo (decisão da equipe:
      // não manda para todos de uma vez); o "vou esperar" só é lembrado quando o salão só está demorando
      const motivo = conversa?.dados?.oferta_motivo
      const lista = oferecidas.map((o, i) => `${i + 1}) ${o.nome}${o.bairro ? ` · ${o.bairro}` : ''}`).join('\n')
      const resposta = CONSENTE.test(p)
        ? `Claro! 💗 Para qual deles? Me responde o número:\n\n${lista}`
        : `É só me responder o número do salão (de 1 a ${oferecidas.length}) que eu passo o seu pedido 💗${!motivo || motivo === 'demora' ? ` Se preferir esperar o ${conversa?.dados?.salao_anterior || 'salão'}, me diz "vou esperar". Se não quiser mais, me diz "desisto".` : ' Se não quiser mais, me diz "desisto".'}`
      await guardar(resposta, 'conversando', conversa?.dados ?? {}, null)
      return { responder: resposta, acao: 'escolhendo', estado: 'conversando' }
    }
    // 4.6: sem salão, a Mel pede duas vezes (a segunda com o caminho mais fácil: o botão WhatsApp na página do salão) e
    // depois fica quieta até chegar um nome ou link que ela ache. Antes, a mesma frase voltava a cada mensagem, inclusive
    // para "parar" e "encerrar".
    // 4.7 (migração 262): em vez de só pedir o salão, a Mel indica. Do que a cliente disse saem a cidade e o serviço
    // (guia_whats_indicar); com os dois, até 3 salões numerados; faltando um, a Mel pergunta. O que ela já disse fica
    // guardado (busca): "Sou de Santos" e depois "unha" dão unhas em Santos; "na verdade cabelo" troca o serviço.
    const busca = conversa?.dados?.busca ?? {}
    const vezes = Number(conversa?.dados?.sem_salao ?? 0)
    let ind: Indicacao | null = null
    try {
      ind = (await chamar(deps, 'guia_whats_indicar', { texto_: texto, cidade_: busca.cidade_slug ?? null, categoria_: busca.categoria ?? null, servico_: busca.servico ?? null,
        chave_: teste ? null : chaveDe(tel), fora_: busca.vistos ?? [], n_: 3 })) as Indicacao | null
    } catch { ind = null /* banco sem a 262: a Mel só pede o salão, como na 4.6 */ }
    const base: Dados = semCandidatos(conversa?.dados ?? {})
    // o que a mensagem trouxe de novo: a cidade, o serviço (ou outro serviço), o bairro
    const outraCidade = !!ind?.cidade && ind.cidade.slug !== busca.cidade_slug
    const outroServico = !!ind?.tem_servico && (!busca.tem_servico || (!!ind.servico_agora && (ind.categoria ?? null) !== (busca.categoria ?? null)))
    const outroBairro = !!ind?.bairro && ind.bairro !== (busca.bairro ?? null)
    const andou = outraCidade || outroServico || outroBairro
    const novaBusca = (vistos: string[]): Dados['busca'] => ({
      cidade: ind?.cidade?.nome ?? busca.cidade, cidade_slug: ind?.cidade?.slug ?? busca.cidade_slug, categoria: ind?.categoria ?? busca.categoria ?? null,
      servico: outroServico || (ind?.servico_agora && !busca.servico) ? texto.slice(0, 200) : busca.servico, tem_servico: !!ind?.tem_servico || !!busca.tem_servico,
      bairro: ind?.bairro ?? (outraCidade ? null : busca.bairro ?? null), vistos,
    })
    if (ind?.cidade && ind.opcoes?.length && (andou || !candidatos.length)) {
      const cand = ind.opcoes.slice(0, 3)
      const dados: Dados = { ...base, candidatos: cand, sem_salao: 0, busca: novaBusca([...(busca.vistos ?? []), ...cand.map((o) => o.id)].slice(-30)) }
      const resposta = textoIndicados(ind, !conversa)
      await guardar(resposta, 'conversando', dados, null)
      return { responder: resposta, acao: 'indicou', estado: 'conversando', dados }
    }
    // já há uma lista indicada e a mensagem não escolheu nem trouxe novidade: a Mel pede o número de novo
    if (candidatos.length && conversa) {
      const resposta = candidatos.length === 1
        ? `Quer marcar no *${candidatos[0].nome}*? Me responde *sim* 💗 Se quiser ver outros, me diz *outros*.`
        : `Me responde o número do salão (de 1 a ${candidatos.length}) 💗 Se quiser ver outros, me diz *outros*.`
      await guardar(resposta, 'conversando', conversa.dados ?? {}, null)
      return { responder: resposta, acao: 'confirmar_salao', estado: 'conversando' }
    }
    // a cidade ou o serviço que ela acabou de dizer zera a conta: a Mel pergunta o que falta. Sem novidade, pergunta duas
    // vezes (a segunda de outro jeito) e depois fica quieta, até chegar algo que ela entenda (4.6).
    const n = andou ? 0 : vezes
    const dados: Dados = { ...base, sem_salao: n + 1, ...(ind ? { busca: novaBusca(busca.vistos ?? []) } : {}) }
    if (n >= 2) {
      await guardar(null, 'conversando', dados, null)
      return { responder: null, acao: 'sem_salao_quieta', estado: 'conversando', dados }
    }
    const resposta = ind?.cidade && ind.tem_servico ? semIndicacao(ind, !conversa)
      : ind?.cidade ? perguntaServico(ind, !conversa, n > 0)
      : ind?.tem_servico ? perguntaCidade(ind, !conversa, n > 0)
      : n === 0 ? MSG_SEM_SALAO : MSG_SEM_SALAO_DICA
    const acao = ind?.cidade && ind.tem_servico ? 'sem_indicacao' : ind?.cidade ? 'pede_servico' : ind?.tem_servico ? 'pede_cidade' : 'sem_salao'
    await guardar(resposta, 'conversando', dados, null)
    return { responder: resposta, acao, estado: 'conversando', dados }
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
  const dadosAntes: Dados = { ...semBusca(conversa?.dados ?? {}) }
  // 4.7: o nome de quem já fez pedido por este número (60 dias) não é pedido de novo; ele aparece no resumo, e ela corrige
  if (!dadosAntes.nome && mem?.nome) dadosAntes.nome = limpo(mem.nome, 120)
  // 4.8: o nome do perfil do WhatsApp, quando parece nome de gente, entra sem pergunta
  if (!dadosAntes.nome) { const doPerfil = nomeDoPerfil(e.nomePerfil); if (doPerfil) dadosAntes.nome = doPerfil }
  // 4.7: com o pedido já no salão, "o salão respondeu?" e "quero outro" recebem a situação de verdade (e a oferta de
  // outros salões quando não há sinal). Vem antes do teto das dúvidas: era aí que a Mel respondia "não consigo saber".
  const doPedido = estadoAntes === 'enviado' && pedidoRecente && pedidoRecente.lugar_id === lugar.id ? pedidoRecente : null
  if (doPedido && (perguntaDoPedido(texto) || querOutroSalao(texto))) return await acompanhar(doPedido, querOutroSalao(texto))
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
  // 4.8: quem chega pelo botão do site com a mensagem pronta (sem mais nada) recebe a abertura curta, sem IA: uma frase
  // de apresentação e a pergunta do serviço. Quem escreveu algo a mais na mensagem vai para a IA, que aproveita o que veio.
  if (!conversa && codigo && palavra(texto) === palavra(mensagemDaCliente(cfg.msg_cliente, lugar.nome, codigo.cidade, codigo.slug))) {
    const resposta = aberturaCurta(lugar, dadosAntes.nome ?? '')
    const dados: Dados = { ...dadosAntes, sem_avanco: 0 }
    await guardar(resposta, 'conversando', dados, lugar.id)
    return { responder: resposta, acao: 'abertura', estado: 'conversando', dados }
  }
  // 4.6: "sim, obrigada" e "não, obrigada" também decidem (a gentileza no fim não muda a resposta)
  const curto = estadoAntes === 'confirmando' ? (SIM_CURTO.test(semCortesia(p)) || (!p && SIM_EMOJI.test(texto)) ? 'sim' : NAO_CURTO.test(semCortesia(p)) ? 'nao' : null) : null
  // 4.6: sem letra nenhuma: o "?" é um "e aí?" e vai para a IA com a conversa; emoji sozinho ("😉", "🙏") não pede
  // resposta (antes recebia "Só consigo ler texto por aqui")
  if (!p && !curto && !/\?/.test(texto)) {
    await guardar(null, estadoAntes, dadosAntes, lugar.id)
    return { responder: null, acao: 'so_emoji', estado: estadoAntes }
  }
  let r: Awaited<ReturnType<typeof deps.ia>>
  if (curto) {
    r = { leitura: { resposta: '', nome: '', servico: '', preferencia: '', observacao: '', cliente_confirmou_envio: curto === 'sim', cancelar: curto === 'nao', quer_apagar_dados: false, sobre_agenda: false, dona_do_salao: false } }
  } else {
    const historico: Mensagem[] = (conversa?.mensagens ?? []).slice(-12).map((m) => ({ role: m.q === 'cliente' ? 'user' as const : 'assistant' as const, content: String(m.t ?? '').slice(0, 500) }))
    historico.push({ role: 'user', content: paraIa ?? texto })
    r = await deps.ia({ provedor: cfg.provedor, modelo: cfg.modelo || MODELO_PADRAO[cfg.provedor] || MODELO_PADRAO.groq, sistema: sistema(cfg, lugar, dadosAntes, estadoAntes, e.nomePerfil, agora, doPedido ? situacaoDoPedido(doPedido).curta : null), mensagens: historico })
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
    return { responder: resposta, depois: await conviteInsta(deps, cfg, lugar, dados, tel, teste, 'nao'), conversaId: conversa?.id ?? null, acao: 'cancelou', estado: 'encerrada', dados }
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
      return { responder: resposta, depois: await conviteInsta(deps, cfg, lugar, dados, tel, teste, 'nao'), conversaId: conversa?.id ?? null, acao: 'sem_avanco', estado: 'encerrada', dados }
    }
  } else {
    dados.sem_avanco = 0
  }

  // o "sim" depois do resumo: o pedido vai para o salão
  if (estadoAntes === 'confirmando' && lido.cliente_confirmou_envio && completo && !mudou) return await enviarAoSalao(lugar, dados)

  // tudo anotado (ou mudou algo depois do resumo): o resumo e o pedido de licença, com as nossas palavras
  if (completo && estadoAntes !== 'enviado' && (estadoAntes === 'conversando' || mudou)) {
    const resposta = resumo(dados, lugar.nome)
    await guardar(resposta, 'confirmando', dados, lugar.id)
    return { responder: resposta, acao: 'resumo', estado: 'confirmando', dados }
  }

  let resposta = limpo(lido.resposta, 1500) || 'Me conta mais um pouquinho?'
  const estado = estadoAntes === 'enviado' ? 'enviado' : completo ? estadoAntes : 'conversando'
  // 4.8 (migração 263): o dia, o horário ou o detalhe dito DEPOIS do envio vai para o salão como complemento do pedido
  // (até 2 por pedido). A frase "já avisei o salão" só entra quando o aviso saiu de verdade.
  let acao = 'conversa'
  if (estadoAntes === 'enviado' && mudou && !teste && conversa) {
    const novo = Object.fromEntries((['servico', 'preferencia', 'observacao'] as const).filter((k) => dados[k] && dados[k] !== dadosAntes[k]).map((k) => [k, dados[k] as string]))
    if (Object.keys(novo).length) {
      try {
        const c = (await chamar(deps, 'guia_whats_lead_complemento', { conversa_: conversa.id, servico_: novo.servico ?? null, preferencia_: novo.preferencia ?? null, observacao_: novo.observacao ?? null })) as (Pedido & { salao_tel: string }) | null
        if (c?.salao_tel) {
          const env = await deps.enviar(cfg.instancia, c.salao_tel, complementoDoSalao(c, novo))
          if (env.ok) { resposta = `${resposta}\n\nJá avisei o ${lugar.nome} 💗`; acao = 'complemento' }
        }
      } catch { /* banco sem a 263: a conversa segue como antes */ }
    }
  }
  await guardar(resposta, estado, dados, lugar.id)
  return { responder: resposta, acao, estado, dados }
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
  // 4.6 (migração 261): a cliente que pediu para parar não recebe aviso do voto nem oferta de outros salões
  let clienteSaiu = false
  try { clienteSaiu = (await chamar(deps, 'guia_whats_cliente_saiu', { tel_: p.cliente_tel })) === true } catch { clienteSaiu = false }
  if (voto === 'nao') {
    // 3.77: o "não" já sugere os salões (os mesmos critérios do resgate)
    let opcoes: Opcao[] = []
    if (cfg.avisar_cliente_nao !== false && !clienteSaiu) {
      try { opcoes = ((await chamar(deps, 'guia_whats_alternativas', { lead_: p.id, n_: Math.max(1, Math.min(5, Number(cfg.resgate_opcoes) || 3)) })) as Opcao[] | null) ?? [] } catch { opcoes = [] }
    }
    const r = respostasDoVoto(cfg, p, voto, opcoes)
    if (r.aviso && cfg.numero_avisos) {
      try { await deps.enviar(cfg.instancia, so(cfg.numero_avisos), r.aviso) } catch { /* melhor-esforço */ }
    }
    if (r.cliente && !clienteSaiu) {
      try {
        try { await chamar(deps, 'guia_whats_oferecer', { lead_: p.id, texto_: r.cliente, opcoes_: opcoes, motivo_: 'nao' }) }
        catch { await chamar(deps, 'guia_whats_conversa_reabrir', { lead_: p.id, texto_: r.cliente }) } // num banco sem a 222
        await deps.enviar(cfg.instancia, p.cliente_tel, r.cliente)
      } catch (e) { return { responder: r.salao, acao: 'salao_nao_atende', erro: `aviso à cliente: ${String((e as Error)?.message ?? e).slice(0, 200)}` } }
    }
    return { responder: r.salao, acao: 'salao_nao_atende', previaCliente: clienteSaiu ? null : r.cliente, previaAviso: r.aviso }
  }
  const r = respostasDoVoto(cfg, p, voto)
  // 3.77: a Mel já tinha oferecido outros salões e a cliente ainda não escolheu: ela fica sabendo, e a conversa volta
  if (p.resgate_em && !clienteSaiu) {
    const aviso = `Boa notícia${p.cliente_nome ? `, ${primeiroNome(p.cliente_nome)}` : ''}! 💗 O ${p.salao_nome} respondeu e vai te chamar aqui no WhatsApp para combinar o horário.`
    try {
      const voltou = await chamar(deps, 'guia_whats_conversa_voltou', { lead_: p.id, texto_: aviso })
      if (voltou) await deps.enviar(cfg.instancia, p.cliente_tel, aviso)
    } catch { /* melhor-esforço: o salão recebe a resposta de qualquer jeito */ }
  } else if (!clienteSaiu && cfg.avisar_cliente_sim !== false) {
    // 4.7 (migração 262): a cliente fica sabendo do "sim" na hora (antes, só quando a Mel já tinha oferecido outros
    // salões). O aviso fica guardado na conversa dela, que volta a aceitar dúvidas.
    const aviso = avisoDoSim(cfg, p)
    try {
      const env = await deps.enviar(cfg.instancia, p.cliente_tel, aviso)
      if (env.ok) { try { await chamar(deps, 'guia_whats_conversa_anotar', { lead_: p.id, novas_: [{ q: 'mel', t: aviso, em: (deps.agora?.() ?? new Date()).toISOString() }] }) } catch { /* banco sem a 262 */ } }
    } catch { /* melhor-esforço */ }
    return { responder: r.salao, acao: 'salao_vai_atender', previaCliente: aviso }
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
  return { responder: r.salao, acao: voto === 'sim' ? 'salao_vai_atender' : 'salao_nao_atende', previaCliente: voto === 'sim' && cfg.avisar_cliente_sim !== false ? avisoDoSim(cfg, p) : r.cliente, previaAviso: r.aviso, previaEnquete: enqueteDoPedido(cfg, p) }
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

// 4.2 (migração 252): o convite do Instagram no fim da conversa. O banco decide se este número pode receber agora
// (insta_ligado, o @ da MIMO configurado, insta_dias desde a última vez; 0 = toda conversa) e anota; o simulador vê sempre
// e não anota. Melhor-esforço: num banco sem a 252, ou num erro, a conversa segue sem o convite.
export const INSTA_SIM_PADRAO = 'Enquanto o {salao} te responde, posso te pedir uma ajudinha? 🙏\nA MIMO é um projeto pequeno e o nosso Instagram acabou de nascer. Seguindo, você ajuda o guia a crescer e ainda vê primeiro os salões mais bem avaliados de {cidade}. Leva 2 segundos 💗\n👉 {link}'
export const INSTA_NAO_PADRAO = 'Posso te pedir uma ajudinha antes de ir? 🙏\nA MIMO é um projeto pequeno e o nosso Instagram acabou de nascer. Seguindo, você ajuda o guia a crescer e ainda vê primeiro os salões mais bem avaliados de {cidade}. Leva 2 segundos 💗\n👉 {link}'
export function textoInsta(modelo: string | null | undefined, l: Pick<Lugar, 'nome' | 'cidade'>, d: Pick<Dados, 'nome'>, link: string): string {
  const base = String(modelo ?? '').trim()
  const t = base
    .replaceAll('{salao}', l.nome || 'salão')
    .replaceAll('{cidade}', l.cidade || 'sua cidade')
    .replaceAll('{nome}', primeiroNome(d.nome) || '')
    .replaceAll('{link}', link)
    .replace(/[ \t]+([,!?.])/g, '$1')
  return (base.includes('{link}') ? t : `${t}\n👉 ${link}`).slice(0, 1600)
}
export const linkInsta = (ponta: 'sim' | 'nao') => `https://${RAIZ_SITE}/instagram?de=whats_${ponta}`
async function conviteInsta(deps: Deps, cfg: Config, l: Lugar, d: Dados, tel: string, teste: boolean, ponta: 'sim' | 'nao'): Promise<string | null> {
  if (cfg.insta_ligado === false) return null
  try {
    const pode = (await chamar(deps, 'guia_whats_insta_convidar', { tel_: tel, teste_: teste })) as string | null
    if (!pode) return null
    // 4.2.1: o link passa pela MIMO (mimo.com.vc/instagram): conta o toque, com a prévia própria, e abre o perfil
    return textoInsta(ponta === 'sim' ? (cfg.msg_insta_sim || INSTA_SIM_PADRAO) : (cfg.msg_insta_nao || INSTA_NAO_PADRAO), l, d, linkInsta(ponta))
  } catch {
    return null
  }
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
