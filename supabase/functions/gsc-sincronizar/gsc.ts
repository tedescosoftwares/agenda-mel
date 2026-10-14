// As buscas do Google (3.12): tudo o que a função gsc-sincronizar faz sem
// banco, para dar para testar com
//   node --experimental-strip-types supabase/functions/gsc-sincronizar/gsc.teste.ts
//
//   JSON da conta de serviço -> JWT RS256 assinado com WebCrypto
//     -> access token (oauth2.googleapis.com/token, escopo webmasters.readonly)
//       -> searchAnalytics.query por janelas de 30 dias, paginado (rowLimit/startRow)
//         -> só páginas do guia (/saloes...), URL vira caminho, repetidas somadas
//           -> gravar(linhas, dias inteiros) em pedaços (quem grava é o index.ts)
//
// A rede entra por um fetch recebido de fora (Fetcher): o teste passa um falso.
// Nada de SDK do Google: são dois POSTs e uma assinatura.
//
// Roda no Deno e no node com --experimental-strip-types: nada de enum,
// namespace ou parameter properties, e imports com a extensão .ts.

export const ESCOPO = 'https://www.googleapis.com/auth/webmasters.readonly'
// fixo de propósito: o token_uri do JSON nunca decide para onde vai a assinatura
export const URL_TOKEN = 'https://oauth2.googleapis.com/token'
export const URL_API = 'https://searchconsole.googleapis.com/webmasters/v3/sites'
export const DIMENSOES = ['date', 'page', 'query', 'device']
export const LIMITE_POR_PAGINA = 25000 // o máximo que o Search Console devolve por pedido
export const MAX_PAGINAS = 40 // por janela (1 milhão de linhas): o teto contra laço sem fim
export const JANELA_DIAS = 30
export const DIAS_MAX = 480 // o Google guarda 16 meses
export const FOLGA_DIAS = 5 // a cada sincronização, os últimos dias vêm de novo
export const PEDACO = 2000 // linhas por chamada de gravar
export const APARELHOS: Record<string, string> = { MOBILE: 'celular', DESKTOP: 'computador', TABLET: 'tablet' }
const CAMINHO_DO_GUIA = /^\/saloes(\/[a-z0-9_-]+)*$/

// ---- tipos ------------------------------------------------------------------------
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
export type ContaServico = { client_email: string; private_key: string; private_key_id?: string }
export type LinhaGoogle = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }
export type LinhaSite = { dia: string; pagina: string; consulta: string; aparelho: string; cliques: number; impressoes: number; posicao: number }
export type Gravar = (linhas: LinhaSite[], diasInteiros: string[] | null) => Promise<void>
export type Resumo = {
  de: string; ate: string; dias: number; linhas: number; janelas: number; pedidos: number
  descartadas: number; parcial: boolean
}

// erro com um código que a tela entende (sem_segredos, chave_invalida, token_recusado, sem_acesso...)
export class ErroGsc extends Error {
  codigo: string
  constructor(codigo: string, mensagem: string) {
    super(mensagem)
    this.codigo = codigo
    this.name = 'ErroGsc'
  }
}

// ---- base64url e PEM ----------------------------------------------------------------
export function base64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const textoBase64url = (s: string) => base64url(new TextEncoder().encode(s))

export function pemParaDer(pem: string): Uint8Array {
  const corpo = pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, '')
  const bin = atob(corpo)
  const der = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i)
  return der
}

// ---- o segredo GSC_CONTA_SERVICO ------------------------------------------------------
// Aceita o JSON como o Google baixa, o mesmo JSON em base64 (para quem não quer
// brigar com aspas no terminal) e a chave com "\n" escrito em vez de quebra de linha.
export function lerContaServico(texto: string): ContaServico {
  let bruto = String(texto ?? '').trim()
  if (!bruto) throw new ErroGsc('sem_segredos', 'falta o segredo GSC_CONTA_SERVICO (o JSON da conta de serviço do Google)')
  if (!bruto.startsWith('{')) {
    try { bruto = new TextDecoder().decode(pemParaDer(bruto)).trim() } catch { /* não era base64 */ }
  }
  let j: Record<string, unknown>
  try { j = JSON.parse(bruto) } catch {
    throw new ErroGsc('chave_invalida', 'GSC_CONTA_SERVICO não é um JSON: grave o arquivo inteiro da chave (supabase secrets set GSC_CONTA_SERVICO="$(cat chave.json)")')
  }
  if (j.type && j.type !== 'service_account') throw new ErroGsc('chave_invalida', 'GSC_CONTA_SERVICO precisa ser a chave de uma CONTA DE SERVIÇO (type "service_account")')
  const email = typeof j.client_email === 'string' ? j.client_email.trim() : ''
  const chave = typeof j.private_key === 'string' ? j.private_key.replace(/\\n/g, '\n') : ''
  if (!email.includes('@')) throw new ErroGsc('chave_invalida', 'o JSON da conta de serviço está sem client_email')
  if (!/-----BEGIN PRIVATE KEY-----/.test(chave)) throw new ErroGsc('chave_invalida', 'o JSON da conta de serviço está sem private_key')
  return { client_email: email, private_key: chave, private_key_id: typeof j.private_key_id === 'string' ? j.private_key_id : undefined }
}

