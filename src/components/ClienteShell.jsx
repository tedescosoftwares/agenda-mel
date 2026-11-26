import { useEffect, useRef } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { ScanLine, ChevronLeft, Compass } from 'lucide-react'
import SinoAvisos from './SinoAvisos'
import AvaliarConvite from './AvaliarConvite'
import CienciaGate from './CienciaGate'
import { HomeIcon, CalendarioCheckIcon, BellIcon, PessoaIcon, LogoMimo } from './icons'
import { useNotificacoes } from '../context/NotificacoesContext'

// As quatro abas da cliente e, no meio, o botão de ler QR: é assim que
// ela entra numa agenda nova, então fica à mão em toda tela.
const TABS = [
  { to: '/cliente/home', label: 'Início', Icon: HomeIcon },
  { to: '/cliente/meus-agendamentos', label: 'Agenda', Icon: CalendarioCheckIcon },
  null,
  { to: '/cliente/notificacoes', label: 'Avisos', Icon: BellIcon, sino: true },
  { to: '/cliente/perfil', label: 'Perfil', Icon: PessoaIcon },
]

// Enquanto ela está marcando (serviços → data → hora → confirmar → sucesso)
// ou pagando, o convite de avaliar não entra no topo: competia com a
// tarefa e empurrava a trilha. Volta a aparecer nas outras telas.
const NO_FLUXO = /^\/cliente\/(agendamento\/(data|hora|confirmar|sucesso)|pagamento\/|profissional\/[^/]+\/servicos)/

export default function ClienteShell({ children, titulo, voltar, semTopo = false }) {
  // só o miolo rola: ao trocar de página, volta para o topo dele
  const miolo = useRef(null)
  const { pathname } = useLocation()
  useEffect(() => { miolo.current?.scrollTo({ top: 0 }) }, [pathname])
  const { naoLidos } = useNotificacoes()
  // 4.14: o rodapé fixo das telas (Agendar horário, Escolher data) fica encostado no menu de baixo. A altura do menu
  // muda com o aparelho e com a fonte; uma altura fixa no CSS deixava o botão meio escondido atrás dele.
  const menu = useRef(null)
  useEffect(() => {
    const el = menu.current
    if (!el) return
    const medir = () => document.documentElement.style.setProperty('--cli-menu-h', `${Math.round(el.getBoundingClientRect().height)}px`)
    medir()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null
    ro?.observe(el)
    window.addEventListener('resize', medir)
    return () => { ro?.disconnect(); window.removeEventListener('resize', medir) }
  }, [])
  const navigate = useNavigate()

  return (
    <div className="admin-shell cliente-shell">
      {/* 4.11: no computador, o menu fica na lateral (como no salão e na profissional); a barra de baixo some */}
      <aside className="admin-desktop-sidebar pro-sidebar cli-sidebar" aria-label="Navegação principal">
        <div className="admin-sidebar-marca">
          <span><LogoMimo altura={38} /></span>
        </div>
        <nav className="admin-sidebar-nav">
          {TABS.filter(Boolean).map(({ to, label, Icon, sino }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'admin-sidebar-item ativo' : 'admin-sidebar-item')}>
              <Icon width={18} height={18} />
              <span>{label}</span>
              {sino && naoLidos > 0 && <span className="pro-sidebar-contador">{naoLidos > 9 ? '9+' : naoLidos}</span>}
            </NavLink>
          ))}
          <NavLink to="/saloes" className="admin-sidebar-item"><Compass size={18} /><span>Guia de salões</span></NavLink>
        </nav>
        <div className="admin-sidebar-rodape pro-sidebar-rodape">
          <button type="button" className="cli-sidebar-qr" onClick={() => navigate('/cliente/entrar')}><ScanLine size={18} /><span><strong>Entrar em um salão</strong><small>Com o código ou o link dele</small></span></button>
        </div>
      </aside>

      <div className="admin-shell-workspace">
      {!semTopo && (
        <header className="topbar topbar-cliente">
          {typeof voltar === 'function' ? (
            <button type="button" onClick={voltar} className="topo-voltar" aria-label="Voltar"><ChevronLeft size={22} /></button>
          ) : voltar ? (
            <NavLink to={voltar} className="topo-voltar" aria-label="Voltar">
              <ChevronLeft size={22} />
            </NavLink>
          ) : null}
          {titulo ? (
            <span className="topo-titulo">{titulo}</span>
          ) : (
            <span className="brand-inline">
              <LogoMimo altura={30} />
            </span>
          )}
          <div className="topbar-acoes">
            <SinoAvisos to="/cliente/notificacoes" />
          </div>
        </header>
      )}

      <CienciaGate />
      <main className="content" ref={miolo}>
        <div className="miolo">
          {!semTopo && !NO_FLUXO.test(pathname) && <AvaliarConvite />}
          {children}
        </div>
      </main>

      </div>

      <nav className="bottom-nav" ref={menu}>
        <div className="bottom-nav-inner">
          {TABS.map((t) => t === null ? (
            <button key="qr" className="nav-mais nav-qr" onClick={() => navigate('/cliente/entrar?modo=camera')} aria-label="Ler QR de uma agenda">
              <ScanLine />
              <span>Ler QR</span>
            </button>
          ) : (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
            >
              <span className="nav-icone">
                <t.Icon />
                {t.sino && naoLidos > 0 && <span className="nav-contador" aria-label={`${naoLidos} avisos novos`}>{naoLidos > 9 ? '9+' : naoLidos}</span>}
              </span>
              <span>{t.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
