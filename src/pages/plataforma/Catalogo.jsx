import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho, Painel, Pilula, Vazio } from '../../components/plataforma/Pecas'
import Portal from '../../components/Portal'
import { supabase } from '../../lib/supabase'
import { useDialogo } from '../../context/DialogoContext'
import { ajustarCriativo } from '../../lib/imagem'
import { esquecerCatalogo } from '../../lib/catalogo'
import { normalizar } from '../../lib/catalogoBusca'
import { LayoutGrid, Plus, Search, Download, ChevronDown, ChevronRight, Pencil, ImagePlus, Trash2, X, Check, Sparkles } from 'lucide-react'

// Plataforma → Catálogo (2.92): o que a MIMO sugere aos salões. Categorias
// da plataforma (com imagem, descrição, ordem, ativa) e a árvore de cada
// uma: famílias → serviços → técnicas, com aliases, tags, duração,
// prioridade de sugestão, imagem e ativa. Tudo direto nas tabelas (RLS da
// Plataforma); as imagens vão para o bucket público `catalogo`.
//
// Regras que o banco já garante e aqui só aparecem como mensagem: slug
// único por categoria/pai, hierarquia (família → serviço → técnica), item
// usado por serviço de salão não apaga (desativa). O que mudar aqui vale
// para os salões na próxima abertura do cadastro.

const TIPO = { familia: 'Família', servico: 'Serviço', tecnica: 'Técnica' }
const FILHO = { categoria: 'familia', familia: 'servico', servico: 'tecnica' }
const TAMANHO = { categoria: [1400, 900], familia: [1400, 900], servico: [1120, 720] }
const TONS = [['#ff2d7a', '#aa4cff'], ['#aa4cff', '#ff7baa'], ['#ff7baa', '#ff9a6c'], ['#7c5cff', '#ff2d7a'], ['#ff5c8a', '#c86bff'], ['#f26b8a', '#8a5cff'], ['#3d0c4e', '#ff2d7a'], ['#ff9a6c', '#ff2d7a'], ['#6c4cff', '#ff7baa'], ['#1f2026', '#aa4cff']]

