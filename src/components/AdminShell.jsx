import { useEffect, useRef } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PainelPausado from './PainelPausado'
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
import { Sparkles, UserRound, WalletCards, Megaphone, BookOpen, Settings2, ChevronLeft, CreditCard } from 'lucide-react'

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

const DESKTOP_NAV = [
  { to: '/admin', end: true, label: 'Início', Icon: HomeIcon },
  { to: '/admin/agenda', label: 'Agenda', Icon: CalendarIcon },
  { to: '/admin/clientes', label: 'Clientes', Icon: UsersIcon },
  { to: '/admin/servicos', label: 'Serviços', Icon: Sparkles },
  { to: '/admin/equipe', label: 'Profissionais', Icon: UserRound },
  { to: '/admin/numeros', label: 'Financeiro', Icon: WalletCards },
  { to: '/admin/promocoes', label: 'Marketing', Icon: Megaphone },
  { to: '/admin/guia', label: 'Guia', Icon: BookOpen },
  { to: '/admin/ajustes', label: 'Ajustes', Icon: Settings2 },
]

export default function AdminShell({ children, amplo = false }) {
  // só o miolo rola: ao trocar de página, volta para o topo dele
  const miolo = useRef(null)
  const { pathname } = useLocation()
  useEffect(() => { miolo.current?.scrollTo({ top: 0 }) }, [pathname])
  const { salao, acesso } = useAuth()
  const navigate = useNavigate()

  return (
    <div className={'admin-shell' + (amplo ? ' admin-shell-amplo' : '')}>
      <aside className="admin-desktop-sidebar" aria-label="Navegação principal">
        <div className="admin-sidebar-marca">
          <span><MarcaIcon className="marca" id="lateral" /><Wordmark tamanho={1.55} /></span>
          <ChevronLeft size={17} />
        </div>
        <nav className="admin-sidebar-nav">
          {DESKTOP_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => isActive ? 'admin-sidebar-item ativo' : 'admin-sidebar-item'}
            >
              <item.Icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-rodape">
          <LinkAssinatura />
        </div>
      </aside>

      <header className="topbar topbar-admin">
        <div className="topbar-admin-esquerda">
          <span className="brand-inline">
            <MarcaIcon className="marca" id="topo" />
            <Wordmark tamanho={1.35} />
          </span>
          <span className="admin-topbar-salao">
            <strong>{salao?.name || 'Meu salão'}</strong>
            <small><i></i> Painel do salão</small>
          </span>
        </div>
        <div className="topbar-acoes">
          <SinoAvisos />
          <MenuDaConta itens={ITENS_ADMIN} papel={salao?.name ? `Administração · ${salao.name}` : 'Administração do salão'} />
        </div>
      </header>

      <main className="content admin-content" ref={miolo}><div className="miolo">{acesso?.fase === 'bloqueado' ? <PainelPausado para="admin" /> : children}</div></main>

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

function LinkAssinatura() {
  return (
    <NavLink to="/admin/assinatura" className="admin-sidebar-plano">
      <span className="admin-sidebar-plano-icone"><CreditCard size={16} /></span>
      <span><strong>Plano e assinatura</strong><small>Ver acesso e cobrança</small></span>
    </NavLink>
  )
}
