import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useDialogo } from '../context/DialogoContext'
import { ajustarCriativo, CRIATIVO } from '../lib/imagem'
import { formatPreco } from '../lib/format'
import { useCategorias, categoriasDoSalao } from '../lib/categorias'
import { BadgePercent, Eye, MousePointerClick, ImagePlus, Pause, Play, Pencil, Trash2, Check, X, Hourglass } from 'lucide-react'
import Portal from './Portal'

// Promoções (083): o mesmo painel serve o salão, a profissional e a
// plataforma. Muda só o "dono" da promoção:
//   escopo 'salao'        → salon_id = salao, professional_id nulo
//   escopo 'profissional' → professional_id = prof (o banco põe o salão)
//   escopo 'plataforma'   → sem salão: todo mundo vê
// O criativo é ajustado no navegador para 1200×600 antes de subir.

const VAZIO = { titulo: '', texto: '', service_id: '', inicio: '', fim: '', ativa: true, com_desconto: false, desconto_pct: '' }
const NOVO_SERVICO = '__novo__'
const SERVICO_VAZIO = { name: '', duration_minutes: 60, price: '', categoria_id: '' }

// aprovacao (086): a promoção da profissional de um salão nasce 'pendente'
// e a dona aprova ou recusa. dona=true quando quem usa o painel
// administra o salão (autônoma inclusive): a dela já nasce aprovada.
export default function Promocoes({ escopo, salao, prof, servicos = [], compacto = false, onServicoNovo, dona = escopo !== 'profissional' }) {
  const { confirmar } = useDialogo()
  const cats = categoriasDoSalao(useCategorias(), salao)
  const [novoServico, setNovoServico] = useState(SERVICO_VAZIO)   // cadastrar um serviço na hora
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
      setForm({ titulo: p.titulo, texto: p.texto ?? '', service_id: p.service_id ?? '', inicio: p.inicio ?? '', fim: p.fim ?? '', ativa: p.ativa, com_desconto: p.desconto_pct != null, desconto_pct: p.desconto_pct ?? '' })
      setImagem({ url: p.imagem_url })
      setEditando(p.id)
    } else {
      setForm({ ...VAZIO, inicio: hojeIso() })
      setNovoServico(SERVICO_VAZIO)
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
    const pct = form.com_desconto ? Number(form.desconto_pct) : null
    if (form.com_desconto && (!form.service_id || Number.isNaN(pct) || pct < 1 || pct > 90)) { setErro('Para dar desconto, escolha o serviço e diga a porcentagem (de 1 a 90).'); return }
    if (form.service_id === NOVO_SERVICO && !novoServico.name.trim()) { setErro('Dá um nome ao serviço novo.'); return }
    setSalvando(true)
    setErro('')
    try {
      // o serviço cadastrado ali na hora (fica do salão; a profissional já sai fazendo)
      let servicoId = form.service_id || null
      if (form.service_id === NOVO_SERVICO) {
        const { data: sv, error: es } = await supabase.from('services').insert({
          salon_id: salao, name: novoServico.name.trim(), duration_minutes: Number(novoServico.duration_minutes) || 60,
          price: Number(String(novoServico.price).replace(',', '.')) || 0, categoria_id: novoServico.categoria_id || null,
        }).select('id, name').maybeSingle()
        if (es) throw new Error('Não deu para cadastrar o serviço: ' + es.message)
        servicoId = sv?.id ?? null
        if (servicoId && escopo === 'profissional') await supabase.from('professional_services').insert({ professional_id: prof, service_id: servicoId })
        if (sv) onServicoNovo?.(sv)
      }
      let url = imagem.url
      if (imagem.blob) {
        const path = `${escopo}/${crypto.randomUUID()}.jpg`
        const { error: eu } = await supabase.storage.from('promocoes').upload(path, imagem.blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
        if (eu) throw new Error('Não deu para subir a imagem: ' + eu.message)
        url = supabase.storage.from('promocoes').getPublicUrl(path).data.publicUrl
      }
      const payload = {
        titulo: form.titulo.trim(), texto: form.texto.trim() || null, imagem_url: url,
        service_id: servicoId, desconto_pct: form.com_desconto && servicoId ? pct : null,
        inicio: form.inicio || hojeIso(), fim: form.fim || null, ativa: form.ativa,
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
  const estado = (p) => (p.aprovacao === 'pendente' ? 'aguardando' : p.aprovacao === 'recusada' ? 'recusada' : !p.ativa ? 'pausada' : p.fim && p.fim < hoje ? 'encerrada' : p.inicio > hoje ? 'agendada' : 'no ar')

  return (
    <div className="promos">
      {erro && editando === null && <div className="alert alert-error">{erro}</div>}

      <div className="promos-topo">
        <p className="muted">
          {escopo === 'plataforma' ? 'Aparece para todas as clientes do MIMO.'
            : escopo === 'profissional' ? (dona ? 'Aparece para as clientes que já marcaram com você, te favoritaram ou entraram pelo seu código.' : 'Vale só para as suas clientes. Cada promoção passa pela aprovação da dona do salão antes de entrar no ar.')
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
                  <strong>{p.titulo}{p.desconto_pct != null && <span className="badge badge-promo">-{p.desconto_pct}%</span>}</strong>
                  {p.texto && <span className="muted">{p.texto}</span>}
                  <span className="muted promo-meta">
                    {periodo(p)}{p.service_id && servicos.find((s) => s.id === p.service_id) ? ` · ${servicos.find((s) => s.id === p.service_id).name}${p.desconto_pct != null ? ` com ${p.desconto_pct}% off` : ''}` : ''}
                  </span>
                  <span className="promo-numeros"><Eye size={13} /> {p.vistas} <MousePointerClick size={13} /> {p.cliques}</span>
                  {p.aprovacao === 'pendente' && escopo === 'profissional' && <span className="promo-aviso aguardando"><Hourglass size={13} /> Aguardando a dona do salão aprovar.</span>}
                  {p.aprovacao === 'recusada' && escopo === 'profissional' && <span className="promo-aviso recusada"><X size={13} /> Não aprovada{p.motivo_recusa ? `: ${p.motivo_recusa}` : ''}. Edite e salve para enviar de novo.</span>}
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
        <Portal><div className="modal-fundo" onClick={fechar}>
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
            {escopo !== 'plataforma' && (
              <>
                <label>Serviço promovido
                  <select value={form.service_id} onChange={(e) => setForm({ ...form, service_id: e.target.value, com_desconto: e.target.value ? form.com_desconto : false })}>
                    <option value="">Nenhum: só mostrar a promoção</option>
                    {servicos.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_combo ? ' (combo)' : ''}{s.price != null ? ` · ${formatPreco(s.price)}` : ''}</option>)}
                    <option value={NOVO_SERVICO}>+ Cadastrar um serviço novo…</option>
                  </select>
                </label>
                {form.service_id === NOVO_SERVICO && (
                  <div className="promo-servico-novo">
                    <label>Nome do serviço<input value={novoServico.name} onChange={(e) => setNovoServico({ ...novoServico, name: e.target.value })} placeholder="Ex.: Escova modelada" /></label>
                    <div className="form-row">
                      <label>Duração (min)<input type="number" min="5" step="5" value={novoServico.duration_minutes} onChange={(e) => setNovoServico({ ...novoServico, duration_minutes: e.target.value })} /></label>
                      <label>Preço (R$)<input inputMode="decimal" value={novoServico.price} onChange={(e) => setNovoServico({ ...novoServico, price: e.target.value })} placeholder="80" /></label>
                    </div>
                    <label>Categoria
                      <select value={novoServico.categoria_id} onChange={(e) => setNovoServico({ ...novoServico, categoria_id: e.target.value })}>
                        <option value="">Deixar o app escolher pelo nome</option>
                        {cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                    </label>
                    <p className="muted promo-dica">Entra na lista de serviços {escopo === 'profissional' ? 'do salão, já marcado como seu' : 'do salão'}. Depois dá para ajustar em Serviços.</p>
                  </div>
                )}
                {form.service_id && (
                  <div className="combo-toggle">
                    <label className="switch"><input type="checkbox" checked={form.com_desconto} onChange={(e) => setForm({ ...form, com_desconto: e.target.checked })} /><span></span></label>
                    <div className="combo-toggle-texto"><span>A promoção dá desconto</span><span className="muted">Aplicado no preço deste serviço na finalização, só para quem vê a promoção</span></div>
                  </div>
                )}
                {form.service_id && form.com_desconto && (
                  <label className="promo-pct">Desconto (%)
                    <div className="promo-pct-linha">
                      <input type="number" min="1" max="90" step="1" inputMode="numeric" value={form.desconto_pct} onChange={(e) => setForm({ ...form, desconto_pct: e.target.value })} placeholder="20" required />
                      {previaPreco(form, servicos, novoServico)}
                    </div>
                  </label>
                )}
                <p className="muted promo-dica">Ao tocar no banner, a cliente vai direto marcar {form.service_id ? 'este serviço' : '(escolha um serviço acima para isso)'}.</p>
              </>
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
        </div></Portal>
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

function previaPreco(form, servicos, novo) {
  const pct = Number(form.desconto_pct)
  const preco = form.service_id === NOVO_SERVICO ? Number(String(novo.price).replace(',', '.')) : Number(servicos.find((s) => s.id === form.service_id)?.price)
  if (!pct || pct < 1 || pct > 90 || !preco) return null
  return <span className="muted promo-pct-previa">de {formatPreco(preco)} por <strong>{formatPreco(preco * (100 - pct) / 100)}</strong></span>
}
