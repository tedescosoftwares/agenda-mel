import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useNotificacoes } from '../context/NotificacoesContext'
import { homeDoPapel } from '../lib/roles'

const ICONE = {
  vaga_disponivel: '🔔',
  agenda_adiantada: '⏩',
  agendamento_confirmado: '✅',
  agendamento_cancelado: '❌',
  agendamento_recusado: '❌',
  indicacao_creditada: '🎁',
  novo_agendamento: '📅',
  lembrete: '💖',
}

export default function Avisos() {
  const { role } = useAuth()
  const { avisos, loading, marcarTodosLidos } = useNotificacoes()
  const navigate = useNavigate()

  // abriu a caixa, leu tudo
  useEffect(() => {
    marcarTodosLidos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand-inline">
          <Link to={homeDoPapel(role)} className="back-link" aria-label="Voltar">
            ←
          </Link>
          Avisos
        </span>
      </header>

      <main className="content">
        {loading ? (
          <p className="muted">Carregando…</p>
        ) : avisos.length === 0 ? (
          <div className="card empty-state">
            <p>Nenhum aviso por aqui.</p>
            <p className="muted">
              Avisamos você quando algo mudar nos seus horários.
            </p>
          </div>
        ) : (
          <div className="aviso-list">
            {avisos.map((a) => (
              <button
                key={a.id}
                className={a.read_at ? 'card aviso-row lido' : 'card aviso-row'}
                onClick={() => a.action_url && navigate(a.action_url)}
              >
                <span className="aviso-icone">{ICONE[a.kind] ?? '🔔'}</span>
                <span className="aviso-texto">
                  <strong>{a.title}</strong>
                  {a.body && <span className="muted">{a.body}</span>}
                  <span className="muted aviso-quando">{quando(a.created_at)}</span>
                </span>
                {!a.read_at && <span className="aviso-ponto" aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function quando(iso) {
  const d = new Date(iso)
  const minutos = Math.floor((Date.now() - d.getTime()) / 60000)
  if (minutos < 1) return 'agora'
  if (minutos < 60) return `há ${minutos} min`
  if (minutos < 60 * 24) return `há ${Math.floor(minutos / 60)} h`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}
