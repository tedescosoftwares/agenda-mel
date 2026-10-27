// IndexNow: avisa o Bing (e Yandex, Seznam, Naver, Yep, que dividem o protocolo) na hora em
// que uma página do site nasce, muda ou some, em vez de esperar o robô passar. O Google não
// participa; lá segue o sitemap.
//
//   node scripts/indexnow.mjs                compara dist/sitemap.xml com o último aviso e manda só o que mudou
//   node scripts/indexnow.mjs --tudo         manda todas as URLs do sitemap (a primeira vez, ou depois de uma mudança grande)
//   node scripts/indexnow.mjs --simular      mostra o que mandaria, sem mandar
//   node scripts/indexnow.mjs --gerar-chave  cria a chave e grava INDEXNOW_KEY no evolution/.env
//   node scripts/indexnow.mjs --so-chave     só grava dist/<chave>.txt (antes de pôr a versão no ar, 3.74.3)
//   node scripts/indexnow.mjs --se-pendente  avisa só se o sitemap mudou desde o último aviso, e em silêncio se não
//
// 3.75: o sitemap.xml virou índice (sitemaps/<grupo>.xml); as URLs são lidas das partes (scripts/sitemaps.mjs), e o
// último aviso guarda todas as URLs num arquivo só.
//
// A chave vem de INDEXNOW_KEY (o .env da Evolution ou o da raiz, que os scripts do VPS já
// carregam). O script grava dist/<chave>.txt a cada rodada, que é como o Bing confere que a
// chave é sua (https://mimo.com.vc/<chave>.txt), e guarda o último sitemap avisado em
// evolution/indexnow-ultimo.xml (fora do dist, que o build apaga). O republicar-se-mudou.sh
// chama isto depois de regenerar as páginas; o publicar-site.sh, depois do build.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { lerSitemapCompleto } from './sitemaps.mjs'

export const URL_INDEXNOW = globalThis.process.env.INDEXNOW_URL || 'https://api.indexnow.org/indexnow'
export const LOTE = 10000 // o protocolo aceita até 10.000 URLs por aviso

// o sitemap vira { url -> lastmod }
export function lerSitemap(xml) {
  const mapa = new Map()
  for (const m of String(xml ?? '').matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(m[1])?.[1]
    if (!loc) continue
    mapa.set(loc, /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/.exec(m[1])?.[1] ?? '')
  }
  return mapa
}

// o que mudou entre o último aviso e o sitemap de agora: URL nova, lastmod diferente, ou URL que sumiu
export function diferenca(anterior, atual) {
  const mudadas = []
  for (const [url, lastmod] of atual) if (!anterior.has(url) || anterior.get(url) !== lastmod) mudadas.push(url)
  const sumidas = [...anterior.keys()].filter((u) => !atual.has(u))
  return { mudadas, sumidas }
}

export const hostDe = (urls) => { for (const u of urls) { try { return new URL(u).host } catch { /* segue */ } } return '' }

// o que o Bing vê quando busca o arquivo da chave ('' se não responde)
async function chaveNoAr(keyLocation, buscar) {
  try { const r = await buscar(keyLocation); return r.ok ? (await r.text()).trim() : '' } catch { return '' }
}

export async function enviar({ host, chave, urls, buscar = fetch, simular = false, esperar = 30, avisar = console.log }) {
  const lotes = []
  for (let i = 0; i < urls.length; i += LOTE) lotes.push(urls.slice(i, i + LOTE))
  const resultados = []
  const keyLocation = `https://${host}/${chave}.txt`
  for (const lote of lotes) {
    const corpo = { host, key: chave, keyLocation, urlList: lote }
    if (simular) { resultados.push({ n: lote.length, status: 'simulado' }); continue }
    const pedido = { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(corpo) }
    let r = await buscar(URL_INDEXNOW, pedido)
    if (r.status === 403) {
      // chave nova: o Bing busca o arquivo na primeira vez e às vezes responde 403 antes de
      // terminar de conferir (aceitou uns minutos depois, na prática). Se o arquivo está no
      // ar, espera e tenta mais uma vez; se não está, o problema é nosso e não adianta esperar
      if ((await chaveNoAr(keyLocation, buscar)) !== chave) throw new Error(`IndexNow respondeu 403 e ${keyLocation} não devolve a chave: o Bing não consegue conferir que o site é seu (o arquivo está no ar? responde 200, texto puro?)`)
      avisar(`IndexNow: 403 na primeira tentativa, mas ${keyLocation} está no ar; esperando ${esperar} s para tentar de novo…`)
      if (esperar) await new Promise((f) => setTimeout(f, esperar * 1000))
      r = await buscar(URL_INDEXNOW, pedido)
    }
    resultados.push({ n: lote.length, status: r.status })
    if (r.status >= 400) {
      const motivo = { 400: 'pedido inválido', 403: 'o Bing ainda não aceitou a chave nova (o arquivo está no ar; costuma aceitar em minutos, e a próxima rodada tenta de novo)', 422: 'URL de outro host', 429: 'avisos demais: tente mais tarde' }[r.status] ?? 'erro'
      throw new Error(`IndexNow respondeu ${r.status}: ${motivo}`)
    }
  }
  return resultados
}

