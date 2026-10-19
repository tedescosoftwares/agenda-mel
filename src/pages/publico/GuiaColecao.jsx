import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronDown, Clock, Info, LayoutGrid, MapPin, Search, X } from 'lucide-react'
import { useSeo } from '../../lib/seo'
import { categoriaDoGuia, rotaDaCidade, rotaDaCategoria, semAcento } from '../../lib/guia'
import { rotuloDoHorario } from '../../lib/guiaColecoes'
import { seoDaColecao, jsonLdDaColecao, trilhaDaColecao } from '../../lib/guiaSeo'
import { carregarColecao } from '../../lib/guiaColecoesPublico'
import { aoClicarNaPagina } from '../../lib/eventos'
import { useVisita } from '../../lib/useVisita'
import { NavSite, PeSite, useRevelar } from '../../components/site/Pecas'
import { CartaoLugar, IconeCategoria } from '../../components/guia/PaginaDoLugar'
import PertoDeVoce from '../../components/guia/PertoDeVoce'
import { useMinhaPosicao, comDistancia } from '../../lib/guiaPerto'
import { Migalhas, Falhou, Perguntas, ChamadaSalao } from './GuiaCidade'
import { Esqueleto } from './GuiaLugar'
import NaoEncontrada from './NaoEncontrada'
import '../../landing.css'
import '../../guia.css'
import '../../guia-colecao.css'

// As páginas de coleção do guia (3.12), feitas dos dados, sem IA:
//   /saloes/itanhaem/bairro/centro           os salões de um bairro
//   /saloes/itanhaem/horario/domingo         os que abrem no domingo (cedo, noite, sábado o dia todo)
//   /saloes/itanhaem/horario/domingo/unhas   o mesmo horário numa categoria
// A coleção vem pronta do servidor (3.25: um JSON por coleção, montado pelo
// gerador com guiaColecoes.js, o mesmo que o HTML estático usa); sem o
// arquivo, os salões no ar da cidade (guia_colecoes, 157) e a montagem aqui.
// Coleção abaixo do mínimo de salões não existe (404).
export default function GuiaColecao({ tipo }) {
  const { cidade, valor, categoria = '' } = useParams()
  const c = String(cidade ?? '').toLowerCase(), v = String(valor ?? '').toLowerCase(), cat = String(categoria).toLowerCase()
  // outra coleção é outra montagem: nada de dado velho na tela
  return <PaginaDaColecao key={`${c}/${tipo}/${v}/${cat}`} cidade={c} tipo={tipo} valor={v} categoria={cat} />
}

const POR_VEZ = 24

function PaginaDaColecao({ cidade, tipo, valor, categoria }) {
  // undefined = carregando · null = não existe · 'erro' = a rede falhou
  const [dados, setDados] = useState(undefined)
  const [tentativa, setTentativa] = useState(0)
  const pronta = !!(dados && dados !== 'erro')
  const raiz = useRevelar(pronta ? 'pronto' : 'esperando')

  useEffect(() => { window.scrollTo(0, 0) }, [])
  useEffect(() => {
    let vivo = true
    carregarColecao(cidade, tipo, valor, categoria)
      .then((m) => vivo && setDados(m ?? null))
      .catch(() => vivo && setDados('erro'))
    return () => { vivo = false }
  }, [cidade, tipo, valor, categoria, tentativa])
  // a visita conta quando a página existe de verdade (3.11)
  useVisita(pronta ? dados.caminho : null, pronta)

  if (dados === null) return <NaoEncontrada />
  return (
    <div className="ld gd" ref={raiz} onClickCapture={aoClicarNaPagina}>
      <NavSite />
      <main className="gd-pagina">
        {dados === undefined && <Esqueleto capa={false} />}
        {dados === 'erro' && <Falhou onTentar={() => { setDados(undefined); setTentativa((t) => t + 1) }} />}
        {pronta && <Colecao m={dados} />}
      </main>
      <PeSite />
    </div>
  )
}

