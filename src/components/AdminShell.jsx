import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { CalendarIcon, SparkleIcon, ClockIcon, UsersIcon } from './icons'

const TABS = [
  { to: '/admin', end: true, label: 'Agenda', Icon: CalendarIcon },
  { to: '/admin/servicos', label: 'Serviços', Icon: SparkleIcon },
  { to: '/admin/horarios', label: 'Horários', Icon: ClockIcon },
  { to: '/admin/clientes', label: 'Clientes', Icon: UsersIcon },
]

export default function AdminShell({ children }) {
  const { profile, user, signOut } = useAuth()
  const inicial = (profile?.full_name || user?.email || '?')
    .trim()
    .charAt(0)
    .toUpperCase()

  function handleSair() {
    if (window.confirm('Sair da conta?')) signOut()
  }

  return (
    <div className="admin-shell">
      <header className="topbar topbar-admin">
        <span className="brand-inline">✿ Agenda Mel</span>
        <button className="avatar-btn" onClick={handleSair} title="Sair da conta">
          {inicial}
        </button>
      </header>

      <main className="content admin-content">{children}</main>

      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {TABS.map(({ to, end, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                isActive ? 'nav-item active' : 'nav-item'
              }
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
