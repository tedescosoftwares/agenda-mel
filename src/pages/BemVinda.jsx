import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { homeDoPapel } from '../lib/roles'
import { TERMOS_VERSAO } from '../lib/termos'
import AvisosNoCelular from '../components/AvisosNoCelular'
import { MarcaIcon, Wordmark, CameraIcon, PinoIcon, EscudoIcon } from '../components/icons'

// A primeira entrada (064): explica as permissões antes de o sistema
// pedir, e recolhe o aceite dos termos de quem ainda não deu. Aparece
// uma vez por conta. As permissões de verdade só são pedidas no toque
// da pessoa (avisos aqui, câmera na hora de ler o QR) — é regra do
// iPhone e é o certo.
export default function BemVinda() {
  const { profile, role, recarregarPerfil } = useAuth()
  const navigate = useNavigate()
  const precisaAceitar = !profile?.aceitou_termos_em || profile?.termos_versao !== TERMOS_VERSAO
  const [aceito, setAceito] = useState(!precisaAceitar)
  const [indo, setIndo] = useState(false)
  const [erro, setErro] = useState('')
  const primeiro = (profile?.full_name ?? '').split(' ')[0]

  async function comecar() {
    setIndo(true); setErro('')
    if (precisaAceitar) {
      const { error } = await supabase.rpc('aceitar_termos', { versao: TERMOS_VERSAO })
      if (error) { setErro(error.message); setIndo(false); return }
    }
    const { error } = await supabase.rpc('concluir_primeiro_acesso')
    if (error) { setErro(error.message); setIndo(false); return }
    await recarregarPerfil?.()
    navigate(homeDoPapel(role), { replace: true })
  }

  return (
    <div className="page-center login-bg">
      <div className="card login-card bemvinda">
        <div className="brand"><MarcaIcon className="brand-icon" width={44} height={40} id="bemvinda" /><Wordmark tamanho={2.2} /></div>
        <h2 className="login-titulo">{primeiro ? `Oi, ${primeiro}!` : 'Bem-vinda!'}</h2>
        <p className="muted login-sub">Antes de começar, três coisas rápidas sobre o que o MIMO pede ao seu celular.</p>

        <AvisosNoCelular icone />

        <div className="card cl-ajuste avisos-celular">
          <span className="ajuste-icone"><CameraIcon /></span>
          <div className="cliente-info">
            <span className="cliente-nome"><span className="nome-txt">Câmera</span></span>
            <span className="muted cliente-meta">Só na hora de ler o QR de uma profissional. O celular pergunta nesse momento; nenhuma imagem é enviada ou guardada.</span>
          </div>
        </div>

        <div className="card cl-ajuste avisos-celular">
          <span className="ajuste-icone"><PinoIcon /></span>
          <div className="cliente-info">
            <span className="cliente-nome"><span className="nome-txt">Localização</span></span>
            <span className="muted cliente-meta">Não pedimos. O MIMO não usa onde você está.</span>
          </div>
        </div>

        <div className="card cl-ajuste avisos-celular">
          <span className="ajuste-icone"><EscudoIcon /></span>
          <div className="cliente-info">
            <span className="cliente-nome"><span className="nome-txt">Seus dados</span></span>
            <span className="muted cliente-meta">Ficam só com você e com as profissionais que você escolher. Sem venda, sem rastreio, sem anúncio. <Link to="/privacidade" target="_blank">Ler a política</Link></span>
          </div>
        </div>

        {precisaAceitar && (
          <label className="aceite-termos">
            <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} />
            <span>Li e aceito os <Link to="/termos" target="_blank">Termos de uso</Link> e a <Link to="/privacidade" target="_blank">Política de privacidade</Link>.</span>
          </label>
        )}
        {erro && <div className="alert alert-error">{erro}</div>}
        <button className="btn btn-primary btn-block" onClick={comecar} disabled={!aceito || indo}>{indo ? 'Um instante…' : 'Começar'}</button>
      </div>
    </div>
  )
}
