import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, MapPin } from 'lucide-react'
import { useSeo } from '../../lib/seo'
import { categoriaDoGuia, rotaDaCidade, rotaDaCategoria, miniatura, paraFotoInteira } from '../../lib/guia'
import { seoDaRegiao, trilhaDaRegiao, jsonLdDaRegiao } from '../../lib/guiaSeo'
import { carregarCidades, carregarRegioes } from '../../lib/guiaPublico'
import { dadosDaRegiao, faqDaRegiao, preposicaoDaRegiao } from '../../lib/guiaRegioes'
import { useVisita } from '../../lib/useVisita'
import { NavSite, PeSite, useRevelar } from '../../components/site/Pecas'
import { IconeCategoria } from '../../components/guia/PaginaDoLugar'
import { Migalhas, Falhou, Perguntas, ChamadaSalao } from './GuiaCidade'
import { Esqueleto } from './GuiaLugar'
import NaoEncontrada from './NaoEncontrada'
import '../../landing.css'
import '../../guia.css'

// A página de região (3.37): /saloes/regiao/baixada-santista. Acima das cidades: a foto da região esticada no topo,
// a chamada escrita na Plataforma, os números, as cidades em cartões (com a foto de cada uma), as categorias somadas e
// as perguntas respondidas com os números. Sem texto de IA: a página se sustenta nas cidades e nos números.
export default function GuiaRegiao() {
  const { regiao: slug } = useParams()
  const [regioes, setRegioes] = useState(undefined)
  const [cidades, setCidades] = useState(undefined)
  const [tentativa, setTentativa] = useState(0)
  useEffect(() => {
    let vivo = true
    carregarRegioes().then((r) => vivo && setRegioes(r)).catch(() => vivo && setRegioes('erro'))
    carregarCidades().then((c) => vivo && setCidades(c)).catch(() => vivo && setCidades('erro'))
    return () => { vivo = false }
  }, [slug, tentativa])
  useEffect(() => { window.scrollTo(0, 0) }, [slug])

  const regiao = Array.isArray(regioes) ? regioes.find((r) => r.slug === String(slug).toLowerCase()) ?? null : undefined
  const d = useMemo(() => (regiao && Array.isArray(cidades) ? dadosDaRegiao(regiao, cidades) : null), [regiao, cidades])
  const faq = useMemo(() => (d ? faqDaRegiao(d, (s) => categoriaDoGuia(s).rotulo) : []), [d])
  const seo = d ? seoDaRegiao(d) : null
  const pronto = !!d
  const raiz = useRevelar(pronto ? 'pronto' : 'esperando')
  useSeo(seo ? { titulo: seo.titulo, descricao: seo.descricao, caminho: seo.caminho, imagem: d.foto || undefined, jsonLd: jsonLdDaRegiao(d, faq) } : {})
  useVisita(seo?.caminho ?? '', pronto)

  if (regioes === 'erro' || cidades === 'erro') {
    return <div className="ld gd"><NavSite /><main className="gd-pagina"><section className="gd-sec"><div className="gd-wrap"><Falhou onTentar={() => { setRegioes(undefined); setCidades(undefined); setTentativa((t) => t + 1) }} /></div></section></main><PeSite /></div>
  }
  if (regiao === null) return <NaoEncontrada />
  if (!d) return <div className="ld gd"><NavSite /><main className="gd-pagina"><section className="gd-sec"><div className="gd-wrap"><Esqueleto capa={false} /></div></section></main><PeSite /></div>

  const prep = preposicaoDaRegiao(regiao.nome)
  const chamada = regiao.chamada || `${d.cidades.length === 1 ? 'A cidade' : `As ${d.cidades.length} cidades`} ${prep.replace('n', 'd')} ${regiao.nome} no guia, com os salões, as manicures e os estúdios de cada uma: endereço, horário e serviços.`
  return (
    <div className="ld gd" ref={raiz} data-teste="pagina-regiao">
      <NavSite />
      <main className="gd-pagina">
        <section className={'gd-cidade-heroi' + (d.foto ? ' gd-com-fundo' : '')}>
          {d.foto && <div className="gd-cidade-fundo-foto" aria-hidden="true" data-teste="fundo-da-regiao"><img src={d.foto} alt="" fetchPriority="high" decoding="async" /></div>}
          <div className="gd-wrap">
            <Migalhas trilha={trilhaDaRegiao(regiao)} />
            <div className="gd-cidade-grade">
              <div>
                <span className="ld-kicker">Guia de salões · {regiao.uf || 'SP'}</span>
                <h1 className="gd-cidade-h1">Salões de beleza <span>{prep} {regiao.nome}</span></h1>
                <p className="ld-lead">{chamada}</p>
                <div className="gd-numeros">
                  <span className="gd-numero"><strong>{d.cidades.length}</strong><span>{d.cidades.length === 1 ? 'cidade' : 'cidades'}</span></span>
                  <span className="gd-numero"><strong>{d.total.toLocaleString('pt-BR')}</strong><span>{d.total === 1 ? 'lugar no guia' : 'lugares no guia'}</span></span>
                  {d.categorias.length > 1 && <span className="gd-numero"><strong>{d.categorias.length}</strong><span>categorias</span></span>}
                </div>
              </div>
            </div>
          </div>
        </section>

        {regiao.texto && (
          <section className="gd-sec">
            <div className="gd-wrap"><div className="gd-intro ld-rv"><div className="gd-texto"><p>{regiao.texto}</p></div></div></div>
          </section>
        )}

        <section className="gd-sec" aria-labelledby="gd-regiao-cidades">
          <div className="gd-wrap">
            <div className="gd-sec-cabeca"><span className="ld-kicker">Por cidade</span><h2 id="gd-regiao-cidades" className="gd-h2">As cidades {prep.replace('n', 'd')} {regiao.nome} no guia</h2></div>
            {d.cidades.length ? (
              <div className="gd-cidades" data-teste="cidades-da-regiao">
                {d.cidades.map((c) => (
                  <Link key={c.cidade_slug} className={'gd-cidade ld-rv' + (c.foto ? ' gd-cidade-com-foto' : '')} to={rotaDaCidade(c.cidade_slug)}>
                    {c.foto && <img className="gd-cidade-fundo" src={miniatura(c.foto)} data-cheia={c.foto} onError={paraFotoInteira} alt="" loading="lazy" decoding="async" />}
                    <span><small>{c.uf || 'SP'}</small><span className="gd-cidade-nome">{c.cidade}</span></span>
                    <span className="gd-cidade-pe"><span>{c.total} {c.total === 1 ? 'lugar no guia' : 'lugares no guia'}</span><span><ArrowRight size={20} /></span></span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="gd-vazio"><MapPin size={26} /><p>As cidades desta região estão chegando ao guia.</p></div>
            )}
          </div>
        </section>

        {d.categorias.length > 0 && (
          <section className="gd-sec gd-sec-alt" aria-labelledby="gd-regiao-cats">
            <div className="gd-wrap">
              <div className="gd-sec-cabeca"><span className="ld-kicker">O que você procura</span><h2 id="gd-regiao-cats" className="gd-h2">Por categoria {prep} {regiao.nome}</h2><p>Cada categoria tem a própria página em cada cidade.</p></div>
              <div className="gd-cat-cards">
                {d.categorias.map((k) => {
                  const cat = categoriaDoGuia(k.categoria)
                  const comEla = d.cidades.map((c) => ({ c, n: (Array.isArray(c.categorias) ? c.categorias : []).find((x) => x.categoria === k.categoria)?.total ?? 0 })).filter((x) => x.n > 0)
                  return (
                    <div key={k.categoria} className="gd-cat-card gd-cat-card-indice ld-rv">
                      <span className={`gd-cat-ic gd-tom-${k.categoria}`}><IconeCategoria slug={k.categoria} size={20} /></span>
                      <span>
                        <b>{cat.rotulo} <small>{k.total.toLocaleString('pt-BR')}</small></b>{cat.resumo && <small>{cat.resumo}</small>}
                        <span className="gd-cat-cidades">{comEla.map(({ c, n }) => <Link key={c.cidade_slug} to={rotaDaCategoria(c.cidade_slug, k.categoria)}>{c.cidade} <strong>{n}</strong></Link>)}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        )}

        <Perguntas faq={faq} />
        <ChamadaSalao />
      </main>
      <PeSite />
    </div>
  )
}
