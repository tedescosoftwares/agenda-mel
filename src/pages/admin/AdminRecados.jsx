import AdminShell from '../../components/AdminShell'
import Recados from '../../components/Recados'
import { useAuth } from '../../context/AuthContext'

// O salão fala com a carteira inteira ou só com a equipe.
export default function AdminRecados() {
  const { salao } = useAuth()
  return (
    <AdminShell>
      <div className="page-head">
        <h2>Recados</h2>
        <p className="muted">{salao?.name ?? 'Meu salão'}</p>
      </div>
      {salao?.id ? (
        <Recados salao={salao.id} publicos={[
          { valor: 'clientes', rotulo: 'Clientes', resumo: 'Toda a carteira do salão' },
          { valor: 'equipe', rotulo: 'Equipe', resumo: 'Profissionais e admins da casa' },
        ]} />
      ) : <p className="muted">Carregando o salão…</p>}
    </AdminShell>
  )
}
