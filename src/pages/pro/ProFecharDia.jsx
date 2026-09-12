import ProShell from '../../components/ProShell'
import FecharDia from '../../components/FecharDia'

export default function ProFecharDia() {
  return (
    <ProShell titulo="Fechar o dia" voltar="/pro/agenda">
      <p className="muted fechar-intro">Quem veio, quem não veio, quem remarcou. Um toque por cliente; o que você não responder em 3 horas conclui sozinho.</p>
      <FecharDia />
    </ProShell>
  )
}
