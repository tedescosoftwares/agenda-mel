import { useEffect, useState } from 'react'

// um valor que só muda depois de a pessoa parar de digitar (3.38: a busca de "todas as cidades" pede ao banco, não a cada tecla)
export function useLento(valor, ms = 350) {
  const [lento, setLento] = useState(valor)
  useEffect(() => {
    const t = setTimeout(() => setLento(valor), ms)
    return () => clearTimeout(t)
  }, [valor, ms])
  return lento
}
