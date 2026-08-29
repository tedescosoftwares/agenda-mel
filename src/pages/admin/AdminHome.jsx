import { Link } from 'react-router-dom'
import Topbar from '../../components/Topbar'
import { useAuth } from '../../context/AuthContext'

export default function AdminHome() {
  const { profile, user } = useAuth()
  const nome = profile?.full_name || user?.email

  return (
    <div className="layout">
      <Topbar admin />

      <main className="content">
        <h2>Painel administrativo</h2>
        <p className="muted">Logada como {nome}.</p>

        <div className="grid-cards">
          <div className="card card-soon">
            <h3>📋 Agenda do dia</h3>
            <p className="muted">Ver todos os agendamentos.</p>
            <span className="badge">em breve</span>
          </div>
          <Link to="/admin/servicos" className="card card-link">
            <h3>💅 Serviços</h3>
            <p className="muted">Cadastrar serviços, duração e preços.</p>
          </Link>
          <div className="card card-soon">
            <h3>⏰ Horários</h3>
            <p className="muted">Definir dias e horários de atendimento.</p>
            <span className="badge">em breve</span>
          </div>
          <div className="card card-soon">
            <h3>👥 Clientes</h3>
            <p className="muted">Ver a lista de clientes cadastradas.</p>
            <span className="badge">em breve</span>
          </div>
        </div>
      </main>
    </div>
  )
}
