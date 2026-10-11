// Roda depois do vite build. Para cada rota pública gera um
// dist/<rota>/index.html: o mesmo index.html do app, com title,
// description, canonical, Open Graph e dados estruturados (JSON-LD)
// daquela página. O Caddy tenta {path}/index.html antes de cair no
// index.html geral, então o robô do Google e o do WhatsApp leem o certo
// sem rodar JavaScript; a pessoa recebe o app, que renderiza a página.
// A home ganha dist/_home.html (o Caddy entrega em "/"), porque o
// index.html comum atende qualquer rota e não pode ter canonical fixo.
// Também escreve o sitemap.xml.
//
// A lista de rotas vem do código (src/conteudo) e, quando as chaves do
// Supabase estão no ambiente (como no VPS), do banco: a plataforma
// edita title, description e capa; artigos criados por lá ganham a
// própria página. Uma rota do banco que o app não tem como tela é
// ignorada (viraria 404). O que está em rascunho ou noindex fica fora
// do sitemap. Nada do banco derruba a geração: se der erro, segue com
// o código e avisa.
import fs from 'node:fs'
import path from 'node:path'
import { ARTIGOS, CATEGORIAS } from '../src/conteudo/artigos.js'
import { PAGINAS_SEO, PAGINAS_INSTITUCIONAIS } from '../src/conteudo/paginasSeo.js'
import { TITULO as TITULO_HOME, DESCRICAO as DESCRICAO_HOME, JSON_LD as HOME_LD } from '../src/conteudo/home.js'

const SITE = 'https://mimo.com.vc'
const DIST = path.resolve('dist')
const DATA_PADRAO = '2026-09-23'
const base = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const dia = (v) => (v ? String(v).slice(0, 10) : undefined)

// ---- dados estruturados, no formato que o Google lê ----------------------
const { TELEFONE_LD } = await import('../src/lib/contato.js')
const ORG = { '@type': 'Organization', '@id': `${SITE}/#organization`, name: 'MIMO', url: `${SITE}/`, logo: `${SITE}/mimo-logo.svg`, contactPoint: [{ '@type': 'ContactPoint', telephone: TELEFONE_LD, contactType: 'customer service', availableLanguage: 'pt-BR' }] }
const migalhas = (itens) => ({ '@type': 'BreadcrumbList', itemListElement: itens.map(([nome, caminho], i) => ({ '@type': 'ListItem', position: i + 1, name: nome, item: SITE + caminho })) })
const faqLd = (faq) => ({ '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) })
const webPage = (p) => ({ '@type': 'WebPage', '@id': `${SITE}${p.caminho}`, url: `${SITE}${p.caminho}`, name: p.titulo, description: p.descricao, isPartOf: { '@id': `${SITE}/#website` }, inLanguage: 'pt-BR', ...(p.imagem ? { primaryImageOfPage: p.imagem } : {}), ...(p.atualizado ? { dateModified: p.atualizado } : {}) })

function ldDaPaginaSeo(p, pagina) {
  const pai = pagina.pai ? PAGINAS_SEO.find((x) => x.rota === pagina.pai) : null
  const trilha = [['Início', '/'], ...(pai ? [[pai.kicker, pai.rota]] : []), [pagina.kicker, pagina.rota]]
  return { '@context': 'https://schema.org', '@graph': [ORG, migalhas(trilha), webPage(p), ...(pagina.faq?.length ? [faqLd(pagina.faq)] : [])] }
}
function ldInstitucional(p, nome) {
  return { '@context': 'https://schema.org', '@graph': [ORG, migalhas([['Início', '/'], [nome, p.caminho]]), webPage(p)] }
}
function ldDoArtigo(p, a) {
  const cat = a.categoria ? [[a.categoria.nome, `/blog/categoria/${a.categoria.slug}`]] : []
  return {
    '@context': 'https://schema.org',
    '@graph': [
      ORG,
      migalhas([['Início', '/'], ['Blog', '/blog'], ...cat, [a.titulo, p.caminho]]),
      { '@type': 'Article', '@id': `${SITE}${p.caminho}`, mainEntityOfPage: `${SITE}${p.caminho}`, headline: a.titulo, description: p.descricao, image: p.imagem, datePublished: a.publicado, dateModified: a.atualizado || a.publicado, author: { '@type': 'Organization', name: a.autor || 'Equipe MIMO' }, publisher: { '@id': `${SITE}/#organization` }, inLanguage: 'pt-BR' },
      ...(a.faq?.length ? [faqLd(a.faq)] : []),
    ],
  }
}

// ---- o HTML de uma página -------------------------------------------------
function html(pagina) {
  const url = SITE + pagina.caminho
  const imagem = pagina.imagem || `${SITE}/og-mimo.png`
  let h = base
  h = h.replace(/<title>[^<]*<\/title>/, `<title>${esc(pagina.titulo)}</title>`)
  h = h.replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(pagina.descricao)}" />`)
  h = h.replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(pagina.titulo)}" />`)
  h = h.replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(pagina.descricao)}" />`)
  h = h.replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`)
  h = h.replace(/<meta property="og:image" content="[^"]*" \/>/, `<meta property="og:image" content="${imagem}" />`)
  h = h.replace(/<meta property="og:type" content="[^"]*" \/>/, `<meta property="og:type" content="${pagina.tipo || 'website'}" />`)
  h = h.replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${esc(pagina.titulo)}" />`)
  h = h.replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${esc(pagina.descricao)}" />`)
  h = h.replace(/<meta name="twitter:image" content="[^"]*" \/>/, `<meta name="twitter:image" content="${imagem}" />`)
  // canonical: troca se já houver um, senão acrescenta
  const canon = `<link rel="canonical" href="${url}" />`
  h = /<link rel="canonical"[^>]*>/.test(h) ? h.replace(/<link rel="canonical"[^>]*>/, canon) : h.replace('</head>', `    ${canon}\n  </head>`)
  const robots = pagina.noindex ? `<meta name="robots" content="noindex, nofollow" />` : `<meta name="robots" content="index, follow, max-image-preview:large" />`
  h = /<meta name="robots"[^>]*>/.test(h) ? h.replace(/<meta name="robots"[^>]*>/, robots) : h.replace('</head>', `    ${robots}\n  </head>`)
  if (pagina.jsonLd) {
    // o app troca este bloco pelo id quando navega de uma página para outra (src/lib/seo.js)
    const ld = `<script type="application/ld+json" id="seo-jsonld">${JSON.stringify(pagina.jsonLd).replace(/<\//g, '<\\/')}</script>`
    h = h.replace('</head>', `    ${ld}\n  </head>`)
  }
  return h
}

