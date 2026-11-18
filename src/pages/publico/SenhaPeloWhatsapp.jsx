import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ShieldCheck, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { chamar } from '../../lib/pagamento'
import { useAuth } from '../../context/AuthContext'
import { LogoMimo } from '../../components/icons'
import CampoSenha from '../../components/CampoSenha'
import { LinkLegal } from '../../components/LinkLegal'
import { useDocumentosLegais, aceitesPara, versaoMaior } from '../../lib/legal'

// /s/<token> (3.98, migração 242): o link que a cliente cadastrada pelo WhatsApp recebe (pela assistente, depois de
// marcar, ou pelo "Receber link no WhatsApp" da tela de entrar). O número já está confirmado: aqui ela só cria a senha
// (e, se quiser, põe um e-mail, sem confirmar). O link vale uma vez, por 7 dias; quem confere é a função acesso.
export default function SenhaPeloWhatsapp() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { recarregarPerfil } = useAuth()
  const docs = useDocumentosLegais()
  const [link, setLink] = useState(null)        // { nome, telefone } ou { erro }
  const [senha, setSenha] = useState('')
  const [senha2, setSenha2] = useState('')
  const [email, setEmail] = useState('')
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)
  const [semSessao, setSemSessao] = useState(false)

  useEffect(() => {
    let vivo = true
    chamar('acesso', { acao: 'ver', token })
      .then((r) => { if (vivo) setLink(r) })
      .catch((e) => { if (vivo) setLink({ erro: e.message || 'Esse link não vale mais.' }) })
    return () => { vivo = false }
  }, [token])

  async function criar(e) {
    e.preventDefault()
    setErro('')
    if (senha.length < 8) { setErro('A senha precisa de pelo menos 8 caracteres.'); return }
    if (senha !== senha2) { setErro('As duas senhas não batem.'); return }
    setIndo(true)
    try {
      const r = await chamar('acesso', { acao: 'criar_senha', token, senha, email: email.trim() || null })
      if (!r?.sessao) { setSemSessao(true); return }
      await supabase.auth.setSession(r.sessao)
      // criar a senha aqui vale como aceitar os termos de cliente e a política (o texto está logo acima do botão)
      try { await supabase.rpc('aceitar_termos', { versao: versaoMaior(aceitesPara('cliente', docs)) }) } catch { /* o app pergunta depois */ }
      await recarregarPerfil?.()
      navigate('/', { replace: true })
    } catch (er) {
      setErro(er.message || 'Não deu para criar a senha agora. Tente de novo.')
    } finally {
      setIndo(false)
    }
  }

  return (
    <div className="page-center login-bg">
      <div className="card login-card entrar-card">
        <div className="brand"><LogoMimo altura={60} className="brand-logo" /></div>
        {!link ? (
          <p className="muted login-sub">Abrindo o seu acesso…</p>
        ) : link.erro ? (
          <>
            <h2 className="login-titulo">Esse link não vale mais</h2>
            <p className="muted login-sub">{link.erro}</p>
            <Link to="/login?whats=1" className="btn btn-primary btn-block">Receber outro link</Link>
          </>
        ) : semSessao ? (
          <>
            <h2 className="login-titulo">Senha criada 💗</h2>
            <p className="muted login-sub">Agora é só entrar com o seu WhatsApp e essa senha.</p>
            <Link to="/login" className="btn btn-primary btn-block">Ir para a tela de entrar</Link>
          </>
        ) : (
          <form onSubmit={criar} className="form" data-teste="senha-whatsapp">
            <h2 className="login-titulo">Oi{link.nome ? `, ${link.nome}` : ''}! Crie sua senha</h2>
            <p className="muted login-sub">Seu WhatsApp <b>{link.telefone}</b> já está confirmado. Falta só a senha para entrar no app.</p>
            <span className="whats-confirmado"><ShieldCheck size={15} /> Número confirmado pelo WhatsApp</span>
            <CampoSenha valor={senha} onChange={(e) => setSenha(e.target.value)} rotulo="Nova senha" placeholder="Pelo menos 8 caracteres" minLength={8} autoFocus />
            <CampoSenha valor={senha2} onChange={(e) => setSenha2(e.target.value)} rotulo="Repita a senha" dica={false} minLength={8} />
            <label>
              <span>E-mail <em className="muted">(opcional)</em></span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" autoComplete="email" />
              <small className="muted">Para receber recibos e recuperar a senha por e-mail. Não precisa confirmar.</small>
            </label>
            {erro && <div className="alert alert-error">{erro}</div>}
            <p className="muted whats-termos">Ao criar a senha, você aceita os <LinkLegal tipo="cliente">Termos de uso</LinkLegal> e a <LinkLegal tipo="privacidade">Política de privacidade</LinkLegal>.</p>
            <button type="submit" className="btn btn-primary btn-block" disabled={indo}>{indo ? 'Criando…' : 'Criar senha e entrar'}</button>
            <p className="whats-cadeado"><Lock size={13} /><span>O link vale uma vez. Se expirar, peça outro em <b>Entrar › Receber link no WhatsApp</b>.</span></p>
          </form>
        )}
      </div>
    </div>
  )
}
