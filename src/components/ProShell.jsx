import { useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import SinoAvisos from './SinoAvisos'
import MenuDaConta, { ITENS_PRO } from './MenuDaConta'
import {
  CalendarIcon,
  SparkleIcon,
  GraficoIcon,
  VoltarIcon,
  ClockIcon,
  MarcaIcon,
  Wordmark,
} from './icons'


const TABS = [
  { to: '/pro', end: true, label: 'Agenda', Icon: CalendarIcon },
  { to: '/pro/retorno', label: 'Volta', Icon: VoltarIcon },
  { to: '/pro/numeros', label: 'O mês', Icon: GraficoIcon },
  { to: '/pro/servicos', label: 'Serviços', Icon: SparkleIcon },
  { to: '/pro/ajustes', label: 'Ajustes', Icon: ClockIcon },
]

export default function ProShell({ children, titulo, voltar }) {
  // só o miolo rola: ao trocar de página, volta para o topo dele
  const miolo = useRef(null)
  const { pathname } = useLocation()
  useEffect(() => { miolo.current?.scrollTo({ top: 0 }) }, [pathname])
  const { professional } = useAuth()

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
          <MenuDaConta itens={ITENS_PRO} papel={professional?.especialidade || 'Profissional'} foto={professional?.photo_url} />
        </div>
      </header>

      <main className="content admin-content" ref={miolo}><div className="miolo">{children}</div></main>

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
