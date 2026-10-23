// /cliente/*: o app da cliente, carregado só quando ela entra
import '../app.css'
import '../polish.css'
import '../lib/sw'
import { Routes, Route } from 'react-router-dom'
import ProtectedRoute from '../components/ProtectedRoute'
import NaoEncontrada from '../pages/publico/NaoEncontrada'
import Entrar from '../pages/cliente/Entrar'
import CompletarPerfil from '../pages/cliente/CompletarPerfil'
import ClienteHome from '../pages/cliente/ClienteHome'
import ClienteProfissionais from '../pages/cliente/ClienteProfissionais'
import ClienteProfissional from '../pages/cliente/ClienteProfissional'
import { AgendarServicos, AgendarData, AgendarHora, AgendarConfirmar, AgendarSucesso } from '../pages/cliente/Agendar'
import ClienteAgenda from '../pages/cliente/ClienteAgenda'
import ClienteAgendamento from '../pages/cliente/ClienteAgendamento'
import ClienteServico from '../pages/cliente/ClienteServico'
import ClienteSalao from '../pages/cliente/ClienteSalao'
import ClienteCategoria from '../pages/cliente/ClienteCategoria'
import ClientePerfil from '../pages/cliente/ClientePerfil'
import Indicacao from '../pages/cliente/Indicacao'
import Notificacoes from '../pages/cliente/Notificacoes'
import FilaEspera from '../pages/cliente/FilaEspera'
import ClientePagamento from '../pages/cliente/ClientePagamento'
import ClienteComanda from '../pages/cliente/ClienteComanda'

const C = ({ children }) => <ProtectedRoute requireRole="cliente">{children}</ProtectedRoute>

export default function RotasCliente() {
  return (
    <Routes>
      <Route path="entrar" element={<ProtectedRoute requireRole="cliente" permitirSemVinculo><Entrar /></ProtectedRoute>} />
      <Route path="completar" element={<ProtectedRoute requireRole="cliente" permitirSemVinculo permitirSemTelefone permitirPrimeiroAcesso><CompletarPerfil /></ProtectedRoute>} />
      <Route path="home" element={<C><ClienteHome /></C>} />
      <Route path="profissionais" element={<C><ClienteProfissionais /></C>} />
      <Route path="profissional/:id" element={<C><ClienteProfissional /></C>} />
      <Route path="profissional/:id/servicos" element={<C><AgendarServicos /></C>} />
      <Route path="agendamento/data" element={<C><AgendarData /></C>} />
      <Route path="agendamento/hora" element={<C><AgendarHora /></C>} />
      <Route path="agendamento/confirmar" element={<C><AgendarConfirmar /></C>} />
      <Route path="agendamento/sucesso/:id" element={<C><AgendarSucesso /></C>} />
      <Route path="agendamento/:id" element={<C><ClienteAgendamento /></C>} />
      <Route path="meus-agendamentos" element={<C><ClienteAgenda /></C>} />
      <Route path="fila-espera" element={<C><FilaEspera /></C>} />
      <Route path="perfil" element={<C><ClientePerfil /></C>} />
      <Route path="indicacao" element={<C><Indicacao /></C>} />
      <Route path="notificacoes" element={<C><Notificacoes /></C>} />
      <Route path="salao/:id" element={<C><ClienteSalao /></C>} />
      <Route path="salao/:id/categoria/:cat" element={<C><ClienteCategoria /></C>} />
      <Route path="servico/:id" element={<C><ClienteServico /></C>} />
      <Route path="pagamento/:appt" element={<C><ClientePagamento /></C>} />
      <Route path="comanda/:id" element={<C><ClienteComanda /></C>} />
      <Route path="*" element={<NaoEncontrada />} />
    </Routes>
  )
}
