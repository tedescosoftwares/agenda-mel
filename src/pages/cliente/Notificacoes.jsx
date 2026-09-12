import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import { useNotificacoes } from '../../context/NotificacoesContext'
import { ICONE_AVISO as ICONE, destinoDoAviso, relativo } from '../../lib/avisos'

// Central de avisos (tela 12): um ícone por tipo, o texto, e para onde
// leva. Abrir a tela marca tudo como lido — a pessoa veio olhar, olhou.

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
            const para = destinoDoAviso(a, 'cliente')
            return (
              <Link key={a.id} to={para} className={'card notif-row' + (a.read_at ? '' : ' nova')}>
                <span className="notif-icone" aria-hidden="true">{(() => { const I = ICONE[a.kind] ?? ICONE.teste; return <I size={20} /> })()}</span>
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
