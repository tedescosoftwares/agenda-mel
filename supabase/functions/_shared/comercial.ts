// A assistente comercial da MIMO pelo WhatsApp (3.74, migração 218).
//
// Um número só para quem quer conhecer a MIMO Agenda (a dona de salão, a profissional autônoma): outra instância na mesma
// Evolution, outra persona, outra configuração (comercial_config, a aba Comercial da Plataforma). A Mel (guia_whats.ts)
// fica só com as clientes. Aqui a conversa é livre, com a IA (Groq ou Claude, em JSON: ia_json.ts), guiada pela
// orientação, pelo texto "o que a MIMO faz", pelos planos (lidos do banco), pelas perguntas frequentes e pelas objeções.
//
// O que é determinístico (não passa pela IA): a apresentação na primeira mensagem; o texto de suporte para quem já é
// cliente (o número bate com um salão ou perfil da MIMO); a busca do salão dela no guia (comercial_buscar_salao) e as
// mensagens "achei no guia" / "não achei" / "cidade fora", e o pedido das fotos (comercial_fotos → o "sou a dona" da 159)
// quando ela manda o e-mail; o texto da equipe (horário e contato) com o aviso à equipe quando ela quer começar ou pede
// uma pessoa; o silêncio quando alguém da equipe entrou (humano_ate) ou a conversa está pausada; o teto de respostas por
// dia; "apagar meus dados". A IA entra para conversar e para LER o que ela disse (nome, cidade, salão, e-mail, interesse,
// quer começar, quer uma pessoa, é cliente, é cliente final, sem interesse, quer fotos).
//
// Como a Mel, este arquivo não fala com a rede nem com o banco por conta própria: tudo vem em `Deps`.

import { so, palavra, telefoneBonito, MODELO_PADRAO } from './guia_whats.ts'
import { iaJsonDe, type Ambiente, type Fetch, type Mensagem } from './ia_json.ts'

