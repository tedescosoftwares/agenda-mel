import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Topbar({ admin = false, backTo = null }) {
  const { signOut } = useAuth()

  return (
    <header className={admin ? 'topbar topbar-admin' : 'topbar'}>
      <span className="brand-inline">
        {backTo && (
          <Link to={backTo} className="back-link" aria-label="Voltar">
            ←
          </Link>
        )}
        ✿ Agenda Mel{admin ? ' — Admin' : ''}
      </span>
      <button className="btn btn-ghost" onClick={signOut}>
        Sair
      </button>
    </header>
  )
}
