import { Sparkles, BookOpen, Clock, ArrowRight, Crown } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { avisoDoAcesso, REGRAS } from '../lib/acesso'

// O cartão do acesso no topo do painel (126): dias de teste, modo leitura
// ou assinatura vencendo. Some quando não há o que dizer.
// 4.19: na Home do dia a dia o plano é uma linha (`compacto`): quando vence e o atalho para renovar. O cartão grande
// fica para o que pede atenção (`soAlerta`: modo leitura, cobrança, teste acabando).
export default function AcessoAviso({ para = 'admin', compacto = false, soAlerta = false }) {
  const { acesso } = useAuth()
  const a = avisoDoAcesso(acesso, { dona: para === 'admin' })
  if (!a) return null
  const calmo = a.tom === 'calmo'
  if (soAlerta && calmo) return null
  if (compacto) {
    if (!calmo) return null
    const destino = a.acao?.to || '/admin/assinatura'
    // no teste, a barra mostra quanto do período já passou
    const emTeste = acesso?.fase === 'teste' && !acesso?.aguardando_configuracao
    const passou = emTeste ? Math.max(4, Math.min(100, 100 - (Number(acesso.dias ?? 0) / REGRAS.testeDias) * 100)) : null
    return (
      <Link to={destino} className="acesso-linha">
        <span className="acesso-linha-icone"><Crown size={16} /></span>
        <span className="acesso-linha-texto">
          <small>{a.selo}</small>
          <strong>{a.titulo}</strong>
          {passou != null && <span className="acesso-linha-barra"><i style={{ width: `${passou}%` }} /></span>}
        </span>
        <span className="acesso-linha-acao">{a.acao?.rotulo || 'Ver plano'} <ArrowRight size={13} /></span>
      </Link>
    )
  }
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
          {a.acao.to ? <Link className="btn btn-primary acesso-aviso-botao" to={a.acao.to}>{a.acao.rotulo}</Link> : <a className="btn btn-primary acesso-aviso-botao" href={a.acao.href}>{a.acao.rotulo}</a>}
          {a.acao.to !== '/admin/assinatura' && <Link to="/admin/assinatura" className="btn btn-ghost btn-mini">Como funciona</Link>}
        </div>
      )}
    </div>
  )
}
