import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import ClienteHome from './pages/cliente/ClienteHome'
import AdminHome from './pages/admin/AdminHome'
import AdminServices from './pages/admin/AdminServices'
import AdminHours from './pages/admin/AdminHours'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            path="/"
            element={
              <ProtectedRoute requireRole="cliente">
                <ClienteHome />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <ProtectedRoute requireRole="admin">
                <AdminHome />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/servicos"
            element={
              <ProtectedRoute requireRole="admin">
                <AdminServices />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/horarios"
            element={
              <ProtectedRoute requireRole="admin">
                <AdminHours />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
