import ProShell from '../../components/ProShell'
import AgendaDia from '../../components/AgendaDia'
import SemFicha from './SemFicha'
import { useAuth } from '../../context/AuthContext'

export default function ProAgenda() {
  const { professional } = useAuth()
  if (!professional) return <SemFicha />

  const hoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <ProShell>
      <div className="page-head">
        <div>
          <h2>Minha agenda</h2>
          <p className="muted titulo-dia">{hoje}</p>
        </div>
      </div>
      <AgendaDia professionalId={professional.id} />
    </ProShell>
  )
}
