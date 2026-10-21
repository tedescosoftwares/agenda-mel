import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { naoContarAqui } from '../lib/eventos'
import { presencaNaPagina } from '../lib/presenca'

// O site ao vivo (3.44): avisa o módulo de presença a cada troca de página.
// Espera a sessão resolver, como useVisita: quem é da Plataforma não conta
// (e o navegador fica marcado para não contar mais).
export default function Presenca() {
  const { pathname } = useLocation()
  const { role, loading } = useAuth()
  useEffect(() => {
    if (loading) return
    if (role === 'plataforma') { naoContarAqui(true); presencaNaPagina(null); return }
    presencaNaPagina(pathname)
  }, [pathname, role, loading])
  return null
}
