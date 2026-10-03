import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, Clock, Plus, Search, Sparkles, X } from 'lucide-react'
import { useCatalogo, imagemDaCategoria } from '../lib/catalogo'
import { buscar, sugestoes, duracaoDe, nomeSugerido, quantosServicos, cadeia } from '../lib/catalogoBusca'
import { formatDuracao } from '../lib/format'
import { falaDaMel } from '../lib/melMotor'
import { avatarDaMel, MEL_PADRAO } from '../lib/mel'

// O catálogo assistido (2.91): a MIMO sugere, a pessoa escolhe, a MIMO
// pré-preenche, a pessoa personaliza no formulário de sempre.
//
//   inicio → categoria → familia → servico (técnica opcional) → onEscolher
//
// Uma experiência contínua no mesmo painel: o conteúdo troca por etapa, a
// trilha em cima leva de volta sem perder o que já foi escolhido, e
// "Não encontrou? Criar meu próprio serviço" está em todas as etapas
// (onPersonalizado). Preço nunca vem daqui. O que a Mel fala em cada passo
// vem da biblioteca (momentos cardapio_*); sem frase, ela não aparece.

// a fala da Mel num momento do cadastro, pedida uma vez por (momento, dados)
export function useFalaDaMel(salaoId, momento, dados) {
  const chave = momento && salaoId ? momento + '|' + JSON.stringify(dados ?? {}) : ''
  const [fala, setFala] = useState(null)
  const pedidas = useRef(new Map())
  useEffect(() => {
    if (!chave) { setFala(null); return }
    if (pedidas.current.has(chave)) { setFala(pedidas.current.get(chave)); return }
    let vivo = true
    falaDaMel(salaoId, momento, dados).then((f) => { pedidas.current.set(chave, f ?? null); if (vivo) setFala(f ?? null) })
    return () => { vivo = false }
  }, [chave]) // eslint-disable-line react-hooks/exhaustive-deps
  return fala
}

export function MelFala({ fala, className = '' }) {
  const [falhou, setFalhou] = useState(false)
  if (!fala?.texto) return null
  const src = falhou ? MEL_PADRAO : fala.avatar_key ? avatarDaMel(fala.avatar_key) : MEL_PADRAO
  return (
    <div className={'cardapio-mel ' + className} role="status">
      <img src={src} alt="" onError={() => setFalhou(true)} />
      <p>{fala.texto}</p>
    </div>
  )
}

// a imagem de família ou serviço: imagem_url do catálogo, senão a convenção
// /imagens/catalogo/<categoria>/<familia>[/<servico>].webp; sem arquivo, nada
export function imagemDoItem(item) {
  if (!item) return null
  return item.imagem_url || (item.caminho_slugs?.length ? `/imagens/catalogo/${item.caminho_slugs.join('/')}.webp` : null)
}
// miniatura que some quando o arquivo não existe; avisa o pai (onEstado) para o layout se ajustar
function Miniatura({ item, onEstado }) {
  const [ok, setOk] = useState(null)   // null = ainda não sabe; false = sem arquivo
  const src = imagemDoItem(item)
  if (!src || ok === false) return null
  return <span className="cardapio-mini" aria-hidden="true"><img src={src} alt="" loading="lazy" onLoad={() => { setOk(true); onEstado?.(true) }} onError={() => { setOk(false); onEstado?.(false) }} /></span>
}
function useMiniaturas() {
  const [temMini, setTemMini] = useState({})
  const marcar = (id, ok) => setTemMini((m) => (m[id] === ok ? m : { ...m, [id]: ok }))
  return [temMini, marcar]
}

