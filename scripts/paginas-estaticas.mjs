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
import { TITULO as TITULO_HOME, DESCRICAO as DESCRICAO_HOME, jsonLdDaHome } from '../src/conteudo/home.js'
import { mesclarPagina, mesclarConteudo, HUB_AUTONOMA } from '../src/lib/paginas.js'
import { paginasDoGuia, dadosDoGuia } from './guia-estatico.mjs'
import { carregarGuia } from './guia-fonte.mjs'
import { cidadeDoArtigo } from '../src/lib/guiaArtigos.js'
import { categoriaDoGuia, rotaDaCidade, rotaDaCategoria, SLUGS_CATEGORIA } from '../src/lib/guia.js'
import { FAQ as HOME_FAQ } from '../src/conteudo/home.js'
import { DOCUMENTOS_LEGAIS } from '../src/conteudo/legal.js'
import { TIPOS_LEGAIS } from '../packages/core/legal.js'
import { corpoDoArtigo, corpoDoBlog, corpoDaPaginaSeo, corpoDePlanos, corpoDeSobre, corpoDeContato, corpoDeTermos, corpoLegal, corpoDaHome, rodapeEstatico, ESTILO_PRE_APP } from './site-estatico.mjs'

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

// todas as páginas SEO por rota (as do código e, depois da leitura do banco, as da Plataforma): o pai das migalhas sai daqui
const seoPorRota = new Map(PAGINAS_SEO.map((p) => [p.rota, p]))
function ldDaPaginaSeo(p, pagina) {
  const pai = pagina.pai ? seoPorRota.get(pagina.pai) : null
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
    const ld = `<script type="application/ld+json" id="seo-jsonld">${JSON.stringify(pagina.jsonLd).replace(/</g, '\\u003c')}</script>`
    h = h.replace('</head>', `    ${ld}\n  </head>`)
  }
  // o corpo já escrito (guia-estatico.mjs e site-estatico.mjs, tudo escapado) e o rodapé com a
  // malha interna: o robô lê sem JavaScript; o React troca ao abrir
  if (pagina.corpo) {
    h = h.replace('<div id="root"></div>', `<div id="root">${pagina.corpo}${rodape}</div>`)
    h = h.replace('</head>', `    ${ESTILO_PRE_APP}\n  </head>`)
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
// os artigos publicados (do código e, depois, do banco) para o guia: "Leia também" e a caixa "Salões em <Cidade>" (3.14)
const artigosParaGuia = new Map(ARTIGOS.map((a) => [a.slug, { slug: a.slug, title: a.titulo, excerpt: a.resumo }]))
// os artigos inteiros, as categorias e o miolo das institucionais: o corpo estático de cada página (3.16)
const minutos = (t) => Math.max(1, Math.round(String(t || '').split(/\s+/).filter(Boolean).length / 200))
const categoriasInfo = new Map(CATEGORIAS.map((c) => [c.slug, { slug: c.slug, nome: c.nome, descricao: c.descricao ?? '' }]))
const artigosCompletos = new Map(ARTIGOS.map((a) => { const c = CATEGORIAS.find((x) => x.slug === a.categoria); return [a.slug, { slug: a.slug, titulo: a.titulo, resumo: a.resumo, conteudo: a.conteudo, categoria: c ? { slug: c.slug, nome: c.nome } : null, autor: a.autor, publicado_em: a.publicado_em, minutos: minutos(a.conteudo), produto_url: a.produto, produto_rotulo: a.produto_rotulo, relacionados: a.relacionados ?? [], caixa: a.caixa, faq: a.faq ?? [], noindex: false }] }))
const conteudoInst = new Map(PAGINAS_INSTITUCIONAIS.map((p) => [p.rota, { ...(p.conteudo || {}) }]))
let docsLegais = Object.fromEntries(TIPOS_LEGAIS.map((t) => [t.tipo, { tipo: t.tipo, ...DOCUMENTOS_LEGAIS[t.tipo] }]))
let guiaDados = null
let guiaCarregado = false // 3.23: só apaga e reescreve o guia quando ele veio do banco (ou do cache)
let dadosGuia = [] // 3.23: os JSON que o site lê do servidor
const REFAZER = globalThis.process.argv.includes('--refazer') // ignora o cache do guia e lê tudo de novo
let rodape = ''
for (const a of ARTIGOS) {
  const cat = CATEGORIAS.find((c) => c.slug === a.categoria)
  const pg = { caminho: `/blog/${a.slug}`, titulo: a.seo_title, descricao: a.meta_description, imagem: `${SITE}/imagens/${a.foto}-1400.webp`, tipo: 'article', atualizado: a.atualizado_em || a.publicado_em }
  pg.jsonLd = ldDoArtigo(pg, { titulo: a.titulo, publicado: a.publicado_em, atualizado: a.atualizado_em, autor: a.autor, faq: a.faq, categoria: cat ? { slug: cat.slug, nome: cat.nome } : null })
  registrar(pg)
}

// ---- 2. do banco, quando dá ----------------------------------------------
const URL = globalThis.process.env.VITE_SUPABASE_URL, CHAVE = globalThis.process.env.VITE_SUPABASE_ANON_KEY
let homeDoBanco = null // a linha '/' de seo_pages: metas e, se editado, as perguntas da home
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
      pegar('seo_pages?select=route,page_type,title,seo_title,meta_description,og_image_url,robots_index,updated_at,conteudo&status=eq.published'),
      pegar('blog_posts?select=slug,seo_title,title,meta_description,excerpt,og_image_url,cover_image_url,robots_index,published_at,updated_at,author_name,faq,content,produto_url,produto_rotulo,relacionados,caixa,reading_time_minutes,blog_categories(slug,name)&status=eq.published'),
      pegar('blog_categories?select=slug,name,description'),
    ])
    for (const c of cats) if (c?.slug) { categorias.set(c.slug, c.name || c.slug); categoriasInfo.set(c.slug, { slug: c.slug, nome: c.name || c.slug, descricao: c.description ?? '' }) }
    let ignoradas = 0, novas = 0
    for (const p of pags) {
      if (p.route === '/') { homeDoBanco = p; conteudoInst.set('/', mesclarConteudo(conteudoInst.get('/'), p)); continue }
      let pg = conhecida.get(p.route)
      if (pg && !pg.seo && conteudoInst.has(p.route)) conteudoInst.set(p.route, mesclarConteudo(conteudoInst.get(p.route), p))
      if (!pg) {
        // rota que o código não conhece: página criada na Plataforma (vira página) ou sobra (ignora)
        const nova = p.page_type === 'SEO_LANDING' ? mesclarPagina(null, p) : null
        if (!nova) { ignoradas++; continue }
        pg = { caminho: p.route, titulo: nova.seo_title || p.title || nova.h1.join(' '), descricao: nova.meta_description || '', imagem: nova.og_image_url || `${SITE}/imagens/${nova.foto}-1400.webp`, atualizado: dia(p.updated_at) || nova.atualizado_em || DATA_PADRAO, seo: nova }
        registrar(pg); novas++
      } else if (pg.seo) {
        pg.seo = mesclarPagina(pg.seo, p) // as metas e, se a Plataforma editou, o miolo (FAQ, pai, chapéu)
      }
      if (pg.seo) seoPorRota.set(pg.caminho, pg.seo)
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
      if (a.robots_index !== false) artigosParaGuia.set(a.slug, { slug: a.slug, title: a.title, excerpt: a.excerpt })
      artigosCompletos.set(a.slug, { slug: a.slug, titulo: a.title, resumo: a.excerpt, conteudo: a.content, categoria: cat, autor: a.author_name, publicado_em: a.published_at, minutos: a.reading_time_minutes || minutos(a.content), produto_url: a.produto_url, produto_rotulo: a.produto_rotulo, relacionados: Array.isArray(a.relacionados) ? a.relacionados : [], caixa: a.caixa, faq, noindex: a.robots_index === false })
    }
    // os termos publicados na Plataforma (120); sem eles, a versão do código
    try {
      const r = await fetch(`${URL}/rest/v1/rpc/documentos_vigentes`, { method: 'POST', headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json' }, body: '{}' })
      const vindos = r.ok ? await r.json() : null
      if (vindos && typeof vindos === 'object' && !Array.isArray(vindos)) {
        for (const t of TIPOS_LEGAIS) { const v = vindos[t.tipo]; if (v?.conteudo) docsLegais[t.tipo] = { tipo: t.tipo, titulo: v.titulo || DOCUMENTOS_LEGAIS[t.tipo].titulo, versao: v.versao, conteudo: v.conteudo, publicado_em: v.publicado_em } }
      }
    } catch { /* fica a versão do código */ }
    // com todas as páginas na mesa (inclusive as da Plataforma), o pai das migalhas fecha
    for (const pg of paginas) if (pg.seo) pg.jsonLd = ldDaPaginaSeo(pg, pg.seo)
    console.log(`paginas-estaticas: ${pags.length} páginas e ${posts.length} artigos lidos do banco${novas ? `, ${novas} página(s) criada(s) na Plataforma` : ''}${ignoradas ? ` (${ignoradas} rota(s) do banco sem tela, ignoradas)` : ''}`)
  } catch (e) {
    console.log('paginas-estaticas: banco indisponível (' + e.message + '), seguindo só com o código')
  }
  // o guia de salões (153): cidade a cidade, com cache em .cache/guia e só o que mudou (3.23, guia-fonte.mjs).
  // Num banco ainda sem a 171, a função antiga, de uma vez. Sem rede e sem cache, segue sem o guia, e o que já
  // está no ar (páginas e sitemap) fica como está.
  try {
    let guia
    try {
      guia = await carregarGuia({ url: URL, chave: CHAVE, cacheDir: path.resolve('.cache/guia'), refazer: REFAZER, log: (m) => console.log(`paginas-estaticas: ${m}`) })
    } catch (e) {
      const r = await fetch(`${URL}/rest/v1/rpc/guia_publicadas`, { headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` } })
      if (!r.ok) throw new Error(`${e.message}; e ${r.status} em rpc/guia_publicadas de uma vez`)
      guia = await r.json()
      console.log(`paginas-estaticas: guia lido de uma vez, do jeito antigo (${e.message}); rode a migração 171 para ler cidade a cidade`)
    }
    guiaDados = guia
    guiaCarregado = true
    const doGuia = paginasDoGuia(guia, [...artigosParaGuia.values()])
    for (const pg of doGuia) registrar(pg)
    dadosGuia = dadosDoGuia(guia)
    console.log(`paginas-estaticas: guia de salões com ${doGuia.length} página(s) e ${dadosGuia.length} arquivo(s) de dados`)
  } catch (e) {
    console.log('paginas-estaticas: guia de salões indisponível (' + e.message + '), seguindo sem ele; as páginas do guia que estão no ar ficam')
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

// ---- 2b. o corpo estático de cada página (3.16) -------------------------------------
// o rodapé com a malha interna: as páginas de produto (código e Plataforma), as institucionais e as cidades do guia
const todasSeo = [...seoPorRota.values()].filter((p) => p && p.rota)
const ordenar = (l) => [...l].sort((a, b) => (a.ordem ?? 100) - (b.ordem ?? 100))
rodape = rodapeEstatico({
  solucoes: ordenar(todasSeo.filter((p) => p.rodapeMostrar !== false && p.tipo !== 'profissao' && p.rota !== HUB_AUTONOMA)),
  profissionais: ordenar(todasSeo.filter((p) => p.rodapeMostrar !== false && (p.tipo === 'profissao' || p.rota === HUB_AUTONOMA))),
  cidades: Array.isArray(guiaDados?.cidades) ? guiaDados.cidades : [],
})
const listaBlog = [...artigosCompletos.values()].filter((a) => !a.noindex).sort((a, b) => String(b.publicado_em ?? '').localeCompare(String(a.publicado_em ?? '')))
const catsComArtigo = [...categoriasInfo.values()].filter((c) => listaBlog.some((a) => a.categoria?.slug === c.slug))
const cidadesDoGuia = Array.isArray(guiaDados?.cidades) ? guiaDados.cidades : []
const lugaresDoGuia = Array.isArray(guiaDados?.lugares) ? guiaDados.lugares : []
// o artigo que fala de uma cidade do guia ganha a caixa "Salões em <Cidade>" (o app a desenha também)
function caixaDaCidade(a) {
  const c = cidadeDoArtigo({ slug: a.slug, title: a.titulo }, cidadesDoGuia)
  if (!c) return ''
  const cats = SLUGS_CATEGORIA.filter((s) => lugaresDoGuia.some((l) => l.cidade_slug === c.cidade_slug && l.categoria === s))
  return `<nav aria-label="${esc(`Salões em ${c.cidade}`)}"><h2>${esc(`Salões em ${c.cidade}`)}</h2><ul><li><a href="${esc(rotaDaCidade(c.cidade_slug))}">${esc(`Guia de salões em ${c.cidade}`)}</a> (${c.total})</li>${cats.map((s) => `<li><a href="${esc(rotaDaCategoria(c.cidade_slug, s))}">${esc(`${categoriaDoGuia(s).rotulo} em ${c.cidade}`)}</a></li>`).join('')}</ul></nav>`
}
let comCorpo = 0, comCaixa = 0
for (const pg of paginas) {
  if (pg.corpo) { comCorpo++; continue } // o guia já veio pronto
  const rota = pg.caminho
  if (pg.tipo === 'article') {
    const a = artigosCompletos.get(rota.replace(/^\/blog\//, ''))
    if (!a) continue
    const caixa = caixaDaCidade(a)
    if (caixa) comCaixa++
    pg.corpo = corpoDoArtigo({ ...a, relacionados: a.relacionados.map((slug) => artigosCompletos.get(slug)).filter(Boolean) }, { caixaGuia: caixa })
  } else if (pg.seo) {
    pg.corpo = corpoDaPaginaSeo(pg.seo, { pai: pg.seo.pai ? seoPorRota.get(pg.seo.pai) : null, relacionadas: (pg.seo.relacionadas ?? []).map((r) => seoPorRota.get(r)).filter(Boolean), artigos: (pg.seo.artigos ?? []).map((slug) => artigosCompletos.get(slug)).filter(Boolean) })
  } else if (rota === '/blog') {
    pg.corpo = corpoDoBlog({ cabeca: conteudoInst.get('/blog'), artigos: listaBlog, categorias: catsComArtigo })
  } else if (rota.startsWith('/blog/categoria/')) {
    const slug = rota.slice('/blog/categoria/'.length)
    pg.corpo = corpoDoBlog({ cabeca: conteudoInst.get('/blog'), artigos: listaBlog.filter((a) => a.categoria?.slug === slug), categoria: categoriasInfo.get(slug) ?? { slug, nome: categorias.get(slug) || slug, descricao: '' }, categorias: catsComArtigo })
  } else if (rota === '/planos') pg.corpo = corpoDePlanos(conteudoInst.get('/planos'))
  else if (rota === '/sobre') pg.corpo = corpoDeSobre(conteudoInst.get('/sobre'))
  else if (rota === '/contato') pg.corpo = corpoDeContato(conteudoInst.get('/contato'))
  else if (rota === '/termos') pg.corpo = corpoDeTermos(TIPOS_LEGAIS, docsLegais)
  else {
    const t = TIPOS_LEGAIS.find((x) => x.rota === rota)
    if (t && docsLegais[t.tipo]) pg.corpo = corpoLegal(t, docsLegais[t.tipo])
  }
  if (pg.corpo) comCorpo++
}
console.log(`paginas-estaticas: corpo estático em ${comCorpo} de ${paginas.length} páginas${comCaixa ? `, ${comCaixa} artigo(s) de cidade com a caixa do guia` : ''}`)

// ---- 3. grava -------------------------------------------------------------
// /saloes e /blog são inteiramente deste script: limpar antes tira a página de um
// salão ou artigo que saiu do ar (a regeneração de hora em hora não passa pelo vite, que esvazia o dist).
// O guia só é apagado quando carregou (3.23): banco fora do ar não leva as páginas que estão no ar
for (const pasta of guiaCarregado ? ['saloes', 'blog', 'dados/guia'] : ['blog']) fs.rmSync(path.join(DIST, pasta), { recursive: true, force: true })
// sem o guia nesta rodada, as URLs dele continuam no sitemap, como estavam
const urlsGuardadas = guiaCarregado ? [] : (() => {
  try { return [...fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8').matchAll(/<url><loc>[^<]*\/saloes[^<]*<\/loc>.*?<\/url>/g)].map((m) => `  ${m[0]}`) } catch { return [] }
})()
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
// os dados do guia em JSON (3.23): o site lê daqui antes de ir ao Supabase
let arquivosDeDados = 0
for (const d of dadosGuia) {
  try {
    const f = path.join(DIST, d.caminho)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, JSON.stringify(d.dados))
    arquivosDeDados++
  } catch (e) {
    console.log(`paginas-estaticas: não gravei ${d.caminho} (${e.message})`)
  }
}
// a home: canonical e dados estruturados só para "/", num arquivo próprio
const faqDaHome = Array.isArray(homeDoBanco?.conteudo?.faq) && homeDoBanco.conteudo.faq.length ? homeDoBanco.conteudo.faq : HOME_FAQ
fs.writeFileSync(path.join(DIST, '_home.html'), html({ caminho: '/', titulo: homeDoBanco?.seo_title || TITULO_HOME, descricao: homeDoBanco?.meta_description || DESCRICAO_HOME, imagem: homeDoBanco?.og_image_url, atualizado: dia(homeDoBanco?.updated_at) || DATA_PADRAO, jsonLd: jsonLdDaHome(homeDoBanco?.conteudo?.faq), corpo: corpoDaHome(conteudoInst.get('/'), faqDaHome) }))

const urls = [{ caminho: '/', atualizado: DATA_PADRAO, prioridade: '1.0', freq: 'weekly' }, ...paginas.filter((p) => !p.noindex)]
  .map((p) => `  <url><loc>${SITE}${p.caminho}</loc>${p.atualizado ? `<lastmod>${p.atualizado}</lastmod>` : ''}<changefreq>${p.freq || (p.tipo === 'article' ? 'monthly' : 'weekly')}</changefreq><priority>${p.prioridade || (p.seo ? '0.9' : p.tipo === 'article' ? '0.7' : '0.5')}</priority></url>`)
  .concat(urlsGuardadas)
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`)
console.log(`paginas-estaticas: ${ok} páginas geradas${erros ? `, ${erros} com erro` : ''}${arquivosDeDados ? `, ${arquivosDeDados} arquivo(s) de dados do guia` : ''}, home própria, sitemap com ${urls.length} URLs${urlsGuardadas.length ? ` (${urlsGuardadas.length} do guia guardadas da rodada anterior)` : ''}`)
if (!ok) globalThis.process.exit(1)