// ---- 1. do código ---------------------------------------------------------
const paginas = []
const conhecida = new Map() // rota -> página (para o banco sobrescrever só o que existe)
function registrar(p) { paginas.push(p); conhecida.set(p.caminho, p) }

for (const p of PAGINAS_INSTITUCIONAIS) {
  if (p.rota === '/') continue
  const pg = { caminho: p.rota, titulo: p.seo_title, descricao: p.meta_description, atualizado: p.atualizado_em || DATA_PADRAO, nome: p.titulo }
  pg.jsonLd = ldInstitucional(pg, p.titulo)
  registrar(pg)
}
for (const p of PAGINAS_SEO) {
  const pg = { caminho: p.rota, titulo: p.seo_title, descricao: p.meta_description, imagem: `${SITE}/imagens/${p.foto}-1400.webp`, atualizado: p.atualizado_em || DATA_PADRAO, seo: p }
  pg.jsonLd = ldDaPaginaSeo(pg, p)
  registrar(pg)
}
const categorias = new Map(CATEGORIAS.map((c) => [c.slug, c.nome]))
for (const a of ARTIGOS) {
  const cat = CATEGORIAS.find((c) => c.slug === a.categoria)
  const pg = { caminho: `/blog/${a.slug}`, titulo: a.seo_title, descricao: a.meta_description, imagem: `${SITE}/imagens/${a.foto}-1400.webp`, tipo: 'article', atualizado: a.atualizado_em || a.publicado_em }
  pg.jsonLd = ldDoArtigo(pg, { titulo: a.titulo, publicado: a.publicado_em, atualizado: a.atualizado_em, autor: a.autor, faq: a.faq, categoria: cat ? { slug: cat.slug, nome: cat.nome } : null })
  registrar(pg)
}