export function slugDe(t) {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
const lista = (t) => String(t ?? '').split(',').map((x) => x.trim()).filter(Boolean)
const erroHumano = (e) => {
  const m = String(e?.message ?? e)
  if (/catalogo_familia_slug_unique|catalogo_filhos_slug_unique|duplicate key/.test(m)) return 'Já existe um item com esse slug no mesmo lugar. Troque o slug.'
  if (/categorias_plataforma_slug_idx/.test(m)) return 'Já existe uma categoria com esse slug.'
  if (/categorias_de_servico_nome_idx/.test(m)) return 'Já existe uma categoria com esse nome.'
  return m
}

export default function Catalogo() {
  const { confirmar, avisar } = useDialogo()
  const [cats, setCats] = useState(null)
  const [itens, setItens] = useState([])
  const [uso, setUso] = useState({})          // item_id → n serviços de salão
  const [usoCat, setUsoCat] = useState({})    // categoria_id → n
  const [catSel, setCatSel] = useState(null)
  const [busca, setBusca] = useState('')
  const [abertas, setAbertas] = useState(() => new Set())
  const [editando, setEditando] = useState(null)   // { tipo: 'categoria'|'familia'|'servico'|'tecnica', item, pai, categoria }
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    const [c, i, u] = await Promise.all([
      supabase.from('categorias_de_servico').select('id, nome, slug, descricao, aliases, ordem, ativa, imagem_url').is('salon_id', null).order('ordem').order('nome'),
      supabase.from('catalogo_itens').select('*').order('ordem').order('nome'),
      supabase.rpc('catalogo_uso'),
    ])
    if (c.error) setErro(c.error.message)
    setCats(c.data ?? []); setItens(i.data ?? [])
    const m = {}, mc = {}
    for (const r of u.data ?? []) { if (r.item_id) m[r.item_id] = (m[r.item_id] ?? 0) + Number(r.n); if (r.categoria_id) mc[r.categoria_id] = (mc[r.categoria_id] ?? 0) + Number(r.n) }
    setUso(m); setUsoCat(mc)
    esquecerCatalogo()
  }, [])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { if (cats?.length && !catSel) setCatSel(cats.find((c) => c.slug !== 'outros' && c.ativa)?.id ?? cats[0].id) }, [cats, catSel])

  const porPai = useMemo(() => { const m = new Map(); for (const i of itens) { const k = i.pai_id ?? 'raiz:' + i.categoria_id; if (!m.has(k)) m.set(k, []); m.get(k).push(i) } return m }, [itens])
  const porId = useMemo(() => new Map(itens.map((i) => [i.id, i])), [itens])
  const filhos = useCallback((pai, categoriaId) => porPai.get(pai ? pai.id : 'raiz:' + categoriaId) ?? [], [porPai])
  // os nomes de família › serviço acima de um item (para o cabeçalho do editor)
  const ancestrais = (it) => { const out = []; let a = it; while (a) { out.unshift(a.nome); a = a.pai_id ? porId.get(a.pai_id) : null } return out }
  const contagem = useMemo(() => { const m = {}; for (const i of itens) { const k = i.categoria_id; m[k] ??= { familia: 0, servico: 0, tecnica: 0 }; m[k][i.tipo]++ } return m }, [itens])
  const categoria = cats?.find((c) => c.id === catSel) ?? null
  const q = normalizar(busca)
  const bate = useCallback((i) => !q || normalizar(i.nome).includes(q) || (i.aliases ?? []).some((a) => normalizar(a).includes(q)) || (i.tags ?? []).some((t) => normalizar(t).includes(q)), [q])
  // com busca, mostra quem bate ou tem descendente que bate, e abre tudo
  function visivel(i) { return bate(i) || filhos(i).some((f) => visivel(f)) }
  const alternar = (id) => setAbertas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const aberta = (id) => (q ? true : abertas.has(id))

  function exportar() {
    const arvore = { versao: 1, exportado_em: new Date().toISOString(), categorias: (cats ?? []).filter((c) => c.slug !== 'outros').map((c) => ({
      slug: c.slug, nome: c.nome, descricao: c.descricao, aliases: c.aliases ?? [], ordem: c.ordem, ativa: c.ativa, imagem_url: c.imagem_url,
      familias: filhos(null, c.id).map((f) => ({ slug: f.slug, nome: f.nome, descricao: f.descricao, aliases: f.aliases, ordem: f.ordem, ativa: f.ativa, imagem_url: f.imagem_url,
        servicos: filhos(f).map((s) => ({ slug: s.slug, nome: s.nome, descricao: s.descricao, duracao_sugerida: s.duracao_sugerida, aliases: s.aliases, tags: s.tags, ordem: s.ordem, prioridade_sugestao: s.prioridade_sugestao, ativa: s.ativa, imagem_url: s.imagem_url,
          tecnicas: filhos(s).map((t) => ({ slug: t.slug, nome: t.nome, aliases: t.aliases, duracao_sugerida: t.duracao_sugerida, ordem: t.ordem, ativa: t.ativa })) })) })) })) }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(arvore, null, 2)], { type: 'application/json' })); a.download = 'catalogo-mimo.json'; a.click(); URL.revokeObjectURL(a.href)
  }

  async function alternarAtiva(tabela, item) {
    const r = await supabase.from(tabela).update({ ativa: !item.ativa }).eq('id', item.id)
    if (r.error) { setErro(erroHumano(r.error)); return }
    carregar()
  }
  async function excluir(item) {
    const n = uso[item.id] ?? 0
    if (n > 0) { await avisar({ titulo: 'Este item está em uso', texto: `${n} ${n === 1 ? 'serviço de salão aponta' : 'serviços de salão apontam'} para “${item.nome}”. Desative em vez de excluir.` }); return }
    if (filhos(item).length) { await avisar({ titulo: 'Tem filhos', texto: `“${item.nome}” tem ${filhos(item).length} ${filhos(item).length === 1 ? 'item' : 'itens'} abaixo. Exclua ou mova os filhos antes.` }); return }
    if (!(await confirmar({ titulo: `Excluir “${item.nome}”?`, texto: 'Some do catálogo para todos os salões. Para esconder sem apagar, desative.', ok: 'Excluir', perigo: true }))) return
    const r = await supabase.from('catalogo_itens').delete().eq('id', item.id)
    if (r.error) { await avisar({ titulo: 'Não deu para excluir', texto: erroHumano(r.error) }); return }
    if (item.imagem_url) tirarArquivo(item.imagem_url)
    carregar()
  }

  const total = useMemo(() => ({ familia: itens.filter((i) => i.tipo === 'familia').length, servico: itens.filter((i) => i.tipo === 'servico').length, tecnica: itens.filter((i) => i.tipo === 'tecnica').length }), [itens])

  return (
    <Shell acao={{ rotulo: 'Nova categoria', onClick: () => setEditando({ tipo: 'categoria', item: null }) }}>
      <Cabecalho titulo="Catálogo de serviços" sub="O que a MIMO sugere aos salões: categorias, famílias, serviços e técnicas. O que mudar aqui vale para todo mundo na próxima vez que abrirem “Adicionar serviço”."
        direita={<div className="seo-acoes"><button className="btn btn-ghost" onClick={exportar} disabled={!cats?.length}><Download size={15} /> Exportar JSON</button></div>} />
      {erro && <div className="alert alert-error">{erro}</div>}

      <Painel Icon={LayoutGrid} titulo="Categorias" sub={cats ? `${cats.filter((c) => c.ativa && c.slug !== 'outros').length} ativas · ${total.familia} famílias · ${total.servico} serviços · ${total.tecnica} técnicas` : 'Carregando…'}>
        {!cats ? <Vazio>Carregando…</Vazio> : (
          <div className="plat-cat-grade">
            {cats.map((c, i) => {
              const n = contagem[c.id] ?? { familia: 0, servico: 0 }
              const [a, b] = TONS[i % TONS.length]
              return (
                <div key={c.id} className={'plat-cat' + (c.id === catSel ? ' sel' : '') + (!c.ativa ? ' inativa' : '')} style={{ '--cat-a': a, '--cat-b': b }}>
                  <button type="button" className="plat-cat-figura" onClick={() => setCatSel(c.id)} aria-label={`Abrir ${c.nome}`}>
                    {c.imagem_url ? <img src={c.imagem_url} alt="" /> : <span className="plat-cat-sem"><ImagePlus size={18} /> sem imagem</span>}
                  </button>
                  <div className="plat-cat-corpo">
                    <button type="button" className="plat-cat-nome" onClick={() => setCatSel(c.id)}><strong>{c.nome}</strong><small className="mono">{c.slug}</small></button>
                    <span className="plat-cat-meta">{c.slug === 'outros' ? 'só o personalizado' : `${n.familia} fam · ${n.servico} serv`}{usoCat[c.id] ? ` · ${usoCat[c.id]} em salões` : ''}</span>
                    <div className="plat-cat-pe">
                      <Pilula tom={c.ativa ? 'menta' : 'cinza'}>{c.ativa ? 'ativa' : 'inativa'}</Pilula>
                      <span className="muted">ordem {c.ordem}</span>
                      <button type="button" className="plat-link" onClick={() => setEditando({ tipo: 'categoria', item: c })}><Pencil size={13} /> Editar</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Painel>

      {categoria && (
        <Painel Icon={Sparkles} titulo={categoria.nome} sub={categoria.slug === 'outros' ? 'Outros não tem catálogo: é onde cai o serviço personalizado sem categoria.' : `${(contagem[categoria.id]?.familia ?? 0)} famílias · ${(contagem[categoria.id]?.servico ?? 0)} serviços · ${(contagem[categoria.id]?.tecnica ?? 0)} técnicas`}
          direita={categoria.slug !== 'outros' && <div className="seo-acoes">
            <label className="seo-busca"><Search size={15} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome, alias ou tag…" />{busca && <button type="button" className="plat-link" onClick={() => setBusca('')}><X size={13} /></button>}</label>
            <button className="btn btn-primary btn-mini" onClick={() => setEditando({ tipo: 'familia', item: null, pai: null, categoria })}><Plus size={14} /> Nova família</button>
          </div>}>
          {categoria.slug !== 'outros' && (
            <div className="plat-arvore">
              {filhos(null, categoria.id).filter(visivel).map((f) => (
                <No key={f.id} item={f} nivel={1} filhos={filhos} visivel={visivel} aberta={aberta} alternar={alternar} uso={uso}
                  onEditar={(it, pai) => setEditando({ tipo: it.tipo, item: it, pai, categoria })} onNovo={(pai) => setEditando({ tipo: FILHO[pai.tipo], item: null, pai, categoria })}
                  onAtiva={(it) => alternarAtiva('catalogo_itens', it)} onExcluir={excluir} />
              ))}
              {filhos(null, categoria.id).length === 0 && <Vazio>Nenhuma família ainda. Comece por “Nova família”.</Vazio>}
              {filhos(null, categoria.id).length > 0 && filhos(null, categoria.id).filter(visivel).length === 0 && <Vazio>Nada com “{busca}” nesta categoria.</Vazio>}
            </div>
          )}
        </Painel>
      )}

      {editando && (editando.tipo === 'categoria'
        ? <EditorCategoria categoria={editando.item} proximaOrdem={(cats ?? []).filter((c) => c.slug !== 'outros').reduce((m, c) => Math.max(m, c.ordem), 0) + 10} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); carregar() }} />
        : <EditorItem tipo={editando.tipo} item={editando.item} pai={editando.pai} caminhoPai={editando.pai ? ancestrais(editando.pai) : []} categoria={editando.categoria} irmaos={filhos(editando.pai, editando.categoria.id)} uso={uso[editando.item?.id] ?? 0} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); carregar() }} onExcluir={editando.item ? () => { setEditando(null); excluir(editando.item) } : null} />)}
    </Shell>
  )
}

