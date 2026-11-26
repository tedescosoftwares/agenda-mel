import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useConfirmaPedidos } from '../lib/meuSalao'

// 4.11: na agenda da profissional da equipe que confirma os próprios pedidos: quantos esperam o sim dela.
export default function PedidosEsperando() {
  const confirma = useConfirmaPedidos()
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!confirma) return
    let vivo = true
    supabase.rpc('meus_pedidos').then(({ data }) => { if (vivo) setN((data ?? []).length) }, () => {})
    return () => { vivo = false }
  }, [confirma])
  if (!confirma || n === 0) return null
  return (
    <Link to="/pro/pedidos" className="card pe-pedidos">
      <span className="pe-pedidos-icone"><Inbox size={20} /></span>
      <span className="pe-pedidos-txt"><strong>{n === 1 ? '1 pedido esperando você' : `${n} pedidos esperando você`}</strong><small>Confirme ou recuse: a cliente é avisada na hora.</small></span>
      <ChevronRight size={18} />
    </Link>
  )
}
