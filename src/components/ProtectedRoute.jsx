import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children, requireRole }) {
  const { user, role, loading } = useAuth()

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
    // logada mas sem permissão: manda pra área correspondente ao papel dela
    return <Navigate to={role === 'admin' ? '/admin' : '/'} replace />
  }

  return children
}
