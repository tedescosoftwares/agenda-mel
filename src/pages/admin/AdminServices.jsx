import { useEffect, useState } from 'react'
import Topbar from '../../components/Topbar'
import { supabase } from '../../lib/supabase'

const FORM_VAZIO = {
  name: '',
  description: '',
  duration_minutes: 60,
  price: '',
}

export default function AdminServices() {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // null | 'new' | id do serviço
  const [form, setForm] = useState(FORM_VAZIO)
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
    setEditing('new')
    setError('')
  }

  function startEdit(service) {
    setForm({
      name: service.name,
      description: service.description ?? '',
      duration_minutes: service.duration_minutes,
      price: String(service.price),
    })
    setEditing(service.id)
    setError('')
  }

  function cancelEdit() {
    setEditing(null)
    setForm(FORM_VAZIO)
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

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      duration_minutes: Number(form.duration_minutes),
      price,
    }

    setSaving(true)
    const query =
      editing === 'new'
        ? supabase.from('services').insert(payload)
        : supabase.from('services').update(payload).eq('id', editing)

    const { error } = await query
    setSaving(false)

    if (error) {
      setError('Erro ao salvar: ' + error.message)
      return
    }
    cancelEdit()
    fetchServices()
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

  async function handleDelete(service) {
    const ok = window.confirm(
      `Excluir o serviço "${service.name}"? Essa ação não pode ser desfeita.`,
    )
    if (!ok) return
    const { error } = await supabase.from('services').delete().eq('id', service.id)
    if (error) {
      setError('Erro ao excluir: ' + error.message)
    } else {
      fetchServices()
    }
  }

  return (
    <div className="layout">
      <Topbar admin backTo="/admin" />

      <main className="content">
        <div className="page-head">
          <div>
            <h2>Serviços</h2>
            <p className="muted">Cadastre os serviços, duração e preços.</p>
          </div>
          {editing === null && (
            <button className="btn btn-primary" onClick={startNew}>
              + Novo serviço
            </button>
          )}
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

            <div className="form-row">
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

            <div className="form-actions">
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
            <p className="muted">
              Clique em <strong>+ Novo serviço</strong> para começar.
            </p>
          </div>
        ) : (
          <div className="service-list">
            {services.map((s) => (
              <div key={s.id} className={s.active ? 'card service-row' : 'card service-row inactive'}>
                <div className="service-info">
                  <div className="service-title">
                    <strong>{s.name}</strong>
                    {!s.active && <span className="badge">inativo</span>}
                  </div>
                  {s.description && <p className="muted">{s.description}</p>}
                  <p className="service-meta">
                    ⏱ {formatDuracao(s.duration_minutes)} · 💰 {formatPreco(s.price)}
                  </p>
                </div>
                <div className="service-actions">
                  <button className="btn btn-small" onClick={() => startEdit(s)}>
                    Editar
                  </button>
                  <button className="btn btn-small" onClick={() => toggleActive(s)}>
                    {s.active ? 'Desativar' : 'Ativar'}
                  </button>
                  <button
                    className="btn btn-small btn-danger"
                    onClick={() => handleDelete(s)}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function formatPreco(valor) {
  return Number(valor).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function formatDuracao(min) {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}
