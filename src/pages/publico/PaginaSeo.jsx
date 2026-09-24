import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowRight, Check, ChevronDown, CalendarDays, Users, Heart, MessageCircle, Clock, Wallet, UserRound, PauseCircle, CalendarPlus, Scissors, QrCode, RotateCcw, Bell, Hand, Eye, Flower2, Receipt } from 'lucide-react'
import { useSeo, migalhasLd, ORGANIZACAO_LD, SITE } from '../../lib/seo'
import { seoDaRota, artigosPublicados } from '../../lib/conteudoPublico'
import { paginaSeoPorRota } from '../../conteudo/paginasSeo'
import { NavSite, PeSite, Foto, Coracao, Cabeca, useRevelar, comecarEm } from '../../components/site/Pecas'
import { MockDesktop, PalcoCelular } from '../../components/site/Mocks'
import '../../landing.css'

// Uma página por intenção de busca. A estrutura é a mesma (herói com
// foto, mock do produto, blocos, funcionalidades, faixa, FAQ, artigos,
// chamada), o conteúdo é o de src/conteudo/paginasSeo.js e os
// metadados podem vir editados do banco.

const ICONES = { CalendarDays, Users, Heart, MessageCircle, Clock, Wallet, UserRound, PauseCircle, CalendarPlus, Scissors, QrCode, RotateCcw, Bell, Hand, Eye, Flower2, Receipt }

