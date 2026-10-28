// O agente de onboarding da MIMO pelo WhatsApp (3.55, migração 203; 3.56, migração 204; 3.61, migração 208).
//
// É um SEGUNDO agente no mesmo número da Mel do guia, separado dela: persona, contexto, passos e configuração próprios
// (guia_onboarding_config, a aba Onboarding da Plataforma). Enquanto a Mel-cliente anota um pedido e passa ao salão, este
// atende a PROFISSIONAL (dona de salão ou autônoma) que quer criar a conta dela na MIMO Agenda — e faz o cadastro
// conversando: tipo → CNPJ (consultado: só ATIVO passa; "não tenho" → CPF) → a FICHA da empresa (nome fantasia, razão
// social, CNPJ, endereço; ela confirma ou corrige campo a campo) ou o endereço pelo CEP (sem CEP, pela rua: o sistema
// procura e lista alternativas; depois número e complemento; confirmado de volta) → nome (confirmado) → nº de
// profissionais (só salão; confirmado) → serviços (com exemplos; confirmado) → horários (confirmado) → e-mail (confirmado)
// → o WhatsApp do salão (o de onde ela fala, ou outro; e um extra) → explicações (link próprio, QR code, lembretes) → o
// RESUMO para ela conferir → "um minutinho, criando…" (espera configurável) → o LINK ("cadastro criado, crie a senha")
// → o convite ao suporte. A qualquer momento, *ajuda* avisa a equipe e um humano assume (3.61).
// Senha NUNCA pelo WhatsApp: no fim vai um link seguro (mimo.com.vc/comecar?c=<token>) que abre o /comecar já
// pré-preenchido; na tela ela só cria a senha, aceita os termos e escolhe o plano.
//
// Como a mensagem chega aqui: o webhook chama atenderOnboarding ANTES da Mel-cliente. Se não há conversa de onboarding
// aberta deste número e a mensagem não traz um gatilho (config.gatilhos), volta { acao: 'passa' } e a Mel atende como
// sempre. O 1º gatilho é a frase do botão das landings (origem "cta": intenção certa, começa direto); os demais são
// intenção percebida (origem "intencao"): o agente PRIMEIRO pergunta se ela quer mesmo criar a conta — quem é cliente diz
// que não e é devolvida à Mel, sem ser arrastada para o fluxo errado.
// 3.76: com o WhatsApp comercial ligado (218) e o encaminhamento da Mel ligado (221), um gatilho sem conversa aberta volta { acao: 'comercial' }: o webhook passa
// a mensagem à Mel com opcoes.sobreAgenda e ela responde com o link da assistente comercial. O agente fica para quando o
// comercial está desligado (e para as conversas de onboarding que já estavam abertas, que seguem até o fim).
//
// Contexto (3.56): antes de aceitar, o agente confere o que já existe na MIMO (guia_onboarding_conferir) — o número que
// escreve já tem conta (→ manda para o número de atendimento, numero_atendimento), o nome do salão já existe (o endereço
// nome.mimo.com.vc é único), o e-mail, o CPF ou o CNPJ já estão cadastrados.
//
// O que é determinístico (não passa pela IA): os gatilhos, o sim/não da confirmação, a validação do dígito de CPF e CNPJ,
// a consulta do CNPJ e a do CEP (deps consultarCnpj/consultarCep: BrasilAPI de verdade no webhook e no simulador; de
// mentira nos testes), o e-mail (e a confirmação dele), o "sim" do endereço, o WhatsApp do salão, o resumo, a tolerância a
// erro (encerra e avisa a equipe) e o link. A IA entra para conversar: ler o que ela escreveu em texto livre, agradecer e
// fazer a pergunta do passo seguinte, explicar — guiada pela orientação e pelos textos de cada passo que a Plataforma edita.
// A resposta volta inteira (responder) e em bolhas (uma por parágrafo, se a Plataforma quiser), com a pausa configurada.
//
// Como a Mel, este arquivo não fala com a rede nem com o banco por conta própria: tudo vem em `Deps`.

import { so, palavra, telefoneBonito, preencher, comercialLigado, RAIZ_SITE, MODELO_PADRAO } from './guia_whats.ts'
import { iaJsonDe, type Ambiente, type Fetch, type Mensagem } from './ia_json.ts'

export type Resultado = { ok: true; providerId: string | null } | { ok: false; erro: string }
export type Endereco = { logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; uf?: string; cep?: string; texto?: string; trecho?: string }
export type ConsultaCnpj =
  | { ok: true; ativo: boolean; situacao: string; razao_social: string; nome_fantasia: string | null; endereco: Endereco }
  | { ok: false; motivo: 'nao_encontrado' | 'indisponivel'; erro?: string }
export type ConsultaCep =
  | { ok: true; endereco: Endereco }
  | { ok: false; motivo: 'nao_encontrado' | 'indisponivel'; erro?: string }
// 3.61: a rua pelo nome (ViaCEP): as ruas que batem na cidade, uma por CEP
export type ConsultaRua =
  | { ok: true; opcoes: Endereco[] }
  | { ok: false; motivo: 'nao_encontrado' | 'indisponivel'; erro?: string }
