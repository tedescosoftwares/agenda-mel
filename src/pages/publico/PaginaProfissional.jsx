import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import AuthModal from '../../components/AuthModal'
import { SparkleIcon } from '../../components/icons'
import { formatPreco, labelDuracao, toISODate } from '../../lib/format'
import {
  gerarSlots,
  toMin,
  minToHora,
  formatDataLonga,
} from '../../lib/booking'
import Avatar from '../../components/Avatar'

// Página pública da profissional (/p/<slug>): qualquer pessoa vê os
// serviços e os horários livres; o login só entra na hora de fechar.
export default function PaginaProfissional() {
  const { slug } = useParams()
  const { user, role, loading: authLoading } = useAuth()

  const [prof, setProf] = useState(null)
  const [services, setServices] = useState([])
  const [hours, setHours] = useState([])
  const [loading, setLoading] = useState(true)
  const [erroCarregar, setErroCarregar] = useState('')

  const [servicoSel, setServicoSel] = useState(null)
  const [dataSel, setDataSel] = useState('')
  const [horaSel, setHoraSel] = useState('')
  const [slots, setSlots] = useState([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  const [mostrarLogin, setMostrarLogin] = useState(false)
  const [tentandoFechar, setTentandoFechar] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [sucesso, setSucesso] = useState(null)

  const dias = useMemo(() => {
    const hoje = new Date()
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(hoje)
      d.setDate(hoje.getDate() + i)
      return d
    })
  }, [])

  // --- carrega profissional, serviços dela e horários ---
  useEffect(() => {
    let cancelled = false

    async function carregar() {
      const { data: p, error } = await supabase
        .from('professionals')
        .select('*')
        .eq('slug', slug)
        .maybeSingle()

      if (cancelled) return
      if (error || !p) {
        setErroCarregar('Não encontramos essa agenda. Confira o link.')
        setLoading(false)
        return
      }
      setProf(p)

      const [vincRes, horasRes] = await Promise.all([
        supabase
          .from('professional_services')
          .select('services (*)')
          .eq('professional_id', p.id),
        supabase
          .from('professional_hours')
          .select('*')
          .eq('professional_id', p.id),
      ])
      if (cancelled) return

      const lista = (vincRes.data ?? [])
        .map((v) => v.services)
        .filter((s) => s && s.active)
        .sort((a, b) => a.name.localeCompare(b.name))
      setServices(lista)
      setHours(horasRes.data ?? [])
      setLoading(false)
    }

    carregar()
    return () => {
      cancelled = true
    }
  }, [slug])

  // --- calcula os horários livres do dia escolhido ---
  useEffect(() => {
    if (!dataSel || !servicoSel || !prof) return
    let cancelled = false

    async function buscarSlots() {
      setLoadingSlots(true)
      setHoraSel('')

      const dia = hours.find(
        (h) => h.weekday === new Date(dataSel + 'T12:00:00').getDay(),
      )
      if (!dia?.open) {
        if (!cancelled) {
          setSlots([])
          setLoadingSlots(false)
        }
        return
      }

      const { data: ocupados, error } = await supabase.rpc('get_busy_slots', {
        dia: dataSel,
        prof: prof.id,
      })
      if (cancelled) return
      if (error) {
        setError('Erro ao buscar horários: ' + error.message)
        setSlots([])
      } else {
        setSlots(
          gerarSlots({
            inicio: dia.start_time.slice(0, 5),
            fim: dia.end_time.slice(0, 5),
            duracao: servicoSel.duration_minutes,
            ocupados,
            ehHoje: dataSel === toISODate(new Date()),
          }),
        )
      }
      setLoadingSlots(false)
    }

    buscarSlots()
    return () => {
      cancelled = true
    }
  }, [dataSel, servicoSel, prof, hours])

  const criarAgendamento = useCallback(async () => {
    setSaving(true)
    setError('')

    const fim = toMin(horaSel) + servicoSel.duration_minutes
    const { error } = await supabase.from('appointments').insert({
      client_id: user.id,
      professional_id: prof.id,
      service_id: servicoSel.id,
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
        setSlots((s) => s.filter((h) => h !== horaSel))
        setHoraSel('')
      } else {
        setError('Erro ao agendar: ' + error.message)
      }
      return
    }
    setSucesso({ servico: servicoSel.name, data: dataSel, hora: horaSel })
  }, [user, prof, servicoSel, dataSel, horaSel])

  // se a cliente logou pelo modal, conclui o agendamento que estava pendente
  useEffect(() => {
    if (tentandoFechar && user && role === 'cliente') {
      setMostrarLogin(false)
      setTentandoFechar(false)
      criarAgendamento()
    }
  }, [tentandoFechar, user, role, criarAgendamento])

  function confirmar() {
    if (!user) {
      setTentandoFechar(true)
      setMostrarLogin(true)
      return
    }
    if (role !== 'cliente') {
      setError(
        'Você está logada como equipe. Saia da conta para agendar como cliente.',
      )
      return
    }
    criarAgendamento()
  }

  function diaAberto(d) {
    return Boolean(hours.find((h) => h.weekday === d.getDay())?.open)
  }

  if (loading || authLoading) {
    return (
      <div className="page-center">
        <p className="muted">Carregando…</p>
      </div>
    )
  }

  if (erroCarregar) {
    return (
      <div className="page-center">
        <div className="card empty-state">
          <p>{erroCarregar}</p>
          <Link to="/" className="btn btn-primary">
            Ir para o início
          </Link>
        </div>
      </div>
    )
  }

  if (sucesso) {
    return (
      <div className="layout publico">
        <main className="content">
          <div className="card sucesso-card">
            <span className="sucesso-icone">🎉</span>
            <h2>Agendado!</h2>
            <p>
              <strong>{sucesso.servico}</strong> com {prof.name}
              <br />
              {formatDataLonga(sucesso.data)} às {sucesso.hora}
            </p>
            <p className="muted">
              Seu horário ficou reservado como <strong>pendente</strong> e será
              confirmado em breve.
            </p>
            <Link to="/" className="btn btn-primary btn-block">
              Ver meus agendamentos
            </Link>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="layout publico">
      <header className="prof-capa">
        <Avatar nome={prof.name} foto={prof.photo_url} grande />
        <h1>{prof.name}</h1>
        {prof.bio && <p className="prof-bio">{prof.bio}</p>}
      </header>

      <main className="content">
        {error && <div className="alert alert-error">{error}</div>}

        {services.length === 0 ? (
          <div className="card empty-state">
            <p>Esta agenda ainda não tem serviços disponíveis.</p>
            <p className="muted">Volte em breve. 💖</p>
          </div>
        ) : (
          <>
            <h3 className="secao-titulo">1. Escolha o serviço</h3>
            <div className="servico-catalogo">
              {services.map((s) => {
                const ativo = servicoSel?.id === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={ativo ? 'card servico-card ativo' : 'card servico-card'}
                    onClick={() => {
                      setServicoSel(s)
                      setHoraSel('')
                      setError('')
                    }}
                  >
                    {s.images?.[0] ? (
                      <img className="servico-foto" src={s.images[0]} alt={s.name} />
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
                        <span className="muted servico-desc">{s.description}</span>
                      )}
                      <span className="muted servico-meta">
                        {labelDuracao(s)} · {formatPreco(s.price)}
                      </span>
                    </div>
                    <span className="radio-marca" aria-hidden="true"></span>
                  </button>
                )
              })}
            </div>

            {servicoSel && (
              <>
                <h3 className="secao-titulo">2. Escolha o dia</h3>
                <div className="day-picker">
                  {dias.map((d) => {
                    const iso = toISODate(d)
                    return (
                      <button
                        key={iso}
                        type="button"
                        className={iso === dataSel ? 'day-chip active' : 'day-chip'}
                        disabled={!diaAberto(d)}
                        onClick={() => setDataSel(iso)}
                      >
                        <span className="day-chip-nome">
                          {d
                            .toLocaleDateString('pt-BR', { weekday: 'short' })
                            .replace('.', '')}
                        </span>
                        <span className="day-chip-num">
                          {String(d.getDate()).padStart(2, '0')}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {servicoSel && dataSel && (
              <>
                <h3 className="secao-titulo">3. Escolha o horário</h3>
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
                        type="button"
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
                    às {horaSel} · {formatPreco(servicoSel.price)}
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
          </>
        )}
      </main>

      {mostrarLogin && (
        <AuthModal
          resumo={
            servicoSel && dataSel && horaSel
              ? `${servicoSel.name} com ${prof.name} · ${formatDataLonga(dataSel)} às ${horaSel}`
              : ''
          }
          onClose={() => {
            setMostrarLogin(false)
            setTentandoFechar(false)
          }}
        />
      )}
    </div>
  )
}
