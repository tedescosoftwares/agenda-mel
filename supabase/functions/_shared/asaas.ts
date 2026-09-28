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
export async function garantirChavePix(chaveSub: string): Promise<{ ok: boolean; status?: string; chave?: string; erro?: string }> {
  try {
    const lista = await asaas(chaveSub, 'GET', '/pix/addressKeys?status=ACTIVE&limit=1')
    if ((lista?.data ?? []).length) return { ok: true, status: 'ACTIVE', chave: String(lista.data[0].key ?? '') }
    const pendentes = await asaas(chaveSub, 'GET', '/pix/addressKeys?status=AWAITING_ACTIVATION&limit=1')
    if ((pendentes?.data ?? []).length) return { ok: false, status: 'AWAITING_ACTIVATION' }
    const nova = await asaas(chaveSub, 'POST', '/pix/addressKeys', { type: 'EVP' })
    return { ok: nova?.status === 'ACTIVE', status: String(nova?.status ?? ''), chave: nova?.key ? String(nova.key) : undefined }
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

// só no sandbox: uma conta "paga" o QR de outra, como uma cliente faria.
// A conta pode exigir "ação crítica" (token no painel; no sandbox é 000000):
// aí a transação fica pendente e a gente não cria outra igual por cima.
const FINAIS_PIX = new Set(['DONE', 'REFUSED', 'CANCELLED', 'ERROR'])
export async function pagarQrSandbox(chavePagador: string, payload: string, valorCents: number, ref: string) {
  const descricao = `MIMO ${ref}`
  try {
    const lista = await asaas(chavePagador, 'GET', '/pix/transactions?limit=50')
    const pendente = (lista?.data ?? []).find((t: { description?: string; status?: string }) => t.description === descricao && !FINAIS_PIX.has(String(t.status ?? '')))
    if (pendente) return { id: String(pendente.id ?? ''), status: String(pendente.status ?? ''), repetida: true }
  } catch (_) { /* sem lista, segue */ }
  const r = await asaas(chavePagador, 'POST', '/pix/qrCodes/pay', { qrCode: { payload }, value: Math.round(valorCents) / 100, description: descricao })
  return { id: String(r?.id ?? ''), status: String(r?.status ?? ''), repetida: false }
}

// só no sandbox: a própria subconta dá baixa na cobrança ("recebido em
// dinheiro"); não precisa de saldo e dispara o webhook PAYMENT_RECEIVED
export const baixarEmDinheiroSandbox = (chaveSub: string, id: string, valorCents: number) =>
  asaas(chaveSub, 'POST', `/payments/${id}/receiveInCash`, { paymentDate: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), value: Math.round(valorCents) / 100, notifyCustomer: false })

// só no sandbox: desfaz a baixa "em dinheiro" (o Asaas não estorna esse
// tipo de recebimento; desfazer é o caminho de volta que existe lá)
export const desfazerBaixaSandbox = (chaveSub: string, id: string) => asaas(chaveSub, 'POST', `/payments/${id}/undoReceivedInCash`)

// o saldo disponível da conta, em centavos (null se não deu para ler)
export async function saldoDaConta(chave: string): Promise<number | null> {
  try {
    const r = await asaas(chave, 'GET', '/finance/balance')
    return r?.balance != null ? Math.round(Number(r.balance) * 100) : null
  } catch (_) { return null }
}

export const obterCobranca = (chaveSub: string, id: string) => asaas(chaveSub, 'GET', `/payments/${id}`)
export const apagarCobranca = (chaveSub: string, id: string) => asaas(chaveSub, 'DELETE', `/payments/${id}`)
export const estornarCobranca = (chaveSub: string, id: string, valorCents: number | null, motivo: string) =>
  asaas(chaveSub, 'POST', `/payments/${id}/refund`, { value: valorCents ? Math.round(valorCents) / 100 : undefined, description: motivo.slice(0, 200) })

// devolve um pagamento: estorno de verdade; no sandbox, se a cobrança foi
// baixada "em dinheiro" (simulação sem saldo), desfaz a baixa e apaga a
// cobrança, que é o caminho de volta que existe lá. Lança se não deu.
export async function devolverPagamento(chaveSub: string, p: { cobranca_id: string; valor_cents: number; estorno_cents?: number | null; motivo_estorno?: string | null }): Promise<'estorno' | 'baixa_desfeita'> {
  try {
    await estornarCobranca(chaveSub, p.cobranca_id, p.estorno_cents && p.estorno_cents < p.valor_cents ? p.estorno_cents : null, p.motivo_estorno ?? 'cancelamento')
    return 'estorno'
  } catch (e) {
    if (AMBIENTE === 'producao') throw e
    const real = await obterCobranca(chaveSub, p.cobranca_id).catch(() => null)
    if (String(real?.status ?? '') !== 'RECEIVED_IN_CASH') throw e
    await desfazerBaixaSandbox(chaveSub, p.cobranca_id)
    await apagarCobranca(chaveSub, p.cobranca_id).catch(() => {})
    return 'baixa_desfeita'
  }
}

export function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return json({ ok: true })
  return null
}

