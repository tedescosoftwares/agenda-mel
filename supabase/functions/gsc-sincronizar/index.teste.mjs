// Teste da porta da gsc-sincronizar (index.ts) inteira, no node, com o
// supabase-js de verdade e Deno, PostgREST e Google falsos:
//
//   node --experimental-strip-types supabase/functions/gsc-sincronizar/index.teste.mjs
//
// Confere: sem login 401; logado sem ser Plataforma 403 sem chamar o Google
// (o padrão do porteiro); a Plataforma busca e grava com a chave de serviço;
// o relógio (chave de serviço) passa como "relogio"; sem segredo responde
// sem_segredos; o 403 do Google vira sem_acesso com o e-mail da conta.
// As contas puras (JWT, paginação, URL) estão em gsc.teste.ts.
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { register } from 'node:module'

// o import do esm.sh (Deno) vira o supabase-js do node_modules do projeto
const raiz = new URL('../../../package.json', import.meta.url).href
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec === 'https://esm.sh/@supabase/supabase-js@2') return next('@supabase/supabase-js', { ...ctx, parentURL: ${JSON.stringify(raiz)} })
    return next(spec, ctx)
  }`))

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
const env = {
  SUPABASE_URL: 'http://supa.teste', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'servico',
  GSC_CONTA_SERVICO: JSON.stringify({ type: 'service_account', client_email: 'gsc@teste.iam.gserviceaccount.com', private_key: privateKey }),
  GSC_PROPRIEDADE: 'sc-domain:mimo.com.vc',
}
let handler = null
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }

// o "mundo": quem pediu o quê
const log = []
let googleStatus = 200
const responde = (corpo, status = 200) => new Response(corpo == null ? null : JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (entrada, init = {}) => {
  const req = entrada instanceof Request ? entrada : new Request(entrada, init)
  const url = new URL(req.url)
  const auth = req.headers.get('Authorization') ?? ''
  const texto = req.method === 'GET' ? '' : await req.text()
  const corpo = texto && req.headers.get('content-type')?.includes('json') ? JSON.parse(texto) : texto
  log.push({ host: url.host, caminho: url.pathname, auth, corpo })
  if (url.host === 'oauth2.googleapis.com') return responde({ access_token: 'ya29.x', expires_in: 3599 })
  if (url.host === 'searchconsole.googleapis.com') {
    if (googleStatus !== 200) return responde({ error: { message: 'User does not have sufficient permission' } }, googleStatus)
    return responde({ rows: [
      { keys: [corpo.endDate, 'https://mimo.com.vc/saloes/itanhaem/studio-lirio', 'manicure itanhaém', 'MOBILE'], clicks: 2, impressions: 20, position: 5 },
      { keys: [corpo.endDate, 'https://mimo.com.vc/blog/x', 'fora', 'MOBILE'], clicks: 1, impressions: 1, position: 1 },
    ] })
  }
  if (url.host === 'supa.teste') {
    if (url.pathname === '/rest/v1/rpc/eh_plataforma') return responde(auth === 'Bearer jwt-plataforma')
    if (url.pathname === '/rest/v1/rpc/site_buscas_gravar') {
      if (auth !== 'Bearer servico') return responde({ code: '42501', message: 'permission denied for function site_buscas_gravar' }, 401)
      return responde(Array.isArray(corpo.linhas) ? corpo.linhas.length : 0)
    }
    if (url.pathname === '/rest/v1/rpc/site_buscas_registrar') return auth === 'Bearer servico' ? responde(null, 204) : responde({ code: '42501', message: 'permission denied' }, 401)
    if (url.pathname === '/rest/v1/site_buscas') return responde(auth === 'Bearer servico' ? [{ dia: '2026-10-08' }] : [])
  }
  return responde({ erro: `inesperado ${req.method} ${url}` }, 599)
}

await import(new URL('./index.ts', import.meta.url).href)
assert.ok(handler, 'Deno.serve foi chamado')
const chamar = async (auth, corpo = {}) => {
  const r = await handler(new Request('http://fn/gsc-sincronizar', { method: 'POST', headers: { ...(auth ? { Authorization: auth } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }))
  return { status: r.status, corpo: await r.json() }
}
const rpcs = (nome) => log.filter((l) => l.caminho === `/rest/v1/rpc/${nome}`)

// 1. sem Authorization, GET, OPTIONS
assert.equal((await chamar(null)).status, 401)
assert.equal((await handler(new Request('http://fn', { method: 'GET' }))).status, 405)
assert.equal((await handler(new Request('http://fn', { method: 'OPTIONS' }))).status, 200)

// 2. alguém logado que não é da Plataforma: 403 (o porteiro: permission denied no gravar vazio)
log.length = 0
let r = await chamar('Bearer jwt-cliente')
assert.equal(r.status, 403, JSON.stringify(r))
assert.equal(log.filter((l) => l.host !== 'supa.teste').length, 0, 'não falou com o Google')
console.log('ok  cliente logado leva 403 e o Google nem é chamado')

// 3. a Plataforma: busca, grava com a chave de serviço (da função), anota
log.length = 0
r = await chamar('Bearer jwt-plataforma')
assert.equal(r.status, 200)
assert.equal(r.corpo.ok, true, JSON.stringify(r.corpo))
assert.equal(r.corpo.linhas, 1)
assert.equal(r.corpo.descartadas, 1)
const hoje = new Date().toISOString().slice(0, 10)
const dias = Math.round((Date.parse(hoje) - Date.parse('2026-10-08')) / 86400e3) + 5
assert.equal(r.corpo.dias, Math.max(7, dias), 'o que falta desde o último dia gravado + 5')
const gravou = rpcs('site_buscas_gravar')
assert.equal(gravou.length, 1)
assert.equal(gravou[0].auth, 'Bearer servico')
assert.deepEqual(gravou[0].corpo.linhas, [{ dia: hoje, pagina: '/saloes/itanhaem/studio-lirio', consulta: 'manicure itanhaém', aparelho: 'celular', cliques: 2, impressoes: 20, posicao: 5 }])
assert.deepEqual(gravou[0].corpo.dias_, [hoje])
const anot = rpcs('site_buscas_registrar')
assert.equal(anot.length, 1)
assert.equal(anot[0].corpo.origem_, 'plataforma')
assert.equal(anot[0].corpo.ok_, true)
console.log('ok  Plataforma: Google ->', r.corpo.linhas, 'linha gravada com a chave de serviço, execução anotada')

// 4. o relógio (chave de serviço no Authorization): o porteiro deixa, origem = relogio, pedido de dias respeitado
log.length = 0
r = await chamar('Bearer servico', { dias: 3 })
assert.equal(r.corpo.ok, true, JSON.stringify(r.corpo))
assert.equal(r.corpo.dias, 3)
assert.equal(rpcs('site_buscas_gravar').length, 2, 'um gravar vazio (o porteiro) e um de verdade')
assert.deepEqual(rpcs('site_buscas_gravar')[0].corpo.linhas, [])
assert.equal(rpcs('site_buscas_registrar')[0].corpo.origem_, 'relogio')
console.log('ok  relógio com a chave de serviço passa e anota origem relogio')

// 5. sem segredos: 200 ok:false sem_segredos, anotado, sem Google
log.length = 0
const guardado = env.GSC_CONTA_SERVICO
delete env.GSC_CONTA_SERVICO
r = await chamar('Bearer jwt-plataforma')
assert.equal(r.status, 200)
assert.deepEqual([r.corpo.ok, r.corpo.codigo], [false, 'sem_segredos'])
assert.match(r.corpo.erro, /GSC_CONTA_SERVICO/)
assert.equal(rpcs('site_buscas_registrar')[0].corpo.ok_, false)
assert.equal(log.filter((l) => l.host !== 'supa.teste').length, 0)
env.GSC_CONTA_SERVICO = guardado
console.log('ok  sem segredo: ok:false sem_segredos, anotado, sem chamar o Google')

// 6. o Google recusa (403): ok:false sem_acesso com o e-mail da conta
log.length = 0
googleStatus = 403
r = await chamar('Bearer jwt-plataforma')
assert.deepEqual([r.corpo.ok, r.corpo.codigo], [false, 'sem_acesso'])
assert.match(r.corpo.erro, /gsc@teste\.iam\.gserviceaccount\.com/)
assert.equal(rpcs('site_buscas_registrar')[0].corpo.ok_, false)
console.log('ok  Google 403: ok:false sem_acesso, com o e-mail da conta de serviço')
console.log('\nindex.ts: 6 cenários ok')