// ---- o JWT da conta de serviço (RS256, WebCrypto) ----------------------------------------
export async function montarJwt(conta: ContaServico, agora = Math.floor(Date.now() / 1000), subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  const cabecalho: Record<string, string> = { alg: 'RS256', typ: 'JWT' }
  if (conta.private_key_id) cabecalho.kid = conta.private_key_id
  const corpo = { iss: conta.client_email, scope: ESCOPO, aud: URL_TOKEN, iat: agora, exp: agora + 3600 }
  const entrada = `${textoBase64url(JSON.stringify(cabecalho))}.${textoBase64url(JSON.stringify(corpo))}`
  let chave: CryptoKey
  try {
    chave = await subtle.importKey('pkcs8', pemParaDer(conta.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  } catch {
    throw new ErroGsc('chave_invalida', 'a private_key do JSON não abriu: baixe uma chave nova da conta de serviço')
  }
  const assinatura = await subtle.sign('RSASSA-PKCS1-v1_5', chave, new TextEncoder().encode(entrada))
  return `${entrada}.${base64url(new Uint8Array(assinatura))}`
}

async function lerJson(r: Response): Promise<Record<string, unknown>> {
  try { return await r.json() as Record<string, unknown> } catch { return {} }
}

// troca o JWT por um access token (vale 1 hora; a sincronização cabe nisso)
export async function pedirToken(conta: ContaServico, fetcher: Fetcher, agora?: number): Promise<string> {
  const jwt = await montarJwt(conta, agora)
  const r = await fetcher(URL_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString(),
  })
  const corpo = await lerJson(r)
  if (r.ok && typeof corpo.access_token === 'string') return corpo.access_token
  const erro = String(corpo.error ?? '')
  const detalhe = String(corpo.error_description ?? '').slice(0, 200)
  if (erro === 'invalid_grant') throw new ErroGsc('token_recusado', `o Google recusou a conta de serviço (${detalhe || 'invalid_grant'}): a chave pode ter sido apagada no Google Cloud; baixe uma nova e grave de novo em GSC_CONTA_SERVICO`)
  if (erro === 'invalid_client' || erro === 'unauthorized_client') throw new ErroGsc('token_recusado', `o Google não reconhece esta conta de serviço (${detalhe || erro}): confira se ela não foi desativada`)
  throw new ErroGsc('token_recusado', `o Google não deu o token (${r.status}${detalhe ? `: ${detalhe}` : ''})`)
}

// ---- a propriedade e as URLs -----------------------------------------------------------
// 'sc-domain:mimo.com.vc' (domínio), 'https://mimo.com.vc/' (prefixo de URL); um
// domínio solto vira sc-domain
export function normalizarPropriedade(texto: string): string {
  const p = String(texto ?? '').trim()
  if (!p) throw new ErroGsc('sem_segredos', 'falta o segredo GSC_PROPRIEDADE (ex.: sc-domain:mimo.com.vc ou https://mimo.com.vc/)')
  const dominio = /^sc-domain:\s*([a-z0-9.-]+\.[a-z]{2,})$/i.exec(p)
  if (dominio) return `sc-domain:${dominio[1].toLowerCase()}`
  if (/^https?:\/\//i.test(p)) {
    try {
      const u = new URL(p)
      return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`}`
    } catch { /* cai no erro abaixo */ }
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(p)) return `sc-domain:${p.toLowerCase()}`
  throw new ErroGsc('sem_segredos', `GSC_PROPRIEDADE não parece uma propriedade do Search Console (veio "${p.slice(0, 60)}"): use sc-domain:mimo.com.vc ou https://mimo.com.vc/`)
}

// de que endereços as páginas podem vir: o domínio e o www (os subdomínios dos
// salões, numa propriedade de domínio, ficam de fora)
export function hostsDaPropriedade(propriedade: string): string[] {
  let host = propriedade.startsWith('sc-domain:') ? propriedade.slice(10) : ''
  if (!host) { try { host = new URL(propriedade).hostname } catch { return [] } }
  host = host.toLowerCase()
  const sem = host.replace(/^www\./, '')
  return [sem, `www.${sem}`]
}

// 'https://mimo.com.vc/saloes/itanhaem/studio-lirio/?x=1#topo' -> '/saloes/itanhaem/studio-lirio';
// null para o que não é do guia (ou é de outro endereço)
export function caminhoDaUrl(url: string, hosts?: string[] | null): string | null {
  let u: URL
  try { u = new URL(String(url ?? '')) } catch { return null }
  if (hosts?.length && !hosts.includes(u.hostname.toLowerCase())) return null
  let p = u.pathname
  try { p = decodeURIComponent(p) } catch { /* fica como veio */ }
  p = p.toLowerCase().replace(/\/{2,}/g, '/')
  if (p.length > 1) p = p.replace(/\/+$/, '')
  return CAMINHO_DO_GUIA.test(p) ? p : null
}

// sem caractere de controle e sem espaço dobrado (o banco faz o mesmo)
const limparConsulta = (q: unknown) => String(q ?? '').replace(/[\p{Cc}\s]+/gu, ' ').trim().slice(0, 500)

// as linhas do Google viram linhas do site: só o guia, a URL vira caminho, e a
// mesma chave repetida (http e https, com e sem barra no fim) é somada, com a
// posição pesada pelas impressões
export function converterLinhas(linhas: LinhaGoogle[], hosts?: string[] | null): { linhas: LinhaSite[]; descartadas: number } {
  const por = new Map<string, LinhaSite & { soma: number }>()
  let descartadas = 0
  for (const l of linhas) {
    const [dia, pagina, consulta, aparelho] = l.keys ?? []
    const caminho = caminhoDaUrl(pagina, hosts)
    const q = limparConsulta(consulta)
    const ap = APARELHOS[String(aparelho ?? '').toUpperCase()]
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia ?? '')) || !caminho || !q || !ap) { descartadas++; continue }
    const impressoes = Math.max(0, Math.round(Number(l.impressions) || 0))
    const cliques = Math.max(0, Math.round(Number(l.clicks) || 0))
    const posicao = Math.max(0, Number(l.position) || 0)
    const chave = `${dia}|${caminho}|${q}|${ap}`
    const atual = por.get(chave)
    if (atual) {
      atual.cliques += cliques
      atual.impressoes += impressoes
      atual.soma += posicao * impressoes
    } else {
      por.set(chave, { dia, pagina: caminho, consulta: q, aparelho: ap, cliques, impressoes, posicao, soma: posicao * impressoes })
    }
  }
  const saida: LinhaSite[] = []
  for (const { soma, ...l } of por.values()) {
    saida.push({ ...l, posicao: Math.round((l.impressoes > 0 ? soma / l.impressoes : l.posicao) * 1000) / 1000 })
  }
  return { linhas: saida, descartadas }
}

