// O agente de onboarding da MIMO pelo WhatsApp (3.55, migração 203).
//
// É um SEGUNDO agente no mesmo número da Mel do guia, separado dela: persona, contexto, passos e configuração próprios
// (guia_onboarding_config, a aba Onboarding da Plataforma). Enquanto a Mel-cliente anota um pedido e passa ao salão, este
// atende a PROFISSIONAL (dona de salão ou autônoma) que quer criar a conta dela na MIMO Agenda — e faz o cadastro
// conversando: tipo → CNPJ (consultado: só ATIVO passa; "não tenho" → CPF) → endereço (do CNPJ, confirmado; ou pedido)
// → nome → nº de profissionais → serviços → horários → e-mail → explicações (link próprio, QR code, lembretes) → o LINK.
// Senha NUNCA pelo WhatsApp: no fim vai um link seguro (mimo.com.vc/comecar?c=<token>) que abre o /comecar já
// pré-preenchido; na tela ela só cria a senha, aceita os termos e escolhe o plano.
//
// Como a mensagem chega aqui: o webhook chama atenderOnboarding ANTES da Mel-cliente. Se não há conversa de onboarding
// aberta deste número e a mensagem não traz um gatilho (config.gatilhos), volta { acao: 'passa' } e a Mel atende como
// sempre. O 1º gatilho é a frase do botão das landings (origem "cta": intenção certa, começa direto); os demais são
// intenção percebida (origem "intencao"): o agente PRIMEIRO pergunta se ela quer mesmo criar a conta — quem é cliente diz
// que não e é devolvida à Mel, sem ser arrastada para o fluxo errado.
//
// O que é determinístico (não passa pela IA): os gatilhos, o sim/não da confirmação, a validação do dígito de CPF e CNPJ,
// a consulta do CNPJ (dep consultarCnpj: BrasilAPI de verdade no webhook e no simulador; de mentira nos testes), o
// e-mail, o "sim" do endereço, a tolerância a erro (encerra e avisa a equipe) e o link. A IA entra para conversar: ler o
// que ela escreveu em texto livre, agradecer e fazer a pergunta do passo seguinte, explicar — guiada pela orientação e
// pelos textos de cada passo que a Plataforma edita.
//
// Como a Mel, este arquivo não fala com a rede nem com o banco por conta própria: tudo vem em `Deps`.

import { so, palavra, telefoneBonito, preencher, RAIZ_SITE, MODELO_PADRAO } from './guia_whats.ts'
import { iaJsonDe, type Ambiente, type Fetch, type Mensagem } from './ia_json.ts'

export type Resultado = { ok: true; providerId: string | null } | { ok: false; erro: string }
export type Endereco = { logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; uf?: string; cep?: string; texto?: string }
export type ConsultaCnpj =
  | { ok: true; ativo: boolean; situacao: string; razao_social: string; nome_fantasia: string | null; endereco: Endereco }
  | { ok: false; motivo: 'nao_encontrado' | 'indisponivel'; erro?: string }
export type LeituraOnb = {
  resposta: string; tipo: string; cnpj: string; cpf: string; sem_cnpj: boolean; nome: string; endereco: string; cidade: string
  profissionais: string; servicos: string; horarios: string; email: string
  passo_concluido: boolean; nao_e_profissional: boolean; quer_apagar_dados: boolean
}
export type PedidoIa = { provedor: string; modelo: string; sistema: string; mensagens: Mensagem[] }
export type Deps = {
  rpc: (nome: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>
  ia: (p: PedidoIa) => Promise<{ leitura: LeituraOnb | null; erro?: string; modelo?: string }>
  enviar: (instancia: string, telefone: string, texto: string) => Promise<Resultado>
  consultarCnpj: (cnpj: string) => Promise<ConsultaCnpj>
  agora?: () => Date
}
export type Origem = 'cta' | 'intencao' | 'dona' | 'teste'
export type Entrada = { telefone: string; texto: string; nomePerfil?: string | null }
export type Dados = {
  passo?: string; tipo?: string; cnpj?: string; cpf?: string; sem_cnpj?: boolean; razao_social?: string; nome_fantasia?: string
  nome?: string; endereco?: Endereco; endereco_cnpj?: Endereco; confirmando_endereco?: boolean
  profissionais?: number; servicos?: string[]; horarios?: string; email?: string; explicou?: boolean; explicacoes_ok?: boolean
  erros?: number; erros_cnpj?: number; erros_consulta?: number; sem_avanco?: number; pos_link?: number; link_enviado?: boolean
  nao_e_profissional?: boolean; encerrada_por?: string; atendido?: boolean
}
export type Saida = { responder: string | null; acao: string; estado?: string; passo?: string; dados?: Dados; link?: string | null; previaAviso?: string | null; erro?: string }
type Conversa = { id: number; telefone: string; origem: string; estado: string; dados: Dados; mensagens: Array<{ q: string; t: string; em?: string }>; token?: string }
type Mel = { ligado: boolean; numero: string | null; instancia: string; numero_avisos: string | null }
export type Config = {
  ligado: boolean; provedor: string; modelo: string | null; orientacao: string; gatilhos: string[]
  tolerancia: number; tolerancia_cnpj: number; link_dias: number
  com_servicos: boolean; com_horarios: boolean; com_email: boolean; com_explicacoes: boolean
  passo_tipo: string; passo_documento: string; passo_endereco: string; passo_nome: string; passo_profissionais: string
  passo_servicos: string; passo_horarios: string; passo_email: string; passo_explicacoes: string
  msg_confirmar: string; msg_boas_vindas: string; msg_nao_sou: string; msg_cnpj_invalido: string; msg_cpf_invalido: string
  msg_email_invalido: string; msg_endereco_confirmar: string; msg_link: string; msg_encerrar: string
}

// ---- CPF e CNPJ (o dígito verificador) ------------------------------------------------------------------------------
// Só confere se o número é bem formado; "existe e está ativo" é a consulta (CNPJ) ou o Asaas (CPF, na hora de cobrar).
function mod11(digitos: string, pesos: number[]): number {
  const soma = pesos.reduce((s, p, i) => s + Number(digitos[i]) * p, 0)
  const r = soma % 11
  return r < 2 ? 0 : 11 - r
}
export function validarCpf(bruto: string): boolean {
  const d = so(bruto)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const p1 = [10, 9, 8, 7, 6, 5, 4, 3, 2], p2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]
  return mod11(d, p1) === Number(d[9]) && mod11(d, p2) === Number(d[10])
}
export function validarCnpj(bruto: string): boolean {
  const d = so(bruto)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  return mod11(d, p1) === Number(d[12]) && mod11(d, p2) === Number(d[13])
}
export const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i
export const cnpjBonito = (d: string) => d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d
export function enderecoTexto(e: Endereco | null | undefined): string {
  if (!e) return ''
  if (e.texto && !e.logradouro) return [e.texto, e.cidade && !new RegExp(e.cidade, 'i').test(e.texto) ? e.cidade : ''].filter(Boolean).join(', ')
  const rua = [e.logradouro, e.numero].filter(Boolean).join(', ') + (e.complemento ? ` ${e.complemento}` : '')
  const cidade = [e.cidade, e.uf].filter(Boolean).join('-')
  const cep = e.cep && so(e.cep).length === 8 ? `CEP ${so(e.cep).slice(0, 5)}-${so(e.cep).slice(5)}` : ''
  return [rua, e.bairro, cidade, cep].filter(Boolean).join(' · ')
}