// ---- 2. do banco, quando dá ----------------------------------------------
const URL = globalThis.process.env.VITE_SUPABASE_URL, CHAVE = globalThis.process.env.VITE_SUPABASE_ANON_KEY
if (URL && CHAVE && !globalThis.process.env.VITE_DEMO) {
  const pegar = async (q) => {
    const r = await fetch(`${URL}/rest/v1/${q}`, { headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` } })
    if (!r.ok) throw new Error(`${r.status} em ${q.split('?')[0]}`)
    const j = await r.json()
    if (!Array.isArray(j)) throw new Error(`resposta inesperada em ${q.split('?')[0]}`)
    return j
  }
  try {
    const [pags, posts, cats] = await Promise.all([
      pegar('seo_pages?select=route,seo_title,meta_description,og_image_url,robots_index,updated_at&status=eq.published'),
      pegar('blog_posts?select=slug,seo_title,title,meta_description,excerpt,og_image_url,cover_image_url,robots_index,published_at,updated_at,author_name,faq,blog_categories(slug,name)&status=eq.published'),
      pegar('blog_categories?select=slug,name'),
    ])
    for (const c of cats) if (c?.slug) categorias.set(c.slug, c.name || c.slug)
    let ignoradas = 0
    for (const p of pags) {
      const pg = conhecida.get(p.route)
      if (!pg) { ignoradas++; continue } // rota sem tela no app: viraria 404
      pg.titulo = p.seo_title || pg.titulo
      pg.descricao = p.meta_description || pg.descricao
      pg.imagem = p.og_image_url || pg.imagem
      pg.noindex = p.robots_index === false
      pg.atualizado = dia(p.updated_at) || pg.atualizado
      pg.jsonLd = pg.seo ? ldDaPaginaSeo(pg, pg.seo) : ldInstitucional(pg, pg.nome || pg.titulo)
    }
    for (const a of posts) {
      if (!a?.slug) continue
      const caminho = `/blog/${a.slug}`
      const capa = a.og_image_url || (a.cover_image_url ? (a.cover_image_url.startsWith('http') ? a.cover_image_url : SITE + a.cover_image_url) : undefined)
      const cat = a.blog_categories?.slug ? { slug: a.blog_categories.slug, nome: a.blog_categories.name || categorias.get(a.blog_categories.slug) || a.blog_categories.slug } : null
      const faq = Array.isArray(a.faq) ? a.faq : []
      const pg = { caminho, titulo: a.seo_title || a.title, descricao: a.meta_description || a.excerpt || '', imagem: capa, tipo: 'article', noindex: a.robots_index === false, atualizado: dia(a.updated_at) || dia(a.published_at) }
      pg.jsonLd = ldDoArtigo(pg, { titulo: a.title, publicado: dia(a.published_at), atualizado: dia(a.updated_at), autor: a.author_name, faq, categoria: cat })
      const i = paginas.findIndex((x) => x.caminho === caminho)
      if (i >= 0) paginas[i] = pg; else registrar(pg)
      if (cat && !categorias.has(cat.slug)) categorias.set(cat.slug, cat.nome)
    }
    console.log(`paginas-estaticas: ${pags.length} páginas e ${posts.length} artigos lidos do banco${ignoradas ? ` (${ignoradas} rota(s) do banco sem tela, ignoradas)` : ''}`)
  } catch (e) {
    console.log('paginas-estaticas: banco indisponível (' + e.message + '), seguindo só com o código')
  }
}
const usadas = new Set([...ARTIGOS.map((a) => a.categoria), ...paginas.filter((p) => p.tipo === 'article' && p.jsonLd).flatMap((p) => { const m = p.jsonLd['@graph'].find((g) => g['@type'] === 'BreadcrumbList'); const c = m?.itemListElement?.[2]?.item; return c && c.includes('/blog/categoria/') ? [c.split('/blog/categoria/')[1]] : [] })])
for (const slug of usadas) {
  if (!slug) continue
  const nome = categorias.get(slug) || slug.replace(/-/g, ' ')
  const pg = { caminho: `/blog/categoria/${slug}`, titulo: `${nome}: guias da MIMO para o salão | Blog MIMO`, descricao: `Guias práticos da MIMO sobre ${nome.toLowerCase()} para quem vive da beleza: agenda, clientes, equipe e rotina do salão.`, atualizado: DATA_PADRAO }
  pg.jsonLd = { '@context': 'https://schema.org', '@graph': [ORG, migalhas([['Início', '/'], ['Blog', '/blog'], [nome, pg.caminho]]), webPage(pg)] }
  registrar(pg)
}

// ---- 3. grava -------------------------------------------------------------
let ok = 0, erros = 0
for (const p of paginas) {
  try {
    const dir = path.join(DIST, p.caminho)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'index.html'), html(p))
    ok++
  } catch (e) {
    erros++
    console.log(`paginas-estaticas: não gerei ${p.caminho} (${e.message})`)
  }
}
// a home: canonical e dados estruturados só para "/", num arquivo próprio
fs.writeFileSync(path.join(DIST, '_home.html'), html({ caminho: '/', titulo: TITULO_HOME, descricao: DESCRICAO_HOME, atualizado: DATA_PADRAO, jsonLd: HOME_LD }))

const urls = [{ caminho: '/', atualizado: DATA_PADRAO, prioridade: '1.0', freq: 'weekly' }, ...paginas.filter((p) => !p.noindex)]
  .map((p) => `  <url><loc>${SITE}${p.caminho}</loc>${p.atualizado ? `<lastmod>${p.atualizado}</lastmod>` : ''}<changefreq>${p.freq || (p.tipo === 'article' ? 'monthly' : 'weekly')}</changefreq><priority>${p.prioridade || (p.seo ? '0.9' : p.tipo === 'article' ? '0.7' : '0.5')}</priority></url>`)
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`)
console.log(`paginas-estaticas: ${ok} páginas geradas${erros ? `, ${erros} com erro` : ''}, home própria, sitemap com ${urls.length} URLs`)
if (!ok) globalThis.process.exit(1)