// ---- datas (em UTC; o Google conta no fuso do Pacífico, a folga cobre a diferença) ----------
const DIA_MS = 86400000
export function somarDias(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10)
}
export const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS)

// quantos dias buscar: o pedido (1..480); sem pedido, o que falta desde o último
// dia gravado mais a folga; na primeira vez, tudo o que o Google guarda
export function diasParaBuscar(ultimoDia: string | null | undefined, hoje: string, pedido?: unknown): number {
  const n = Math.floor(Number(pedido))
  if (pedido != null && pedido !== '' && Number.isFinite(n) && n > 0) return Math.min(n, DIAS_MAX)
  if (!ultimoDia || !/^\d{4}-\d{2}-\d{2}$/.test(ultimoDia)) return DIAS_MAX
  return Math.max(7, Math.min(DIAS_MAX, diasEntre(ultimoDia, hoje) + FOLGA_DIAS))
}

// o intervalo em janelas de N dias, da mais nova para a mais velha (se o tempo
// acabar, o que ficou para trás é o mais antigo)
export function janelas(de: string, ate: string, tamanho = JANELA_DIAS): Array<[string, string]> {
  const saida: Array<[string, string]> = []
  let fim = ate
  while (diasEntre(de, fim) >= 0) {
    const ini = diasEntre(de, somarDias(fim, -(tamanho - 1))) >= 0 ? somarDias(fim, -(tamanho - 1)) : de
    saida.push([ini, fim])
    fim = somarDias(ini, -1)
  }
  return saida
}

export function emPedacos<T>(lista: T[], n = PEDACO): T[][] {
  const saida: T[][] = []
  for (let i = 0; i < lista.length; i += n) saida.push(lista.slice(i, i + n))
  return saida
}

