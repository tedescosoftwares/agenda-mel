import { useEffect, useRef } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import SinoAvisos from './SinoAvisos'
import MenuDaConta, { ITENS_ADMIN } from './MenuDaConta'
import { MarcaIcon, Wordmark } from './icons'
import {
  CalendarIcon,
  UsersIcon,
  ClockIcon,
  MaisIcon,
  HomeIcon,
} from './icons'

// Cinco abas, não seis. Numa barra de celular, seis alvos dão 60px
// cada e o polegar erra. O mês, Serviços e WhatsApp foram para dentro
// de Ajustes: são coisas que se configuram, não o dia a dia.
// O botão do meio é a ação da casa — encaixar alguém agora.
const TABS = [
  { to: '/admin', end: true, label: 'Início', Icon: HomeIcon },
  { to: '/admin/agenda', label: 'Agenda', Icon: CalendarIcon },
  null,
  { to: '/admin/clientes', label: 'Clientes', Icon: UsersIcon },
  { to: '/admin/ajustes', label: 'Ajustes', Icon: ClockIcon },
]

export default function AdminShell({ children }) {
  // só o miolo rola: ao trocar de página, volta para o topo dele
  const miolo = useRef(null)
  const { pathname } = useLocation()
  useEffect(() => { miolo.current?.scrollTo({ top: 0 }) }, [pathname])
  const { salao } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="admin-shell">
      <header className="topbar topbar-admin">
        <span className="brand-inline">
          <MarcaIcon className="marca" id="topo" />
          <Wordmark tamanho={1.35} />
        </span>
        <div className="topbar-acoes">
          <SinoAvisos />
          <MenuDaConta itens={ITENS_ADMIN} papel={salao?.name ? `Dona · ${salao.name}` : 'Dona do salão'} />
        </div>
      </header>

      <main className="content admin-content" ref={miolo}><div className="miolo">{children}</div></main>

      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {TABS.map((t) =>
            t === null ? (
              <button
                key="mais"
                className="nav-mais"
                onClick={() => navigate('/admin/agenda?encaixe=1')}
                aria-label="Novo encaixe"
              >
                <MaisIcon />
              </button>
            ) : (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  isActive ? 'nav-item active' : 'nav-item'
                }
              >
                <t.Icon />
                <span>{t.label}</span>
              </NavLink>
            ),
          )}
        </div>
      </nav>
    </div>
  )
}
