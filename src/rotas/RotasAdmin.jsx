// /admin/*: o painel do salão
import '../app.css'
import '../polish.css'
import '../lib/sw'
import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from '../components/ProtectedRoute'
import NaoEncontrada from '../pages/publico/NaoEncontrada'
import AdminDashboard from '../pages/admin/AdminDashboard'
import AdminGuia from '../pages/admin/AdminGuia'
import AdminAgenda from '../pages/admin/AdminAgenda'
import AdminProfissionais from '../pages/admin/AdminProfissionais'
import AdminServices from '../pages/admin/AdminServices'
import AdminHours from '../pages/admin/AdminHours'
import AdminClientes from '../pages/admin/AdminClientes'
import AdminNumeros from '../pages/admin/AdminNumeros'
import AdminWhatsapp from '../pages/admin/AdminWhatsapp'
import AdminRecados from '../pages/admin/AdminRecados'
import AdminAjustes from '../pages/admin/AdminAjustes'
import AdminBancada from '../pages/admin/AdminBancada'
import AdminSalao from '../pages/admin/AdminSalao'
import Configurar from '../pages/admin/Configurar'
import AdminAssinatura from '../pages/admin/AdminAssinatura'
import AdminPromocoes from '../pages/admin/AdminPromocoes'
import AdminReceber from '../pages/admin/AdminReceber'
import AdminParceria from '../pages/admin/AdminParceria'
import AdminPdv from '../pages/admin/AdminPdv'
import AdminRepasses from '../pages/admin/AdminRepasses'
import AdminFecharDia from '../pages/admin/AdminFecharDia'

const A = ({ children }) => <ProtectedRoute requireRole="admin">{children}</ProtectedRoute>

export default function RotasAdmin() {
  return (
    <Routes>
      <Route index element={<A><AdminDashboard /></A>} />
      <Route path="dashboard" element={<Navigate to="/admin" replace />} />
      <Route path="guia" element={<A><AdminGuia /></A>} />
      <Route path="agenda" element={<A><AdminAgenda /></A>} />
      <Route path="equipe" element={<A><AdminProfissionais /></A>} />
      <Route path="equipe/:id/parceria" element={<A><AdminParceria /></A>} />
      <Route path="servicos" element={<A><AdminServices /></A>} />
      <Route path="horarios" element={<A><AdminHours /></A>} />
      <Route path="clientes" element={<A><AdminClientes /></A>} />
      <Route path="numeros" element={<A><AdminNumeros /></A>} />
      <Route path="whatsapp" element={<A><AdminWhatsapp /></A>} />
      <Route path="recados" element={<A><AdminRecados /></A>} />
      <Route path="ajustes" element={<A><AdminAjustes /></A>} />
      <Route path="bancada" element={<A><AdminBancada /></A>} />
      <Route path="salao" element={<A><AdminSalao /></A>} />
      <Route path="configurar" element={<A><Configurar para="admin" /></A>} />
      <Route path="assinatura" element={<A><AdminAssinatura /></A>} />
      <Route path="promocoes" element={<A><AdminPromocoes /></A>} />
      <Route path="receber" element={<A><AdminReceber /></A>} />
      <Route path="pdv" element={<A><AdminPdv /></A>} />
      <Route path="repasses" element={<A><AdminRepasses /></A>} />
      <Route path="fechar-dia" element={<A><AdminFecharDia /></A>} />
      <Route path="*" element={<NaoEncontrada />} />
    </Routes>
  )
}
