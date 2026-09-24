import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, CalendarDays, ChevronDown, Clock, UserRound } from 'lucide-react'
import { useSeo, migalhasLd, ORGANIZACAO_LD, SITE } from '../../lib/seo'
import { artigoPorSlug, artigosPublicados } from '../../lib/conteudoPublico'
import { Markdown, titulosDe } from '../../lib/markdown'
import { NavSite, PeSite, useRevelar, comecarEm } from '../../components/site/Pecas'
import { CartaoArtigo } from './PaginaSeo'
import NaoEncontrada from './NaoEncontrada'
import '../../landing.css'

// Um artigo, na ordem da spec: migalhas, categoria, H1, subtítulo,
// autor + data + leitura, capa, índice, texto, caixa prática, chamada
// da MIMO, FAQ (se tiver), relacionados, chamada final.
export default function Artigo() {
  const { slug } = useParams()
  const [artigo, setArtigo] = useState(undefined)
  const raiz = useRevelar(!!artigo)
  const [todos, setTodos] = useState([])
  useEffect(() => { window.scrollTo(0, 0) }, [slug])
  useEffect(() => {
    let vivo = true
    setArtigo(undefined)
    artigoPorSlug(slug).then((a) => vivo && setArtigo(a))
    artigosPublicados().then((as) => vivo && setTodos(as))
    return () => { vivo = false }
  }, [slug])

  const a = artigo
  const capa = a?.cover_image_url ? (a.cover_image_url.startsWith('http') ? a.cover_image_url : SITE + a.cover_image_url) : undefined
  const jsonLd = a ? {
    '@context': 'https://schema.org',
    '@graph': [
      ORGANIZACAO_LD,
      migalhasLd([['Início', '/'], ['Blog', '/blog'], ...(a.categoria ? [[a.categoria.name, `/blog/categoria/${a.categoria.slug}`]] : []), [a.title, `/blog/${a.slug}`]]),
      { '@type': 'Article', '@id': `${SITE}/blog/${a.slug}`, headline: a.title, description: a.excerpt, image: capa, datePublished: a.published_at, dateModified: a.updated_at || a.published_at, author: { '@type': 'Organization', name: a.author_name || 'Equipe MIMO' }, publisher: { '@id': `${SITE}/#organization` }, mainEntityOfPage: `${SITE}/blog/${a.slug}`, inLanguage: 'pt-BR' },
      ...(a.faq?.length ? [{ '@type': 'FAQPage', mainEntity: a.faq.map(([q, r]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: r } })) }] : []),
    ],
  } : null
  useSeo({ titulo: a?.seo_title || a?.title || 'Blog da MIMO', descricao: a?.meta_description || a?.excerpt || '', caminho: `/blog/${slug}`, imagem: a?.og_image_url || capa, jsonLd, tipo: 'article', noindex: a ? a.robots_index === false : false })

  if (artigo === null) return <NaoEncontrada />
  if (!a) return <div className="ld sp"><NavSite /><main><section><div className="ld-wrap"><p className="sp-carregando">Carregando…</p></div></section></main><PeSite /></div>

  const indice = titulosDe(a.content)
  const relacionados = (a.relacionados || []).map((s) => todos.find((x) => x.slug === s)).filter(Boolean)
  const data = a.published_at ? new Date(a.published_at).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

  return (
    <div className="ld sp" ref={raiz}>
      <NavSite />
      <main>
        <article className="sp-artigo-pagina">
          <header className="sp-topo">
            <div className="ld-wrap sp-estreito">
              <nav className="sp-migalhas" aria-label="Você está em"><Link to="/">Início</Link><span>›</span><Link to="/blog">Blog</Link>{a.categoria && <><span>›</span><Link to={`/blog/categoria/${a.categoria.slug}`}>{a.categoria.name}</Link></>}<span>›</span><b>{a.title}</b></nav>
              <span className="ld-kicker">{a.categoria?.name || 'Blog MIMO'}</span>
              <h1 className="sp-h1-artigo">{a.title}</h1>
              {a.excerpt && <p className="ld-lead">{a.excerpt}</p>}
              <div className="sp-autor"><span><UserRound size={15} /> Por {a.author_name || 'Equipe MIMO'}</span><span><CalendarDays size={15} /> {data}</span><span><Clock size={15} /> {a.reading_time_minutes} min de leitura</span></div>
            </div>
          </header>
          {a.cover_image_url && (
            <div className="ld-wrap sp-estreito"><figure className="sp-capa ld-rv"><img src={a.cover_image_url} srcSet={/^\/imagens\/.*-1400\.webp$/.test(a.cover_image_url) ? `${a.cover_image_url} 1400w, ${a.cover_image_url.replace('-1400.webp', '-2200.webp')} 2200w` : undefined} sizes="(max-width: 700px) 100vw, 820px" alt={a.cover_alt || ''} width="1400" height="788" fetchPriority="high" /></figure></div>
          )}
          <div className="ld-wrap sp-estreito sp-corpo">
            {indice.length > 2 && (
              <nav className="sp-indice ld-rv" aria-label="Neste artigo"><strong>Neste artigo</strong><ol>{indice.map((t) => <li key={t.id}><a href={`#${t.id}`}>{t.texto}</a></li>)}</ol></nav>
            )}
            <div className="sp-texto"><Markdown texto={a.content} /></div>
            {a.caixa && <aside className="sp-caixa"><strong>{a.caixa.titulo}</strong><p>{a.caixa.texto}</p></aside>}
            <aside className="sp-chamada">
              <div><strong>{a.produto_rotulo || 'Conheça a MIMO'}</strong><span>Agenda, equipe, clientes, WhatsApp e pagamentos num só lugar. Autônoma grátis.</span></div>
              <div className="sp-chamada-botoes">{a.produto_url && <Link className="ld-btn ld-fantasma" to={a.produto_url}>Ver a solução</Link>}<a className="ld-btn ld-primario" href={comecarEm()}>Começar agora <ArrowRight size={16} /></a></div>
            </aside>
            {a.faq?.length > 0 && (
              <section className="sp-faq"><h2>Perguntas frequentes</h2><div className="ld-faq">{a.faq.map(([q, r]) => <details key={q}><summary>{q}<ChevronDown size={18} /></summary><p>{r}</p></details>)}</div></section>
            )}
          </div>
        </article>
        {relacionados.length > 0 && (
          <section className="ld-alt">
            <div className="ld-wrap"><h2 className="sp-h2-rel">Outros conteúdos que podem te interessar</h2><div className="ld-artigos">{relacionados.map((r, i) => <CartaoArtigo a={r} key={r.slug} atraso={i * 60} />)}</div></div>
          </section>
        )}
        <section>
          <div className="ld-wrap">
            <div className="ld-cta ld-rv sp-cta"><div><h2>A agenda é só o começo. A relação é o produto.</h2><p>Organize o dia do salão e cuide da relação com a cliente. Autônoma grátis, salão sem orçamento.</p><div className="ld-cta-lado"><a className="ld-btn ld-branco ld-grande" href={comecarEm()}>Começar agora <ArrowRight size={18} /></a></div></div></div>
          </div>
        </section>
      </main>
      <PeSite />
    </div>
  )
}
