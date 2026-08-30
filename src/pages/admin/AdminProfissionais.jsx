import { useCallback, useEffect, useState } from 'react'
import AdminShell from '../../components/AdminShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { ChevronIcon, LinkIcon } from '../../components/icons'
import { formatDuracao, formatPreco } from '../../lib/format'
import { gerarSlug } from '../../lib/booking'
import Avatar from '../../components/Avatar'
import FotoUpload from '../../components/FotoUpload'

const FORM_VAZIO = { name: '', slug: '', phone: '', bio: '', photo_url: null }

export default function AdminProfissionais() {
  const { salao } = useAuth()
  const [profissionais, setProfissionais] = useState([])
  const [services, setServices] = useState([])
  const [vinculos, setVinculos] = useState({}) // professional_id -> [service_id]
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [editing, setEditing] = useState(null) // null | 'new' | id
  const [form, setForm] = useState(FORM_VAZIO)
  const [slugEditado, setSlugEditado] = useState(false)
  const [servicosSel, setServicosSel] = useState([])
  const [saving, setSaving] = useState(false)

  const fetchTudo = useCallback(async () => {
    const [profRes, servRes, vincRes] = await Promise.all([
      supabase.from('professionals').select('*').order('name'),
      supabase.from('services').select('*').eq('active', true).order('name'),
      supabase.from('professional_services').select('*'),
    ])

    if (profRes.error) {
      setError('Erro ao carregar a equipe: ' + profRes.error.message)
    } else {
      setProfissionais(profRes.data)
      setError('')
    }
    if (!servRes.error) setServices(servRes.data)

    const mapa = {}
    for (const v of vincRes.data ?? []) {
      ;(mapa[v.professional_id] ??= []).push(v.service_id)
    }
    setVinculos(mapa)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchTudo()
  }, [fetchTudo])

  function startNew() {
    setForm(FORM_VAZIO)
    setServicosSel([])
    setSlugEditado(false)
    setEditing('new')
    setError('')
    setInfo('')
  }

  function startEdit(p) {
    setForm({
      name: p.name,
      slug: p.slug,
      phone: p.phone ?? '',
      bio: p.bio ?? '',
      photo_url: p.photo_url ?? null,
    })
    setServicosSel(vinculos[p.id] ?? [])
    setSlugEditado(true)
    setEditing(p.id)
    setError('')
    setInfo('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditing(null)
    setForm(FORM_VAZIO)
    setServicosSel([])
  }

  function onChangeNome(valor) {
    setForm((f) => ({
      ...f,
      name: valor,
      slug: slugEditado ? f.slug : gerarSlug(valor),
    }))
  }

  function toggleServico(id) {
    setServicosSel((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  async function salvarVinculos(professionalId) {
    const atuais = vinculos[professionalId] ?? []
    const paraAdicionar = servicosSel.filter((id) => !atuais.includes(id))
    const paraRemover = atuais.filter((id) => !servicosSel.includes(id))

    if (paraAdicionar.length) {
      const { error } = await supabase.from('professional_services').insert(
        paraAdicionar.map((service_id) => ({
          professional_id: professionalId,
          service_id,
        })),
      )
      if (error) throw new Error('Erro ao salvar serviços: ' + error.message)
    }
    if (paraRemover.length) {
      const { error } = await supabase
        .from('professional_services')
        .delete()
        .eq('professional_id', professionalId)
        .in('service_id', paraRemover)
      if (error) throw new Error('Erro ao remover serviços: ' + error.message)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')

    const nome = form.name.trim()
    const slug = gerarSlug(form.slug || form.name)
    if (!nome) {
      setError('Informe o nome da profissional.')
      return
    }
    if (!slug) {
      setError('O link precisa ter letras ou números.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: nome,
        slug,
        phone: form.phone.trim() || null,
        bio: form.bio.trim() || null,
        photo_url: form.photo_url,
      }

      let professionalId = editing
      if (editing === 'new') {
        const { data, error } = await supabase
          .from('professionals')
          .insert({ ...payload, salon_id: salao?.id })
          .select()
          .single()
        if (error) throw new Error(traduzErro(error))
        professionalId = data.id
      } else {
        const { error } = await supabase
          .from('professionals')
          .update(payload)
          .eq('id', editing)
        if (error) throw new Error(traduzErro(error))
      }

      await salvarVinculos(professionalId)
      cancelEdit()
      await fetchTudo()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleAtiva(p) {
    const { error } = await supabase
      .from('professionals')
      .update({ active: !p.active })
      .eq('id', p.id)
    if (error) setError('Erro ao atualizar: ' + error.message)
    else fetchTudo()
  }

  async function handleDelete() {
    const p = profissionais.find((x) => x.id === editing)
    if (!p) return
    const ok = window.confirm(
      `Excluir ${p.name} da equipe? Se ela já tem agendamentos, prefira apenas desativar.`,
    )
    if (!ok) return
    const { error } = await supabase.from('professionals').delete().eq('id', p.id)
    if (error) {
      setError(
        error.code === '23503'
          ? 'Essa profissional já tem agendamentos — desative em vez de excluir.'
          : 'Erro ao excluir: ' + error.message,
      )
      return
    }
    cancelEdit()
    fetchTudo()
  }

  async function copiarLink(p) {
    const url = `${window.location.origin}/p/${p.slug}`
    try {
      await navigator.clipboard.writeText(url)
      setInfo(`Link de ${p.name} copiado: ${url}`)
    } catch {
      setInfo(`Link de ${p.name}: ${url}`)
    }
  }

  const ativas = profissionais.filter((p) => p.active).length

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <h2>Equipe</h2>
          <p className="muted">
            {profissionais.length}{' '}
            {profissionais.length === 1 ? 'profissional' : 'profissionais'}
            {profissionais.length > 0 ? ` · ${ativas} ativa${ativas === 1 ? '' : 's'}` : ''}
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {info && <div className="alert alert-info">{info}</div>}

      {editing !== null && (
        <form className="card form service-form" onSubmit={handleSave}>
          <h3>{editing === 'new' ? 'Nova profissional' : 'Editar profissional'}</h3>

          <FotoUpload
            nome={form.name}
            pasta={editing === 'new' ? 'equipe' : editing}
            valor={form.photo_url}
            onChange={(url) => setForm((f) => ({ ...f, photo_url: url }))}
            onErro={setError}
          />

          <label>
            Nome
            <input
              type="text"
              value={form.name}
              onChange={(e) => onChangeNome(e.target.value)}
              placeholder="Ex.: Ana Paula"
              required
            />
          </label>

          <label>
            Link da agenda dela
            <div className="slug-input">
              <span className="slug-prefixo">/p/</span>
              <input
                type="text"
                value={form.slug}
                onChange={(e) => {
                  setSlugEditado(true)
                  setForm({ ...form, slug: e.target.value })
                }}
                placeholder="ana-paula"
                required
              />
            </div>
            <span className="muted campo-dica">
              É o endereço que ela passa para as clientes.
            </span>
          </label>

          <label>
            WhatsApp (opcional)
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="(13) 99999-9999"
            />
          </label>

          <label>
            Apresentação (opcional)
            <textarea
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              placeholder="Especialista em limpeza de pele e sobrancelhas…"
              rows={2}
            />
          </label>

          <div className="combo-picker">
            <span className="img-field-label">Serviços que ela atende</span>
            {services.length === 0 ? (
              <p className="muted combo-aviso">
                Cadastre serviços na aba Serviços primeiro.
              </p>
            ) : (
              <div className="combo-lista">
                {services.map((s) => (
                  <label key={s.id} className="combo-item">
                    <input
                      type="checkbox"
                      checked={servicosSel.includes(s.id)}
                      onChange={() => toggleServico(s.id)}
                    />
                    <span className="combo-item-nome">{s.name}</span>
                    <span className="muted">
                      {formatDuracao(s.duration_minutes)} · {formatPreco(s.price)}
                    </span>
                  </label>
                ))}
              </div>
            )}
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
      ) : profissionais.length === 0 && editing === null ? (
        <div className="card empty-state">
          <p>Nenhuma profissional cadastrada ainda.</p>
          <p className="muted">Toque no botão + para montar sua equipe.</p>
        </div>
      ) : (
        <div className="cliente-list">
          {profissionais.map((p) => (
            <div
              key={p.id}
              className={p.active ? 'card prof-row' : 'card prof-row inactive'}
            >
              <Avatar nome={p.name} foto={p.photo_url} />
              <div className="cliente-info">
                <span className="cliente-nome"><span className="nome-txt">{p.name}</span></span>
                <span className="muted cliente-meta">
                  /p/{p.slug} · {(vinculos[p.id] ?? []).length} serviço
                  {(vinculos[p.id] ?? []).length === 1 ? '' : 's'}
                  {!p.user_id && ' · sem login'}
                </span>
              </div>
              <button
                className="icon-btn"
                onClick={() => copiarLink(p)}
                aria-label={`Copiar link de ${p.name}`}
                title="Copiar link da agenda"
              >
                <LinkIcon />
              </button>
              <label className="switch" title={p.active ? 'Desativar' : 'Ativar'}>
                <input
                  type="checkbox"
                  checked={p.active}
                  onChange={() => toggleAtiva(p)}
                />
                <span></span>
              </label>
              <button
                className="icon-btn"
                onClick={() => startEdit(p)}
                aria-label={`Editar ${p.name}`}
              >
                <ChevronIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      {editing === null && (
        <button className="fab" onClick={startNew} aria-label="Nova profissional">
          +
        </button>
      )}
    </AdminShell>
  )
}

function traduzErro(error) {
  if (error.code === '23505') {
    return 'Já existe uma profissional com esse link. Escolha outro.'
  }
  if (error.code === '23514') {
    return 'O link só aceita letras minúsculas, números e hífen.'
  }
  return 'Erro ao salvar: ' + error.message
}
