import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { NotificacoesProvider } from "./context/NotificacoesContext";
import { DialogoProvider } from "./context/DialogoContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Splash from "./pages/Splash";
import Avisos from "./pages/Avisos";
import PaginaProfissional from "./pages/publico/PaginaProfissional";
import Convite from "./pages/publico/Convite";
import Estilo from "./pages/Estilo";
import ClienteHome from "./pages/cliente/ClienteHome";
import ClienteProfissionais from "./pages/cliente/ClienteProfissionais";
import ClienteProfissional from "./pages/cliente/ClienteProfissional";
import { AgendarServicos, AgendarData, AgendarHora, AgendarConfirmar, AgendarSucesso } from "./pages/cliente/Agendar";
import ClienteAgenda from "./pages/cliente/ClienteAgenda";
import ClientePerfil from "./pages/cliente/ClientePerfil";
import AdminAgenda from "./pages/admin/AdminAgenda";
import AdminProfissionais from "./pages/admin/AdminProfissionais";
import AdminServices from "./pages/admin/AdminServices";
import AdminHours from "./pages/admin/AdminHours";
import AdminClientes from "./pages/admin/AdminClientes";
import AdminNumeros from "./pages/admin/AdminNumeros";
import AdminWhatsapp from "./pages/admin/AdminWhatsapp";
import AdminBancada from "./pages/admin/AdminBancada";
import AdminAjustes from "./pages/admin/AdminAjustes";
import AdminDashboard from "./pages/admin/AdminDashboard";
import ProAgenda from "./pages/pro/ProAgenda";
import ProServicos from "./pages/pro/ProServicos";
import ProHorarios from "./pages/pro/ProHorarios";
import ProLink from "./pages/pro/ProLink";
import ProNumeros from "./pages/pro/ProNumeros";
import ProRetorno from "./pages/pro/ProRetorno";
import ProAjustes from "./pages/pro/ProAjustes";
import ProPedidos from "./pages/pro/ProPedidos";
import ProEncaixe from "./pages/pro/ProEncaixe";
import ProEnviar from "./pages/pro/ProEnviar";
import Indicacao from "./pages/cliente/Indicacao";
import Notificacoes from "./pages/cliente/Notificacoes";
import FilaEspera from "./pages/cliente/FilaEspera";
import Entrar from "./pages/cliente/Entrar";
import EntrarPorCodigo from "./pages/publico/EntrarPorCodigo";
import Comecar from "./pages/publico/Comecar";
import ComCodigo from "./pages/publico/ComCodigo";
import Visao from "./pages/plataforma/Visao";
import Saloes, { Salao } from "./pages/plataforma/Saloes";
import Pessoas from "./pages/plataforma/Pessoas";
import Vinculos from "./pages/plataforma/Vinculos";
import Filas from "./pages/plataforma/Filas";
import Metricas from "./pages/plataforma/Metricas";
import Configuracoes from "./pages/plataforma/Configuracoes";
import PlataformaRecados from "./pages/plataforma/Recados";
import PlataformaMensagens from "./pages/plataforma/Mensagens";
import { Termos, Privacidade } from "./pages/publico/Legal";
import BemVinda from "./pages/BemVinda";
import CadastroCliente from "./pages/cliente/CadastroCliente";
import AvisoCookies from "./components/AvisoCookies";
import AvisoAoVivo from "./components/AvisoAoVivo";
import ProRecados from "./pages/pro/ProRecados";
import AdminRecados from "./pages/admin/AdminRecados";
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
          <DialogoProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/pro/entrar" element={<Login ambiente="pro" />} />
            <Route path="/splash" element={<Splash />} />

            {/* link público das profissionais — não exige login */}
            <Route path="/p/:slug" element={<PaginaProfissional />} />

            {/* convite para uma profissional entrar no app */}
            <Route path="/convite/:codigo" element={<Convite />} />

            {/* o QR/link de entrar numa agenda, e a porta de quem vai atender */}
            <Route path="/v/:codigo" element={<EntrarPorCodigo />} />
            <Route path="/comecar" element={<Comecar />} />
            <Route path="/entrar" element={<ComCodigo />} />
            <Route path="/cadastro" element={<CadastroCliente />} />
            <Route path="/termos" element={<Termos />} />
            <Route path="/privacidade" element={<Privacidade />} />
            <Route path="/bem-vinda" element={<ProtectedRoute permitirSemVinculo permitirPrimeiroAcesso><BemVinda /></ProtectedRoute>} />
            <Route
              path="/cliente/entrar"
              element={
                <ProtectedRoute requireRole="cliente" permitirSemVinculo>
                  <Entrar />
                </ProtectedRoute>
              }
            />

            {/* mostruário do sistema visual */}
            <Route path="/estilo" element={<Estilo />} />

            <Route path="/" element={<Splash />} />
            <Route
              path="/cliente/home"
              element={
                <ProtectedRoute requireRole="cliente">
                  <ClienteHome />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cliente/profissionais"
              element={
                <ProtectedRoute requireRole="cliente">
                  <ClienteProfissionais />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cliente/profissional/:id"
              element={
                <ProtectedRoute requireRole="cliente">
                  <ClienteProfissional />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cliente/profissional/:id/servicos"
              element={
                <ProtectedRoute requireRole="cliente">
                  <AgendarServicos />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cliente/agendamento/data"
              element={
                <ProtectedRoute requireRole="cliente">
                  <AgendarData />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cliente/agendamento/hora"
              element={
                <ProtectedRoute requireRole="cliente">
                  <AgendarHora />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cliente/agendamento/confirmar"
              element={
                <ProtectedRoute requireRole="cliente">
                  <AgendarConfirmar />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cliente/agendamento/sucesso/:id"
              element={
                <ProtectedRoute requireRole="cliente">
                  <AgendarSucesso />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cliente/meus-agendamentos"
              element={
                <ProtectedRoute requireRole="cliente">
                  <ClienteAgenda />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cliente/fila-espera"
              element={
                <ProtectedRoute requireRole="cliente">
                  <FilaEspera />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cliente/perfil"
              element={
                <ProtectedRoute requireRole="cliente">
                  <ClientePerfil />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cliente/indicacao"
              element={
                <ProtectedRoute requireRole="cliente">
                  <Indicacao />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cliente/notificacoes"
              element={
                <ProtectedRoute requireRole="cliente">
                  <Notificacoes />
                </ProtectedRoute>
              }
            />
            <Route path="/agenda" element={<Navigate to="/cliente/meus-agendamentos" replace />} />
            <Route path="/perfil" element={<Navigate to="/cliente/perfil" replace />} />
            <Route path="/indique" element={<Navigate to="/cliente/indicacao" replace />} />


            {/* área da profissional */}
            <Route path="/pro" element={<Navigate to="/pro/agenda" replace />} />
            <Route
              path="/pro/agenda"
              element={
                <ProtectedRoute requireRole="profissional">
                  <ProAgenda />
                </ProtectedRoute>
              }
            />
            <Route
              path="/pro/encaixe"
              element={
                <ProtectedRoute requireRole="profissional">
                  <ProEncaixe />
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
              path="/pro/pedidos"
              element={
                <ProtectedRoute requireRole="profissional">
                  <ProPedidos />
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
            <Route
              path="/pro/recados"
              element={
                <ProtectedRoute requireRole="profissional">
                  <ProRecados />
                </ProtectedRoute>
              }
            />

            {/* a plataforma: o olho que tudo vê (055) */}
            <Route path="/plataforma" element={<ProtectedRoute requireRole="plataforma"><Visao /></ProtectedRoute>} />
            <Route path="/plataforma/saloes" element={<ProtectedRoute requireRole="plataforma"><Saloes /></ProtectedRoute>} />
            <Route path="/plataforma/saloes/:id" element={<ProtectedRoute requireRole="plataforma"><Salao /></ProtectedRoute>} />
            <Route path="/plataforma/pessoas" element={<ProtectedRoute requireRole="plataforma"><Pessoas /></ProtectedRoute>} />
            <Route path="/plataforma/vinculos" element={<ProtectedRoute requireRole="plataforma"><Vinculos /></ProtectedRoute>} />
            <Route path="/plataforma/filas" element={<ProtectedRoute requireRole="plataforma"><Filas /></ProtectedRoute>} />
            <Route path="/plataforma/mensagens" element={<ProtectedRoute requireRole="plataforma"><PlataformaMensagens /></ProtectedRoute>} />
            <Route path="/plataforma/recados" element={<ProtectedRoute requireRole="plataforma"><PlataformaRecados /></ProtectedRoute>} />
            <Route path="/plataforma/metricas" element={<ProtectedRoute requireRole="plataforma"><Metricas /></ProtectedRoute>} />
            <Route path="/plataforma/configuracoes" element={<ProtectedRoute requireRole="plataforma"><Configuracoes /></ProtectedRoute>} />

            {/* área do salão */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute requireRole="admin">
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route path="/admin/dashboard" element={<Navigate to="/admin" replace />} />
            <Route
              path="/admin/agenda"
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
              path="/admin/recados"
              element={
                <ProtectedRoute requireRole="admin">
                  <AdminRecados />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/ajustes"
              element={
                <ProtectedRoute requireRole="admin">
                  <AdminAjustes />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/bancada"
              element={
                <ProtectedRoute requireRole="admin">
                  <AdminBancada />
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
          <AvisoCookies />
          <AvisoAoVivo />
          </DialogoProvider>
        </NotificacoesProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
