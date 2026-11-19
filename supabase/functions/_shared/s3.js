// O S3 da AWS sem SDK (4.3): a assinatura SigV4 feita com o WebCrypto, para as fotos do guia irem para o bucket
// mimo-guia-fotos e saírem pelo CloudFront em img.mimo.com.vc. É JavaScript puro de propósito: o mesmo arquivo roda nas
// Edge Functions (Deno: guia-fotos e guia-fotos-dono) e no Node 22 da VPS (scripts/guia/fotos-s3.mjs, a cópia das fotos
// antigas). Testado contra os exemplos da documentação da AWS (s3.teste.mjs).
//
// As chaves são de um usuário IAM que só mexe neste bucket (ler, gravar, apagar e listar, para o "não existe" vir como
// 404). Ficam nos secrets do Supabase e no evolution/.env da VPS: AWS_FOTOS_CHAVE_ID e AWS_FOTOS_CHAVE_SECRETA. O resto
// tem padrão e não é segredo (AWS_FOTOS_BUCKET, AWS_FOTOS_REGIAO, AWS_FOTOS_URL só para trocar um dia).

export const BUCKET_PADRAO = 'mimo-guia-fotos'
export const REGIAO_PADRAO = 'sa-east-1'
export const URL_PADRAO = 'https://img.mimo.com.vc'
// a foto nunca muda no mesmo nome (o nome sai do conteúdo): o navegador e o CloudFront guardam por um ano
export const CACHE_FOTO = 'public, max-age=31536000, immutable'
const SEM_CORPO = 'UNSIGNED-PAYLOAD'

// a configuração a partir de uma função que lê o ambiente (Deno.env.get ou (k) => process.env[k]); sem as duas chaves,
// null: quem chama segue com o Supabase Storage, como antes da 4.3
export function configDoS3(ler) {
  const chaveId = String(ler('AWS_FOTOS_CHAVE_ID') ?? '').trim()
  const segredo = String(ler('AWS_FOTOS_CHAVE_SECRETA') ?? '').trim()
  if (!chaveId || !segredo) return null
  const bucket = String(ler('AWS_FOTOS_BUCKET') ?? '').trim() || BUCKET_PADRAO
  const regiao = String(ler('AWS_FOTOS_REGIAO') ?? '').trim() || REGIAO_PADRAO
  const publico = (String(ler('AWS_FOTOS_URL') ?? '').trim() || URL_PADRAO).replace(/\/+$/, '')
  return { chaveId, segredo, bucket, regiao, publico }
}

// o nome do objeto: pastas e arquivo só com letra minúscula, número, hífen, sublinhado e ponto; nada de "..", "//" ou
// começar com barra. É o que a Plataforma e o dono mandam (<salão>/<sha>.jpg, cidades/<cidade>/<sha>.jpg...)
export const chaveValida = (k) => typeof k === 'string' && k.length <= 300 && /^[a-z0-9][a-z0-9_./-]*$/i.test(k) && !k.includes('..') && !k.includes('//') && !k.endsWith('/')

export const hostDo = (c) => `${c.bucket}.s3.${c.regiao}.amazonaws.com`
export const urlPublica = (c, chave) => `${c.publico}/${chave}`

// ---- a assinatura -------------------------------------------------------------------------------------------------------
const enc = new TextEncoder()
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
export const sha256Hex = async (dado) => hex(await crypto.subtle.digest('SHA-256', typeof dado === 'string' ? enc.encode(dado) : dado))
async function hmac(chave, msg) {
  const k = await crypto.subtle.importKey('raw', typeof chave === 'string' ? enc.encode(chave) : chave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, enc.encode(msg))
}
// a codificação que a AWS pede (RFC 3986): tudo menos A-Z a-z 0-9 - _ . ~
export const codificar = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
const caminhoDe = (chave) => '/' + String(chave).split('/').map(codificar).join('/')
// 2013-05-24T00:00:00.000Z → 20130524T000000Z
const carimbo = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

// a assinatura de um pedido (o coração da SigV4). `cabecalhos` em minúsculas; `query` sem a assinatura.
export async function assinatura({ segredo, regiao, metodo, caminho, query = {}, cabecalhos, corpoHash, amz, servico = 's3' }) {
  const dia = amz.slice(0, 8)
  const q = Object.keys(query).sort().map((k) => `${codificar(k)}=${codificar(String(query[k]))}`).join('&')
  const nomes = Object.keys(cabecalhos).map((k) => k.toLowerCase()).sort()
  const canonicos = nomes.map((k) => `${k}:${String(cabecalhos[k]).trim().replace(/\s+/g, ' ')}\n`).join('')
  const assinados = nomes.join(';')
  const pedido = [metodo, caminho, q, canonicos, assinados, corpoHash].join('\n')
  const escopo = `${dia}/${regiao}/${servico}/aws4_request`
  const texto = ['AWS4-HMAC-SHA256', amz, escopo, await sha256Hex(pedido)].join('\n')
  let k = await hmac('AWS4' + segredo, dia)
  k = await hmac(k, regiao)
  k = await hmac(k, servico)
  k = await hmac(k, 'aws4_request')
  return { assinatura: hex(await hmac(k, texto)), assinados, escopo }
}

