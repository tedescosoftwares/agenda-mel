import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import AdiantarModal from './AdiantarModal'
import EncaixeModal from './EncaixeModal'
import { formatarCents } from '../lib/indicacao'
import { formatPreco, formatDuracao, toISODate } from '../lib/format'

const STATUS_LABEL = {
  pendente: 'pendente',
  confirmado: 'confirmado',
  concluido: 'concluído',
  faltou: 'não veio',
}

// Agenda de um dia — usada pelo admin (todas as profissionais ou uma
// filtrada) e pela própria profissional (só a agenda dela).
export default function AgendaDia({
  professionalId = null,
  mostrarProfissional = false,
  diaInicial = null,
  // Quando quem hospeda a agenda já tem um botão "+" (a barra de baixo
  // do salão, por exemplo), ela abre o encaixe por aqui e pede para o
  // botão flutuante sumir — dois "+" na mesma tela é um a mais.
  pedidoDeEncaixe = 0,
  semFab = false,
}) {
  const dias = useMemo(() => {
    const base = diaInicial ? new Date(diaInicial + 'T12:00:00') : new Date()
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base)
      d.setDate(base.getDate() + i)
      return d
    })
  }, [diaInicial])

  const [dataSel, setDataSel] = useState(() => diaInicial ?? toISODate(new Date()))
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mudandoId, setMudandoId] = useState(null)
  const [adiantando, setAdiantando] = useState(null)
  const [toleranciaMin, setToleranciaMin] = useState(15)
  const [encaixando, setEncaixando] = useState(false)

  const fetchAgenda = useCallback(async () => {
    let query = supabase
      .from('appointments')
      .select(
        '*, profiles (full_name, phone), services (name, price, duration_minutes), professionals (name), appointment_offers (id, status, proposed_start_time, expires_at)',
      )
      .eq('date', dataSel)
      .neq('status', 'cancelado')
      .order('start_time')


    if (professionalId) query = query.eq('professional_id', professionalId)

    const { data, error } = await query
    if (error) {
      setError('Erro ao carregar a agenda: ' + error.message)
    } else {
      setAppointments(data)
      setError('')
    }
    setLoading(false)
  }, [dataSel, professionalId])

  useEffect(() => {
    setLoading(true)
    fetchAgenda()
  }, [fetchAgenda])

  // a tolerância de atraso é configurável por profissional
  useEffect(() => {
    if (!professionalId) return
    supabase
      .rpc('config_agenda_profissional', { prof: professionalId })
      .then(({ data }) => {
        if (data?.[0]?.no_show_tolerance_minutes != null) {
          setToleranciaMin(data[0].no_show_tolerance_minutes)
        }
      })
  }, [professionalId])

  // Ao concluir, se a cliente tem crédito de indicação, oferece o abatimento
  async function concluir(appt) {
    setMudandoId(appt.id)
    const { data: saldo } = await supabase.rpc('saldo_creditos', {
      cliente: appt.client_id,
    })

    if (saldo > 0) {
      const precoCents = Math.round(Number(appt.services?.price ?? 0) * 100)
      const maximo = Math.min(saldo, precoCents || saldo)
      const usar = window.confirm(
        `${appt.profiles?.full_name ?? 'A cliente'} tem ${formatarCents(saldo)} de crédito. Abater ${formatarCents(maximo)} neste atendimento?`,
      )
      if (usar) {
        const { error } = await supabase.rpc('usar_credito', {
          appt_id: appt.id,
          valor_cents: maximo,
        })
        if (error) {
          setError('Erro ao abater crédito: ' + error.message)
          setMudandoId(null)
          return
        }
      }
    }

    setMudandoId(null)
    mudarStatus(appt, 'concluido')
  }

  async function mudarStatus(appt, novo) {
    if (novo === 'faltou') {
      const ok = window.confirm(
        `Marcar que ${appt.profiles?.full_name ?? 'a cliente'} não veio? O horário volta a ficar livre e quem está na lista de espera é avisada.`,
      )
      if (!ok) return
    }
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
    if (error) setError('Erro ao atualizar: ' + error.message)
    else fetchAgenda()
  }

  async function perdoarFalta(appt) {
    const { data, error } = await supabase.rpc('perdoar_falta', { appt_id: appt.id })
    if (error) {
      setError('Erro ao perdoar: ' + error.message)
      return
    }
    if (data === 'ocupado') {
      setError('O horário já foi ocupado por outra pessoa — não dá para voltar atrás.')
      return
    }
    fetchAgenda()
  }

  async function cancelarConvite(oferta) {
    const ok = window.confirm(
      `Desfazer o convite das ${oferta.proposed_start_time.slice(0, 5)}? Se a cliente já tiver aceitado, o horário dela volta ao original.`,
    )
    if (!ok) return
    const { error } = await supabase.rpc('cancelar_antecipacao', {
      oferta_id: oferta.id,
    })
    if (error) setError('Erro ao desfazer: ' + error.message)
    fetchAgenda()
  }

  const podeEncaixar = Boolean(professionalId) && !semFab

  useEffect(() => {
    if (pedidoDeEncaixe && professionalId) setEncaixando(true)
  }, [pedidoDeEncaixe, professionalId])

  // quem não veio não entra na previsão do dia; o valor é o congelado
  const previsao = appointments
    .filter((a) => a.status !== 'faltou')
    .reduce(
      (soma, a) =>
        soma +
        (a.price_cents != null
          ? a.price_cents / 100
          : Number(a.services?.price ?? 0)),
      0,
    )

  return (
    <>
      <div className="day-picker">
        {dias.map((d) => {
          const iso = toISODate(d)
          return (
            <button
              key={iso}
              className={iso === dataSel ? 'day-chip active' : 'day-chip'}
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
          <p className="muted">Os agendamentos das clientes vão aparecer aqui.</p>
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
              <div key={a.id} className="card appt-row appt-row-status">
                <div className="appt-time">
                  <span className="appt-hora">{a.start_time.slice(0, 5)}</span>
                  <span className="appt-dur">
                    {a.services ? formatDuracao(a.services.duration_minutes) : ''}
                  </span>
                </div>
                <div className="appt-info">
                  <span className="appt-cliente">
                    <span className="nome-txt">
                      {a.profiles?.full_name || a.guest_name || 'Cliente'}
                    </span>
                    {!a.client_id && <span className="badge badge-encaixe">encaixe</span>}
                  </span>
                  <span className="appt-servico muted">
                    {a.service_name || a.services?.name}
                    {a.price_cents != null
                      ? ` · ${formatPreco(a.price_cents / 100)}`
                      : a.services
                        ? ` · ${formatPreco(a.services.price)}`
                        : ''}
                    {mostrarProfissional && a.professionals
                      ? ` · com ${a.professionals.name}`
                      : ''}
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
                          onClick={() => concluir(a)}
                        >
                          Concluir
                        </button>
                        {passouDaTolerancia(a, toleranciaMin) && (
                          <button
                            className="btn-mini btn-mini-nao"
                            disabled={mudandoId === a.id}
                            onClick={() => mudarStatus(a, 'faltou')}
                          >
                            Não veio
                          </button>
                        )}
                        <button
                          className="btn-mini btn-mini-nao"
                          disabled={mudandoId === a.id}
                          onClick={() => mudarStatus(a, 'cancelado')}
                        >
                          Cancelar
                        </button>
                      </>
                    )}
                    {a.status === 'faltou' && (
                      <button
                        className="btn-mini btn-mini-neutro"
                        disabled={mudandoId === a.id}
                        onClick={() => perdoarFalta(a)}
                      >
                        Perdoar falta
                      </button>
                    )}
                    {podeAdiantar(a) &&
                      (convitePendente(a) ? (
                        <button
                          className="btn-mini btn-mini-neutro"
                          onClick={() => cancelarConvite(convitePendente(a))}
                        >
                          Aguardando resposta · desfazer
                        </button>
                      ) : (
                        <button
                          className="btn-mini btn-mini-neutro"
                          onClick={() => setAdiantando(a)}
                        >
                          Adiantar
                        </button>
                      ))}
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

      {podeEncaixar && (
        <button
          className="fab"
          onClick={() => setEncaixando(true)}
          aria-label="Encaixar atendimento"
        >
          +
        </button>
      )}

      {encaixando && (
        <EncaixeModal
          professionalId={professionalId}
          data={dataSel}
          onFechar={() => setEncaixando(false)}
          onPronto={() => {
            setEncaixando(false)
            fetchAgenda()
          }}
        />
      )}

      {adiantando && (
        <AdiantarModal
          appt={adiantando}
          onFechar={() => setAdiantando(null)}
          onPronto={() => {
            setAdiantando(null)
            fetchAgenda()
          }}
        />
      )}
    </>
  )
}

// só faz sentido adiantar o que ainda não começou
function podeAdiantar(a) {
  return a.status === 'pendente' || a.status === 'confirmado'
}

// "Não veio" só aparece depois do horário marcado + tolerância
function passouDaTolerancia(a, toleranciaMin) {
  const marcado = new Date(`${a.date}T${a.start_time}`)
  return Date.now() > marcado.getTime() + toleranciaMin * 60000
}

function convitePendente(a) {
  return (a.appointment_offers ?? []).find(
    (o) => o.status === 'pendente' && new Date(o.expires_at) > new Date(),
  )
}
