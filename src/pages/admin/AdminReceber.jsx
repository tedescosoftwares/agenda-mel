import AdminShell from '../../components/AdminShell'
import ReceberPeloApp from '../../components/ReceberPeloApp'
import { useAuth } from '../../context/AuthContext'

// Receber pelo app, do salão (090): a subconta é do salão, e vale para
// toda a equipe.
export default function AdminReceber() {
  const { salao } = useAuth()
  return (
    <AdminShell>
      <div className="page-head">
        <h2>Receber pelo app</h2>
        <p className="muted">{salao?.name ?? 'Meu salão'}</p>
      </div>
      {salao?.id ? <ReceberPeloApp salao={salao.id} nomeSalao={salao.name} /> : <p className="muted">Carregando o salão…</p>}
    </AdminShell>
  )
}
