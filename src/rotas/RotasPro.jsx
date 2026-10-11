// /pro/*: a agenda de quem atende (o /pro/entrar fica no App.jsx, com o login)
import '../app.css'
import '../polish.css'
import '../lib/sw'
import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from '../components/ProtectedRoute'
import NaoEncontrada from '../pages/publico/NaoEncontrada'
import Configurar from '../pages/admin/Configurar'
import ProFecharDia from '../pages/pro/ProFecharDia'
import ProAgenda from '../pages/pro/ProAgenda'
import ProServicos from '../pages/pro/ProServicos'
import ProHorarios from '../pages/pro/ProHorarios'
import ProLink from '../pages/pro/ProLink'
import ProNumeros from '../pages/pro/ProNumeros'
import ProRetorno from '../pages/pro/ProRetorno'
import ProAjustes from '../pages/pro/ProAjustes'
import ProPedidos from '../pages/pro/ProPedidos'
import ProEncaixe from '../pages/pro/ProEncaixe'
import ProEnviar from '../pages/pro/ProEnviar'
import ProRecados from '../pages/pro/ProRecados'
import ProPromocoes from '../pages/pro/ProPromocoes'
import ProReceber from '../pages/pro/ProReceber'
import ProLocal from '../pages/pro/ProLocal'
import ProContrato from '../pages/pro/ProContrato'

const P = ({ children }) => <ProtectedRoute requireRole="profissional">{children}</ProtectedRoute>

export default function RotasPro() {
  return (
    <Routes>
      <Route index element={<Navigate to="/pro/agenda" replace />} />
      <Route path="agenda" element={<P><ProAgenda /></P>} />
      <Route path="encaixe" element={<P><ProEncaixe /></P>} />
      <Route path="servicos" element={<P><ProServicos /></P>} />
      <Route path="horarios" element={<P><ProHorarios /></P>} />
      <Route path="link" element={<P><ProLink /></P>} />
      <Route path="numeros" element={<P><ProNumeros /></P>} />
      <Route path="retorno" element={<P><ProRetorno /></P>} />
      <Route path="ajustes" element={<P><ProAjustes /></P>} />
      <Route path="pedidos" element={<P><ProPedidos /></P>} />
      <Route path="enviar" element={<P><ProEnviar /></P>} />
      <Route path="recados" element={<P><ProRecados /></P>} />
      <Route path="fechar-dia" element={<P><ProFecharDia /></P>} />
      <Route path="promocoes" element={<P><ProPromocoes /></P>} />
      <Route path="receber" element={<P><ProReceber /></P>} />
      <Route path="local" element={<P><ProLocal /></P>} />
      <Route path="configurar" element={<P><Configurar para="pro" /></P>} />
      <Route path="contrato" element={<P><ProContrato /></P>} />
      <Route path="*" element={<NaoEncontrada />} />
    </Routes>
  )
}
