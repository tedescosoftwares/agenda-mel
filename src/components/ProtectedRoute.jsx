import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homeDoPapel } from '../lib/roles'

// permitirSemVinculo: a tela "Entrar numa agenda" é a única que uma
// cliente sem vínculo pode ver. Todas as outras mandam para lá.
export default function ProtectedRoute({ children, requireRole, permitirSemVinculo = false, permitirPrimeiroAcesso = false }) {
  const { user, role, loading, vinculos, profile, erroRede, recarregarVinculos } = useAuth()

  if (loading) {
    return (
      <div className="page-center">
        <p className="muted">Carregando…</p>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // a primeira entrada explica as permissões e recolhe o aceite (064);
  // a plataforma é painel de PC e não passa por ela
  if (!permitirPrimeiroAcesso && profile && !profile.primeiro_acesso_em && role !== 'plataforma') {
    return <Navigate to="/bem-vinda" replace />
  }

  if (requireRole && role !== requireRole) {
    return <Navigate to={homeDoPapel(role)} replace />
  }

  // cliente: só mando para o QR quando SEI que não há agenda. Enquanto
  // não sei (rede falhou), espero e ofereço tentar de novo.
  if (role === 'cliente' && !permitirSemVinculo && vinculos === null) {
    return (
      <div className="page-center">
        <div className="card login-card sem-rede">
          <p className="muted">{erroRede ? 'Sem conexão agora.' : 'Carregando suas agendas…'}</p>
          {erroRede && <button className="btn btn-primary btn-block" onClick={() => recarregarVinculos?.()}>Tentar de novo</button>}
        </div>
      </div>
    )
  }
  if (role === 'cliente' && !permitirSemVinculo && vinculos.length === 0) {
    return <Navigate to="/cliente/entrar" replace />
  }

  return children
}
