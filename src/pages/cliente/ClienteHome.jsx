import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Topbar from '../../components/Topbar'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { SparkleIcon } from '../../components/icons'
import { formatPreco, labelDuracao, toISODate } from '../../lib/format'

const STATUS_LABEL = {
  pendente: 'pendente',
  confirmado: 'confirmado',
  concluido: 'concluído',
}

export default function ClienteHome() {
  const { profile, user } = useAuth()
  const nome = (profile?.full_name || user?.email || '').split(' ')[0]

  const [services, setServices] = useState([])
  const [meus, setMeus] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchDados()
  }, [])

  async function fetchDados() {
    setLoading(true)
    const hoje = toISODate(new Date())

    const [servRes, apptRes] = await Promise.all([
      supabase.from('services').select('*').eq('active', true).order('name'),
      supabase
        .from('appointments')
        .select('*, services (name, price)')
        .gte('date', hoje)
        .neq('status', 'cancelado')
        .order('date')
        .order('start_time'),
    ])

    if (servRes.error) {
      setError('Erro ao carregar serviços: ' + servRes.error.message)
    } else {
      setServices(servRes.data)
    }
    if (!apptRes.error) {
      setMeus(apptRes.data)
    }
    setLoading(false)
  }

  async function cancelar(appt) {
    const ok = window.confirm(
      `Cancelar o agendamento de ${appt.services?.name} em ${formatDataCurta(appt.date)} às ${appt.start_time.slice(0, 5)}?`,
    )
    if (!ok) return
    const { error } = await supabase
      .from('appointments')
      .update({ status: 'cancelado' })
      .eq('id', appt.id)
    if (error) {
      setError('Erro ao cancelar: ' + error.message)
    } else {
      fetchDados()
    }
  }

  return (
    <div className="layout">
      <Topbar />

      <main className="content">
        <h2>Olá, {nome} 💖</h2>

        {error && <div className="alert alert-error">{error}</div>}

        {loading ? (
          <p className="muted">Carregando…</p>
        ) : (
          <>
            {meus.length > 0 && (
              <section className="secao">
                <h3 className="secao-titulo">Meus agendamentos</h3>
                <div className="appt-list">
                  {meus.map((a) => (
                    <div key={a.id} className="card appt-row">
                      <div className="appt-time">
                        <span className="appt-hora">
                          {a.start_time.slice(0, 5)}
                        </span>
                        <span className="appt-dur">{formatDataCurta(a.date)}</span>
                      </div>
                      <div className="appt-info">
                        <span className="appt-cliente">{a.services?.name}</span>
                        <span className="appt-servico muted">
                          {a.services ? formatPreco(a.services.price) : ''}
                        </span>
                      </div>
                      <div className="appt-acoes">
                        <span className={`badge badge-${a.status}`}>
                          {STATUS_LABEL[a.status] ?? a.status}
                        </span>
                        <button
                          className="btn-link-cancelar"
                          onClick={() => cancelar(a)}
                        >
                          cancelar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="secao">
              <h3 className="secao-titulo">Agendar um serviço</h3>
              {services.length === 0 ? (
                <div className="card empty-state">
                  <p>Nenhum serviço disponível no momento.</p>
                </div>
              ) : (
                <div className="servico-catalogo">
                  {services.map((s) => (
                    <Link
                      key={s.id}
                      to={`/agendar/${s.id}`}
                      className="card servico-card"
                    >
                      {s.images?.[0] ? (
                        <img
                          className="servico-foto"
                          src={s.images[0]}
                          alt={s.name}
                        />
                      ) : (
                        <div className="servico-foto servico-foto-vazia">
                          <SparkleIcon />
                        </div>
                      )}
                      <div className="servico-card-info">
                        <span className="servico-nome">
                          {s.name}
                          {s.is_combo && (
                            <span className="badge badge-combo">combo</span>
                          )}
                        </span>
                        {s.description && (
                          <span className="muted servico-desc">
                            {s.description}
                          </span>
                        )}
                        {s.is_combo && incluiNomes(s, services) && (
                          <span className="muted servico-desc">
                            Inclui: {incluiNomes(s, services)}
                          </span>
                        )}
                        <span className="muted servico-meta">
                          {labelDuracao(s)} · {formatPreco(s.price)}
                        </span>
                      </div>
                      <span className="btn btn-primary btn-agendar">Agendar</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function formatDataCurta(iso) {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function incluiNomes(combo, services) {
  const nomes = (combo.combo_service_ids ?? [])
    .map((id) => services.find((s) => s.id === id)?.name)
    .filter(Boolean)
  return nomes.length ? nomes.join(' + ') : ''
}
