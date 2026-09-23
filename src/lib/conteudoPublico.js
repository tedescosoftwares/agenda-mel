import { supabase } from './supabase'
import { ARTIGOS, CATEGORIAS, minutosDeLeitura } from '../conteudo/artigos'
import { PAGINAS_SEO, PAGINAS_INSTITUCIONAIS } from '../conteudo/paginasSeo'

// O conteúdo público lê o banco primeiro (o que a plataforma editou) e
// cai no código quando o banco não tem a linha ou não responde. Assim
// a página nunca fica em branco por causa de rede ou de migração
// atrasada, e a edição pela plataforma continua valendo.

const SITE = 'https://mimo.com.vc'

function artigoDoCodigo(a) {
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

export async function artigosPublicados() {
  try {
    const { data, error } = await supabase.from('blog_posts').select(SEL).eq('status', 'published').order('published_at', { ascending: false })
    if (!error && data?.length) return data.map(artigoDoBanco)
  } catch { /* cai no código */ }
  return ARTIGOS.map(artigoDoCodigo)
}

export async function artigoPorSlug(slug) {
  try {
    const { data } = await supabase.from('blog_posts').select(SEL).eq('slug', slug).eq('status', 'published').maybeSingle()
    if (data) return artigoDoBanco(data)
  } catch { /* cai no código */ }
  const a = ARTIGOS.find((x) => x.slug === slug)
  return a ? artigoDoCodigo(a) : null
}

export async function categoriasDoBlog() {
  try {
    const { data } = await supabase.from('blog_categories').select('slug, name, description, ordem').order('ordem')
    if (data?.length) return data.map((c) => ({ slug: c.slug, nome: c.name, descricao: c.description }))
  } catch { /* cai no código */ }
  return CATEGORIAS
}

// os metadados de uma rota: o banco pode ter sobrescrito title/description/OG
export async function seoDaRota(rota) {
  const codigo = PAGINAS_SEO.find((p) => p.rota === rota) || PAGINAS_INSTITUCIONAIS.find((p) => p.rota === rota) || null
  try {
    const { data } = await supabase.from('seo_pages').select('seo_title, meta_description, canonical_url, og_title, og_description, og_image_url, robots_index, status').eq('route', rota).maybeSingle()
    if (data && data.status === 'published') return { ...codigo, seo_title: data.seo_title || codigo?.seo_title, meta_description: data.meta_description || codigo?.meta_description, og_image_url: data.og_image_url, canonical_url: data.canonical_url, noindex: data.robots_index === false }
  } catch { /* cai no código */ }
  return codigo
}
