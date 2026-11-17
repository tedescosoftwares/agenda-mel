import { Link } from 'react-router-dom'
import { Sparkles, ArrowRight } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { dataCurta } from '../lib/acesso'

// 3.94: o salão que escolheu os 7 dias grátis vê, discreta, no alto de todas as páginas do painel,
// que está no teste e quanto falta. Só no painel do salão (AdminShell): a cliente e a profissional
// não veem (o teste é assunto da dona).
export default function FaixaDoTeste() {
  const { acesso } = useAuth()
  if (acesso?.fase !== 'teste') return null
  const dias = Number(acesso.dias ?? 0)
  const texto = acesso.aguardando_configuracao
    ? 'Os 7 dias começam a contar quando a agenda estiver pronta'
    : dias <= 1
      ? 'Seu teste acaba hoje'
      : `Faltam ${dias} dias${acesso.ate ? ` · até ${dataCurta(acesso.ate)}` : ''}`
  return (
    <div className={'faixa-teste' + (dias <= 2 && !acesso.aguardando_configuracao ? ' perto' : '')} role="status">
      <span className="faixa-teste-selo"><Sparkles size={13} /> Teste grátis</span>
      <span className="faixa-teste-texto">{texto}</span>
      <Link to="/admin/assinatura" className="faixa-teste-link">Assinar <ArrowRight size={13} /></Link>
    </div>
  )
}
