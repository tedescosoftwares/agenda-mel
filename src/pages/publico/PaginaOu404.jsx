import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { seoDaRota } from '../../lib/conteudoPublico'
import PaginaSeo from './PaginaSeo'
import NaoEncontrada from './NaoEncontrada'

// Rota que o código não conhece: pode ser uma página criada na Plataforma
// (seo_pages publicada, com conteúdo) ou, aí sim, a página não encontrada.
export default function PaginaOu404() {
  const { pathname } = useLocation()
  const [estado, setEstado] = useState('vendo')
  useEffect(() => {
    let vivo = true
    setEstado('vendo')
    seoDaRota(pathname).then((p) => vivo && setEstado(p && p.h1 && p.doBanco ? 'pagina' : 'nada')).catch(() => vivo && setEstado('nada'))
    return () => { vivo = false }
  }, [pathname])
  if (estado === 'vendo') return null
  return estado === 'pagina' ? <PaginaSeo /> : <NaoEncontrada />
}
