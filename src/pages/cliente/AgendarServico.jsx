import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Topbar from '../../components/Topbar'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatPreco, formatDuracao, toISODate } from '../../lib/format'

const PASSO_MIN = 30 // grade de horários de 30 em 30 minutos

export default function AgendarServico() {
  const { serviceId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [service, setService] = useState(null)
  const [businessHours, setBusinessHours] = useState([])
  const [dataSel, setDataSel] = useState('')
  const [horaSel, setHoraSel] = useState('')
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [sucesso, setSucesso] = useState(false)

  const dias = useMemo(() => {
    const hoje = new Date()
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(hoje)
      d.setDate(hoje.getDate() + i)
      return d
    })
  }, [])

  useEffect(() => {
    async function fetchBase() {
      const [servRes, horasRes] = await Promise.all([
        supabase.from('services').select('*').eq('id', serviceId).single(),
        supabase.from('business_hours').select('*'),
      ])
      if (servRes.error) {
        setError('Serviço não encontrado.')
      } else {
        setService(servRes.data)
      }
      if (!horasRes.error) setBusinessHours(horasRes.data)
      setLoading(false)
    }
    fetchBase()
  }, [serviceId])

  useEffect(() => {
    if (!dataSel || !service) return
    let cancelled = false

    async function fetchSlots() {
      setLoadingSlots(true)
      setHoraSel('')

      const dia = businessHours.find(
        (h) => h.weekday === new Date(dataSel + 'T12:00:00').getDay(),
      )
      if (!dia || !dia.open) {
        if (!cancelled) {
          setSlots([])
          setLoadingSlots(false)
        }
        return
      }

      const { data: ocupados, error } = await supabase.rpc('get_busy_slots', {
        dia: dataSel,
      })
      if (cancelled) return
      if (error) {
        setError('Erro ao buscar horários: ' + error.message)
        setSlots([])
        setLoadingSlots(false)
        return
      }

      const livres = gerarSlots({
        inicio: dia.start_time.slice(0, 5),
        fim: dia.end_time.slice(0, 5),
        duracao: service.duration_minutes,
        ocupados: ocupados ?? [],
        ehHoje: dataSel === toISODate(new Date()),
      })
      setSlots(livres)
      setLoadingSlots(false)
    }

    fetchSlots()
    return () => {
      cancelled = true
    }
  }, [dataSel, service, businessHours])

  function diaAberto(d) {
    const dia = businessHours.find((h) => h.weekday === d.getDay())
    return Boolean(dia?.open)
  }

  async function confirmar() {
    if (!dataSel || !horaSel) return
    setSaving(true)
    setError('')

    const inicio = toMin(horaSel)
    const fim = inicio + service.duration_minutes

    const { error } = await supabase.from('appointments').insert({
      client_id: user.id,
      service_id: service.id,
      date: dataSel,
      start_time: horaSel,
      end_time: minToHora(fim),
    })
    setSaving(false)

    if (error) {
      if (error.code === '23505') {
        setError(
          'Esse horário acabou de ser reservado por outra pessoa. Escolha outro, por favor.',
        )
        setHoraSel('')
        setSlots((s) => s.filter((h) => h !== horaSel))
      } else {
        setError('Erro ao agendar: ' + error.message)
      }
      return
    }
    setSucesso(true)
  }

  if (loading) {
    return (
      <div className="page-center">
        <p className="muted">Carregando…</p>
      </div>
    )
  }

  if (!service) {
    return (
      <div className="layout">
        <Topbar />
        <main className="content">
          <div className="alert alert-error">Serviço não encontrado.</div>
          <Link to="/" className="btn btn-primary">
            Voltar
          </Link>
        </main>
      </div>
    )
  }

  if (sucesso) {
    return (
      <div className="layout">
        <Topbar />
        <main className="content">
          <div className="card sucesso-card">
            <span className="sucesso-icone">🎉</span>
            <h2>Agendado!</h2>
            <p>
              <strong>{service.name}</strong>
              <br />
              {formatDataLonga(dataSel)} às {horaSel}
            </p>
            <p className="muted">
              Seu horário está reservado como <strong>pendente</strong> e será
              confirmado em breve.
            </p>
            <button className="btn btn-primary btn-block" onClick={() => navigate('/')}>
              Voltar para o início
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="layout">
      <Topbar />

      <main className="content">
        <Link to="/" className="voltar-link">
          ← Voltar
        </Link>

        <div className="card servico-resumo">
          <div className="servico-card-info">
            <span className="servico-nome">{service.name}</span>
            <span className="muted servico-meta">
              {formatDuracao(service.duration_minutes)} · {formatPreco(service.price)}
            </span>
          </div>
        </div>

        {service.images?.length > 0 && (
          <div className="servico-galeria">
            {service.images.map((url, i) => (
              <img key={url} src={url} alt={`${service.name} — foto ${i + 1}`} />
            ))}
          </div>
        )}

        <h3 className="secao-titulo">Escolha o dia</h3>
        <div className="day-picker">
          {dias.map((d) => {
            const iso = toISODate(d)
            const aberto = diaAberto(d)
            const ativo = iso === dataSel
            return (
              <button
                key={iso}
                className={ativo ? 'day-chip active' : 'day-chip'}
                disabled={!aberto}
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

        {dataSel && (
          <>
            <h3 className="secao-titulo">Escolha o horário</h3>
            {loadingSlots ? (
              <p className="muted">Buscando horários…</p>
            ) : slots.length === 0 ? (
              <div className="card empty-state">
                <p>Nenhum horário livre neste dia. 😔</p>
                <p className="muted">Tente outro dia.</p>
              </div>
            ) : (
              <div className="slots-grid">
                {slots.map((h) => (
                  <button
                    key={h}
                    className={h === horaSel ? 'slot active' : 'slot'}
                    onClick={() => setHoraSel(h)}
                  >
                    {h}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {horaSel && (
          <div className="confirm-bar">
            <div className="confirm-info">
              <strong>{formatDataLonga(dataSel)}</strong>
              <span className="muted">
                às {horaSel} · {formatPreco(service.price)}
              </span>
            </div>
            <button
              className="btn btn-primary"
              onClick={confirmar}
              disabled={saving}
            >
              {saving ? 'Agendando…' : 'Confirmar'}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function minToHora(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0')
  const m = String(min % 60).padStart(2, '0')
  return `${h}:${m}`
}

function gerarSlots({ inicio, fim, duracao, ocupados, ehHoje }) {
  const slots = []
  const fimMin = toMin(fim)
  const agora = new Date()
  const agoraMin = agora.getHours() * 60 + agora.getMinutes()

  const busy = ocupados.map((o) => ({
    ini: toMin(o.start_time.slice(0, 5)),
    fim: toMin(o.end_time.slice(0, 5)),
  }))

  for (let t = toMin(inicio); t + duracao <= fimMin; t += PASSO_MIN) {
    if (ehHoje && t <= agoraMin) continue
    const conflito = busy.some((o) => t < o.fim && t + duracao > o.ini)
    if (!conflito) slots.push(minToHora(t))
  }
  return slots
}

function formatDataLonga(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}
