import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { NotificacoesProvider } from "./context/NotificacoesContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Avisos from "./pages/Avisos";
import PaginaProfissional from "./pages/publico/PaginaProfissional";
import ClienteHome from "./pages/cliente/ClienteHome";
import AdminAgenda from "./pages/admin/AdminAgenda";
import AdminProfissionais from "./pages/admin/AdminProfissionais";
import AdminServices from "./pages/admin/AdminServices";
import AdminHours from "./pages/admin/AdminHours";
import AdminClientes from "./pages/admin/AdminClientes";
import ProAgenda from "./pages/pro/ProAgenda";
import ProServicos from "./pages/pro/ProServicos";
import ProHorarios from "./pages/pro/ProHorarios";
import ProLink from "./pages/pro/ProLink";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificacoesProvider>
          <Routes>
            <Route path="/login" element={<Login />} />

            {/* link público das profissionais — não exige login */}
            <Route path="/p/:slug" element={<PaginaProfissional />} />

            <Route
              path="/"
              element={
                <ProtectedRoute requireRole="cliente">
                  <ClienteHome />
                </ProtectedRoute>
              }
            />

            {/* área da profissional */}
            <Route
              path="/pro"
              element={
                <ProtectedRoute requireRole="profissional">
                  <ProAgenda />
                </ProtectedRoute>
              }
            />
            <Route
              path="/pro/servicos"
              element={
                <ProtectedRoute requireRole="profissional">
                  <ProServicos />
                </ProtectedRoute>
              }
            />
            <Route
              path="/pro/horarios"
              element={
                <ProtectedRoute requireRole="profissional">
                  <ProHorarios />
                </ProtectedRoute>
              }
            />
            <Route
              path="/pro/link"
              element={
                <ProtectedRoute requireRole="profissional">
                  <ProLink />
                </ProtectedRoute>
              }
            />

            {/* área do salão */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute requireRole="admin">
                  <AdminAgenda />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/equipe"
              element={
                <ProtectedRoute requireRole="admin">
                  <AdminProfissionais />
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
            <Route
              path="/admin/clientes"
              element={
                <ProtectedRoute requireRole="admin">
                  <AdminClientes />
                </ProtectedRoute>
              }
            />

            <Route
              path="/avisos"
              element={
                <ProtectedRoute>
                  <Avisos />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </NotificacoesProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
