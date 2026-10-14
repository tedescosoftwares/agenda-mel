// Testes das buscas do Google (gsc-sincronizar), sem rede e sem banco:
//
//   node --experimental-strip-types supabase/functions/gsc-sincronizar/gsc.teste.ts
//
// O Google é simulado (fetch falso): o token, as páginas do searchAnalytics
// (com paginação), os erros 403/404 e o prazo que acaba no meio. A assinatura
// do JWT é conferida de verdade com uma chave RSA gerada aqui.

import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { generateKeyPairSync, verify } from 'node:crypto'
import {
  ESCOPO, URL_TOKEN, URL_API, DIMENSOES, DIAS_MAX, ErroGsc,
  base64url, lerContaServico, montarJwt, pedirToken, normalizarPropriedade, hostsDaPropriedade, caminhoDaUrl,
  converterLinhas, somarDias, diasEntre, diasParaBuscar, janelas, emPedacos, consultarJanela, sincronizar,
} from './gsc.ts'
import type { Fetcher, LinhaGoogle, LinhaSite } from './gsc.ts'

let n = 0
async function caso(nome: string, f: () => unknown) {
  try { await f(); n++; console.log(`  ok  ${nome}`) } catch (e) { console.error(`  FALHOU  ${nome}`); throw e }
}
const decodificar = (parte: string) => JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'))
async function rejeita(p: Promise<unknown>, codigo: string, trecho?: RegExp) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ErroGsc, `esperava ErroGsc, veio ${e}`)
    assert.equal(e.codigo, codigo)
    if (trecho) assert.match(e.message, trecho)
    return true
  })
}

// uma conta de serviço de mentira, com chave RSA de verdade
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const JSON_CONTA = JSON.stringify({
  type: 'service_account', project_id: 'mimo-teste', private_key_id: 'abc123', private_key: privateKey,
  client_email: 'buscas@mimo-teste.iam.gserviceaccount.com', client_id: '1', token_uri: 'https://exemplo.invalid/roubar',
})
const conta = lerContaServico(JSON_CONTA)