// ---- os gatilhos (o que traz a mensagem para este agente) ----------------------------------------------------------
// Normaliza como o banco (guia_onboarding_config_salvar) e compara por "contém". O índice 0 é a frase do botão (cta).
export function gatilhoDe(texto: string, gatilhos: string[] | null | undefined): { indice: number; frase: string } | null {
  const p = palavra(texto)
  if (!p) return null
  for (let i = 0; i < (gatilhos ?? []).length; i++) {
    const g = palavra(gatilhos![i])
    if (g.length >= 4 && p.includes(g)) return { indice: i, frase: g }
  }
  return null
}

// ---- os passos ----------------------------------------------------------------------------------------------------
export const NOME_PASSO: Record<string, string> = {
  tipo: 'tipo de conta (autônoma ou salão)', documento: 'CNPJ (ou CPF, se ela não tem CNPJ)', endereco: 'endereço de atendimento',
  nome: 'nome do negócio', profissionais: 'quantas profissionais atendem', servicos: 'serviços principais', horarios: 'horários de atendimento',
  email: 'e-mail da conta', explicacoes: 'explicar (link próprio, QR code, lembretes) e tirar dúvidas', link: 'mandar o link seguro',
}
export function passosDe(cfg: Pick<Config, 'com_servicos' | 'com_horarios' | 'com_email' | 'com_explicacoes'>): string[] {
  return ['tipo', 'documento', 'endereco', 'nome', 'profissionais',
    ...(cfg.com_servicos ? ['servicos'] : []), ...(cfg.com_horarios ? ['horarios'] : []), ...(cfg.com_email ? ['email'] : []),
    ...(cfg.com_explicacoes ? ['explicacoes'] : []), 'link']
}
export function passoFeito(d: Dados, passo: string): boolean {
  switch (passo) {
    case 'tipo': return !!d.tipo
    case 'documento': return !!d.cnpj || (!!d.sem_cnpj && !!d.cpf)
    case 'endereco': return !!d.endereco && !d.confirmando_endereco
    case 'nome': return !!d.nome
    case 'profissionais': return Number(d.profissionais) > 0
    case 'servicos': return (d.servicos?.length ?? 0) > 0
    case 'horarios': return !!d.horarios
    case 'email': return !!d.email
    case 'explicacoes': return !!d.explicacoes_ok
    default: return false
  }
}
// o primeiro passo ainda não feito (o link é o último e nunca "está feito")
export function avancar(d: Dados, passos: string[]): string {
  return passos.find((p) => !passoFeito(d, p)) ?? 'link'
}

