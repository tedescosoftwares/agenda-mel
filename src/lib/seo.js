import { useEffect } from 'react'

// O SEO por rota, do lado do navegador: title, description, canonical,
// Open Graph, Twitter, robots e JSON-LD. O build também grava essas
// mesmas etiquetas num index.html por rota (scripts/paginas-estaticas.mjs),
// para robô que não roda JavaScript; aqui é o que vale depois que o app
// abre e a pessoa navega de uma página para outra.

export const SITE = 'https://mimo.com.vc'
export const OG_PADRAO = `${SITE}/og-mimo.png`

function meta(sel, attrs) {
  let el = document.head.querySelector(sel)
  if (!el) { el = document.createElement('meta'); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); document.head.appendChild(el) }
  return el
}

export function useSeo({ titulo, descricao, caminho = '/', imagem, jsonLd, noindex = false, tipo = 'website' }) {
  useEffect(() => {
    const antes = { title: document.title }
    document.title = titulo
    const url = SITE + caminho
    const ajustes = [
      [meta('meta[name="description"]', { name: 'description' }), 'content', descricao],
      [meta('meta[property="og:title"]', { property: 'og:title' }), 'content', titulo],
      [meta('meta[property="og:description"]', { property: 'og:description' }), 'content', descricao],
      [meta('meta[property="og:url"]', { property: 'og:url' }), 'content', url],
      [meta('meta[property="og:image"]', { property: 'og:image' }), 'content', imagem || OG_PADRAO],
      [meta('meta[property="og:type"]', { property: 'og:type' }), 'content', tipo],
      [meta('meta[name="twitter:title"]', { name: 'twitter:title' }), 'content', titulo],
      [meta('meta[name="twitter:description"]', { name: 'twitter:description' }), 'content', descricao],
      [meta('meta[name="twitter:image"]', { name: 'twitter:image' }), 'content', imagem || OG_PADRAO],
      [meta('meta[name="robots"]', { name: 'robots' }), 'content', noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'],
    ]
    const guardados = ajustes.map(([el, a, v]) => { const antes = el.getAttribute(a); el.setAttribute(a, v); return [el, a, antes] })
    let canon = document.head.querySelector('link[rel="canonical"]')
    const canonAntes = canon?.getAttribute('href')
    if (!canon) { canon = document.createElement('link'); canon.rel = 'canonical'; document.head.appendChild(canon) }
    canon.setAttribute('href', url)
    let ld = document.getElementById('seo-jsonld')
    if (jsonLd) {
      if (!ld) { ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.id = 'seo-jsonld'; document.head.appendChild(ld) }
      ld.textContent = JSON.stringify(jsonLd)
    } else if (ld) ld.remove()
    return () => {
      document.title = antes.title
      for (const [el, a, v] of guardados) { if (v == null) el.remove(); else el.setAttribute(a, v) }
      if (canonAntes) canon.setAttribute('href', canonAntes); else canon.remove()
      document.getElementById('seo-jsonld')?.remove()
    }
  }, [titulo, descricao, caminho, imagem, noindex, tipo, JSON.stringify(jsonLd)]) // eslint-disable-line react-hooks/exhaustive-deps
}

// o rastro de migalhas, no formato que o Google lê
export function migalhasLd(itens) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: itens.map(([nome, caminho], i) => ({ '@type': 'ListItem', position: i + 1, name: nome, item: SITE + caminho })),
  }
}

export const ORGANIZACAO_LD = { '@type': 'Organization', '@id': `${SITE}/#organization`, name: 'MIMO', url: `${SITE}/`, logo: `${SITE}/mimo-logo.svg` }
