import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho, Painel, Pilula, Vazio } from '../../components/plataforma/Pecas'
import Portal from '../../components/Portal'
import { supabase } from '../../lib/supabase'
import { useDialogo } from '../../context/DialogoContext'
import { LIMITE, SUPERFICIES, RAMOS, TIPOS, CONTEXTOS_CLIMA, PERIODOS, TONS, CATEGORIAS, problemaDosPlaceholders, substituir } from '../../lib/melPlaceholders'
import { Sparkles, MessageCircle, BarChart3, Image as ImagemIcone, Search, Upload, Download, Copy, Check, X, MoreHorizontal, CloudSun, Eye, MousePointerClick } from 'lucide-react'

// Personalidade da Mel (2.87): a biblioteca do que ela fala, administrada
// aqui sem deploy. O catálogo de momentos (quando ela fala) é semeado por
// migração e só aparece como escolha; a regra de cada momento é código.
//   mel_momentos  → o que existe e quais placeholders cada um oferece
//   mel_frases    → as frases (esta tela)
//   mel_exibicoes → histórico; aqui só os números por frase

const MEL = '/imagens/mel.webp'
const POR_PAGINA = 50
const CAMPOS_JSON = ['id', 'chave', 'superficie', 'texto', 'ramos', 'tipos', 'contextos_clima', 'periodos', 'tom', 'peso', 'ativa']
const NOVA = { chave: '', superficie: 'mel_bubble', texto: '', ramos: null, tipos: null, contextos_clima: null, periodos: null, tom: 'neutra', peso: 1, ativa: true }

export default function Mel() {
  const [aba, setAba] = useState('frases')
  const [editando, setEditando] = useState(null)
  return (
    <Shell acao={aba === 'frases' ? { rotulo: 'Nova frase', onClick: () => setEditando({ ...NOVA }) } : undefined}>
      <Cabecalho titulo="Personalidade da Mel" sub="O que a Mel fala no painel dos salões. Quando ela fala é regra do sistema; aqui você cuida do texto." direita={<img src={MEL} alt="" className="plat-mel-avatar-cabecalho" />} />
      <div className="plat-abas-linha">
        <button className={aba === 'frases' ? 'ativo' : ''} onClick={() => setAba('frases')}><MessageCircle size={15} /> Frases</button>
        <button className={aba === 'estatisticas' ? 'ativo' : ''} onClick={() => setAba('estatisticas')}><BarChart3 size={15} /> Estatísticas</button>
        <button className={aba === 'avatares' ? 'ativo' : ''} onClick={() => setAba('avatares')}><ImagemIcone size={15} /> Avatares</button>
      </div>
      {aba === 'frases' && <Frases editando={editando} setEditando={setEditando} />}
      {aba === 'estatisticas' && <Painel Icon={BarChart3} titulo="Estatísticas" sub="Exibições, cliques, dispensas e ações concluídas por frase e por momento."><Vazio>Ainda coletando. Os números por frase já aparecem na lista da aba Frases; o resumo por momento vem quando o motor da Mel estiver no ar.</Vazio></Painel>}
      {aba === 'avatares' && <Painel Icon={ImagemIcone} titulo="Avatares" sub="As roupas da Mel por clima e tom (avatar_key)."><Vazio>Reservado. A escolha do avatar é do motor; aqui vai dar para ver e classificar as imagens.</Vazio></Painel>}
    </Shell>
  )
}