// ---- a assinatura da MIMO (128): cobrada na conta-pai ---------------------------
//
// A dona do salão é cliente da MIMO no Asaas. Três jeitos de pagar:
//   cartão          tokenizado uma vez (o número passa por aqui e não fica
//                   guardado; só o token, os 4 finais e a bandeira), e a
//                   MIMO cobra cada mês pelo token
//   pix_automatico  uma autorização em modo MANUAL: a dona autoriza no app
//                   do banco e a MIMO cria cada cobrança do mês
//   pix             uma cobrança Pix por mês, com QR, paga na mão
//
// ATENÇÃO · Pix Automático: os endpoints /pix/automatic/* foram escritos a
// partir da documentação da Asaas e ainda não passaram pela sondagem
// (evolution/testar-pix-automatico.mjs). Se a Asaas devolver 400 listando
// campos, é aqui que se ajusta: `corpoAutorizacao` e `cobrarPixAutomatico`.

export async function garantirClienteMimo(c: { nome: string; documento: string; telefone?: string | null; email?: string | null; ref: string }) {
  const doc = soDigitos(c.documento)
  if (!doc) throw new ErroAsaas(400, 'Sem CPF ou CNPJ no cadastro do salão: complete os dados fiscais antes.')
  const achados = await asaas(chavePai(), 'GET', `/customers?cpfCnpj=${doc}&limit=1`)
  const existente = achados?.data?.[0]
  if (existente?.id) return String(existente.id)
  const novo = await asaas(chavePai(), 'POST', '/customers', {
    name: c.nome, cpfCnpj: doc, mobilePhone: celular(c.telefone), email: c.email || undefined,
    externalReference: c.ref, notificationDisabled: true,
  })
  return String(novo.id)
}

export type CartaoEntrada = { nome: string; numero: string; mes: string; ano: string; cvv: string }
export type TitularEntrada = { nome: string; email?: string | null; documento: string; cep: string; numero: string; telefone?: string | null }

// o token do cartão: o número entra aqui e sai só o token
export async function tokenizarCartao(customer: string, cartao: CartaoEntrada, titular: TitularEntrada, ip: string) {
  const r = await asaas(chavePai(), 'POST', '/creditCard/tokenizeCreditCard', {
    customer,
    creditCard: { holderName: cartao.nome, number: soDigitos(cartao.numero), expiryMonth: cartao.mes.padStart(2, '0'), expiryYear: cartao.ano.length === 2 ? '20' + cartao.ano : cartao.ano, ccv: soDigitos(cartao.cvv) },
    creditCardHolderInfo: { name: titular.nome, email: titular.email || undefined, cpfCnpj: soDigitos(titular.documento), postalCode: soDigitos(titular.cep), addressNumber: titular.numero || 'S/N', phone: celular(titular.telefone), mobilePhone: celular(titular.telefone) },
    remoteIp: ip,
  })
  return { token: String(r.creditCardToken ?? ''), final: String(r.creditCardNumber ?? '').slice(-4), bandeira: String(r.creditCardBrand ?? '') }
}

// cobra o mês no cartão tokenizado (o Asaas cobra na hora)
export async function cobrarCartao(p: { customer: string; token: string; valorCents: number; descricao: string; ref: string; vencimento: string; ip?: string }) {
  const r = await asaas(chavePai(), 'POST', '/payments', {
    customer: p.customer, billingType: 'CREDIT_CARD', value: Math.round(p.valorCents) / 100, dueDate: p.vencimento,
    description: p.descricao.slice(0, 500), externalReference: p.ref, creditCardToken: p.token, remoteIp: p.ip,
  })
  return { id: String(r.id), status: String(r.status), link: r.invoiceUrl ?? null }
}

