import { NavLink, useNavigate } from 'react-router-dom'
import { ScanLine } from 'lucide-react'
import SinoAvisos from './SinoAvisos'
import { MarcaIcon, Wordmark, HomeIcon, CalendarioCheckIcon, BellIcon, PessoaIcon } from './icons'
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

export default function ClienteShell({ children, titulo, voltar, semTopo = false }) {
  const { naoLidos } = useNotificacoes()
  const navigate = useNavigate()

  return (
    <div className="admin-shell">
      {!semTopo && (
        <header className="topbar topbar-cliente">
          {voltar ? (
            <NavLink to={voltar} className="topo-voltar" aria-label="Voltar">
              ‹
            </NavLink>
          ) : null}
          {titulo ? (
            <span className="topo-titulo">{titulo}</span>
          ) : (
            <span className="brand-inline">
              <MarcaIcon className="marca" id="cliente" />
              <Wordmark tamanho={1.35} />
            </span>
          )}
          <div className="topbar-acoes">
            <SinoAvisos />
          </div>
        </header>
      )}

      <main className="content">{children}</main>

      <nav className="bottom-nav">
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
                {t.sino && naoLidos > 0 && <span className="nav-ponto" aria-hidden="true" />}
              </span>
              <span>{t.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
