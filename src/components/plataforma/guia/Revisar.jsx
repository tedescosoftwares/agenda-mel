import { useEffect, useMemo, useRef, useState } from 'react'
import Portal from '../../Portal'
import { useDialogo } from '../../../context/DialogoContext'
import { Pilula, haQuanto } from '../Pecas'
import { MolduraPrevia, PreviaGoogle } from './Previa'
import EditarLugar from './Editar'
import { GUIA_CATEGORIAS, categoriaDoGuia, conteudoSeguro, semAcento, rotaDoLugar } from '../../../lib/guia'
import { seoDoLugar } from '../../../lib/guiaSeo'
import { urlDoAmbiente } from '../../../lib/ambiente'
import {
  Search, Smartphone, Monitor, Check, RefreshCw, Pencil, SkipForward, Trash2, ChevronLeft, ChevronRight, Sparkles,
  Star, ShieldCheck, LoaderCircle, TriangleAlert, ExternalLink, Maximize2, X, Keyboard, Pause, Play, Square, Undo2, Upload, Info,
} from 'lucide-react'

// A mesa de revisão: a fila à esquerda, a página de verdade à direita, e as
// ações em cima, com atalho de teclado para cada uma. Aprovar leva sozinho
// ao próximo da fila; o que está selecionado nunca some da lista enquanto
// estiver selecionado (mesmo que o lote o tenha gerado e ele tenha mudado
// de fase), para a pessoa não perder o lugar.

const FASES = [
  ['gerar', 'A gerar'],
  ['revisar', 'Para revisar'],
  ['nova', 'Versão nova'],
  ['no_ar', 'No ar'],
  ['descartado', 'Descartados'],
  ['todos', 'Todos'],
]
const FASE_ROTULO = { gerar: 'sem texto', revisar: 'para revisar', nova: 'no ar · versão nova', no_ar: 'no ar', descartado: 'descartado', removido: 'removido' }
const FASE_TOM = { gerar: 'cinza', revisar: 'ambar', nova: 'roxo', no_ar: 'menta', descartado: 'carmim', removido: 'cinza' }
const SUGESTOES = ['Mais curto', 'Mais direto, menos adjetivo', 'Fale mais dos serviços', 'Mude a abertura', 'Menos repetição do nome']
const MOTIVOS = ['Fechou', 'Não é salão de beleza', 'Duplicado', 'Fora da cidade', 'Dados ruins']

const lerPref = (k, padrao) => { try { return localStorage.getItem(k) || padrao } catch { return padrao } }
const gravarPref = (k, v) => { try { localStorage.setItem(k, v) } catch { /* sem storage */ } }
const norm = (s) => semAcento(s).toLowerCase()

function ordenar(lista, ordem) {
  const nome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR')
  const porOrdem = {
    selecao: (a, b) => (b.selecao - a.selecao) || ((b.avaliacoes ?? -1) - (a.avaliacoes ?? -1)) || nome(a, b),
    nome,
    bairro: (a, b) => (a.bairro || '~').localeCompare(b.bairro || '~', 'pt-BR') || nome(a, b),
    recentes: (a, b) => String(b.gerado_em ?? b.atualizado_em ?? '').localeCompare(String(a.gerado_em ?? a.atualizado_em ?? '')) || nome(a, b),
  }
  return [...lista].sort(porOrdem[ordem] ?? porOrdem.selecao)
}