// a cobrança Pix avulsa da MIMO (conta-pai, sem split)
export async function cobrarPixMimo(p: { customer: string; valorCents: number; descricao: string; ref: string; vencimento: string }) {
  const cobranca = await asaas(chavePai(), 'POST', '/payments', {
    customer: p.customer, billingType: 'PIX', value: Math.round(p.valorCents) / 100, dueDate: p.vencimento,
    description: p.descricao.slice(0, 500), externalReference: p.ref,
  })
  const qr = await asaas(chavePai(), 'GET', `/payments/${cobranca.id}/pixQrCode`)
  return { id: String(cobranca.id), status: String(cobranca.status), link: cobranca.invoiceUrl ?? null, copiaCola: String(qr.payload ?? ''), imagem: qr.encodedImage ?? null, expira: qr.expirationDate ?? null }
}

// ---- Pix Automático (contrato a confirmar na sondagem) ----
function corpoAutorizacao(p: { customer: string; descricao: string; inicio: string; tetoCents: number; ref: string }) {
  return {
    customer: p.customer,
    description: p.descricao.slice(0, 100),
    paymentCreationMode: 'MANUAL',      // a MIMO calcula o valor de cada mês e cria cada cobrança
    frequency: 'MONTHLY',
    startDate: p.inicio,
    maxValue: Math.round(p.tetoCents) / 100,   // o teto que a dona autoriza no banco (o plano pode crescer)
    externalReference: p.ref,
  }
}

// deno-lint-ignore no-explicit-any
function lerAutorizacao(r: any) {
  const qr = r?.qrCode ?? r?.pixQrCode ?? {}
  return {
    id: String(r?.id ?? ''),
    status: String(r?.status ?? 'PENDING'),
    copiaCola: String(r?.payload ?? qr?.payload ?? r?.qrCodePayload ?? ''),
    imagem: (r?.encodedImage ?? qr?.encodedImage ?? null) as string | null,
  }
}

export async function criarAutorizacaoPixAutomatico(p: { customer: string; descricao: string; inicio: string; tetoCents: number; ref: string }) {
  const r = await asaas(chavePai(), 'POST', '/pix/automatic/authorizations', corpoAutorizacao(p))
  const a = lerAutorizacao(r)
  // algumas respostas devolvem o QR só na consulta
  if (!a.copiaCola && a.id) {
    try { const d = await asaas(chavePai(), 'GET', `/pix/automatic/authorizations/${a.id}`); const b = lerAutorizacao(d); if (b.copiaCola) return { ...a, ...b } } catch (_) { /* fica sem QR */ }
  }
  return a
}

export async function situacaoAutorizacaoPixAutomatico(id: string) {
  return lerAutorizacao(await asaas(chavePai(), 'GET', `/pix/automatic/authorizations/${id}`))
}

export async function cancelarAutorizacaoPixAutomatico(id: string) {
  try { await asaas(chavePai(), 'POST', `/pix/automatic/authorizations/${id}/cancel`) } catch (e) {
    if (e instanceof ErroAsaas && (e.status === 404 || e.status === 405)) { await asaas(chavePai(), 'DELETE', `/pix/automatic/authorizations/${id}`); return }
    throw e
  }
}

// cobra o mês pela autorização (modo MANUAL). Primeiro o endpoint próprio;
// se não existir, a cobrança comum apontando pra autorização.
export async function cobrarPixAutomatico(p: { customer: string; autorizacao: string; valorCents: number; descricao: string; ref: string; vencimento: string }) {
  const comum = { value: Math.round(p.valorCents) / 100, dueDate: p.vencimento, description: p.descricao.slice(0, 500), externalReference: p.ref }
  try {
    const r = await asaas(chavePai(), 'POST', '/pix/automatic/payments', { authorization: p.autorizacao, ...comum })
    return { id: String(r.id), status: String(r.status ?? 'PENDING') }
  } catch (e) {
    if (!(e instanceof ErroAsaas && (e.status === 404 || e.status === 405))) throw e
    const r = await asaas(chavePai(), 'POST', '/payments', { customer: p.customer, billingType: 'PIX', pixAutomaticAuthorizationId: p.autorizacao, ...comum })
    return { id: String(r.id), status: String(r.status ?? 'PENDING') }
  }
}

export const obterCobrancaMimo = (id: string) => asaas(chavePai(), 'GET', `/payments/${id}`)
export const apagarCobrancaMimo = (id: string) => asaas(chavePai(), 'DELETE', `/payments/${id}`)
// só no sandbox: a conta-pai dá baixa na própria cobrança, como se a dona tivesse pago
export const baixarCobrancaMimoSandbox = (id: string, valorCents: number) =>
  asaas(chavePai(), 'POST', `/payments/${id}/receiveInCash`, { paymentDate: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), value: Math.round(valorCents) / 100, notifyCustomer: false })

export const PAGO = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'])
export const NAO_VAI_PAGAR = new Set(['OVERDUE', 'REFUNDED', 'REFUND_REQUESTED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'DELETED'])