// um nó da árvore: família (nível 1) › serviço (2) › técnica (3)
function No({ item, nivel, filhos, visivel, aberta, alternar, uso, onEditar, onNovo, onAtiva, onExcluir, pai = null }) {
  const kids = filhos(item).filter(visivel)
  const temFilhos = item.tipo !== 'tecnica'
  const ab = temFilhos && aberta(item.id)
  const n = uso[item.id] ?? 0
  return (
    <div className={`plat-no nivel-${nivel}` + (!item.ativa ? ' inativo' : '')}>
      <div className="plat-no-linha">
        {temFilhos ? <button type="button" className="plat-no-seta" onClick={() => alternar(item.id)} aria-label={ab ? 'Recolher' : 'Expandir'}>{ab ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button> : <span className="plat-no-seta vazio" />}
        {item.tipo !== 'tecnica' && (item.imagem_url ? <img className="plat-no-mini" src={item.imagem_url} alt="" /> : <span className="plat-no-mini vazia" />)}
        <button type="button" className="plat-no-nome" onClick={() => onEditar(item, pai)}>
          <strong>{item.nome}</strong>
          <small>{TIPO[item.tipo]}{item.duracao_sugerida ? ` · ${item.duracao_sugerida} min` : ''}{item.tipo === 'servico' && item.prioridade_sugestao ? ` · prioridade ${item.prioridade_sugestao}` : ''}{temFilhos ? ` · ${filhos(item).length} ${item.tipo === 'familia' ? 'serviços' : 'técnicas'}` : ''}{n ? ` · ${n} em salões` : ''}</small>
        </button>
        {item.tags?.includes('habilitacao') && <Pilula tom="ambar">habilitação</Pilula>}
        {!item.ativa && <Pilula tom="cinza">inativo</Pilula>}
        <div className="plat-no-acoes">
          {temFilhos && <button type="button" className="plat-link" onClick={() => onNovo(item)}><Plus size={13} /> {item.tipo === 'familia' ? 'Serviço' : 'Técnica'}</button>}
          <button type="button" className="plat-link" onClick={() => onEditar(item, pai)}><Pencil size={13} /></button>
          <button type="button" className="plat-link" onClick={() => onAtiva(item)} title={item.ativa ? 'Desativar' : 'Ativar'}>{item.ativa ? <X size={13} /> : <Check size={13} />}</button>
          <button type="button" className="plat-link perigo" onClick={() => onExcluir(item)} title="Excluir"><Trash2 size={13} /></button>
        </div>
      </div>
      {ab && (
        <div className="plat-no-filhos">
          {kids.map((k) => <No key={k.id} item={k} nivel={nivel + 1} pai={item} filhos={filhos} visivel={visivel} aberta={aberta} alternar={alternar} uso={uso} onEditar={onEditar} onNovo={onNovo} onAtiva={onAtiva} onExcluir={onExcluir} />)}
          {filhos(item).length === 0 && <p className="muted plat-no-vazio">Sem {item.tipo === 'familia' ? 'serviços' : 'técnicas'} ainda.</p>}
        </div>
      )}
    </div>
  )
}

// ---- imagem: redimensiona, sobe no bucket catalogo e devolve a URL pública ----
async function subirImagem(file, tipo) {
  const [largura, altura] = TAMANHO[tipo] ?? TAMANHO.servico
  const { blob } = await ajustarCriativo(file, { largura, altura })
  const path = `${tipo}s/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('catalogo').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: true })
  if (error) throw new Error('Não deu para subir a imagem: ' + error.message)
  return supabase.storage.from('catalogo').getPublicUrl(path).data.publicUrl
}
function tirarArquivo(url) {
  const path = String(url ?? '').split('/catalogo/')[1]
  if (path) supabase.storage.from('catalogo').remove([path]).catch(() => {})
}

function CampoImagem({ url, tipo, onMudar, rotulo }) {
  const [subindo, setSubindo] = useState(false)
  const [erro, setErro] = useState('')
  const [largura, altura] = TAMANHO[tipo] ?? TAMANHO.servico
  async function escolher(e) {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    setSubindo(true); setErro('')
    try { const nova = await subirImagem(f, tipo); if (url) tirarArquivo(url); onMudar(nova) } catch (err) { setErro(err.message) } finally { setSubindo(false) }
  }
  return (
    <div className="plat-cat-imagem">
      <span className="plat-cat-imagem-rotulo">{rotulo ?? 'Imagem'} <small className="muted">· {largura}×{altura}, cortada pelo centro</small></span>
      <div className="plat-cat-imagem-caixa">
        {url ? <img src={url} alt="" /> : <span className="muted">Sem imagem: o app usa o gradiente da marca{tipo === 'categoria' ? '' : ' ou a convenção de pastas'}.</span>}
      </div>
      <div className="plat-cat-imagem-acoes">
        <label className={'btn btn-ghost btn-mini' + (subindo ? ' desabilitado' : '')}>{subindo ? 'Enviando…' : url ? 'Trocar imagem' : 'Escolher imagem'}<input type="file" accept="image/*" hidden onChange={escolher} disabled={subindo} /></label>
        {url && <button type="button" className="btn btn-ghost btn-mini perigo" onClick={() => { tirarArquivo(url); onMudar(null) }}>Tirar</button>}
      </div>
      {erro && <small className="plat-cat-erro">{erro}</small>}
    </div>
  )
}

// ---- editor de categoria da plataforma ----
function EditorCategoria({ categoria, proximaOrdem, onFechar, onSalvo }) {
  const nova = !categoria
  const [v, setV] = useState(() => ({ nome: categoria?.nome ?? '', slug: categoria?.slug ?? '', descricao: categoria?.descricao ?? '', aliases: (categoria?.aliases ?? []).join(', '), ordem: categoria?.ordem ?? proximaOrdem, ativa: categoria?.ativa ?? true, imagem_url: categoria?.imagem_url ?? null }))
  const slugManual = useRef(Boolean(categoria?.slug))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const set = (k, x) => setV((a) => ({ ...a, [k]: x }))
  async function salvar(e) {
    e.preventDefault()
    const dados = { nome: v.nome.trim(), slug: slugDe(v.slug || v.nome), descricao: v.descricao.trim() || null, aliases: lista(v.aliases), ordem: Number(v.ordem) || 0, ativa: Boolean(v.ativa), imagem_url: v.imagem_url }
    if (!dados.nome) { setErro('Dê um nome.'); return }
    if (!dados.slug) { setErro('O slug ficou vazio.'); return }
    setSalvando(true); setErro('')
    const r = nova ? await supabase.from('categorias_de_servico').insert({ ...dados, salon_id: null }) : await supabase.from('categorias_de_servico').update(dados).eq('id', categoria.id)
    setSalvando(false)
    if (r.error) { setErro(erroHumano(r.error)); return }
    onSalvo()
  }
  return (
    <Portal><div className="modal-fundo plat-modal-fundo" onClick={onFechar}>
      <form className="modal-caixa plat-modal plat-cat-modal form" onClick={(e) => e.stopPropagation()} onSubmit={salvar}>
        <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">×</button>
        <h3><LayoutGrid size={18} /> {nova ? 'Nova categoria' : 'Editar categoria'}</h3>
        {!nova && <p className="muted plat-cat-dica">O id não muda: renomear preserva serviços, agendamentos e capas dos salões. Desativar esconde para quem está escolhendo; quem já usa continua usando.</p>}
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className="plat-cat-editor">
          <div className="plat-cat-campos">
            <label>Nome<input value={v.nome} maxLength={40} onChange={(e) => { set('nome', e.target.value); if (!slugManual.current) set('slug', slugDe(e.target.value)) }} autoFocus /></label>
            <label>Slug <small className="muted">(nome do arquivo de imagem e da busca; só minúsculas e hífens)</small><input value={v.slug} onChange={(e) => { slugManual.current = true; set('slug', e.target.value) }} className="mono" /></label>
            <label>Descrição curta <small className="muted">(aparece no cartão)</small><input value={v.descricao} maxLength={80} onChange={(e) => set('descricao', e.target.value)} placeholder="Corte, cor, escova, tratamentos e mais" /></label>
            <label>Aliases <small className="muted">(termos de busca, separados por vírgula)</small><textarea rows={2} value={v.aliases} onChange={(e) => set('aliases', e.target.value)} placeholder="cabeleireira, hair, salão de cabelo" /></label>
            <div className="plat-mel-tres">
              <span />
              <label>Ordem<input type="number" value={v.ordem} onChange={(e) => set('ordem', e.target.value)} /></label>
              <label className="plat-mel-check"><input type="checkbox" checked={!!v.ativa} onChange={(e) => set('ativa', e.target.checked)} /> Ativa</label>
            </div>
          </div>
          <CampoImagem url={v.imagem_url} tipo="categoria" onMudar={(u) => set('imagem_url', u)} rotulo="Imagem do cartão" />
        </div>
        <div className="modal-acoes">
          <button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </div></Portal>
  )
}

// ---- editor de família, serviço ou técnica ----
function EditorItem({ tipo, item, pai, caminhoPai = [], categoria, irmaos, uso, onFechar, onSalvo, onExcluir }) {
  const novo = !item
  const [v, setV] = useState(() => ({
    nome: item?.nome ?? '', slug: item?.slug ?? '', descricao: item?.descricao ?? '', aliases: (item?.aliases ?? []).join(', '), tags: (item?.tags ?? []).join(', '),
    duracao_sugerida: item?.duracao_sugerida ?? '', prioridade_sugestao: item?.prioridade_sugestao ?? 0, ordem: item?.ordem ?? ((irmaos ?? []).reduce((m, x) => Math.max(m, x.ordem), 0) + 10), ativa: item?.ativa ?? true, imagem_url: item?.imagem_url ?? null,
  }))
  const slugManual = useRef(Boolean(item?.slug))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const set = (k, x) => setV((a) => ({ ...a, [k]: x }))
  const caminho = [categoria?.nome, ...caminhoPai].filter(Boolean)
  async function salvar(e) {
    e.preventDefault()
    const dados = {
      tipo, categoria_id: categoria.id, pai_id: pai?.id ?? null, nome: v.nome.trim(), slug: slugDe(v.slug || v.nome), descricao: tipo === 'tecnica' ? null : (v.descricao.trim() || null),
      aliases: lista(v.aliases), tags: tipo === 'familia' ? [] : lista(v.tags).map((t) => slugDe(t).replace(/-/g, '_')),
      duracao_sugerida: tipo === 'familia' ? null : (Number(v.duracao_sugerida) || null), prioridade_sugestao: tipo === 'servico' ? (Number(v.prioridade_sugestao) || 0) : 0,
      ordem: Number(v.ordem) || 0, ativa: Boolean(v.ativa), imagem_url: tipo === 'tecnica' ? null : v.imagem_url,
    }
    if (!dados.nome) { setErro('Dê um nome.'); return }
    if (!dados.slug) { setErro('O slug ficou vazio.'); return }
    setSalvando(true); setErro('')
    const r = novo ? await supabase.from('catalogo_itens').insert(dados) : await supabase.from('catalogo_itens').update(dados).eq('id', item.id)
    setSalvando(false)
    if (r.error) { setErro(erroHumano(r.error)); return }
    onSalvo()
  }
  return (
    <Portal><div className="modal-fundo plat-modal-fundo" onClick={onFechar}>
      <form className="modal-caixa plat-modal plat-cat-modal form" onClick={(e) => e.stopPropagation()} onSubmit={salvar}>
        <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">×</button>
        <h3><Sparkles size={18} /> {novo ? `Nov${tipo === 'servico' ? 'o' : 'a'} ${TIPO[tipo].toLowerCase()}` : `Editar ${TIPO[tipo].toLowerCase()}`}</h3>
        <p className="muted plat-cat-dica plat-cat-caminho">{caminho.join(' › ')}{caminho.length ? ' › ' : ''}<strong>{v.nome || '…'}</strong>{uso > 0 && <span> · usado por {uso} {uso === 1 ? 'serviço de salão' : 'serviços de salão'}</span>}</p>
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className={'plat-cat-editor' + (tipo === 'tecnica' ? ' sem-imagem' : '')}>
          <div className="plat-cat-campos">
            <label>Nome<input value={v.nome} maxLength={80} onChange={(e) => { set('nome', e.target.value); if (!slugManual.current) set('slug', slugDe(e.target.value)) }} autoFocus /></label>
            <label>Slug <small className="muted">(único no mesmo pai; vira o nome do arquivo de imagem)</small><input value={v.slug} onChange={(e) => { slugManual.current = true; set('slug', e.target.value) }} className="mono" /></label>
            {tipo !== 'tecnica' && <label>Descrição <small className="muted">(opcional)</small><input value={v.descricao} maxLength={120} onChange={(e) => set('descricao', e.target.value)} /></label>}
            <label>Aliases <small className="muted">(como as pessoas chamam; separados por vírgula; não precisam ser únicos)</small><textarea rows={2} value={v.aliases} onChange={(e) => set('aliases', e.target.value)} placeholder="luzes, balaiagem, ombré" /></label>
            {tipo !== 'familia' && <label>Tags <small className="muted">(facetas; “habilitacao” tira das sugestões; variavel_por_comprimento, variavel_por_volume, variavel_por_tecnica, combo, noivas…)</small><input value={v.tags} onChange={(e) => set('tags', e.target.value)} placeholder="cor, loiro, variavel_por_comprimento" /></label>}
            <div className="plat-cat-numeros">
              {tipo !== 'familia' && <label>Duração sugerida (min) <small className="muted">{tipo === 'tecnica' ? '(vazio herda do serviço)' : ''}</small><input type="number" min="0" step="5" value={v.duracao_sugerida} onChange={(e) => set('duracao_sugerida', e.target.value)} /></label>}
              {tipo === 'servico' && <label>Prioridade de sugestão <small className="muted">(maior aparece antes; 0 só em “Ver todos”)</small><input type="number" min="0" value={v.prioridade_sugestao} onChange={(e) => set('prioridade_sugestao', e.target.value)} /></label>}
              <label>Ordem<input type="number" value={v.ordem} onChange={(e) => set('ordem', e.target.value)} /></label>
              <label className="plat-mel-check"><input type="checkbox" checked={!!v.ativa} onChange={(e) => set('ativa', e.target.checked)} /> Ativa <small className="muted">(inativa esconde os filhos sem mexer neles)</small></label>
            </div>
          </div>
          {tipo !== 'tecnica' && <CampoImagem url={v.imagem_url} tipo={tipo} onMudar={(u) => set('imagem_url', u)} />}
        </div>
        <div className="modal-acoes">
          {onExcluir && <button type="button" className="btn btn-ghost perigo plat-cat-excluir" onClick={onExcluir}><Trash2 size={14} /> Excluir</button>}
          <button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </div></Portal>
  )
}