// ---------- a lista ----------
function Frases({ editando, setEditando }) {
  const { confirmar, avisar } = useDialogo()
  const [momentos, setMomentos] = useState([])
  const [linhas, setLinhas] = useState(null)
  const [stats, setStats] = useState({})
  const [erro, setErro] = useState('')
  const [f, setF] = useState({ busca: '', chave: '', superficie: '', ramo: '', tipo: '', tom: '', ativa: '', clima: '' })
  const [pagina, setPagina] = useState(0)
  const [sel, setSel] = useState(() => new Set())
  const [pesoLote, setPesoLote] = useState('')
  const [importando, setImportando] = useState(false)
  const [menu, setMenu] = useState(null)

  const carregar = useCallback(async () => {
    const [m, l, s] = await Promise.all([
      supabase.from('mel_momentos').select('*').order('ordem'),
      supabase.from('mel_frases').select('*').order('chave').order('superficie').order('created_at'),
      supabase.rpc('mel_frases_estatisticas'),
    ])
    setMomentos(m.data ?? []); setLinhas(l.data ?? [])
    const st = {}; for (const r of s.data ?? []) st[r.frase_id] = r
    setStats(st)
    if (l.error) setErro(l.error.message)
  }, [])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { if (!menu) return; const fechar = () => setMenu(null); document.addEventListener('click', fechar); return () => document.removeEventListener('click', fechar) }, [menu])

  const porChave = useMemo(() => Object.fromEntries(momentos.map((m) => [m.chave, m])), [momentos])
  const lista = useMemo(() => (linhas ?? []).filter((l) =>
    (!f.chave || l.chave === f.chave) && (!f.superficie || l.superficie === f.superficie) &&
    (!f.ramo || (f.ramo === 'generica' ? !l.ramos?.length : l.ramos?.includes(f.ramo))) &&
    (!f.tipo || (f.tipo === 'ambos' ? !l.tipos?.length : l.tipos?.includes(f.tipo))) &&
    (!f.tom || l.tom === f.tom) && (!f.clima || l.contextos_clima?.includes(f.clima)) &&
    (!f.ativa || (f.ativa === 'sim') === l.ativa) &&
    (!f.busca || (l.texto + ' ' + l.chave + ' ' + (porChave[l.chave]?.rotulo ?? '')).toLowerCase().includes(f.busca.toLowerCase()))
  ), [linhas, f, porChave])
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA))
  const visiveis = lista.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA)
  const filtrar = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPagina(0) }
  const filtrosAtivos = Object.entries(f).filter(([, v]) => v).length

  // ---- ações de uma frase ----
  async function alternar(l) {
    const r = await supabase.from('mel_frases').update({ ativa: !l.ativa }).eq('id', l.id)
    if (r.error) { setErro(r.error.message); return }
    setLinhas((ls) => ls.map((x) => (x.id === l.id ? { ...x, ativa: !l.ativa } : x)))
  }
  function duplicar(l) {
    // eslint-disable-next-line no-unused-vars
    const { id, created_at, updated_at, ...resto } = l
    setEditando({ ...resto, _duplicada_de: l.texto })
  }
  async function excluir(l) {
    const temHistorico = (stats[l.id]?.exibicoes ?? 0) > 0
    if (temHistorico) { await avisar({ titulo: 'Esta frase já apareceu para alguém', texto: 'Ela faz parte do histórico e não pode ser excluída. Desative para a Mel parar de usar.' }); return }
    if (!(await confirmar({ titulo: 'Excluir a frase de vez?', texto: `"${l.texto}"`, ok: 'Excluir', cancelar: 'Deixar' }))) return
    const r = await supabase.from('mel_frases').delete().eq('id', l.id)
    if (r.error) { await avisar({ titulo: 'Não deu para excluir', texto: r.error.message }); return }
    setLinhas((ls) => ls.filter((x) => x.id !== l.id))
  }

  // ---- seleção em massa ----
  const todasVisiveis = visiveis.length > 0 && visiveis.every((l) => sel.has(l.id))
  function marcarTodas() { setSel((s) => { const n = new Set(s); if (todasVisiveis) visiveis.forEach((l) => n.delete(l.id)); else visiveis.forEach((l) => n.add(l.id)); return n }) }
  function marcar(id) { setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }) }
  async function emMassa(campos) {
    const ids = [...sel]
    const r = await supabase.from('mel_frases').update(campos).in('id', ids)
    if (r.error) { setErro(r.error.message); return }
    setLinhas((ls) => ls.map((x) => (sel.has(x.id) ? { ...x, ...campos } : x)))
    setSel(new Set()); setPesoLote('')
  }

  // ---- exportar o que está filtrado ----
  function exportar(copiar) {
    const dados = lista.map((l) => Object.fromEntries(CAMPOS_JSON.map((k) => [k, l[k] ?? null])))
    const json = JSON.stringify(dados, null, 2)
    if (copiar) { navigator.clipboard?.writeText(json); avisar({ titulo: 'Copiado', texto: `${dados.length} frases no formato de importação.` }); return }
    const nome = ['mel-frases', f.chave, f.superficie, f.ramo].filter(Boolean).join('-') + '.json'
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = nome; a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <>
      <Painel Icon={Sparkles} titulo="Biblioteca de frases" sub={linhas ? `${linhas.length} frases · ${linhas.filter((l) => l.ativa).length} ativas · ${momentos.length} momentos no catálogo` : 'Carregando…'}
        direita={<div className="seo-acoes"><button className="btn btn-ghost" onClick={() => setImportando(true)}><Upload size={15} /> Importar frases</button><button className="btn btn-ghost" onClick={() => exportar(false)} disabled={!lista.length}><Download size={15} /> Exportar JSON</button><button className="btn btn-ghost btn-mini plat-mel-copiar" onClick={() => exportar(true)} disabled={!lista.length} title="Copiar o JSON filtrado"><Copy size={14} /></button></div>}>
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className="seo-filtros plat-mel-filtros">
          <label className="seo-busca"><Search size={15} /><input value={f.busca} onChange={(e) => filtrar('busca', e.target.value)} placeholder="Buscar no texto…" /></label>
          <select value={f.chave} onChange={(e) => filtrar('chave', e.target.value)}><option value="">Todos os momentos</option>{Object.entries(CATEGORIAS).map(([c, rot]) => <optgroup key={c} label={rot}>{momentos.filter((m) => m.categoria === c).map((m) => <option key={m.chave} value={m.chave}>{m.rotulo}</option>)}</optgroup>)}</select>
          <select value={f.superficie} onChange={(e) => filtrar('superficie', e.target.value)}><option value="">Toda superfície</option>{Object.entries(SUPERFICIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={f.ramo} onChange={(e) => filtrar('ramo', e.target.value)}><option value="">Todo ramo</option><option value="generica">Só genéricas</option>{Object.entries(RAMOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={f.tipo} onChange={(e) => filtrar('tipo', e.target.value)}><option value="">Todo tipo</option><option value="ambos">Salão e autônoma</option>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={f.clima} onChange={(e) => filtrar('clima', e.target.value)}><option value="">Todo clima</option>{Object.entries(CONTEXTOS_CLIMA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={f.tom} onChange={(e) => filtrar('tom', e.target.value)}><option value="">Todo tom</option>{Object.entries(TONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={f.ativa} onChange={(e) => filtrar('ativa', e.target.value)}><option value="">Ativas e inativas</option><option value="sim">Só ativas</option><option value="nao">Só inativas</option></select>
          {filtrosAtivos > 0 && <button className="plat-link" onClick={() => { setF({ busca: '', chave: '', superficie: '', ramo: '', tipo: '', tom: '', ativa: '', clima: '' }); setPagina(0) }}><X size={13} /> Limpar</button>}
        </div>

        {sel.size > 0 && (
          <div className="plat-mel-lote">
            <strong>{sel.size} selecionada{sel.size > 1 ? 's' : ''}</strong>
            <button className="btn btn-ghost btn-mini" onClick={() => emMassa({ ativa: true })}>Ativar</button>
            <button className="btn btn-ghost btn-mini" onClick={() => emMassa({ ativa: false })}>Desativar</button>
            <span className="plat-mel-lote-peso">Peso <select value={pesoLote} onChange={(e) => setPesoLote(e.target.value)}><option value="">—</option>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}</select><button className="btn btn-ghost btn-mini" disabled={!pesoLote} onClick={() => emMassa({ peso: Number(pesoLote) })}>Aplicar</button></span>
            <button className="plat-link" onClick={() => setSel(new Set())}>Limpar seleção</button>
          </div>
        )}

        {linhas === null ? <Vazio>Carregando…</Vazio> : lista.length === 0 ? <Vazio>{linhas.length === 0 ? 'Nenhuma frase ainda. Importe um JSON ou crie a primeira.' : 'Nada com esses filtros.'}</Vazio> : (
          <div className="plat-rolagem">
            <table className="plat-tabela plat-mel-tabela"><thead><tr>
              <th><input type="checkbox" checked={todasVisiveis} onChange={marcarTodas} aria-label="Selecionar todas desta página" /></th>
              <th>Frase</th><th>Moment</th><th>Superfície</th><th>Ramo</th><th>Tom</th><th>Peso</th><th>Status</th><th title="Exibições · interações (cliques + concluídas)" className="plat-mel-uso"><Eye size={14} /> · <MousePointerClick size={14} /></th><th />
            </tr></thead><tbody>
              {visiveis.map((l) => {
                const m = porChave[l.chave]; const st = stats[l.id]
                return (
                  <tr key={l.id} className={(!l.ativa ? 'plat-mel-inativa' : '') + (sel.has(l.id) ? ' selecionada' : '')}>
                    <td><input type="checkbox" checked={sel.has(l.id)} onChange={() => marcar(l.id)} /></td>
                    <td className="plat-mel-texto"><Texto texto={l.texto} /><small className="muted">{[l.tipos?.length ? l.tipos.map((t) => TIPOS[t]).join(', ') : null, l.contextos_clima?.length ? l.contextos_clima.map((c) => CONTEXTOS_CLIMA[c]).join(', ') : null, l.periodos?.length ? l.periodos.map((p) => PERIODOS[p]).join(', ') : null].filter(Boolean).join(' · ')}</small></td>
                    <td><strong>{m?.rotulo ?? l.chave}</strong><br /><small className="muted mono">{l.chave}</small></td>
                    <td><Pilula tom={l.superficie === 'mel_bubble' ? 'rosa' : 'azul'}>{l.superficie === 'mel_bubble' ? 'balão' : 'clima'}</Pilula></td>
                    <td>{l.ramos?.length ? l.ramos.map((r) => RAMOS[r] ?? r).join(', ') : <span className="muted">genérica</span>}</td>
                    <td>{TONS[l.tom] ?? l.tom}</td>
                    <td>{l.peso}</td>
                    <td><Pilula>{l.ativa ? 'ativa' : 'inativa'}</Pilula></td>
                    <td className="plat-mel-uso" title={`${st?.exibicoes ?? 0} exibições · ${st?.cliques ?? 0} cliques · ${st?.dispensas ?? 0} dispensas · ${st?.concluidas ?? 0} concluídas`}>{st?.exibicoes ?? 0} · {(st?.cliques ?? 0) + (st?.concluidas ?? 0)}</td>
                    <td className="plat-mel-acoes">
                      <button className="plat-link" onClick={() => setEditando({ ...l })}>Editar</button>
                      <button className="plat-link" onClick={() => duplicar(l)}>Duplicar</button>
                      <button className="plat-link" onClick={() => alternar(l)}>{l.ativa ? 'Desativar' : 'Ativar'}</button>
                      <span className="plat-mel-mais"><button className="btn btn-ghost btn-mini" aria-label="Mais ações" onClick={(e) => { e.stopPropagation(); setMenu(menu === l.id ? null : l.id) }}><MoreHorizontal size={14} /></button>
                        {menu === l.id && <div className="plat-achados plat-mel-menu"><button onMouseDown={() => excluir(l)}>Excluir de vez</button></div>}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody></table>
          </div>
        )}
        {paginas > 1 && <div className="plat-paginacao"><span className="muted">{lista.length} frases · página {pagina + 1} de {paginas}</span><div><button className="btn btn-ghost btn-mini" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</button><button className="btn btn-ghost btn-mini" disabled={pagina >= paginas - 1} onClick={() => setPagina((p) => p + 1)}>Próxima</button></div></div>}
      </Painel>

      {editando && <Editor frase={editando} momentos={momentos} fechar={() => setEditando(null)} salvou={(nova, eraNova) => { setEditando(null); if (eraNova) setLinhas((ls) => [...(ls ?? []), (ls ?? []).some((x) => x.id === nova.id) ? { ...nova, id: 'nova-' + Date.now() } : nova]); else setLinhas((ls) => ls.map((x) => (x.id === nova.id ? nova : x))) }} />}
      {importando && <Importar momentos={momentos} fechar={() => setImportando(false)} importou={() => { setImportando(false); carregar() }} />}
    </>
  )
}

// o texto da frase com os placeholders em destaque
function Texto({ texto }) {
  const partes = String(texto ?? '').split(/(\{[^{}]*\})/g)
  return <span>{partes.map((p, i) => (/^\{[^{}]*\}$/.test(p) ? <code key={i} className="plat-mel-ph">{p}</code> : <span key={i}>{p}</span>))}</span>
}

// ---------- criar / editar ----------
function Editor({ frase, momentos, fechar, salvou }) {
  const [v, setV] = useState(frase)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const caixa = useRef(null)
  const m = momentos.find((x) => x.chave === v.chave)
  const permitidos = m?.placeholders ?? []
  const problema = v.chave ? problemaDosPlaceholders(v.texto, permitidos) : null
  const superficieOk = !m || (m.superficies ?? []).includes(v.superficie)
  const previa = substituir(v.texto, m?.exemplo ?? {})
  const limite = LIMITE[v.superficie] ?? 60
  const set = (k, x) => setV((e) => ({ ...e, [k]: x }))
  const alternarLista = (k, item) => setV((e) => { const atual = e[k] ?? []; const nova = atual.includes(item) ? atual.filter((x) => x !== item) : [...atual, item]; return { ...e, [k]: nova.length ? nova : null } })

  // escolher outro momento: a superfície precisa continuar válida
  function escolherMomento(chave) {
    const mm = momentos.find((x) => x.chave === chave)
    setV((e) => ({ ...e, chave, superficie: mm && !(mm.superficies ?? []).includes(e.superficie) ? mm.superficies[0] : e.superficie }))
  }

  function inserir(ph) {
    const el = caixa.current; const t = `{${ph}}`
    if (!el) { set('texto', (v.texto || '') + t); return }
    const a = el.selectionStart ?? v.texto.length, b = el.selectionEnd ?? a
    const novo = v.texto.slice(0, a) + t + v.texto.slice(b)
    set('texto', novo)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + t.length, a + t.length) })
  }

  async function salvar() {
    setErro('')
    if (!v.chave) { setErro('Escolha o moment.'); return }
    if (!v.texto.trim()) { setErro('Escreva a frase.'); return }
    if (problema) { setErro(problema); return }
    setSalvando(true)
    // eslint-disable-next-line no-unused-vars
    const { id, created_at, updated_at, _duplicada_de, ...campos } = v
    campos.peso = Number(campos.peso) || 1
    const r = id ? await supabase.from('mel_frases').update(campos).eq('id', id).select().single() : await supabase.from('mel_frases').insert(campos).select().single()
    setSalvando(false)
    if (r.error) { setErro(r.error.message.replace(/^.*Frase inválida: /, '')); return }
    salvou(r.data ?? { ...v, id: id ?? 'nova' }, !id)
  }

  return (
    <Portal><div className="modal-fundo plat-modal-fundo" onClick={fechar}>
      <div className="modal-caixa plat-modal plat-mel-modal" onClick={(e) => e.stopPropagation()}>
        <h3><Sparkles size={18} /> {v.id ? 'Editar frase' : v._duplicada_de ? 'Nova variante' : 'Nova frase'}</h3>
        {v._duplicada_de && <p className="muted">Duplicada de: “{v._duplicada_de}”. Ajuste o texto e os filtros.</p>}
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className="plat-mel-editor">
          <div className="form">
            <div className="plat-mel-duas">
              <label>Moment<select value={v.chave} onChange={(e) => escolherMomento(e.target.value)}><option value="">Escolha…</option>{Object.entries(CATEGORIAS).map(([c, rot]) => <optgroup key={c} label={rot}>{momentos.filter((x) => x.categoria === c).map((x) => <option key={x.chave} value={x.chave}>{x.rotulo}</option>)}</optgroup>)}</select></label>
              <label>Superfície<div className="plat-chips">{Object.entries(SUPERFICIES).map(([k, rot]) => <button type="button" key={k} className={'plat-chip' + (v.superficie === k ? ' ativo' : '')} disabled={m && !(m.superficies ?? []).includes(k)} onClick={() => set('superficie', k)}>{rot}</button>)}</div></label>
            </div>
            {m && <p className="muted plat-mel-descricao">{m.descricao}</p>}
            <label>Frase
              <textarea ref={caixa} rows={3} value={v.texto} onChange={(e) => set('texto', e.target.value)} className={problema ? 'plat-mel-com-erro' : ''} placeholder={v.superficie === 'mel_bubble' ? 'Curta, em primeira pessoa, até 60 caracteres' : 'Um pouco mais editorial, até 90 caracteres'} />
              <span className="seo-contadores"><span className={previa.length > limite ? 'muito' : ''}>{previa.length}/{limite} na prévia</span>{problema && <span className="muito">{problema}</span>}</span>
            </label>
            {m && <div className="plat-mel-vars"><small className="muted">Variáveis disponíveis:</small>{permitidos.length === 0 ? <small className="muted">nenhuma neste moment</small> : permitidos.map((p) => <button type="button" key={p} className="plat-mel-ph plat-mel-ph-btn" onClick={() => inserir(p)}>{`{${p}}`}</button>)}</div>}
            <Lista rotulo="Ramos" dica="Vazio = genérica, serve para qualquer ramo" opcoes={RAMOS} valor={v.ramos} alternar={(x) => alternarLista('ramos', x)} />
            <Lista rotulo="Tipo" dica="Vazio = salão e autônoma" opcoes={TIPOS} valor={v.tipos} alternar={(x) => alternarLista('tipos', x)} />
            <Lista rotulo="Contexto de clima" dica="Vazio = qualquer tempo" opcoes={CONTEXTOS_CLIMA} valor={v.contextos_clima} alternar={(x) => alternarLista('contextos_clima', x)} />
            <Lista rotulo="Período" dica="Vazio = qualquer hora" opcoes={PERIODOS} valor={v.periodos} alternar={(x) => alternarLista('periodos', x)} />
            <div className="plat-mel-tres">
              <label>Tom<select value={v.tom} onChange={(e) => set('tom', e.target.value)}>{Object.entries(TONS).map(([k, rot]) => <option key={k} value={k}>{rot}</option>)}</select></label>
              <label>Peso<input type="number" min={1} max={10} value={v.peso} onChange={(e) => set('peso', e.target.value)} /></label>
              <label className="plat-mel-check"><input type="checkbox" checked={!!v.ativa} onChange={(e) => set('ativa', e.target.checked)} /> Ativa</label>
            </div>
          </div>
          <Previa superficie={v.superficie} texto={previa || 'A prévia aparece aqui.'} tom={v.tom} />
        </div>
        <div className="modal-acoes">
          <button className="btn btn-ghost" onClick={fechar}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={salvando || !v.chave || !v.texto.trim() || !!problema || !superficieOk}>{salvando ? 'Salvando…' : v.id ? 'Salvar' : 'Criar frase'}</button>
        </div>
      </div>
    </div></Portal>
  )
}

function Lista({ rotulo, dica, opcoes, valor, alternar }) {
  return (
    <label>{rotulo} <small className="muted">· {dica}</small>
      <div className="plat-chips">{Object.entries(opcoes).map(([k, rot]) => <button type="button" key={k} className={'plat-chip' + (valor?.includes(k) ? ' ativo' : '')} onClick={() => alternar(k)}>{rot}</button>)}</div>
    </label>
  )
}

// a prévia: o balão ao lado da Mel, ou a linha do cartão do clima
function Previa({ superficie, texto, tom }) {
  if (superficie === 'weather_card') return (
    <div className="plat-mel-previa">
      <small className="muted">Como fica no cartão do clima</small>
      <div className="plat-mel-previa-card">
        <div className="plat-mel-previa-agora"><CloudSun size={28} /><span><strong>26°</strong><small>Parcialmente nublado</small></span></div>
        <span className="plat-mel-previa-frase">{texto}</span>
        <span className="plat-mel-previa-titulo">Hoje em Santos</span>
      </div>
    </div>
  )
  return (
    <div className="plat-mel-previa">
      <small className="muted">Como fica no balão da Mel · tom {TONS[tom] ?? tom}</small>
      <div className="plat-mel-previa-balao-area">
        <span className="plat-mel-previa-balao">{texto}</span>
        <img src={MEL} alt="" className="plat-mel-previa-mel" />
      </div>
    </div>
  )
}

// ---------- importação em massa ----------
function Importar({ momentos, fechar, importou }) {
  const [json, setJson] = useState('')
  const [relatorio, setRelatorio] = useState(null)
  const [itens, setItens] = useState(null)
  const [erro, setErro] = useState('')
  const [rodando, setRodando] = useState(false)

  async function validar() {
    setErro(''); setRelatorio(null)
    let dados
    try { dados = JSON.parse(json) } catch (e) { setErro('JSON inválido: ' + e.message); return }
    if (!Array.isArray(dados)) { setErro('O JSON precisa ser uma lista [ … ] de frases.'); return }
    if (dados.length === 0) { setErro('A lista está vazia.'); return }
    setRodando(true)
    const r = await supabase.rpc('mel_frases_importar', { itens: dados, aplicar: false })
    setRodando(false)
    if (r.error) { setErro(r.error.message); return }
    setItens(dados); setRelatorio(r.data)
  }
  async function aplicar() {
    setRodando(true)
    const r = await supabase.rpc('mel_frases_importar', { itens, aplicar: true })
    setRodando(false)
    if (r.error) { setErro(r.error.message); return }
    setRelatorio(r.data)
  }
  const exemplo = `[\n  { "chave": "calor_extremo", "superficie": "mel_bubble", "texto": "{temperatura} graus e o secador trabalhando dobrado.", "ramos": ["cabelo"], "tom": "cansada" },\n  { "chave": "calor_extremo", "superficie": "mel_bubble", "texto": "Hoje até o café está pedindo gelo.", "ramos": null, "tom": "feliz" }\n]`

  return (
    <Portal><div className="modal-fundo plat-modal-fundo" onClick={fechar}>
      <div className="modal-caixa plat-modal plat-mel-modal" onClick={(e) => e.stopPropagation()}>
        <h3><Upload size={18} /> Importar frases</h3>
        <p className="muted">Cole uma lista JSON. Cada item precisa de <code>chave</code>, <code>superficie</code> e <code>texto</code>; <code>ramos</code>, <code>tipos</code>, <code>contextos_clima</code>, <code>periodos</code>, <code>tom</code>, <code>peso</code> e <code>ativa</code> são opcionais. Com <code>id</code>, a frase existente é atualizada. Momentos válidos: {momentos.map((m) => m.chave).join(', ')}.</p>
        {erro && <div className="alert alert-error">{erro}</div>}
        {!relatorio?.aplicado && <textarea className="mono plat-mel-json" rows={relatorio ? 6 : 12} value={json} onChange={(e) => { setJson(e.target.value); setRelatorio(null) }} placeholder={exemplo} spellCheck={false} />}
        {relatorio && (
          <div className="plat-mel-relatorio">
            <div className="plat-mel-relatorio-nums">
              <span><strong>{relatorio.total}</strong> frases encontradas</span>
              <span className="ok"><Check size={14} /> <strong>{relatorio.validas}</strong> válidas</span>
              <span className={relatorio.invalidas ? 'ruim' : ''}><X size={14} /> <strong>{relatorio.invalidas}</strong> com problema</span>
              {relatorio.aplicado && <span className="ok">{relatorio.inseridas} novas · {relatorio.atualizadas} atualizadas</span>}
            </div>
            {relatorio.problemas?.length > 0 && <ul className="plat-mel-problemas">{relatorio.problemas.map((p, i) => <li key={i}><strong>frase {p.indice}:</strong> {p.erro}{p.texto ? <small className="muted"> · “{p.texto}”</small> : null}</li>)}</ul>}
          </div>
        )}
        <div className="modal-acoes">
          <button className="btn btn-ghost" onClick={relatorio?.aplicado ? importou : fechar}>{relatorio?.aplicado ? 'Fechar' : 'Cancelar'}</button>
          {!relatorio && <button className="btn btn-primary" onClick={validar} disabled={rodando || !json.trim()}>{rodando ? 'Validando…' : 'Validar'}</button>}
          {relatorio && !relatorio.aplicado && <button className="btn btn-primary" onClick={aplicar} disabled={rodando || !relatorio.validas}>{rodando ? 'Importando…' : `Importar ${relatorio.validas} frase${relatorio.validas === 1 ? '' : 's'}`}</button>}
        </div>
      </div>
    </div></Portal>
  )
}
