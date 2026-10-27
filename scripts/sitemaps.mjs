// O sitemap em partes (3.75): /sitemap.xml é um índice que aponta para um arquivo por grupo, e o Search Console
// passa a mostrar a indexação de cada um (quantas URLs enviadas, quantas indexadas), cidade a cidade.
//   /sitemaps/site.xml           a home, as páginas do produto, o blog, as institucionais e os termos
//   /sitemaps/guia.xml           o índice do guia (/saloes) e as páginas de região
//   /sitemaps/guia-<cidade>.xml  a cidade, as categorias, os bairros, os horários e os salões dela
// Cada arquivo fica bem abaixo do limite do protocolo (50 mil URLs ou 50 MB).
//
// lerSitemapCompleto(dir) devolve todas as entradas <url> do que está gravado em dir, no formato novo (índice e
// partes) ou no antigo (um sitemap.xml só): quem compara com a rodada anterior (as cidades mantidas, o IndexNow)
// lê dos dois jeitos.
import fs from 'node:fs'
import path from 'node:path'

export const PASTA = 'sitemaps'

// o grupo de um caminho: 'site', 'guia' ou 'guia-<cidade>'
export function grupoDoCaminho(caminho) {
  const p = String(caminho ?? '').split(/[?#]/)[0].split('/').filter(Boolean)
  if (p[0] !== 'saloes') return 'site'
  if (p.length === 1 || p[1] === 'regiao') return 'guia'
  return /^[a-z0-9-]+$/.test(p[1]) ? `guia-${p[1]}` : 'guia'
}
// o caminho de uma entrada <url> já montada ('  <url><loc>https://mimo.com.vc/saloes/x</loc>...</url>')
export function caminhoDaEntrada(entrada) {
  const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(String(entrada ?? ''))?.[1] ?? ''
  try { return new URL(loc).pathname } catch { return loc }
}
const lastmodDa = (entrada) => /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/.exec(entrada)?.[1] ?? ''
const ordemDosGrupos = (a, b) => (a === 'site' ? -1 : b === 'site' ? 1 : a === 'guia' ? -1 : b === 'guia' ? 1 : a.localeCompare(b))

// entradas: as linhas <url> prontas. Grava dist/sitemaps/<grupo>.xml e o índice dist/sitemap.xml (a pasta é
// refeita: a cidade que saiu do guia não deixa arquivo velho). Devolve { arquivos: [{ grupo, urls }], urls }
export function gravarSitemaps(dist, entradas, site) {
  const grupos = new Map()
  for (const e of entradas) {
    const g = grupoDoCaminho(caminhoDaEntrada(e))
    if (!grupos.has(g)) grupos.set(g, [])
    grupos.get(g).push(e.startsWith('  ') ? e : `  ${e.trim()}`)
  }
  const pasta = path.join(dist, PASTA)
  fs.rmSync(pasta, { recursive: true, force: true })
  fs.mkdirSync(pasta, { recursive: true })
  const arquivos = []
  const indice = []
  for (const g of [...grupos.keys()].sort(ordemDosGrupos)) {
    const linhas = grupos.get(g)
    fs.writeFileSync(path.join(pasta, `${g}.xml`), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${linhas.join('\n')}\n</urlset>\n`)
    const ultima = linhas.map(lastmodDa).filter(Boolean).sort().at(-1)
    indice.push(`  <sitemap><loc>${site}/${PASTA}/${g}.xml</loc>${ultima ? `<lastmod>${ultima}</lastmod>` : ''}</sitemap>`)
    arquivos.push({ grupo: g, urls: linhas.length })
  }
  fs.writeFileSync(path.join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indice.join('\n')}\n</sitemapindex>\n`)
  return { arquivos, urls: arquivos.reduce((s, a) => s + a.urls, 0) }
}

// todas as entradas <url> gravadas em dir ('' quando não há sitemap)
export function lerSitemapCompleto(dir) {
  let raiz
  try { raiz = fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8') } catch { return '' }
  if (!/<sitemapindex/.test(raiz)) return raiz
  const partes = []
  for (const m of raiz.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>[\s\S]*?<\/sitemap>/g)) {
    const nome = path.basename(m[1].split(/[?#]/)[0])
    try { partes.push(fs.readFileSync(path.join(dir, PASTA, nome), 'utf8')) } catch { /* parte que sumiu: segue */ }
  }
  return partes.join('\n')
}
// quantas URLs há em dir, nos dois formatos
export const contarUrls = (dir) => (lerSitemapCompleto(dir).match(/<url>/g) ?? []).length
