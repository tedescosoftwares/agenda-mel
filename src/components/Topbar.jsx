import { useAuth } from '../context/AuthContext'
import SinoAvisos from './SinoAvisos'

export default function Topbar() {
  const { signOut } = useAuth()

  return (
    <header className="topbar">
      <span className="brand-inline">✿ Agenda Mel</span>
      <div className="topbar-acoes">
        <SinoAvisos />
        <button className="btn btn-ghost" onClick={signOut}>
          Sair
        </button>
      </div>
    </header>
  )
}
