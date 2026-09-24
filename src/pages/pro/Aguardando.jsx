import { Store, Clock } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { MarcaIcon, Wordmark } from '../../components/icons'

// A profissional entrou (pelo link da equipe ou por uma conta antiga),
// mas a agenda dela ainda não está pronta: o salão não terminou de
// configurar (rascunho) ou desativou o acesso (inativa). Nada de
// pedir pra ela montar a própria operação.
export default function Aguardando({ situacao }) {
  const { professional, signOut } = useAuth()
  const inativa = situacao === 'inativa'
  return (
    <div className="page-center login-bg">
      <div className="card login-card entrar-card">
        <div className="brand"><MarcaIcon className="brand-icon" width={44} height={40} id="aguardando" /><Wordmark tamanho={2.2} /></div>
        <span className="ativar-check espera">{inativa ? <Store size={22} /> : <Clock size={22} />}</span>
        <h2 className="login-titulo">{inativa ? 'Sua agenda está desativada' : 'O salão está montando sua agenda'}</h2>
        <p className="muted login-sub">
          {inativa
            ? 'O salão desativou o seu acesso por enquanto. Fale com a administração para reativar.'
            : `Seus dados chegaram${professional?.name ? `, ${professional.name.split(' ')[0]}` : ''}. Assim que o salão terminar de configurar serviços, horários e permissões, você entra aqui e encontra tudo pronto.`}
        </p>
        <button type="button" className="btn btn-ghost btn-block" onClick={signOut}>Sair</button>
      </div>
    </div>
  )
}
