// /plataforma/*: o olho que tudo vê (055)
import '../app.css'
import '../polish.css'
import '../lib/sw'
import { Routes, Route } from 'react-router-dom'
import ProtectedRoute from '../components/ProtectedRoute'
import NaoEncontrada from '../pages/publico/NaoEncontrada'
import Visao from '../pages/plataforma/Visao'
import Saloes, { Salao } from '../pages/plataforma/Saloes'
import Pessoas from '../pages/plataforma/Pessoas'
import Vinculos from '../pages/plataforma/Vinculos'
import Filas from '../pages/plataforma/Filas'
import Metricas from '../pages/plataforma/Metricas'
import Configuracoes from '../pages/plataforma/Configuracoes'
import PlataformaRecados from '../pages/plataforma/Recados'
import PlataformaMensagens from '../pages/plataforma/Mensagens'
import PlataformaTermos from '../pages/plataforma/Termos'
import PlataformaSeo from '../pages/plataforma/Seo'
import PlataformaPromocoes from '../pages/plataforma/Promocoes'
import PlataformaMel from '../pages/plataforma/Mel'
import PlataformaCatalogo from '../pages/plataforma/Catalogo'
import PlataformaGuia from '../pages/plataforma/Guia'

const T = ({ children }) => <ProtectedRoute requireRole="plataforma">{children}</ProtectedRoute>

export default function RotasPlataforma() {
  return (
    <Routes>
      <Route index element={<T><Visao /></T>} />
      <Route path="saloes" element={<T><Saloes /></T>} />
      <Route path="saloes/:id" element={<T><Salao /></T>} />
      <Route path="pessoas" element={<T><Pessoas /></T>} />
      <Route path="vinculos" element={<T><Vinculos /></T>} />
      <Route path="filas" element={<T><Filas /></T>} />
      <Route path="mensagens" element={<T><PlataformaMensagens /></T>} />
      <Route path="recados" element={<T><PlataformaRecados /></T>} />
      <Route path="promocoes" element={<T><PlataformaPromocoes /></T>} />
      <Route path="metricas" element={<T><Metricas /></T>} />
      <Route path="configuracoes" element={<T><Configuracoes /></T>} />
      <Route path="seo" element={<T><PlataformaSeo /></T>} />
      <Route path="termos" element={<T><PlataformaTermos /></T>} />
      <Route path="mel" element={<T><PlataformaMel /></T>} />
      <Route path="catalogo" element={<T><PlataformaCatalogo /></T>} />
      <Route path="guia" element={<T><PlataformaGuia /></T>} />
      <Route path="*" element={<NaoEncontrada />} />
    </Routes>
  )
}
