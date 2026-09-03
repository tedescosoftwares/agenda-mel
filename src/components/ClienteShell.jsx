import { NavLink } from 'react-router-dom'
import SinoAvisos from './SinoAvisos'
import { MarcaIcon, Wordmark, HomeIcon, CalendarioCheckIcon, BellIcon, PessoaIcon } from './icons'
import { useNotificacoes } from '../context/NotificacoesContext'

// As quatro abas da cliente, como no painel: Início, Agendamentos,
// Avisos, Perfil. Sem botão do meio — marcar começa no Início, tocando
// numa profissional, e um "+" solto perguntaria "mais o quê?".
const TABS = [
  { to: '/cliente/home', label: 'Início', Icon: HomeIcon },
  { to: '/cliente/meus-agendamentos', label: 'Agendamentos', Icon: CalendarioCheckIcon },
  { to: '/cliente/notificacoes', label: 'Avisos', Icon: BellIcon, sino: true },
  { to: '/cliente/perfil', label: 'Perfil', Icon: PessoaIcon },
]

export default function ClienteShell({ children, titulo, voltar, semTopo = false }) {
  const { naoLidos } = useNotificacoes()

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
          {TABS.map((t) => (
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
