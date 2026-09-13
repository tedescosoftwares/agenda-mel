import { useEffect, useState } from 'react'
import { useDialogo } from '../../context/DialogoContext'
import AdminShell from '../../components/AdminShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { ChevronIcon, SparkleIcon } from '../../components/icons'
import { formatPreco, formatDuracao, labelDuracao } from '../../lib/format'
import { useCategorias, categoriasDoSalao, agruparPorCategoria, bate } from '../../lib/categorias'

const FORM_VAZIO = {
  name: '',
  description: '',
  duration_minutes: 60,
  price: '',
  is_combo: false,
  categoria_id: '',   // vazio = o app chuta pelo nome
}
const NOVA = '__nova__'

const MAX_IMAGENS = 3
const MAX_TAMANHO_MB = 5

export default function AdminServices() {
  const { confirmar } = useDialogo()
  const { salao } = useAuth()
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // null | 'new' | id do serviço
  const [form, setForm] = useState(FORM_VAZIO)
  // cada item: { url } (já salva) ou { file, preview } (nova)
  const [imagens, setImagens] = useState([])
  const [comboIds, setComboIds] = useState([])
  // "costuma ir junto": o que sugerir quando a cliente marca este serviço,
  // inclusive com outra profissional do salão (081)
  const [juntos, setJuntos] = useState([])
  const [juntosTodos, setJuntosTodos] = useState([])   // linhas de servicos_juntos do salão
  const [saving, setSaving] = useState(false)
  // categorias (082): as da plataforma e as do salão
  const catsTodas = useCategorias()
  const [catsExtra, setCatsExtra] = useState([])       // criadas/renomeadas nesta tela
  const [novaCat, setNovaCat] = useState('')
  const [buscaPicker, setBuscaPicker] = useState('')
  const [gerindo, setGerindo] = useState(false)
  const [catEdit, setCatEdit] = useState(null)         // { id, nome }
  const cats = categoriasDoSalao([...catsTodas.filter((c) => !catsExtra.some((e) => e.id === c.id)), ...catsExtra].filter((c) => !c.apagada), salao?.id)

  useEffect(() => {
    fetchServices()
  }, [])

  async function fetchServices() {
    setLoading(true)
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .order('name')
    if (error) {
      setError('Erro ao carregar serviços: ' + error.message)
    } else {
      setServices(data)
      setError('')
      const ids = data.map((s) => s.id)
      const { data: j } = ids.length ? await supabase.from('servicos_juntos').select('service_id, sugerido_id').in('service_id', ids) : { data: [] }
      setJuntosTodos(j ?? [])
    }
    setLoading(false)
  }

  function startNew() {
    setForm(FORM_VAZIO)
    setImagens([])
    setComboIds([])
    setJuntos([])
    setEditing('new')
    setError('')
  }

  function startEdit(service) {
    setForm({
      name: service.name,
      description: service.description ?? '',
      duration_minutes: service.duration_minutes,
      price: String(service.price),
      is_combo: Boolean(service.is_combo),
      categoria_id: service.categoria_id ?? '',
    })
    setImagens((service.images ?? []).map((url) => ({ url })))
    setComboIds(service.combo_service_ids ?? [])
    setJuntos(juntosTodos.filter((j) => j.service_id === service.id).map((j) => j.sugerido_id))
    setEditing(service.id)
    setError('')
  }

  function cancelEdit() {
    imagens.forEach((img) => img.preview && URL.revokeObjectURL(img.preview))
    setEditing(null)
    setForm(FORM_VAZIO)
    setImagens([])
    setComboIds([])
    setJuntos([])
  }

  // cria a categoria do salão na hora, dentro do formulário do serviço
  async function criarCategoria() {
    const nome = novaCat.trim()
    if (!nome) return
    const { data, error } = await supabase.from('categorias_de_servico').insert({ salon_id: salao?.id, nome, ordem: 500 }).select('id, salon_id, nome, ordem').maybeSingle()
    if (error) { setError(error.message.includes('duplicate') ? 'Já existe uma categoria com esse nome.' : 'Não deu para criar a categoria: ' + error.message); return }
    const criada = data ?? { id: crypto.randomUUID(), salon_id: salao?.id, nome, ordem: 500 }
    setCatsExtra((l) => [...l, criada])
    setForm((f) => ({ ...f, categoria_id: criada.id }))
    setNovaCat('')
  }
  async function renomearCategoria() {
    const nome = catEdit?.nome?.trim()
    if (!catEdit || !nome) return
    const { error } = await supabase.from('categorias_de_servico').update({ nome }).eq('id', catEdit.id)
    if (error) { setError(error.message.includes('duplicate') ? 'Já existe uma categoria com esse nome.' : error.message); return }
    const base = cats.find((c) => c.id === catEdit.id)
    setCatsExtra((l) => [...l.filter((c) => c.id !== catEdit.id), { ...base, nome }])
    setCatEdit(null)
  }
  async function apagarCategoria(c) {
    const quantos = services.filter((s) => s.categoria_id === c.id).length
    const ok = await confirmar({ titulo: `Apagar "${c.nome}"?`, texto: quantos ? `${quantos} ${quantos === 1 ? 'serviço volta' : 'serviços voltam'} para a categoria sugerida pelo nome.` : 'Nenhum serviço usa essa categoria.', ok: 'Apagar', perigo: true })
    if (!ok) return
    const { error } = await supabase.from('categorias_de_servico').delete().eq('id', c.id)
    if (error) { setError(error.message); return }
    setCatsExtra((l) => [...l.filter((x) => x.id !== c.id), { ...c, apagada: true }])
    fetchServices()
  }

  function toggleJunto(id) {
    setJuntos((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  const candidatosJuntos = services.filter((s) => s.active && s.id !== editing)

  function toggleComboId(id) {
    setComboIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  // serviços que podem entrar num combo: não-combos, exceto o próprio
  const candidatosCombo = services.filter(
    (s) => !s.is_combo && s.id !== editing,
  )

  const somaCombo = comboIds.reduce((soma, id) => {
    const s = services.find((x) => x.id === id)
    return soma + (s ? s.duration_minutes : 0)
  }, 0)

  function handleAddImagens(e) {
    const files = Array.from(e.target.files)
    e.target.value = ''
    setError('')

    const espaco = MAX_IMAGENS - imagens.length
    if (files.length > espaco) {
      setError(`Cada serviço pode ter no máximo ${MAX_IMAGENS} imagens.`)
    }

    const novas = []
    for (const file of files.slice(0, espaco)) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > MAX_TAMANHO_MB * 1024 * 1024) {
        setError(`Imagem muito grande (máx. ${MAX_TAMANHO_MB} MB): ${file.name}`)
        continue
      }
      novas.push({ file, preview: URL.createObjectURL(file) })
    }
    if (novas.length) setImagens((prev) => [...prev, ...novas])
  }

  function removeImagem(index) {
    setImagens((prev) => {
      const img = prev[index]
      if (img?.preview) URL.revokeObjectURL(img.preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  async function uploadImagens() {
    const urls = []
    for (const img of imagens) {
      if (img.url) {
        urls.push(img.url)
        continue
      }
      const ext = (img.file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage
        .from('service-images')
        .upload(path, img.file, { contentType: img.file.type })
      if (error) {
        throw new Error('Erro ao enviar imagem: ' + error.message)
      }
      const { data } = supabase.storage.from('service-images').getPublicUrl(path)
      urls.push(data.publicUrl)
    }
    return urls
  }

  // Remove do Storage as imagens que saíram do serviço (melhor esforço)
  async function limparImagensRemovidas(antigas, atuais) {
    const removidas = (antigas ?? []).filter((url) => !atuais.includes(url))
    const paths = removidas
      .map((url) => url.split('/service-images/')[1])
      .filter(Boolean)
    if (paths.length) {
      await supabase.storage.from('service-images').remove(paths)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    const price = Number(String(form.price).replace(',', '.'))
    if (!form.name.trim()) {
      setError('Informe o nome do serviço.')
      return
    }
    if (Number.isNaN(price) || price < 0) {
      setError('Preço inválido.')
      return
    }
    if (form.is_combo && comboIds.length < 2) {
      setError('Um combo precisa de pelo menos 2 serviços.')
      return
    }

    setSaving(true)
    try {
      const images = await uploadImagens()

      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        duration_minutes: form.is_combo ? somaCombo : Number(form.duration_minutes),
        price,
        images,
        is_combo: form.is_combo,
        combo_service_ids: form.is_combo ? comboIds : [],
        categoria_id: form.categoria_id || null,
      }

      const antigas =
        editing !== 'new'
          ? services.find((s) => s.id === editing)?.images
          : []

      const query =
        editing === 'new'
          ? supabase.from('services').insert({ ...payload, salon_id: salao?.id }).select('id').maybeSingle()
          : supabase.from('services').update(payload).eq('id', editing).select('id').maybeSingle()

      const { data: salvo, error } = await query
      if (error) {
        setError('Erro ao salvar: ' + error.message)
        return
      }
      const idSalvo = salvo?.id ?? (editing !== 'new' ? editing : null)
      const antesJuntos = juntosTodos.filter((j) => j.service_id === idSalvo).map((j) => j.sugerido_id)
      if (idSalvo && (juntos.length || antesJuntos.length)) {
        const { error: ej } = await supabase.rpc('salvar_servicos_juntos', { servico: idSalvo, sugeridos: juntos })
        if (ej) { setError('Serviço salvo, mas não deu para guardar o "costuma ir junto": ' + ej.message); return }
      }

      await limparImagensRemovidas(antigas, images)
      cancelEdit()
      fetchServices()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(service) {
    const { error } = await supabase
      .from('services')
      .update({ active: !service.active })
      .eq('id', service.id)
    if (error) {
      setError('Erro ao atualizar: ' + error.message)
    } else {
      fetchServices()
    }
  }

  async function handleDelete() {
    const service = services.find((s) => s.id === editing)
    if (!service) return
    const ok = await confirmar({
      titulo: `Excluir "${service.name}"?`,
      texto: 'Essa ação não pode ser desfeita.',
      ok: 'Excluir', perigo: true,
    })
    if (!ok) return
    const { error } = await supabase.from('services').delete().eq('id', service.id)
    if (error) {
      setError('Erro ao excluir: ' + error.message)
    } else {
      await limparImagensRemovidas(service.images, [])
      cancelEdit()
      fetchServices()
    }
  }

  const ativos = services.filter((s) => s.active).length

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <h2>Serviços</h2>
          <p className="muted">
            {services.length} {services.length === 1 ? 'cadastrado' : 'cadastrados'}
            {services.length > 0 ? ` · ${ativos} ${ativos === 1 ? 'ativo' : 'ativos'}` : ''}
          </p>
        </div>
      </div>

      {error && editing === null && <div className="alert alert-error">{error}</div>}

      {editing !== null && (
        <div className="modal-fundo" onClick={cancelEdit}>
        <form className="card modal-caixa modal-form form service-form" onSubmit={handleSave} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={editing === 'new' ? 'Novo serviço' : 'Editar serviço'}>
          <button type="button" className="modal-fechar" onClick={cancelEdit} aria-label="Fechar">×</button>
          <h3>{editing === 'new' ? 'Novo serviço' : 'Editar serviço'}</h3>
          {error && <div className="alert alert-error">{error}</div>}

          <label>
            Nome
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex.: Limpeza de pele"
              required
            />
          </label>

          <label>
            Descrição (opcional)
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Detalhes do serviço…"
              rows={2}
            />
          </label>

          <label>
            Categoria
            <select
              value={form.categoria_id}
              onChange={(e) => setForm({ ...form, categoria_id: e.target.value === NOVA ? '' : e.target.value })}
            >
              <option value="">Deixar o app escolher pelo nome</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}{c.salon_id ? ' · do salão' : ''}</option>
              ))}
            </select>
          </label>
          <div className="cat-nova">
            <input
              value={novaCat}
              onChange={(e) => setNovaCat(e.target.value)}
              placeholder="Nova categoria do salão (ex.: Noivas)"
              maxLength={40}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); criarCategoria() } }}
            />
            <button type="button" className="btn btn-ghost btn-mini" onClick={criarCategoria} disabled={!novaCat.trim()}>+ Criar</button>
          </div>

          <div className="combo-toggle">
            <label className="switch">
              <input
                type="checkbox"
                checked={form.is_combo}
                onChange={(e) => setForm({ ...form, is_combo: e.target.checked })}
              />
              <span></span>
            </label>
            <div className="combo-toggle-texto">
              <span>Combo de serviços</span>
              <span className="muted">
                Junta serviços num pacote — a duração é a soma e aparece para
                a cliente como tempo médio
              </span>
            </div>
          </div>

          {form.is_combo && (
            <div className="combo-picker">
              <span className="img-field-label">Serviços do combo</span>
              {candidatosCombo.length < 2 ? (
                <p className="muted combo-aviso">
                  Cadastre pelo menos 2 serviços comuns antes de criar um combo.
                </p>
              ) : (
                <ListaPorCategoria
                  itens={candidatosCombo}
                  cats={cats}
                  marcados={comboIds}
                  onToggle={toggleComboId}
                  busca={buscaPicker}
                  setBusca={setBuscaPicker}
                />
              )}
              {comboIds.length > 0 && (
                <p className="muted combo-soma">
                  Duração somada: <strong>{formatDuracao(somaCombo)}</strong> —
                  exibida como tempo médio ~{formatDuracao(somaCombo)}
                </p>
              )}
            </div>
          )}

          {candidatosJuntos.length > 0 && (
            <div className="combo-picker juntos-picker">
              <span className="img-field-label">Costuma ir junto</span>
              <p className="muted combo-aviso">
                Quando a cliente marcar este serviço, o app oferece estes na
                sequência, inclusive com outra profissional do salão. Não é
                combo: cada um continua com o próprio preço e a própria agenda.
              </p>
              <ListaPorCategoria
                itens={candidatosJuntos}
                cats={cats}
                marcados={juntos}
                onToggle={toggleJunto}
                busca={buscaPicker}
                setBusca={setBuscaPicker}
              />
            </div>
          )}

          <div className="form-row">
            {!form.is_combo && (
              <label>
                Duração (minutos)
                <input
                  type="number"
                  min="5"
                  step="5"
                  value={form.duration_minutes}
                  onChange={(e) =>
                    setForm({ ...form, duration_minutes: e.target.value })
                  }
                  required
                />
              </label>
            )}

            <label>
              Preço (R$)
              <input
                type="text"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder="Ex.: 120,00"
                required
              />
            </label>
          </div>

          <div className="img-field">
            <span className="img-field-label">
              Fotos ({imagens.length}/{MAX_IMAGENS})
            </span>
            <div className="img-thumbs">
              {imagens.map((img, i) => (
                <div key={img.url ?? img.preview} className="img-thumb">
                  <img src={img.url ?? img.preview} alt={`Foto ${i + 1}`} />
                  <button
                    type="button"
                    className="img-remove"
                    onClick={() => removeImagem(i)}
                    aria-label="Remover foto"
                  >
                    ×
                  </button>
                </div>
              ))}
              {imagens.length < MAX_IMAGENS && (
                <label className="img-add">
                  +
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleAddImagens}
                    hidden
                  />
                </label>
              )}
            </div>
          </div>

          <div className="form-actions">
            {editing !== 'new' && (
              <button
                type="button"
                className="btn btn-danger btn-excluir"
                onClick={handleDelete}
              >
                Excluir
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
        </div>
      )}

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : services.length === 0 ? (
        <div className="card empty-state">
          <p>Nenhum serviço cadastrado ainda.</p>
          <p className="muted">Toque no botão + para começar.</p>
        </div>
      ) : (
        <div className="service-list">
          {agruparPorCategoria(services, cats).map((g, _, todos) => (
          <section key={g.id || 'outros'} className="cat-grupo">
          {todos.length > 1 && <h3 className="cat-titulo">{g.nome} <span className="muted">{g.itens.length}</span></h3>}
          {g.itens.map((s) => (
            <div
              key={s.id}
              className={s.active ? 'card service-row' : 'card service-row inactive'}
            >
              {s.images?.[0] ? (
                <img className="service-thumb" src={s.images[0]} alt={s.name} />
              ) : (
                <div className="service-thumb service-thumb-vazio">
                  <SparkleIcon />
                </div>
              )}
              <div className="service-info">
                <span className="service-nome">
                  <span className="nome-txt">{s.name}</span>
                  {s.is_combo && <span className="badge badge-combo">combo</span>}
                </span>
                <span className="muted service-meta">
                  {labelDuracao(s)} · {formatPreco(s.price)}
                </span>
                {juntosTodos.some((j) => j.service_id === s.id) && (
                  <span className="muted service-meta service-juntos">
                    Vai junto: {juntosTodos.filter((j) => j.service_id === s.id).map((j) => services.find((x) => x.id === j.sugerido_id)?.name).filter(Boolean).join(', ')}
                  </span>
                )}
              </div>
              <label className="switch" title={s.active ? 'Desativar' : 'Ativar'}>
                <input
                  type="checkbox"
                  checked={s.active}
                  onChange={() => toggleActive(s)}
                />
                <span></span>
              </label>
              <button
                className="icon-btn"
                onClick={() => startEdit(s)}
                aria-label={`Editar ${s.name}`}
              >
                <ChevronIcon />
              </button>
            </div>
          ))}
          </section>
          ))}
        </div>
      )}

      {!loading && editing === null && (
        <section className="card cat-gestao">
          <button type="button" className="cat-gestao-topo" onClick={() => setGerindo((v) => !v)} aria-expanded={gerindo}>
            <span><strong>Categorias do salão</strong><span className="muted"> · {cats.filter((c) => c.salon_id).length} suas, {cats.filter((c) => !c.salon_id).length} da plataforma</span></span>
            <ChevronIcon />
          </button>
          {gerindo && (
            <div className="cat-gestao-corpo">
              <p className="muted">As da plataforma valem para todo mundo. As suas aparecem só para o seu salão. Para criar uma nova, abra um serviço.</p>
              <ul className="cat-gestao-lista">
                {cats.filter((c) => c.salon_id).map((c) => (
                  <li key={c.id}>
                    {catEdit?.id === c.id ? (
                      <>
                        <input value={catEdit.nome} maxLength={40} onChange={(e) => setCatEdit({ ...catEdit, nome: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); renomearCategoria() } }} autoFocus />
                        <button type="button" className="btn btn-primary btn-mini" onClick={renomearCategoria}>Salvar</button>
                        <button type="button" className="btn btn-ghost btn-mini" onClick={() => setCatEdit(null)}>Cancelar</button>
                      </>
                    ) : (
                      <>
                        <span className="cat-gestao-nome">{c.nome} <span className="muted">{services.filter((s) => s.categoria_id === c.id).length}</span></span>
                        <button type="button" className="btn btn-ghost btn-mini" onClick={() => setCatEdit({ id: c.id, nome: c.nome })}>Renomear</button>
                        <button type="button" className="btn btn-ghost btn-mini perigo" onClick={() => apagarCategoria(c)}>Apagar</button>
                      </>
                    )}
                  </li>
                ))}
                {cats.filter((c) => c.salon_id).length === 0 && <li className="muted">Nenhuma categoria sua ainda.</li>}
              </ul>
              <p className="muted cat-gestao-pre">Da plataforma: {cats.filter((c) => !c.salon_id).map((c) => c.nome).join(', ')}.</p>
            </div>
          )}
        </section>
      )}

      {editing === null && (
        <button className="fab" onClick={startNew} aria-label="Novo serviço">
          +
        </button>
      )}
    </AdminShell>
  )
}

// checkboxes agrupados por categoria, com busca quando a lista é grande
function ListaPorCategoria({ itens, cats, marcados, onToggle, busca, setBusca }) {
  const grupos = agruparPorCategoria(itens.filter((s) => bate(s.name, busca)), cats)
  return (
    <div className="combo-lista combo-lista-cats">
      {itens.length > 10 && (
        <input className="combo-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar serviço" aria-label="Buscar serviço" />
      )}
      {marcados.length > 0 && (
        <p className="muted combo-marcados">Marcados: {marcados.map((id) => itens.find((s) => s.id === id)?.name).filter(Boolean).join(', ')}</p>
      )}
      {grupos.length === 0 && <p className="muted">Nada com esse nome.</p>}
      {grupos.map((g) => (
        <div key={g.id || 'outros'} className="combo-grupo">
          {grupos.length > 1 && <span className="combo-grupo-titulo">{g.nome}</span>}
          {g.itens.map((s) => (
            <label key={s.id} className="combo-item">
              <input type="checkbox" checked={marcados.includes(s.id)} onChange={() => onToggle(s.id)} />
              <span className="combo-item-nome">{s.name}</span>
              <span className="muted">{formatDuracao(s.duration_minutes)}</span>
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}