// ---- o que a IA sabe a cada mensagem ---------------------------------------------------------------------------------
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
function agoraTexto(d: Date): string {
  const sp = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  return `${DIAS[sp.getDay()]}, ${sp.toLocaleDateString('pt-BR')} ${String(sp.getHours()).padStart(2, '0')}:${String(sp.getMinutes()).padStart(2, '0')}`
}
export function sistema(cfg: Config, d: Dados, passo: string, proximo: string | null, nota: string, nomePerfil: string | null | undefined, agora: Date): string {
  const guia = (p: string) => String((cfg as unknown as Record<string, unknown>)[`passo_${p}`] ?? '').trim()
  const oQueFazer = passo === 'confirmar'
    ? 'ela recebeu a pergunta se quer criar a conta na MIMO Agenda e respondeu algo que não é um sim nem um não claros. Descubra, com uma pergunta curta e gentil, se ela é profissional de beleza querendo criar a conta (passo_concluido = true quando ela confirmar que sim) ou se é cliente querendo marcar um horário (nao_e_profissional = true).'
    : passo === 'link'
      ? 'o link seguro já foi enviado. Só tire dúvidas, curto; se ela disser que não recebeu, que expirou ou que não abre, diga que vai mandar de novo (o sistema reenvia).'
      : passo === 'documento' && d.sem_cnpj && !d.cpf
        ? 'ela não tem CNPJ: peça o CPF dela (só os números), explicando em uma frase que é para o pagamento da assinatura. Não peça mais nada agora.'
        : passo === 'endereco' && d.confirmando_endereco
          ? `o sistema mostrou o endereço do CNPJ (${enderecoTexto(d.endereco_cnpj)}) e perguntou se é aí que ela atende. Se ela mandou outro endereço, anote em "endereco"; se disse que é esse, passo_concluido = true.`
          : passo === 'explicacoes'
            ? `${guia('explicacoes')} Escreva a explicação inteira NESTA resposta (parágrafos curtos, numa mensagem só) e termine perguntando se ficou alguma dúvida.`
            : guia(passo)
  const linhas: Array<string | null> = [
    String(cfg.orientacao),
    '',
    'ONDE A CONVERSA ESTÁ',
    `- Passo atual: ${NOME_PASSO[passo] ?? passo}. O que fazer: ${oQueFazer}`,
    proximo && passo !== 'confirmar' && passo !== 'link' ? `- Se ela já respondeu o passo atual, agradeça em poucas palavras e já faça a pergunta do próximo passo (${NOME_PASSO[proximo] ?? proximo}): ${proximo === 'link' ? 'não pergunte nada: o sistema manda o link.' : guia(proximo)}` : null,
    nota || null,
    `- Agora: ${agoraTexto(agora)} (horário de Brasília)`,
    '',
    'O QUE JÁ ANOTEI',
    `- Tipo: ${d.tipo === 'autonoma' ? 'autônoma' : d.tipo === 'salao' ? 'salão' : 'ainda não sei'}`,
    `- CNPJ: ${d.cnpj ? `${cnpjBonito(d.cnpj)} (ativo na Receita${d.razao_social ? `: ${d.razao_social}` : ''})` : d.sem_cnpj ? 'não tem' : 'ainda não sei'}`,
    `- CPF: ${d.cpf ? 'anotado e válido' : d.sem_cnpj ? 'ainda não sei' : 'não precisa (tem CNPJ)'}`,
    `- Nome do negócio: ${d.nome || (d.nome_fantasia ? `ainda não confirmou (o CNPJ sugere "${d.nome_fantasia}")` : d.razao_social ? `ainda não confirmou (a razão social é "${d.razao_social}")` : 'ainda não sei')}`,
    `- Endereço: ${d.endereco && !d.confirmando_endereco ? enderecoTexto(d.endereco) : d.confirmando_endereco ? 'aguardando ela confirmar o do CNPJ' : 'ainda não sei'}`,
    `- Profissionais: ${d.profissionais ? String(d.profissionais) : 'ainda não sei'}`,
    `- Serviços: ${d.servicos?.length ? d.servicos.join(', ') : 'ainda não sei'}`,
    `- Horários: ${d.horarios || 'ainda não sei'}`,
    `- E-mail: ${d.email || 'ainda não sei'}`,
    nomePerfil ? `- O perfil do WhatsApp dela diz "${nomePerfil}" (é o nome dela, não do negócio; confirme antes de usar).` : null,
    '',
    'RESPONDA SÓ COM OS CAMPOS',
    '- resposta: a mensagem para ela.',
    '- tipo: "autonoma" ou "salao" se ela disse nesta conversa; senão "".',
    '- cnpj, cpf: só os números, se ela mandou nesta mensagem; senão "". sem_cnpj: true se ela disse que não tem CNPJ.',
    '- nome: o nome do negócio, se disse. endereco: o endereço como ela escreveu, se disse. cidade: a cidade, se der para saber.',
    '- profissionais: o número, se disse (como texto). servicos: os serviços que citou, separados por vírgula. horarios: como ela disse. email: o e-mail, se mandou.',
    '- passo_concluido: true se ela respondeu o que o passo atual pede (ou confirmou, quando a pergunta era de confirmar).',
    '- nao_e_profissional: true se ela disse que é cliente, que quer marcar um horário ou que não tem salão nem atende.',
    '- quer_apagar_dados: true se pediu para apagar os dados dela.',
    'Não invente dado nenhum: texto vazio quando ela não disse.',
  ]
  return linhas.filter((l) => l !== null).join('\n')
}

export const ESQUEMA_ONB = {
  type: 'object',
  additionalProperties: false,
  properties: {
    resposta: { type: 'string' }, tipo: { type: 'string' }, cnpj: { type: 'string' }, cpf: { type: 'string' }, sem_cnpj: { type: 'boolean' },
    nome: { type: 'string' }, endereco: { type: 'string' }, cidade: { type: 'string' }, profissionais: { type: 'string' },
    servicos: { type: 'string' }, horarios: { type: 'string' }, email: { type: 'string' },
    passo_concluido: { type: 'boolean' }, nao_e_profissional: { type: 'boolean' }, quer_apagar_dados: { type: 'boolean' },
  },
  required: ['resposta', 'tipo', 'cnpj', 'cpf', 'sem_cnpj', 'nome', 'endereco', 'cidade', 'profissionais', 'servicos', 'horarios', 'email', 'passo_concluido', 'nao_e_profissional', 'quer_apagar_dados'],
}
const CAMPOS_ONB = 'Responda só com um objeto JSON com exatamente estes campos: "resposta", "tipo", "cnpj", "cpf", "nome", "endereco", "cidade", "profissionais", "servicos", "horarios", "email" (textos; "" quando não souber) e "sem_cnpj", "passo_concluido", "nao_e_profissional", "quer_apagar_dados" (true ou false).'
export function montarOnb(lido: Record<string, unknown>): LeituraOnb | null {
  if (typeof lido?.resposta !== 'string') return null
  const s = (k: string) => String(lido[k] ?? '')
  return {
    resposta: lido.resposta, tipo: s('tipo'), cnpj: s('cnpj'), cpf: s('cpf'), sem_cnpj: lido.sem_cnpj === true, nome: s('nome'), endereco: s('endereco'),
    cidade: s('cidade'), profissionais: s('profissionais'), servicos: s('servicos'), horarios: s('horarios'), email: s('email'),
    passo_concluido: lido.passo_concluido === true, nao_e_profissional: lido.nao_e_profissional === true, quer_apagar_dados: lido.quer_apagar_dados === true,
  }
}
export function iaOnbDe(env: Ambiente, fetcher: Fetch): Deps['ia'] {
  return iaJsonDe<LeituraOnb>(env, fetcher, { esquema: ESQUEMA_ONB, campos: CAMPOS_ONB, montar: montarOnb, maxTokens: { claude: 1800, groq: 3000 } })
}