export default function PaginaSeo() {
  const { pathname } = useLocation()
  const pagina = paginaSeoPorRota(pathname)
  const raiz = useRevelar()
  const [seo, setSeo] = useState(null)
  const [artigos, setArtigos] = useState([])

  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  useEffect(() => {
    let vivo = true
    seoDaRota(pathname).then((s) => vivo && setSeo(s))
    artigosPublicados().then((as) => vivo && setArtigos(as))
    return () => { vivo = false }
  }, [pathname])

  const titulo = seo?.seo_title || pagina?.seo_title || 'MIMO'
  const descricao = seo?.meta_description || pagina?.meta_description || ''
  const jsonLd = pagina ? {
    '@context': 'https://schema.org',
    '@graph': [ORGANIZACAO_LD, migalhasLd([['Início', '/'], ['Soluções', '/#funcionalidades'], [pagina.kicker, pagina.rota]]), { '@type': 'WebPage', '@id': `${SITE}${pagina.rota}`, name: titulo, description: descricao, isPartOf: { '@id': `${SITE}/#website` } }, { '@type': 'FAQPage', mainEntity: pagina.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }],
  } : null
  useSeo({ titulo, descricao, caminho: pathname, imagem: seo?.og_image_url || (pagina ? `${SITE}/imagens/${pagina.foto}-1400.webp` : undefined), jsonLd, noindex: !!seo?.noindex })

  if (!pagina) return null
  const relacionados = pagina.artigos.map((s) => artigos.find((a) => a.slug === s)).filter(Boolean)
  const cta = comecarEm(pagina.cta.tipo)

  return (
    <div className="ld sp" ref={raiz}>
      <NavSite />
      <main>
        <section className="ld-hero sp-hero">
          <div className="ld-wrap">
            <nav className="sp-migalhas" aria-label="Você está em"><Link to="/">Início</Link><span>›</span><a href="/#funcionalidades">Soluções</a><span>›</span><b>{pagina.kicker}</b></nav>
            <div className="ld-hero-grade">
              <div className="ld-hero-texto">
                <span className="ld-kicker">{pagina.kicker}</span>
                <h1>{pagina.h1.map((l, i) => <span key={i} className={i === pagina.h1.length - 1 ? '' : 'sp-h1-linha'}>{l}</span>)}</h1>
                <Coracao className="ld-hero-coracao" />
                <p className="ld-lead">{pagina.sub}</p>
                <div className="ld-hero-cta">
                  <a className="ld-btn ld-primario ld-grande" href={cta}>{pagina.cta.rotulo} <ArrowRight size={18} /></a>
                  <a className="ld-btn ld-fantasma ld-grande" href="/#como-funciona">Ver como funciona</a>
                </div>
                <ul className="ld-prova">{pagina.provas.map((p) => <li key={p}><i><Check size={12} /></i> {p}</li>)}</ul>
              </div>
              <div className="sp-hero-foto ld-rv">
                <Foto nome={pagina.foto} alt={pagina.alt} prioridade />
                <span className="ld-bilhete sp-bilhete">{pagina.bilhete} <i>♥</i></span>
              </div>
            </div>
          </div>
        </section>

        {pagina.mock && (
          <section className="ld-alt">
            <div className="ld-wrap">
              <Cabeca kicker="O produto" titulo={[pagina.mockTitulo]}>{pagina.mockTexto}</Cabeca>
              <div className="ld-rv">{pagina.mock === 'desktop' ? <MockDesktop /> : <div className="sp-celular"><PalcoCelular /></div>}</div>
            </div>
          </section>
        )}

        <section>
          <div className="ld-wrap sp-blocos">
            {pagina.blocos.map((b, i) => (
              <article className={'sp-bloco ld-rv' + (i % 2 ? ' sp-bloco-inv' : '')} key={b.titulo}>
                <div><span className="ld-kicker">{String(i + 1).padStart(2, '0')}</span><h2>{b.titulo}</h2><p>{b.texto}</p></div>
                <ul className="ld-checks">{b.itens.map((it) => <li key={it}>{it}</li>)}</ul>
              </article>
            ))}
          </div>
        </section>

        <section className="ld-alt" id="funcionalidades">
          <div className="ld-wrap">
            <Cabeca kicker="Funcionalidades" titulo={['Funcionalidades que fazem sentido', 'para a sua rotina.']} centro />
            <div className="sp-funcoes">
              {pagina.funcoes.map(([ic, t, d], i) => { const Ic = ICONES[ic] || CalendarDays; return <article className="ld-mini ld-rv" key={t} style={{ transitionDelay: `${i * 50}ms` }}><Ic size={20} /><h3>{t}</h3><p>{d}</p></article> })}
            </div>
          </div>
        </section>

        <section>
          <div className="ld-wrap">
            <div className="sp-faixa ld-rv">
              <div className="sp-faixa-foto"><Foto nome={pagina.faixa.foto} alt="" largura="cheia" /><span className="ld-bilhete sp-faixa-bilhete">{pagina.faixa.bilhete} <i>♥</i></span></div>
              <div className="sp-faixa-texto">
                <h2>{pagina.faixa.titulo}</h2>
                <p>{pagina.faixa.texto}</p>
                <a className="ld-btn ld-branco" href={cta}>{pagina.cta.rotulo} <ArrowRight size={16} /></a>
              </div>
            </div>
          </div>
        </section>

        <section className="ld-alt">
          <div className="ld-wrap">
            <Cabeca kicker="Perguntas frequentes" titulo={['Dúvidas de quem está começando']} centro />
            <div className="ld-faq">
              {pagina.faq.map(([q, a], i) => <details className="ld-rv" key={q} style={{ transitionDelay: `${i * 40}ms` }}><summary>{q}<ChevronDown size={18} /></summary><p>{a}</p></details>)}
            </div>
          </div>
        </section>

        {relacionados.length > 0 && (
          <section>
            <div className="ld-wrap">
              <Cabeca kicker="Conteúdos" titulo={['Guias que ajudam', 'nessa rotina.']}><Link to="/blog" className="ld-link">Ver o blog →</Link></Cabeca>
              <div className="ld-artigos">
                {relacionados.map((a, i) => <CartaoArtigo a={a} key={a.slug} atraso={i * 60} />)}
              </div>
            </div>
          </section>
        )}

        <section className="ld-alt">
          <div className="ld-wrap">
            <div className="ld-cta ld-rv sp-cta">
              <div>
                <h2>{pagina.tipo === 'profissao' ? 'Sua agenda pronta hoje.' : 'Comece hoje mesmo.'}</h2>
                <p>{pagina.tipo === 'profissao' ? 'Crie sua conta grátis, cadastre seus serviços e compartilhe seu link. Sua cliente marca sozinha.' : 'Cadastre o salão, monte a equipe e coloque o QR no balcão. O resto a MIMO organiza.'}</p>
                <div className="ld-cta-lado"><a className="ld-btn ld-branco ld-grande" href={cta}>{pagina.cta.rotulo} <ArrowRight size={18} /></a></div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <PeSite />
    </div>
  )
}

export function CartaoArtigo({ a, atraso = 0 }) {
  return (
    <Link className="ld-artigo sp-artigo ld-rv" to={`/blog/${a.slug}`} style={{ transitionDelay: `${atraso}ms` }}>
      {a.cover_image_url && <img className="sp-artigo-capa" src={a.cover_image_url} alt="" loading="lazy" width="640" height="360" />}
      <small>{a.categoria?.name || 'Blog'}</small><h3>{a.title}</h3><p>{a.excerpt}</p>
      <span className="ld-embreve">{a.reading_time_minutes} min de leitura</span>
    </Link>
  )
}