export type Conferido = {
  numero?: { em_uso: boolean; salao?: string | null; cidade?: string | null }
  email?: { em_uso: boolean }
  documento?: { em_uso: boolean; tipo?: string | null; salao?: string | null }
  nome?: { em_uso: boolean; nome?: string | null; cidade?: string | null }
}
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
  consultarCep?: (cep: string) => Promise<ConsultaCep>
  consultarRua?: (uf: string, cidade: string, rua: string) => Promise<ConsultaRua>
  agora?: () => Date
}
export type Origem = 'cta' | 'intencao' | 'dona' | 'teste'
export type Entrada = { telefone: string; texto: string; nomePerfil?: string | null }
export type Dados = {
  passo?: string; tipo?: string; cnpj?: string; cpf?: string; sem_cnpj?: boolean; razao_social?: string; nome_fantasia?: string
  nome?: string; endereco?: Endereco; endereco_cnpj?: Endereco; confirmando_endereco?: boolean
  endereco_cep?: Endereco; pedindo_cep?: boolean; pedindo_numero?: boolean; sem_cep?: boolean
  profissionais?: number; servicos?: string[]; horarios?: string; email?: string; confirmando_email?: boolean
  telefone_salao?: string; telefone_extra?: string; perguntou_telefone?: boolean; perguntou_extra?: boolean; telefones_ok?: boolean
  explicou?: boolean; explicacoes_ok?: boolean; resumo_mostrado?: boolean; resumo_ok?: boolean
  erros?: number; erros_cnpj?: number; erros_consulta?: number; sem_avanco?: number; pos_link?: number; link_enviado?: boolean
  nao_e_profissional?: boolean; encerrada_por?: string; atendido?: boolean
  // 3.61: a ficha da empresa e as correções; a rua pelo nome; o complemento; a confirmação de cada dado; a ajuda
  confirmando_empresa?: boolean; empresa_qual?: boolean; corrigindo?: 'nome_fantasia' | 'razao_social' | 'endereco' | null
  pedindo_rua?: boolean; opcoes_rua?: Endereco[]; erros_rua?: number; rua_base?: { cidade?: string; uf?: string }
  pedindo_complemento?: boolean; confirmando_endereco_ok?: boolean
  perguntado?: string[]; confirmando?: { campo: string; valor: string } | null; nome_recusado?: boolean
  ajudas?: number; pediu_ajuda_em?: string
}
export type Saida = { responder: string | null; acao: string; estado?: string; passo?: string; dados?: Dados; link?: string | null; previaAviso?: string | null; erro?: string; bolhas?: string[]; pausa?: number; pausas?: number[] }
type Conversa = { id: number; telefone: string; origem: string; estado: string; dados: Dados; mensagens: Array<{ q: string; t: string; em?: string }>; token?: string }
type Mel = { ligado: boolean; numero: string | null; instancia: string; numero_avisos: string | null; sobre_agenda?: boolean | null }
export type Config = {
  ligado: boolean; provedor: string; modelo: string | null; orientacao: string; gatilhos: string[]
  tolerancia: number; tolerancia_cnpj: number; link_dias: number
  com_servicos: boolean; com_horarios: boolean; com_email: boolean; com_explicacoes: boolean
  passo_tipo: string; passo_documento: string; passo_endereco: string; passo_nome: string; passo_profissionais: string
  passo_servicos: string; passo_horarios: string; passo_email: string; passo_explicacoes: string
  msg_confirmar: string; msg_boas_vindas: string; msg_nao_sou: string; msg_cnpj_invalido: string; msg_cpf_invalido: string
  msg_email_invalido: string; msg_endereco_confirmar: string; msg_link: string; msg_encerrar: string
  // 3.56 (migração 204): contexto, CEP, pausa, confirmações — podem faltar num banco sem a 204 (há padrão para tudo)
  numero_atendimento?: string | null; pausa_seg?: number | null; bolhas?: boolean | null; com_telefone?: boolean | null; com_resumo?: boolean | null
  passo_telefone?: string | null; passo_resumo?: string | null
  msg_numero_em_uso?: string | null; msg_nome_em_uso?: string | null; msg_email_em_uso?: string | null; msg_documento_em_uso?: string | null
  msg_email_confirmar?: string | null; msg_cep?: string | null; msg_cep_invalido?: string | null; msg_cep_numero?: string | null
  msg_telefone?: string | null; msg_telefone_extra?: string | null; msg_telefone_invalido?: string | null; msg_resumo?: string | null
  // 3.61 (migração 208): a ficha, a rua, o complemento, as perguntas do sistema com confirmação, a ajuda, o criando e o fim
  criar_espera_seg?: number | null; servicos_exemplos?: string | null
  msg_empresa_confirmar?: string | null; msg_empresa_qual?: string | null; msg_empresa_cnpj?: string | null; msg_empresa_nome?: string | null; msg_empresa_razao?: string | null
  msg_rua?: string | null; msg_rua_opcoes?: string | null; msg_rua_nao_achei?: string | null; msg_complemento?: string | null; msg_endereco_ok?: string | null
  msg_nome?: string | null; msg_nome_confirmar?: string | null; msg_profissionais?: string | null; msg_servicos?: string | null; msg_horarios?: string | null; msg_dado_confirmar?: string | null
  msg_ajuda_dica?: string | null; msg_ajuda?: string | null; msg_criando?: string | null; msg_final?: string | null
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
export const cpfBonito = (d: string) => d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d
// um telefone brasileiro como ela escreve ("13 99999-0000", "(13) 99999 0000", "+55 13…"): os dígitos com o 55 na frente, ou null
export function telefoneDe(bruto: string): string | null {
  const d = so(bruto).replace(/^0+/, '')
  if (d.length === 10 || d.length === 11) return `55${d}`
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d
  return null
}
export function enderecoTexto(e: Endereco | null | undefined): string {
  if (!e) return ''
  if (e.texto && !e.logradouro) return [e.texto, e.cidade && !new RegExp(e.cidade.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(e.texto) ? e.cidade : ''].filter(Boolean).join(', ')
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

// ---- os padrões da 3.61 (migração 208): um banco sem a 208 segue com estes textos ----------------------------------------
export const PADRAO = {
  criar_espera_seg: 20,
  servicos_exemplos: 'corte, escova, coloração, manicure, pedicure, unhas em gel, design de sobrancelhas, depilação, limpeza de pele, extensão de cílios, maquiagem',
  msg_empresa_confirmar: 'Achei na Receita! 📋 Confere os dados da sua empresa:\n\n{ficha}\n\nEstá tudo certo? Responde *sim* que eu sigo, ou me diz o que está errado: *nome fantasia*, *razão social*, *CNPJ* ou *endereço*.',
  msg_empresa_qual: 'Sem problema! O que está errado? Responde *nome fantasia*, *razão social*, *CNPJ* ou *endereço* que eu corrijo com você.',
  msg_empresa_cnpj: 'Então me manda o CNPJ certo (só os números) que eu consulto de novo.',
  msg_empresa_nome: 'Qual é o nome fantasia certo?',
  msg_empresa_razao: 'Qual é a razão social certa, como está no cartão CNPJ?',
  msg_rua: 'Sem problema! Me manda o nome da rua e a cidade (ex.: Rua das Flores, Itanhaém) que eu procuro o CEP para você.',
  msg_rua_opcoes: 'Achei mais de uma 📍 Qual é a sua? Responde com o número:\n\n{opcoes}\n\nSe nenhuma for, responde *nenhuma* e me manda o endereço escrito.',
  msg_rua_nao_achei: 'Não achei essa rua em {cidade} 😕 Confere o nome e me manda de novo? Se for outra cidade, manda junto (ex.: Rua das Flores, Peruíbe). Ou me manda o endereço completo escrito (rua, número, bairro e cidade).',
  msg_complemento: 'Tem complemento (sala, loja, fundos, apartamento)? Me manda, ou responde *não*.',
  msg_endereco_ok: 'Ficou assim: 📍 {endereco}\n\nEstá certo? Responde *sim* ou me manda o CEP de novo.',
  msg_nome: 'Qual é o nome do negócio, do jeito que as clientes conhecem? É ele que vai no seu link (nome.mimo.com.vc).',
  msg_nome_confirmar: 'Para as clientes, o nome do negócio fica *{nome}*? Responde *sim* ou me manda o nome certo.',
  msg_profissionais: 'Quantas profissionais atendem aí, contando você? (Só o número; dá para mudar depois no painel.)',
  msg_servicos: 'Quais são os 3 a 5 serviços principais que você oferece? Os mais escolhidos por aqui: {exemplos}.\n\nA lista completa, com preço e duração, você ajusta depois no painel — assim como horários, fotos e o resto.',
  msg_horarios: 'Quais são os dias e horários de atendimento? (ex.: segunda a sexta 9h às 19h, sábado 9h às 14h). Depois dá para ajustar no painel.',
  msg_dado_confirmar: 'Anotei {rotulo}: *{valor}*. Está certo? Responde *sim* ou me manda o certo.',
  msg_ajuda_dica: 'Ah, e se a qualquer momento você quiser falar com uma pessoa da equipe, é só escrever *ajuda* 💗',
  msg_ajuda: 'Claro! Já avisei a equipe da MIMO: alguém vai te chamar por aqui 💗\nSe preferir chamar direto: {atendimento}\n\nEnquanto isso, se quiser, a gente continua o cadastro.',
  msg_criando: 'Perfeito! 💗 Me dá um minutinho que eu estou criando o seu cadastro… ⏳',
  msg_final: 'Ficou alguma dúvida? 💗\n\nTemos um suporte para te ajudar a começar a configurar a sua agenda — serviços, horários, fotos, tudo. É só chamar aqui que a gente te acompanha. Estamos à disposição!',
  msg_cep: 'Me manda o CEP de onde você atende (só os números) que eu puxo o endereço. Se não souber o CEP, responde *não sei* que a gente acha pelo nome da rua.',
  msg_cep_numero: 'Achei! 📍 {endereco}\n\nQual é o número (e o complemento, se tiver)?',
  msg_resumo: 'Pronto, anotei tudo! 💗 Confere se está certo:\n\n{resumo}\n\nEstá tudo certo? Responde *sim* ou me diz o que corrigir.',
}
// o texto da Plataforma, ou o padrão quando a coluna ainda não existe (ou está vazia)
export function cfgTexto(cfg: Config, k: keyof typeof PADRAO): string {
  const v = (cfg as unknown as Record<string, unknown>)[k]
  return typeof v === 'string' && v.trim() ? v : String(PADRAO[k])
}
const ROTULO: Record<string, string> = { nome: 'o nome do negócio', profissionais: 'o número de profissionais', servicos: 'os serviços', horarios: 'os horários' }

// ---- os passos ----------------------------------------------------------------------------------------------------
export const NOME_PASSO: Record<string, string> = {
  tipo: 'tipo de conta (autônoma ou salão)', documento: 'CNPJ (ou CPF, se ela não tem CNPJ)', endereco: 'endereço de atendimento',
  nome: 'nome do negócio', profissionais: 'quantas profissionais atendem', servicos: 'serviços principais', horarios: 'horários de atendimento',
  email: 'e-mail da conta', telefone: 'o WhatsApp do salão (e um telefone extra)', explicacoes: 'explicar (link próprio, QR code, lembretes) e tirar dúvidas',
  resumo: 'o resumo do cadastro, para ela conferir', link: 'mandar o link seguro',
}
// 3.61: autônoma não passa por "quantas profissionais" (é ela)
export function passosDe(cfg: Pick<Config, 'com_servicos' | 'com_horarios' | 'com_email' | 'com_explicacoes' | 'com_telefone' | 'com_resumo'>, d: Pick<Dados, 'tipo'> = {}): string[] {
  return ['tipo', 'documento', 'endereco', 'nome', ...(d.tipo === 'autonoma' ? [] : ['profissionais']),
    ...(cfg.com_servicos ? ['servicos'] : []), ...(cfg.com_horarios ? ['horarios'] : []), ...(cfg.com_email ? ['email'] : []),
    ...(cfg.com_telefone !== false ? ['telefone'] : []), ...(cfg.com_explicacoes ? ['explicacoes'] : []), ...(cfg.com_resumo !== false ? ['resumo'] : []), 'link']
}
export function passoFeito(d: Dados, passo: string): boolean {
  switch (passo) {
    case 'tipo': return !!d.tipo
    case 'documento': return !!d.cnpj || (!!d.sem_cnpj && !!d.cpf)
    case 'endereco': return !!d.endereco && !d.confirmando_empresa && !d.confirmando_endereco && !d.empresa_qual && !d.corrigindo && !d.pedindo_numero && !d.pedindo_complemento && !d.confirmando_endereco_ok
    case 'nome': return !!d.nome
    case 'profissionais': return d.tipo === 'autonoma' || Number(d.profissionais) > 0
    case 'servicos': return (d.servicos?.length ?? 0) > 0
    case 'horarios': return !!d.horarios
    case 'email': return !!d.email && !d.confirmando_email
    case 'telefone': return !!d.telefone_salao && !!d.telefones_ok
    case 'explicacoes': return !!d.explicacoes_ok
    case 'resumo': return !!d.resumo_ok
    default: return false
  }
}
// o primeiro passo ainda não feito (o link é o último e nunca "está feito")
export function avancar(d: Dados, passos: string[]): string {
  return passos.find((p) => !passoFeito(d, p)) ?? 'link'
}
// a ficha da empresa, como a Receita devolveu (3.61): ela confere e corrige campo a campo
export function montarFicha(d: Dados): string {
  return [
    `• Nome fantasia: ${d.nome_fantasia || '(não informado na Receita)'}`,
    `• Razão social: ${d.razao_social || '—'}`,
    `• CNPJ: ${d.cnpj ? cnpjBonito(d.cnpj) : '—'}`,
    `• Endereço: ${enderecoTexto(d.endereco_cnpj) || '—'}`,
  ].join('\n')
}
// o resumo do cadastro, como ela confere antes do link
export function montarResumo(d: Dados): string {
  const autonoma = d.tipo === 'autonoma'
  return [
    `• Tipo: ${autonoma ? 'autônoma' : d.tipo === 'salao' ? 'salão' : '—'}`,
    d.cnpj ? `• CNPJ: ${cnpjBonito(d.cnpj)}` : d.cpf ? `• CPF: ${cpfBonito(d.cpf)}` : null,
    d.cnpj && d.razao_social ? `• Razão social: ${d.razao_social}` : null,
    d.cnpj && d.nome_fantasia && d.nome_fantasia !== d.nome ? `• Nome fantasia (Receita): ${d.nome_fantasia}` : null,
    d.nome ? `• Nome para as clientes: ${d.nome}` : null,
    d.endereco ? `• Endereço: ${enderecoTexto(d.endereco)}` : null,
    !autonoma && Number(d.profissionais) > 0 ? `• Profissionais: ${d.profissionais}` : null,
    d.servicos?.length ? `• Serviços: ${d.servicos.join(', ')}` : null,
    d.horarios ? `• Horários: ${d.horarios}` : null,
    d.email ? `• E-mail: ${d.email}` : null,
    d.telefone_salao ? `• WhatsApp do salão: ${telefoneBonito(d.telefone_salao)}${d.telefone_extra ? ` · outro: ${telefoneBonito(d.telefone_extra)}` : ''}` : null,
  ].filter(Boolean).join('\n')
}
// a resposta em bolhas: um parágrafo por mensagem (a Plataforma pode desligar), com a pausa entre elas
export function dividir(texto: string, cfg: Pick<Config, 'bolhas'>): string[] {
  const t = String(texto ?? '').trim()
  if (!t) return []
  if (cfg.bolhas === false) return [t]
  return t.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean).slice(0, 8)
}
// as alternativas de rua, numeradas, para ela escolher
export function listarOpcoes(ops: Endereco[]): string {
  const cep = (c?: string) => (c && so(c).length === 8 ? `CEP ${so(c).slice(0, 5)}-${so(c).slice(5)}` : '')
  return ops.map((o, i) => `${i + 1}) ${[o.logradouro, o.bairro, o.trecho ? `(${o.trecho})` : '', cep(o.cep)].filter(Boolean).join(' · ')}`).join('\n')
}

// ---- o que a IA sabe a cada mensagem ---------------------------------------------------------------------------------
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
function agoraTexto(d: Date): string {
  const sp = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  return `${DIAS[sp.getDay()]}, ${sp.toLocaleDateString('pt-BR')} ${String(sp.getHours()).padStart(2, '0')}:${String(sp.getMinutes()).padStart(2, '0')}`
}
// os passos cuja pergunta é do sistema (não da IA): a IA só agradece e deixa a pergunta vir
function perguntaDoSistema(p: string | null, d: Dados): boolean {
  if (!p) return false
  if (['link', 'telefone', 'resumo', 'nome', 'profissionais', 'servicos', 'horarios'].includes(p)) return true
  if (p === 'endereco' && !d.sem_cep) return true
  return false
}
function enderecoEstado(d: Dados): string {
  if (d.confirmando_empresa || d.confirmando_endereco) return 'aguardando ela confirmar a ficha da empresa (o endereço do CNPJ)'
  if (d.empresa_qual) return 'ela disse que algo na ficha está errado; o sistema perguntou o quê'
  if (d.corrigindo === 'nome_fantasia') return 'corrigindo o nome fantasia (o sistema pediu o certo)'
  if (d.corrigindo === 'razao_social') return 'corrigindo a razão social (o sistema pediu a certa)'
  if (d.pedindo_cep) return 'aguardando o CEP'
  if (d.pedindo_rua) return d.opcoes_rua?.length ? 'o sistema listou as ruas achadas; aguardando ela escolher o número' : 'o sistema procura a rua pelo nome; aguardando a rua e a cidade'
  if (d.pedindo_numero) return `aguardando o número (${enderecoTexto(d.endereco_cep)})`
  if (d.pedindo_complemento) return `aguardando o complemento (${enderecoTexto(d.endereco)})`
  if (d.confirmando_endereco_ok) return `aguardando ela confirmar o endereço (${enderecoTexto(d.endereco)})`
  if (d.endereco) return enderecoTexto(d.endereco)
  return 'ainda não sei'
}
export function sistema(cfg: Config, d: Dados, passo: string, proximo: string | null, nota: string, nomePerfil: string | null | undefined, agora: Date, perguntaFeita: string | null = null): string {
  const guia = (p: string) => String((cfg as unknown as Record<string, unknown>)[`passo_${p}`] ?? '').trim()
  const oQueFazer = passo === 'confirmar'
    ? 'ela recebeu a pergunta se quer criar a conta na MIMO Agenda e respondeu algo que não é um sim nem um não claros. Descubra, com uma pergunta curta e gentil, se ela é profissional de beleza querendo criar a conta (passo_concluido = true quando ela confirmar que sim) ou se é cliente querendo marcar um horário (nao_e_profissional = true).'
    : passo === 'link'
      ? 'o link seguro já foi enviado. Só tire dúvidas, curto; se ela disser que não recebeu, que expirou ou que não abre, diga que vai mandar de novo (o sistema reenvia). Se ela quiser ajuda para configurar a agenda, diga que a equipe da MIMO acompanha por aqui, é só chamar.'
      : perguntaFeita
        ? `${guia(passo)} O sistema já fez a pergunta deste passo («${perguntaFeita.replace(/\s+/g, ' ').slice(0, 300)}») e ela respondeu com uma dúvida: responda curto e termine repetindo a pergunta. NÃO anote dado nenhum.`
        : passo === 'documento' && d.sem_cnpj && !d.cpf
          ? 'ela não tem CNPJ: peça o CPF dela (só os números), explicando em uma frase que é para o pagamento da assinatura. Não peça mais nada agora.'
          : passo === 'endereco' && (d.confirmando_empresa || d.confirmando_endereco)
            ? `o sistema mostrou a ficha da empresa (nome fantasia, razão social, CNPJ e o endereço ${enderecoTexto(d.endereco_cnpj)}) e perguntou se está tudo certo. Se ela mandou outro endereço, anote em "endereco"; se disse que está certo, passo_concluido = true; se disse que algo está errado, responda curto que ela pode dizer o quê (nome fantasia, razão social, CNPJ ou endereço).`
            : passo === 'endereco' && (d.pedindo_cep || d.pedindo_numero || d.pedindo_rua || d.pedindo_complemento)
              ? `o sistema está pedindo ${d.pedindo_cep ? 'o CEP' : d.pedindo_rua ? 'o nome da rua e a cidade (ele procura o CEP)' : d.pedindo_numero ? 'o número do endereço' : 'o complemento'} (ele mesmo valida). Se ela escrever o endereço inteiro em texto, anote em "endereco"; se perguntar algo, responda curto e peça de novo ${d.pedindo_cep ? 'o CEP' : d.pedindo_rua ? 'a rua e a cidade' : d.pedindo_numero ? 'o número' : 'o complemento (ou "não")'}.`
              : passo === 'endereco' && d.confirmando_endereco_ok
                ? `o sistema mostrou o endereço (${enderecoTexto(d.endereco)}) e perguntou se está certo. Se ela confirmar, passo_concluido = true; se mandar outro, anote em "endereco".`
                : passo === 'email' && d.confirmando_email
                  ? `o sistema perguntou se o e-mail ${d.email} está certo. Se ela mandar outro e-mail, anote em "email"; se confirmar, passo_concluido = true.`
                  : passo === 'telefone'
                    ? `${guia('telefone') || 'o sistema pergunta se o WhatsApp do salão é o número de onde ela fala, ou outro.'} Se ela perguntar por que precisa ser o WhatsApp do salão, explique: a MIMO se conecta a ele para mandar confirmações e lembretes automáticos às clientes.`
                    : passo === 'resumo'
                      ? `${guia('resumo') || 'ela está conferindo o resumo do cadastro.'} O resumo atual:\n${montarResumo(d)}`
                      : passo === 'explicacoes'
                        ? `${guia('explicacoes')} Escreva a explicação inteira NESTA resposta (parágrafos curtos, numa mensagem só) e termine perguntando se ficou alguma dúvida.`
                        : guia(passo)
  const linhas: Array<string | null> = [
    String(cfg.orientacao),
    '',
    'ONDE A CONVERSA ESTÁ',
    `- Passo atual: ${NOME_PASSO[passo] ?? passo}. O que fazer: ${oQueFazer}`,
    proximo && passo !== 'confirmar' && passo !== 'link' && !perguntaFeita ? `- Se ela já respondeu o passo atual, agradeça em poucas palavras${perguntaDoSistema(proximo, d) ? ' e NÃO pergunte nada: o sistema faz a pergunta do próximo passo.' : ` e já faça a pergunta do próximo passo (${NOME_PASSO[proximo] ?? proximo}): ${guia(proximo)}`}` : null,
    nota || null,
    '- Tudo o que ela informa (serviços, horários, nome, fotos, preços) ela ajusta depois no painel; se ela perguntar, diga isso.',
    '- Se ela quiser falar com uma pessoa, diga que é só escrever *ajuda* que a equipe da MIMO chama.',
    `- Agora: ${agoraTexto(agora)} (horário de Brasília)`,
    '',
    'O QUE JÁ ANOTEI',
    `- Tipo: ${d.tipo === 'autonoma' ? 'autônoma' : d.tipo === 'salao' ? 'salão' : 'ainda não sei'}`,
    `- CNPJ: ${d.cnpj ? `${cnpjBonito(d.cnpj)} (ativo na Receita)` : d.sem_cnpj ? 'não tem' : 'ainda não sei'}`,
    d.cnpj ? `- Razão social: ${d.razao_social || '—'}; nome fantasia na Receita: ${d.nome_fantasia || '(não informado)'}` : null,
    `- CPF: ${d.cpf ? 'anotado e válido' : d.sem_cnpj ? 'ainda não sei' : 'não precisa (tem CNPJ)'}`,
    `- Nome do negócio para as clientes: ${d.nome || (d.nome_fantasia ? `ainda não confirmou (o CNPJ sugere "${d.nome_fantasia}")` : 'ainda não sei')}`,
    `- Endereço: ${enderecoEstado(d)}`,
    `- Profissionais: ${d.tipo === 'autonoma' ? '1 (autônoma: não perguntar)' : d.profissionais ? String(d.profissionais) : 'ainda não sei'}`,
    `- Serviços: ${d.servicos?.length ? d.servicos.join(', ') : 'ainda não sei'}`,
    `- Horários: ${d.horarios || 'ainda não sei'}`,
    `- E-mail: ${d.email ? `${d.email}${d.confirmando_email ? ' (aguardando ela confirmar)' : ''}` : 'ainda não sei'}`,
    `- WhatsApp do salão: ${d.telefone_salao ? telefoneBonito(d.telefone_salao) + (d.telefone_extra ? ` (e outro: ${telefoneBonito(d.telefone_extra)})` : '') : 'ainda não sei'}`,
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

// ---- a consulta do CNPJ, a do CEP e a da rua (BrasilAPI e ViaCEP: grátis, sem chave; rodam no servidor) ------------------
// CNPJ: 200 → os dados (situação, razão social, nome fantasia, endereço); 404/400 → não existe; o resto → fora do ar (não
// é culpa do CNPJ dela: o motor tenta de novo e, se persistir, não aceita no escuro).
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
// CEP (v2): 200 → rua, bairro, cidade, UF; 404 → não existe; o resto → fora do ar
export function consultarCepDe(fetcher: Fetch): NonNullable<Deps['consultarCep']> {
  return async (cep) => {
    const d = so(cep)
    try {
      const r = await fetcher(`https://brasilapi.com.br/api/cep/v2/${d}`, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
      const cru = await r.text()
      if (r.status === 404 || r.status === 400) return { ok: false, motivo: 'nao_encontrado' }
      if (r.status < 200 || r.status >= 300) return { ok: false, motivo: 'indisponivel', erro: `BrasilAPI respondeu ${r.status}` }
      let j: Record<string, unknown>
      try { j = JSON.parse(cru) } catch { return { ok: false, motivo: 'indisponivel', erro: 'resposta inválida' } }
      const t = (k: string) => String(j[k] ?? '').trim()
      if (!t('city')) return { ok: false, motivo: 'nao_encontrado' }
      return { ok: true, endereco: { logradouro: t('street'), bairro: t('neighborhood'), cidade: t('city'), uf: t('state'), cep: so(j.cep) || d } }
    } catch (e) {
      return { ok: false, motivo: 'indisponivel', erro: String((e as Error)?.message ?? e).slice(0, 120) }
    }
  }
}
// 3.61: a rua pelo nome (ViaCEP: UF + cidade + trecho do logradouro, 3 letras ou mais) → as ruas que batem, uma por CEP
export function consultarRuaDe(fetcher: Fetch): NonNullable<Deps['consultarRua']> {
  return async (uf, cidade, rua) => {
    try {
      const url = `https://viacep.com.br/ws/${encodeURIComponent(uf)}/${encodeURIComponent(cidade)}/${encodeURIComponent(rua)}/json/`
      const r = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
      const cru = await r.text()
      if (r.status === 400 || r.status === 404) return { ok: true, opcoes: [] }
      if (r.status < 200 || r.status >= 300) return { ok: false, motivo: 'indisponivel', erro: `ViaCEP respondeu ${r.status}` }
      let j: unknown
      try { j = JSON.parse(cru) } catch { return { ok: false, motivo: 'indisponivel', erro: 'resposta inválida' } }
      if (!Array.isArray(j)) return { ok: true, opcoes: [] }
      const vistos = new Set<string>()
      const opcoes: Endereco[] = []
      for (const x of j as Array<Record<string, unknown>>) {
        const t = (k: string) => String(x[k] ?? '').trim()
        const cep = so(x.cep)
        if (!t('logradouro') || vistos.has(cep)) continue
        vistos.add(cep)
        opcoes.push({ logradouro: t('logradouro'), bairro: t('bairro'), cidade: t('localidade'), uf: t('uf'), cep, trecho: t('complemento') || undefined })
        if (opcoes.length >= 8) break
      }
      return { ok: true, opcoes }
    } catch (e) {
      return { ok: false, motivo: 'indisponivel', erro: String((e as Error)?.message ?? e).slice(0, 120) }
    }
  }
}

// ---- o atendimento ------------------------------------------------------------------------------------------------
const SIM_CURTO = /^(sim|s|ss|sim sim|sim quero|sim pode|sim e esse|sim esse|sim esse mesmo|sim e esse mesmo|sim esta certo|sim ta certo|sim tudo certo|ok|okay|okey|pode|pode ser|isso|isso mesmo|isso ai|claro|claro que sim|confirmo|confirmado|certo|certinho|ta certo|esta certo|beleza|bora|vamos|vai|yes|uhum|aham|correto|perfeito|otimo|top|show|fechado|combinado|quero|quero sim|e esse|e esse mesmo|esse mesmo|e isso|e isso mesmo|exato|exatamente|pode continuar|continua|proximo|seguinte|tudo certo|tudo certinho|tudo bem|entendi|ta bom|ta otimo|manda|pode mandar|manda o link|ta tudo certo|esta tudo certo|certo sim|isso sim)$/
const NAO_CURTO = /^(nao|n|nao quero|nao precisa|nao obrigada|nao obrigado|nao nao|cancela|cancelar|desisto|desisti|deixa|deixa pra la|esquece|esqueca|agora nao|depois|outra hora|nao e esse|nao e esse nao|errado|ta errado|esta errado|nao esta certo|nao ta certo|nao e isso)$/
const SO_ESSE = /^(nao|n|so esse|so este|so esse mesmo|so este mesmo|nenhum|nenhum outro|e so|e so esse|nao tem outro|nao tenho outro|nao precisa|nao obrigada|nao obrigado|nao quero|nao tem|sem complemento|nenhuma)$/
const SIM_EMOJI = /^(?:\s|👍|✅|👌|🙏|💗|❤|️|🥰|😊|[\u{1F3FB}-\u{1F3FF}])+$/u
const CLIENTE = /\b(sou cliente|quero marcar|marcar (um )?horario|agendar|sou so cliente|nao tenho salao|nao sou profissional|nao sou dona|quero um horario)\b/
const NAO_TENHO = /\b(nao tenho( cnpj)?|sem cnpj|nao possuo|nao tem cnpj|so (tenho )?cpf|tenho so cpf|e cpf|usa o cpf|pelo cpf|no cpf)\b/
const NAO_SEI = /\b(nao sei|nao lembro|nao tenho (o )?cep|sem cep|nao conheco|nao faco ideia|nao sei o cep)\b/
const APAGAR = /\b(apag|exclu|delet|remov)[a-z]*\b.*\b(dados|conversa|numero|informac|cadastro)/
const REENVIAR = /\b(nao recebi|nao chegou|manda (de novo|outra vez|o link)|reenvia|reenviar|expirou|venceu|nao abre|nao abriu|nao funciona|link de novo|outro link|me manda o link)\b/
const AUTONOMA = /\b(autonoma|autonomo|sozinha|sozinho|so eu|por conta|por minha conta|freelancer|em casa|a domicilio|domicilio|atendo em casa|eu mesma)\b/
const SALAO = /\b(salao|equipe|estudio|studio|clinica|espaco|barbearia|funcionari[ao]s?|minhas meninas|tenho (um |uma )?(salao|espaco|estudio|studio|clinica))\b/
// 3.61: "ajuda" a qualquer momento → a equipe chama (a conversa segue)
const AJUDA = /^(ajuda|socorro|atendente|humano|humana|suporte|quero ajuda|preciso de ajuda|me ajuda)$|\b(falar com (uma |um |o |a )?(pessoa|atendente|humano|humana|alguem|gente|equipe|suporte)|atendimento humano|quero (um |uma )?(atendente|humano|humana)|chama (alguem|uma pessoa|a equipe)|pedir ajuda)\b/
const ERRADO = /\b(errad|incorret|nao e ess|nao esta cert|nao ta cert|nao confere|trocad|nao e isso|nao esta|nao ta)/
const PERGUNTA = /^(o que|oq|o q|como|qual|quais|quanto|quanta|quantos|quantas|por que|pq|porque|pode|posso|tem como|voce|vc|vcs|e se|preciso|sera|isso e|precisa|da pra|da para|e obrigatorio|obrigatorio|o cnpj|cnpj e|mas)\b/
const CONSULTA_FORA = 'A consulta da Receita está fora do ar agora 😕 Me manda o CNPJ de novo daqui a alguns minutos que eu confiro, tá?'
const limpo = (t: unknown, n: number) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const paragrafos = (t: unknown, n: number) => String(t ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n)
const trocar = (modelo: unknown, valores: Record<string, string>) => Object.entries(valores).reduce((t, [k, v]) => t.replaceAll(`{${k}}`, v), String(modelo ?? ''))
const curtoDemais = (v: string) => SIM_CURTO.test(palavra(v)) || NAO_CURTO.test(palavra(v)) || palavra(v).length < 2   // "sim" não é nome de salão
const ehPergunta = (texto: string, p: string) => /\?\s*$/.test(texto) || PERGUNTA.test(p)
const pareceEndereco = (texto: string) => /\b(rua|r\.|av\.?|avenida|travessa|tv\.|alameda|al\.|estrada|rodovia|praca|praça|largo)\b/i.test(texto) && /\d/.test(texto)
const listaDe = (texto: string) => String(texto ?? '').split(/[,;\n]|\s+e\s+/).map((s) => limpo(s, 60).replace(/^(e|o|a|os|as|de)\s+/i, '')).filter(Boolean).slice(0, 12)
const EXTENSO: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 }
const numeroDe = (p: string): number => {
  const n = Number((p.match(/\b(\d{1,3})\b/) ?? [])[1])
  if (n > 0 && n <= 300) return n
  if (/\b(so eu|sozinha|sozinho|eu mesma|eu mesmo|apenas eu|somente eu)\b/.test(p)) return 1
  const ext = (p.match(/\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/) ?? [])[1]
  return ext ? EXTENSO[ext] : 0
}
// o campo da ficha que ela disse estar errado
const campoDaFicha = (p: string): 'cnpj' | 'razao_social' | 'endereco' | 'nome_fantasia' | null =>
  /\bcnpj\b/.test(p) ? 'cnpj' : /\b(razao|social)\b/.test(p) ? 'razao_social' : /\b(endereco|rua|numero|cep|bairro|cidade|complemento|avenida)\b/.test(p) ? 'endereco' : /\b(fantasia|nome)\b/.test(p) ? 'nome_fantasia' : null

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
  // 3.76: o gatilho de quem ainda não tem conversa aberta vai para o comercial, se ele está ligado e a Mel encaminha
  // (mel.sobre_agenda, da 221; sem ela, vale ligado) — mesmo com este agente desligado: os gatilhos dizem "quero a MIMO
  // Agenda". No simulador da aba Onboarding, o agente atende como sempre.
  if (!teste && !ctx?.conversa && ctx?.mel?.sobre_agenda !== false && gatilhoDe(texto, cfg.gatilhos) && (await comercialLigado(deps))) return { responder: null, acao: 'comercial' }
  if (!cfg.ligado && !teste) return { responder: null, acao: 'passa' }
  const mel: Mel = ctx?.mel ?? { ligado: false, numero: null, instancia: 'mimo-guia', numero_avisos: null }
  const p = palavra(texto)
  const em = agora.toISOString()
  let conversa: Conversa | null = ctx?.conversa ?? null
  const T = (k: keyof typeof PADRAO) => cfgTexto(cfg, k)
  // a resposta sai inteira e em bolhas (um parágrafo por mensagem), com a pausa da Plataforma
  const pausa = Math.max(0, Math.min(30, Number(cfg.pausa_seg ?? 2) || 0))
  const fim = (s: Saida): Saida => ({ ...s, bolhas: s.bolhas ?? (s.responder ? dividir(s.responder, cfg) : []), pausa })

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
  // o contexto: o que já existe na MIMO (num banco sem a 204, nada é conferido — o fluxo segue)
  const conferir = async (args: Record<string, unknown>): Promise<Conferido> => {
    try { return ((await chamar(deps, 'guia_onboarding_conferir', args)) as Conferido) ?? {} } catch { return {} }
  }
  const linkAtendimento = cfg.numero_atendimento ? `https://wa.me/${so(cfg.numero_atendimento)}` : ''
  const atendimento = () => linkAtendimento || 'a equipe da MIMO vai te chamar por aqui'
  const numeroDela = teste ? '5513999990000' : tel
  const avisar = async (texto: string) => {
    if (teste || !mel.numero_avisos) return
    try { await deps.enviar(mel.instancia, so(mel.numero_avisos), texto) } catch { /* o aviso é melhor-esforço */ }
  }

  // "apagar meus dados" (LGPD)
  if (!teste && APAGAR.test(p)) {
    await chamar(deps, 'guia_onboarding_apagar', { tel_: tel })
    return fim({ responder: 'Pronto, apaguei seus dados e esta conversa aqui na MIMO. 💗 Se quiser criar sua conta depois, é só me chamar.', acao: 'apagou' })
  }
  // 3.61: "ajuda" a qualquer momento da conversa → a equipe é avisada e um humano assume; a conversa não fecha
  if (conversa && AJUDA.test(p)) {
    const d: Dados = { ...(conversa.dados ?? {}), ajudas: Number(conversa.dados?.ajudas ?? 0) + 1, pediu_ajuda_em: em }
    const resposta = preencher(T('msg_ajuda'), { atendimento: linkAtendimento })
    await guardar(resposta, conversa.estado, d)
    const aviso = avisoEquipe('ajuda', d, tel, NOME_PASSO[d.passo ?? ''] ?? d.passo ?? 'início')
    await avisar(aviso)
    return fim({ responder: resposta, acao: 'ajuda', estado: conversa.estado, passo: d.passo, dados: d, previaAviso: teste ? aviso : null })
  }

  const estadoAntes = conversa?.estado ?? (origem === 'intencao' ? 'confirmando' : 'coletando')
  const dados: Dados = { ...(conversa?.dados ?? {}) }
  // uma conversa de antes da 3.61 esperando o "sim" do endereço do CNPJ: vira a ficha
  if (dados.confirmando_endereco) { dados.confirmando_empresa = true; delete dados.confirmando_endereco }
  let passos = passosDe(cfg, dados)
  const tol = Math.max(1, Number(cfg.tolerancia) || 3)
  const tolCnpj = Math.max(1, Number(cfg.tolerancia_cnpj) || 3)
  // encerrar com carinho e avisar a equipe: um humano retoma (tolerância estourada, consulta fora do ar, sem avançar, já
  // tem conta). Quando foi uma resposta inválida que estourou, ela ainda lê o motivo (prefixo) e só então a despedida.
  const encerrar = async (motivo: string, prefixo: string | null = null, semDespedida = false): Promise<Saida> => {
    const resposta = semDespedida ? String(prefixo ?? '') : `${prefixo ? `${prefixo}\n\n` : ''}${paragrafos(cfg.msg_encerrar, 2000)}`
    const d = { ...dados, encerrada_por: motivo }
    await guardar(resposta, 'encerrada', d)
    const aviso = avisoEquipe('encerrou', d, tel, motivo)
    await avisar(aviso)
    return fim({ responder: resposta, acao: `encerrou_${motivo}`, estado: 'encerrada', passo: d.passo, dados: d, previaAviso: teste ? aviso : null })
  }
  // devolver à Mel-cliente (ela não é profissional): a conversa de onboarding fecha; a próxima mensagem dela vai à Mel
  const devolver = async (): Promise<Saida> => {
    const resposta = paragrafos(cfg.msg_nao_sou, 2000)
    await guardar(resposta, 'encerrada', { ...dados, nao_e_profissional: true, encerrada_por: 'nao_e_profissional' })
    return fim({ responder: resposta, acao: 'nao_e_profissional', estado: 'encerrada' })
  }

  // 0. quem escreve já tem conta na MIMO (o número é de um perfil ou de um salão): não é onboarding, é atendimento
  if (!conversa && !teste) {
    const c = await conferir({ tel_: tel })
    if (c.numero?.em_uso) {
      const resposta = trocar(cfg.msg_numero_em_uso || 'Esse número já está cadastrado na MIMO{salao} 💗 Para entrar na sua conta ou recuperar o acesso, fale com o atendimento: {atendimento}', { salao: c.numero.salao ? ` (${c.numero.salao})` : '', atendimento: atendimento() })
      dados.passo = 'tipo'
      return encerrar('ja_tem_conta', resposta, true)
    }
  }

  // 1. confirmando a intenção (entrou por intenção percebida): a pergunta; depois sim → começa; não/cliente → devolve
  let nota = ''
  let confirmouAgora = false
  if (estadoAntes === 'confirmando') {
    if (!conversa) {
      const resposta = paragrafos(cfg.msg_confirmar, 2000)
      await guardar(resposta, 'confirmando', {})
      return fim({ responder: resposta, acao: 'confirmar', estado: 'confirmando', dados: {} })
    }
    if (NAO_CURTO.test(p) || CLIENTE.test(p)) return devolver()
    if (!SIM_CURTO.test(p) && !(!p && SIM_EMOJI.test(texto))) {
      // nem sim nem não: a IA decide (e re-pergunta, até a tolerância)
      const r = await deps.ia({ provedor: cfg.provedor, modelo: cfg.modelo || MODELO_PADRAO[cfg.provedor] || MODELO_PADRAO.groq, sistema: sistema(cfg, dados, 'confirmar', null, '', e.nomePerfil, agora), mensagens: historico(conversa, texto) })
      if (!r.leitura) {
        const resposta = 'Desculpa, me enrolei aqui 😅 Você quer criar sua conta na MIMO Agenda? Me responde *sim* ou *não*.'
        await guardar(resposta, 'confirmando', dados)
        return fim({ responder: resposta, acao: 'erro_ia', erro: r.erro, estado: 'confirmando', dados })
      }
      if (r.leitura.nao_e_profissional) return devolver()
      if (!r.leitura.passo_concluido) {
        dados.sem_avanco = Number(dados.sem_avanco ?? 0) + 1
        if (dados.sem_avanco >= tol) return devolver()
        const resposta = paragrafos(r.leitura.resposta, 1500) || paragrafos(cfg.msg_confirmar, 2000)
        await guardar(resposta, 'confirmando', dados)
        return fim({ responder: resposta, acao: 'confirmar', estado: 'confirmando', dados })
      }
    }
    // confirmou: começa
    dados.sem_avanco = 0
    confirmouAgora = true
    nota = '- Ela acabou de confirmar que quer criar a conta: agradeça em poucas palavras e faça direto a pergunta do passo atual.'
  }

  // 2. a conversa (coletando / enviado)
  const inicio = !conversa                               // a primeira mensagem, vinda pelo botão: a saudação vai antes
  if (inicio) nota = '- É a primeira mensagem dela (veio pelo botão do site). NÃO cumprimente nem se apresente: a saudação já vai antes da sua resposta. Faça direto a pergunta do passo atual, curta.'
  const emojiSo = !p && SIM_EMOJI.test(texto)
  const disseSim = SIM_CURTO.test(p) || emojiSo
  if (!p && !emojiSo) {
    const resposta = 'Só consigo ler texto por aqui 😅 Me escreve?'
    await guardar(resposta, estadoAntes === 'enviado' ? 'enviado' : 'coletando', dados)
    return fim({ responder: resposta, acao: 'sem_texto', estado: estadoAntes, dados })
  }
  let passo = dados.passo && passos.includes(dados.passo) ? dados.passo : avancar(dados, passos)
  let resposta: string | null = null                    // uma resposta determinística dispensa a IA
  let fimAgora: Saida | null = null                      // um desfecho determinístico (já tem conta) encerra antes da IA
  const pergunta = ehPergunta(texto, p)                  // ela perguntou algo: a IA responde e repete a pergunta do passo

  // as perguntas do sistema, por passo (3.61: nome, profissionais, serviços e horários também são do sistema)
  const perguntou = (pz: string) => (dados.perguntado ?? []).includes(pz)
  const marcar = (pz: string) => { dados.perguntado = [...new Set([...(dados.perguntado ?? []), pz])] }
  const desmarcar = (pz: string) => { dados.perguntado = (dados.perguntado ?? []).filter((x) => x !== pz) }
  const textoPergunta = (pz: string): string | null => {
    if (pz === 'nome') return dados.nome_fantasia && !dados.nome_recusado ? trocar(T('msg_nome_confirmar'), { nome: dados.nome_fantasia }) : T('msg_nome')
    if (pz === 'profissionais') return T('msg_profissionais')
    if (pz === 'servicos') return preencher(T('msg_servicos'), { exemplos: T('servicos_exemplos') })
    if (pz === 'horarios') return T('msg_horarios')
    if (pz === 'telefone') return !dados.telefone_salao ? trocar(cfg.msg_telefone || 'O WhatsApp do salão vai ser este número de onde você está falando, {numero}? Ele precisa ser o WhatsApp do salão, porque a MIMO se conecta a ele para mandar confirmações e lembretes. Responde *sim* ou me manda o número certo, com DDD.', { numero: telefoneBonito(numeroDela) }) : paragrafos(cfg.msg_telefone_extra || 'Quer cadastrar mais algum telefone (fixo ou outro WhatsApp)? Me manda o número com DDD, ou responde *não*.', 2000)
    if (pz === 'resumo') return trocar(cfg.msg_resumo || PADRAO.msg_resumo, { resumo: montarResumo(dados) })
    if (pz === 'endereco') {
      if (dados.confirmando_empresa) return trocar(T('msg_empresa_confirmar'), { ficha: montarFicha(dados) })
      if (dados.empresa_qual) return T('msg_empresa_qual')
      if (dados.corrigindo === 'nome_fantasia') return T('msg_empresa_nome')
      if (dados.corrigindo === 'razao_social') return T('msg_empresa_razao')
      if (dados.pedindo_rua) return dados.opcoes_rua?.length ? trocar(T('msg_rua_opcoes'), { opcoes: listarOpcoes(dados.opcoes_rua) }) : T('msg_rua')
      if (dados.pedindo_numero) return preencher(cfg.msg_cep_numero || PADRAO.msg_cep_numero, { endereco: enderecoTexto(dados.endereco_cep) })
      if (dados.pedindo_complemento) return T('msg_complemento')
      if (dados.confirmando_endereco_ok) return trocar(T('msg_endereco_ok'), { endereco: enderecoTexto(dados.endereco) })
      return paragrafos(cfg.msg_cep || PADRAO.msg_cep, 2000)
    }
    return null
  }
  // a pergunta do sistema ao entrar no passo (sem IA), uma vez por passo
  const perguntaDoPasso = (pz: string): string | null => {
    if (pz === 'endereco' && !dados.endereco && !dados.endereco_cnpj && !dados.pedindo_cep && !dados.pedindo_rua && !dados.pedindo_numero && !dados.pedindo_complemento && !dados.sem_cep && !dados.confirmando_endereco_ok && !dados.corrigindo) { dados.pedindo_cep = true; return textoPergunta('endereco') }
    if (pz === 'nome' && !dados.nome && !perguntou('nome')) { marcar('nome'); return textoPergunta('nome') }
    if (pz === 'profissionais' && !perguntou('profissionais')) { marcar('profissionais'); return textoPergunta('profissionais') }
    if (pz === 'servicos' && !perguntou('servicos')) { marcar('servicos'); return textoPergunta('servicos') }
    if (pz === 'horarios' && !perguntou('horarios')) { marcar('horarios'); return textoPergunta('horarios') }
    if (pz === 'telefone' && !dados.perguntou_telefone) { dados.perguntou_telefone = true; return textoPergunta('telefone') }
    if (pz === 'telefone' && dados.telefone_salao && !dados.telefones_ok && !dados.perguntou_extra) { dados.perguntou_extra = true; return textoPergunta('telefone') }
    if (pz === 'resumo' && !dados.resumo_mostrado) { dados.resumo_mostrado = true; return textoPergunta('resumo') }
    return null
  }
  // "Anotei X: Y. Está certo?" — cada dado é confirmado de volta antes de valer
  const confirmarDado = (campo: string, valor: string): string => { dados.confirmando = { campo, valor }; return trocar(T('msg_dado_confirmar'), { rotulo: ROTULO[campo] ?? campo, valor }) }
  const commit = async (campo: string, valor: string): Promise<string | null> => {
    if (campo === 'nome') {
      const ja = await conferir({ nome_: valor })
      if (ja.nome?.em_uso) { dados.nome_recusado = true; delete dados.nome; return trocar(cfg.msg_nome_em_uso || 'Já existe um salão chamado *{nome}* na MIMO{cidade}, e o endereço nome.mimo.com.vc precisa ser único. Quer usar outro nome, ou acrescentar o bairro ou a cidade?', { nome: valor, cidade: ja.nome.cidade ? ` (em ${ja.nome.cidade})` : '' }) }
      dados.nome = valor.slice(0, 80)
    } else if (campo === 'profissionais') dados.profissionais = Number(valor)
    else if (campo === 'servicos') dados.servicos = listaDe(valor)
    else if (campo === 'horarios') dados.horarios = limpo(valor, 200)
    dados.erros = 0
    return null
  }
  // o endereço: fechar (confirmar de volta), pedir o complemento, voltar à ficha, começar uma correção
  const fecharEndereco = (): string => { dados.confirmando_endereco_ok = true; return textoPergunta('endereco') ?? '' }
  const pedirComplemento = (): string => { dados.pedindo_complemento = true; return T('msg_complemento') }
  const voltarFicha = (): string => { dados.confirmando_empresa = true; delete dados.endereco; return textoPergunta('endereco') ?? '' }
  const enderecoLivre = (t: string): string => {
    const cidade = (t.match(/\bem\s+([A-Za-zÀ-ú ]{3,40})\s*$/) ?? [])[1]?.trim()
    dados.endereco = { texto: limpo(t, 160), cidade: cidade || dados.rua_base?.cidade || dados.endereco_cnpj?.cidade || undefined }
    delete dados.pedindo_cep; delete dados.pedindo_rua; delete dados.opcoes_rua; delete dados.pedindo_numero; delete dados.pedindo_complemento; delete dados.sem_cep
    dados.confirmando_empresa = false; dados.empresa_qual = false
    return fecharEndereco()
  }
  const iniciarCorrecao = (c: 'cnpj' | 'razao_social' | 'endereco' | 'nome_fantasia'): string => {
    if (c === 'cnpj') { delete dados.cnpj; delete dados.razao_social; delete dados.nome_fantasia; delete dados.endereco_cnpj; delete dados.endereco; dados.erros_cnpj = 0; return T('msg_empresa_cnpj') }
    if (c === 'nome_fantasia') { dados.corrigindo = 'nome_fantasia'; return T('msg_empresa_nome') }
    if (c === 'razao_social') { dados.corrigindo = 'razao_social'; return T('msg_empresa_razao') }
    dados.corrigindo = 'endereco'; delete dados.endereco; delete dados.endereco_cep; delete dados.sem_cep; dados.pedindo_cep = true
    return paragrafos(cfg.msg_cep || PADRAO.msg_cep, 2000)
  }

  const tratarCnpj = async (d14: string): Promise<string> => {
    if (!validarCnpj(d14)) { dados.erros_cnpj = Number(dados.erros_cnpj ?? 0) + 1; return preencher(cfg.msg_cnpj_invalido, { motivo: 'o dígito verificador não bate (parece mal digitado)' }) }
    const ja = await conferir({ documento_: d14 })
    if (ja.documento?.em_uso) { fimAgora = await encerrar('ja_cadastrado', trocar(cfg.msg_documento_em_uso || 'Esse {documento} já está cadastrado na MIMO — então você já tem conta! 💗 Para entrar ou recuperar o acesso, fale com o atendimento: {atendimento}', { documento: 'CNPJ', atendimento: atendimento() }), true); return '' }
    let c = await deps.consultarCnpj(d14)
    if (!c.ok && c.motivo === 'indisponivel') c = await deps.consultarCnpj(d14)
    if (!c.ok) {
      if (c.motivo === 'indisponivel') { dados.erros_consulta = Number(dados.erros_consulta ?? 0) + 1; return CONSULTA_FORA }
      dados.erros_cnpj = Number(dados.erros_cnpj ?? 0) + 1
      return preencher(cfg.msg_cnpj_invalido, { motivo: 'não encontrei esse CNPJ na Receita' })
    }
    if (!c.ativo) { dados.erros_cnpj = Number(dados.erros_cnpj ?? 0) + 1; return preencher(cfg.msg_cnpj_invalido, { motivo: `a situação dele na Receita é ${c.situacao}, e só CNPJ ativo entra` }) }
    dados.cnpj = d14; dados.sem_cnpj = false; delete dados.cpf
    dados.razao_social = c.razao_social || undefined; dados.nome_fantasia = c.nome_fantasia || undefined; delete dados.nome_recusado
    dados.endereco_cnpj = c.endereco; delete dados.endereco; delete dados.pedindo_cep; delete dados.pedindo_rua; delete dados.pedindo_numero; delete dados.pedindo_complemento; delete dados.corrigindo; dados.empresa_qual = false
    dados.erros_cnpj = 0; dados.erros_consulta = 0; dados.erros = 0
    return voltarFicha()   // 3.61: a ficha da empresa, para ela conferir
  }
  const tratarCpf = async (d11: string): Promise<string | null> => {
    if (!validarCpf(d11)) { dados.erros = Number(dados.erros ?? 0) + 1; return paragrafos(cfg.msg_cpf_invalido, 2000) }
    const ja = await conferir({ documento_: d11 })
    if (ja.documento?.em_uso) { fimAgora = await encerrar('ja_cadastrado', trocar(cfg.msg_documento_em_uso || 'Esse {documento} já está cadastrado na MIMO — então você já tem conta! 💗 Para entrar ou recuperar o acesso, fale com o atendimento: {atendimento}', { documento: 'CPF', atendimento: atendimento() }), true); return '' }
    dados.cpf = d11; dados.sem_cnpj = true; delete dados.cnpj; dados.erros = 0
    return null
  }
  // o e-mail: válido → já cadastrado? → anota e pede para confirmar de volta
  const tratarEmail = async (m: string): Promise<string | null> => {
    const v = m.toLowerCase()
    if (!EMAIL.test(v)) { dados.erros = Number(dados.erros ?? 0) + 1; return paragrafos(cfg.msg_email_invalido, 2000) }
    const ja = await conferir({ email_: v })
    if (ja.email?.em_uso) return trocar(cfg.msg_email_em_uso || 'O e-mail {email} já tem conta na MIMO. Se é o seu, você já tem conta — fale com o atendimento: {atendimento}. Se quiser usar outro e-mail, é só me mandar.', { email: v, atendimento: atendimento() })
    dados.email = v; dados.confirmando_email = true; dados.erros = 0
    return trocar(cfg.msg_email_confirmar || 'Anotei *{email}* — está certinho? Responde *sim* ou me manda o e-mail certo.', { email: v })
  }
  // o CEP: 8 dígitos → consulta → o endereço sem o número
  const tratarCep = async (d8: string): Promise<string> => {
    const inv = (motivo: string) => preencher(cfg.msg_cep_invalido || 'Não achei esse CEP: {motivo}. Confere e me manda de novo?', { motivo })
    if (d8.length !== 8) { dados.erros = Number(dados.erros ?? 0) + 1; return inv('um CEP tem 8 números') }
    if (/^(\d)\1{7}$/.test(d8)) { dados.erros = Number(dados.erros ?? 0) + 1; return inv('não existe na base dos Correios') }
    if (!deps.consultarCep) { dados.pedindo_cep = false; dados.sem_cep = true; return 'Me manda o endereço completo (rua, número, bairro e cidade)?' }
    let c = await deps.consultarCep(d8)
    if (!c.ok && c.motivo === 'indisponivel') c = await deps.consultarCep(d8)
    if (!c.ok) {
      if (c.motivo === 'indisponivel') return inv('a consulta está fora do ar agora, tenta de novo daqui a pouco')
      dados.erros = Number(dados.erros ?? 0) + 1
      return inv('não existe na base dos Correios')
    }
    dados.endereco_cep = c.endereco; dados.pedindo_cep = false; dados.pedindo_rua = false; delete dados.opcoes_rua; dados.pedindo_numero = true; dados.erros = 0
    dados.rua_base = { cidade: c.endereco.cidade, uf: c.endereco.uf }
    return textoPergunta('endereco') ?? ''
  }
  // 3.61: a rua pelo nome ("Rua das Flores, Itanhaém"): uma só → pede o número; várias → ela escolhe; nenhuma → de novo (2x) e aí escrito
  const tratarRua = async (bruto: string): Promise<string> => {
    const base = dados.rua_base ?? { cidade: dados.endereco_cnpj?.cidade, uf: dados.endereco_cnpj?.uf }
    const partes = bruto.split(/\s*[,;]\s*|\s+-\s+|\s+em\s+/i).map((s) => s.trim()).filter(Boolean)
    let rua = (partes[0] ?? '').replace(/^(rua|r\.|av\.?|avenida|travessa|tv\.|alameda|al\.|estrada|rod\.|rodovia|praca|praça)\s+/i, '').replace(/[.,;!?]+$/, '').trim()
    let cidade = partes[1] ?? base.cidade ?? ''
    let uf = partes[2] ?? base.uf ?? ''
    const m = cidade.match(/^(.+?)[\s/-]+([a-zA-Z]{2})$/)
    if (m && !partes[2]) { cidade = m[1]; uf = m[2] }
    uf = (uf || 'SP').toUpperCase().slice(0, 2)
    rua = rua.slice(0, 60)
    if (rua.length < 3) return T('msg_rua')
    if (!cidade) return 'Me manda também a cidade, por favor (ex.: Rua das Flores, Itanhaém).'
    dados.rua_base = { cidade, uf }
    const escrever = (aviso: string) => { dados.pedindo_rua = false; dados.sem_cep = true; delete dados.opcoes_rua; return aviso }
    if (!deps.consultarRua) return escrever('Me manda o endereço completo escrito (rua, número, bairro e cidade)?')
    let r = await deps.consultarRua(uf, cidade, rua)
    if (!r.ok && r.motivo === 'indisponivel') r = await deps.consultarRua(uf, cidade, rua)
    if (!r.ok) return escrever('A busca de endereço está fora do ar agora 😕 Me manda o endereço completo escrito (rua, número, bairro e cidade)?')
    if (r.opcoes.length === 0) {
      dados.erros_rua = Number(dados.erros_rua ?? 0) + 1
      if (dados.erros_rua >= 2) return escrever('Não achei mesmo 😕 Então me manda o endereço completo escrito (rua, número, bairro e cidade)?')
      return trocar(T('msg_rua_nao_achei'), { cidade })
    }
    dados.erros_rua = 0; dados.erros = 0
    if (r.opcoes.length === 1) { dados.endereco_cep = r.opcoes[0]; dados.pedindo_rua = false; delete dados.opcoes_rua; dados.pedindo_numero = true; return textoPergunta('endereco') ?? '' }
    dados.opcoes_rua = r.opcoes.slice(0, 5)
    return textoPergunta('endereco') ?? ''
  }
  // um telefone que ela mandou (para o salão, ou o extra): válido → já cadastrado em outra conta?
  const tratarTelefone = async (bruto: string, extra: boolean): Promise<string | null> => {
    const d = telefoneDe(bruto)
    if (!d) { dados.erros = Number(dados.erros ?? 0) + 1; return paragrafos(cfg.msg_telefone_invalido || 'Esse número não parece certo 😅 Me manda com DDD, tipo (13) 99999-0000.', 2000) }
    if (!extra && d !== numeroDela) {
      const ja = await conferir({ tel_: d })
      if (ja.numero?.em_uso) return `Esse número já está cadastrado em outra conta da MIMO 😕 Me manda outro WhatsApp para o salão${cfg.numero_atendimento ? `, ou fale com o atendimento: ${atendimento()}` : ''}.`
    }
    if (extra) { dados.telefone_extra = d; dados.telefones_ok = true } else dados.telefone_salao = d
    dados.erros = 0
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
      return fim({ responder: resposta, acao: 'link_reenviado', estado: 'enviado', passo: 'link', dados, link })
    }
    if (posLink >= 6) {
      if (posLink > 6) return { responder: null, acao: 'pos_link', estado: 'enviado' }
      resposta = 'Seu link está aí em cima 💗 Quando terminar o cadastro, a gente se vê no painel! Se precisar de ajuda para configurar, é só chamar.'
      await guardar(resposta, 'enviado', { ...dados, pos_link: posLink + 1 })
      return fim({ responder: resposta, acao: 'pos_link', estado: 'enviado', dados })
    }
    dados.pos_link = posLink + 1
    passo = 'link'
  } else if (!inicio) {
    // 2b. o que se decide sem IA, no passo atual
    const digitos = so(texto)
    const soNumero = /^[\d.\-/\s()+]+$/.test(texto)
    if (dados.confirmando && !pergunta) {
      // "Anotei X: Y. Está certo?" — sim vale; não pergunta de novo; outro texto é o valor certo
      const { campo, valor } = dados.confirmando
      if (disseSim) { dados.confirmando = null; resposta = await commit(campo, valor) }
      else if (NAO_CURTO.test(p)) { dados.confirmando = null; resposta = campo === 'nome' ? T('msg_nome') : textoPergunta(campo) }
      else {
        const v = campo === 'profissionais' ? (numeroDe(p) ? String(numeroDe(p)) : '') : campo === 'servicos' ? listaDe(texto).join(', ') : limpo(texto, campo === 'nome' ? 80 : 200)
        if (v && (campo === 'profissionais' || !curtoDemais(v))) resposta = confirmarDado(campo, v)
        else { dados.erros = Number(dados.erros ?? 0) + 1; resposta = `Não entendi 😅 ${textoPergunta(campo) ?? ''}`.trim() }
      }
    } else if (passo === 'documento') {
      if (NAO_TENHO.test(p) && !digitos) { dados.sem_cnpj = true; delete dados.cnpj; delete dados.cpf }
      else if (soNumero && digitos.length === 14 && !dados.sem_cnpj) resposta = await tratarCnpj(digitos)
      else if (soNumero && digitos.length === 11) resposta = await tratarCpf(digitos)
      else if (soNumero && digitos.length >= 8) {
        if (dados.sem_cnpj) { dados.erros = Number(dados.erros ?? 0) + 1; resposta = paragrafos(cfg.msg_cpf_invalido, 2000) }
        else { dados.erros_cnpj = Number(dados.erros_cnpj ?? 0) + 1; resposta = preencher(cfg.msg_cnpj_invalido, { motivo: 'um CNPJ tem 14 números' }) }
      }
    } else if (passo === 'endereco') {
      if (dados.confirmando_empresa) {
        // a ficha da empresa: sim segue; "o X está errado" corrige o X; "não" pergunta o quê
        const c = campoDaFicha(p)
        if (disseSim) { dados.endereco = dados.endereco_cnpj; dados.confirmando_empresa = false }
        else if (pareceEndereco(texto)) resposta = enderecoLivre(texto)
        else if (c) { dados.confirmando_empresa = false; resposta = iniciarCorrecao(c) }
        else if (NAO_CURTO.test(p) || ERRADO.test(p)) { dados.confirmando_empresa = false; dados.empresa_qual = true; resposta = T('msg_empresa_qual') }
        else if (!pergunta) { dados.sem_avanco = Number(dados.sem_avanco ?? 0) + 1; resposta = textoPergunta('endereco') }
      } else if (dados.empresa_qual) {
        const c = campoDaFicha(p)
        if (c) { dados.empresa_qual = false; resposta = iniciarCorrecao(c) }
        else if (pareceEndereco(texto)) { dados.corrigindo = 'endereco'; resposta = enderecoLivre(texto) }
        else if (NAO_CURTO.test(p) || /\b(nada|esquece|deixa|ta certo|esta certo|tudo certo)\b/.test(p)) { dados.empresa_qual = false; dados.endereco = dados.endereco_cnpj }
        else if (!pergunta) { dados.sem_avanco = Number(dados.sem_avanco ?? 0) + 1; resposta = T('msg_empresa_qual') }
      } else if (dados.corrigindo === 'nome_fantasia') {
        if (!pergunta && !curtoDemais(texto)) { dados.nome_fantasia = limpo(texto, 80); delete dados.nome_recusado; dados.corrigindo = null; resposta = voltarFicha() }
      } else if (dados.corrigindo === 'razao_social') {
        if (!pergunta && !curtoDemais(texto)) { dados.razao_social = limpo(texto, 120); dados.corrigindo = null; resposta = voltarFicha() }
      } else if (dados.pedindo_cep) {
        if (NAO_SEI.test(p)) { dados.pedindo_cep = false; if (deps.consultarRua) { dados.pedindo_rua = true; resposta = textoPergunta('endereco') } else dados.sem_cep = true }
        else if (soNumero && digitos.length >= 7) resposta = await tratarCep(digitos)
        else if (pareceEndereco(texto)) resposta = enderecoLivre(texto)
        else if (!pergunta && !soNumero && p.length > 3 && deps.consultarRua) { dados.pedindo_cep = false; dados.pedindo_rua = true; resposta = await tratarRua(texto) }   // mandou a rua no lugar do CEP
      } else if (dados.pedindo_rua) {
        if (dados.opcoes_rua?.length) {
          const n = Number((p.match(/^(?:a |opcao |numero |o |e a |e o )?(\d{1,2})$/) ?? [])[1])
          const idx = n >= 1 && n <= dados.opcoes_rua.length ? n - 1 : dados.opcoes_rua.findIndex((o) => !!o.bairro && palavra(o.bairro).length > 2 && p.includes(palavra(o.bairro)))
          if (/\bnenhum/.test(p) || NAO_CURTO.test(p)) { delete dados.opcoes_rua; dados.pedindo_rua = false; dados.sem_cep = true }
          else if (idx >= 0) { dados.endereco_cep = dados.opcoes_rua[idx]; delete dados.opcoes_rua; dados.pedindo_rua = false; dados.pedindo_numero = true; dados.erros = 0; resposta = textoPergunta('endereco') }
          else if (pareceEndereco(texto)) resposta = enderecoLivre(texto)
          else if (!pergunta) { dados.erros = Number(dados.erros ?? 0) + 1; resposta = textoPergunta('endereco') }
        } else if (pareceEndereco(texto) && /\d{1,5}/.test(texto.replace(/\b(rua|av|avenida)\b/gi, ''))) resposta = enderecoLivre(texto)
        else if (!pergunta) resposta = await tratarRua(texto)
      } else if (dados.pedindo_numero) {
        const m = texto.match(/\d+\s*[a-zA-Z]?\b/)
        if (/\b(sem numero|s\/n|sn|nao tem numero)\b/.test(p)) { dados.endereco = { ...dados.endereco_cep, numero: 's/n' }; dados.pedindo_numero = false; resposta = pedirComplemento() }
        else if (m) {
          const numero = m[0].trim(); const complemento = limpo(texto.replace(m[0], ''), 60).replace(/^[,\-–. ]+/, '')
          dados.endereco = { ...dados.endereco_cep, numero, complemento: complemento || undefined }; dados.pedindo_numero = false
          resposta = complemento ? fecharEndereco() : pedirComplemento()
        } else if (!pergunta) resposta = 'Me manda só o número do endereço (ou *sem número*, se não tiver)?'
      } else if (dados.pedindo_complemento) {
        if (NAO_CURTO.test(p) || SO_ESSE.test(p) || /\b(sem complemento|nao tem|nenhum|nao)\b/.test(p)) { dados.pedindo_complemento = false; resposta = fecharEndereco() }
        else if (!pergunta) { dados.endereco = { ...dados.endereco, complemento: limpo(texto, 60) }; dados.pedindo_complemento = false; resposta = fecharEndereco() }
      } else if (dados.confirmando_endereco_ok) {
        if (disseSim) { dados.confirmando_endereco_ok = false; if (dados.corrigindo === 'endereco') { dados.endereco_cnpj = dados.endereco; dados.corrigindo = null; resposta = voltarFicha() } }
        else if (soNumero && digitos.length === 8) { dados.confirmando_endereco_ok = false; delete dados.endereco; resposta = await tratarCep(digitos) }
        else if (pareceEndereco(texto)) resposta = enderecoLivre(texto)
        else if (NAO_CURTO.test(p) || ERRADO.test(p)) { dados.confirmando_endereco_ok = false; delete dados.endereco; delete dados.sem_cep; dados.pedindo_cep = true; resposta = textoPergunta('endereco') }
      }
      // sem_cep (endereço escrito): a IA lê e anota em "endereco"; o sistema confirma de volta logo abaixo
    } else if (passo === 'nome' && perguntou('nome') && !pergunta) {
      if (dados.nome_fantasia && !dados.nome_recusado && disseSim) resposta = await commit('nome', dados.nome_fantasia)
      else if (NAO_CURTO.test(p)) { dados.nome_recusado = true; resposta = T('msg_nome') }
      else if (!curtoDemais(texto)) resposta = confirmarDado('nome', limpo(texto, 80))
    } else if (passo === 'profissionais' && perguntou('profissionais') && !pergunta) {
      const n = numeroDe(p)
      if (n) resposta = confirmarDado('profissionais', String(n))
      else { dados.erros = Number(dados.erros ?? 0) + 1; resposta = 'Me diz um número: quantas profissionais atendem aí, contando você?' }
    } else if (passo === 'servicos' && perguntou('servicos') && !pergunta) {
      const lista = listaDe(texto)
      if (lista.length) resposta = confirmarDado('servicos', lista.join(', '))
    } else if (passo === 'horarios' && perguntou('horarios') && !pergunta) {
      if (!curtoDemais(texto)) resposta = confirmarDado('horarios', limpo(texto, 200))
    } else if (passo === 'email') {
      if (dados.confirmando_email) {
        if (disseSim) dados.confirmando_email = false
        else {
          const m = texto.match(/[^\s@<>()]+@[^\s@<>()]+/)
          if (m) resposta = await tratarEmail(m[0].replace(/[.,;!?]+$/, ''))
          else if (NAO_CURTO.test(p)) { delete dados.email; dados.confirmando_email = false; resposta = 'Sem problema! Me manda o e-mail certo?' }
        }
      } else {
        const m = texto.match(/[^\s@<>()]+@[^\s@<>()]+/)
        if (m) resposta = await tratarEmail(m[0].replace(/[.,;!?]+$/, ''))
      }
    } else if (passo === 'telefone') {
      if (!dados.telefone_salao) {
        if (disseSim) dados.telefone_salao = numeroDela
        else if (digitos.length >= 10) resposta = await tratarTelefone(texto, false)
        else if (soNumero) { dados.erros = Number(dados.erros ?? 0) + 1; resposta = paragrafos(cfg.msg_telefone_invalido || 'Esse número não parece certo 😅 Me manda com DDD.', 2000) }
      } else if (!dados.telefones_ok) {
        if (SO_ESSE.test(p) || NAO_CURTO.test(p)) dados.telefones_ok = true
        else if (digitos.length >= 10) resposta = await tratarTelefone(texto, true)
        else if (soNumero) { dados.erros = Number(dados.erros ?? 0) + 1; resposta = paragrafos(cfg.msg_telefone_invalido || 'Esse número não parece certo 😅 Me manda com DDD.', 2000) }
      }
    } else if (passo === 'resumo' && dados.resumo_mostrado) {
      if (disseSim) dados.resumo_ok = true
    } else if (passo === 'tipo') {
      if (AUTONOMA.test(p) && !SALAO.test(p)) dados.tipo = 'autonoma'
      else if (SALAO.test(p) && !AUTONOMA.test(p)) dados.tipo = 'salao'
    } else if (passo === 'explicacoes' && dados.explicou) {
      if (disseSim || NAO_CURTO.test(p) || /\b(sem duvida|nenhuma duvida|tudo certo|entendi|pode mandar|manda o link|pode enviar|ta otimo|perfeito|show)\b/.test(p)) dados.explicacoes_ok = true
    }
  }
  if (fimAgora) return fimAgora
  if (dados.tipo === 'autonoma') dados.profissionais = 1   // autônoma é ela: não se pergunta
  passos = passosDe(cfg, dados)

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
      return fim({ responder: resposta, acao: 'validacao', estado: 'coletando', passo, dados })
    }
  }

  // 3. o link: tudo coletado → "um minutinho, criando…", a espera, o link ("cadastro criado, crie a sua senha") e o convite ao suporte
  passo = avancar(dados, passos)
  const mandarLink = async (prefixo: string | null): Promise<Saida> => {
    const token = String(await chamar(deps, 'guia_onboarding_gerar_link', { id_: conversa!.id }))
    const link = linkDoCadastro(token)
    const msg = preencher(cfg.msg_link, { link, nome: dados.nome || dados.nome_fantasia || dados.razao_social || 'seu negócio', dias: String(cfg.link_dias ?? 7) })
    const antes = [prefixo, paragrafos(T('msg_criando'), 600)].filter(Boolean).join('\n\n')
    const depois = [msg, paragrafos(T('msg_final'), 1500)].filter(Boolean).join('\n\n')
    const resposta = [antes, depois].filter(Boolean).join('\n\n')
    const b1 = cfg.bolhas === false ? (antes ? [antes] : []) : dividir(antes, cfg)
    const b2 = cfg.bolhas === false ? [depois] : dividir(depois, cfg)
    const espera = Math.max(0, Math.min(90, Number(cfg.criar_espera_seg ?? PADRAO.criar_espera_seg) || 0))
    const bolhas = [...b1, ...b2]
    const pausas = bolhas.map((_, i) => (i === b1.length ? Math.max(pausa, espera) : pausa))
    const d = { ...dados, passo: 'link', link_enviado: true, pos_link: 0 }
    await guardar(resposta, 'enviado', d)
    const aviso = avisoEquipe('link', d, tel, String(cfg.link_dias ?? 7))
    await avisar(aviso)
    return fim({ responder: resposta, acao: 'link', estado: 'enviado', passo: 'link', dados: d, link, bolhas, pausas, previaAviso: teste ? aviso : null })
  }
  if (passo === 'link' && estadoAntes !== 'enviado') return mandarLink(null)
  // a pergunta do passo que é do sistema (ficha/CEP, nome, profissionais, serviços, horários, WhatsApp, resumo), quando a mensagem já foi lida: sem IA
  if (!inicio && estadoAntes !== 'enviado' && (consumida || !nota) && !pergunta) {
    const pd = perguntaDoPasso(passo)
    if (pd) {
      await guardar(pd, 'coletando', { ...dados, passo })
      return fim({ responder: pd, acao: 'pergunta', estado: 'coletando', passo, dados })
    }
  }

  // 4. a IA conversa: lê o texto livre, agradece e pergunta o próximo passo (ou explica, ou tira a dúvida)
  const proximo = passo === 'link' ? null : passos[passos.indexOf(passo) + 1] ?? null
  const perguntaFeita = pergunta && !inicio && estadoAntes !== 'enviado' && (perguntou(passo) || dados.confirmando || (passo === 'endereco' && !dados.sem_cep) || (passo === 'telefone' && dados.perguntou_telefone) || (passo === 'resumo' && dados.resumo_mostrado))
    ? (dados.confirmando ? trocar(T('msg_dado_confirmar'), { rotulo: ROTULO[dados.confirmando.campo] ?? dados.confirmando.campo, valor: dados.confirmando.valor }) : textoPergunta(passo))
    : null
  const r = await deps.ia({ provedor: cfg.provedor, modelo: cfg.modelo || MODELO_PADRAO[cfg.provedor] || MODELO_PADRAO.groq, sistema: sistema(cfg, dados, passo, proximo, nota, e.nomePerfil, agora, perguntaFeita), mensagens: historico(conversa, texto) })
  if (!r.leitura) {
    const resposta = 'Desculpa, me enrolei aqui. Pode me mandar de novo?'
    await guardar(resposta, estadoAntes === 'enviado' ? 'enviado' : 'coletando', { ...dados, passo })
    return fim({ responder: resposta, acao: 'erro_ia', erro: r.erro, estado: estadoAntes, passo, dados })
  }
  const lido = r.leitura
  if (lido.quer_apagar_dados && !teste) {
    await chamar(deps, 'guia_onboarding_apagar', { tel_: tel })
    return fim({ responder: 'Pronto, apaguei seus dados e esta conversa aqui na MIMO. 💗 Se quiser criar sua conta depois, é só me chamar.', acao: 'apagou' })
  }
  // "não sou profissional" só vale antes de qualquer documento (depois disso é mais fácil a IA ter lido errado)
  if (lido.nao_e_profissional && !dados.cnpj && !dados.cpf && estadoAntes !== 'enviado') return devolver()

  // o que a IA leu, só no que faz sentido agora (nada de preencher o passo 8 na pergunta do passo 2) — e nada quando o
  // sistema já consumiu a mensagem (aí a IA só perguntou), nem quando ela só fez uma pergunta. No resumo, qualquer campo
  // pode ser corrigido. Nome, profissionais, serviços e horários são perguntados e confirmados pelo sistema (3.61): a IA
  // só os lê no resumo.
  const antes = JSON.stringify(dados)
  const t = (v: string) => limpo(v, 200)
  const noResumo = passo === 'resumo'
  if (!consumida && !perguntaFeita) {
    if (t(lido.tipo)) dados.tipo = /auton/i.test(lido.tipo) ? 'autonoma' : /sal/i.test(lido.tipo) ? 'salao' : dados.tipo
    if (passo === 'documento' || noResumo) {
      if (lido.sem_cnpj && !dados.cnpj && passo === 'documento') { dados.sem_cnpj = true; delete dados.cnpj }
      const c = so(lido.cnpj), f = so(lido.cpf)
      if (c.length === 14 && c !== dados.cnpj && !resposta) resposta = await tratarCnpj(c)
      else if (f.length === 11 && f !== dados.cpf && !resposta && (dados.sem_cnpj || noResumo)) resposta = await tratarCpf(f)
      if (fimAgora) return fimAgora
    }
    const noEndereco = passo === 'endereco' && !dados.pedindo_cep && !dados.pedindo_rua && !dados.pedindo_numero && !dados.pedindo_complemento && !dados.confirmando_endereco_ok && !dados.empresa_qual && !dados.corrigindo
    if ((noEndereco || noResumo) && !resposta) {
      if (dados.confirmando_empresa && lido.passo_concluido && !t(lido.endereco)) { dados.endereco = dados.endereco_cnpj; dados.confirmando_empresa = false }
      else if (t(lido.endereco) && !curtoDemais(lido.endereco)) {
        dados.endereco = { texto: t(lido.endereco), cidade: t(lido.cidade) || dados.endereco_cnpj?.cidade || dados.rua_base?.cidade || dados.endereco?.cidade || undefined }
        dados.confirmando_empresa = false; delete dados.sem_cep
        if (!noResumo) resposta = fecharEndereco()   // 3.61: o endereço escrito também é confirmado de volta
      }
    }
    if (noResumo) {
      if (t(lido.nome) && !curtoDemais(lido.nome)) dados.nome = t(lido.nome).slice(0, 80)
      if (dados.tipo !== 'autonoma') { const n = Number((lido.profissionais.match(/\d{1,3}/) ?? [])[0]); if (n > 0 && n <= 300) dados.profissionais = n }
      if (t(lido.servicos)) dados.servicos = listaDe(lido.servicos)
      if (t(lido.horarios)) dados.horarios = limpo(lido.horarios, 200)
    }
    if (t(lido.email) && (passo === 'email' || noResumo) && t(lido.email).toLowerCase() !== dados.email && !resposta) resposta = await tratarEmail(t(lido.email).replace(/[.,;!?]+$/, ''))
    if (noResumo && !resposta) { const tf = (texto.match(/(?:\+?55\s*)?\(?\d{2}\)?\s*9?\s*\d{4}[-\s]?\d{4}/) ?? [])[0]; if (tf && telefoneDe(tf) && telefoneDe(tf) !== dados.telefone_salao) resposta = await tratarTelefone(tf, false) }
    if (passo === 'explicacoes' && dados.explicou && lido.passo_concluido) dados.explicacoes_ok = true
    if (noResumo && lido.passo_concluido && JSON.stringify(dados) === antes) dados.resumo_ok = true
  }
  if (passo === 'explicacoes' && !perguntaFeita) dados.explicou = true   // esta resposta da IA é a explicação (ou a volta a ela)
  if (dados.tipo === 'autonoma') dados.profissionais = 1
  passos = passosDe(cfg, dados)
  // o nome do negócio corrigido no resumo: já existe na MIMO? (o endereço nome.mimo.com.vc é único)
  if (noResumo && dados.nome && !resposta) {
    const antesNome = JSON.parse(antes) as Dados
    if (antesNome.nome !== dados.nome) {
      const ja = await conferir({ nome_: dados.nome })
      if (ja.nome?.em_uso) { resposta = trocar(cfg.msg_nome_em_uso || 'Já existe um salão chamado *{nome}* na MIMO{cidade}, e o endereço nome.mimo.com.vc precisa ser único. Quer usar outro nome, ou acrescentar o bairro ou a cidade?', { nome: dados.nome, cidade: ja.nome.cidade ? ` (em ${ja.nome.cidade})` : '' }); dados.nome = antesNome.nome }
    }
  }
  // no resumo, uma correção entrou: o resumo volta (sem IA) — agora, ou depois da confirmação que a correção pediu
  const corrigiu = noResumo && JSON.stringify(dados) !== antes && !dados.resumo_ok
  if (corrigiu) dados.resumo_mostrado = false
  if (corrigiu && !resposta) { dados.resumo_mostrado = true; resposta = textoPergunta('resumo') }

  // de novo a tolerância (o que a IA leu pode ter sido inválido) e as respostas determinísticas
  motivoFim = estourou()
  if (motivoFim) return encerrar(motivoFim, resposta)
  const mudou = JSON.stringify(dados) !== antes
  const passoDepois = estadoAntes === 'enviado' ? 'link' : avancar(dados, passos)
  if (resposta) {
    await guardar(resposta, 'coletando', { ...dados, passo: passoDepois === 'link' ? passo : passoDepois })
    return fim({ responder: resposta, acao: 'validacao', estado: 'coletando', passo: passoDepois === 'link' ? passo : passoDepois, dados })
  }
  const agradece = paragrafos(lido.resposta, 300)
  if (passoDepois === 'link' && estadoAntes !== 'enviado') {
    // o último dado veio nesta mensagem: o agradecimento da IA e, junto, o link
    return mandarLink(agradece && !/\?/.test(agradece) ? agradece : null)
  }
  // a pergunta do próximo passo é do sistema (CEP, nome, serviços, WhatsApp, resumo…): o agradecimento da IA e a pergunta, juntos
  if (estadoAntes !== 'enviado' && !perguntaFeita) {
    const pd = perguntaDoPasso(passoDepois)
    if (pd) {
      const dica = inicio || confirmouAgora ? paragrafos(T('msg_ajuda_dica'), 600) : ''
      const fala = [inicio ? paragrafos(cfg.msg_boas_vindas, 2000) : '', dica, agradece && !/\?/.test(agradece) ? agradece : '', pd].filter(Boolean).join('\n\n')
      await guardar(fala, 'coletando', { ...dados, passo: passoDepois })
      return fim({ responder: fala, acao: 'pergunta', estado: 'coletando', passo: passoDepois, dados })
    }
  }

  // sem andar: a conversa não avança há várias mensagens (ela só conversa, ou a IA não entende) → encerra com carinho
  if (!mudou && !consumida && passo === passoDepois && estadoAntes !== 'enviado' && !inicio && !nota && !perguntaFeita) {
    dados.sem_avanco = Number(dados.sem_avanco ?? 0) + 1
    if (dados.sem_avanco >= tol + 3) return encerrar('sem_avanco')
  } else dados.sem_avanco = 0

  let fala = paragrafos(lido.resposta, 1800) || 'Me conta mais um pouquinho?'
  // a dica da ajuda humana: na entrada (depois das boas-vindas) e logo depois do "sim" de quem veio por intenção
  if (inicio) fala = `${paragrafos(cfg.msg_boas_vindas, 2000)}\n\n${paragrafos(T('msg_ajuda_dica'), 600)}\n\n${fala}`
  else if (confirmouAgora) fala = `${paragrafos(T('msg_ajuda_dica'), 600)}\n\n${fala}`
  const estado = estadoAntes === 'enviado' ? 'enviado' : 'coletando'
  await guardar(fala, estado, { ...dados, passo: passoDepois })
  return fim({ responder: fala, acao: 'conversa', estado, passo: passoDepois, dados })
}

