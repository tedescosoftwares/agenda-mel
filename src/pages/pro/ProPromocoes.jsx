import { useEffect, useState } from 'react'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import Promocoes from '../../components/Promocoes'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

// Promoções da profissional (083): para as clientes dela.
export default function ProPromocoes() {
  const { professional } = useAuth()
  const [servicos, setServicos] = useState([])
  const [dona, setDona] = useState(false)   // autônoma ou admin: não passa por aprovação
  useEffect(() => {
    if (!professional?.id) return
    supabase.from('professional_services').select('services (id, name, price, is_combo, active)').eq('professional_id', professional.id)
      .then(({ data }) => setServicos((data ?? []).map((v) => v.services).filter((s) => s?.active).sort((a, b) => a.name.localeCompare(b.name))))
  }, [professional?.id])
  useEffect(() => {
    if (!professional?.salon_id) return
    supabase.rpc('meus_saloes').then(({ data }) => setDona((data ?? []).some((s) => (s.meus_saloes ?? s) === professional.salon_id)))
  }, [professional?.salon_id])
  if (!professional) return <SemFicha />
  return (
    <ProShell titulo="Promoções" voltar="/pro/ajustes">
      <div className="page-head">
        <h2>Promoções</h2>
        <p className="muted">{dona ? 'Um criativo para as suas clientes verem na home' : 'Um criativo para as suas clientes. A dona do salão aprova antes de entrar no ar.'}</p>
      </div>
      <Promocoes escopo="profissional" prof={professional.id} salao={professional.salon_id} servicos={servicos} dona={dona} onServicoNovo={(sv) => setServicos((l) => [...l, sv].sort((a, b) => a.name.localeCompare(b.name)))} />
    </ProShell>
  )
}
