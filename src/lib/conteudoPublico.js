import { supabase } from './supabase'
// os artigos do código são a reserva: carregados só quando o banco não responde (são 70 KB de texto)
const reserva = () => import('../conteudo/artigos')
import { PAGINAS_SEO, PAGINAS_INSTITUCIONAIS } from '../conteudo/paginasSeo'
import { mesclarPagina, mesclarConteudo, normalizarPagina } from './paginas'

// O conteúdo público lê o banco primeiro (o que a plataforma editou) e
// cai no código quando o banco não tem a linha ou não responde. Assim
// a página nunca fica em branco por causa de rede ou de migração
// atrasada, e a edição pela plataforma continua valendo.

const SITE = 'https://mimo.com.vc'

function artigoDoCodigo(a, { CATEGORIAS, minutosDeLeitura }) {
  const c = CATEGORIAS.find((x) => x.slug === a.categoria)
  return {
    id: 'codigo-' + a.slug, slug: a.slug, title: a.titulo, excerpt: a.resumo, content: a.conteudo,
    cover_image_url: `/imagens/${a.foto}-1400.webp`, cover_alt: a.alt, categoria: c ? { slug: c.slug, name: c.nome } : null,
    author_name: a.autor, seo_title: a.seo_title, meta_description: a.meta_description, og_image_url: `${SITE}/imagens/${a.foto}-1400.webp`,
    published_at: a.publicado_em + 'T12:00:00-03:00', updated_at: a.publicado_em + 'T12:00:00-03:00', reading_time_minutes: minutosDeLeitura(a.conteudo),
    produto_url: a.produto, produto_rotulo: a.produto_rotulo, relacionados: a.relacionados, caixa: a.caixa, faq: a.faq, status: 'published', robots_index: true,
  }
}
function artigoDoBanco(p) {
  return { ...p, categoria: p.blog_categories ? { slug: p.blog_categories.slug, name: p.blog_categories.name } : null }
}

const SEL = '*, blog_categories(slug, name)'
// a lista sem o texto dos artigos: é o que cartões, "guias ligados" e o índice do blog precisam
const SEL_LEVE = 'slug, title, excerpt, cover_image_url, cover_alt, published_at, updated_at, reading_time_minutes, produto_url, relacionados, robots_index, blog_categories(slug, name)'

// os artigos para listas (cartões): sem o texto, lidos uma vez por sessão.
// Egresso do Supabase: ~6 KB em vez de ~70 KB a cada página aberta.
let promessaArtigos = null
export function artigosResumidos() {
  if (!promessaArtigos) {
    promessaArtigos = (async () => {
      try {
        const { data, error } = await supabase.from('blog_posts').select(SEL_LEVE).eq('status', 'published').order('published_at', { ascending: false })
        if (!error && data?.length) return data.map(artigoDoBanco)
      } catch { /* cai no código */ }
      const m = await reserva()
      return m.ARTIGOS.map((a) => artigoDoCodigo(a, m))
    })()
  }
  return promessaArtigos
}

// a lista completa, com o texto: só para quem precisa do conteúdo inteiro
export async function artigosPublicados() {
  try {
    const { data, error } = await supabase.from('blog_posts').select(SEL).eq('status', 'published').order('published_at', { ascending: false })
    if (!error && data?.length) return data.map(artigoDoBanco)
  } catch { /* cai no código */ }
  const m = await reserva()
  return m.ARTIGOS.map((a) => artigoDoCodigo(a, m))
}

export async function artigoPorSlug(slug) {
  try {
    const { data } = await supabase.from('blog_posts').select(SEL).eq('slug', slug).eq('status', 'published').maybeSingle()
    if (data) return artigoDoBanco(data)
  } catch { /* cai no código */ }
  const m = await reserva()
  const a = m.ARTIGOS.find((x) => x.slug === slug)
  return a ? artigoDoCodigo(a, m) : null
}

