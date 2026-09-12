import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ClipboardCheck, ChevronRight } from 'lucide-react'

// "N atendimentos esperando sua baixa": a porta para Fechar o dia, só
// quando tem algo esperando.
export default function PendenciasBaixa({ para = '/pro/fechar-dia' }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    let vivo = true
    supabase.rpc('pendencias_de_baixa').then(({ data }) => { if (vivo) setN((data ?? []).filter((p) => p.situacao === 'esperando').length) })
    return () => { vivo = false }
  }, [])
  if (!n) return null
  return (
    <Link to={para} className="card pendencias-baixa">
      <span className="pendencias-icone"><ClipboardCheck size={20} /></span>
      <span className="cliente-info">
        <span className="cliente-nome"><span className="nome-txt">{n} {n === 1 ? 'atendimento esperando' : 'atendimentos esperando'} sua baixa</span></span>
        <span className="muted cliente-meta">Veio, não veio ou remarcamos. Sem resposta, conclui sozinho em 3 h.</span>
      </span>
      <ChevronRight size={18} />
    </Link>
  )
}