export type Resultado = { ok: true; providerId: string | null } | { ok: false; erro: string }
export type Leitura = {
  resposta: string; nome: string; cidade: string; salao: string; email: string; autonoma: string; interesse: string
  quer_comecar: boolean; quer_humano: boolean; eh_cliente: boolean; cliente_final: boolean; sem_interesse: boolean; quer_fotos: boolean
}
export type PedidoIa = { provedor: string; modelo: string; sistema: string; mensagens: Mensagem[] }
export type Deps = {
  rpc: (nome: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>
  ia: (p: PedidoIa) => Promise<{ leitura: Leitura | null; erro?: string; modelo?: string }>
  enviar: (instancia: string, telefone: string, texto: string) => Promise<Resultado>
  agora?: () => Date
}
export type Plano = { plano: string; nome: string; base_cents: number; inclusas: number; extra_cents: number; ate: number | null }
export type Config = {
  ligado: boolean; nome: string; numero: string | null; instancia: string; numero_avisos: string | null
  provedor: string; modelo: string | null; vendas_ligadas: boolean
  orientacao: string; conhecimento: string; faq: string; objecoes: string
  msg_apresentacao: string; msg_vendas_desligadas: string; suporte_numero: string | null; msg_suporte: string
  encaminhar_numero: string | null; msg_equipe: string; msg_cliente_final: string
  msg_achei_no_guia: string; msg_salao_na_mimo: string; msg_nao_achei: string; msg_cidade_fora: string; msg_fotos_enviado: string
  equipe_dias: string; equipe_inicio: string; equipe_fim: string; silencio_min: number
  cadencia_dias: number[]; msg_cadencia_1: string; msg_cadencia_2: string; msg_cadencia_3: string
  pausa_seg: number; bolhas: boolean; limite_respostas: number; retencao_dias: number
}
// os números da página dela no guia (220): visitas e toques de contato em 30 dias, pedidos pela Mel em 30 dias, "quero na MIMO" no app
export type Numeros = { visitas: number; contatos: number; pedidos: number; quero: number }
export type Guia = { lugar_id: string; nome: string; link: string; na_mimo: boolean; fotos_n: number; bairro?: string | null; numeros?: Numeros | null }
export type Dados = {
  nome?: string; cidade?: string; cidade_slug?: string; cidade_coberta?: boolean; salao?: string; autonoma?: boolean | null; email?: string
  interesse?: string; guia?: Guia | null; guia_informado?: boolean; incluir_guia?: boolean; fotos_pedidas?: boolean
  suporte_informado?: boolean; cliente_final?: boolean; apresentada?: boolean; equipe_avisada_em?: string
  ja_cliente?: { salao: string } | null // 3.74.1: achada pelo nome do salão e pela cidade (escreveu de outro número)
}
export type Entrada = { telefone: string; texto: string; nomePerfil?: string | null }
export type Saida = {
  responder: string | null; bolhas?: string[]; pausa?: number; acao: string; situacao?: string; dados?: Dados
  previaAviso?: string | null; erro?: string; origem?: string
}
type Conversa = {
  id: number; telefone: string; origem: string; situacao: string; dados: Dados
  mensagens: Array<{ q: string; t: string; em?: string }>; humano_ate: string | null; pausada: boolean
}
type Contexto = { config: Config | null; planos: Plano[] | null; cliente: { salao: string; cidade?: string | null } | null; conversa: Conversa | null; respostas_hoje: number }

export const FRASE_BOTAO = 'Oi! Quero conhecer a MIMO Agenda.'
const APAGAR = /\b(apag|exclu|delet|remov)[a-z]*\b.*\b(dados|conversa|numero|informac)/
// o que a Mel manda no link para a dona e para o salão que respondeu QUERO: "… para o {salão} ({cidade})."
const VINDO_DA_MEL = /para o (.+?)(?: \(([^()]+)\))?\.?\s*$/i
export const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

export const reais = (cents: number) => `R$ ${(Math.max(0, Number(cents) || 0) / 100).toFixed(2).replace('.', ',')}`
// preenche {chave} e some com o que ficou vazio (a frase inteira do {encaminhar}, por exemplo)
export function preencherTexto(modelo: string, valores: Record<string, string | null | undefined>): string {
  return String(modelo ?? '').replace(/\{([a-z_]+)\}/g, (inteiro, k: string) => (k in valores ? String(valores[k] ?? '') : inteiro)).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
// os números da página dela no guia, numa frase a favor da venda (vazia quando não há o que dizer); {numeros} nos textos
const juntar = (p: string[]) => (p.length <= 1 ? p.join('') : `${p.slice(0, -1).join(', ')} e ${p[p.length - 1]}`)
export function numerosTexto(n?: Numeros | null): string {
  if (!n) return ''
  const v = Number(n.visitas) || 0, c = Number(n.contatos) || 0, p = Number(n.pedidos) || 0, q = Number(n.quero) || 0
  const partes: string[] = []
  if (v) partes.push(`${v} ${v === 1 ? 'visita' : 'visitas'} na sua página`)
  if (c) partes.push(`${c} ${c === 1 ? 'pessoa tocou' : 'pessoas tocaram'} para falar com você`)
  if (p) partes.push(`${p} ${p === 1 ? 'pediu' : 'pediram'} horário pela Mel, a nossa assistente do guia`)
  const frase = partes.length ? `Nos últimos 30 dias: ${juntar(partes)}.` : ''
  const quero = q ? `${q === 1 ? '1 cliente já pediu' : `${q} clientes já pediram`} o seu salão no app da MIMO.` : ''
  return [frase, quero].filter(Boolean).join(' ')
}
// a mesma coisa, curta, para o aviso à equipe
export function numerosCurto(n?: Numeros | null): string {
  if (!n) return ''
  const p = [[n.visitas, 'visitas'], [n.contatos, 'contatos'], [n.pedidos, 'pedidos pela Mel']].filter(([x]) => Number(x) > 0).map(([x, r]) => `${x} ${r}`)
  const q = Number(n.quero) || 0
  return [p.length ? `${p.join(', ')} em 30 dias` : '', q ? `${q} "quero na MIMO" no app` : ''].filter(Boolean).join(' · ')
}
export function dividir(texto: string, cfg: Pick<Config, 'bolhas'>): string[] {
  const t = String(texto ?? '').trim()
  if (!t) return []
  if (cfg.bolhas === false) return [t]
  return t.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean).slice(0, 8)
}
const hhmm = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '')); return m ? `${Number(m[1])}h${m[2] === '00' ? '' : m[2]}` : String(t ?? '') }
export function horarioTexto(cfg: Pick<Config, 'equipe_dias' | 'equipe_inicio' | 'equipe_fim'>): string {
  const dias = cfg.equipe_dias === 'todos' ? 'todos os dias' : cfg.equipe_dias === 'seg-sab' ? 'de segunda a sábado' : 'de segunda a sexta'
  return `${dias}, das ${hhmm(cfg.equipe_inicio)} às ${hhmm(cfg.equipe_fim)}`
}
// dentro do horário da equipe, no fuso de Brasília
export function dentroDoHorario(cfg: Pick<Config, 'equipe_dias' | 'equipe_inicio' | 'equipe_fim'>, agora: Date): boolean {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(agora)
  const pega = (t: string) => partes.find((p) => p.type === t)?.value ?? ''
  const dia = pega('weekday'), min = (Number(pega('hour')) % 24) * 60 + Number(pega('minute'))
  const [hi, mi] = String(cfg.equipe_inicio ?? '09:00').split(':').map(Number), [hf, mf] = String(cfg.equipe_fim ?? '18:00').split(':').map(Number)
  const diaOk = cfg.equipe_dias === 'todos' ? true : cfg.equipe_dias === 'seg-sab' ? dia !== 'Sun' : !['Sat', 'Sun'].includes(dia)
  return diaOk && min >= hi * 60 + (mi || 0) && min < hf * 60 + (mf || 0)
}
export function planosTexto(planos: Plano[] | null | undefined): string {
  if (!planos?.length) return ''
  return planos.map((p) => {
    if (p.plano === 'autonoma' || !p.base_cents) return `${p.nome}: grátis (uma agenda, para quem atende sozinha).`
    const extra = p.extra_cents ? `, mais ${reais(p.extra_cents)} por agenda ${p.ate ? `da ${p.inclusas + 1}ª à ${p.ate}ª` : `da ${p.inclusas + 1}ª em diante`}` : ''
    return `${p.nome}: ${reais(p.base_cents)} por mês até ${p.inclusas} agendas${extra}.`
  }).join('\n')
}
export const linkWhats = (numero: string | null | undefined, texto?: string) => {
  const d = so(numero)
  return d ? `https://wa.me/${d}${texto ? `?text=${encodeURIComponent(texto)}` : ''}` : ''
}

