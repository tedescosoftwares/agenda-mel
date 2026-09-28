import { PauseCircle, LogOut } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { LINK_ASSINAR, dataCurta } from '../lib/acesso'

// Passou a tolerância sem assinar: o painel pausa (126). Nada é apagado;
// a dona assina e volta de onde parou. A equipe vê o mesmo aviso.
export default function PainelPausado({ para = 'admin' }) {
  const { acesso, signOut } = useAuth()
  const dona = para === 'admin'
  return (
    <div className="painel-pausado">
      <div className="card painel-pausado-card">
        <span className="painel-pausado-icone"><PauseCircle size={28} /></span>
        <h2>Painel pausado</h2>
        <p className="muted">
          {acesso?.teste ? 'O teste grátis acabou' : 'A assinatura venceu'}{acesso?.ate ? ` em ${dataCurta(acesso.ate)}` : ''} e o prazo pra assinar passou.
          {' '}Nada foi apagado: serviços, equipe, clientes e histórico continuam guardados.
        </p>
        {dona
          ? <><p>Assine pra reabrir o painel e voltar a receber agendamentos na hora.</p><a className="btn btn-primary" href={LINK_ASSINAR}>Assinar a MIMO</a></>
          : <p>Fale com a dona do salão: assim que a assinatura estiver em dia, sua agenda volta sozinha.</p>}
        <button type="button" className="btn btn-ghost btn-mini" onClick={signOut}><LogOut size={14} /> Sair da conta</button>
      </div>
    </div>
  )
}
