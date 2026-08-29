import { useAuth } from '../../context/AuthContext'

export default function AdminHome() {
  const { profile, user, signOut } = useAuth()
  const nome = profile?.full_name || user?.email

  return (
    <div className="layout">
      <header className="topbar topbar-admin">
        <span className="brand-inline">✿ Agenda Mel — Admin</span>
        <button className="btn btn-ghost" onClick={signOut}>
          Sair
        </button>
      </header>

      <main className="content">
        <h2>Painel administrativo</h2>
        <p className="muted">Logada como {nome}. Em breve você poderá:</p>

        <div className="grid-cards">
          <div className="card">
            <h3>📋 Agenda do dia</h3>
            <p className="muted">Ver todos os agendamentos.</p>
          </div>
          <div className="card">
            <h3>💅 Serviços</h3>
            <p className="muted">Cadastrar serviços, duração e preços.</p>
          </div>
          <div className="card">
            <h3>⏰ Horários</h3>
            <p className="muted">Definir dias e horários de atendimento.</p>
          </div>
          <div className="card">
            <h3>👥 Clientes</h3>
            <p className="muted">Ver a lista de clientes cadastradas.</p>
          </div>
        </div>
      </main>
    </div>
  )
}