export default function Revisar({ g, rev, setRev }) {
  const { confirmar } = useDialogo()
  const { lugares, faseDe, carregando } = g
  const [modo, setModoBruto] = useState(() => lerPref('mimo-guia-previa', 'celular'))
  // o pedido para a IA, a versão mostrada e o erro valem para um salão só:
  // trocou de salão, voltam ao começo (guardados junto com o id dele)
  const [porSalao, setPorSalao] = useState({ id: null, instr: '', versao: 'rascunho', erro: '' })
  const [editando, setEditando] = useState(null)
  const [descartando, setDescartando] = useState(null)
  const [telaCheia, setTelaCheia] = useState(false)
  const [verAtalhos, setVerAtalhos] = useState(false)
  // coluna estreita: a página ocupa a altura toda e o Google fica a um clique
  const [verGoogle, setVerGoogle] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [alto, setAlto] = useState(640)
  const buscaRef = useRef(null)
  const listaRef = useRef(null)
  const mesaRef = useRef(null)
  const instrRef = useRef(null)
  const selRef = useRef(rev.selId)
  useEffect(() => { selRef.current = rev.selId }, [rev.selId])

  const setModo = (m) => { setModoBruto(m); gravarPref('mimo-guia-previa', m) }

  // a mesa ocupa a altura da janela (menos o topo da Plataforma): a lista e a
  // prévia rolam por dentro e as ações ficam sempre à vista
  useEffect(() => {
    const medir = () => {
      const topo = document.querySelector('.plat-topo')?.offsetHeight ?? 60
      setAlto(Math.max(520, window.innerHeight - topo - 22))
    }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [])

  // ---- filtros ----
  const cidades = useMemo(() => {
    const m = new Map()
    for (const l of lugares) if (!m.has(l.cidade_slug)) m.set(l.cidade_slug, l.cidade)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  }, [lugares])
  const termo = norm(rev.busca).trim()
  const base = useMemo(() => lugares.filter((l) =>
    (!rev.cidade || l.cidade_slug === rev.cidade) && (!rev.categoria || l.categoria === rev.categoria) &&
    (!rev.receita || l.validado_receita) && (!rev.selecao || l.selecao) &&
    (!termo || norm(`${l.nome} ${l.bairro ?? ''} ${l.slug}`).includes(termo))
  ), [lugares, rev.cidade, rev.categoria, rev.receita, rev.selecao, termo])
  const contagem = useMemo(() => {
    const c = { gerar: 0, revisar: 0, nova: 0, no_ar: 0, descartado: 0, removido: 0, todos: 0 }
    for (const l of base) { const f = faseDe(l); c[f]++; if (f !== 'removido') c.todos++ }
    return c
  }, [base, faseDe])

  // a primeira fila que tem trabalho, uma vez só (depois a escolha é da pessoa)
  useEffect(() => {
    if (rev.status || carregando) return
    const c = { gerar: 0, revisar: 0, nova: 0 }
    for (const l of lugares) { const f = faseDe(l); if (f in c) c[f]++ }
    setRev((r) => ({ ...r, status: c.revisar ? 'revisar' : c.nova ? 'nova' : c.gerar ? 'gerar' : 'todos' }))
  }, [rev.status, carregando, lugares, faseDe, setRev])
  const status = rev.status ?? 'revisar'

  const lista = useMemo(() => ordenar(base.filter((l) => {
    const f = faseDe(l)
    return l.id === rev.selId || (status === 'todos' ? f !== 'removido' : f === status)
  }), rev.ordem), [base, status, rev.selId, rev.ordem, faseDe])
  const indice = lista.findIndex((l) => l.id === rev.selId)
  const atual = indice >= 0 ? lista[indice] : null
  const doAtual = porSalao.id === rev.selId ? porSalao : { instr: '', versao: 'rascunho', erro: '' }
  const { instr, versao, erro: erroAcao } = doAtual
  const mudarDoAtual = (campo, v) => setPorSalao((x) => {
    const base = x.id === selRef.current ? x : { id: selRef.current, instr: '', versao: 'rascunho', erro: '' }
    return { ...base, [campo]: typeof v === 'function' ? v(base[campo]) : v }
  })
  const setInstr = (v) => mudarDoAtual('instr', v)
  const setVersao = (v) => mudarDoAtual('versao', v)
  const setErroAcao = (v) => mudarDoAtual('erro', v)

  const mudarFiltro = (campos) => setRev((r) => ({ ...r, ...campos, selId: null }))
  const selecionar = (id) => setRev((r) => ({ ...r, selId: id }))

  // sem seleção (ou a selecionada saiu da lista): a primeira da fila
  useEffect(() => {
    if (!atual && lista.length) setRev((r) => ({ ...r, selId: lista[0].id }))
  }, [atual, lista, setRev])

  // outro salão: a lista mostra onde ele está. Rola só a lista (scrollIntoView
  // rolaria a página junto e brigaria com o cabeçalho subindo)
  useEffect(() => {
    const caixa = listaRef.current
    const el = rev.selId && caixa?.querySelector(`[data-id="${rev.selId}"]`)
    if (!el) return
    const r = el.getBoundingClientRect(), c = caixa.getBoundingClientRect()
    if (r.top < c.top) caixa.scrollTop -= c.top - r.top + 6
    else if (r.bottom > c.bottom) caixa.scrollTop += r.bottom - c.bottom + 6
  }, [rev.selId])

  // usou o teclado para revisar: o cabeçalho sobe e a mesa ocupa a tela
  function focarMesa() {
    const el = mesaRef.current
    if (!el) return
    const topo = document.querySelector('.plat-topo')?.offsetHeight ?? 60
    if (el.getBoundingClientRect().top > topo + 24) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  function vizinhoDe(id) {
    const i = lista.findIndex((l) => l.id === id)
    return lista[i + 1]?.id ?? lista[i - 1]?.id ?? null
  }
  function mover(d) {
    if (!lista.length) return
    const i = indice < 0 ? 0 : Math.min(lista.length - 1, Math.max(0, indice + d))
    selecionar(lista[i].id)
  }

  // ---- ações sobre o selecionado ----
  const fase = atual ? g.faseDe(atual) : null
  const temTexto = !!(atual?.rascunho || atual?.conteudo)
  const gerandoAtual = atual ? g.gerando[atual.id] : null
  const falha = atual ? g.falhas[atual.id] : null
  const podeAprovar = !!atual && !gerandoAtual && atual.status !== 'removido' && (fase === 'revisar' || fase === 'nova' || (fase === 'descartado' && temTexto))
  const podeGerar = !!atual && !gerandoAtual && atual.status !== 'removido'
  const mostrado = atual ? (versao === 'no_ar' && atual.conteudo ? atual.conteudo : (atual.rascunho ?? atual.conteudo)) : null
  const metaMostrada = (mostrado && typeof mostrado === 'object' && mostrado._meta) || {}
  const semelhanca = Number(metaMostrada.semelhanca?.indice) || 0
  const nAvisos = (semelhanca > 0.35 ? 1 : 0) + (Array.isArray(metaMostrada.avisos) ? metaMostrada.avisos.length : 0)

  async function aprovarAtual() {
    if (!podeAprovar || ocupado) return
    const l = atual
    const proximo = vizinhoDe(l.id)
    setOcupado(true); setErroAcao('')
    const r = await g.aprovar(l.id)
    setOcupado(false)
    if (!r.ok) { setErroAcao(r.erro); return }
    g.avisar({ texto: `${l.nome} está no ar.`, tom: 'ok', acao: { rotulo: 'Desfazer', onClick: async () => { const d = await g.desfazerAprovacao(r.antes); if (d.ok) selecionar(l.id) } } })
    if (selRef.current === l.id) selecionar(proximo)
  }

  function gerarAtual(instrucao = instr) {
    if (!podeGerar) return
    const l = atual
    setErroAcao('')
    g.gerarUm(l.id, { instrucao }).then((r) => {
      if (!r.ok) return
      if (selRef.current === l.id) { setInstr(''); setVersao('rascunho') }
      else g.avisar({ texto: `${l.nome}: texto pronto para revisar.`, acao: { rotulo: 'Ver', onClick: () => selecionar(l.id) } })
    })
  }

  async function descartar(motivo) {
    const l = descartando
    const proximo = vizinhoDe(l.id)
    const antes = { status: l.status, motivo: l.motivo }
    const r = await g.salvarLugar(l.id, { status: 'descartado', motivo: motivo || null })
    if (!r.ok) return r
    setDescartando(null)
    g.avisar({ texto: `${l.nome} saiu da fila.`, acao: { rotulo: 'Desfazer', onClick: () => g.salvarLugar(l.id, antes) } })
    if (selRef.current === l.id && status !== 'descartado') selecionar(proximo)
    return { ok: true }
  }

  async function restaurar() {
    const l = atual
    const r = await g.salvarLugar(l.id, { status: l.rascunho || l.conteudo ? 'gerado' : 'importado', motivo: null })
    if (!r.ok) setErroAcao(r.erro)
    else g.avisar(`${l.nome} voltou para a fila.`)
  }

  async function gerarFila() {
    const ids = lista.filter((l) => g.faseDe(l) === 'gerar').map((l) => l.id)
    if (!ids.length) return
    const ok = await confirmar({ titulo: `Gerar o texto de ${ids.length} ${ids.length === 1 ? 'salão' : 'salões'}?`, texto: 'Um por vez, na ordem da lista. Cada página pronta já aparece em "Para revisar": dá para ir aprovando enquanto o lote roda. Deixe esta tela aberta.', ok: 'Gerar todos', cancelar: 'Agora não' })
    if (ok) g.iniciarLote(ids)
  }

  // ---- teclado ----
  const teclas = useRef(null)
  const aoTeclar = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
    if (editando || descartando) return
    if (document.querySelector('.modal-fundo')) return
    const alvo = e.target
    if (alvo?.closest?.('input, textarea, select, [contenteditable="true"]')) {
      if (e.key === 'Escape') alvo.blur()
      return
    }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    const acoes = {
      j: () => mover(1), ArrowRight: () => mover(1), ArrowDown: () => mover(1),
      k: () => mover(-1), ArrowLeft: () => mover(-1), ArrowUp: () => mover(-1),
      a: () => aprovarAtual(),
      g: () => gerarAtual(),
      e: () => atual && setEditando(atual.id),
      d: () => atual && fase !== 'descartado' && atual.status !== 'removido' && setDescartando(atual),
      m: () => setModo(modo === 'celular' ? 'computador' : 'celular'),
      f: () => setTelaCheia((v) => !v),
      i: () => instrRef.current?.focus(),
      '/': () => buscaRef.current?.focus(),
      '?': () => setVerAtalhos((v) => !v),
      Escape: () => { setTelaCheia(false); setVerAtalhos(false) },
    }
    const fn = acoes[k]
    if (!fn) return
    e.preventDefault()
    if (['j', 'k', 'a', 'g', 'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(k) && !telaCheia) focarMesa()
    fn()
  }
  useEffect(() => { teclas.current = aoTeclar })
  useEffect(() => {
    const ouvir = (e) => teclas.current?.(e)
    window.addEventListener('keydown', ouvir)
    return () => window.removeEventListener('keydown', ouvir)
  }, [])

  // ---- telas vazias ----
  if (g.carregando) return <div className="pg-carregando"><LoaderCircle className="pg-gira" size={18} /> Carregando o guia…</div>
  if (!g.lugares.length) return (
    <div className="pg-vazio-grande">
      <Upload size={28} />
      <h3>O guia ainda está vazio</h3>
      <p>Comece importando os CSVs: primeiro o do Google Places, depois o validado na Receita. Cada salão vira uma página para revisar aqui.</p>
      <button type="button" className="btn btn-primary" onClick={() => g.irPara('importar')}>Importar salões</button>
    </div>
  )

  const pendentesFila = lista.filter((l) => g.faseDe(l) === 'gerar').length
  const filtrosExtras = rev.cidade || rev.categoria || rev.receita || rev.selecao || rev.busca
  const lote = g.lote

  return (
    <div className="pg-mesa" ref={mesaRef} style={{ height: alto }}>
      {/* ---------- a fila ---------- */}
      <aside className="pg-fila">
        <div className="pg-fila-filtros">
          <label className="pg-busca">
            <Search size={15} />
            <input ref={buscaRef} value={rev.busca} onChange={(e) => mudarFiltro({ busca: e.target.value })} placeholder="Nome ou bairro" aria-label="Buscar salão por nome ou bairro" />
            {rev.busca ? <button type="button" aria-label="Limpar busca" onClick={() => mudarFiltro({ busca: '' })}><X size={14} /></button> : <kbd>/</kbd>}
          </label>
          <div className="pg-fases" role="radiogroup" aria-label="Fase">
            {FASES.map(([id, rotulo]) => (
              <button key={id} type="button" role="radio" aria-checked={status === id} className={'pg-fase ' + (status === id ? 'ativo' : '') + (id === 'revisar' && contagem.revisar ? ' tem' : '')} onClick={() => mudarFiltro({ status: id })}>
                {rotulo}<b>{contagem[id]}</b>
              </button>
            ))}
            {contagem.removido > 0 && (
              <button type="button" role="radio" aria-checked={status === 'removido'} className={'pg-fase ' + (status === 'removido' ? 'ativo' : '')} onClick={() => mudarFiltro({ status: 'removido' })}>Removidos<b>{contagem.removido}</b></button>
            )}
          </div>
          <div className="pg-fila-linha">
            {cidades.length > 1 && (
              <select className="plat-select" value={rev.cidade} onChange={(e) => mudarFiltro({ cidade: e.target.value })} aria-label="Cidade">
                <option value="">Todas as cidades</option>
                {cidades.map(([slug, nome]) => <option key={slug} value={slug}>{nome}</option>)}
              </select>
            )}
            <select className="plat-select" value={rev.categoria} onChange={(e) => mudarFiltro({ categoria: e.target.value })} aria-label="Categoria">
              <option value="">Categoria</option>
              {GUIA_CATEGORIAS.map((c) => <option key={c.slug} value={c.slug}>{c.rotulo}</option>)}
            </select>
            <select className="plat-select" value={rev.ordem} onChange={(e) => setRev((r) => ({ ...r, ordem: e.target.value }))} aria-label="Ordem da lista">
              <option value="selecao">Seleção 1º</option>
              <option value="nome">A a Z</option>
              <option value="bairro">Por bairro</option>
              <option value="recentes">Recentes</option>
            </select>
          </div>
          <div className="pg-fila-linha">
            <label className={'pg-marca ' + (rev.receita ? 'ativo' : '')}><input type="checkbox" checked={rev.receita} onChange={(e) => mudarFiltro({ receita: e.target.checked })} /><ShieldCheck size={14} /> Só validados na Receita</label>
            <label className={'pg-marca ' + (rev.selecao ? 'ativo' : '')}><input type="checkbox" checked={rev.selecao} onChange={(e) => mudarFiltro({ selecao: e.target.checked })} /><Star size={14} /> Só Seleção MIMO</label>
          </div>
        </div>

        {lote ? <Lote lote={lote} g={g} onVer={(id) => selecionar(id)} /> : (
          <div className="pg-fila-resumo">
            <span><b>{lista.length}</b> {lista.length === 1 ? 'salão' : 'salões'} nesta fila</span>
            {pendentesFila > 0 && <button type="button" className="btn btn-ghost pg-btn-peq" onClick={gerarFila}><Sparkles size={14} /> Gerar todos da fila ({pendentesFila})</button>}
          </div>
        )}

        <div className="pg-lista" ref={listaRef} role="listbox" aria-label="Salões na fila">
          {lista.length === 0 && (
            <div className="pg-lista-vazia">
              {filtrosExtras ? (<><p>Nenhum salão com esses filtros.</p><button type="button" className="plat-link" onClick={() => mudarFiltro({ cidade: '', categoria: '', receita: false, selecao: false, busca: '' })}>Limpar filtros</button></>)
                : status === 'revisar' ? (<><p><b>Fila zerada.</b> Nada esperando revisão.</p>{contagem.gerar > 0 && <button type="button" className="plat-link" onClick={() => mudarFiltro({ status: 'gerar' })}>Ver os {contagem.gerar} sem texto</button>}</>)
                  : status === 'gerar' ? (<p>Todos os salões já têm texto. {contagem.revisar > 0 && <button type="button" className="plat-link" onClick={() => mudarFiltro({ status: 'revisar' })}>Revisar {contagem.revisar}</button>}</p>)
                    : <p>Nada por aqui.</p>}
            </div>
          )}
          {lista.map((l) => {
            const f = g.faseDe(l)
            const ger = g.gerando[l.id]
            return (
              <button key={l.id} type="button" role="option" aria-selected={l.id === rev.selId} data-id={l.id} className={'pg-item' + (l.id === rev.selId ? ' ativo' : '')} onClick={() => selecionar(l.id)}>
                <span className="pg-item-nome">
                  <b>{l.nome}</b>
                  {ger ? <LoaderCircle size={14} className="pg-gira pg-item-gerando" aria-label="gerando" /> : g.falhas[l.id] ? <TriangleAlert size={14} className="pg-item-erro" aria-label="erro ao gerar" /> : <i className={'pg-ponto ' + FASE_TOM[f]} title={FASE_ROTULO[f]} />}
                </span>
                <span className="pg-item-sub">
                  <span>{[l.bairro, categoriaDoGuia(l.categoria).curto].filter(Boolean).join(' · ')}</span>
                  {l.selecao && <Star size={12} className="pg-selo-sel" aria-label="Seleção MIMO" />}
                  {l.validado_receita && <ShieldCheck size={12} className="pg-selo-rf" aria-label="Validado na Receita" />}
                </span>
              </button>
            )
          })}
        </div>
      </aside>

      {/* ---------- o selecionado ---------- */}
      <section className="pg-revisao">
        {!atual ? (
          <div className="pg-sem-selecao"><p>Escolha um salão na lista.</p></div>
        ) : (
          <>
            <div className="pg-acoes">
              <div className="pg-acoes-topo">
                <div className="pg-acoes-nome">
                  <h2>{atual.nome}</h2>
                  <Pilula tom={FASE_TOM[fase]}>{FASE_ROTULO[fase]}</Pilula>
                  {atual.selecao && <Pilula tom="rosa">Seleção MIMO</Pilula>}
                  {atual.salon_id && <Pilula tom="menta">na MIMO</Pilula>}
                </div>
                <div className="pg-nav">
                  <button type="button" className="pg-btn-atalhos" onClick={() => setVerAtalhos((v) => !v)} aria-label="Atalhos de teclado" title="Atalhos de teclado (?)"><Keyboard size={17} /></button>
                  <button type="button" aria-label="Anterior (K)" title="Anterior (K ou ←)" onClick={() => mover(-1)} disabled={indice <= 0}><ChevronLeft size={18} /></button>
                  <span>{indice + 1} de {lista.length}</span>
                  <button type="button" aria-label="Próximo (J)" title="Próximo (J ou →)" onClick={() => mover(1)} disabled={indice >= lista.length - 1}><ChevronRight size={18} /></button>
                </div>
              </div>
              <p className="pg-acoes-sub">
                {[atual.bairro, categoriaDoGuia(atual.categoria).rotulo, atual.cidade].filter(Boolean).join(' · ')}
                {atual.status === 'publicado' && <> · <a className="plat-link" href={urlDoAmbiente('cliente', rotaDoLugar(atual.cidade_slug, atual.slug))} target="_blank" rel="noopener noreferrer">ver no site <ExternalLink size={12} /></a></>}
              </p>

              {atual.status === 'removido' ? (
                <div className="alert alert-info">Página removida{atual.motivo ? `: ${atual.motivo}` : ''}. Não volta para o ar e a importação não traz de volta.</div>
              ) : (
                <>
                  <div className="pg-botoes">
                    <button type="button" className="btn btn-primary pg-aprovar" onClick={aprovarAtual} disabled={!podeAprovar || ocupado} title={podeAprovar ? 'Aprovar e publicar (A)' : fase === 'no_ar' ? 'Já está no ar' : 'Gere o texto primeiro'}>
                      {ocupado ? <LoaderCircle size={16} className="pg-gira" /> : <Check size={16} />} {fase === 'nova' ? <>Publicar<span className="pg-longo"> versão nova</span></> : <>Aprovar<span className="pg-longo"> e publicar</span></>} <kbd>A</kbd>
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => gerarAtual()} disabled={!podeGerar}>
                      {gerandoAtual ? <LoaderCircle size={16} className="pg-gira" /> : temTexto ? <RefreshCw size={16} /> : <Sparkles size={16} />} {gerandoAtual ? 'Gerando…' : temTexto ? 'Gerar de novo' : 'Gerar'} <kbd>G</kbd>
                    </button>
                    <button type="button" className="btn btn-ghost pg-btn-ic" onClick={() => setEditando(atual.id)} title="Editar fatos e texto (E)"><Pencil size={16} /> <span>Editar</span> <kbd>E</kbd></button>
                    <button type="button" className="btn btn-ghost pg-btn-ic" onClick={() => mover(1)} disabled={indice >= lista.length - 1} title="Pular para o próximo (J)"><SkipForward size={16} /> <span>Pular</span> <kbd>J</kbd></button>
                    {fase === 'descartado'
                      ? <button type="button" className="btn btn-ghost pg-btn-ic" onClick={restaurar} title="Volta para a fila"><Undo2 size={16} /> <span>Trazer de volta</span></button>
                      : <button type="button" className="btn btn-ghost pg-btn-ic pg-perigo" onClick={() => setDescartando(atual)} title="Descartar (D)"><Trash2 size={16} /> <span>Descartar</span> <kbd>D</kbd></button>}
                  </div>
                  <form className="pg-instrucao" onSubmit={(e) => { e.preventDefault(); gerarAtual() }}>
                    <input ref={instrRef} value={instr} onChange={(e) => setInstr(e.target.value.slice(0, 400))} placeholder={temTexto ? 'O que mudar? (opcional) Ex.: mais curto, fale de noivas…' : 'Algum pedido para a IA? (opcional)'} aria-label="O que mudar no texto" disabled={!podeGerar} />
                    <div className="pg-sugestoes">
                      {SUGESTOES.map((s) => <button key={s} type="button" disabled={!podeGerar} onClick={() => setInstr((v) => (v ? `${v.replace(/[.\s]+$/, '')}. ${s}` : s))}>{s}</button>)}
                    </div>
                  </form>
                </>
              )}
              {verAtalhos && <Atalhos onFechar={() => setVerAtalhos(false)} />}
              {erroAcao && <div className="alert alert-error">{erroAcao}</div>}
              {falha && !gerandoAtual && <div className="alert alert-error pg-falha"><span>Não deu para gerar: {falha}</span><button type="button" className="plat-link" onClick={() => gerarAtual()}>Tentar de novo</button></div>}
            </div>

            <div className={'pg-palco-area pg-modo-' + modo}>
              <div className="pg-palco-barra">
                <div className="pg-seg" role="radiogroup" aria-label="Aparelho">
                  <button type="button" role="radio" aria-checked={modo === 'celular'} className={modo === 'celular' ? 'ativo' : ''} onClick={() => setModo('celular')}><Smartphone size={15} /> Celular</button>
                  <button type="button" role="radio" aria-checked={modo === 'computador'} className={modo === 'computador' ? 'ativo' : ''} onClick={() => setModo('computador')}><Monitor size={15} /> Computador</button>
                </div>
                {fase === 'nova' && (
                  <div className="pg-seg" role="radiogroup" aria-label="Versão">
                    <button type="button" role="radio" aria-checked={versao === 'rascunho'} className={versao === 'rascunho' ? 'ativo' : ''} onClick={() => setVersao('rascunho')}>Versão nova</button>
                    <button type="button" role="radio" aria-checked={versao === 'no_ar'} className={versao === 'no_ar' ? 'ativo' : ''} onClick={() => setVersao('no_ar')}>No ar</button>
                  </div>
                )}
                <div className="pg-seg pg-so-estreito" role="radiogroup" aria-label="O que ver">
                  <button type="button" role="radio" aria-checked={!verGoogle} className={!verGoogle ? 'ativo' : ''} onClick={() => setVerGoogle(false)}>Página</button>
                  <button type="button" role="radio" aria-checked={verGoogle} className={verGoogle ? 'ativo' : ''} onClick={() => setVerGoogle(true)}>Google{nAvisos ? <b className="pg-seg-num">{nAvisos}</b> : null}</button>
                </div>
                <button type="button" className="pg-btn-cheia" onClick={() => setTelaCheia(true)} title="Tela cheia (F)"><Maximize2 size={15} /> <span>Tela cheia</span></button>
              </div>
              {semelhanca > 0.35 && !verGoogle && <button type="button" className="pg-alerta-fino pg-so-estreito" onClick={() => setVerGoogle(true)}><TriangleAlert size={14} /> Texto {Math.round(semelhanca * 100)}% parecido com outra página. Ver detalhes</button>}
              <div className={'pg-palco-corpo' + (verGoogle ? ' pg-ver-google' : ' pg-ver-pagina')}>
                <div className="pg-palco">
                  {gerandoAtual && (
                    <div className="pg-escrevendo" role="status">
                      <LoaderCircle size={16} className="pg-gira" />
                      {gerandoAtual.espera ? `A IA pediu uma pausa: tentando de novo em ${gerandoAtual.espera} s` : 'A IA está escrevendo… dá para revisar outro enquanto isso.'}
                    </div>
                  )}
                  {!temTexto && !gerandoAtual && atual.status !== 'removido' && (
                    <div className="pg-sem-texto">
                      <span>Ainda sem texto da IA: esta é a página só com os fatos.</span>
                      <button type="button" className="btn btn-primary pg-btn-peq" onClick={() => gerarAtual()}><Sparkles size={14} /> Gerar agora</button>
                    </div>
                  )}
                  <MolduraPrevia lugar={atual} conteudo={mostrado} modo={modo} className={gerandoAtual ? 'pg-esmaecida' : ''} />
                </div>
                <Detalhes l={atual} conteudo={mostrado} g={g} />
              </div>
            </div>
          </>
        )}
      </section>

      {telaCheia && atual && (
        <Portal>
          <div className="pg-cheia" role="dialog" aria-label={`Prévia de ${atual.nome}`}>
            <div className="pg-cheia-barra">
              <strong>{atual.nome}</strong>
              <Pilula tom={FASE_TOM[fase]}>{FASE_ROTULO[fase]}</Pilula>
              <div className="pg-nav pg-nav-escura">
                <button type="button" aria-label="Anterior" onClick={() => mover(-1)} disabled={indice <= 0}><ChevronLeft size={18} /></button>
                <span>{indice + 1} de {lista.length}</span>
                <button type="button" aria-label="Próximo" onClick={() => mover(1)} disabled={indice >= lista.length - 1}><ChevronRight size={18} /></button>
              </div>
              <div className="pg-seg pg-seg-escuro">
                <button type="button" className={modo === 'celular' ? 'ativo' : ''} onClick={() => setModo('celular')}><Smartphone size={15} /> Celular</button>
                <button type="button" className={modo === 'computador' ? 'ativo' : ''} onClick={() => setModo('computador')}><Monitor size={15} /> Computador</button>
              </div>
              <button type="button" className="btn btn-primary pg-btn-peq" onClick={aprovarAtual} disabled={!podeAprovar || ocupado}><Check size={15} /> Aprovar <kbd>A</kbd></button>
              <button type="button" className="pg-cheia-x" onClick={() => setTelaCheia(false)} aria-label="Fechar a tela cheia (Esc)"><X size={20} /></button>
            </div>
            <div className="pg-cheia-corpo"><MolduraPrevia lugar={atual} conteudo={mostrado} modo={modo} /></div>
          </div>
        </Portal>
      )}

      {editando && g.lugares.some((l) => l.id === editando) && <EditarLugar lugar={g.lugares.find((l) => l.id === editando)} g={g} onFechar={() => setEditando(null)} />}
      {descartando && <ModalDescartar lugar={descartando} onFechar={() => setDescartando(null)} onDescartar={descartar} />}
    </div>
  )
}

// ---------- o que acompanha a prévia: Google, semelhança, avisos, fatos que faltam ----------
function Detalhes({ l, conteudo, g }) {
  const c = conteudoSeguro(conteudo)
  const seo = seoDoLugar({ ...l, na_mimo: !!l.salon_id }, conteudo)
  const meta = c?._meta ?? {}
  const sem = meta.semelhanca
  const parecido = sem && Number(sem.indice) > 0.35 ? g.lugares.find((o) => o.slug === sem.slug && o.cidade_slug === l.cidade_slug) : null
  const faltam = [
    !l.endereco && 'endereço', !l.bairro && 'bairro', !Array.isArray(l.horarios) && 'horário',
    !l.telefone && !l.whatsapp && 'telefone', !(l.servicos ?? []).length && 'serviços',
  ].filter(Boolean)
  const manuais = Object.entries(l.fontes ?? {}).filter(([, v]) => v === 'manual').map(([k]) => k)
  const avisos = Array.isArray(meta.avisos) ? meta.avisos.filter(Boolean) : []
  return (
    <div className="pg-detalhes">
      <PreviaGoogle titulo={seo.titulo} descricao={seo.descricao} caminho={seo.caminho} tituloBruto={c?.seo_title || seo.titulo} descricaoBruta={c?.meta_description || seo.descricao} />
      {sem && Number(sem.indice) > 0.35 && (
        <div className="pg-alerta ambar">
          <TriangleAlert size={16} />
          <div><b>Texto parecido com outra página ({Math.round(Number(sem.indice) * 100)}%)</b><span>Lembra a de {parecido?.nome ?? sem.slug}. Gere de novo pedindo outra abertura: o Google não gosta de páginas repetidas.</span></div>
        </div>
      )}
      {avisos.length > 0 && (
        <div className="pg-alerta">
          <Info size={16} />
          <div><b>A IA avisou</b>{avisos.map((a, i) => <span key={i}>{typeof a === 'string' ? a : JSON.stringify(a)}</span>)}</div>
        </div>
      )}
      {l.status === 'descartado' && (
        <div className="pg-alerta carmim"><Trash2 size={16} /><div><b>Descartado</b><span>{l.motivo || 'sem motivo anotado'}</span></div></div>
      )}
      {faltam.length > 0 && (
        <div className="pg-alerta"><Info size={16} /><div><b>Sem {faltam.join(', ')}</b><span>A página mostra só o que existe. Se souber, complete em Editar.</span></div></div>
      )}
      <dl className="pg-meta">
        {meta.gerado_em && <><dt>Gerado</dt><dd>{haQuanto(meta.gerado_em)}{meta.modelo ? ` · ${String(meta.modelo).replace(/^.*\//, '')}` : ''}</dd></>}
        {meta.angulo && <><dt>Ângulo</dt><dd>{meta.angulo}</dd></>}
        {meta.instrucao && <><dt>Pedido</dt><dd>“{meta.instrucao}”</dd></>}
        {meta.palavras ? <><dt>Tamanho</dt><dd>{meta.palavras} palavras</dd></> : null}
        {meta.editado_em && <><dt>Editado</dt><dd>à mão, {haQuanto(meta.editado_em)}</dd></>}
        {manuais.length > 0 && <><dt>À mão</dt><dd>{manuais.join(', ')} (a importação não sobrescreve)</dd></>}
        {l.publicado_em && <><dt>No ar desde</dt><dd>{new Date(l.publicado_em).toLocaleDateString('pt-BR')}</dd></>}
        {(l.nota != null || l.avaliacoes != null) && <><dt>Triagem</dt><dd>Google {l.nota != null ? String(l.nota).replace('.', ',') : '–'} · {l.avaliacoes ?? 0} avaliações <small>(só aqui; nunca vai para a página)</small></dd></>}
      </dl>
    </div>
  )
}

// ---------- o lote ("gerar todos da fila") ----------
function Lote({ lote, g, onVer }) {
  const pct = lote.total ? Math.round((lote.feitos / lote.total) * 100) : 0
  const atual = lote.atual ? g.lugares.find((l) => l.id === lote.atual) : null
  const espera = lote.atual ? g.gerando[lote.atual]?.espera : 0
  return (
    <div className={'pg-lote' + (lote.fim ? ' fim' : '')} role="status">
      <div className="pg-lote-topo">
        <b>{lote.fim ? (lote.cancelado ? 'Lote cancelado' : 'Lote terminado') : lote.pausado ? 'Lote pausado' : `Gerando ${Math.min(lote.feitos + 1, lote.total)} de ${lote.total}`}</b>
        <span>{pct}%</span>
      </div>
      <div className="pg-lote-barra"><i style={{ width: `${pct}%` }} /></div>
      <p>
        {lote.fim ? `${lote.feitos - lote.erros.length} ${lote.feitos - lote.erros.length === 1 ? 'pronto' : 'prontos'}${lote.erros.length ? `, ${lote.erros.length} com erro` : ''}.`
          : espera ? `Limite da IA por minuto: continua em ${espera} s.`
            : atual ? <>Escrevendo <button type="button" className="plat-link" onClick={() => onVer(atual.id)}>{atual.nome}</button></> : lote.pausado ? 'Termina o atual e espera.' : 'Começando…'}
      </p>
      {lote.erros.length > 0 && (
        <div className="pg-lote-erros">
          {lote.erros.slice(0, 4).map((id) => { const l = g.lugares.find((x) => x.id === id); return l ? <button key={id} type="button" onClick={() => onVer(id)} title={g.falhas[id]}><TriangleAlert size={12} /> {l.nome}</button> : null })}
          {lote.erros.length > 4 && <span>+{lote.erros.length - 4}</span>}
        </div>
      )}
      <div className="pg-lote-botoes">
        {lote.fim ? <button type="button" className="btn btn-ghost pg-btn-peq" onClick={g.fecharLote}>Fechar</button> : (
          <>
            <button type="button" className="btn btn-ghost pg-btn-peq" onClick={() => g.pausarLote(!lote.pausado)}>{lote.pausado ? <><Play size={13} /> Continuar</> : <><Pause size={13} /> Pausar</>}</button>
            <button type="button" className="btn btn-ghost pg-btn-peq pg-perigo" onClick={g.cancelarLote}><Square size={12} /> Cancelar</button>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- os atalhos ----------
function Atalhos({ onFechar }) {
  const lista = [['A', 'aprovar e publicar (e ir para o próximo)'], ['G', 'gerar (ou gerar de novo, com o pedido escrito)'], ['J  →  ↓', 'próximo'], ['K  ←  ↑', 'anterior'], ['E', 'editar'], ['D', 'descartar'], ['I', 'escrever o que mudar'], ['M', 'celular ou computador'], ['F', 'tela cheia'], ['/', 'buscar'], ['Esc', 'sair do campo ou da tela cheia']]
  return (
    <div className="pg-atalhos">
      <div className="pg-atalhos-topo"><b>Atalhos de teclado</b><button type="button" onClick={onFechar} aria-label="Fechar"><X size={14} /></button></div>
      <ul>{lista.map(([k, t]) => <li key={k}><kbd>{k}</kbd><span>{t}</span></li>)}</ul>
    </div>
  )
}

// ---------- descartar (com motivo) ----------
function ModalDescartar({ lugar, onFechar, onDescartar }) {
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)
  const caixa = useRef(null)
  useEffect(() => {
    caixa.current?.focus()
    const tecla = (e) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onFechar])
  async function ir() {
    setIndo(true)
    const r = await onDescartar(motivo.trim())
    setIndo(false)
    if (!r?.ok) setErro(r?.erro || 'Não deu para descartar.')
  }
  return (
    <Portal>
      <div className="modal-fundo plat-modal-fundo" onClick={onFechar} role="presentation">
        <div className="modal-caixa plat-modal pg-modal-descartar" role="dialog" aria-modal="true" aria-labelledby="pg-desc-t" onClick={(e) => e.stopPropagation()}>
          <h3 id="pg-desc-t">Descartar {lugar.nome}?</h3>
          <p className="muted">Sai da fila e não vai para o ar. Dá para trazer de volta depois, em Descartados.</p>
          <div className="pg-chips">
            {MOTIVOS.map((m) => <button key={m} type="button" className={'plat-chip' + (motivo === m ? ' ativo' : '')} onClick={() => setMotivo(m)}>{m}</button>)}
          </div>
          <label className="pg-campo">Motivo (só para a equipe)
            <textarea ref={caixa} rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ir() }} placeholder="Ex.: fechou, é loja de cosméticos, duplicado de outro" />
          </label>
          {erro && <div className="alert alert-error">{erro}</div>}
          <div className="pg-modal-botoes">
            <button type="button" className="btn btn-ghost" onClick={onFechar}>Voltar</button>
            <button type="button" className="btn btn-primary btn-perigo" onClick={ir} disabled={indo}>{indo ? 'Descartando…' : 'Descartar'}</button>
          </div>
        </div>
      </div>
    </Portal>
  )
}