export default function CadastroDeServico({ salaoId, categoriasEscolhidas = [], nServicos = 0, onEscolher, onPersonalizado, onFechar, titulo = 'Adicionar serviço' }) {
  const indice = useCatalogo()
  const [etapa, setEtapa] = useState('inicio')   // inicio | categoria | familia | servico
  const [cat, setCat] = useState(null)
  const [fam, setFam] = useState(null)
  const [sv, setSv] = useState(null)
  const [busca, setBusca] = useState('')
  const [verTodos, setVerTodos] = useState(false)
  const [verSug, setVerSug] = useState(false)
  const campo = useRef(null)
  const [temMini, marcarMini] = useMiniaturas()

  const resultados = useMemo(() => (indice && busca.trim().length >= 2 ? buscar(indice, busca) : null), [indice, busca])
  const sug = useMemo(() => (indice ? sugestoes(indice, { categoriasEscolhidas, limite: verSug ? 16 : 8 }) : []), [indice, categoriasEscolhidas, verSug])
  const familias = useMemo(() => (indice && cat ? indice.familiasDe(cat.id) : []), [indice, cat])
  const servicos = useMemo(() => (indice && fam ? indice.filhos(fam.id).filter((i) => i.tipo === 'servico') : []), [indice, fam])
  const tecnicas = useMemo(() => (indice && sv ? indice.filhos(sv.id) : []), [indice, sv])
  const maisDaCategoria = useMemo(() => (indice && cat ? sugestoes(indice, { categoriaId: cat.id, limite: 6 }) : []), [indice, cat])

  // o momento da Mel neste passo
  const [momento, dados] = useMemo(() => {
    if (resultados && !resultados.length) return ['cardapio_nao_achou', { servico: busca.trim().slice(0, 60) }]
    if (resultados) return [null, null]
    if (etapa === 'inicio') return verSug ? ['cardapio_sugestoes', { n: sug.length }] : ['cardapio_inicio', { n: nServicos }]
    if (etapa === 'categoria' && cat) return ['cardapio_categoria', { categoria: cat.nome, n: familias.length }]
    if (etapa === 'familia' && fam) return ['cardapio_familia', { categoria: cat?.nome ?? '', familia: fam.nome, n: servicos.length }]
    return [null, null]
  }, [resultados, busca, etapa, verSug, sug.length, nServicos, cat, fam, familias.length, servicos.length])
  const fala = useFalaDaMel(salaoId, momento, dados)

  // no desktop a busca já vem com foco; no celular esperar o toque evita o teclado pular
  useEffect(() => { if (window.matchMedia?.('(min-width: 700px)').matches) campo.current?.focus() }, [])

  function abrirCategoria(c) { setCat(c); setFam(null); setSv(null); setEtapa('categoria'); setBusca(''); setVerTodos(false) }
  function abrirFamilia(f) { setCat(indice.categoria(f.categoria_id)); setFam(f); setSv(null); setEtapa('familia'); setBusca(''); setVerTodos(false) }
  function concluir(s, t) {
    onEscolher({
      item: t ?? s, servico: s, tecnica: t ?? null, familia: cadeia(indice, s.id)[0] ?? null, categoria: indice.categoria(s.categoria_id),
      nome: nomeSugerido(s, t), duracao: duracaoDe(indice, t ?? s), categoria_id: s.categoria_id, caminho: [...(t ?? s).caminho],
    })
  }
  function abrirServico(s) {
    setCat(indice.categoria(s.categoria_id)); setFam(cadeia(indice, s.id)[0] ?? null); setSv(s); setBusca('')
    if (!indice.filhos(s.id).length) { concluir(s, null); return }
    setEtapa('servico')
  }
  function escolherResultado(r) {
    if (r.item.tipo === 'familia') abrirFamilia(r.item)
    else if (r.item.tipo === 'servico') abrirServico(r.item)
    else concluir(indice.porId.get(r.item.pai_id), r.item)
  }
  function voltar() {
    if (busca) { setBusca(''); return }
    if (etapa === 'servico') { setSv(null); setEtapa('familia'); return }
    if (etapa === 'familia') { setFam(null); setEtapa('categoria'); return }
    setCat(null); setEtapa('inicio')
  }
  function personalizado() {
    onPersonalizado({ categoria_id: cat?.id ?? null, nome: resultados && !resultados.length ? busca.trim() : '' })
  }

  const trilha = [
    cat && { chave: 'c', nome: cat.nome, ir: () => abrirCategoria(cat), atual: etapa === 'categoria' },
    fam && { chave: 'f', nome: fam.nome, ir: () => abrirFamilia(fam), atual: etapa === 'familia' },
    sv && { chave: 's', nome: sv.nome, ir: null, atual: etapa === 'servico' },
  ].filter(Boolean)
  const semCatalogo = indice && indice.categorias.length === 0

  return (
    <div className="cardapio" data-etapa={etapa}>
      <header className="cardapio-topo">
        {(etapa !== 'inicio' || busca) && <button type="button" className="cardapio-voltar" onClick={voltar} aria-label="Voltar"><ArrowLeft size={18} /></button>}
        <div className="cardapio-titulos">
          {etapa === 'inicio' ? (
            <><h3>{titulo}</h3><p>O que você oferece? Me conta e eu te ajudo a montar o restante.</p></>
          ) : (
            <nav className="cardapio-trilha" aria-label="Onde você está">
              <button type="button" onClick={() => { setCat(null); setFam(null); setSv(null); setEtapa('inicio') }}>Catálogo</button>
              {trilha.map((t) => <span key={t.chave}><ChevronRight size={14} />{t.ir && !t.atual ? <button type="button" onClick={t.ir}>{t.nome}</button> : <strong>{t.nome}</strong>}</span>)}
            </nav>
          )}
        </div>
        <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">×</button>
      </header>

      <label className="cardapio-busca">
        <Search size={18} />
        <input ref={campo} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Digite um serviço, técnica ou categoria" aria-label="Buscar no catálogo" autoComplete="off" />
        {busca && <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca"><X size={16} /></button>}
      </label>

      <MelFala fala={fala} />

      <div className="cardapio-corpo">
        {!indice ? (
          <p className="muted cardapio-carregando">Abrindo o catálogo…</p>
        ) : resultados ? (
          <Resultados resultados={resultados} indice={indice} busca={busca} onEscolher={escolherResultado} onPersonalizado={personalizado} />
        ) : semCatalogo ? (
          <p className="muted cardapio-carregando">O catálogo ainda não está disponível por aqui. Dá para criar o serviço do seu jeito logo abaixo.</p>
        ) : etapa === 'inicio' ? (
          <>
            {sug.length > 0 && (
              <section className="cardapio-secao">
                <h4><Sparkles size={15} /> Sugestões para você</h4>
                <div className="cardapio-sug">
                  {sug.map((s) => (
                    <button key={s.id} type="button" className="cardapio-sug-item" onClick={() => abrirServico(s)}>
                      <strong>{s.nome}</strong>
                      <span>{indice.categoria(s.categoria_id)?.nome}{s.duracao_sugerida ? ` · ${formatDuracao(s.duracao_sugerida)}` : ''}</span>
                    </button>
                  ))}
                </div>
                {!verSug && <button type="button" className="cardapio-ver" onClick={() => setVerSug(true)}>Ver mais sugestões</button>}
              </section>
            )}
            <section className="cardapio-secao">
              <h4>Categorias</h4>
              <div className="cardapio-cats">
                {indice.categorias.map((c, i) => <CartaoCategoria key={c.id} cat={c} indice={indice} posicao={i} onAbrir={() => abrirCategoria(c)} />)}
              </div>
            </section>
          </>
        ) : etapa === 'categoria' ? (
          <>
            {maisDaCategoria.length > 0 && (
              <section className="cardapio-secao">
                <h4><Sparkles size={15} /> Mais escolhidos em {cat.nome}</h4>
                <div className="chips cardapio-chips">{maisDaCategoria.map((s) => <button key={s.id} type="button" className="chip" onClick={() => abrirServico(s)}>{s.nome}</button>)}</div>
              </section>
            )}
            <section className="cardapio-secao">
              <h4>O que você faz em {cat.nome}?</h4>
              <div className="cardapio-fams">
                {familias.map((f) => {
                  const n = quantosServicos(indice, f.id)
                  return (
                    <button key={f.id} type="button" className={'cardapio-fam' + (temMini[f.id] ? '' : ' sem-mini')} onClick={() => abrirFamilia(f)}>
                      <Miniatura item={f} onEstado={(ok) => marcarMini(f.id, ok)} />
                      <strong>{f.nome}</strong>
                      <span>{n} {n === 1 ? 'serviço' : 'serviços'}</span>
                      <ChevronRight size={16} />
                    </button>
                  )
                })}
              </div>
            </section>
          </>
        ) : etapa === 'familia' ? (
          <ListaDeServicos servicos={servicos} indice={indice} verTodos={verTodos} setVerTodos={setVerTodos} onAbrir={abrirServico} temMini={temMini} marcarMini={marcarMini} />
        ) : (
          <section className="cardapio-secao">
            <h4>{sv.nome}</h4>
            <p className="muted">Tem uma técnica específica? É opcional: dá para seguir só com o serviço.</p>
            <div className="cardapio-lista">
              {tecnicas.map((t) => (
                <button key={t.id} type="button" className="cardapio-linha" onClick={() => concluir(sv, t)}>
                  <span className="cardapio-linha-nome">{t.nome}</span>
                  {t.duracao_sugerida && <span className="cardapio-linha-meta"><Clock size={13} /> {formatDuracao(t.duracao_sugerida)}</span>}
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-primary cardapio-seguir" onClick={() => concluir(sv, null)}>Seguir com {sv.nome}{sv.duracao_sugerida ? ` · ${formatDuracao(sv.duracao_sugerida)}` : ''}</button>
          </section>
        )}
      </div>

      <footer className="cardapio-rodape">
        <button type="button" className="cardapio-personalizado" onClick={personalizado}>
          <Plus size={16} /> Não encontrou? <strong>Criar meu próprio serviço</strong>
        </button>
      </footer>
    </div>
  )
}

function CartaoCategoria({ cat, indice, posicao, onAbrir }) {
  const [semImagem, setSemImagem] = useState(false)
  const nFam = indice.familiasDe(cat.id).length
  const nSv = indice.servicosDe(cat.id).length
  const [a, b] = TONS[posicao % TONS.length]
  return (
    <button type="button" className={'cardapio-cat' + (semImagem ? ' sem-imagem' : '')} onClick={onAbrir} style={{ '--cat-a': a, '--cat-b': b, '--cat-atraso': `${Math.min(posicao, 9) * 40}ms` }}>
      <span className="cardapio-cat-img" aria-hidden="true">
        {!semImagem && <img src={imagemDaCategoria(cat)} alt="" loading="lazy" onError={() => setSemImagem(true)} />}
      </span>
      <span className="cardapio-cat-txt">
        <strong>{cat.nome}</strong>
        {cat.descricao && <small>{cat.descricao}</small>}
        <em>{nFam} {nFam === 1 ? 'família' : 'famílias'} · {nSv} serviços</em>
      </span>
    </button>
  )
}
const TONS = [['#ff2d7a', '#aa4cff'], ['#aa4cff', '#ff7baa'], ['#ff7baa', '#ff9a6c'], ['#7c5cff', '#ff2d7a'], ['#ff5c8a', '#c86bff'], ['#f26b8a', '#8a5cff'], ['#3d0c4e', '#ff2d7a'], ['#ff9a6c', '#ff2d7a'], ['#6c4cff', '#ff7baa'], ['#1f2026', '#aa4cff']]

// os serviços de uma família: primeiro os de maior prioridade, depois "Ver todos"
function ListaDeServicos({ servicos, indice, verTodos, setVerTodos, onAbrir, temMini, marcarMini }) {
  const principais = servicos.filter((s) => s.prioridade_sugestao > 0).sort((a, b) => b.prioridade_sugestao - a.prioridade_sugestao)
  const resumido = !verTodos && principais.length >= 3 && principais.length < servicos.length
  const lista = resumido ? principais.slice(0, 8) : servicos
  return (
    <section className="cardapio-secao">
      <h4>{resumido ? 'Os mais comuns' : 'Serviços'}</h4>
      <div className="cardapio-lista">
        {lista.map((s) => {
          const n = indice.filhos(s.id).length
          return (
            <button key={s.id} type="button" className={'cardapio-linha' + (temMini[s.id] ? ' com-mini' : '')} onClick={() => onAbrir(s)}>
              <Miniatura item={s} onEstado={(ok) => marcarMini(s.id, ok)} />
              <span className="cardapio-linha-nome">{s.nome}</span>
              <span className="cardapio-linha-meta">
                {s.duracao_sugerida && <><Clock size={13} /> {formatDuracao(s.duracao_sugerida)}</>}
                {n > 0 && <i>{n} {n === 1 ? 'técnica' : 'técnicas'}</i>}
              </span>
              <ChevronRight size={16} />
            </button>
          )
        })}
      </div>
      {resumido && <button type="button" className="cardapio-ver" onClick={() => setVerTodos(true)}>Ver todos ({servicos.length})</button>}
    </section>
  )
}

const TIPO = { familia: 'família', servico: 'serviço', tecnica: 'técnica' }
function Resultados({ resultados, indice, busca, onEscolher, onPersonalizado }) {
  if (!resultados.length) {
    return (
      <div className="cardapio-vazio">
        <strong>Nada com “{busca.trim()}” no catálogo.</strong>
        <p className="muted">Sem problema: cria do seu jeito, com o nome que você usa.</p>
        <button type="button" className="btn btn-primary" onClick={onPersonalizado}><Plus size={15} /> Criar “{busca.trim()}”</button>
      </div>
    )
  }
  return (
    <section className="cardapio-secao">
      <h4>{resultados.length} {resultados.length === 1 ? 'resultado' : 'resultados'}</h4>
      <div className="cardapio-lista">
        {resultados.map((r) => {
          const dur = duracaoDe(indice, r.item)
          return (
            <button key={r.item.id} type="button" className="cardapio-linha com-caminho" onClick={() => onEscolher(r)}>
              <small className="cardapio-caminho">{r.item.caminho.slice(0, -1).join(' › ')}</small>
              <span className="cardapio-linha-nome">{r.item.nome} <em>{TIPO[r.item.tipo]}</em></span>
              <span className="cardapio-linha-meta">{dur && r.item.tipo !== 'familia' && <><Clock size={13} /> {formatDuracao(dur)}</>}</span>
              <ChevronRight size={16} />
            </button>
          )
        })}
      </div>
    </section>
  )
}
