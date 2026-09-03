import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import { useNotificacoes } from '../../context/NotificacoesContext'

// Central de avisos (tela 12): um ícone por tipo, o texto, e para onde
// leva. Abrir a tela marca tudo como lido — a pessoa veio olhar, olhou.
const ICONE = {
  agendamento_confirmado: '📅', pedido_aceito: '✅', pedido_recusado: '😔',
  lembrete_agendamento: '⏰', vaga_disponivel: '⏰', agenda_adiantada: '⚡',
  convite_retorno: '💛', pos_atendimento: '💆', indicacao_creditada: '🎁',
  profissional_cancelou: '⚠️', agendamento_cancelado: '⚠️', novo_agendamento: '🗓️',
  remarcacao_aceita: '🔁', remarcacao_recusada: '😔',
}
const DESTINO = {
  agendamento_confirmado: '/cliente/meus-agendamentos', pedido_aceito: '/cliente/meus-agendamentos',
  pedido_recusado: '/cliente/home', lembrete_agendamento: '/cliente/meus-agendamentos',
  vaga_disponivel: '/cliente/meus-agendamentos', indicacao_creditada: '/cliente/indicacao',
  remarcacao_aceita: '/cliente/meus-agendamentos', remarcacao_recusada: '/cliente/meus-agendamentos',
}

export default function Notificacoes() {
  const { avisos, naoLidos, loading, marcarTodosLidos } = useNotificacoes()

  useEffect(() => {
    if (!loading && naoLidos > 0) marcarTodosLidos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, naoLidos])

  return (
    <ClienteShell titulo="Notificações">
      {loading ? (
        <p className="muted">Carregando…</p>
      ) : avisos.length === 0 ? (
        <div className="card empty-state"><p>Nenhum aviso por enquanto.</p></div>
      ) : (
        <div className="cliente-list">
          {avisos.map((a) => {
            const para = DESTINO[a.kind] || a.action_url || '/cliente/home'
            return (
              <Link key={a.id} to={para} className={'card notif-row' + (a.read_at ? '' : ' nova')}>
                <span className="notif-icone" aria-hidden="true">{ICONE[a.kind] ?? '🔔'}</span>
                <span className="cliente-info">
                  <span className="cliente-nome"><span className="nome-txt">{a.title}</span></span>
                  {a.body && <span className="muted cliente-meta">{a.body}</span>}
                  <span className="muted notif-quando">{relativo(a.created_at)}</span>
                </span>
                <span className="notif-seta">›</span>
              </Link>
            )
          })}
        </div>
      )}
    </ClienteShell>
  )
}

function relativo(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.round(h / 24)
  if (d === 1) return 'ontem'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}
