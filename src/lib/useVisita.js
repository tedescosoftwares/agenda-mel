import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { registrarVisita, naoContarAqui } from './eventos'

// A visita de uma página do guia (3.11), quando a página existe de verdade.
// Espera a sessão resolver: quem está logado na Plataforma não conta (vale
// em mimo.com.vc e em pro.mimo.com.vc, porque a sessão é a mesma) e o
// navegador fica marcado para os cliques também não contarem. Para quem
// não está logado, a sessão resolve na hora e não há atraso.
export function useVisita(caminho, pronta = true) {
  const { role, loading } = useAuth()
  useEffect(() => {
    if (!pronta || !caminho || loading) return
    if (role === 'plataforma') { naoContarAqui(true); return }
    registrarVisita(caminho)
  }, [caminho, pronta, loading, role])
}
