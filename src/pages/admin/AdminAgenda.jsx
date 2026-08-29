import { useCallback, useEffect, useMemo, useState } from 'react'
import AdminShell from '../../components/AdminShell'
import { supabase } from '../../lib/supabase'
import { formatPreco, formatDuracao, toISODate } from '../../lib/format'

const STATUS_LABEL = {
  pendente: 'pendente',
  confirmado: 'confirmado',
  concluido: 'concluído',
}

export default function AdminAgenda() {
  const dias = useMemo(() => {
    const hoje = new Date()
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(hoje)
      d.setDate(hoje.getDate() + i)
      return d
    })
  }, [])

  const [dataSel, setDataSel] = useState(() => toISODate(new Date()))
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mudandoId, setMudandoId] = useState(null)

  const fetchAgenda = useCallback(async () => {
    const { data, error } = await supabase
      .from('appointments')
      .select(
        '*, profiles (full_name, phone), services (name, price, duration_minutes)',
      )
      .eq('date', dataSel)
      .neq('status', 'cancelado')
      .order('start_time')

    if (error) {
      setError('Erro ao carregar a agenda: ' + error.message)
    } else {
      setAppointments(data)
      setError('')
    }
    setLoading(false)
  }, [dataSel])

  useEffect(() => {
    setLoading(true)
    fetchAgenda()
  }, [fetchAgenda])

  async function mudarStatus(appt, novo) {
    if (novo === 'cancelado') {
      const ok = window.confirm(
        `Recusar o agendamento de ${appt.profiles?.full_name ?? 'cliente'} às ${appt.start_time.slice(0, 5)}? O horário volta a ficar livre.`,
      )
      if (!ok) return
    }
    setMudandoId(appt.id)
    const { error } = await supabase
      .from('appointments')
      .update({ status: novo })
      .eq('id', appt.id)
    setMudandoId(null)
    if (error) {
      setError('Erro ao atualizar: ' + error.message)
    } else {
      fetchAgenda()
    }
  }

  const previsao = appointments.reduce(
    (soma, a) => soma + Number(a.services?.price ?? 0),
    0,
  )

  const tituloDia = new Date(dataSel + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <h2>Agenda</h2>
          <p className="muted titulo-dia">{tituloDia}</p>
        </div>
      </div>

      <div className="day-picker">
        {dias.map((d) => {
          const iso = toISODate(d)
          const ativo = iso === dataSel
          return (
            <button
              key={iso}
              className={ativo ? 'day-chip active' : 'day-chip'}
              onClick={() => setDataSel(iso)}
            >
              <span className="day-chip-nome">
                {d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}
              </span>
              <span className="day-chip-num">
                {String(d.getDate()).padStart(2, '0')}
              </span>
            </button>
          )
        })}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : appointments.length === 0 ? (
        <div className="card empty-state">
          <p>Nenhum atendimento neste dia.</p>
          <p className="muted">
            Os agendamentos das clientes vão aparecer aqui.
          </p>
        </div>
      ) : (
        <>
          <p className="muted resumo-dia">
            {appointments.length}{' '}
            {appointments.length === 1 ? 'atendimento' : 'atendimentos'} · previsão{' '}
            {formatPreco(previsao)}
          </p>

          <div className="appt-list">
            {appointments.map((a) => (
              <div key={a.id} className="card appt-row">
                <div className="appt-time">
                  <span className="appt-hora">{a.start_time.slice(0, 5)}</span>
                  <span className="appt-dur">
                    {a.services ? formatDuracao(a.services.duration_minutes) : ''}
                  </span>
                </div>
                <div className="appt-info">
                  <span className="appt-cliente">
                    {a.profiles?.full_name || 'Cliente'}
                  </span>
                  <span className="appt-servico muted">
                    {a.services?.name}
                    {a.services ? ` · ${formatPreco(a.services.price)}` : ''}
                  </span>
                  <div className="appt-btns">
                    {a.status === 'pendente' && (
                      <>
                        <button
                          className="btn-mini btn-mini-ok"
                          disabled={mudandoId === a.id}
                          onClick={() => mudarStatus(a, 'confirmado')}
                        >
                          Confirmar
                        </button>
                        <button
                          className="btn-mini btn-mini-nao"
                          disabled={mudandoId === a.id}
                          onClick={() => mudarStatus(a, 'cancelado')}
                        >
                          Recusar
                        </button>
                      </>
                    )}
                    {a.status === 'confirmado' && (
                      <>
                        <button
                          className="btn-mini btn-mini-ok"
                          disabled={mudandoId === a.id}
                          onClick={() => mudarStatus(a, 'concluido')}
                        >
                          Concluir
                        </button>
                        <button
                          className="btn-mini btn-mini-nao"
                          disabled={mudandoId === a.id}
                          onClick={() => mudarStatus(a, 'cancelado')}
                        >
                          Cancelar
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <span className={`badge badge-${a.status}`}>
                  {STATUS_LABEL[a.status] ?? a.status}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </AdminShell>
  )
}
