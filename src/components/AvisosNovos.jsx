import { Link, useNavigate } from 'react-router-dom'
import { useNotificacoes } from '../context/NotificacoesContext'
import { useAuth } from '../context/AuthContext'
import { ICONE_AVISO, destinoDoAviso, centralDoPapel, relativo } from '../lib/avisos'

// Os avisos ainda não lidos, na tela inicial, em vez de escondidos atrás
// do sininho. Até três; o resto fica na central. Tocar abre e marca lido.
export default function AvisosNovos({ maximo = 3 }) {
  const { avisos, naoLidos, marcarLido, marcarTodosLidos } = useNotificacoes()
  const { role } = useAuth()
  const navigate = useNavigate()
  const novos = avisos.filter((a) => !a.read_at).slice(0, maximo)
  if (novos.length === 0) return null

  return (
    <section className="novidades">
      <div className="secao-cabeca">
        <h3>Novidades <span className="novidades-n">{naoLidos}</span></h3>
        <div className="novidades-acoes">
          {naoLidos > maximo && <Link to={centralDoPapel(role)} className="link-ver">Ver todas</Link>}
          <button type="button" className="link-ver novidades-limpar" onClick={marcarTodosLidos}>Marcar lidas</button>
        </div>
      </div>
      <div className="novidades-lista">
        {novos.map((a) => {
          const Icone = ICONE_AVISO[a.kind] ?? ICONE_AVISO.teste
          return (
            <button key={a.id} type="button" className="card novidade" onClick={() => { marcarLido(a.id); navigate(destinoDoAviso(a, role)) }}>
              <span className="novidade-icone"><Icone size={18} /></span>
              <span className="novidade-texto">
                <strong>{a.title}</strong>
                {a.body && <span className="muted">{a.body}</span>}
              </span>
              <span className="muted novidade-quando">{relativo(a.created_at)}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
