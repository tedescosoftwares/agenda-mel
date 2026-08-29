import { useAuth } from '../context/AuthContext'

export default function Topbar() {
  const { signOut } = useAuth()

  return (
    <header className="topbar">
      <span className="brand-inline">✿ Agenda Mel</span>
      <button className="btn btn-ghost" onClick={signOut}>
        Sair
      </button>
    </header>
  )
}