// uma URL assinada (a assinatura vai na própria URL, vale por `expira` segundos). `extras`: cabeçalhos que entram na
// assinatura e que quem usar a URL tem de mandar iguais
export async function urlAssinada(c, metodo, chave, { extras = {}, expira = 900, agora = new Date(), host = hostDo(c) } = {}) {
  const amz = carimbo(agora)
  const caminho = caminhoDe(chave)
  const cabecalhos = { host, ...Object.fromEntries(Object.entries(extras).map(([k, v]) => [k.toLowerCase(), v])) }
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${c.chaveId}/${amz.slice(0, 8)}/${c.regiao}/s3/aws4_request`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(expira),
    'X-Amz-SignedHeaders': Object.keys(cabecalhos).sort().join(';'),
  }
  const { assinatura: a } = await assinatura({ segredo: c.segredo, regiao: c.regiao, metodo, caminho, query, cabecalhos, corpoHash: SEM_CORPO, amz })
  const q = Object.keys(query).sort().map((k) => `${codificar(k)}=${codificar(query[k])}`).join('&')
  return `https://${host}${caminho}?${q}&X-Amz-Signature=${a}`
}

// a URL de envio (PUT) que o navegador usa direto no bucket, sem passar a foto pelo Supabase. Assina também o tipo e o
// cache: o navegador tem de mandar exatamente esses dois cabeçalhos, e ninguém troca o que vai ser gravado.
export async function urlDeEnvio(c, chave, { tipo = 'image/jpeg', cache = CACHE_FOTO, expira = 900, agora = new Date() } = {}) {
  const url = await urlAssinada(c, 'PUT', chave, { extras: { 'content-type': tipo, 'cache-control': cache }, expira, agora })
  return { url, cabecalhos: { 'Content-Type': tipo, 'Cache-Control': cache } }
}

// uma chamada assinada no cabeçalho (o servidor falando com o bucket: ver se existe, gravar, apagar)
export async function chamarS3(c, metodo, chave, { corpo, tipo, cache, agora = new Date(), buscar = globalThis.fetch } = {}) {
  const amz = carimbo(agora)
  const host = hostDo(c)
  const caminho = caminhoDe(chave)
  const cabecalhos = { host, 'x-amz-content-sha256': SEM_CORPO, 'x-amz-date': amz }
  if (tipo) cabecalhos['content-type'] = tipo
  if (cache) cabecalhos['cache-control'] = cache
  const { assinatura: a, assinados, escopo } = await assinatura({ segredo: c.segredo, regiao: c.regiao, metodo, caminho, cabecalhos, corpoHash: SEM_CORPO, amz })
  const headers = { ...cabecalhos, authorization: `AWS4-HMAC-SHA256 Credential=${c.chaveId}/${escopo}, SignedHeaders=${assinados}, Signature=${a}` }
  delete headers.host
  return buscar(`https://${host}${caminho}`, { method: metodo, headers, body: corpo })
}

const falha = async (r, o_que) => { let t = ''; try { t = (await r.text()).slice(0, 300) } catch { /* sem corpo */ } return new Error(`${o_que}: o S3 respondeu ${r.status}${t ? ` (${t.replace(/\s+/g, ' ')})` : ''}`) }

// true/false; outro erro (chave errada, sem permissão) sobe, para ninguém achar que "não existe"
export async function existeNoS3(c, chave, opcoes) {
  const r = await chamarS3(c, 'HEAD', chave, opcoes)
  if (r.status === 200) return true
  if (r.status === 404) return false
  throw await falha(r, 'conferir a foto')
}
export async function gravarNoS3(c, chave, bytes, tipo = 'image/jpeg', opcoes = {}) {
  const r = await chamarS3(c, 'PUT', chave, { ...opcoes, corpo: bytes, tipo, cache: CACHE_FOTO })
  if (!r.ok) throw await falha(r, 'gravar a foto')
  try { await r.arrayBuffer() } catch { /* corpo vazio */ }
  return urlPublica(c, chave)
}
// apagar o que não existe também é 204 no S3: dá para chamar sem conferir antes
export async function apagarDoS3(c, chave, opcoes) {
  const r = await chamarS3(c, 'DELETE', chave, opcoes)
  if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw await falha(r, 'apagar a foto')
  try { await r.arrayBuffer() } catch { /* corpo vazio */ }
  return true
}
