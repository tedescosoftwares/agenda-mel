import { useEffect, useState } from 'react'
import { useDialogo } from '../../context/DialogoContext'
import AdminShell from '../../components/AdminShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { ChevronIcon, SparkleIcon } from '../../components/icons'
import { formatPreco, formatDuracao, labelDuracao } from '../../lib/format'

const FORM_VAZIO = {
  name: '',
  description: '',
  duration_minutes: 60,
  price: '',
  is_combo: false,
}

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
  const [saving, setSaving] = useState(false)

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
    }
    setLoading(false)
  }

  function startNew() {
    setForm(FORM_VAZIO)
    setImagens([])
    setComboIds([])
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
    })
    setImagens((service.images ?? []).map((url) => ({ url })))
    setComboIds(service.combo_service_ids ?? [])
    setEditing(service.id)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    imagens.forEach((img) => img.preview && URL.revokeObjectURL(img.preview))
    setEditing(null)
    setForm(FORM_VAZIO)
    setImagens([])
    setComboIds([])
  }

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
      }

      const antigas =
        editing !== 'new'
          ? services.find((s) => s.id === editing)?.images
          : []

      const query =
        editing === 'new'
          ? supabase.from('services').insert({ ...payload, salon_id: salao?.id })
          : supabase.from('services').update(payload).eq('id', editing)

      const { error } = await query
      if (error) {
        setError('Erro ao salvar: ' + error.message)
        return
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

      {error && <div className="alert alert-error">{error}</div>}

      {editing !== null && (
        <form className="card form service-form" onSubmit={handleSave}>
          <h3>{editing === 'new' ? 'Novo serviço' : 'Editar serviço'}</h3>

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
                <div className="combo-lista">
                  {candidatosCombo.map((s) => (
                    <label key={s.id} className="combo-item">
                      <input
                        type="checkbox"
                        checked={comboIds.includes(s.id)}
                        onChange={() => toggleComboId(s.id)}
                      />
                      <span className="combo-item-nome">{s.name}</span>
                      <span className="muted">
                        {formatDuracao(s.duration_minutes)}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {comboIds.length > 0 && (
                <p className="muted combo-soma">
                  Duração somada: <strong>{formatDuracao(somaCombo)}</strong> —
                  exibida como tempo médio ~{formatDuracao(somaCombo)}
                </p>
              )}
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
      )}

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : services.length === 0 && editing === null ? (
        <div className="card empty-state">
          <p>Nenhum serviço cadastrado ainda.</p>
          <p className="muted">Toque no botão + para começar.</p>
        </div>
      ) : (
        <div className="service-list">
          {services.map((s) => (
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
        </div>
      )}

      {editing === null && (
        <button className="fab" onClick={startNew} aria-label="Novo serviço">
          +
        </button>
      )}
    </AdminShell>
  )
}
