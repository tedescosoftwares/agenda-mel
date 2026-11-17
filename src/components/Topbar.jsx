import { useAuth } from '../context/AuthContext'
import SinoAvisos from './SinoAvisos'
import { LogoMimo } from './icons'
import { ehPro } from '../lib/ambiente'

export default function Topbar() {
  const { signOut } = useAuth()

  return (
    <header className="topbar">
      <span className="brand-inline">
          <LogoMimo altura={30} pro={ehPro} />
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
