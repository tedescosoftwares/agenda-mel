import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useSeo, migalhasLd, ORGANIZACAO_LD } from '../../lib/seo'
import { artigosPublicados, categoriasDoBlog, seoDaRota } from '../../lib/conteudoPublico'
import { PAGINAS_INSTITUCIONAIS } from '../../conteudo/paginasSeo'
import { linhas } from '../../lib/paginas'
import { NavSite, PeSite, Cabeca, useRevelar } from '../../components/site/Pecas'
import { CartaoArtigo } from './PaginaSeo'
import '../../landing.css'

// O blog: a lista, e a lista filtrada por categoria (/blog/categoria/:slug).
export default function Blog() {
  const { slug } = useParams()
  const raiz = useRevelar()
  const [artigos, setArtigos] = useState(null)
  const [categorias, setCategorias] = useState([])
  // a cabeça do índice: do código, com o banco (Plataforma) por cima
  const [cab, setCab] = useState(() => { const c = PAGINAS_INSTITUCIONAIS.find((p) => p.rota === '/blog'); return { seo_title: c?.seo_title, meta_description: c?.meta_description, ...(c?.conteudo || {}) } })
  useEffect(() => { let vivo = true; seoDaRota('/blog').then((s) => { if (vivo && s) setCab((v) => ({ ...v, seo_title: s.seo_title || v.seo_title, meta_description: s.meta_description || v.meta_description, ...(s.conteudo || {}) })) }); return () => { vivo = false } }, [])
  useEffect(() => { window.scrollTo(0, 0) }, [slug])
  useEffect(() => {
    let vivo = true
    artigosPublicados().then((a) => vivo && setArtigos(a))
    categoriasDoBlog().then((c) => vivo && setCategorias(c))
    return () => { vivo = false }
  }, [])

  const categoria = slug ? categorias.find((c) => c.slug === slug) : null
  const lista = (artigos || []).filter((a) => !slug || a.categoria?.slug === slug)
  const titulo = categoria ? `${categoria.nome} | Blog da MIMO` : (cab.seo_title || 'Blog da MIMO | Agenda, clientes e gestão de salão')
  const descricao = categoria ? `${categoria.descricao} Guias práticos da MIMO sobre ${categoria.nome.toLowerCase()}.` : (cab.meta_description || 'Guias curtos e práticos para quem vive da beleza: agenda, clientes, equipe, WhatsApp e financeiro do salão.')
  const caminho = slug ? `/blog/categoria/${slug}` : '/blog'
  useSeo({ titulo, descricao, caminho, jsonLd: { '@context': 'https://schema.org', '@graph': [ORGANIZACAO_LD, migalhasLd(slug ? [['Início', '/'], ['Blog', '/blog'], [categoria?.nome || slug, caminho]] : [['Início', '/'], ['Blog', '/blog']])] }, noindex: !!slug && lista.length === 0 && artigos !== null })

  return (
    <div className="ld sp" ref={raiz}>
      <NavSite />
      <main>
        <section className="sp-topo">
          <div className="ld-wrap">
            <nav className="sp-migalhas" aria-label="Você está em"><Link to="/">Início</Link><span>›</span>{slug ? <><Link to="/blog">Blog</Link><span>›</span><b>{categoria?.nome || slug}</b></> : <b>Blog</b>}</nav>
            <Cabeca como="h1" kicker={slug ? 'Categoria' : (cab.kicker || 'Blog MIMO')} titulo={slug ? [categoria?.nome || 'Categoria'] : linhas(cab.h1)}>{slug ? (categoria?.descricao || '') : cab.intro}</Cabeca>
            <div className="sp-categorias">
              <Link to="/blog" className={'ld-chip' + (!slug ? ' on' : '')}>Todos</Link>
              {/* só categoria com guia publicado vira link: categoria vazia não tem página estática nem conteúdo para o Google */}
              {categorias.filter((c) => (artigos || []).some((a) => a.categoria?.slug === c.slug)).map((c) => <Link key={c.slug} to={`/blog/categoria/${c.slug}`} className={'ld-chip' + (slug === c.slug ? ' on' : '')}>{c.nome}</Link>)}
            </div>
          </div>
        </section>
        <section className="ld-alt sp-lista">
          <div className="ld-wrap">
            {artigos === null ? <p className="sp-carregando">Carregando…</p> : lista.length === 0 ? <p className="sp-carregando">Ainda não tem guia nesta categoria. <Link to="/blog">Ver todos</Link>.</p> : (
              <div className="ld-artigos">{lista.map((a, i) => <CartaoArtigo a={a} key={a.slug} atraso={(i % 3) * 60} />)}</div>
            )}
          </div>
        </section>
      </main>
      <PeSite />
    </div>
  )
}
