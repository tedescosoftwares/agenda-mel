import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import SinoAvisos from './SinoAvisos'
import {
  CalendarIcon,
  SparkleIcon,
  GraficoIcon,
  VoltarIcon,
  ClockIcon,
  MarcaIcon,
  Wordmark,
} from './icons'

import Avatar from './Avatar'

const TABS = [
  { to: '/pro', end: true, label: 'Agenda', Icon: CalendarIcon },
  { to: '/pro/retorno', label: 'Volta', Icon: VoltarIcon },
  { to: '/pro/numeros', label: 'O mês', Icon: GraficoIcon },
  { to: '/pro/servicos', label: 'Serviços', Icon: SparkleIcon },
  { to: '/pro/ajustes', label: 'Ajustes', Icon: ClockIcon },
]

export default function ProShell({ children, titulo, voltar }) {
  const { professional, profile, user, signOut } = useAuth()
  const nome = professional?.name || profile?.full_name || user?.email

  function handleSair() {
    if (window.confirm('Sair da conta?')) signOut()
  }

  return (
    <div className="admin-shell">
      <header className="topbar topbar-admin">
        {voltar && <NavLink to={voltar} className="topo-voltar" aria-label="Voltar">‹</NavLink>}
        {titulo ? (
          <span className="topo-titulo">{titulo}</span>
        ) : (
          <span className="brand-inline">
            <MarcaIcon className="marca" id="pro" />
            <Wordmark tamanho={1.35} />
          </span>
        )}
        <div className="topbar-acoes">
          <SinoAvisos />
          <button className="avatar-btn" onClick={handleSair} title="Sair da conta">
            <Avatar nome={nome} foto={professional?.photo_url} pequeno />
          </button>
        </div>
      </header>

      <main className="content admin-content">{children}</main>

      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {TABS.map(({ to, end, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
            >
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