// "Salões de beleza no Centro de Itanhaém" -> do destaque em diante em rosa, como os títulos do site
function Titulo({ texto, destaque }) {
  const i = destaque ? texto.indexOf(destaque) : -1
  if (i <= 0) return <h1 className="gd-cidade-h1 gd-col-h1">{texto}</h1>
  return <h1 className="gd-cidade-h1 gd-col-h1">{texto.slice(0, i).trim()} <span>{texto.slice(i)}</span></h1>
}

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`

function Colecao({ m }) {
  const seo = seoDaColecao(m)
  useSeo({ titulo: seo.titulo, descricao: seo.descricao, caminho: seo.caminho, jsonLd: jsonLdDaColecao(m) })
  const cat = m.categoria ? categoriaDoGuia(m.categoria) : null
  const [filtro, setFiltroCru] = useState('')
  const [busca, setBuscaCru] = useState('')
  const [limite, setLimite] = useState(POR_VEZ)
  // filtro novo começa a lista do começo
  const setFiltro = (f) => { setFiltroCru(f); setLimite(POR_VEZ) }
  const setBusca = (q) => { setBuscaCru(q); setLimite(POR_VEZ) }
  // "perto de você" (3.13): com a posição, cada cartão ganha a distância e a lista vem do mais perto
  const { posicao } = useMinhaPosicao()
  const [porDistancia, setPorDistancia] = useState(true)

  // o filtro por categoria (quando a lista tem mais de uma)
  const categorias = useMemo(() => {
    const n = new Map()
    for (const c of m.cartoes) n.set(c.categoria, (n.get(c.categoria) ?? 0) + 1)
    return [...n].sort((a, b) => b[1] - a[1])
  }, [m.cartoes])
  const filtrados = useMemo(() => {
    const q = semAcento(busca).toLowerCase().trim()
    return comDistancia(m.cartoes.filter((c) => {
      if (filtro && c.categoria !== filtro) return false
      if (!q) return true
      return semAcento([c.nome, c.bairro, ...(c.servicos ?? [])].join(' ')).toLowerCase().includes(q)
    }), posicao, porDistancia)
  }, [m.cartoes, filtro, busca, posicao, porDistancia])
  const limpar = () => { setFiltro(''); setBusca('') }

  const kicker = m.tipo === 'bairro' ? `Guia de salões · ${m.cidade} · por bairro` : `Guia de salões · ${m.cidade} · por horário`
  const tituloLista = m.tipo === 'bairro' ? `Os endereços ${/^centro$/i.test(m.nome) ? 'do Centro' : `do bairro ${m.nome}`}` : m.h1.slice(0, m.h1.lastIndexOf(` em ${m.cidade}`))
  const { bairros, horarios, categorias: outrasCategorias } = m.relacionadas

  return (
    <>
      <section className="gd-cidade-heroi">
        <div className="gd-wrap">
          <Migalhas trilha={trilhaDaColecao(m)} />
          <div className="gd-col-heroi">
            <span className="ld-kicker">{kicker}</span>
            <Titulo texto={m.h1} destaque={m.destaque} />
            <p className="ld-lead">{m.chamada}</p>
            <div className="gd-numeros">
              {m.numeros.map((x) => <span key={x.rotulo} className="gd-numero"><strong>{x.valor}</strong><span>{x.rotulo}</span></span>)}
            </div>
          </div>
        </div>
      </section>

      <section className="gd-sec gd-sec-lista">
        <div className="gd-wrap">
          <div className="gd-intro ld-rv">
            <div className="gd-texto">{m.intro.map((p, i) => <p key={i}>{p}</p>)}</div>
          </div>
        </div>
        <div className="gd-wrap" id="lista">
          <h2 className="gd-h2 gd-lista-h2">{tituloLista}</h2>
          <div className="gd-filtros">
            <label className="gd-busca">
              <Search size={18} aria-hidden="true" />
              <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou serviço" aria-label="Buscar por nome, bairro ou serviço" />
            </label>
            {categorias.length > 1 && (
              <div className="gd-bairros" role="group" aria-label="Filtrar por categoria">
                <button type="button" className="gd-chip-filtro" aria-pressed={!filtro} onClick={() => setFiltro('')}>Todas as categorias</button>
                {categorias.map(([c, n]) => (
                  <button key={c} type="button" className="gd-chip-filtro" aria-pressed={filtro === c} onClick={() => setFiltro(filtro === c ? '' : c)}>
                    <IconeCategoria slug={c} size={14} aria-hidden="true" /> {categoriaDoGuia(c).curto} <small>{n}</small>
                  </button>
                ))}
              </div>
            )}
          </div>

          <PertoDeVoce ordenado={porDistancia} onOrdenar={setPorDistancia} />
          <div className="gd-lista-topo" aria-live="polite">
            <span><b>{plural(filtrados.length, 'lugar', 'lugares')}</b>{filtro ? ` em ${categoriaDoGuia(filtro).rotulo.toLowerCase()}` : ''}{busca.trim() ? ` para “${busca.trim()}”` : ''}</span>
            {(filtro || busca) && <button type="button" className="gd-chip-filtro" onClick={limpar}><X size={14} /> Limpar filtros</button>}
          </div>

          {filtrados.length ? (
            <div className={'gd-cartoes gd-cartoes-lista' + (m.tipo === 'horario' ? ' gd-col-cartoes-hora' : '')}>
              {filtrados.slice(0, limite).map((c) => <CartaoLugar key={c.slug} lugar={c} cidadeSlug={m.cidade_slug} cidade={m.cidade} />)}
            </div>
          ) : (
            <div className="gd-vazio">
              <Search size={26} />
              <p>Nenhum lugar com esse filtro.</p>
              <button type="button" className="ld-btn ld-fantasma" onClick={limpar}>Ver todos</button>
            </div>
          )}
          {filtrados.length > limite && (
            <div className="gd-mais"><button type="button" className="ld-btn ld-fantasma" onClick={() => setLimite((n) => n + POR_VEZ)}>Ver mais {Math.min(POR_VEZ, filtrados.length - limite)} de {filtrados.length - limite} <ChevronDown size={16} /></button></div>
          )}
        </div>
      </section>

      <Perguntas faq={m.faq} />

      <section className="gd-sec gd-sec-alt" aria-labelledby="gd-col-mais-t">
        <div className="gd-wrap">
          <div className="gd-sec-cabeca"><span className="ld-kicker">Mais no guia</span><h2 id="gd-col-mais-t" className="gd-h2">Continue procurando em {m.cidade}</h2></div>
          {outrasCategorias.length > 0 && (
            <nav className="gd-col-grupo" aria-label="O mesmo horário em outras categorias">
              <h3 className="gd-h3">{m.categoria ? `${rotuloDoHorario(m.valor)} em outras categorias` : `${rotuloDoHorario(m.valor)}, por categoria`}</h3>
              <div className="gd-outras">{outrasCategorias.map((c) => <Link key={c.caminho} className="gd-outra" to={c.caminho}><IconeCategoria slug={c.categoria} size={15} /> {c.rotulo} <small>({c.total})</small></Link>)}</div>
            </nav>
          )}
          {horarios.length > 0 && (
            <nav className="gd-col-grupo" aria-label={`Por horário em ${m.cidade}`}>
              <h3 className="gd-h3">Por horário</h3>
              <div className="gd-outras">{horarios.map((c) => <Link key={c.caminho} className="gd-outra" to={c.caminho}><Clock size={15} /> {c.rotulo} <small>({c.total})</small></Link>)}</div>
            </nav>
          )}
          {bairros.length > 0 && (
            <nav className="gd-col-grupo" aria-label={`Por bairro em ${m.cidade}`}>
              <h3 className="gd-h3">{m.tipo === 'bairro' ? 'Outros bairros' : 'Por bairro'}</h3>
              <div className="gd-outras">{bairros.map((c) => <Link key={c.caminho} className="gd-outra" to={c.caminho}><MapPin size={15} /> {c.rotulo} <small>({c.total})</small></Link>)}</div>
            </nav>
          )}
          <div className="gd-outras gd-col-voltar">
            <Link className="gd-outra" to={rotaDaCidade(m.cidade_slug)}><LayoutGrid size={15} /> Todos os salões de {m.cidade}</Link>
            {cat && <Link className="gd-outra" to={rotaDaCategoria(m.cidade_slug, m.categoria)}><IconeCategoria slug={m.categoria} size={15} /> {cat.rotulo} em {m.cidade}</Link>}
          </div>
        </div>
      </section>

      <ChamadaSalao cidade={m.cidade} />
      <section className="gd-sec gd-sec-aviso">
        <div className="gd-wrap">
          <p className="gd-aviso"><Info size={18} aria-hidden="true" /><span>Guia informativo feito pela MIMO com dados públicos dos estabelecimentos: endereço, horário e serviços que cada um divulga. Horário muda em feriado e na temporada; confirme antes de ir. Só quem tem o selo Na MIMO agenda pela MIMO.</span></p>
        </div>
      </section>
    </>
  )
}
