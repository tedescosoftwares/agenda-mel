import { Link, Navigate } from 'react-router-dom'
import { MessageCircle, LogOut } from 'lucide-react'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import { useAuth } from '../../context/AuthContext'
import { useDialogo } from '../../context/DialogoContext'
import { useDaEquipe } from '../../lib/meuSalao'
import FaixaDoSalao from '../../components/pro/FaixaDoSalao'
import { LinhaInstalar } from '../../components/InstalarApp'
import AvisosNoCelular from '../../components/AvisosNoCelular'
import AvisosPorEmail from '../../components/AvisosPorEmail'
import LinkSuporte from '../../components/LinkSuporte'
import Avatar from '../../components/Avatar'
import { LinkIcon, ChevronIcon } from '../../components/icons'
import '../../pro-equipe.css'

// 3.90: a aba "Conta" da profissional da equipe. O salão e o atalho para falar com ele,
// o app na tela de início, como ela quer ser avisada, o link dela e o sair.
// (A autônoma, que é dona do negócio, continua nos Ajustes completos.)
export default function ProConta() {
  const { professional, profile, user, signOut } = useAuth()
  const { confirmar } = useDialogo()
  const equipe = useDaEquipe()

  if (!professional) return <SemFicha />
  if (!equipe) return <Navigate to="/pro/ajustes" replace />

  const nome = professional.name || profile?.full_name || ''

  return (
    <ProShell>
      <div className="pe-perfil">
        <Avatar nome={nome} foto={professional.photo_url ?? profile?.avatar_url} grande />
        <div className="pe-perfil-texto">
          <h2>{nome}</h2>
          {professional.especialidade && <span className="pe-perfil-cargo">{professional.especialidade}</span>}
          {user?.email && <span className="muted pe-perfil-email">{user.email}</span>}
        </div>
      </div>

      <FaixaDoSalao grande />
      <p className="muted pe-dica">Recados do salão chegam em <b>Avisos</b>. Para responder ou combinar algo, use o WhatsApp do salão.</p>

      <h3 className="pe-secao">App no celular</h3>
      <LinhaInstalar />
      <AvisosNoCelular />
      <AvisosPorEmail />

      <h3 className="pe-secao">Sua página</h3>
      <div className="cliente-list">
        <Link to="/pro/link" className="card prof-row">
          <span className="ajuste-icone"><LinkIcon /></span>
          <div className="cliente-info">
            <span className="cliente-nome"><span className="nome-txt">Meu link</span></span>
            <span className="muted cliente-meta">O endereço que você passa para as clientes, e sua foto</span>
          </div>
          <ChevronIcon />
        </Link>
      </div>

      <h3 className="pe-secao">Ajuda</h3>
      <div className="cliente-list">
        <LinkSuporte className="card prof-row">
          <span className="ajuste-icone"><MessageCircle size={20} /></span>
          <div className="cliente-info">
            <span className="cliente-nome"><span className="nome-txt">Problema com o app?</span></span>
            <span className="muted cliente-meta">Fale com a MIMO pelo WhatsApp</span>
          </div>
          <ChevronIcon />
        </LinkSuporte>
      </div>

      <button
        type="button"
        className="btn btn-ghost btn-largo sair-conta pe-sair"
        onClick={async () => { if (await confirmar({ titulo: 'Sair da conta?', ok: 'Sair', cancelar: 'Ficar' })) signOut() }}
      >
        <LogOut size={16} /> Sair da conta
      </button>
    </ProShell>
  )
}
