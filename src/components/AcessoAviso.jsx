import { Sparkles, BookOpen, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { avisoDoAcesso } from '../lib/acesso'

// O cartão do acesso no topo do painel (126): dias de teste, modo leitura
// ou assinatura vencendo. Some quando não há o que dizer.
export default function AcessoAviso({ para = 'admin' }) {
  const { acesso } = useAuth()
  const a = avisoDoAcesso(acesso, { dona: para === 'admin' })
  if (!a) return null
  const Icone = a.tom === 'alerta' ? BookOpen : a.tom === 'atencao' ? Clock : Sparkles
  return (
    <div className={`card acesso-aviso ${a.tom}`}>
      <div className="acesso-aviso-texto">
        <span className="acesso-selo"><Icone size={12} /> {a.selo}</span>
        <strong>{a.titulo}</strong>
        <span className="muted">{a.texto}</span>
      </div>
      {a.acao && (
        <div className="acesso-aviso-acoes">
          <a className="btn btn-primary acesso-aviso-botao" href={a.acao.href}>{a.acao.rotulo}</a>
          <Link to="/admin/assinatura" className="btn btn-ghost btn-mini">Como funciona</Link>
        </div>
      )}
    </div>
  )
}