// ---- a IA ------------------------------------------------------------------------------------------------------------
export const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    resposta: { type: 'string' }, nome: { type: 'string' }, cidade: { type: 'string' }, salao: { type: 'string' }, email: { type: 'string' },
    autonoma: { type: 'string', enum: ['', 'sim', 'nao'] }, interesse: { type: 'string', enum: ['', 'baixo', 'medio', 'alto'] },
    quer_comecar: { type: 'boolean' }, quer_humano: { type: 'boolean' }, eh_cliente: { type: 'boolean' }, cliente_final: { type: 'boolean' },
    sem_interesse: { type: 'boolean' }, quer_fotos: { type: 'boolean' },
  },
  required: ['resposta', 'nome', 'cidade', 'salao', 'email', 'autonoma', 'interesse', 'quer_comecar', 'quer_humano', 'eh_cliente', 'cliente_final', 'sem_interesse', 'quer_fotos'],
}
const CAMPOS = 'Responda só com um objeto JSON com exatamente estes campos: "resposta" (a sua mensagem para ela), "nome", "cidade", "salao", "email" (strings: o que ela informou NESTA conversa; vazio se não souber; não invente), "autonoma" ("sim", "nao" ou vazio), "interesse" ("baixo", "medio", "alto" ou vazio), e os booleanos "quer_comecar", "quer_humano", "eh_cliente", "cliente_final", "sem_interesse", "quer_fotos".'
export function montarLeitura(lido: Record<string, unknown>): Leitura | null {
  if (typeof lido?.resposta !== 'string') return null
  const s = (k: string) => String(lido[k] ?? '').trim()
  const b = (k: string) => lido[k] === true
  return {
    resposta: lido.resposta, nome: s('nome'), cidade: s('cidade'), salao: s('salao'), email: s('email'), autonoma: s('autonoma'), interesse: s('interesse'),
    quer_comecar: b('quer_comecar'), quer_humano: b('quer_humano'), eh_cliente: b('eh_cliente'), cliente_final: b('cliente_final'), sem_interesse: b('sem_interesse'), quer_fotos: b('quer_fotos'),
  }
}
export function iaComercialDe(env: Ambiente, fetcher: Fetch): Deps['ia'] {
  return iaJsonDe<Leitura>(env, fetcher, { esquema: ESQUEMA, campos: CAMPOS, montar: montarLeitura, maxTokens: { claude: 1500, groq: 2500 } })
}

