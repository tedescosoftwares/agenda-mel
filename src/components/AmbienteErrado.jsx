import { useAuth } from '../context/AuthContext'
import { urlDoAmbiente } from '../lib/ambiente'
import { homeDoPapel } from '../lib/roles'
import { MarcaIcon, Wordmark } from './icons'

// Conta de profissional aberta no endereço da cliente (ou o contrário).
// Não entra sozinha no outro: avisa, e a pessoa escolhe ir ou sair.
export default function AmbienteErrado({ role }) {
  const { signOut } = useAuth()
  const pro = role === 'profissional' || role === 'admin'
  const destino = urlDoAmbiente(pro ? 'pro' : 'cliente', homeDoPapel(role))
  return (
    <div className="page-center login-bg">
      <div className="card login-card" style={{ textAlign: 'center' }}>
        <div className="brand"><MarcaIcon className="brand-icon" width={44} height={40} id="ambiente" /><Wordmark tamanho={2.2} /></div>
        <h2 className="login-titulo">{pro ? 'Essa conta é de quem atende' : 'Essa conta é de cliente'}</h2>
        <p className="muted login-sub">
          {pro
            ? 'Profissionais e salões entram pelo MIMO Pro. Aqui é o app da cliente.'
            : 'Clientes entram pelo MIMO. Aqui é o MIMO Pro, o app de quem atende.'}
        </p>
        <a href={destino} className="btn btn-primary btn-block">{pro ? 'Ir para o MIMO Pro' : 'Ir para o MIMO'}</a>
        <button className="btn btn-ghost btn-block" style={{ marginTop: '0.5rem' }} onClick={signOut}>Sair desta conta</button>
      </div>
    </div>
  )
}
