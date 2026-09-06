import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useDialogo } from '../context/DialogoContext'
import { MarcaIcon, Wordmark, HomeIcon, TeamIcon, UsersIcon, BellIcon } from './icons'

// A casa da plataforma (055): quatro abas — Visão geral, Salões,
// Pessoas, Filas. Sem sino de avisos: quem está aqui não é cliente de
// ninguém, está olhando o MIMO inteiro.
const TABS = [
  { to: '/plataforma', end: true, label: 'Visão', Icon: HomeIcon },
  { to: '/plataforma/saloes', label: 'Salões', Icon: TeamIcon },
  { to: '/plataforma/pessoas', label: 'Pessoas', Icon: UsersIcon },
  { to: '/plataforma/filas', label: 'Filas', Icon: BellIcon },
]

export default function PlataformaShell({ children, titulo, voltar }) {
  const { signOut, profile } = useAuth()
  const { confirmar } = useDialogo()
  async function sair() { if (await confirmar({ titulo: 'Sair da conta?', ok: 'Sair', cancelar: 'Ficar' })) signOut() }

  return (
    <div className="admin-shell plataforma">
      <header className="topbar topbar-admin">
        {voltar ? (
          <NavLink to={voltar} className="topo-voltar" aria-label="Voltar">‹</NavLink>
        ) : (
          <span className="brand-inline">
            <MarcaIcon className="marca" id="plataforma" />
            <Wordmark tamanho={1.35} />
            <span className="plat-tag">plataforma</span>
          </span>
        )}
        {titulo && <span className="topo-titulo">{titulo}</span>}
        <div className="topbar-acoes">
          <button className="avatar-btn" onClick={sair} title="Sair da conta">{(profile?.full_name || 'P').charAt(0).toUpperCase()}</button>
        </div>
      </header>
      <main className="content admin-content">{children}</main>
      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}>
              <t.Icon />
              <span>{t.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
