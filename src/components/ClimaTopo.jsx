import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { climaDoSalao, CONDICOES } from '../lib/clima'

// O tempo no cabeçalho do painel (2.86): ícone + cidade + temperatura.
// Some quando o salão não tem pino ou o tempo não veio.
export default function ClimaTopo() {
  const { salao } = useAuth()
  const [clima, setClima] = useState(null)
  useEffect(() => {
    let vivo = true
    climaDoSalao(salao?.id).then((c) => { if (vivo) setClima(c) })
    return () => { vivo = false }
  }, [salao?.id])
  if (!clima?.condicao) return null
  const c = CONDICOES[clima.condicao] ?? CONDICOES.ensolarado
  return (
    <span className="admin-topbar-clima" title={clima.descricao || c.rotulo} aria-label={`${clima.cidade || ''}: ${clima.descricao || c.rotulo}, ${clima.temperatura}°`}>
      <c.Icone size={16} style={{ color: c.cor }} />
      <span>{[clima.cidade, clima.temperatura != null ? `${clima.temperatura}°` : null].filter(Boolean).join(' · ')}</span>
    </span>
  )
}
