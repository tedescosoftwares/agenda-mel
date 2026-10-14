import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, ChevronDown, MapPin, Search, Info, Award, CalendarCheck, LayoutGrid, RotateCcw, X } from 'lucide-react'
import { useSeo } from '../../lib/seo'
import { SLUGS_CATEGORIA, GUIA_CATEGORIAS, categoriaDoGuia, conteudoSeguro, semAcento, seoPadraoDaCidade, rotaDaCidade, rotaDaCategoria } from '../../lib/guia'
import { seoDaCidade, seoDoIndice, trilhaDaCidade, jsonLdDaCidade, jsonLdDoIndice } from '../../lib/guiaSeo'
import { carregarCidade, carregarCidades } from '../../lib/guiaPublico'
import { aoClicarNaPagina } from '../../lib/eventos'
import { useVisita } from '../../lib/useVisita'
import { NavSite, PeSite, useRevelar, comecarEm } from '../../components/site/Pecas'
import { REGRAS } from '../../lib/acesso'
import { CartaoLugar, IconeCategoria } from '../../components/guia/PaginaDoLugar'
import GuiaLugar, { Esqueleto } from './GuiaLugar'
import NaoEncontrada from './NaoEncontrada'
import '../../landing.css'
import '../../guia.css'

// O guia de salões (3.9) no site: uma rota só para as três formas de URL.
//   /saloes                      o índice das cidades
//   /saloes/itanhaem             a cidade (todos os salões publicados)
//   /saloes/itanhaem/unhas       uma categoria na cidade
//   /saloes/itanhaem/ro-coiffeur um salão (o slug nunca é de categoria)
export default function GuiaRota() {
  const { cidade, item } = useParams()
  if (!cidade) return <IndiceDeCidades />
  const x = String(item ?? '').toLowerCase()
  if (x && !SLUGS_CATEGORIA.includes(x)) return <GuiaLugar key={`${cidade}/${x}`} />
  return <PaginaDaCidade key={`${cidade}/${x}`} cidade={String(cidade).toLowerCase()} categoria={x} />
}

const POR_VEZ = 24

// "Salões de beleza em Itanhaém" -> o fim em rosa, como os títulos do site
function TituloCidade({ texto }) {
  const i = texto.lastIndexOf(' em ')
  if (i < 0) return <h1 className="gd-cidade-h1">{texto}</h1>
  return <h1 className="gd-cidade-h1">{texto.slice(0, i)} <span>{texto.slice(i + 1)}</span></h1>
}

function Migalhas({ trilha }) {
  return (
    <nav className="gd-migalhas" aria-label="Você está em">
      {trilha.map(([nome, rota], i) => i < trilha.length - 1
        ? <span key={rota} className="gd-migalha"><Link to={rota}>{nome}</Link><span aria-hidden="true">›</span></span>
        : <b key={rota} aria-current="page">{nome}</b>)}
    </nav>
  )
}

function Falhou({ onTentar }) {
  return (
    <div className="gd-wrap gd-erro">
      <span className="ld-kicker">Sem conexão</span>
      <h1 className="gd-erro-h1">Não deu para abrir o guia agora.</h1>
      <p className="ld-lead">Confira a internet e tente de novo.</p>
      <button type="button" className="ld-btn ld-primario" onClick={onTentar}><RotateCcw size={16} /> Tentar de novo</button>
    </div>
  )
}

function Perguntas({ faq }) {
  if (!faq.length) return null
  return (
    <section className="gd-sec">
      <div className="gd-wrap">
        <div className="gd-sec-cabeca ld-centro ld-rv"><span className="ld-kicker">Dúvidas</span><h2 className="gd-h2">Perguntas frequentes</h2></div>
        <div className="ld-faq">
          {faq.map((f) => <details key={f.pergunta}><summary>{f.pergunta}<ChevronDown size={18} /></summary><p>{f.resposta}</p></details>)}
        </div>
      </div>
    </section>
  )
}