// um "Google" falso: guarda os pedidos e responde o que o teste mandar
type Pedido = { url: string; init: RequestInit; corpo: Record<string, unknown> | URLSearchParams }
function googleFalso(responder: (p: Pedido, i: number) => { status?: number; corpo: unknown }) {
  const pedidos: Pedido[] = []
  const fetcher: Fetcher = async (url, init = {}) => {
    const texto = String(init.body ?? '')
    const corpo = url === URL_TOKEN ? new URLSearchParams(texto) : JSON.parse(texto || '{}')
    const p = { url, init, corpo }
    pedidos.push(p)
    const r = responder(p, pedidos.length - 1)
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { fetcher, pedidos }
}
const linha = (dia: string, pagina: string, consulta: string, aparelho = 'MOBILE', clicks = 1, impressions = 10, position = 5): LinhaGoogle =>
  ({ keys: [dia, pagina, consulta, aparelho], clicks, impressions, ctr: clicks / impressions, position })

console.log('conta de serviço')
await caso('lê o JSON como o Google baixa', () => {
  assert.equal(conta.client_email, 'buscas@mimo-teste.iam.gserviceaccount.com')
  assert.equal(conta.private_key_id, 'abc123')
  assert.match(conta.private_key, /^-----BEGIN PRIVATE KEY-----\n/)
})
await caso('aceita o JSON em base64 e a chave com \\n escrito', () => {
  const b64 = Buffer.from(JSON_CONTA).toString('base64')
  assert.equal(lerContaServico(b64).client_email, conta.client_email)
  const escapado = JSON.stringify({ type: 'service_account', client_email: 'a@b.iam.gserviceaccount.com', private_key: privateKey.replace(/\n/g, '\\n') })
  assert.ok(lerContaServico(escapado).private_key.includes('\n-----END PRIVATE KEY-----'))
})
await caso('sem segredo, JSON quebrado, sem e-mail, sem chave, tipo errado', async () => {
  await rejeita((async () => lerContaServico(''))(), 'sem_segredos', /GSC_CONTA_SERVICO/)
  await rejeita((async () => lerContaServico('{nao é json'))(), 'chave_invalida', /não é um JSON/)
  await rejeita((async () => lerContaServico(JSON.stringify({ type: 'service_account', private_key: privateKey })))(), 'chave_invalida', /client_email/)
  await rejeita((async () => lerContaServico(JSON.stringify({ type: 'service_account', client_email: 'a@b' })))(), 'chave_invalida', /private_key/)
  await rejeita((async () => lerContaServico(JSON.stringify({ type: 'authorized_user', client_email: 'a@b', private_key: privateKey })))(), 'chave_invalida', /CONTA DE SERVIÇO/)
})

console.log('JWT')
await caso('cabeçalho, corpo e assinatura RS256 conferem com a chave pública', async () => {
  const agora = 1760400000
  const jwt = await montarJwt(conta, agora)
  const partes = jwt.split('.')
  assert.equal(partes.length, 3)
  for (const p of partes) assert.match(p, /^[A-Za-z0-9_-]+$/, 'base64url sem +, / nem =')
  assert.deepEqual(decodificar(partes[0]), { alg: 'RS256', typ: 'JWT', kid: 'abc123' })
  assert.deepEqual(decodificar(partes[1]), { iss: conta.client_email, scope: ESCOPO, aud: URL_TOKEN, iat: agora, exp: agora + 3600 })
  assert.equal(ESCOPO, 'https://www.googleapis.com/auth/webmasters.readonly')
  const ok = verify('RSA-SHA256', Buffer.from(`${partes[0]}.${partes[1]}`), publicKey, Buffer.from(partes[2], 'base64url'))
  assert.ok(ok, 'a assinatura tem de bater com a chave pública')
  // mexer no corpo quebra a assinatura
  const outro = Buffer.from(JSON.stringify({ ...decodificar(partes[1]), scope: 'tudo' })).toString('base64url')
  assert.ok(!verify('RSA-SHA256', Buffer.from(`${partes[0]}.${outro}`), publicKey, Buffer.from(partes[2], 'base64url')))
})
await caso('base64url de bytes com +, / e =', () => {
  assert.equal(base64url(new Uint8Array([251, 255, 191])), '-_-_')
  assert.equal(base64url(new Uint8Array([1])), 'AQ')
})
await caso('chave privada que não abre vira chave_invalida', async () => {
  await rejeita(montarJwt({ ...conta, private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' }), 'chave_invalida')
})

console.log('token')
await caso('troca o JWT pelo access token no endereço fixo (nunca no token_uri do JSON)', async () => {
  const g = googleFalso(() => ({ corpo: { access_token: 'ya29.teste', expires_in: 3599, token_type: 'Bearer' } }))
  const token = await pedirToken(conta, g.fetcher, 1760400000)
  assert.equal(token, 'ya29.teste')
  assert.equal(g.pedidos.length, 1)
  const p = g.pedidos[0]
  assert.equal(p.url, 'https://oauth2.googleapis.com/token')
  assert.equal(p.init.method, 'POST')
  assert.equal((p.init.headers as Record<string, string>)['Content-Type'], 'application/x-www-form-urlencoded')
  const form = p.corpo as URLSearchParams
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer')
  const [c, b, s] = String(form.get('assertion')).split('.')
  assert.equal(decodificar(b).iat, 1760400000)
  assert.ok(verify('RSA-SHA256', Buffer.from(`${c}.${b}`), publicKey, Buffer.from(s, 'base64url')))
})
await caso('invalid_grant e outros erros viram mensagem que dá para agir', async () => {
  const g1 = googleFalso(() => ({ status: 400, corpo: { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' } }))
  await rejeita(pedirToken(conta, g1.fetcher), 'token_recusado', /Invalid JWT Signature.*baixe uma nova/)
  const g2 = googleFalso(() => ({ status: 500, corpo: {} }))
  await rejeita(pedirToken(conta, g2.fetcher), 'token_recusado', /500/)
})

console.log('propriedade e URL -> caminho')
await caso('normaliza a propriedade', async () => {
  assert.equal(normalizarPropriedade('sc-domain:MIMO.com.vc'), 'sc-domain:mimo.com.vc')
  assert.equal(normalizarPropriedade(' https://mimo.com.vc '), 'https://mimo.com.vc/')
  assert.equal(normalizarPropriedade('https://mimo.com.vc/'), 'https://mimo.com.vc/')
  assert.equal(normalizarPropriedade('mimo.com.vc'), 'sc-domain:mimo.com.vc')
  await rejeita((async () => normalizarPropriedade(''))(), 'sem_segredos', /GSC_PROPRIEDADE/)
  await rejeita((async () => normalizarPropriedade('minha propriedade'))(), 'sem_segredos', /não parece/)
})
await caso('os endereços aceitos: o domínio e o www', () => {
  assert.deepEqual(hostsDaPropriedade('sc-domain:mimo.com.vc'), ['mimo.com.vc', 'www.mimo.com.vc'])
  assert.deepEqual(hostsDaPropriedade('https://www.mimo.com.vc/'), ['mimo.com.vc', 'www.mimo.com.vc'])
})
await caso('converte a URL no caminho da página (o site inteiro)', () => {
  const h = hostsDaPropriedade('sc-domain:mimo.com.vc')
  const casos: Array<[string, string | null]> = [
    ['https://mimo.com.vc/saloes/itanhaem/studio-lirio', '/saloes/itanhaem/studio-lirio'],
    ['https://mimo.com.vc/saloes/itanhaem/studio-lirio/', '/saloes/itanhaem/studio-lirio'],
    ['http://www.mimo.com.vc/saloes/itanhaem/?utm_source=x#topo', '/saloes/itanhaem'],
    ['https://mimo.com.vc/saloes', '/saloes'],
    ['https://mimo.com.vc/saloes/', '/saloes'],
    ['https://mimo.com.vc/Saloes/Itanhaem/Unhas', '/saloes/itanhaem/unhas'],
    ['https://mimo.com.vc/saloes//itanhaem', '/saloes/itanhaem'],
    ['https://mimo.com.vc/saloes/itanhaem/bairro/centro', '/saloes/itanhaem/bairro/centro'],
    ['https://mimo.com.vc/saloes/itanhaem/studio-l%C3%ADrio', '/saloes/itanhaem/studio-lírio'], // decodificado (o guia não tem esse slug, mas a página conta)
    ['https://mimo.com.vc/saloesx', '/saloesx'],
    ['https://mimo.com.vc/blog/saloes', '/blog/saloes'],
    ['https://mimo.com.vc/', '/'],
    ['https://mimo.com.vc/Planos/', '/planos'],
    ['https://mimo.com.vc/blog/um-titulo-grande/?utm_source=ig', '/blog/um-titulo-grande'],
    ['https://mimo.com.vc/' + 'a'.repeat(500), null], // comprido demais
    ['https://studiomel.mimo.com.vc/saloes/itanhaem', null], // subdomínio de salão
    ['https://outro.com/saloes/itanhaem', null],
    ['não é url', null],
  ]
  for (const [url, esperado] of casos) assert.equal(caminhoDaUrl(url, h), esperado, url)
  // sem lista de endereços, qualquer domínio serve
  assert.equal(caminhoDaUrl('https://outro.com/saloes/itanhaem'), '/saloes/itanhaem')
})
await caso('converterLinhas filtra, mapeia o aparelho e soma repetidas pesando a posição', () => {
  const h = hostsDaPropriedade('sc-domain:mimo.com.vc')
  const { linhas, descartadas } = converterLinhas([
    linha('2026-10-01', 'https://mimo.com.vc/saloes/itanhaem/studio-lirio', 'manicure itanhaém', 'MOBILE', 2, 10, 4),
    linha('2026-10-01', 'http://mimo.com.vc/saloes/itanhaem/studio-lirio/', 'manicure itanhaém', 'MOBILE', 1, 30, 8),
    linha('2026-10-01', 'https://mimo.com.vc/saloes/itanhaem/studio-lirio', 'manicure itanhaém', 'DESKTOP', 0, 5, 12.5),
    linha('2026-10-01', 'https://mimo.com.vc/saloes/itanhaem', '  salão de beleza\u0000 centro itanhaém ', 'TABLET', 0, 2, 9),
    linha('2026-10-01', 'https://mimo.com.vc/blog/x', 'blog entra', 'MOBILE', 1, 4, 2),
    linha('2026-10-01', 'https://outro.com/saloes/itanhaem', 'fora', 'MOBILE'),
    linha('2026-10-01', 'https://mimo.com.vc/saloes/itanhaem', '', 'MOBILE'),
    linha('2026-10-01', 'https://mimo.com.vc/saloes/itanhaem', 'tv', 'TV'),
    linha('ontem', 'https://mimo.com.vc/saloes/itanhaem', 'data ruim', 'MOBILE'),
    { keys: [] },
  ], h)
  assert.equal(descartadas, 5)
  assert.equal(linhas.length, 4)
  assert.equal(linhas.find((l) => l.pagina === '/blog/x')?.consulta, 'blog entra')
  const cel = linhas.find((l) => l.aparelho === 'celular') as LinhaSite
  assert.deepEqual(cel, { dia: '2026-10-01', pagina: '/saloes/itanhaem/studio-lirio', consulta: 'manicure itanhaém', aparelho: 'celular', cliques: 3, impressoes: 40, posicao: 7 })
  assert.equal(linhas.find((l) => l.aparelho === 'computador')?.posicao, 12.5)
  assert.equal(linhas.find((l) => l.aparelho === 'tablet')?.consulta, 'salão de beleza centro itanhaém')
})

console.log('datas e janelas')
await caso('somar dias, dias entre e janelas de 30 da mais nova para a mais velha', () => {
  assert.equal(somarDias('2026-03-01', -1), '2026-02-28')
  assert.equal(somarDias('2024-02-28', 1), '2024-02-29')
  assert.equal(diasEntre('2026-09-30', '2026-10-14'), 14)
  assert.deepEqual(janelas('2026-10-01', '2026-10-14'), [['2026-10-01', '2026-10-14']])
  const j = janelas(somarDias('2026-10-14', -(DIAS_MAX - 1)), '2026-10-14')
  assert.equal(j.length, 16)
  assert.deepEqual(j[0], ['2026-09-15', '2026-10-14'])
  assert.equal(j.at(-1)?.[0], somarDias('2026-10-14', -(DIAS_MAX - 1)))
  // sem buraco e sem sobreposição
  for (let i = 1; i < j.length; i++) assert.equal(somarDias(j[i][1], 1), j[i - 1][0])
  const total = j.reduce((s, [a, b]) => s + diasEntre(a, b) + 1, 0)
  assert.equal(total, DIAS_MAX)
})
await caso('quantos dias buscar', () => {
  assert.equal(diasParaBuscar(null, '2026-10-14'), DIAS_MAX) // primeira vez: tudo
  assert.equal(diasParaBuscar('2026-10-11', '2026-10-14'), 8) // 3 dias de atraso + 5 de folga
  assert.equal(diasParaBuscar('2026-10-13', '2026-10-14'), 7) // no mínimo uma semana
  assert.equal(diasParaBuscar('2025-01-01', '2026-10-14'), DIAS_MAX)
  assert.equal(diasParaBuscar('2026-10-11', '2026-10-14', 30), 30) // o pedido manda
  assert.equal(diasParaBuscar('2026-10-11', '2026-10-14', 9999), DIAS_MAX)
  assert.equal(diasParaBuscar('2026-10-11', '2026-10-14', 'abc'), 8)
  assert.equal(diasParaBuscar('2026-10-11', '2026-10-14', 0), 8)
})
await caso('em pedaços', () => {
  assert.deepEqual(emPedacos([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(emPedacos([], 2), [])
})

console.log('searchAnalytics.query')
const PROP = 'sc-domain:mimo.com.vc'
const URL_QUERY = `${URL_API}/sc-domain%3Amimo.com.vc/searchAnalytics/query`
await caso('pagina com rowLimit/startRow até vir menos que o limite', async () => {
  const tamanhos = [3, 3, 1]
  const g = googleFalso((p) => {
    const ini = Number((p.corpo as Record<string, unknown>).startRow) / 3
    return { corpo: { rows: Array.from({ length: tamanhos[ini] }, (_, k) => linha('2026-10-01', 'https://mimo.com.vc/saloes/itanhaem', `busca ${ini}-${k}`)), responseAggregationType: 'byPage' } }
  })
  const r = await consultarJanela({ token: 'ya29.x', propriedade: PROP, de: '2026-09-15', ate: '2026-10-14', fetcher: g.fetcher, limite: 3 })
  assert.equal(r.linhas.length, 7)
  assert.equal(r.pedidos, 3)
  assert.ok(r.completo)
  assert.deepEqual(g.pedidos.map((p) => (p.corpo as Record<string, unknown>).startRow), [0, 3, 6])
  const p = g.pedidos[0]
  assert.equal(p.url, URL_QUERY)
  assert.equal((p.init.headers as Record<string, string>).Authorization, 'Bearer ya29.x')
  const corpo = p.corpo as Record<string, unknown>
  assert.deepEqual(corpo.dimensions, DIMENSOES)
  assert.deepEqual(DIMENSOES, ['date', 'page', 'query', 'device'])
  assert.equal(corpo.startDate, '2026-09-15')
  assert.equal(corpo.endDate, '2026-10-14')
  assert.equal(corpo.rowLimit, 3)
  assert.equal(corpo.type, 'web')
  assert.equal(corpo.dimensionFilterGroups, undefined) // o site inteiro: o banco separa as seções
})
await caso('quando o total é múltiplo do limite, a página vazia encerra; sem rows também', async () => {
  const g = googleFalso((p) => ({ corpo: Number((p.corpo as Record<string, unknown>).startRow) < 4 ? { rows: [linha('2026-10-01', 'https://mimo.com.vc/saloes', 'a'), linha('2026-10-01', 'https://mimo.com.vc/saloes', 'b')] } : {} }))
  const r = await consultarJanela({ token: 't', propriedade: PROP, de: '2026-10-01', ate: '2026-10-14', fetcher: g.fetcher, limite: 2 })
  assert.equal(r.linhas.length, 4)
  assert.equal(r.pedidos, 3)
  assert.ok(r.completo)
})
await caso('o teto de páginas e o prazo param a janela como incompleta', async () => {
  const g = googleFalso(() => ({ corpo: { rows: [linha('2026-10-01', 'https://mimo.com.vc/saloes', 'a'), linha('2026-10-01', 'https://mimo.com.vc/saloes', 'b')] } }))
  const r = await consultarJanela({ token: 't', propriedade: PROP, de: '2026-10-01', ate: '2026-10-14', fetcher: g.fetcher, limite: 2, maxPaginas: 3 })
  assert.equal(r.pedidos, 3)
  assert.equal(r.completo, false)
  let k = 0
  const r2 = await consultarJanela({ token: 't', propriedade: PROP, de: '2026-10-01', ate: '2026-10-14', fetcher: g.fetcher, limite: 2, deveParar: () => ++k > 1 })
  assert.equal(r2.pedidos, 2)
  assert.equal(r2.completo, false)
})
await caso('403, API desligada e 404 viram o passo que falta', async () => {
  const sem = googleFalso(() => ({ status: 403, corpo: { error: { code: 403, message: "User does not have sufficient permission for site 'sc-domain:mimo.com.vc'." } } }))
  await rejeita(consultarJanela({ token: 't', propriedade: PROP, de: '2026-10-01', ate: '2026-10-14', fetcher: sem.fetcher, email: conta.client_email }), 'sem_acesso', /buscas@mimo-teste\.iam\.gserviceaccount\.com.*Usuários e permissões/)
  const api = googleFalso(() => ({ status: 403, corpo: { error: { message: 'Google Search Console API has not been used in project 1 before or it is disabled.' } } }))
  await rejeita(consultarJanela({ token: 't', propriedade: PROP, de: '2026-10-01', ate: '2026-10-14', fetcher: api.fetcher }), 'api_desligada', /Biblioteca/)
  const nada = googleFalso(() => ({ status: 404, corpo: { error: { message: 'Not found' } } }))
  await rejeita(consultarJanela({ token: 't', propriedade: PROP, de: '2026-10-01', ate: '2026-10-14', fetcher: nada.fetcher }), 'sem_propriedade', /GSC_PROPRIEDADE/)
})

console.log('sincronizar (tudo junto)')
// o Google falso de verdade: token, e para cada janela devolve um dia com
// duas buscas por página; a janela mais nova vem paginada
function googleCompleto(rowsPorJanela: (de: string, ate: string, startRow: number) => LinhaGoogle[]) {
  return googleFalso((p) => {
    if (p.url === URL_TOKEN) return { corpo: { access_token: 'ya29.sync', expires_in: 3599 } }
    const c = p.corpo as Record<string, unknown>
    return { corpo: { rows: rowsPorJanela(String(c.startDate), String(c.endDate), Number(c.startRow)) } }
  })
}
await caso('busca as janelas, grava em pedaços e manda os dias inteiros no último pedaço', async () => {
  const g = googleCompleto((de, ate, startRow) => {
    if (ate !== '2026-10-14') return [linha(de, 'https://mimo.com.vc/saloes/itanhaem', 'velha')]
    const todas = [
      linha('2026-10-10', 'https://mimo.com.vc/saloes/itanhaem/studio-lirio', 'manicure itanhaém'),
      linha('2026-10-10', 'https://mimo.com.vc/saloes/itanhaem/studio-lirio', 'manicure itanhaém', 'DESKTOP'),
      linha('2026-10-11', 'https://mimo.com.vc/saloes/itanhaem', 'salão de beleza centro itanhaém'),
      linha('2026-10-11', 'https://studiomel.mimo.com.vc/p/x', 'fora: subdomínio de salão'),
      linha('2026-10-11', 'https://mimo.com.vc/saloes/itanhaem/unhas', 'unha em gel itanhaém'),
    ]
    return todas.slice(startRow, startRow + 2)
  })
  const gravados: Array<{ linhas: LinhaSite[]; dias: string[] | null }> = []
  const resumo = await sincronizar({
    conta, propriedade: PROP, dias: 45, hoje: '2026-10-14', fetcher: g.fetcher, limite: 2, pedaco: 2,
    gravar: async (linhas, dias) => { gravados.push({ linhas, dias }) },
  })
  assert.deepEqual(resumo, { de: '2026-08-31', ate: '2026-10-14', dias: 45, linhas: 5, janelas: 2, pedidos: 4, descartadas: 1, parcial: false })
  // janela nova: 4 linhas do site em 2 pedaços, dias só no último; janela velha: 1 linha
  assert.deepEqual(gravados.map((x) => [x.linhas.length, x.dias]), [[2, null], [2, ['2026-10-10', '2026-10-11']], [1, ['2026-08-31']]])
  assert.equal(g.pedidos[0].url, URL_TOKEN)
  assert.deepEqual(g.pedidos.slice(1).map((p) => [(p.corpo as Record<string, unknown>).startDate, (p.corpo as Record<string, unknown>).endDate, (p.corpo as Record<string, unknown>).startRow]),
    [['2026-09-15', '2026-10-14', 0], ['2026-09-15', '2026-10-14', 2], ['2026-09-15', '2026-10-14', 4], ['2026-08-31', '2026-09-14', 0]])
})
await caso('sem nenhuma linha, nada é gravado nem apagado', async () => {
  const g = googleCompleto(() => [])
  const gravados: unknown[] = []
  const r = await sincronizar({ conta, propriedade: PROP, dias: 10, hoje: '2026-10-14', fetcher: g.fetcher, gravar: async (l, d) => { gravados.push([l, d]) } })
  assert.equal(r.linhas, 0)
  assert.equal(gravados.length, 0)
})
await caso('o prazo acaba: para entre janelas, devolve parcial e não limpa a janela cortada', async () => {
  let relogio = 0
  const g = googleCompleto((de, _ate, startRow) => {
    relogio += 60000 // cada pedido "leva" um minuto, e toda página vem cheia
    return [linha(de, 'https://mimo.com.vc/saloes', `a${startRow}`), linha(de, 'https://mimo.com.vc/saloes', `b${startRow}`)]
  })
  const gravados: Array<string[] | null> = []
  const r = await sincronizar({
    conta, propriedade: PROP, dias: 120, hoje: '2026-10-14', fetcher: g.fetcher, limite: 2, prazoMs: 100000, agora: () => relogio,
    gravar: async (_l, d) => { gravados.push(d) },
  })
  // janela 1: pedido 1 (1 min), pedido 2 (2 min, passou do prazo) -> para incompleta e não segue
  assert.equal(r.parcial, true)
  assert.equal(r.janelas, 1)
  assert.equal(r.pedidos, 2)
  assert.equal(r.linhas, 4)
  assert.deepEqual(gravados, [null], 'gravou o que veio, sem apagar nada')
})
await caso('erro do banco ao gravar sobe (a função anota e responde ok:false)', async () => {
  const g = googleCompleto(() => [linha('2026-10-10', 'https://mimo.com.vc/saloes', 'a')])
  await assert.rejects(sincronizar({ conta, propriedade: PROP, dias: 5, hoje: '2026-10-14', fetcher: g.fetcher, gravar: async () => { throw new ErroGsc('banco', 'caiu') } }), /caiu/)
})

console.log(`\n${n} casos ok`)