// o sistema: a persona, o produto, os planos (ou o modo de vendas desligadas), a FAQ, as objeções, o que já sabemos dela,
// o salão dela no guia, a equipe e as regras de leitura
export function sistema(cfg: Config, planos: Plano[] | null, d: Dados, extra: { cliente?: { salao: string } | null; agora: Date; nomePerfil?: string | null; apresentouAgora?: boolean }): string {
  const nome = cfg.nome || 'Lia'
  const linhas: Array<string | null> = [
    preencherTexto(cfg.orientacao, { nome }),
    '',
    'O QUE A MIMO FAZ',
    cfg.conhecimento,
    '',
  ]
  if (cfg.vendas_ligadas) {
    linhas.push('PLANOS E PREÇOS (fale só estes valores, por mês; nada de desconto)', planosTexto(planos) || 'Os planos estão na página mimo.com.vc/planos.', '')
  } else {
    linhas.push('VENDAS DESLIGADAS', `Não fale de planos nem de preços, nem prometa data de abertura. Se perguntarem de preço, prazo ou como começar, responda com a ideia deste texto: «${cfg.msg_vendas_desligadas}». Anote o interesse (nome, cidade, salão) e agradeça.`, '')
  }
  if (cfg.faq?.trim()) linhas.push('PERGUNTAS FREQUENTES (pergunta e resposta, uma por linha)', cfg.faq.trim(), '')
  if (cfg.objecoes?.trim()) linhas.push('OBJEÇÕES COMUNS (a objeção e como responder, uma por linha)', cfg.objecoes.trim(), '')
  const sabe = [
    d.nome ? `nome: ${d.nome}` : null, d.cidade ? `cidade: ${d.cidade}` : null, d.salao ? `salão: ${d.salao}` : null,
    d.autonoma === true ? 'atende sozinha (autônoma)' : d.autonoma === false ? 'tem salão com equipe' : null,
    d.email ? `e-mail: ${d.email}` : null, d.interesse ? `interesse até agora: ${d.interesse}` : null,
    extra.nomePerfil ? `o nome no perfil do WhatsApp dela é "${extra.nomePerfil}" (use só se ela confirmar ou se não disser outro)` : null,
  ].filter(Boolean)
  linhas.push('O QUE VOCÊ JÁ SABE DESTA PESSOA', sabe.length ? sabe.map((s) => `- ${s}`).join('\n') : '- nada ainda: pergunte o nome, a cidade e o salão (uma coisa por vez, começando pelo nome).', '')
  const cliente = extra.cliente ?? d.ja_cliente ?? null
  if (cliente) linhas.push('ATENÇÃO', `${extra.cliente ? 'O número dela é de um salão' : 'O salão dela'} JÁ usa a MIMO (${cliente.salao}): ela já é cliente. Se ela pedir ajuda com a agenda, marque eh_cliente; o sistema manda o contato do suporte. Não venda de novo.`, '')
  if (d.guia) {
    const nt = numerosTexto(d.guia.numeros)
    linhas.push('O SALÃO DELA NO GUIA', `${d.guia.nome} está no guia da MIMO: ${d.guia.link} (${d.guia.na_mimo ? 'já agenda pela MIMO' : 'ainda sem a agenda'}; ${d.guia.fotos_n ? `${d.guia.fotos_n} foto(s)` : 'sem fotos'}).`,
      nt ? `Os números da página (use a favor da venda; não invente outros): ${nt}` : 'A página ainda tem poucos acessos registrados: não cite números.',
      d.guia.na_mimo ? '' : 'Ela já tem exposição no guia: é um lead qualificado. O argumento: hoje quem acha a página dela entra em contato ou pede horário pela Mel; com a MIMO Agenda, marca direto na agenda dela, pela própria página e pelo app, e a página ganha o botão de agendar.',
      d.guia.na_mimo ? '' : 'A página é grátis. Se ela quiser pôr fotos ou corrigir algo, peça o e-mail dela e marque quer_fotos (o sistema manda o pedido e explica o e-mail de confirmação). Não peça o e-mail por outro motivo.', '')
  } else if (d.cidade_coberta === false && d.cidade) {
    linhas.push('O GUIA', `A cidade dela (${d.cidade}) ainda não está no guia. Quando vier ao caso, explique: o guia está em expansão pelo Brasil, cidade a cidade, e é questão de tempo; isso não impede nada na agenda, que funciona em qualquer cidade; ao entrar na MIMO o salão dela ganha a página dele no guia e, se for o primeiro da cidade, a MIMO monta o guia daquela cidade para incluir. Não prometa data.`, '')
  } else if (d.cidade_coberta === true && d.salao && d.incluir_guia) {
    linhas.push('O GUIA', `Não achamos o ${d.salao} no guia de ${d.cidade}. Se ela quiser, anote bairro, endereço e Instagram na resposta (a equipe inclui depois). Ao entrar na MIMO, o salão ganha a página dele no guia de qualquer jeito.`, '')
  }
  linhas.push('A EQUIPE', `A equipe humana atende ${horarioTexto(cfg)}; agora ${dentroDoHorario(cfg, extra.agora) ? 'está' : 'não está'} no horário. Quando ela quiser começar, testar ou falar com uma pessoa, marque quer_comecar ou quer_humano: o sistema manda o texto com o contato. Você não cria conta nem senha.`, '')
  linhas.push('COMO LER O QUE ELA DISSE',
    '- nome, cidade, salao, email: copie o que ela escreveu nesta conversa (vazio se não disse). Se ela disse que é autônoma, autonoma = "sim" e salao pode ficar vazio.',
    '- interesse: alto quando pergunta de preço, teste, como começar ou pede detalhes; baixo quando só olha; vazio quando não dá para saber.',
    '- quer_comecar: ela quer criar a conta, testar os 7 dias ou "quero". quer_humano: pede uma pessoa, atendente, ligar, "falar com alguém".',
    '- eh_cliente: ela já usa a MIMO e quer suporte da agenda. cliente_final: é uma cliente que quer marcar horário num salão (não é profissional).',
    '- sem_interesse: disse claramente que não quer. quer_fotos: quer pôr ou trocar fotos, corrigir dados da página do guia.',
    extra.apresentouAgora ? '- O sistema acabou de mandar a sua apresentação nesta mesma resposta: NÃO se apresente de novo; responda ao que ela escreveu e, se faltar, pergunte o nome dela.' : null,
    '- A resposta: curta (até 3 frases por parágrafo, até 2 parágrafos separados por linha em branco), uma pergunta no fim. Nunca repita a mesma pergunta duas vezes seguidas.')
  return linhas.filter((l) => l !== null).join('\n')
}

