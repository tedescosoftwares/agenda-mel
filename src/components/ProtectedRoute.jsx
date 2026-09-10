import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homeDoPapel } from '../lib/roles'

// permitirSemVinculo: a tela "Entrar numa agenda" é a única que uma
// cliente sem vínculo pode ver. Todas as outras mandam para lá.
export default function ProtectedRoute({ children, requireRole, permitirSemVinculo = false, permitirPrimeiroAcesso = false }) {
  const { user, role, loading, vinculos, profile } = useAuth()

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

  if (role === 'cliente' && !permitirSemVinculo && (vinculos ?? []).length === 0) {
    return <Navigate to="/cliente/entrar" replace />
  }

  return children
}
