// O adaptador do Asaas: tudo que fala com a API deles passa por aqui.
//
// Segredos (supabase secrets set):
//   ASAAS_API_KEY        a chave da conta-pai (a do MIMO)
//   ASAAS_AMBIENTE       sandbox | producao
//   ASAAS_WEBHOOK_TOKEN  o token que o Asaas manda no header asaas-access-token
//   MIMO_WALLET_ID       a wallet da conta-pai, para o split (opcional)
//   MIMO_TAXA_PCT        a parte do MIMO em cada pagamento, em % (opcional, 0 = nada)
//
// Cada salão é uma subconta com a própria chave, guardada no Vault
// (ler_segredo / guardar_segredo). Cobrança, cliente e QR vivem dentro
// da subconta: quem vende é a profissional, o MIMO só fica com a parte
// dele pelo split.

export const AMBIENTE = (Deno.env.get('ASAAS_AMBIENTE') ?? 'sandbox').toLowerCase()
export const BASE = AMBIENTE === 'producao' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3'

export class ErroAsaas extends Error {
  status: number
  detalhes: unknown
  constructor(status: number, mensagem: string, detalhes?: unknown) {
    super(mensagem)
    this.status = status
    this.detalhes = detalhes
  }
}

// deno-lint-ignore no-explicit-any
export async function asaas(chave: string, metodo: string, caminho: string, corpo?: unknown): Promise<any> {
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', accept: 'application/json', access_token: chave, 'User-Agent': 'MIMO' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  const texto = await r.text()
  let json: unknown = null
  try { json = texto ? JSON.parse(texto) : null } catch { json = { bruto: texto } }
  if (!r.ok) {
    // deno-lint-ignore no-explicit-any
    const erros = (json as any)?.errors
    const msg = Array.isArray(erros) && erros.length ? erros.map((e: { description?: string }) => e.description).join('; ') : `Asaas respondeu ${r.status}`
    throw new ErroAsaas(r.status, msg, json)
  }
  return json
}

export function chavePai(): string {
  const k = Deno.env.get('ASAAS_API_KEY') ?? ''
  if (!k) throw new Error('ASAAS_API_KEY não configurada (supabase secrets set)')
  return k
}

export const soDigitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')

// telefone celular no formato que o Asaas aceita (DDD + número, só dígitos)
export function celular(v: string | null | undefined): string | undefined {
  const d = soDigitos(v).replace(/^55/, '')
  return d.length >= 10 ? d : undefined
}

// ---- subconta ---------------------------------------------------------------

export type DadosSubconta = {
  tipo_pessoa: 'fisica' | 'juridica'
  nome: string
  email: string
  documento: string           // CPF ou CNPJ, só dígitos
  celular: string
  nascimento?: string         // YYYY-MM-DD (pessoa física)
  tipo_empresa?: 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION'
  renda_mensal: number        // em reais
  cep: string
  endereco: string
  numero: string
  complemento?: string
  bairro: string
}

export function corpoSubconta(d: DadosSubconta, webhook: { url: string; token: string; email: string }) {
  return {
    name: d.nome,
    email: d.email,
    loginEmail: d.email,
    cpfCnpj: soDigitos(d.documento),
    birthDate: d.tipo_pessoa === 'fisica' ? d.nascimento : undefined,
    companyType: d.tipo_pessoa === 'juridica' ? d.tipo_empresa ?? 'MEI' : undefined,
    mobilePhone: celular(d.celular),
    incomeValue: Number(d.renda_mensal),
    postalCode: soDigitos(d.cep),
    address: d.endereco,
    addressNumber: d.numero,
    complement: d.complemento || undefined,
    province: d.bairro,
    webhooks: [{
      name: 'MIMO',
      url: webhook.url,
      email: webhook.email,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: webhook.token,
      sendType: 'SEQUENTIALLY',
      events: [
        'PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_REFUNDED', 'PAYMENT_DELETED', 'PAYMENT_OVERDUE',
        'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED', 'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
        'ACCOUNT_STATUS_DOCUMENT_APPROVED', 'ACCOUNT_STATUS_DOCUMENT_REJECTED', 'ACCOUNT_STATUS_DOCUMENT_PENDING',
        'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED', 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED',
        'ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED', 'ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED',
      ],
    }],
  }
}