// o aviso à equipe (numero_avisos): quem é, o que quer, onde responder
export function avisoEquipe(cfg: Pick<Config, 'nome'>, d: Dados, tel: string, motivo: string, ultima: string): string {
  const l = [
    `💼 Comercial (${cfg.nome || 'assistente'}): ${motivo}`,
    `Quem: ${d.nome || 'sem nome ainda'} · ${telefoneBonito(tel) || tel}`,
    `Negócio: ${d.guia?.nome || d.salao || (d.autonoma ? 'autônoma' : 'não disse')}${d.cidade ? ` · ${d.cidade}` : ''}${d.autonoma && d.salao ? ' · autônoma' : ''}`,
    d.guia ? `No guia: ${d.guia.link}${numerosCurto(d.guia.numeros) ? ` · ${numerosCurto(d.guia.numeros)}` : ''}${d.guia.na_mimo ? '' : ' · lead qualificado: já tem exposição no guia'}` : null,
    d.email ? `E-mail: ${d.email}` : null,
    ultima ? `Disse: “${ultima.replace(/\s+/g, ' ').slice(0, 200)}”` : null,
    `Responder: ${linkWhats(tel)}`,
  ]
  return l.filter(Boolean).join('\n')
}

async function chamar(deps: Deps, nome: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await deps.rpc(nome, args)
  if (error) throw new Error(`${nome}: ${error.message ?? 'erro'}`)
  return data
}

