// Roda depois do vite build. Para cada rota pública gera um
// dist/<rota>/index.html: o mesmo index.html do app, com title,
// description, canonical e Open Graph daquela página. O Caddy tenta
// {path}/index.html antes de cair no index.html geral, então o robô do
// Google e o do WhatsApp leem o certo sem rodar JavaScript; a pessoa
// recebe o app, que renderiza a página. Também escreve o sitemap.xml.
//
// A lista de rotas vem do código (src/conteudo) e, quando as chaves do
// Supabase estão no ambiente (como no VPS), do banco: artigos criados
// pela plataforma ganham a própria página; o que está em rascunho ou
// noindex fica de fora do sitemap.
import fs from 'node:fs'
import path from 'node:path'
import { ARTIGOS } from '../src/conteudo/artigos.js'
import { PAGINAS_SEO, PAGINAS_INSTITUCIONAIS } from '../src/conteudo/paginasSeo.js'

const SITE = 'https://mimo.com.vc'
const DIST = path.resolve('dist')
const base = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

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
  const extra = `<link rel="canonical" href="${url}" />` + (pagina.noindex ? '<meta name="robots" content="noindex, nofollow" />' : '')
  return h.replace('</head>', `    ${extra}\n  </head>`)
}

// 1. do código
const paginas = []
for (const p of PAGINAS_INSTITUCIONAIS) paginas.push({ caminho: p.rota, titulo: p.seo_title, descricao: p.meta_description, atualizado: '2026-09-23' })
for (const p of PAGINAS_SEO) paginas.push({ caminho: p.rota, titulo: p.seo_title, descricao: p.meta_description, imagem: `${SITE}/imagens/${p.foto}-1400.webp`, atualizado: '2026-09-23' })
for (const a of ARTIGOS) paginas.push({ caminho: `/blog/${a.slug}`, titulo: a.seo_title, descricao: a.meta_description, imagem: `${SITE}/imagens/${a.foto}-1400.webp`, tipo: 'article', atualizado: a.publicado_em })
const categorias = new Set(ARTIGOS.map((a) => a.categoria))

// 2. do banco, quando dá
const URL = globalThis.process.env.VITE_SUPABASE_URL, CHAVE = globalThis.process.env.VITE_SUPABASE_ANON_KEY
if (URL && CHAVE && !globalThis.process.env.VITE_DEMO) {
  const pegar = async (q) => { const r = await fetch(`${URL}/rest/v1/${q}`, { headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` } }); if (!r.ok) throw new Error(r.status); return r.json() }
  try {
    const [pags, posts, cats] = await Promise.all([
      pegar('seo_pages?select=route,seo_title,meta_description,og_image_url,robots_index,updated_at&status=eq.published'),
      pegar('blog_posts?select=slug,seo_title,title,meta_description,excerpt,og_image_url,cover_image_url,robots_index,updated_at,blog_categories(slug)&status=eq.published'),
      pegar('blog_categories?select=slug'),
    ])
    for (const p of pags) {
      const i = paginas.findIndex((x) => x.caminho === p.route)
      const nova = { caminho: p.route, titulo: p.seo_title || paginas[i]?.titulo || 'MIMO', descricao: p.meta_description || paginas[i]?.descricao || '', imagem: p.og_image_url || paginas[i]?.imagem, noindex: p.robots_index === false, atualizado: p.updated_at?.slice(0, 10) }
      if (i >= 0) paginas[i] = nova; else paginas.push(nova)
    }
    for (const a of posts) {
      const caminho = `/blog/${a.slug}`
      const i = paginas.findIndex((x) => x.caminho === caminho)
      const capa = a.og_image_url || (a.cover_image_url ? (a.cover_image_url.startsWith('http') ? a.cover_image_url : SITE + a.cover_image_url) : undefined)
      const nova = { caminho, titulo: a.seo_title || a.title, descricao: a.meta_description || a.excerpt || '', imagem: capa, tipo: 'article', noindex: a.robots_index === false, atualizado: a.updated_at?.slice(0, 10) }
      if (i >= 0) paginas[i] = nova; else paginas.push(nova)
      if (a.blog_categories?.slug) categorias.add(a.blog_categories.slug)
    }
    for (const c of cats) if (!categorias.has(c.slug)) { /* categoria vazia não entra */ }
    console.log(`paginas-estaticas: ${pags.length} páginas e ${posts.length} artigos lidos do banco`)
  } catch (e) {
    console.log('paginas-estaticas: banco indisponível (' + e.message + '), seguindo só com o código')
  }
}
for (const c of categorias) paginas.push({ caminho: `/blog/categoria/${c}`, titulo: `Blog da MIMO: ${c.replace(/-/g, ' ')}`, descricao: 'Guias práticos da MIMO para quem vive da beleza.', atualizado: '2026-09-23' })

// 3. grava
let n = 0
for (const p of paginas) {
  if (p.caminho === '/') continue
  const dir = path.join(DIST, p.caminho)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.html'), html(p))
  n++
}
const urls = paginas.filter((p) => !p.noindex).map((p) => `  <url><loc>${SITE}${p.caminho}</loc>${p.atualizado ? `<lastmod>${p.atualizado}</lastmod>` : ''}<changefreq>${p.caminho === '/' ? 'weekly' : 'monthly'}</changefreq><priority>${p.caminho === '/' ? '1.0' : p.caminho.startsWith('/blog/') ? '0.6' : '0.8'}</priority></url>`)
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`)
console.log(`paginas-estaticas: ${n} páginas geradas, sitemap com ${urls.length} URLs`)
