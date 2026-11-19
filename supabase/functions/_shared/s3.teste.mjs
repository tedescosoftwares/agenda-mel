// node supabase/functions/_shared/s3.teste.mjs
// A assinatura do S3 (s3.js) contra os exemplos publicados pela AWS na documentação da Signature Version 4
// ("Authenticating Requests: Using the Authorization Header" e "Using Query Parameters"): as mesmas chaves de exemplo,
// a mesma data, e a assinatura tem de sair igual, caractere por caractere.
import assert from 'node:assert/strict'
import { assinatura, urlAssinada, urlDeEnvio, chamarS3, sha256Hex, configDoS3, chaveValida, urlPublica, existeNoS3, apagarDoS3, CACHE_FOTO } from './s3.js'

const EX = { chaveId: 'AKIAIOSFODNN7EXAMPLE', segredo: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', bucket: 'examplebucket', regiao: 'us-east-1' }
const HOST = 'examplebucket.s3.amazonaws.com' // os exemplos usam o endereço sem a região
const VAZIO = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const DIA = '20130524T000000Z'
let n = 0
const caso = async (nome, f) => { await f(); n++; console.log('  ✓', nome) }

await caso('GET com Range (cabeçalho Authorization)', async () => {
  const { assinatura: a } = await assinatura({ segredo: EX.segredo, regiao: EX.regiao, metodo: 'GET', caminho: '/test.txt',
    cabecalhos: { host: HOST, range: 'bytes=0-9', 'x-amz-content-sha256': VAZIO, 'x-amz-date': DIA }, corpoHash: VAZIO, amz: DIA })
  assert.equal(a, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
})

await caso('PUT com $ no nome e o hash do corpo', async () => {
  const corpo = await sha256Hex('Welcome to Amazon S3.')
  assert.equal(corpo, '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072')
  const { assinatura: a } = await assinatura({ segredo: EX.segredo, regiao: EX.regiao, metodo: 'PUT', caminho: '/test%24file.text',
    cabecalhos: { host: HOST, date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-date': DIA, 'x-amz-storage-class': 'REDUCED_REDUNDANCY', 'x-amz-content-sha256': corpo },
    corpoHash: corpo, amz: DIA })
  assert.equal(a, '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd')
})

await caso('GET ?lifecycle (parâmetro sem valor)', async () => {
  const { assinatura: a } = await assinatura({ segredo: EX.segredo, regiao: EX.regiao, metodo: 'GET', caminho: '/', query: { lifecycle: '' },
    cabecalhos: { host: HOST, 'x-amz-content-sha256': VAZIO, 'x-amz-date': DIA }, corpoHash: VAZIO, amz: DIA })
  assert.equal(a, 'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543')
})

await caso('GET ?max-keys=2&prefix=J (parâmetros em ordem)', async () => {
  const { assinatura: a } = await assinatura({ segredo: EX.segredo, regiao: EX.regiao, metodo: 'GET', caminho: '/', query: { prefix: 'J', 'max-keys': '2' },
    cabecalhos: { host: HOST, 'x-amz-content-sha256': VAZIO, 'x-amz-date': DIA }, corpoHash: VAZIO, amz: DIA })
  assert.equal(a, '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7')
})

await caso('URL pré-assinada (o exemplo de 24 horas da AWS)', async () => {
  const url = await urlAssinada(EX, 'GET', 'test.txt', { expira: 86400, agora: new Date('2013-05-24T00:00:00Z'), host: HOST })
  assert.equal(url, 'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')
})

await caso('URL de envio: PUT no endereço com a região, tipo e cache assinados', async () => {
  const c = { ...EX, bucket: 'mimo-guia-fotos', regiao: 'sa-east-1', publico: 'https://img.mimo.com.vc' }
  const { url, cabecalhos } = await urlDeEnvio(c, 'abc/123-p.jpg', { agora: new Date('2026-11-19T12:00:00Z') })
  const u = new URL(url)
  assert.equal(u.host, 'mimo-guia-fotos.s3.sa-east-1.amazonaws.com')
  assert.equal(u.pathname, '/abc/123-p.jpg')
  assert.equal(u.searchParams.get('X-Amz-SignedHeaders'), 'cache-control;content-type;host')
  assert.equal(u.searchParams.get('X-Amz-Expires'), '900')
  assert.equal(u.searchParams.get('X-Amz-Credential'), 'AKIAIOSFODNN7EXAMPLE/20261119/sa-east-1/s3/aws4_request')
  assert.match(u.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/)
  assert.deepEqual(cabecalhos, { 'Content-Type': 'image/jpeg', 'Cache-Control': CACHE_FOTO })
  // a assinatura muda se o tipo mudar (ninguém grava outra coisa com a mesma URL)
  const outra = await urlDeEnvio(c, 'abc/123-p.jpg', { tipo: 'text/html', agora: new Date('2026-11-19T12:00:00Z') })
  assert.notEqual(new URL(outra.url).searchParams.get('X-Amz-Signature'), u.searchParams.get('X-Amz-Signature'))
})

await caso('chamada do servidor: cabeçalhos certos e 404 vira "não existe"', async () => {
  const c = { ...EX, bucket: 'mimo-guia-fotos', regiao: 'sa-east-1' }
  const vistos = []
  const buscar = async (url, init) => { vistos.push({ url, init }); return new Response(null, { status: vistos.length === 1 ? 404 : 204 }) }
  assert.equal(await existeNoS3(c, 'x/y.jpg', { buscar }), false)
  assert.equal(await apagarDoS3(c, 'x/y.jpg', { buscar }), true)
  assert.equal(vistos[0].url, 'https://mimo-guia-fotos.s3.sa-east-1.amazonaws.com/x/y.jpg')
  assert.equal(vistos[0].init.method, 'HEAD')
  assert.equal(vistos[1].init.method, 'DELETE')
  const h = vistos[0].init.headers
  assert.equal(h['x-amz-content-sha256'], 'UNSIGNED-PAYLOAD')
  assert.match(h.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/sa-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/)
  assert.equal(h.host, undefined) // o fetch põe o host; mandar de novo é proibido em alguns runtimes
  // 403 (chave errada) não é "não existe"
  await assert.rejects(existeNoS3(c, 'x/y.jpg', { buscar: async () => new Response('<Error>AccessDenied</Error>', { status: 403 }) }), /403/)
  // e o PUT do servidor leva o tipo e o cache assinados
  let put
  await chamarS3(c, 'PUT', 'x/y.jpg', { corpo: new Uint8Array([1]), tipo: 'image/jpeg', cache: CACHE_FOTO, buscar: async (u, i) => { put = i; return new Response(null, { status: 200 }) } })
  assert.match(put.headers.authorization, /SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date,/)
})

await caso('configuração: sem as chaves é null; o resto tem padrão', async () => {
  assert.equal(configDoS3(() => undefined), null)
  assert.equal(configDoS3((k) => ({ AWS_FOTOS_CHAVE_ID: 'a' })[k]), null)
  const c = configDoS3((k) => ({ AWS_FOTOS_CHAVE_ID: ' AKIA ', AWS_FOTOS_CHAVE_SECRETA: 's\n' })[k])
  assert.deepEqual(c, { chaveId: 'AKIA', segredo: 's', bucket: 'mimo-guia-fotos', regiao: 'sa-east-1', publico: 'https://img.mimo.com.vc' })
  assert.equal(urlPublica(c, 'a/b.jpg'), 'https://img.mimo.com.vc/a/b.jpg')
})

await caso('nomes de objeto aceitos e recusados', async () => {
  for (const ok of ['3f2a/abc123.jpg', '3f2a/dono-abc.webp', 'cidades/santos/abc-p.jpg', 'regioes/abc/x.jpg', 'teste-s3/mimo-1.txt']) assert.ok(chaveValida(ok), ok)
  for (const ruim of ['', '/a.jpg', 'a/../b.jpg', 'a//b.jpg', 'a/b/', 'a b.jpg', 'a/b.jpg?x=1', '..', 'a\\b.jpg', 'á/b.jpg']) assert.ok(!chaveValida(ruim), ruim)
})

console.log(`${n} casos`)
