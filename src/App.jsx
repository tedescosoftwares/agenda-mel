import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { NotificacoesProvider } from "./context/NotificacoesContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Avisos from "./pages/Avisos";
import PaginaProfissional from "./pages/publico/PaginaProfissional";
import Convite from "./pages/publico/Convite";
import Estilo from "./pages/Estilo";
import ClienteHome from "./pages/cliente/ClienteHome";
import AdminAgenda from "./pages/admin/AdminAgenda";
import AdminProfissionais from "./pages/admin/AdminProfissionais";
import AdminServices from "./pages/admin/AdminServices";
import AdminHours from "./pages/admin/AdminHours";
import AdminClientes from "./pages/admin/AdminClientes";
import AdminNumeros from "./pages/admin/AdminNumeros";
import AdminWhatsapp from "./pages/admin/AdminWhatsapp";
import ProAgenda from "./pages/pro/ProAgenda";
import ProServicos from "./pages/pro/ProServicos";
import ProHorarios from "./pages/pro/ProHorarios";
import ProLink from "./pages/pro/ProLink";
import ProNumeros from "./pages/pro/ProNumeros";
import ProRetorno from "./pages/pro/ProRetorno";
import ProAjustes from "./pages/pro/ProAjustes";
import ProEnviar from "./pages/pro/ProEnviar";
import IndiqueEGanhe from "./pages/cliente/IndiqueEGanhe";
import { guardarCodigoDaURL } from "./lib/indicacao";

export default function App() {
  // o convite chega como /?indique=CODIGO — guardamos antes de qualquer rota
  useEffect(() => {
    guardarCodigoDaURL()
  }, [])

  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificacoesProvider>
          <Routes>
            <Route path="/login" element={<Login />} />

            {/* link público das profissionais — não exige login */}
            <Route path="/p/:slug" element={<PaginaProfissional />} />

            {/* convite para uma profissional entrar no app */}
            <Route path="/convite/:codigo" element={<Convite />} />

            {/* mostruário do sistema visual */}
            <Route path="/estilo" element={<Estilo />} />

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
            <Route
              path="/pro/numeros"
              element={
                <ProtectedRoute requireRole="profissional">
                  <ProNumeros />
                </ProtectedRoute>
              }
            />
            <Route
              path="/pro/retorno"
              element={
                <ProtectedRoute requireRole="profissional">
                  <ProRetorno />
                </ProtectedRoute>
              }
            />
            <Route
              path="/pro/ajustes"
              element={
                <ProtectedRoute requireRole="profissional">
                  <ProAjustes />
                </ProtectedRoute>
              }
            />
            <Route
              path="/pro/enviar"
              element={
                <ProtectedRoute requireRole="profissional">
                  <ProEnviar />
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
              path="/admin/numeros"
              element={
                <ProtectedRoute requireRole="admin">
                  <AdminNumeros />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/whatsapp"
              element={
                <ProtectedRoute requireRole="admin">
                  <AdminWhatsapp />
                </ProtectedRoute>
              }
            />

            <Route
              path="/indique"
              element={
                <ProtectedRoute requireRole="cliente">
                  <IndiqueEGanhe />
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
