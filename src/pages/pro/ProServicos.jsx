import { useCallback, useEffect, useState } from 'react'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { formatPreco, labelDuracao } from '../../lib/format'
import { SparkleIcon } from '../../components/icons'

export default function ProServicos() {
  const { professional } = useAuth()
  const [services, setServices] = useState([])
  const [selecionados, setSelecionados] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [salvandoId, setSalvandoId] = useState(null)

  const profId = professional?.id

  const fetchTudo = useCallback(async () => {
    if (!profId) return
    const [servRes, vincRes] = await Promise.all([
      supabase.from('services').select('*').eq('active', true).order('name'),
      supabase
        .from('professional_services')
        .select('service_id')
        .eq('professional_id', profId),
    ])
    if (servRes.error) setError('Erro ao carregar: ' + servRes.error.message)
    else setServices(servRes.data)
    setSelecionados((vincRes.data ?? []).map((v) => v.service_id))
    setLoading(false)
  }, [profId])

  useEffect(() => {
    fetchTudo()
  }, [fetchTudo])

  if (!professional) return <SemFicha />

  async function toggle(service) {
    setSalvandoId(service.id)
    setError('')
    const jaTem = selecionados.includes(service.id)

    const { error } = jaTem
      ? await supabase
          .from('professional_services')
          .delete()
          .eq('professional_id', professional.id)
          .eq('service_id', service.id)
      : await supabase
          .from('professional_services')
          .insert({ professional_id: professional.id, service_id: service.id })

    setSalvandoId(null)
    if (error) {
      setError('Erro ao salvar: ' + error.message)
      return
    }
    setSelecionados((prev) =>
      jaTem ? prev.filter((id) => id !== service.id) : [...prev, service.id],
    )
  }

  return (
    <ProShell>
      <div className="page-head">
        <div>
          <h2>Meus serviços</h2>
          <p className="muted">
            Marque o que você atende — só isso aparece no seu link.
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : services.length === 0 ? (
        <div className="card empty-state">
          <p>O salão ainda não cadastrou serviços.</p>
          <p className="muted">Assim que houver, eles aparecem aqui.</p>
        </div>
      ) : (
        <div className="service-list">
          {services.map((s) => (
            <div
              key={s.id}
              className={
                selecionados.includes(s.id)
                  ? 'card service-row'
                  : 'card service-row inactive'
              }
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
              <label className="switch">
                <input
                  type="checkbox"
                  checked={selecionados.includes(s.id)}
                  disabled={salvandoId === s.id}
                  onChange={() => toggle(s)}
                />
                <span></span>
              </label>
            </div>
          ))}
        </div>
      )}
    </ProShell>
  )
}