// ---- a conversa ------------------------------------------------------------------------------------------------------
export async function atenderComercial(deps: Deps, e: Entrada, opcoes: { teste?: boolean } = {}): Promise<Saida> {
  const teste = !!opcoes.teste
  const agora = deps.agora?.() ?? new Date()
  const tel = teste ? e.telefone : so(e.telefone)
  const texto = String(e.texto ?? '').trim().slice(0, 2000)
  if (!tel || !texto) return { responder: null, acao: 'vazio' }
  const ctx = (await chamar(deps, 'comercial_contexto', { tel_: tel, nome_: e.nomePerfil ?? null })) as Contexto | null
  const cfg = ctx?.config
  if (!cfg) return { responder: null, acao: 'passa' }
  if (!cfg.ligado && !teste) return { responder: null, acao: 'desligada' }
  const nome = cfg.nome || 'Lia'
  const planos = ctx?.planos ?? null
  const em = agora.toISOString()
  const p = palavra(texto)
  let conversa: Conversa | null = ctx?.conversa ?? null
  const dados: Dados = { ...(conversa?.dados ?? {}) }
  let situacao = conversa?.situacao ?? 'novo'
  let origem: string = conversa?.origem ?? 'direto'
  let lugar: string | null = null
  const bolhas: string[] = []
  const novas: Array<{ q: string; t: string; em: string }> = [{ q: 'lead', t: texto, em }]
  const pausa = Math.max(0, Math.min(30, Number(cfg.pausa_seg ?? 2) || 0))
  const suporte = cfg.suporte_numero ? linkWhats(cfg.suporte_numero) : 'o nosso atendimento (a equipe te chama por aqui)'
  const encaminhar = cfg.encaminhar_numero ? ` Se preferir, o contato direto da equipe é ${linkWhats(cfg.encaminhar_numero)}.` : ''
  const fill = (modelo: string, extra: Record<string, string | null | undefined> = {}) =>
    preencherTexto(modelo, { nome, salao: dados.guia?.nome || dados.salao || 'seu salão', cidade: dados.cidade || 'sua cidade', suporte, horario: horarioTexto(cfg), encaminhar, email: dados.email || '', link: dados.guia?.link || '', numeros: numerosTexto(dados.guia?.numeros), nome_lead: dados.nome ? `, ${dados.nome}` : '', ...extra })

  const guardar = async (acao: string, extra: Partial<Saida> = {}): Promise<Saida> => {
    const saida = bolhas.map((b) => b.trim()).filter(Boolean)
    for (const b of saida) novas.push({ q: 'ia', t: b, em })
    const id = await chamar(deps, 'comercial_conversa_salvar', {
      id_: conversa?.id ?? null, tel_: tel, nome_: e.nomePerfil ?? null, situacao_: situacao, dados_: dados, novas_: novas, origem_: origem, teste_: teste, lugar_: lugar,
    })
    if (!conversa) conversa = { id: Number(id), telefone: tel, origem, situacao, dados, mensagens: [], humano_ate: null, pausada: false }
    return { responder: saida.join('\n\n') || null, bolhas: saida, pausa, acao, situacao, dados, origem, ...extra }
  }
  const avisar = async (motivo: string): Promise<string | null> => {
    const aviso = avisoEquipe(cfg, dados, teste ? '5513999990000' : tel, motivo, texto)
    if (teste) return aviso
    if (!cfg.numero_avisos || !conversa) return null
    try {
      const pode = await chamar(deps, 'comercial_avisada', { id_: conversa.id })
      if (pode === true) await deps.enviar(cfg.instancia, so(cfg.numero_avisos), aviso)
    } catch { /* o aviso é melhor-esforço */ }
    return null
  }

  // 1. "apagar meus dados" (LGPD)
  if (!teste && APAGAR.test(p)) {
    await chamar(deps, 'comercial_apagar', { tel_: tel })
    return { responder: 'Pronto, apaguei seus dados e esta conversa aqui na MIMO. 💗 Se quiser conversar depois, é só me chamar.', acao: 'apagou', bolhas: ['Pronto, apaguei seus dados e esta conversa aqui na MIMO. 💗 Se quiser conversar depois, é só me chamar.'], pausa }
  }
  // 2. a conversa está com a equipe (pausada, ou alguém entrou há pouco): a mensagem fica guardada, a assistente cala
  if (conversa?.pausada) return await guardar('pausada')
  if (conversa?.humano_ate && new Date(conversa.humano_ate) > agora) return await guardar('humano')
  // 3. o teto do dia por número
  const limite = Math.max(1, Number(cfg.limite_respostas) || 40)
  const hoje = Number(ctx?.respostas_hoje ?? 0)
  if (!teste && hoje >= limite) {
    if (hoje === limite) bolhas.push(`Por hoje já conversamos bastante por aqui 💗 Amanhã a gente continua. Se quiser falar com a equipe, é só dizer.`)
    return await guardar('limite')
  }

  // 4. a primeira mensagem: por onde ela veio, o que a Mel já disse dela, e a apresentação
  let apresentouAgora = false
  if (!conversa) {
    const vindo = VINDO_DA_MEL.exec(texto)
    if (vindo) {
      origem = /respondi quero/i.test(texto) ? 'quero' : 'mel'
      dados.salao = vindo[1].trim().slice(0, 80)
      if (vindo[2]) dados.cidade = vindo[2].trim().slice(0, 60)
    } else if (/quero conhecer a mimo agenda|quero criar minha conta/.test(p) || (/\bmimo\b/.test(p) && /plano|sistema|agenda|duvida|demonstra|conhecer/.test(p))) {
      origem = 'botao' // a frase do botão, ou as chamadas do site (planos, dúvida, demonstração…)
    } else origem = 'direto'
    if (teste) origem = 'teste'
    situacao = 'novo'
    dados.apresentada = true
    apresentouAgora = true
    const primeira = cfg.vendas_ligadas ? cfg.msg_apresentacao : (cfg.msg_vendas_desligadas.includes('{nome}') ? cfg.msg_vendas_desligadas : `Oi! Eu sou a {nome}, da MIMO 💗 ${cfg.msg_vendas_desligadas}`)
    bolhas.push(fill(primeira))
    // quem veio pela Mel já disse o salão e a cidade: procura no guia antes mesmo da IA
    if (dados.salao && dados.cidade) await procurarNoGuia()
    // só um "oi" (ou a frase do botão): a apresentação basta; o resto segue para a IA responder também
    const curta = p.split(' ').length <= 3 || origem === 'botao' || !!vindo
    if (curta) return await guardar('apresentou')
  }
  // 5. quem já é cliente: o suporte, uma vez (depois a IA segue sabendo)
  if (ctx?.cliente && !dados.suporte_informado) {
    dados.suporte_informado = true
    situacao = 'cliente'
    bolhas.push(fill(cfg.msg_suporte))
    return await guardar('suporte')
  }

  // 6. a IA conversa e lê
  const historico: Mensagem[] = (conversa?.mensagens ?? []).slice(-30).map((m) => ({ role: m.q === 'lead' ? 'user' as const : 'assistant' as const, content: m.q === 'equipe' ? `[equipe da MIMO] ${m.t}` : m.t }))
  historico.push({ role: 'user', content: texto })
  const r = await deps.ia({
    provedor: cfg.provedor, modelo: cfg.modelo || MODELO_PADRAO[cfg.provedor] || MODELO_PADRAO.groq,
    sistema: sistema(cfg, planos, dados, { cliente: ctx?.cliente ?? null, agora, nomePerfil: e.nomePerfil, apresentouAgora }), mensagens: historico,
  })
  if (!r.leitura) {
    if (!apresentouAgora) bolhas.push('Deixa eu confirmar isso com a equipe e já te respondo 💗')
    if (situacao === 'novo') situacao = 'conversando'
    return await guardar('erro_ia', { erro: r.erro })
  }
  const li = r.leitura
  // o que ela disse (só o que vale)
  const limpo = (t: string, n: number) => t.replace(/\s+/g, ' ').trim().slice(0, n)
  if (li.nome && limpo(li.nome, 60).length >= 2 && !/^(nao|não|sem nome)$/i.test(li.nome)) dados.nome = limpo(li.nome, 60)
  const cidadeNova = li.cidade && limpo(li.cidade, 60).length >= 3 && palavra(li.cidade) !== palavra(dados.cidade ?? '')
  const salaoNovo = li.salao && limpo(li.salao, 80).length >= 2 && palavra(li.salao) !== palavra(dados.salao ?? '')
  if (cidadeNova) { dados.cidade = limpo(li.cidade, 60); dados.guia_informado = false; dados.cidade_coberta = undefined }
  if (salaoNovo) { dados.salao = limpo(li.salao, 80); dados.guia_informado = false }
  if (li.autonoma === 'sim') dados.autonoma = true
  if (li.autonoma === 'nao') dados.autonoma = false
  if (li.email && EMAIL.test(li.email.trim())) dados.email = li.email.trim().toLowerCase()
  if (li.interesse) dados.interesse = li.interesse

  // uma cliente final (quer marcar horário): o guia, e pronto
  if (li.cliente_final && !dados.cliente_final) {
    dados.cliente_final = true
    situacao = 'sem_interesse'
    bolhas.push(fill(cfg.msg_cliente_final))
    return await guardar('cliente_final')
  }
  if (li.resposta?.trim()) bolhas.push(...dividir(li.resposta, cfg))

  // o salão dela no guia (quando a cidade e o salão acabaram de aparecer)
  if (dados.cidade && dados.salao && !dados.guia_informado) await procurarNoGuia()
  // as fotos: com o e-mail e o salão no guia (fora da MIMO), o pedido "sou a dona" sai uma vez
  if (li.quer_fotos && dados.email && dados.guia && !dados.guia.na_mimo && !dados.fotos_pedidas) {
    if (teste) { dados.fotos_pedidas = true; bolhas.push(fill(cfg.msg_fotos_enviado)) }
    else {
      try {
        const f = (await chamar(deps, 'comercial_fotos', { lugar_: dados.guia.lugar_id, nome_: dados.nome ?? null, tel_: tel, email_: dados.email })) as { ok?: boolean; motivo?: string } | null
        if (f?.ok) { dados.fotos_pedidas = true; bolhas.push(fill(cfg.msg_fotos_enviado)) }
        else if (f?.motivo) bolhas.push(`Não consegui registrar o pedido das fotos agora (${f.motivo}). Vou pedir para a equipe cuidar disso.`)
      } catch { bolhas.push('Não consegui registrar o pedido das fotos agora; vou pedir para a equipe cuidar disso.') }
    }
  }
  // já é cliente (a IA percebeu): o suporte
  if (li.eh_cliente && !dados.suporte_informado) {
    dados.suporte_informado = true
    situacao = 'cliente'
    bolhas.push(fill(cfg.msg_suporte))
  }
  // quer começar, ou uma pessoa: a equipe
  let previaAviso: string | null = null
  let chamouEquipe = false
  if ((li.quer_comecar || li.quer_humano) && situacao !== 'cliente' && !dados.ja_cliente) {
    situacao = 'quer_comecar'
    chamouEquipe = true
    bolhas.push(fill(cfg.msg_equipe))
  } else if (li.sem_interesse) {
    situacao = 'sem_interesse'
  } else if (situacao === 'novo' || situacao === 'conversando') {
    situacao = li.interesse === 'alto' ? 'interessada' : 'conversando'
  } else if (situacao === 'perdido' || situacao === 'sem_interesse') {
    situacao = li.interesse === 'alto' ? 'interessada' : 'conversando' // voltou a falar
  }
  const saida = await guardar(li.quer_comecar ? 'quer_comecar' : li.quer_humano ? 'quer_humano' : li.eh_cliente ? 'suporte' : 'conversou')
  // o aviso à equipe acompanha o texto da equipe (quem já é cliente tem o suporte, não o comercial)
  if (chamouEquipe) previaAviso = await avisar(li.quer_comecar ? 'quer começar / testar a MIMO Agenda' : 'pediu para falar com uma pessoa')
  return { ...saida, previaAviso }

  // a cidade e o salão dela: primeiro, quem já tem agenda na MIMO com esse nome nessa cidade (3.74.1: ela pode escrever de
  // outro número) → o suporte, e a conversa vira cliente; senão o guia (3.74.2): a cidade é coberta? (fora: a expansão) está
  // lá? (achei: a página e os números dela a favor da venda; não: incluir) — uma mensagem do sistema
  async function procurarNoGuia() {
    dados.guia_informado = true
    try {
      const b = (await chamar(deps, 'comercial_buscar_salao', { cidade_: dados.cidade, nome_: dados.salao })) as { cidade_coberta?: boolean; cidade?: string; mimo?: { id: string; nome: string; cidade?: string | null } | null; lugares?: Array<{ id: string; nome: string; link: string; na_mimo: boolean; fotos_n: number; bairro?: string | null; numeros?: Numeros | null }> } | null
      dados.cidade_coberta = !!b?.cidade_coberta
      if (b?.mimo?.nome) {
        dados.ja_cliente = { salao: b.mimo.nome }
        if (!dados.suporte_informado) { dados.suporte_informado = true; bolhas.push(fill(cfg.msg_salao_na_mimo, { salao: b.mimo.nome })) }
        situacao = 'cliente'
        const l = b.lugares?.[0]
        if (l) { dados.guia = { lugar_id: l.id, nome: l.nome, link: l.link, na_mimo: true, fotos_n: Number(l.fotos_n) || 0, bairro: l.bairro ?? null, numeros: l.numeros ?? null }; lugar = l.id }
        return
      }
      if (!b?.cidade_coberta) { dados.guia = null; bolhas.push(fill(cfg.msg_cidade_fora)); return }
      if (b.cidade) dados.cidade = b.cidade
      const l = b.lugares?.[0]
      if (!l) { dados.guia = null; dados.incluir_guia = true; bolhas.push(fill(cfg.msg_nao_achei)); return }
      dados.guia = { lugar_id: l.id, nome: l.nome, link: l.link, na_mimo: !!l.na_mimo, fotos_n: Number(l.fotos_n) || 0, bairro: l.bairro ?? null, numeros: l.numeros ?? null }
      dados.incluir_guia = false
      lugar = l.id
      bolhas.push(fill(cfg.msg_achei_no_guia, { salao: l.nome, link: l.link, numeros: numerosTexto(l.numeros) }))
    } catch { dados.guia_informado = false }
  }
}

// a cutucada da cadência (o relógio da VPS): o texto da etapa com o nome dela
export function textoCadencia(textos: string[], etapa: number, nome: string | null | undefined): string {
  const t = textos[Math.max(0, Math.min(textos.length - 1, etapa - 1))] ?? ''
  return preencherTexto(t, { nome_lead: nome ? `, ${nome}` : '' })
}
