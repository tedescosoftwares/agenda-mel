import { useEffect, useState } from 'react'
import AdminShell from '../../components/AdminShell'
import Promocoes from '../../components/Promocoes'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

// Promoções do salão (083): valem para toda a carteira da casa.
export default function AdminPromocoes() {
  const { salao } = useAuth()
  const [servicos, setServicos] = useState([])
  useEffect(() => {
    if (!salao?.id) return
    supabase.from('services').select('id, name, price, is_combo').eq('salon_id', salao.id).eq('active', true).order('name').then(({ data }) => setServicos(data ?? []))
  }, [salao?.id])
  return (
    <AdminShell>
      <div className="page-head">
        <h2>Promoções</h2>
        <p className="muted">{salao?.name ?? 'Meu salão'}</p>
      </div>
      {salao?.id ? <Promocoes escopo="salao" salao={salao.id} servicos={servicos} onServicoNovo={(sv) => setServicos((l) => [...l, sv].sort((a, b) => a.name.localeCompare(b.name)))} /> : <p className="muted">Carregando o salão…</p>}
    </AdminShell>
  )
}
