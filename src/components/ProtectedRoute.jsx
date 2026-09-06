import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homeDoPapel } from '../lib/roles'

// permitirSemVinculo: a tela "Entrar numa agenda" é a única que uma
// cliente sem vínculo pode ver. Todas as outras mandam para lá.
export default function ProtectedRoute({ children, requireRole, permitirSemVinculo = false }) {
  const { user, role, loading, vinculos } = useAuth()

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

  if (requireRole && role !== requireRole) {
    return <Navigate to={homeDoPapel(role)} replace />
  }

  if (role === 'cliente' && !permitirSemVinculo && (vinculos ?? []).length === 0) {
    return <Navigate to="/cliente/entrar" replace />
  }

  return children
}
