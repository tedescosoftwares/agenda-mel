import { useAuth } from '../../context/AuthContext'

export default function ClienteHome() {
  const { profile, user, signOut } = useAuth()
  const nome = profile?.full_name || user?.email

  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand-inline">✿ Agenda Mel</span>
        <button className="btn btn-ghost" onClick={signOut}>
          Sair
        </button>
      </header>

      <main className="content">
        <h2>Olá, {nome} 💖</h2>
        <p className="muted">Bem-vinda à sua área. Em breve você poderá:</p>

        <div className="grid-cards">
          <div className="card">
            <h3>📅 Agendar</h3>
            <p className="muted">Escolher serviço, dia e horário.</p>
          </div>
          <div className="card">
            <h3>🗓️ Meus agendamentos</h3>
            <p className="muted">Ver, remarcar ou cancelar horários.</p>
          </div>
          <div className="card">
            <h3>💅 Serviços</h3>
            <p className="muted">Conhecer os serviços e valores.</p>
          </div>
        </div>
      </main>
    </div>
  )
}