// ---- o Search Console ------------------------------------------------------------------
export function explicarErroApi(status: number, corpo: Record<string, unknown>, email: string): ErroGsc {
  const e = (corpo.error ?? {}) as { message?: string }
  const msg = String(e.message ?? '').slice(0, 240)
  if (status === 403 && /has not been used|is disabled|not been enabled|SERVICE_DISABLED/i.test(msg)) {
    return new ErroGsc('api_desligada', 'a Google Search Console API não está ativada no projeto da conta de serviço: ative em console.cloud.google.com → APIs e serviços → Biblioteca')
  }
  if (status === 403) return new ErroGsc('sem_acesso', `a conta de serviço (${email}) ainda não tem acesso a esta propriedade: no Search Console, Configurações → Usuários e permissões → Adicionar usuário, com esse e-mail`)
  if (status === 404) return new ErroGsc('sem_propriedade', 'o Google não achou a propriedade: confira GSC_PROPRIEDADE (sc-domain:mimo.com.vc para domínio, https://mimo.com.vc/ para prefixo de URL)')
  if (status === 401) return new ErroGsc('token_recusado', 'o Google recusou o token da conta de serviço; tente de novo')
  if (status === 429) return new ErroGsc('limite', 'o Google pediu para esperar (limite de pedidos); tente daqui a alguns minutos')
  return new ErroGsc('google', `o Search Console respondeu ${status}${msg ? `: ${msg}` : ''}`)
}

// uma janela inteira, página por página (rowLimit/startRow) até vir menos que o limite
export async function consultarJanela(o: {
  token: string; propriedade: string; de: string; ate: string; fetcher: Fetcher; email?: string
  limite?: number; maxPaginas?: number; deveParar?: () => boolean
}): Promise<{ linhas: LinhaGoogle[]; pedidos: number; completo: boolean }> {
  const limite = o.limite ?? LIMITE_POR_PAGINA
  const maxPaginas = o.maxPaginas ?? MAX_PAGINAS
  const url = `${URL_API}/${encodeURIComponent(o.propriedade)}/searchAnalytics/query`
  const linhas: LinhaGoogle[] = []
  let pedidos = 0
  for (let startRow = 0; ; startRow += limite) {
    if (pedidos >= maxPaginas || (pedidos > 0 && o.deveParar?.())) return { linhas, pedidos, completo: false }
    const r = await o.fetcher(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${o.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: o.de, endDate: o.ate, dimensions: DIMENSOES, type: 'web', rowLimit: limite, startRow,
        // o filtro grosso no Google; o fino (caminho do guia, endereço) é converterLinhas
        dimensionFilterGroups: [{ groupType: 'and', filters: [{ dimension: 'page', operator: 'contains', expression: '/saloes' }] }],
      }),
    })
    pedidos++
    const corpo = await lerJson(r)
    if (!r.ok) throw explicarErroApi(r.status, corpo, o.email ?? 'a conta de serviço')
    const pagina = Array.isArray(corpo.rows) ? corpo.rows as LinhaGoogle[] : []
    for (const l of pagina) linhas.push(l)
    if (pagina.length < limite) return { linhas, pedidos, completo: true }
  }
}

// ---- a sincronização inteira -----------------------------------------------------------
// gravar recebe pedaços de até PEDACO linhas; no último pedaço de cada janela
// completa vão também os dias que o Google devolveu (o banco limpa o que sobrou
// de antes nesses dias). Se o prazo acabar, para entre janelas e devolve parcial.
export async function sincronizar(o: {
  conta: ContaServico; propriedade: string; dias: number; hoje: string; fetcher: Fetcher; gravar: Gravar
  prazoMs?: number; agora?: () => number; limite?: number; pedaco?: number
}): Promise<Resumo> {
  const agora = o.agora ?? Date.now
  const inicio = agora()
  const passou = () => agora() - inicio > (o.prazoMs ?? 100000)
  const token = await pedirToken(o.conta, o.fetcher, Math.floor(inicio / 1000))
  const hosts = hostsDaPropriedade(o.propriedade)
  const dias = Math.max(1, Math.min(DIAS_MAX, Math.floor(o.dias) || 1))
  const de = somarDias(o.hoje, -(dias - 1))
  const resumo: Resumo = { de, ate: o.hoje, dias, linhas: 0, janelas: 0, pedidos: 0, descartadas: 0, parcial: false }
  for (const [jde, jate] of janelas(de, o.hoje)) {
    if (resumo.janelas > 0 && passou()) { resumo.parcial = true; break }
    const r = await consultarJanela({ token, propriedade: o.propriedade, de: jde, ate: jate, fetcher: o.fetcher, email: o.conta.client_email, limite: o.limite, deveParar: passou })
    const { linhas, descartadas } = converterLinhas(r.linhas, hosts)
    const diasInteiros = r.completo ? [...new Set(linhas.map((l) => l.dia))].sort() : null
    const pedacos = emPedacos(linhas, o.pedaco ?? PEDACO)
    for (let i = 0; i < pedacos.length; i++) await o.gravar(pedacos[i], i === pedacos.length - 1 ? diasInteiros : null)
    resumo.linhas += linhas.length
    resumo.descartadas += descartadas
    resumo.pedidos += r.pedidos
    resumo.janelas++
    if (!r.completo) { resumo.parcial = true; break }
  }
  return resumo
}