// o estado da subconta, lido com a chave dela
export async function situacaoDaSubconta(chaveSub: string) {
  const status = await asaas(chaveSub, 'GET', '/myAccount/status')
  let documentos: unknown[] = []
  try {
    const docs = await asaas(chaveSub, 'GET', '/myAccount/documents')
    documentos = (docs?.data ?? []).map((d: Record<string, unknown>) => ({
      id: d.id, status: d.status, tipo: d.type, titulo: d.title, descricao: d.description,
      link: d.onboardingUrl ?? null, link_vence_em: d.onboardingUrlExpirationDate ?? null,
    }))
  } catch (_) { /* antes dos 15 s a lista pode não existir ainda */ }
  const geral = String(status?.general ?? 'PENDING')
  const resumo = geral === 'APPROVED' ? 'aprovada' : geral === 'REJECTED' ? 'recusada' : 'aguardando'
  return { status: resumo, situacao: status, documentos }
}

// a subconta precisa de uma chave Pix para gerar QR; uma aleatória (EVP)
// basta e nunca aparece para ninguém. Devolve true se já tem ou criou.
export async function garantirChavePix(chaveSub: string): Promise<{ ok: boolean; status?: string; erro?: string }> {
  try {
    const lista = await asaas(chaveSub, 'GET', '/pix/addressKeys?status=ACTIVE&limit=1')
    if ((lista?.data ?? []).length) return { ok: true, status: 'ACTIVE' }
    const pendentes = await asaas(chaveSub, 'GET', '/pix/addressKeys?status=AWAITING_ACTIVATION&limit=1')
    if ((pendentes?.data ?? []).length) return { ok: false, status: 'AWAITING_ACTIVATION' }
    const nova = await asaas(chaveSub, 'POST', '/pix/addressKeys', { type: 'EVP' })
    return { ok: nova?.status === 'ACTIVE', status: String(nova?.status ?? '') }
  } catch (e) {
    return { ok: false, erro: e instanceof ErroAsaas ? e.message : String(e) }
  }
}

// ---- cliente e cobrança (dentro da subconta) -----------------------------------

export async function garantirCliente(chaveSub: string, c: { nome: string; cpf: string; telefone?: string | null; email?: string | null; ref: string }) {
  const cpf = soDigitos(c.cpf)
  const achados = await asaas(chaveSub, 'GET', `/customers?cpfCnpj=${cpf}&limit=1`)
  const existente = achados?.data?.[0]
  if (existente?.id) return String(existente.id)
  const novo = await asaas(chaveSub, 'POST', '/customers', {
    name: c.nome, cpfCnpj: cpf, mobilePhone: celular(c.telefone), email: c.email || undefined,
    externalReference: c.ref, notificationDisabled: true,
  })
  return String(novo.id)
}

export async function criarCobrancaPix(chaveSub: string, p: {
  customer: string; valorCents: number; descricao: string; ref: string; vencimento: string;
  splitWallet?: string; splitPct?: number;
}) {
  const split = p.splitWallet && p.splitPct && p.splitPct > 0 ? [{ walletId: p.splitWallet, percentualValue: p.splitPct }] : undefined
  const cobranca = await asaas(chaveSub, 'POST', '/payments', {
    customer: p.customer,
    billingType: 'PIX',
    value: Math.round(p.valorCents) / 100,
    dueDate: p.vencimento,
    description: p.descricao.slice(0, 500),
    externalReference: p.ref,
    split,
  })
  const qr = await asaas(chaveSub, 'GET', `/payments/${cobranca.id}/pixQrCode`)
  return {
    id: String(cobranca.id), status: String(cobranca.status), link: cobranca.invoiceUrl ?? null,
    netValue: cobranca.netValue, copiaCola: String(qr.payload ?? ''), imagem: qr.encodedImage ?? null, expira: qr.expirationDate ?? null,
  }
}

export const obterCobranca = (chaveSub: string, id: string) => asaas(chaveSub, 'GET', `/payments/${id}`)
export const apagarCobranca = (chaveSub: string, id: string) => asaas(chaveSub, 'DELETE', `/payments/${id}`)
export const estornarCobranca = (chaveSub: string, id: string, valorCents: number | null, motivo: string) =>
  asaas(chaveSub, 'POST', `/payments/${id}/refund`, { value: valorCents ? Math.round(valorCents) / 100 : undefined, description: motivo.slice(0, 200) })

export function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return json({ ok: true })
  return null
}
