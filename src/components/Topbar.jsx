import { useAuth } from '../context/AuthContext'
import SinoAvisos from './SinoAvisos'
import { MarcaIcon, Wordmark } from './icons'

export default function Topbar() {
  const { signOut } = useAuth()

  return (
    <header className="topbar">
      <span className="brand-inline">
          <MarcaIcon className="marca" id="topo" />
          <Wordmark tamanho={1.35} />
        </span>
      <div className="topbar-acoes">
        <SinoAvisos />
        <button className="btn btn-ghost" onClick={signOut}>
          Sair
        </button>
      </div>
    </header>
  )
}
