// /admin/*: o painel do salão
import '../app.css'
import '../polish.css'
import '../lib/sw'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import ProtectedRoute from '../components/ProtectedRoute'
import { useAuth } from '../context/AuthContext'
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
import { PARCERIA_LIGADA } from '../lib/contratoParceria'
import { PIX_LIGADO } from '../lib/pixLigado'

// 4.51 (migração 279): a recepção só abre agenda, clientes, comanda (PDV), fechar o dia e ajuda; o resto volta para a
// agenda. As mudanças que ela não pode fazer também são barradas no banco.
const DA_RECEPCAO = ['/admin/agenda', '/admin/clientes', '/admin/pdv', '/admin/fechar-dia', '/admin/guia']
export const recepcaoPode = (caminho) => DA_RECEPCAO.some((r) => caminho === r || caminho.startsWith(r + '/'))
function SoParaQuemPode({ children }) {
  const { papelNoSalao } = useAuth()
  const { pathname } = useLocation()
  if (papelNoSalao === 'recepcao' && !recepcaoPode(pathname)) return <Navigate to="/admin/agenda" replace />
  return children
}
const A = ({ children }) => <ProtectedRoute requireRole="admin"><SoParaQuemPode>{children}</SoParaQuemPode></ProtectedRoute>
// 3.96: a assistente virou a aba Assistente da área WhatsApp (o ?inicio=1 do fim da configuração vai junto)
function ParaWhatsapp() { const { search } = useLocation(); return <Navigate to={'/admin/whatsapp' + search} replace /> }

export default function RotasAdmin() {
  return (
    <Routes>
      <Route index element={<A><AdminDashboard /></A>} />
      <Route path="dashboard" element={<Navigate to="/admin" replace />} />
      <Route path="guia" element={<A><AdminGuia /></A>} />
      <Route path="agenda" element={<A><AdminAgenda /></A>} />
      <Route path="equipe" element={<A><AdminProfissionais /></A>} />
      <Route path="equipe/:id/parceria" element={PARCERIA_LIGADA ? <A><AdminParceria /></A> : <Navigate to="/admin/equipe" replace />} />
      <Route path="servicos" element={<A><AdminServices /></A>} />
      <Route path="horarios" element={<A><AdminHours /></A>} />
      <Route path="clientes" element={<A><AdminClientes /></A>} />
      <Route path="numeros" element={<A><AdminNumeros /></A>} />
      <Route path="whatsapp" element={<A><AdminWhatsapp /></A>} />
      <Route path="assistente" element={<ParaWhatsapp />} />
      <Route path="recados" element={<A><AdminRecados /></A>} />
      <Route path="ajustes" element={<A><AdminAjustes /></A>} />
      {import.meta.env.DEV && <Route path="bancada" element={<A><AdminBancada /></A>} />}
      <Route path="salao" element={<A><AdminSalao /></A>} />
      <Route path="configurar" element={<A><Configurar para="admin" /></A>} />
      <Route path="assinatura" element={<A><AdminAssinatura /></A>} />
      <Route path="promocoes" element={<A><AdminPromocoes /></A>} />
      <Route path="receber" element={PIX_LIGADO ? <A><AdminReceber /></A> : <Navigate to="/admin/ajustes" replace />} />
      <Route path="pdv" element={<A><AdminPdv /></A>} />
      <Route path="repasses" element={<A><AdminRepasses /></A>} />
      <Route path="fechar-dia" element={<A><AdminFecharDia /></A>} />
      <Route path="*" element={<NaoEncontrada />} />
    </Routes>
  )
}
