import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowRight, Check, ChevronDown, CalendarDays, Users, Heart, MessageCircle, Clock, Wallet, UserRound, PauseCircle, CalendarPlus, Scissors, QrCode, RotateCcw, Bell, Hand, Eye, Flower2, Receipt, LayoutGrid, Star } from 'lucide-react'
import { useSeo, migalhasLd, ORGANIZACAO_LD, SITE } from '../../lib/seo'
import { seoDaRota, artigosPublicados } from '../../lib/conteudoPublico'
import { paginaSeoPorRota } from '../../conteudo/paginasSeo'
import { PLANOS, reais } from '../../lib/planos'
import { REGRAS } from '../../lib/acesso'
import { NavSite, PeSite, Foto, Coracao, Cabeca, useRevelar, comecarEm } from '../../components/site/Pecas'
import { MockDesktop, PalcoCelular, MockProfissional, MockRetorno, MockEspera, MockWhats, MockPagamento, MockQr } from '../../components/site/Mocks'
import '../../landing.css'

// Uma página por intenção de busca. A estrutura é a mesma: herói com
// foto, a rotina real (cenas do salão e como a MIMO resolve), o produto
// módulo a módulo com os mocks de verdade, FAQ, páginas relacionadas,
// artigos e chamada. Cada seção só aparece se o conteúdo
// (src/conteudo/paginasSeo.js) tiver aquela parte; os metadados podem
// vir editados do banco (plataforma).

const ICONES = { CalendarDays, Users, Heart, MessageCircle, Clock, Wallet, UserRound, PauseCircle, CalendarPlus, Scissors, QrCode, RotateCcw, Bell, Hand, Eye, Flower2, Receipt, LayoutGrid, Star }
const Celular = () => <div className="sp-celular"><PalcoCelular /></div>
const MOCKS = { desktop: MockDesktop, celular: Celular, profissional: MockProfissional, retorno: MockRetorno, espera: MockEspera, whats: MockWhats, pagamento: MockPagamento, qr: MockQr }

