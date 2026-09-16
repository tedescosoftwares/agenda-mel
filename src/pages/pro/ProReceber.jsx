import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import ReceberPeloApp from '../../components/ReceberPeloApp'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

// Receber pelo app, da autônoma (090). Quem trabalha em salão não abre
// conta: o salão recebe, e a dona configura em Admin › Receber pelo app.
export default function ProReceber() {
  const { professional } = useAuth()
  const [dona, setDona] = useState(null)   // null = ainda não sei
  useEffect(() => {
    if (!professional?.salon_id) { setDona(false); return }
    supabase.rpc('meus_saloes').then(({ data }) => setDona((data ?? []).some((s) => (s.meus_saloes ?? s) === professional.salon_id)))
  }, [professional?.salon_id])
  if (!professional) return <SemFicha />
  return (
    <ProShell titulo="Receber pelo app" voltar="/pro/ajustes">
      <div className="page-head">
        <h2>Receber pelo app</h2>
        <p className="muted">{professional.name}</p>
      </div>
      {dona === null ? <p className="muted">Carregando…</p>
        : dona ? <ReceberPeloApp salao={professional.salon_id} nomeSalao={null} />
        : (
          <div className="card empty-state">
            <p><strong>Quem recebe é o salão.</strong></p>
            <p className="muted">Você trabalha num salão, então o pagamento pelo app cai na conta dele e é a dona quem liga isso. Se quiser, mostre esta tela para ela.</p>
            <Link to="/pro/ajustes" className="btn btn-ghost btn-block">Voltar aos ajustes</Link>
          </div>
        )}
    </ProShell>
  )
}
