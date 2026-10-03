import { useEffect, useState } from 'react'

// Abaixo de 1024px a configuração inicial troca de forma: cabeçalho
// compacto, catálogo em lista, "Meu cardápio" numa folha, vínculos por
// profissional em vez da matriz.
const CONSULTA = '(max-width: 1023px)'
export default function useCompacto() {
  const [compacto, setCompacto] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(CONSULTA).matches : false))
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(CONSULTA)
    const ouvir = (e) => setCompacto(e.matches)
    mq.addEventListener?.('change', ouvir)
    return () => mq.removeEventListener?.('change', ouvir)
  }, [])
  return compacto
}
