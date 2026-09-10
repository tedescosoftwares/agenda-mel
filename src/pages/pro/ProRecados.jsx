import ProShell from '../../components/ProShell'
import Recados from '../../components/Recados'
import SemFicha from './SemFicha'
import { useAuth } from '../../context/AuthContext'

// A profissional manda um recado para as clientes dela: quem já marcou
// com ela ou entrou pelo código dela. Chega no app e no celular.
export default function ProRecados() {
  const { professional } = useAuth()
  if (!professional) return <SemFicha />
  return (
    <ProShell>
      <div className="page-head">
        <h2>Recados</h2>
        <p className="muted">Um aviso para todas as suas clientes de uma vez</p>
      </div>
      <Recados publicos={[{ valor: 'minhas_clientes', rotulo: 'Minhas clientes', resumo: 'Quem já marcou com você ou entrou pelo seu código. Chega no app e, para quem ligou, no celular.' }]} />
    </ProShell>
  )
}