// a chamada para quem atende: é o outro lado do guia
function ChamadaSalao({ cidade }) {
  return (
    <section className="gd-sec">
      <div className="gd-wrap">
        <div className="gd-dono ld-rv">
          <div className="gd-dono-texto">
            <span className="ld-kicker">Para quem atende</span>
            <h2 className="gd-h2">{cidade ? `Tem um salão em ${cidade}?` : 'Tem um salão?'}</h2>
            <p>Coloque sua agenda online: a cliente escolhe o serviço e o horário pelo link ou pelo app, e você recebe tudo organizado, com confirmação pelo WhatsApp.</p>
            <p className="gd-dono-letra">Para autônoma é grátis para sempre. Salão com equipe testa {REGRAS.testeDias} dias, sem cartão.</p>
          </div>
          <div className="gd-dono-botoes">
            <a className="ld-btn ld-branco ld-grande" href={comecarEm()} data-evento="criar_agenda">Colocar minha agenda online <ArrowRight size={18} /></a>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---- /saloes/:cidade e /saloes/:cidade/:categoria ------------------------------------
function PaginaDaCidade({ cidade, categoria }) {
  const [dados, setDados] = useState(undefined)
  const [tentativa, setTentativa] = useState(0)
  const raiz = useRevelar(dados && dados !== 'erro' ? 'pronto' : 'esperando')

  useEffect(() => { window.scrollTo(0, 0) }, [cidade, categoria])
  useEffect(() => {
    let vivo = true
    carregarCidade(cidade, categoria)
      .then((d) => vivo && setDados(d && d.cidade ? d : null))
      .catch(() => vivo && setDados('erro'))
    return () => { vivo = false }
  }, [cidade, categoria, tentativa])
  // a visita conta quando a página existe de verdade (3.11)
  useVisita(`/saloes/${cidade}${categoria ? `/${categoria}` : ''}`, !!(dados && dados !== 'erro'))

  if (dados === null) return <NaoEncontrada />
  return (
    <div className="ld gd" ref={raiz} onClickCapture={aoClicarNaPagina}>
      <NavSite />
      <main className="gd-pagina">
        {dados === undefined && <Esqueleto capa={false} />}
        {dados === 'erro' && <Falhou onTentar={() => { setDados(undefined); setTentativa((t) => t + 1) }} />}
        {dados && dados !== 'erro' && <Cidade dados={dados} />}
      </main>
      <PeSite />
    </div>
  )
}

function Cidade({ dados }) {
  const { cidade, cidade_slug: cslug, categoria } = dados
  const cat = categoria ? categoriaDoGuia(categoria) : null
  const pagina = conteudoSeguro(dados.pagina)
  const faq = pagina?.faq ?? []
  const seo = seoDaCidade(cidade, cslug, categoria, dados.pagina)
  useSeo({ titulo: seo.titulo, descricao: seo.descricao, caminho: seo.caminho, jsonLd: jsonLdDaCidade(dados, faq) })

  const lugares = useMemo(() => (Array.isArray(dados.lugares) ? dados.lugares : []), [dados.lugares])
  const bairros = Array.isArray(dados.bairros) ? dados.bairros : []
  const categorias = (Array.isArray(dados.categorias) ? dados.categorias : []).filter((c) => SLUGS_CATEGORIA.includes(c.categoria))
  const [bairro, setBairroCru] = useState('')
  const [busca, setBuscaCru] = useState('')
  const [limite, setLimite] = useState(POR_VEZ)
  // filtro novo começa a lista do começo
  const setBairro = (b) => { setBairroCru(b); setLimite(POR_VEZ) }
  const setBusca = (q) => { setBuscaCru(q); setLimite(POR_VEZ) }

  // filtro na hora, no navegador: o banco já mandou a lista inteira da cidade
  const filtrados = useMemo(() => {
    const q = semAcento(busca).toLowerCase().trim()
    return lugares.filter((l) => {
      if (bairro && l.bairro !== bairro) return false
      if (!q) return true
      return semAcento([l.nome, l.bairro, ...(l.servicos ?? [])].join(' ')).toLowerCase().includes(q)
    })
  }, [lugares, bairro, busca])

  const trilha = trilhaDaCidade(cidade, cslug, categoria)
  const lead = pagina?.chamada || seoPadraoDaCidade(cidade, categoria).meta_description
  const intro = pagina?.intro?.length ? pagina.intro : [
    `O guia reúne ${cat ? `${cat.plural} de ${cidade}` : `salões de beleza, manicures, cílios, sobrancelha e estética de ${cidade}`} com o endereço, o bairro, o horário e os serviços de cada um. ` +
      'As informações vêm de dados públicos dos estabelecimentos; quem já agenda pela MIMO aparece com o selo Na MIMO.',
  ]
  const totalAqui = cat ? lugares.length : dados.total
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`

  return (
    <>
      <section className="gd-cidade-heroi">
        <div className="gd-wrap">
          <Migalhas trilha={trilha} />
          <div className="gd-cidade-grade">
            <div>
              <span className="ld-kicker">{cat ? `Guia de salões · ${cidade}` : `Guia de salões · ${dados.uf || 'SP'}`}</span>
              <TituloCidade texto={seo.h1} />
              <p className="ld-lead">{lead}</p>
              <div className="gd-numeros">
                <span className="gd-numero"><strong>{totalAqui}</strong><span>{cat ? (totalAqui === 1 ? cat.singular : cat.plural) : (totalAqui === 1 ? 'lugar no guia' : 'lugares no guia')}</span></span>
                {!cat && categorias.length > 1 && <span className="gd-numero"><strong>{categorias.length}</strong><span>categorias</span></span>}
                {bairros.length > 0 && <span className="gd-numero"><strong>{bairros.length}</strong><span>{bairros.length === 1 ? 'bairro' : 'bairros'}</span></span>}
              </div>
            </div>
            <nav className="gd-tiles" aria-label={`Categorias em ${cidade}`}>
              <Link to={rotaDaCidade(cslug)} className={'gd-tile gd-tile-todos' + (!cat ? ' gd-tile-on' : '')} aria-current={!cat ? 'page' : undefined}>
                <span className="gd-tile-ic"><LayoutGrid size={18} /></span>
                <span><b>Todos</b><small>{plural(dados.total, 'lugar', 'lugares')}</small></span>
              </Link>
              {categorias.map((c) => {
                const k = categoriaDoGuia(c.categoria)
                const atual = c.categoria === categoria
                return (
                  <Link key={c.categoria} to={rotaDaCategoria(cslug, c.categoria)} className={`gd-tile gd-tom-${c.categoria}` + (atual ? ' gd-tile-on' : '')} aria-current={atual ? 'page' : undefined}>
                    <IconeCategoria slug={c.categoria} className="gd-tile-fundo" strokeWidth={1.2} aria-hidden="true" />
                    <span className="gd-tile-ic"><IconeCategoria slug={c.categoria} size={18} /></span>
                    <span><b>{k.rotulo}</b><small>{plural(c.total, 'lugar', 'lugares')}</small></span>
                  </Link>
                )
              })}
            </nav>
          </div>
        </div>
      </section>

      <section className="gd-sec gd-sec-lista">
        <div className="gd-wrap">
          <div className="gd-intro ld-rv">
            <div className="gd-texto">{intro.map((p, i) => <p key={i}>{p}</p>)}</div>
          </div>
        </div>
        <div className="gd-wrap" id="lista">
          <h2 className="gd-h2 gd-lista-h2">{cat ? `${cat.artigo} ${cat.plural} de ${cidade}` : `Os salões de ${cidade}`}</h2>
          <div className="gd-filtros">
            <label className="gd-busca">
              <Search size={18} aria-hidden="true" />
              <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou serviço" aria-label="Buscar por nome, bairro ou serviço" />
            </label>
            {bairros.length > 1 && (
              <div className="gd-bairros" role="group" aria-label="Filtrar por bairro">
                <button type="button" className="gd-chip-filtro" aria-pressed={!bairro} onClick={() => setBairro('')}>Todos os bairros</button>
                {bairros.map((b) => (
                  <button key={b.bairro} type="button" className="gd-chip-filtro" aria-pressed={bairro === b.bairro} onClick={() => setBairro(bairro === b.bairro ? '' : b.bairro)}>
                    <MapPin size={14} aria-hidden="true" /> {b.bairro} <small>{b.total}</small>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="gd-lista-topo" aria-live="polite">
            <span><b>{plural(filtrados.length, 'lugar', 'lugares')}</b>{bairro ? ` no bairro ${bairro}` : ''}{busca.trim() ? ` para “${busca.trim()}”` : ''}</span>
            {(bairro || busca) && <button type="button" className="gd-chip-filtro" onClick={() => { setBairro(''); setBusca('') }}><X size={14} /> Limpar filtros</button>}
          </div>

          {filtrados.length ? (
            <div className="gd-cartoes gd-cartoes-lista">
              {filtrados.slice(0, limite).map((l) => <CartaoLugar key={l.slug} lugar={l} cidadeSlug={cslug} cidade={cidade} />)}
            </div>
          ) : (
            <div className="gd-vazio">
              <Search size={26} />
              <p>Nenhum lugar com esse filtro.</p>
              <button type="button" className="ld-btn ld-fantasma" onClick={() => { setBairro(''); setBusca('') }}>Ver todos</button>
            </div>
          )}
          {filtrados.length > limite && (
            <div className="gd-mais"><button type="button" className="ld-btn ld-fantasma" onClick={() => setLimite((n) => n + POR_VEZ)}>Ver mais {Math.min(POR_VEZ, filtrados.length - limite)} de {filtrados.length - limite} <ChevronDown size={16} /></button></div>
          )}
        </div>
      </section>

      {pagina?.como_escolher?.itens?.length > 0 && (
        <section className="gd-sec gd-sec-alt">
          <div className="gd-wrap">
            <div className="gd-escolher ld-rv">
              <span className="ld-kicker">Como escolher</span>
              <h2 className="gd-h2">{pagina.como_escolher.titulo || `Como escolher ${cat ? cat.singular : 'um salão'} em ${cidade}`}</h2>
              <ol>{pagina.como_escolher.itens.map((t) => <li key={t}><span>{t}</span></li>)}</ol>
            </div>
          </div>
        </section>
      )}

      <Perguntas faq={faq} />

      {cat && categorias.length > 1 && (
        <section className="gd-sec gd-sec-alt">
          <div className="gd-wrap">
            <div className="gd-sec-cabeca"><span className="ld-kicker">Mais no guia</span><h2 className="gd-h2">Outras categorias em {cidade}</h2></div>
            <div className="gd-outras">
              <Link className="gd-outra" to={rotaDaCidade(cslug)}><LayoutGrid size={15} /> Todos os salões de {cidade}</Link>
              {categorias.filter((c) => c.categoria !== categoria).map((c) => <Link key={c.categoria} className="gd-outra" to={rotaDaCategoria(cslug, c.categoria)}><IconeCategoria slug={c.categoria} size={15} /> {categoriaDoGuia(c.categoria).rotulo} <small>({c.total})</small></Link>)}
            </div>
          </div>
        </section>
      )}

      <ChamadaSalao cidade={cidade} />
      <section className="gd-sec gd-sec-aviso">
        <div className="gd-wrap">
          <p className="gd-aviso"><Info size={18} aria-hidden="true" /><span>Guia informativo feito pela MIMO com dados públicos dos estabelecimentos. Só quem tem o selo Na MIMO agenda pela MIMO. Seleção MIMO é a curadoria da nossa equipe.</span></p>
        </div>
      </section>
    </>
  )
}

// ---- /saloes ----------------------------------------------------------------------------
function IndiceDeCidades() {
  const [cidades, setCidades] = useState(undefined)
  const [tentativa, setTentativa] = useState(0)
  const raiz = useRevelar(cidades && cidades !== 'erro' ? 'pronto' : 'esperando')
  const seo = seoDoIndice()
  useSeo({ titulo: seo.titulo, descricao: seo.descricao, caminho: seo.caminho, jsonLd: jsonLdDoIndice(Array.isArray(cidades) ? cidades : []) })

  useEffect(() => { window.scrollTo(0, 0) }, [])
  useVisita('/saloes')
  useEffect(() => {
    let vivo = true
    carregarCidades().then((c) => vivo && setCidades(c)).catch(() => vivo && setCidades('erro'))
    return () => { vivo = false }
  }, [tentativa])

  const lista = Array.isArray(cidades) ? cidades : []
  return (
    <div className="ld gd" ref={raiz}>
      <NavSite />
      <main className="gd-pagina">
        <section className="gd-cidade-heroi">
          <div className="gd-wrap">
            <Migalhas trilha={[['Início', '/'], ['Salões', '/saloes']]} />
            <span className="ld-kicker">Guia de salões</span>
            <h1 className="gd-cidade-h1">Salões de beleza <span>por cidade</span></h1>
            <p className="ld-lead">{seo.descricao}</p>
          </div>
        </section>

        <section className="gd-sec">
          <div className="gd-wrap">
            {cidades === undefined && <Esqueleto capa={false} />}
            {cidades === 'erro' && <Falhou onTentar={() => { setCidades(undefined); setTentativa((t) => t + 1) }} />}
            {Array.isArray(cidades) && (lista.length ? (
              <div className="gd-cidades">
                {lista.map((c) => (
                  <Link key={c.cidade_slug} className="gd-cidade ld-rv" to={rotaDaCidade(c.cidade_slug)}>
                    <span><small>{c.uf || 'SP'}</small><span className="gd-cidade-nome">{c.cidade}</span></span>
                    <span className="gd-cidade-pe"><span>{c.total} {c.total === 1 ? 'lugar no guia' : 'lugares no guia'}</span><span><ArrowRight size={20} /></span></span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="gd-vazio"><MapPin size={26} /><p>O guia está chegando. Em breve, os salões da sua cidade aparecem aqui.</p></div>
            ))}
          </div>
        </section>

        <section className="gd-sec gd-sec-alt">
          <div className="gd-wrap">
            <div className="gd-sec-cabeca"><span className="ld-kicker">Como funciona</span><h2 className="gd-h2">Um guia feito com cuidado</h2></div>
            <div className="gd-como">
              <article className="ld-mini ld-rv"><Info size={20} /><h3>Dados públicos</h3><p>Endereço, horário, serviços e canais que o próprio estabelecimento divulga. Viu algo errado? Cada página tem como corrigir.</p></article>
              <article className="ld-mini ld-rv"><Award size={20} /><h3>Seleção MIMO</h3><p>O selo marca a curadoria da equipe MIMO: lugares que a casa escolheu destacar no guia. É uma escolha da casa, não um ranking.</p></article>
              <article className="ld-mini ld-rv"><CalendarCheck size={20} /><h3>Marque pelo app</h3><p>Quem tem o selo Na MIMO agenda pelo link ou pelo app. Nos outros, conte que quer marcar e a gente avisa o salão.</p></article>
            </div>
            <p className="sp-nota gd-nota-cat">Categorias do guia: {GUIA_CATEGORIAS.map((c) => c.rotulo.toLowerCase()).join(', ')}.</p>
          </div>
        </section>

        <ChamadaSalao />
      </main>
      <PeSite />
    </div>
  )
}
