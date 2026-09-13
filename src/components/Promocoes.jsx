import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useDialogo } from '../context/DialogoContext'
import { ajustarCriativo, CRIATIVO } from '../lib/imagem'
import { BadgePercent, Eye, MousePointerClick, ImagePlus, Pause, Play, Pencil, Trash2 } from 'lucide-react'

// Promoções (083): o mesmo painel serve o salão, a profissional e a
// plataforma. Muda só o "dono" da promoção:
//   escopo 'salao'        → salon_id = salao, professional_id nulo
//   escopo 'profissional' → professional_id = prof (o banco põe o salão)
//   escopo 'plataforma'   → sem salão: todo mundo vê
// O criativo é ajustado no navegador para 1200×600 antes de subir.

const VAZIO = { titulo: '', texto: '', service_id: '', inicio: '', fim: '', ativa: true }

export default function Promocoes({ escopo, salao, prof, servicos = [], compacto = false }) {
  const { confirmar } = useDialogo()
  const [lista, setLista] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [editando, setEditando] = useState(null)      // null | 'nova' | id
  const [form, setForm] = useState(VAZIO)
  const [imagem, setImagem] = useState(null)           // { blob, preview, cortou } | { url }
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    let q = supabase.from('promocoes').select('*').order('created_at', { ascending: false })
    if (escopo === 'plataforma') q = q.is('salon_id', null)
    else if (escopo === 'profissional') q = q.eq('professional_id', prof)
    else q = q.eq('salon_id', salao).is('professional_id', null)
    const { data, error } = await q
    if (error) setErro(error.message)
    setLista(data ?? [])
    setLoading(false)
  }, [escopo, salao, prof])
  useEffect(() => { carregar() }, [carregar])

  function abrir(p) {
    if (p) {
      setForm({ titulo: p.titulo, texto: p.texto ?? '', service_id: p.service_id ?? '', inicio: p.inicio ?? '', fim: p.fim ?? '', ativa: p.ativa })
      setImagem({ url: p.imagem_url })
      setEditando(p.id)
    } else {
      setForm({ ...VAZIO, inicio: hojeIso() })
      setImagem(null)
      setEditando('nova')
    }
    setErro('')
  }
  function fechar() {
    if (imagem?.preview) URL.revokeObjectURL(imagem.preview)
    setEditando(null)
    setImagem(null)
  }

  async function escolherImagem(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErro('')
    try {
      const r = await ajustarCriativo(file)
      if (imagem?.preview) URL.revokeObjectURL(imagem.preview)
      setImagem(r)
    } catch (err) { setErro(err.message) }
  }

  async function salvar(e) {
    e.preventDefault()
    if (!form.titulo.trim()) { setErro('Dá um título para a promoção.'); return }
    if (!imagem) { setErro('Escolha o criativo (a imagem da promoção).'); return }
    setSalvando(true)
    setErro('')
    try {
      let url = imagem.url
      if (imagem.blob) {
        const path = `${escopo}/${crypto.randomUUID()}.jpg`
        const { error: eu } = await supabase.storage.from('promocoes').upload(path, imagem.blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
        if (eu) throw new Error('Não deu para subir a imagem: ' + eu.message)
        url = supabase.storage.from('promocoes').getPublicUrl(path).data.publicUrl
      }
      const payload = {
        titulo: form.titulo.trim(), texto: form.texto.trim() || null, imagem_url: url,
        service_id: form.service_id || null, inicio: form.inicio || hojeIso(), fim: form.fim || null, ativa: form.ativa,
        ...(escopo === 'plataforma' ? { salon_id: null, professional_id: null }
          : escopo === 'profissional' ? { professional_id: prof }
          : { salon_id: salao, professional_id: null }),
      }
      const { error } = editando === 'nova'
        ? await supabase.from('promocoes').insert(payload)
        : await supabase.from('promocoes').update(payload).eq('id', editando)
      if (error) throw new Error(error.message)
      fechar()
      carregar()
    } catch (err) { setErro(err.message) } finally { setSalvando(false) }
  }

  async function pausar(p) {
    const { error } = await supabase.from('promocoes').update({ ativa: !p.ativa }).eq('id', p.id)
    if (error) setErro(error.message); else carregar()
  }
  async function apagar(p) {
    if (!(await confirmar({ titulo: `Apagar "${p.titulo}"?`, texto: 'Some do app na hora. Não dá para desfazer.', ok: 'Apagar', perigo: true }))) return
    const { error } = await supabase.from('promocoes').delete().eq('id', p.id)
    if (error) { setErro(error.message); return }
    const path = p.imagem_url?.split('/promocoes/')[1]
    if (path) await supabase.storage.from('promocoes').remove([path])
    carregar()
  }

  const hoje = hojeIso()
  const estado = (p) => (!p.ativa ? 'pausada' : p.fim && p.fim < hoje ? 'encerrada' : p.inicio > hoje ? 'agendada' : 'no ar')

  return (
    <div className="promos">
      {erro && editando === null && <div className="alert alert-error">{erro}</div>}

      <div className="promos-topo">
        <p className="muted">
          {escopo === 'plataforma' ? 'Aparece para todas as clientes do MIMO.'
            : escopo === 'profissional' ? 'Aparece para as clientes que já marcaram com você, te favoritaram ou entraram pelo seu código.'
            : 'Aparece para as clientes da carteira do salão: quem tem vínculo com a casa ou já marcou com alguém da equipe.'}
        </p>
        <button className="btn btn-primary" onClick={() => abrir(null)}><BadgePercent size={16} /> Nova promoção</button>
      </div>

      {loading ? <p className="muted">Carregando…</p> : lista.length === 0 ? (
        <div className="card empty-state">
          <p>Nenhuma promoção ainda.</p>
          <p className="muted">Suba um criativo de {CRIATIVO.largura}×{CRIATIVO.altura} e ele aparece na home das suas clientes.</p>
        </div>
      ) : (
        <div className={'promos-lista' + (compacto ? ' compacta' : '')}>
          {lista.map((p) => {
            const st = estado(p)
            return (
              <article key={p.id} className={'card promo-cartao ' + st.replace(' ', '-')}>
                <div className="promo-figura"><img src={p.imagem_url} alt="" loading="lazy" /><span className={'badge promo-estado ' + st.replace(' ', '-')}>{st}</span></div>
                <div className="promo-corpo">
                  <strong>{p.titulo}</strong>
                  {p.texto && <span className="muted">{p.texto}</span>}
                  <span className="muted promo-meta">
                    {periodo(p)}{p.service_id && servicos.find((s) => s.id === p.service_id) ? ` · toca e marca ${servicos.find((s) => s.id === p.service_id).name}` : ''}
                  </span>
                  <span className="promo-numeros"><Eye size={13} /> {p.vistas} <MousePointerClick size={13} /> {p.cliques}</span>
                </div>
                <div className="promo-acoes">
                  <button type="button" className="icon-btn" onClick={() => pausar(p)} aria-label={p.ativa ? 'Pausar' : 'Reativar'} title={p.ativa ? 'Pausar' : 'Reativar'}>{p.ativa ? <Pause size={16} /> : <Play size={16} />}</button>
                  <button type="button" className="icon-btn" onClick={() => abrir(p)} aria-label="Editar" title="Editar"><Pencil size={16} /></button>
                  <button type="button" className="icon-btn perigo" onClick={() => apagar(p)} aria-label="Apagar" title="Apagar"><Trash2 size={16} /></button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {editando !== null && (
        <div className="modal-fundo" onClick={fechar}>
          <form className="card modal-caixa modal-form form promo-form" onSubmit={salvar} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <button type="button" className="modal-fechar" onClick={fechar} aria-label="Fechar">×</button>
            <h3>{editando === 'nova' ? 'Nova promoção' : 'Editar promoção'}</h3>
            {erro && <div className="alert alert-error">{erro}</div>}

            <div className="promo-criativo">
              <span className="img-field-label">Criativo</span>
              <label className={'promo-drop' + (imagem ? ' com-imagem' : '')}>
                {imagem ? <img src={imagem.preview ?? imagem.url} alt="Prévia do criativo" /> : (
                  <span className="promo-drop-vazio"><ImagePlus size={28} /><strong>Escolher imagem</strong><span className="muted">JPG, PNG ou WebP</span></span>
                )}
                <input type="file" accept="image/*" onChange={escolherImagem} hidden />
              </label>
              <p className="muted promo-dica">
                Tamanho recomendado: <strong>{CRIATIVO.largura}×{CRIATIVO.altura}</strong> (2:1), até {CRIATIVO.maxMb} MB.
                {imagem?.cortou ? ' A sua tinha outra proporção: ajustamos e cortamos pelo centro. Confira a prévia.' : ' Se vier em outra proporção, a gente ajusta e corta pelo centro.'}
                {imagem && <> <button type="button" className="link-ver" onClick={(e) => e.currentTarget.closest('.promo-criativo').querySelector('input[type=file]').click()}>Trocar</button></>}
              </p>
            </div>

            <label>Título<input value={form.titulo} maxLength={60} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ex.: Semana da sobrancelha" required /></label>
            <label>Texto curto (opcional)<input value={form.texto} maxLength={140} onChange={(e) => setForm({ ...form, texto: e.target.value })} placeholder="Ex.: 20% off até sexta" /></label>
            {escopo !== 'plataforma' && servicos.length > 0 && (
              <label>Ao tocar, marcar (opcional)
                <select value={form.service_id} onChange={(e) => setForm({ ...form, service_id: e.target.value })}>
                  <option value="">Só mostrar a promoção</option>
                  {servicos.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
            <div className="form-row">
              <label>Começa<input type="date" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} /></label>
              <label>Termina (opcional)<input type="date" value={form.fim} min={form.inicio || undefined} onChange={(e) => setForm({ ...form, fim: e.target.value })} /></label>
            </div>
            <div className="combo-toggle">
              <label className="switch"><input type="checkbox" checked={form.ativa} onChange={(e) => setForm({ ...form, ativa: e.target.checked })} /><span></span></label>
              <div className="combo-toggle-texto"><span>No ar</span><span className="muted">Desligue para guardar sem mostrar</span></div>
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={fechar}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function hojeIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function br(iso) { const [a, m, d] = iso.split('-'); return `${d}/${m}${a !== String(new Date().getFullYear()) ? '/' + a : ''}` }
function periodo(p) {
  if (p.fim) return `${br(p.inicio)} a ${br(p.fim)}`
  return `desde ${br(p.inicio)}, sem data para acabar`
}