export async function categoriasDoBlog() {
  try {
    const { data } = await supabase.from('blog_categories').select('slug, name, description, ordem').order('ordem')
    if (data?.length) return data.map((c) => ({ slug: c.slug, nome: c.name, descricao: c.description }))
  } catch { /* cai no código */ }
  return (await reserva()).CATEGORIAS
}

// a página de uma rota: o código por baixo, o banco (editado na Plataforma) por cima.
// Página SEO volta normalizada (h1, módulos, FAQ…); home, institucionais e blog
// voltam com as metas e o `conteudo` mesclado; rota desconhecida volta null.
const COLS = 'route, page_type, seo_title, meta_description, canonical_url, og_title, og_description, og_image_url, robots_index, status, conteudo, updated_at'
export async function seoDaRota(rota) {
  const codigoSeo = PAGINAS_SEO.find((p) => p.rota === rota) || null
  const codigo = codigoSeo || PAGINAS_INSTITUCIONAIS.find((p) => p.rota === rota) || null
  let linha = null
  try {
    const { data } = await supabase.from('seo_pages').select(COLS).eq('route', rota).maybeSingle()
    if (data && data.status === 'published') linha = data
  } catch { /* cai no código */ }
  if (!linha && !codigo) return null
  if (codigoSeo || (!codigo && linha?.page_type === 'SEO_LANDING')) return mesclarPagina(codigoSeo, linha)
  return {
    ...codigo,
    seo_title: linha?.seo_title || codigo?.seo_title, meta_description: linha?.meta_description || codigo?.meta_description,
    og_image_url: linha?.og_image_url || codigo?.og_image_url, canonical_url: linha?.canonical_url, noindex: linha?.robots_index === false,
    conteudo: mesclarConteudo(codigo?.conteudo, linha),
  }
}

// tudo que existe de página SEO: as do código (normalizadas) e as do banco por
// cima, inclusive as criadas na Plataforma. Uma leitura por sessão, e leve: do
// miolo só vêm os campos que rodapé, migalhas e "veja também" usam (chapéu,
// tipo, rodapé, ordem, pai, título); o miolo inteiro só é lido na própria página.
const COLS_LEVES = 'route,page_type,status,seo_title,meta_description,og_image_url,robots_index,updated_at,kicker:conteudo->>kicker,tipo:conteudo->>tipo,rodape:conteudo->>rodape,rodapeMostrar:conteudo->rodapeMostrar,ordem:conteudo->ordem,pai:conteudo->>pai,h1:conteudo->h1'
let promessaPaginas = null
export function paginasPublicas() {
  if (!promessaPaginas) {
    promessaPaginas = (async () => {
      const porRota = new Map(PAGINAS_SEO.map((p) => [p.rota, normalizarPagina(p)]))
      try {
        const { data } = await supabase.from('seo_pages').select(COLS_LEVES).eq('page_type', 'SEO_LANDING').eq('status', 'published')
        for (const l of data || []) {
          const editada = l.h1 != null || l.kicker != null
          const curto = editada ? Object.fromEntries(Object.entries({ kicker: l.kicker, tipo: l.tipo, rodape: l.rodape, rodapeMostrar: l.rodapeMostrar, ordem: l.ordem, pai: l.pai, h1: l.h1 }).filter(([, v]) => v !== null && v !== undefined)) : null
          // (no demo a consulta devolve a linha inteira; o miolo vem em `conteudo`)
          const conteudo = curto || (l.conteudo && typeof l.conteudo === 'object' ? l.conteudo : null)
          const pg = mesclarPagina(PAGINAS_SEO.find((p) => p.rota === l.route) || null, { ...l, conteudo })
          if (pg) porRota.set(l.route, pg)
        }
      } catch { /* fica só o código */ }
      return [...porRota.values()]
    })()
  }
  return promessaPaginas
}
export async function paginaPublicaPorRota(rota) {
  return (await paginasPublicas()).find((p) => p.rota === rota) || null
}