// a chave do .env da Evolution ou do da raiz, quando não veio pelo ambiente (os scripts do
// VPS carregam o .env antes; na mão, "node scripts/indexnow.mjs --simular" também funciona)
export function chaveDoEnv(raiz) {
  for (const arq of [path.join(raiz, 'evolution', '.env'), path.join(raiz, '.env')]) {
    try {
      const m = /^\s*(?:export\s+)?INDEXNOW_KEY=["']?([A-Za-z0-9-]{8,128})["']?\s*$/m.exec(fs.readFileSync(arq, 'utf8'))
      if (m) return m[1]
    } catch { /* sem o arquivo: tenta o próximo */ }
  }
  return ''
}

export function gerarChave() { return crypto.randomBytes(16).toString('hex') }

export async function rodar({ raiz = globalThis.process.cwd(), chave = globalThis.process.env.INDEXNOW_KEY, tudo = false, simular = false, soChave = false, buscar = fetch, esperar = 30, avisar = console.log } = {}) {
  chave = chave || chaveDoEnv(raiz)
  const dist = path.join(raiz, 'dist')
  const caminhoSitemap = path.join(dist, 'sitemap.xml')
  const caminhoUltimo = path.join(raiz, 'evolution', 'indexnow-ultimo.xml')
  if (!chave || !/^[A-Za-z0-9-]{8,128}$/.test(chave)) throw new Error('Falta INDEXNOW_KEY no .env (rode: node scripts/indexnow.mjs --gerar-chave)')
  if (!fs.existsSync(caminhoSitemap)) throw new Error(`Não existe ${caminhoSitemap}: gere as páginas estáticas antes`)
  // o arquivo da chave, que o Bing confere; o build apaga o dist, por isso é regravado toda vez
  fs.writeFileSync(path.join(dist, `${chave}.txt`), chave)
  if (soChave) return { host: '', mudadas: 0, sumidas: 0, total: 0, resultados: [], soChave: true }
  // 3.75: todas as URLs, das partes do índice (ou do arquivo único de antes)
  const xmlAtual = lerSitemapCompleto(dist)
  const atual = lerSitemap(xmlAtual)
  const anterior = !tudo && fs.existsSync(caminhoUltimo) ? lerSitemap(fs.readFileSync(caminhoUltimo, 'utf8')) : new Map()
  const { mudadas, sumidas } = diferenca(anterior, atual)
  const urls = [...mudadas, ...sumidas]
  const host = hostDe(atual.keys())
  const fim = (resultados) => {
    if (!simular) fs.writeFileSync(caminhoUltimo, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...xmlAtual.matchAll(/<url>[\s\S]*?<\/url>/g)].map((m) => `  ${m[0]}`).join('\n')}\n</urlset>\n`)
    return { host, mudadas: mudadas.length, sumidas: sumidas.length, total: atual.size, resultados }
  }
  if (!urls.length) return fim([])
  if (!host) throw new Error('não achei o host nas URLs do sitemap')
  return fim(await enviar({ host, chave, urls, buscar, simular, esperar, avisar }))
}

async function main() {
  const args = new Set(globalThis.process.argv.slice(2))
  if (args.has('--gerar-chave')) {
    const env = path.join(globalThis.process.cwd(), 'evolution', '.env')
    const atual = fs.existsSync(env) ? fs.readFileSync(env, 'utf8') : ''
    const ja = /^INDEXNOW_KEY=([A-Za-z0-9-]{8,128})\s*$/m.exec(atual)
    if (ja) { console.log(`Já existe uma chave em evolution/.env: ${ja[1]}`); return }
    const chave = gerarChave()
    // preenche a linha vazia do .env.exemplo, se houver; senão acrescenta no fim
    const novo = /^INDEXNOW_KEY=\s*$/m.test(atual) ? atual.replace(/^INDEXNOW_KEY=\s*$/m, `INDEXNOW_KEY=${chave}`) : `${atual}${atual && !atual.endsWith('\n') ? '\n' : ''}INDEXNOW_KEY=${chave}\n`
    fs.writeFileSync(env, novo)
    console.log(`Chave gravada em evolution/.env: ${chave}\nAgora rode ./republicar-se-mudou.sh --forcar na pasta evolution: ele grava dist/${chave}.txt e avisa o Bing de todas as páginas.`)
    return
  }
  const r = await rodar({ tudo: args.has('--tudo'), simular: args.has('--simular'), soChave: args.has('--so-chave') })
  if (r.soChave) return
  // a conferência de hora em hora: sem nada novo desde o último aviso, silêncio
  if (args.has('--se-pendente') && !r.mudadas && !r.sumidas) return
  const enviadas = r.resultados.reduce((s, x) => s + x.n, 0)
  console.log(`IndexNow (${r.host}): ${r.total} URLs no sitemap, ${r.mudadas} mudadas e ${r.sumidas} que sumiram${args.has('--simular') ? ' (simulação, nada enviado)' : enviadas ? `: avisadas em ${r.resultados.length} ${r.resultados.length === 1 ? 'pedido' : 'pedidos'}` : ': nada a avisar'}`)
}

if (globalThis.process.argv[1] && import.meta.url === pathToFileURL(globalThis.process.argv[1]).href) {
  main().catch((e) => { console.error(`IndexNow: ${e.message}`); globalThis.process.exit(1) })
}
