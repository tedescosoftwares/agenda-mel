import { useCallback, useEffect, useState } from 'react'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { formatPreco, toISODate } from '../../lib/format'
import { formatDataCurta } from '../../lib/booking'
import ConviteAdiantar from '../../components/ConviteAdiantar'
import OfertaVaga from '../../components/OfertaVaga'

// A agenda da cliente: o que ela marcou, o que está esperando e o que
// alguém ofereceu a ela. Saiu de dentro do Início na virada do MIMO —
// antes ficava embaixo da lista de profissionais, e quem já tinha
// horário marcado tinha que rolar a tela inteira para conferir a hora.

const STATUS_LABEL = {
  pendente: 'aguardando',
  confirmado: 'confirmado',
  concluido: 'concluído',
}

export default function ClienteAgenda() {
  const [meus, setMeus] = useState([])
  const [vagas, setVagas] = useState([])
  const [filas, setFilas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchDados = useCallback(async () => {
    const hoje = toISODate(new Date())

    const [apptRes, vagasRes, filasRes] = await Promise.all([
      supabase
        .from('appointments')
        .select(
          '*, services (name, price), professionals (name), appointment_offers (id, status, proposed_start_time, previous_start_time, expires_at)',
        )
        .gte('date', hoje)
        .neq('status', 'cancelado')
        .order('date')
        .order('start_time'),
      supabase
        .from('waitlist_offers')
        .select('*, waitlist_entries (id, services (name), professionals (name))')
        .eq('status', 'pendente')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }),
      supabase
        .from('waitlist_entries')
        .select('*, services (name), professionals (name)')
        .eq('status', 'aguardando')
        .order('created_at', { ascending: false }),
    ])

    if (apptRes.error) setError('Erro ao carregar: ' + apptRes.error.message)
    else {
      setMeus(apptRes.data)
      setError('')
    }
    if (!vagasRes.error) setVagas(vagasRes.data)
    if (!filasRes.error) setFilas(filasRes.data)
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

  async function sairDaFila(f) {
    const { error } = await supabase.rpc('sair_lista_espera', { entrada_id: f.id })
    if (error) setError('Erro ao sair da fila: ' + error.message)
    else fetchDados()
  }

  return (
    <ClienteShell>
      <div className="page-head">
        <h2>Minha agenda</h2>
        <p className="muted">O que está marcado para você</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : (
        <>
          {vagas.map((v) => (
            <OfertaVaga key={v.id} oferta={v} onRespondido={fetchDados} />
          ))}

          {convitesAbertos(meus).map(({ appt, oferta }) => (
            <ConviteAdiantar
              key={oferta.id}
              oferta={oferta}
              servico={appt.services?.name}
              profissional={appt.professionals?.name}
              onRespondido={fetchDados}
            />
          ))}

          {meus.length === 0 ? (
            <div className="card empty-state">
              <p>Você ainda não tem horário marcado.</p>
              <p className="muted">
                Toque no <strong>+</strong> aqui embaixo para escolher com quem se cuidar.
              </p>
            </div>
          ) : (
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
                    {podeCancelar(a) && (
                      <button className="btn-link-cancelar" onClick={() => cancelar(a)}>
                        cancelar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {filas.length > 0 && (
            <section className="secao">
              <h3 className="secao-titulo">Estou esperando vaga</h3>
              <div className="cliente-list">
                {filas.map((f) => (
                  <div key={f.id} className="card fila-row">
                    <div className="cliente-info">
                      <span className="cliente-nome">
                        <span className="nome-txt">{f.services?.name}</span>
                      </span>
                      <span className="muted cliente-meta">
                        com {f.professionals?.name} · {f.window_start.slice(0, 5)}–
                        {f.window_end.slice(0, 5)} · até {formatDataCurta(f.date_to)}
                      </span>
                    </div>
                    <button className="btn-link-cancelar" onClick={() => sairDaFila(f)}>
                      sair da fila
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </ClienteShell>
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

// só dá para cancelar o que ainda não aconteceu
function podeCancelar(a) {
  if (a.status !== 'pendente' && a.status !== 'confirmado') return false
  return new Date(`${a.date}T${a.start_time}`) > new Date()
}
