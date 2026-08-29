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
import OfertaVaga from '../../components/OfertaVaga'
import { formatarCents } from '../../lib/indicacao'

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
  const [vagas, setVagas] = useState([])
  const [filas, setFilas] = useState([])
  const [saldo, setSaldo] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchDados = useCallback(async () => {
    const hoje = toISODate(new Date())

    const [profRes, apptRes, vagasRes, filasRes] = await Promise.all([
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
      supabase
        .from('waitlist_offers')
        .select(
          '*, waitlist_entries (id, services (name), professionals (name))',
        )
        .eq('status', 'pendente')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }),
      supabase
        .from('waitlist_entries')
        .select('*, services (name), professionals (name)')
        .eq('status', 'aguardando')
        .order('created_at', { ascending: false }),
    ])

    if (profRes.error) {
      setError('Erro ao carregar: ' + profRes.error.message)
    } else {
      setProfissionais(profRes.data)
      setError('')
    }
    if (!apptRes.error) setMeus(apptRes.data)
    if (!vagasRes.error) setVagas(vagasRes.data)
    if (!filasRes.error) setFilas(filasRes.data)

    const { data: saldoAtual } = await supabase.rpc('saldo_creditos')
    setSaldo(saldoAtual ?? 0)
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
    <div className="layout">
      <Topbar />

      <main className="content">
        <h2>Olá, {nome} 💖</h2>

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

            {filas.length > 0 && (
              <section className="secao">
                <h3 className="secao-titulo">Estou esperando vaga</h3>
                <div className="cliente-list">
                  {filas.map((f) => (
                    <div key={f.id} className="card fila-row">
                      <div className="cliente-info">
                        <span className="cliente-nome">{f.services?.name}</span>
                        <span className="muted cliente-meta">
                          com {f.professionals?.name} ·{' '}
                          {f.window_start.slice(0, 5)}–{f.window_end.slice(0, 5)}{' '}
                          · até {formatDataCurta(f.date_to)}
                        </span>
                      </div>
                      <button
                        className="btn-link-cancelar"
                        onClick={() => sairDaFila(f)}
                      >
                        sair da fila
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <Link to="/indique" className="card indique-atalho">
              <span className="indique-atalho-icone">🎁</span>
              <span className="cliente-info">
                <span className="cliente-nome">Indique e ganhe</span>
                <span className="muted cliente-meta">
                  {saldo > 0
                    ? `Você tem ${formatarCents(saldo)} de crédito`
                    : 'Chame uma amiga e as duas ganham desconto'}
                </span>
              </span>
              <ChevronIcon />
            </Link>

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
