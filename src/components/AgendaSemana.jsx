import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatPreco, toISODate } from '../lib/format'

const DIAS_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

// A semana inteira numa tela: onde está cheio, onde está vazio.
export default function AgendaSemana({ professionalId, onEscolherDia }) {
  const [inicio, setInicio] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay())
    return d
  })
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const dias = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(inicio)
        d.setDate(inicio.getDate() + i)
        return d
      }),
    [inicio],
  )

  const carregar = useCallback(async () => {
    if (!professionalId) return
    setLoading(true)
    const de = toISODate(dias[0])
    const ate = toISODate(dias[6])

    const { data, error } = await supabase
      .from('appointments')
      .select('id, date, start_time, status, price_cents, service_name, guest_name, profiles (full_name)')
      .eq('professional_id', professionalId)
      .gte('date', de)
      .lte('date', ate)
      .neq('status', 'cancelado')
      .order('start_time')

    if (error) setError('Erro ao carregar a semana: ' + error.message)
    else setAppointments(data)
    setLoading(false)
  }, [professionalId, dias])

  useEffect(() => {
    carregar()
  }, [carregar])

  function mover(semanas) {
    const d = new Date(inicio)
    d.setDate(inicio.getDate() + semanas * 7)
    setInicio(d)
  }

  const porDia = {}
  for (const a of appointments) {
    ;(porDia[a.date] ??= []).push(a)
  }

  const totalSemana = appointments
    .filter((a) => a.status !== 'faltou')
    .reduce((s, a) => s + (a.price_cents ?? 0) / 100, 0)

  const hoje = toISODate(new Date())

  return (
    <div className="semana">
      <div className="semana-topo">
        <button className="btn-mini btn-mini-neutro" onClick={() => mover(-1)}>
          ← anterior
        </button>
        <span className="muted semana-rotulo">
          {dias[0].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} —{' '}
          {dias[6].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
        </span>
        <button className="btn-mini btn-mini-neutro" onClick={() => mover(1)}>
          próxima →
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : (
        <>
          <p className="muted resumo-dia">
            {appointments.length}{' '}
            {appointments.length === 1 ? 'atendimento' : 'atendimentos'} na semana ·
            previsão {formatPreco(totalSemana)}
          </p>

          <div className="semana-grade">
            {dias.map((d) => {
              const iso = toISODate(d)
              const lista = porDia[iso] ?? []
              return (
                <button
                  key={iso}
                  className={
                    iso === hoje ? 'card semana-dia hoje' : 'card semana-dia'
                  }
                  onClick={() => onEscolherDia?.(iso)}
                >
                  <span className="semana-cabeca">
                    <span className="semana-nome">{DIAS_CURTO[d.getDay()]}</span>
                    <span className="semana-num">
                      {String(d.getDate()).padStart(2, '0')}
                    </span>
                  </span>

                  {lista.length === 0 ? (
                    <span className="muted semana-vazio">livre</span>
                  ) : (
                    <span className="semana-itens">
                      {lista.slice(0, 4).map((a) => (
                        <span key={a.id} className={`semana-item st-${a.status}`}>
                          <b>{a.start_time.slice(0, 5)}</b>{' '}
                          {a.profiles?.full_name?.split(' ')[0] ||
                            a.guest_name?.split(' ')[0] ||
                            'cliente'}
                        </span>
                      ))}
                      {lista.length > 4 && (
                        <span className="muted semana-mais">
                          +{lista.length - 4}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