// ---- a consulta do CNPJ (BrasilAPI: grátis, sem chave; roda no servidor) -------------------------------------------
// 200 → os dados (situação, razão social, nome fantasia, endereço); 404/400 → não existe; o resto → fora do ar (não é
// culpa do CNPJ dela: o motor tenta de novo e, se persistir, não aceita no escuro).
export function consultarCnpjDe(fetcher: Fetch): Deps['consultarCnpj'] {
  return async (cnpj) => {
    const d = so(cnpj)
    try {
      const r = await fetcher(`https://brasilapi.com.br/api/cnpj/v1/${d}`, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
      const cru = await r.text()
      if (r.status === 404 || r.status === 400) return { ok: false, motivo: 'nao_encontrado' }
      if (r.status < 200 || r.status >= 300) return { ok: false, motivo: 'indisponivel', erro: `BrasilAPI respondeu ${r.status}` }
      let j: Record<string, unknown>
      try { j = JSON.parse(cru) } catch { return { ok: false, motivo: 'indisponivel', erro: 'resposta inválida' } }
      const descricao = String(j.descricao_situacao_cadastral ?? '').toUpperCase().trim()
      const situacao = descricao || (Number(j.situacao_cadastral) === 2 ? 'ATIVA' : String(j.situacao_cadastral ?? 'DESCONHECIDA'))
      const t = (k: string) => String(j[k] ?? '').trim()
      return {
        ok: true, ativo: situacao === 'ATIVA', situacao, razao_social: t('razao_social'), nome_fantasia: t('nome_fantasia') || null,
        endereco: { logradouro: [t('descricao_tipo_de_logradouro'), t('logradouro')].filter(Boolean).join(' '), numero: t('numero'), complemento: t('complemento'),
          bairro: t('bairro'), cidade: t('municipio'), uf: t('uf'), cep: so(j.cep) },
      }
    } catch (e) {
      return { ok: false, motivo: 'indisponivel', erro: String((e as Error)?.message ?? e).slice(0, 120) }
    }
  }
}

// ---- o atendimento ------------------------------------------------------------------------------------------------
const SIM_CURTO = /^(sim|s|ss|sim sim|sim quero|sim pode|ok|okay|okey|pode|pode ser|isso|isso mesmo|isso ai|claro|claro que sim|confirmo|confirmado|certo|beleza|bora|vamos|vai|yes|uhum|aham|correto|perfeito|otimo|top|show|fechado|combinado|quero|quero sim|e esse|e esse mesmo|esse mesmo|e isso|e isso mesmo|exato|exatamente|pode continuar|continua|proximo|seguinte|tudo certo|tudo bem|entendi|ta bom|ta otimo|manda|pode mandar|manda o link)$/
const NAO_CURTO = /^(nao|n|nao quero|nao precisa|nao obrigada|nao obrigado|nao nao|cancela|cancelar|desisto|desisti|deixa|deixa pra la|esquece|esqueca|agora nao|depois|outra hora)$/
const SIM_EMOJI = /^(?:\s|👍|✅|👌|🙏|💗|❤|️|🥰|😊|[\u{1F3FB}-\u{1F3FF}])+$/u
const CLIENTE = /\b(sou cliente|quero marcar|marcar (um )?horario|agendar|sou so cliente|nao tenho salao|nao sou profissional|nao sou dona|quero um horario)\b/
const NAO_TENHO = /\b(nao tenho( cnpj)?|sem cnpj|nao possuo|nao tem cnpj|so (tenho )?cpf|tenho so cpf|e cpf|usa o cpf|pelo cpf|no cpf)\b/
const APAGAR = /\b(apag|exclu|delet|remov)[a-z]*\b.*\b(dados|conversa|numero|informac|cadastro)/
const REENVIAR = /\b(nao recebi|nao chegou|manda (de novo|outra vez|o link)|reenvia|reenviar|expirou|venceu|nao abre|nao abriu|nao funciona|link de novo|outro link|me manda o link)\b/
const AUTONOMA = /\b(autonoma|autonomo|sozinha|sozinho|so eu|por conta|por minha conta|freelancer|em casa|a domicilio|domicilio|atendo em casa|eu mesma)\b/
const SALAO = /\b(salao|equipe|estudio|studio|clinica|espaco|barbearia|funcionari[ao]s?|minhas meninas|tenho (um |uma )?(salao|espaco|estudio|studio|clinica))\b/
const CONSULTA_FORA = 'A consulta da Receita está fora do ar agora 😕 Me manda o CNPJ de novo daqui a alguns minutos que eu confiro, tá?'
const limpo = (t: unknown, n: number) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const paragrafos = (t: unknown, n: number) => String(t ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n)

async function chamar(deps: Deps, nome: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await deps.rpc(nome, args)
  if (error) throw new Error(`${nome}: ${error.message ?? 'erro'}`)
  return data
}

export function linkDoCadastro(token: string): string {
  return `https://${RAIZ_SITE}/comecar?c=${token}`
}

export async function atenderOnboarding(deps: Deps, e: Entrada, opcoes: { teste?: boolean; origem?: Origem } = {}): Promise<Saida> {
  const teste = !!opcoes.teste
  const agora = deps.agora?.() ?? new Date()
  const tel = teste ? e.telefone : so(e.telefone)
  const texto = String(e.texto ?? '').trim().slice(0, 1500)
  if (!tel || !texto) return { responder: null, acao: 'vazio' }
  const ctx = (await chamar(deps, 'guia_onboarding_contexto', { tel_: tel })) as { config: Config | null; mel: Mel | null; conversa: Conversa | null } | null
  const cfg = ctx?.config
  if (!cfg) return { responder: null, acao: 'passa' }
  if (!cfg.ligado && !teste) return { responder: null, acao: 'passa' }
  const mel: Mel = ctx?.mel ?? { ligado: false, numero: null, instancia: 'mimo-guia', numero_avisos: null }
  const p = palavra(texto)
  const em = agora.toISOString()
  let conversa: Conversa | null = ctx?.conversa ?? null

  // a entrada: sem conversa aberta, só um gatilho (ou o simulador, que diz a origem) traz a mensagem para cá
  let origem: Origem | null = null
  if (!conversa) {
    const g = gatilhoDe(texto, cfg.gatilhos)
    if (opcoes.origem) origem = opcoes.origem
    else if (g) origem = g.indice === 0 ? 'cta' : 'intencao'
    if (!origem) return { responder: null, acao: 'passa' }
  }

  const novas: Array<{ q: string; t: string; em: string }> = [{ q: 'cliente', t: texto, em }]
  const guardar = async (resposta: string | null, estado: string, dados: Dados) => {
    if (resposta) novas.push({ q: 'mel', t: resposta, em })
    const id = await chamar(deps, 'guia_onboarding_conversa_salvar', { id_: conversa?.id ?? null, tel_: tel, estado_: estado, dados_: dados, novas_: novas, origem_: origem ?? conversa?.origem ?? 'intencao', teste_: teste })
    if (!conversa) conversa = { id: Number(id), telefone: tel, origem: origem ?? 'intencao', estado, dados, mensagens: [] }
  }

  // "apagar meus dados" (LGPD)
  if (!teste && APAGAR.test(p)) {
    await chamar(deps, 'guia_onboarding_apagar', { tel_: tel })
    return { responder: 'Pronto, apaguei seus dados e esta conversa aqui na MIMO. 💗 Se quiser criar sua conta depois, é só me chamar.', acao: 'apagou' }
  }

  const passos = passosDe(cfg)
  const estadoAntes = conversa?.estado ?? (origem === 'intencao' ? 'confirmando' : 'coletando')
  const dados: Dados = { ...(conversa?.dados ?? {}) }
  const tol = Math.max(1, Number(cfg.tolerancia) || 3)
  const tolCnpj = Math.max(1, Number(cfg.tolerancia_cnpj) || 3)
  const avisar = async (texto: string) => {
    if (teste || !mel.numero_avisos) return
    try { await deps.enviar(mel.instancia, so(mel.numero_avisos), texto) } catch { /* o aviso é melhor-esforço */ }
  }
  // encerrar com carinho e avisar a equipe: um humano retoma (tolerância estourada, consulta fora do ar, sem avançar).
  // Quando foi uma resposta inválida que estourou, ela ainda lê o motivo (prefixo) e só então a despedida.
  const encerrar = async (motivo: string, prefixo: string | null = null): Promise<Saida> => {
    const resposta = `${prefixo ? `${prefixo}\n\n` : ''}${paragrafos(cfg.msg_encerrar, 2000)}`
    const d = { ...dados, encerrada_por: motivo }
    await guardar(resposta, 'encerrada', d)
    const aviso = avisoEquipe('encerrou', d, tel, motivo)
    await avisar(aviso)
    return { responder: resposta, acao: `encerrou_${motivo}`, estado: 'encerrada', passo: d.passo, dados: d, previaAviso: teste ? aviso : null }
  }
  // devolver à Mel-cliente (ela não é profissional): a conversa de onboarding fecha; a próxima mensagem dela vai à Mel
  const devolver = async (): Promise<Saida> => {
    const resposta = paragrafos(cfg.msg_nao_sou, 2000)
    await guardar(resposta, 'encerrada', { ...dados, nao_e_profissional: true, encerrada_por: 'nao_e_profissional' })
    return { responder: resposta, acao: 'nao_e_profissional', estado: 'encerrada' }
  }

  // 1. confirmando a intenção (entrou por intenção percebida): a pergunta; depois sim → começa; não/cliente → devolve
  let nota = ''
  if (estadoAntes === 'confirmando') {
    if (!conversa) {
      const resposta = paragrafos(cfg.msg_confirmar, 2000)
      await guardar(resposta, 'confirmando', {})
      return { responder: resposta, acao: 'confirmar', estado: 'confirmando', dados: {} }
    }
    if (NAO_CURTO.test(p) || CLIENTE.test(p)) return devolver()
    if (!SIM_CURTO.test(p) && !(!p && SIM_EMOJI.test(texto))) {
      // nem sim nem não: a IA decide (e re-pergunta, até a tolerância)
      const r = await deps.ia({ provedor: cfg.provedor, modelo: cfg.modelo || MODELO_PADRAO[cfg.provedor] || MODELO_PADRAO.groq, sistema: sistema(cfg, dados, 'confirmar', null, '', e.nomePerfil, agora), mensagens: historico(conversa, texto) })
      if (!r.leitura) {
        const resposta = 'Desculpa, me enrolei aqui 😅 Você quer criar sua conta na MIMO Agenda? Me responde *sim* ou *não*.'
        await guardar(resposta, 'confirmando', dados)
        return { responder: resposta, acao: 'erro_ia', erro: r.erro, estado: 'confirmando', dados }
      }
      if (r.leitura.nao_e_profissional) return devolver()
      if (!r.leitura.passo_concluido) {
        dados.sem_avanco = Number(dados.sem_avanco ?? 0) + 1
        if (dados.sem_avanco >= tol) return devolver()
        const resposta = paragrafos(r.leitura.resposta, 1500) || paragrafos(cfg.msg_confirmar, 2000)
        await guardar(resposta, 'confirmando', dados)
        return { responder: resposta, acao: 'confirmar', estado: 'confirmando', dados }
      }
    }
    // confirmou: começa
    dados.sem_avanco = 0
    nota = '- Ela acabou de confirmar que quer criar a conta: agradeça em poucas palavras e faça direto a pergunta do passo atual.'
  }

  // 2. a conversa (coletando / enviado)
  const inicio = !conversa                               // a primeira mensagem, vinda pelo botão: a saudação vai antes
  if (inicio) nota = '- É a primeira mensagem dela (veio pelo botão do site). NÃO cumprimente nem se apresente: a saudação já vai antes da sua resposta. Faça direto a pergunta do passo atual, curta.'
  const emojiSo = !p && SIM_EMOJI.test(texto)
  if (!p && !emojiSo) {
    const resposta = 'Só consigo ler texto por aqui 😅 Me escreve?'
    await guardar(resposta, estadoAntes === 'enviado' ? 'enviado' : 'coletando', dados)
    return { responder: resposta, acao: 'sem_texto', estado: estadoAntes, dados }
  }
  let passo = dados.passo && passos.includes(dados.passo) ? dados.passo : avancar(dados, passos)
  let resposta: string | null = null                    // uma resposta determinística dispensa a IA

  const tratarCnpj = async (d14: string): Promise<string> => {
    if (!validarCnpj(d14)) { dados.erros_cnpj = Number(dados.erros_cnpj ?? 0) + 1; return preencher(cfg.msg_cnpj_invalido, { motivo: 'o dígito verificador não bate (parece mal digitado)' }) }
    let c = await deps.consultarCnpj(d14)
    if (!c.ok && c.motivo === 'indisponivel') c = await deps.consultarCnpj(d14)
    if (!c.ok) {
      if (c.motivo === 'indisponivel') { dados.erros_consulta = Number(dados.erros_consulta ?? 0) + 1; return CONSULTA_FORA }
      dados.erros_cnpj = Number(dados.erros_cnpj ?? 0) + 1
      return preencher(cfg.msg_cnpj_invalido, { motivo: 'não encontrei esse CNPJ na Receita' })
    }
    if (!c.ativo) { dados.erros_cnpj = Number(dados.erros_cnpj ?? 0) + 1; return preencher(cfg.msg_cnpj_invalido, { motivo: `a situação dele na Receita é ${c.situacao}, e só CNPJ ativo entra` }) }
    dados.cnpj = d14; dados.sem_cnpj = false; delete dados.cpf
    dados.razao_social = c.razao_social || undefined; dados.nome_fantasia = c.nome_fantasia || undefined
    dados.endereco_cnpj = c.endereco; dados.confirmando_endereco = true; delete dados.endereco
    dados.erros_cnpj = 0; dados.erros_consulta = 0; dados.erros = 0
    return preencher(cfg.msg_endereco_confirmar, { endereco: enderecoTexto(c.endereco) })
  }
  const tratarCpf = (d11: string): string | null => {
    if (!validarCpf(d11)) { dados.erros = Number(dados.erros ?? 0) + 1; return paragrafos(cfg.msg_cpf_invalido, 2000) }
    dados.cpf = d11; dados.sem_cnpj = true; delete dados.cnpj; dados.erros = 0
    return null
  }
  const tratarEmail = (m: string): string | null => {
    if (!EMAIL.test(m)) { dados.erros = Number(dados.erros ?? 0) + 1; return paragrafos(cfg.msg_email_invalido, 2000) }
    dados.email = m.toLowerCase(); dados.erros = 0
    return null
  }

  const antesDet = JSON.stringify(dados)   // o que o sistema decidir sozinho abaixo "consome" a mensagem: a IA então só pergunta, não relê
  // 2a. depois do link: dúvidas (poucas) e o reenvio
  if (estadoAntes === 'enviado') {
    const posLink = Number(dados.pos_link ?? 0)
    if (REENVIAR.test(p)) {
      const token = String(await chamar(deps, 'guia_onboarding_gerar_link', { id_: conversa!.id }))
      const link = linkDoCadastro(token)
      resposta = preencher(cfg.msg_link, { link, nome: dados.nome || dados.nome_fantasia || dados.razao_social || 'seu negócio', dias: String(cfg.link_dias ?? 7) })
      await guardar(resposta, 'enviado', { ...dados, pos_link: posLink + 1 })
      return { responder: resposta, acao: 'link_reenviado', estado: 'enviado', passo: 'link', dados, link }
    }
    if (posLink >= 6) {
      if (posLink > 6) return { responder: null, acao: 'pos_link', estado: 'enviado' }
      resposta = 'Seu link está aí em cima 💗 Quando terminar o cadastro, a gente se vê no painel!'
      await guardar(resposta, 'enviado', { ...dados, pos_link: posLink + 1 })
      return { responder: resposta, acao: 'pos_link', estado: 'enviado', dados }
    }
    dados.pos_link = posLink + 1
    passo = 'link'
  } else if (!inicio) {
    // 2b. o que se decide sem IA, no passo atual
    const digitos = so(texto)
    const soNumero = /^[\d.\-\/\s]+$/.test(texto)
    if (passo === 'documento') {
      if (NAO_TENHO.test(p) && !digitos) { dados.sem_cnpj = true; delete dados.cnpj; delete dados.cpf }
      else if (soNumero && digitos.length === 14 && !dados.sem_cnpj) resposta = await tratarCnpj(digitos)
      else if (soNumero && digitos.length === 11) resposta = tratarCpf(digitos)
      else if (soNumero && digitos.length >= 8) {
        if (dados.sem_cnpj) { dados.erros = Number(dados.erros ?? 0) + 1; resposta = paragrafos(cfg.msg_cpf_invalido, 2000) }
        else { dados.erros_cnpj = Number(dados.erros_cnpj ?? 0) + 1; resposta = preencher(cfg.msg_cnpj_invalido, { motivo: 'um CNPJ tem 14 números' }) }
      }
    } else if (passo === 'endereco' && dados.confirmando_endereco) {
      if (SIM_CURTO.test(p) || emojiSo) { dados.endereco = dados.endereco_cnpj; dados.confirmando_endereco = false }
      else if (NAO_CURTO.test(p)) { dados.confirmando_endereco = false; delete dados.endereco }
    } else if (passo === 'email') {
      const m = texto.match(/[^\s@<>()]+@[^\s@<>()]+/)
      if (m) resposta = tratarEmail(m[0].replace(/[.,;!?]+$/, ''))
    } else if (passo === 'profissionais') {
      const n = Number((p.match(/\b(\d{1,3})\b/) ?? [])[1])
      if (n > 0 && n <= 300) dados.profissionais = n
      else if (/\b(so eu|sozinha|sozinho|eu mesma|eu mesmo|uma|um|apenas eu)\b/.test(p)) dados.profissionais = 1
    } else if (passo === 'tipo') {
      if (AUTONOMA.test(p) && !SALAO.test(p)) dados.tipo = 'autonoma'
      else if (SALAO.test(p) && !AUTONOMA.test(p)) dados.tipo = 'salao'
    } else if (passo === 'explicacoes' && dados.explicou) {
      if (SIM_CURTO.test(p) || NAO_CURTO.test(p) || emojiSo || /\b(sem duvida|nenhuma duvida|tudo certo|entendi|pode mandar|manda o link|pode enviar|ta otimo|perfeito|show)\b/.test(p)) dados.explicacoes_ok = true
    }
  }

  // a mensagem foi lida pelo sistema (um dado entrou, um erro contou, um "sim" confirmou): a IA não extrai nada dela —
  // só agradece e faz a pergunta do passo seguinte (senão "sim" vira nome de salão, "somos 4" vira serviço)
  const consumida = JSON.stringify(dados) !== antesDet
  if (consumida && !resposta) nota = `${nota ? `${nota}\n` : ''}- O que ela acabou de escrever o sistema já anotou (${NOME_PASSO[passo] ?? passo}). NÃO extraia dado nenhum desta mensagem: agradeça em poucas palavras e faça a pergunta do passo atual.`

  // a tolerância: na N-ª resposta inválida seguida (N = tolerancia; o CNPJ tem a dele) encerra, com aviso à equipe; a
  // consulta fora do ar duas vezes também. Os contadores zeram quando uma resposta válida entra.
  const estourou = () => Number(dados.erros ?? 0) >= tol ? 'tolerancia' : Number(dados.erros_cnpj ?? 0) >= tolCnpj ? 'cnpj' : Number(dados.erros_consulta ?? 0) >= 2 ? 'consulta' : null
  let motivoFim = estourou()
  if (motivoFim) return encerrar(motivoFim, resposta)
  if (resposta) {
    passo = avancar(dados, passos)
    if (passo !== 'link') {
      await guardar(resposta, 'coletando', { ...dados, passo })
      return { responder: resposta, acao: 'validacao', estado: 'coletando', passo, dados }
    }
  }

  // 3. o link: tudo coletado → o token, a validade e a mensagem; a equipe fica sabendo (lead quente)
  passo = avancar(dados, passos)
  const mandarLink = async (prefixo: string | null): Promise<Saida> => {
    const token = String(await chamar(deps, 'guia_onboarding_gerar_link', { id_: conversa!.id }))
    const link = linkDoCadastro(token)
    const msg = preencher(cfg.msg_link, { link, nome: dados.nome || dados.nome_fantasia || dados.razao_social || 'seu negócio', dias: String(cfg.link_dias ?? 7) })
    const resposta = prefixo ? `${prefixo}\n\n${msg}` : msg
    const d = { ...dados, passo: 'link', link_enviado: true, pos_link: 0 }
    await guardar(resposta, 'enviado', d)
    const aviso = avisoEquipe('link', d, tel, String(cfg.link_dias ?? 7))
    await avisar(aviso)
    return { responder: resposta, acao: 'link', estado: 'enviado', passo: 'link', dados: d, link, previaAviso: teste ? aviso : null }
  }
  if (passo === 'link' && estadoAntes !== 'enviado') return mandarLink(null)

  // 4. a IA conversa: lê o texto livre, agradece e pergunta o próximo passo (ou explica, ou tira a dúvida)
  const proximo = passo === 'link' ? null : passos[passos.indexOf(passo) + 1] ?? null
  const r = await deps.ia({ provedor: cfg.provedor, modelo: cfg.modelo || MODELO_PADRAO[cfg.provedor] || MODELO_PADRAO.groq, sistema: sistema(cfg, dados, passo, proximo, nota, e.nomePerfil, agora), mensagens: historico(conversa, texto) })
  if (!r.leitura) {
    const resposta = 'Desculpa, me enrolei aqui. Pode me mandar de novo?'
    await guardar(resposta, estadoAntes === 'enviado' ? 'enviado' : 'coletando', { ...dados, passo })
    return { responder: resposta, acao: 'erro_ia', erro: r.erro, estado: estadoAntes, passo, dados }
  }
  const lido = r.leitura
  if (lido.quer_apagar_dados && !teste) {
    await chamar(deps, 'guia_onboarding_apagar', { tel_: tel })
    return { responder: 'Pronto, apaguei seus dados e esta conversa aqui na MIMO. 💗 Se quiser criar sua conta depois, é só me chamar.', acao: 'apagou' }
  }
  // "não sou profissional" só vale antes de qualquer documento (depois disso é mais fácil a IA ter lido errado)
  if (lido.nao_e_profissional && !dados.cnpj && !dados.cpf && estadoAntes !== 'enviado') return devolver()

  // o que a IA leu, só no que faz sentido agora (nada de preencher o passo 8 na pergunta do passo 2) — e nada quando o
  // sistema já consumiu a mensagem (aí a IA só perguntou)
  const antes = JSON.stringify(dados)
  const t = (v: string) => limpo(v, 200)
  const curtoDemais = (v: string) => SIM_CURTO.test(palavra(v)) || NAO_CURTO.test(palavra(v)) || palavra(v).length < 2   // "sim" não é nome de salão
  if (!consumida) {
    if (t(lido.tipo)) dados.tipo = /auton/i.test(lido.tipo) ? 'autonoma' : /sal/i.test(lido.tipo) ? 'salao' : dados.tipo
    if (passo === 'documento') {
      if (lido.sem_cnpj && !dados.cnpj) { dados.sem_cnpj = true; delete dados.cnpj }
      const c = so(lido.cnpj), f = so(lido.cpf)
      if (c.length === 14 && !dados.cnpj && !resposta) resposta = await tratarCnpj(c)
      else if (f.length === 11 && !dados.cpf && !resposta) resposta = tratarCpf(f)
    }
    if (passo === 'endereco' && !resposta) {
      if (dados.confirmando_endereco && lido.passo_concluido && !t(lido.endereco)) { dados.endereco = dados.endereco_cnpj; dados.confirmando_endereco = false }
      else if (t(lido.endereco) && !curtoDemais(lido.endereco)) { dados.endereco = { texto: t(lido.endereco), cidade: t(lido.cidade) || dados.endereco_cnpj?.cidade || undefined }; dados.confirmando_endereco = false }
    }
    if (t(lido.nome) && !curtoDemais(lido.nome) && (passo === 'nome' || !dados.nome)) dados.nome = t(lido.nome).slice(0, 80)
    if (passo === 'profissionais' || !dados.profissionais) { const n = Number((lido.profissionais.match(/\d{1,3}/) ?? [])[0]); if (n > 0 && n <= 300) dados.profissionais = n }
    if (t(lido.servicos) && (passo === 'servicos' || !dados.servicos?.length)) dados.servicos = lido.servicos.split(/[,;\n]| e /).map((s) => limpo(s, 60)).filter(Boolean).slice(0, 12)
    if (t(lido.horarios) && (passo === 'horarios' || !dados.horarios)) dados.horarios = limpo(lido.horarios, 200)
    if (t(lido.email) && passo === 'email' && !dados.email && !resposta) resposta = tratarEmail(t(lido.email).replace(/[.,;!?]+$/, ''))
    if (passo === 'explicacoes' && dados.explicou && lido.passo_concluido) dados.explicacoes_ok = true
  }
  if (passo === 'explicacoes') dados.explicou = true   // esta resposta da IA é a explicação (ou a volta a ela)

  // de novo a tolerância (o que a IA leu pode ter sido inválido) e as respostas determinísticas
  motivoFim = estourou()
  if (motivoFim) return encerrar(motivoFim, resposta)
  const mudou = JSON.stringify(dados) !== antes
  const passoDepois = estadoAntes === 'enviado' ? 'link' : avancar(dados, passos)
  if (resposta) {
    await guardar(resposta, 'coletando', { ...dados, passo: passoDepois === 'link' ? passo : passoDepois })
    return { responder: resposta, acao: 'validacao', estado: 'coletando', passo: passoDepois === 'link' ? passo : passoDepois, dados }
  }
  if (passoDepois === 'link' && estadoAntes !== 'enviado') {
    // o último dado veio nesta mensagem: o agradecimento da IA e, junto, o link
    const agradece = paragrafos(lido.resposta, 300)
    return mandarLink(agradece && !/\?/.test(agradece) ? agradece : null)
  }

  // sem andar: a conversa não avança há várias mensagens (ela só conversa, ou a IA não entende) → encerra com carinho
  if (!mudou && !consumida && passo === passoDepois && estadoAntes !== 'enviado' && !inicio && !nota) {
    dados.sem_avanco = Number(dados.sem_avanco ?? 0) + 1
    if (dados.sem_avanco >= tol + 3) return encerrar('sem_avanco')
  } else dados.sem_avanco = 0

  let fala = paragrafos(lido.resposta, 1800) || 'Me conta mais um pouquinho?'
  if (inicio) fala = `${paragrafos(cfg.msg_boas_vindas, 2000)}\n\n${fala}`
  const estado = estadoAntes === 'enviado' ? 'enviado' : 'coletando'
  await guardar(fala, estado, { ...dados, passo: passoDepois })
  return { responder: fala, acao: 'conversa', estado, passo: passoDepois, dados }
}

function historico(conversa: Conversa | null, texto: string): Mensagem[] {
  const h: Mensagem[] = (conversa?.mensagens ?? []).slice(-12).map((m) => ({ role: m.q === 'cliente' ? 'user' as const : 'assistant' as const, content: String(m.t ?? '').slice(0, 600) }))
  h.push({ role: 'user', content: texto })
  return h
}

// os avisos internos à equipe (vão para numero_avisos da Mel, nunca para a profissional)
export function avisoEquipe(tipo: 'link' | 'encerrou', d: Dados, tel: string, extra: string): string {
  const nome = d.nome || d.nome_fantasia || d.razao_social || 'sem nome ainda'
  const quem = `${nome}${d.tipo ? ` (${d.tipo === 'autonoma' ? 'autônoma' : 'salão'})` : ''}${d.endereco?.cidade || d.endereco_cnpj?.cidade ? ` · ${d.endereco?.cidade ?? d.endereco_cnpj?.cidade}` : ''}`
  const doc = d.cnpj ? `CNPJ ${cnpjBonito(d.cnpj)}` : d.cpf ? 'CPF anotado' : 'sem documento ainda'
  if (tipo === 'link') {
    return ['🎉 MIMO — novo cadastro pelo WhatsApp', quem, `${doc}${d.profissionais ? ` · ${d.profissionais} profissional(is)` : ''}${d.email ? ` · ${d.email}` : ''}`,
      `Número: ${telefoneBonito(tel)}`, `O link para criar a senha foi enviado (vale ${extra} dias).`].join('\n')
  }
  const motivo: Record<string, string> = { tolerancia: 'muitas respostas inválidas', cnpj: 'CNPJ inválido/inativo repetidas vezes', consulta: 'a consulta da Receita ficou fora do ar', sem_avanco: 'a conversa não andou' }
  return ['⚠️ MIMO — onboarding encerrado', quem, `Motivo: ${motivo[extra] ?? extra}. Parou no passo: ${NOME_PASSO[d.passo ?? ''] ?? d.passo ?? 'início'}.`, doc,
    `Número: ${telefoneBonito(tel)} — vale um humano chamar.`].join('\n')
}
