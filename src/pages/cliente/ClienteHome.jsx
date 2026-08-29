import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Topbar from '../../components/Topbar'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { ChevronIcon } from '../../components/icons'
import { formatPreco, toISODate } from '../../lib/format'
import { formatDataCurta } from '../../lib/booking'
import Avatar from '../../components/Avatar'
import ConviteAdiantar from '../../components/ConviteAdiantar'

const STATUS_LABEL = {
  pendente: 'pendente',
  confirmado: 'confirmado',
  concluido: 'concluído',
}

export default function ClienteHome() {
  const { profile, user } = useAuth()
  const nome = (profile?.full_name || user?.email || '').split(' ')[0]

  const [profissionais, setProfissionais] = useState([])
  const [meus, setMeus] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchDados = useCallback(async () => {
    const hoje = toISODate(new Date())

    const [profRes, apptRes] = await Promise.all([
      supabase
        .from('professionals')
        .select('*')
        .eq('active', true)
        .order('name'),
      supabase
        .from('appointments')
        .select(
          '*, services (name, price), professionals (name), appointment_offers (id, status, proposed_start_time, previous_start_time, expires_at)',
        )
        .gte('date', hoje)
        .neq('status', 'cancelado')
        .order('date')
        .order('start_time'),
    ])

    if (profRes.error) {
      setError('Erro ao carregar: ' + profRes.error.message)
    } else {
      setProfissionais(profRes.data)
      setError('')
    }
    if (!apptRes.error) setMeus(apptRes.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchDados()
  }, [fetchDados])

  async function cancelar(appt) {
    const ok = window.confirm(
      `Cancelar ${appt.services?.name} em ${formatDataCurta(appt.date)} às ${appt.start_time.slice(0, 5)}?`,
    )
    if (!ok) return
    const { error } = await supabase
      .from('appointments')
      .update({ status: 'cancelado' })
      .eq('id', appt.id)
    if (error) setError('Erro ao cancelar: ' + error.message)
    else fetchDados()
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
            {convitesAbertos(meus).map(({ appt, oferta }) => (
              <ConviteAdiantar
                key={oferta.id}
                oferta={oferta}
                servico={appt.services?.name}
                profissional={appt.professionals?.name}
                onRespondido={fetchDados}
              />
            ))}

            {meus.length > 0 && (
              <section className="secao">
                <h3 className="secao-titulo">Meus agendamentos</h3>
                <div className="appt-list">
                  {meus.map((a) => (
                    <div key={a.id} className="card appt-row">
                      <div className="appt-time">
                        <span className="appt-hora">{a.start_time.slice(0, 5)}</span>
                        <span className="appt-dur">{formatDataCurta(a.date)}</span>
                      </div>
                      <div className="appt-info">
                        <span className="appt-cliente">{a.services?.name}</span>
                        <span className="appt-servico muted">
                          {a.professionals ? `com ${a.professionals.name} · ` : ''}
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
              <h3 className="secao-titulo">Agendar com</h3>
              {profissionais.length === 0 ? (
                <div className="card empty-state">
                  <p>Nenhuma profissional disponível no momento.</p>
                </div>
              ) : (
                <div className="cliente-list">
                  {profissionais.map((p) => (
                    <Link key={p.id} to={`/p/${p.slug}`} className="card prof-row">
                      <Avatar nome={p.name} foto={p.photo_url} />
                      <div className="cliente-info">
                        <span className="cliente-nome">{p.name}</span>
                        {p.bio && (
                          <span className="muted servico-desc">{p.bio}</span>
                        )}
                      </div>
                      <ChevronIcon />
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

// convites de adiantamento ainda válidos, achatados para a tela
function convitesAbertos(agendamentos) {
  const agora = new Date()
  return agendamentos.flatMap((appt) =>
    (appt.appointment_offers ?? [])
      .filter((o) => o.status === 'pendente' && new Date(o.expires_at) > agora)
      .map((oferta) => ({ appt, oferta })),
  )
}
