import AdminShell from '../../components/AdminShell'
import FecharDia from '../../components/FecharDia'

export default function AdminFecharDia() {
  return (
    <AdminShell>
      <div className="page-head"><div><h2>Fechar o dia</h2><p className="muted titulo-dia">Atendimentos do salão esperando baixa. Um toque por cliente.</p></div></div>
      <FecharDia admin />
    </AdminShell>
  )
}
