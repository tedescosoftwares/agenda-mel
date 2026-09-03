import { NavLink, useNavigate } from 'react-router-dom'
import SinoAvisos from './SinoAvisos'
import { MarcaIcon, CalendarIcon, HomeIcon, BellIcon, PessoaIcon, MaisIcon } from './icons'
import { useNotificacoes } from '../context/NotificacoesContext'

// A cliente passa a ter menu de abas, como a profissional e o salão já
// tinham. Antes ela era o único perfil sem — tudo cabia numa tela só, e
// "meus agendamentos" ficava embaixo da lista de quem atende, que é a
// ordem errada para quem já marcou.
//
// O botão do meio não é uma sexta aba: é a ação da casa. Ele leva ao
// Início E abre a busca, porque "quero marcar agora" é a razão de a
// pessoa abrir o app.
const TABS = [
  { to: '/', end: true, label: 'Início', Icon: HomeIcon },
  { to: '/agenda', label: 'Agenda', Icon: CalendarIcon },
  null, // o lugar do botão do meio
  { to: '/avisos', label: 'Avisos', Icon: BellIcon, sino: true },
  { to: '/perfil', label: 'Perfil', Icon: PessoaIcon },
]

export default function ClienteShell({ children }) {
  const navigate = useNavigate()
  const { naoLidos } = useNotificacoes()

  function agendar() {
    navigate('/?buscar=1')
  }

  return (
    <div className="admin-shell">
      <header className="topbar topbar-cliente">
        <span className="brand-inline">
          <MarcaIcon className="marca" id="cliente" />
          MIMO
        </span>
        <div className="topbar-acoes">
          <SinoAvisos />
        </div>
      </header>

      <main className="content">{children}</main>

      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {TABS.map((t) =>
            t === null ? (
              <button key="mais" className="nav-mais" onClick={agendar} aria-label="Marcar horário">
                <MaisIcon />
              </button>
            ) : (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
              >
                <span className="nav-icone">
                  <t.Icon />
                  {t.sino && naoLidos > 0 && <span className="nav-ponto" aria-hidden="true" />}
                </span>
                <span>{t.label}</span>
              </NavLink>
            ),
          )}
        </div>
      </nav>
    </div>
  )
}
