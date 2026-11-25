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
import ProAvisos from '../pages/pro/ProAvisos'
import ProConta from '../pages/pro/ProConta'
import AdminAssistente from '../pages/admin/AdminAssistente'
import { PARCERIA_LIGADA } from '../lib/contratoParceria'
import { PIX_LIGADO } from '../lib/pixLigado'
import { useDaEquipe } from '../lib/meuSalao'

const P = ({ children }) => <ProtectedRoute requireRole="profissional">{children}</ProtectedRoute>

// 4.9: as telas de quem toca o próprio negócio. A profissional da equipe de um salão não tem essas telas no menu
// (3.90), e agora também não chega nelas digitando o endereço: volta para a agenda dela.
function SoDoNegocio({ children }) {
  const equipe = useDaEquipe()
  return equipe ? <Navigate to="/pro/agenda" replace /> : children
}
const N = ({ children }) => <P><SoDoNegocio>{children}</SoDoNegocio></P>

export default function RotasPro() {
  return (
    <Routes>
      <Route index element={<Navigate to="/pro/agenda" replace />} />
      <Route path="agenda" element={<P><ProAgenda /></P>} />
      <Route path="encaixe" element={<N><ProEncaixe /></N>} />
      <Route path="servicos" element={<N><ProServicos /></N>} />
      <Route path="horarios" element={<P><ProHorarios /></P>} />
      <Route path="link" element={<P><ProLink /></P>} />
      <Route path="numeros" element={<N><ProNumeros /></N>} />
      <Route path="retorno" element={<N><ProRetorno /></N>} />
      <Route path="ajustes" element={<P><ProAjustes /></P>} />
      <Route path="avisos" element={<P><ProAvisos /></P>} />
      <Route path="conta" element={<P><ProConta /></P>} />
      <Route path="pedidos" element={<P><ProPedidos /></P>} />
      <Route path="enviar" element={<N><ProEnviar /></N>} />
      <Route path="recados" element={<N><ProRecados /></N>} />
      <Route path="fechar-dia" element={<P><ProFecharDia /></P>} />
      <Route path="promocoes" element={<N><ProPromocoes /></N>} />
      <Route path="receber" element={PIX_LIGADO ? <P><ProReceber /></P> : <Navigate to="/pro/agenda" replace />} />
      <Route path="local" element={<N><ProLocal /></N>} />
      <Route path="configurar" element={<N><Configurar para="pro" /></N>} />
      <Route path="assistente" element={<N><AdminAssistente para="pro" /></N>} />
      <Route path="contrato" element={PARCERIA_LIGADA ? <P><ProContrato /></P> : <Navigate to="/pro/ajustes" replace />} />
      <Route path="*" element={<NaoEncontrada />} />
    </Routes>
  )
}
