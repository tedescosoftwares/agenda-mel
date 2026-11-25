import { PauseCircle, LogOut } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { LINK_ASSINAR, dataCurta } from '../lib/acesso'

// Passou a tolerância sem assinar: o painel pausa (126). Nada é apagado;
// a dona assina e volta de onde parou. 3.90: a equipe NÃO vê teste grátis nem
// assinatura (é assunto do salão): só que a agenda está pausada e volta sozinha.
export default function PainelPausado({ para = 'admin', dona: donaDoNegocio }) {
  const { acesso, signOut } = useAuth()
  const dona = para === 'admin'
  if (para === 'pro' && !donaDoNegocio) {
    return (
      <div className="painel-pausado">
        <div className="card painel-pausado-card">
          <span className="painel-pausado-icone"><PauseCircle size={28} /></span>
          <h2>Agenda pausada</h2>
          <p className="muted">O salão pausou a agenda na MIMO por enquanto. Nada foi apagado: seus horários e clientes continuam guardados.</p>
          <p>Quando o salão reativar, tudo volta sozinho por aqui. Qualquer dúvida, fale com o salão.</p>
          <button type="button" className="btn btn-ghost btn-mini" onClick={signOut}><LogOut size={14} /> Sair da conta</button>
        </div>
      </div>
    )
  }
  return (
    <div className="painel-pausado">
      <div className="card painel-pausado-card">
        <span className="painel-pausado-icone"><PauseCircle size={28} /></span>
        <h2>Painel pausado</h2>
        <p className="muted">
          {acesso?.teste ? 'O teste grátis acabou' : 'A assinatura venceu'}{acesso?.ate ? ` em ${dataCurta(acesso.ate)}` : ''} e o prazo pra assinar passou.
          {' '}Nada foi apagado: serviços, equipe, clientes e histórico continuam guardados.
        </p>
        {dona || donaDoNegocio
          ? <><p>Assine pra reabrir o painel e voltar a receber agendamentos na hora.</p><Link to="/admin/assinatura" className="btn btn-primary">Assinar a MIMO</Link><a className="btn btn-ghost btn-mini" href={LINK_ASSINAR}>Falar com a MIMO por e-mail</a></>
          : <p>Fale com a dona do salão: assim que a assinatura estiver em dia, sua agenda volta sozinha.</p>}
        <button type="button" className="btn btn-ghost btn-mini" onClick={signOut}><LogOut size={14} /> Sair da conta</button>
      </div>
    </div>
  )
}
