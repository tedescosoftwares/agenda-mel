import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Rocket, ShieldCheck, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { planoDoNegocio, reais } from '../lib/planos'
import { LINHA_DO_TESTE, REGRAS } from '../lib/acesso'

// Ativar (126): o último passo da configuração, explicado antes do botão.
// O salão ganha 7 dias grátis a partir daqui, sem cartão; a autônoma só
// libera o link. `onAtivado(acesso)` recebe o que o banco devolveu.
export default function AtivarSalao({ s, onAtivado, onErro, embutido = false }) {
  const { recarregarAcesso, recarregarPerfil } = useAuth()
  const [indo, setIndo] = useState(false)
  const autonoma = s?.tipo === 'autonoma'
  const plano = planoDoNegocio(s?.tipo, s?.equipe_prevista)
  async function ativar() {
    setIndo(true)
    const { data, error } = await supabase.rpc('salao_ativar', { salao: s.id })
    setIndo(false)
    if (error) { onErro?.('Não deu para ativar agora: ' + error.message); return }
    await Promise.all([recarregarAcesso?.(), recarregarPerfil?.()])
    onAtivado?.(data)
  }
  if (autonoma) {
    return (
      <div className={'card ativar-card' + (embutido ? ' embutido' : '')}>
        <span className="ativar-selo"><Rocket size={12} /> Último passo</span>
        <h3>Liberar o seu link</h3>
        <p className="muted">A partir daqui suas clientes marcam pelo link e pelo QR Code, e a assistente do WhatsApp começa a atender. Sua agenda é grátis: não tem mensalidade nem prazo.</p>
        <button type="button" className="btn btn-primary" onClick={ativar} disabled={indo}>{indo ? 'Liberando…' : 'Liberar meu link'}</button>
      </div>
    )
  }
  return (
    <div className={'card ativar-card' + (embutido ? ' embutido' : '')}>
      <span className="ativar-selo"><Rocket size={12} /> Último passo</span>
      <h3>Ativar o salão e liberar o link</h3>
      <p className="muted">A partir daqui suas clientes marcam pelo link e pelo QR Code, e a assistente do WhatsApp começa a atender. Você entra com <strong>{REGRAS.testeDias} dias grátis</strong>, sem cartão e sem pagar nada hoje.</p>
      <ol className="ativar-linha">
        {LINHA_DO_TESTE.map((e) => (
          <li key={e.quando}><span className="ativar-quando">{e.quando}</span><div><strong>{e.titulo}</strong><small className="muted">{e.texto}</small></div></li>
        ))}
      </ol>
      <div className="ativar-plano">
        <span className="ativar-plano-icone"><Sparkles size={16} /></span>
        <div>
          <strong>Depois do teste: {plano.nome}, {reais(plano.total)}/mês</strong>
          <small className="muted">{s?.equipe_prevista || 1} {Number(s?.equipe_prevista || 1) === 1 ? 'agenda' : 'agendas'} · o plano acompanha as agendas ativas · sem fidelidade, cancela quando quiser</small>
        </div>
        <Link to="/admin/assinatura" className="btn btn-ghost btn-mini">Ver plano</Link>
      </div>
      <div className="ativar-acoes">
        <button type="button" className="btn btn-primary" onClick={ativar} disabled={indo}>{indo ? 'Ativando…' : 'Ativar meu salão'}</button>
        <span className="muted ativar-garantia"><ShieldCheck size={13} /> Sem cartão agora. Você só paga se quiser continuar depois dos {REGRAS.testeDias} dias.</span>
      </div>
    </div>
  )
}