function historico(conversa: Conversa | null, texto: string): Mensagem[] {
  const h: Mensagem[] = (conversa?.mensagens ?? []).slice(-12).map((m) => ({ role: m.q === 'cliente' ? 'user' as const : 'assistant' as const, content: String(m.t ?? '').slice(0, 600) }))
  h.push({ role: 'user', content: texto })
  return h
}

// os avisos internos à equipe (vão para numero_avisos da Mel, nunca para a profissional)
export function avisoEquipe(tipo: 'link' | 'encerrou' | 'ajuda', d: Dados, tel: string, extra: string): string {
  const nome = d.nome || d.nome_fantasia || d.razao_social || 'sem nome ainda'
  const quem = `${nome}${d.tipo ? ` (${d.tipo === 'autonoma' ? 'autônoma' : 'salão'})` : ''}${d.endereco?.cidade || d.endereco_cnpj?.cidade ? ` · ${d.endereco?.cidade ?? d.endereco_cnpj?.cidade}` : ''}`
  const doc = d.cnpj ? `CNPJ ${cnpjBonito(d.cnpj)}` : d.cpf ? 'CPF anotado' : 'sem documento ainda'
  if (tipo === 'link') {
    return ['🎉 MIMO — novo cadastro pelo WhatsApp', quem, `${doc}${d.tipo !== 'autonoma' && d.profissionais ? ` · ${d.profissionais} profissional(is)` : ''}${d.email ? ` · ${d.email}` : ''}${d.telefone_salao ? ` · WhatsApp do salão ${telefoneBonito(d.telefone_salao)}` : ''}`,
      `Número: ${telefoneBonito(tel)}`, `O link para criar a senha foi enviado (vale ${extra} dias).`].join('\n')
  }
  if (tipo === 'ajuda') {
    return ['🙋 MIMO — pediu ajuda humana no onboarding', quem, `Está no passo: ${extra}.`, doc, `Número: ${telefoneBonito(tel)} — chama ela por aqui.`].join('\n')
  }
  const motivo: Record<string, string> = { tolerancia: 'muitas respostas inválidas', cnpj: 'CNPJ inválido/inativo repetidas vezes', consulta: 'a consulta da Receita ficou fora do ar', sem_avanco: 'a conversa não andou', ja_tem_conta: 'o número já tem conta na MIMO (mandada para o atendimento)', ja_cadastrado: 'o CPF/CNPJ já está cadastrado (mandada para o atendimento)' }
  return ['⚠️ MIMO — onboarding encerrado', quem, `Motivo: ${motivo[extra] ?? extra}. Parou no passo: ${NOME_PASSO[d.passo ?? ''] ?? d.passo ?? 'início'}.`, doc,
    `Número: ${telefoneBonito(tel)} — vale um humano chamar.`].join('\n')
}