const faqLd = (faq) => ({ '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) })

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
  const pai = pagina?.pai ? paginaSeoPorRota(pagina.pai) : null
  const trilha = pagina ? [['Início', '/'], ...(pai ? [[pai.kicker, pai.rota]] : []), [pagina.kicker, pagina.rota]] : []
  const jsonLd = pagina ? {
    '@context': 'https://schema.org',
    '@graph': [
      ORGANIZACAO_LD,
      migalhasLd(trilha),
      { '@type': 'WebPage', '@id': `${SITE}${pagina.rota}`, url: `${SITE}${pagina.rota}`, name: titulo, description: descricao, isPartOf: { '@id': `${SITE}/#website` }, inLanguage: 'pt-BR', primaryImageOfPage: `${SITE}/imagens/${pagina.foto}-1400.webp` },
      ...(pagina.faq?.length ? [faqLd(pagina.faq)] : []),
    ],
  } : null
  useSeo({ titulo, descricao, caminho: pathname, imagem: seo?.og_image_url || (pagina ? `${SITE}/imagens/${pagina.foto}-1400.webp` : undefined), jsonLd, noindex: !!seo?.noindex })

  if (!pagina) return null
  const relacionados = pagina.artigos.map((s) => artigos.find((a) => a.slug === s)).filter(Boolean)
  const relacionadas = (pagina.relacionadas || []).map(paginaSeoPorRota).filter(Boolean)
  const cta = comecarEm(pagina.cta.tipo)
  const autonoma = pagina.tipo === 'profissao' || pagina.cta.tipo === 'autonoma'

  return (
    <div className="ld sp" ref={raiz}>
      <NavSite />
      <main>
        <section className="ld-hero sp-hero">
          <div className="ld-wrap">
            <nav className="sp-migalhas" aria-label="Você está em">
              {trilha.map(([nome, rota], i) => i < trilha.length - 1
                ? <span key={rota} className="sp-migalha"><Link to={rota}>{nome}</Link><span>›</span></span>
                : <b key={rota}>{nome}</b>)}
            </nav>
            <div className="ld-hero-grade">
              <div className="ld-hero-texto">
                <span className="ld-kicker">{pagina.kicker}</span>
                <h1>{pagina.h1.map((l, i) => <span key={i} className={i === pagina.h1.length - 1 ? '' : 'sp-h1-linha'}>{l}</span>)}</h1>
                <Coracao className="ld-hero-coracao" />
                <p className="ld-lead">{pagina.sub}</p>
                <div className="ld-hero-cta">
                  <a className="ld-btn ld-primario ld-grande" href={cta}>{pagina.cta.rotulo} <ArrowRight size={18} /></a>
                  <a className="ld-btn ld-fantasma ld-grande" href={pagina.modulos ? '#produto' : '/#como-funciona'}>Ver como funciona</a>
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

        {pagina.rotina && <Rotina itens={pagina.rotina} />}

        {pagina.mock && !pagina.modulos && (
          <section className="ld-alt">
            <div className="ld-wrap">
              <Cabeca kicker="O produto" titulo={[pagina.mockTitulo]}>{pagina.mockTexto}</Cabeca>
              <div className="ld-rv">{pagina.mock === 'desktop' ? <MockDesktop /> : <Celular />}</div>
            </div>
          </section>
        )}

        {pagina.modulos && <Modulos itens={pagina.modulos} titulo={pagina.mockTitulo} texto={pagina.mockTexto} />}

        {pagina.blocos && (
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
        )}

        {pagina.funcoes && (
          <section className="ld-alt" id="funcionalidades">
            <div className="ld-wrap">
              <Cabeca kicker="Funcionalidades" titulo={['Funcionalidades que fazem sentido', 'para a sua rotina.']} centro />
              <div className="sp-funcoes">
                {pagina.funcoes.map(([ic, t, d], i) => { const Ic = ICONES[ic] || CalendarDays; return <article className="ld-mini ld-rv" key={t} style={{ transitionDelay: `${i * 50}ms` }}><Ic size={20} /><h3>{t}</h3><p>{d}</p></article> })}
              </div>
            </div>
          </section>
        )}

        {pagina.sinonimos && (
          <section>
            <div className="ld-wrap">
              <div className="sp-sinonimos ld-rv"><h2>{pagina.sinonimos.titulo}</h2><p>{pagina.sinonimos.texto}</p></div>
            </div>
          </section>
        )}

        {pagina.planos && <Planos />}

        {pagina.faixa && (
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
        )}

        <section className="ld-alt" id="perguntas">
          <div className="ld-wrap">
            <Cabeca kicker="Perguntas frequentes" titulo={[pagina.faqTitulo || (pagina.modulos ? 'O que perguntam antes de começar' : 'Dúvidas de quem está começando')]} centro />
            <div className="ld-faq">
              {pagina.faq.map(([q, a], i) => <details className="ld-rv" key={q} style={{ transitionDelay: `${i * 40}ms` }}><summary>{q}<ChevronDown size={18} /></summary><p>{a}</p></details>)}
            </div>
          </div>
        </section>

        {relacionadas.length > 0 && (
          <section>
            <div className="ld-wrap">
              <Cabeca kicker="Veja também" titulo={['Outras partes da mesma MIMO.']} centro />
              <div className="sp-veja">
                {relacionadas.map((p, i) => (
                  <Link className="sp-veja-carta ld-rv" to={p.rota} key={p.rota} style={{ transitionDelay: `${i * 40}ms` }}>
                    <strong>{p.kicker}</strong><span>{p.h1.join(' ')}</span><em>Ver <ArrowRight size={14} /></em>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        {relacionados.length > 0 && (
          <section className="ld-alt">
            <div className="ld-wrap">
              <Cabeca kicker="Conteúdos" titulo={['Guias que ajudam', 'nessa rotina.']}><Link to="/blog" className="ld-link">Ver o blog →</Link></Cabeca>
              <div className="ld-artigos">
                {relacionados.map((a, i) => <CartaoArtigo a={a} key={a.slug} atraso={i * 60} />)}
              </div>
            </div>
          </section>
        )}

        <section>
          <div className="ld-wrap">
            <div className="ld-cta ld-rv sp-cta">
              <div>
                <h2>{autonoma ? 'Sua agenda pronta hoje.' : 'Comece hoje mesmo.'}</h2>
                <p>{autonoma ? 'Crie sua conta grátis, cadastre seus serviços e compartilhe seu link. Sua cliente marca sozinha.' : `Cadastre o salão, monte a equipe e coloque o link no ar. Os primeiros ${REGRAS.testeDias} dias são grátis, sem cartão.`}</p>
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

// a rotina real: a cena que todo salão conhece e o que muda com a MIMO
function Rotina({ itens }) {
  return (
    <section className="ld-alt">
      <div className="ld-wrap">
        <Cabeca kicker="A rotina real" titulo={['Todo salão conhece estas cenas.', 'A MIMO foi feita para elas.']} />
        <div className="sp-rotina">
          {itens.map((c, i) => (
            <article className="sp-rotina-carta ld-rv" key={c.titulo} style={{ transitionDelay: `${i * 50}ms` }}>
              <span className="sp-rotina-n">{String(i + 1).padStart(2, '0')}</span>
              <h3>{c.titulo}</h3>
              <p className="sp-rotina-cena">{c.cena}</p>
              <p className="sp-rotina-resolve"><b>Na MIMO:</b> {c.resolve}</p>
              {c.ancora && <a className="ld-link" href={`#${c.ancora}`}>Ver na MIMO →</a>}
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

// o produto, módulo a módulo, com o mock de verdade (HTML e CSS) ou a foto
function Modulos({ itens, titulo, texto }) {
  return (
    <section id="produto">
      <div className="ld-wrap">
        <Cabeca kicker="O produto" titulo={[titulo || 'O que a MIMO faz, parte por parte.']}>{texto}</Cabeca>
        <div className="sp-modulos">
          {itens.map((m, i) => {
            const Mock = m.mock ? MOCKS[m.mock] : null
            return (
              <article className={'sp-modulo ld-rv' + (i % 2 ? ' sp-modulo-inv' : '')} id={m.id} key={m.id}>
                <div className="sp-modulo-texto">
                  <span className="ld-kicker">{m.kicker}</span>
                  <h2>{m.titulo}</h2>
                  <p>{m.texto}</p>
                  <ul className="ld-checks">{m.itens.map((it) => <li key={it}>{it}</li>)}</ul>
                  {m.links?.length > 0 && <div className="sp-modulo-links">{m.links.map(([rota, rotulo]) => <Link className="ld-link" to={rota} key={rota}>{rotulo} →</Link>)}</div>}
                </div>
                <div className="sp-modulo-mock">{Mock ? <Mock /> : <Foto nome={m.foto} alt={m.alt || ''} />}</div>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// os planos, em três linhas: o que o salão quer saber antes de clicar
function Planos() {
  const { autonoma, pro, promais } = PLANOS
  return (
    <section className="ld-alt" id="precos">
      <div className="ld-wrap">
        <Cabeca kicker="Planos" titulo={['Preço que o salão entende.', 'Sem pedir orçamento.']} centro>Você paga pelas agendas profissionais que usa. Recepção e administração não contam.</Cabeca>
        <div className="sp-planos">
          <article className="sp-plano ld-rv"><span className="ld-pilula">{autonoma.nome}</span><strong>R$ 0</strong><small>por mês, para sempre</small><p>Uma agenda, serviços, clientes, QR e link próprios. Sem cartão.</p></article>
          <article className="sp-plano sp-plano-destaque ld-rv"><span className="ld-pilula">{pro.nome}</span><strong>{reais(pro.base)}</strong><small>por mês · salão até {pro.ate} agendas</small><p>{pro.inclusas} profissionais inclusas e {reais(pro.extra)} por cada uma a mais. {REGRAS.testeDias} dias grátis, sem cartão.</p></article>
          <article className="sp-plano ld-rv"><span className="ld-pilula">{promais.nome}</span><strong>{reais(promais.base)}</strong><small>por mês · 11 agendas ou mais</small><p>{promais.inclusas} profissionais inclusas e {reais(promais.extra)} por cada adicional, sem limite.</p></article>
        </div>
        <div className="ld-centro-botao ld-rv"><Link className="ld-btn ld-fantasma" to="/planos">Ver os planos em detalhe <ArrowRight size={16} /></Link></div>
      </div>
    </section>
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
