import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { MarcaIcon, Wordmark } from '../../components/icons'

// Onde o link de criar (ou redefinir) a senha cai (3.71): o convite da conta criada pela Plataforma,
// o "esqueci a senha" do login. O link já abre a sessão; aqui a pessoa só escolhe a senha.
export default function CriarSenha() {
  const { user, role, loading, recarregarPerfil } = useAuth()
  const navigate = useNavigate()
  const [senha, setSenha] = useState('')
  const [senha2, setSenha2] = useState('')
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)
  const [pronta, setPronta] = useState(false)
  // a sessão do link pode levar um instante para entrar; só depois disso a tela diz que o link não vale
  const [esperou, setEsperou] = useState(false)
  useEffect(() => { const t = setTimeout(() => setEsperou(true), 2500); return () => clearTimeout(t) }, [])

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    if (senha.length < 8) { setErro('A senha precisa ter pelo menos 8 caracteres.'); return }
    if (senha !== senha2) { setErro('As duas senhas não batem.'); return }
    setIndo(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    setIndo(false)
    if (error) { setErro(error.message); return }
    setPronta(true)
    await recarregarPerfil?.()
  }
  const destino = role === 'admin' ? '/admin' : role === 'profissional' ? '/pro/agenda' : role === 'plataforma' ? '/plataforma' : '/'

  return (
    <div className="page-center login-bg">
      <div className="card login-card entrar-card">
        <div className="brand"><MarcaIcon className="brand-icon" width={44} height={40} id="senha" /><Wordmark tamanho={2.2} /></div>
        {pronta ? (
          <>
            <span className="ativar-check"><Check size={22} /></span>
            <h2 className="login-titulo">Senha criada 💗</h2>
            <p className="muted login-sub">Pronto. Da próxima vez é só entrar com o seu e-mail e essa senha.</p>
            <button type="button" className="btn btn-primary btn-block" onClick={() => navigate(destino, { replace: true })}>Entrar na MIMO</button>
          </>
        ) : loading || (!user && !esperou) ? (
          <p className="muted login-sub">Abrindo o seu acesso…</p>
        ) : !user ? (
          <>
            <h2 className="login-titulo">Esse link não vale mais</h2>
            <p className="muted login-sub">Ele já foi usado ou venceu. Peça um novo em "Esqueci a senha" na tela de entrar.</p>
            <Link to="/login" className="btn btn-primary btn-block">Ir para a tela de entrar</Link>
          </>
        ) : (
          <form onSubmit={salvar} className="form" data-teste="criar-senha">
            <h2 className="login-titulo"><KeyRound size={20} /> Crie a sua senha</h2>
            <p className="muted login-sub">Para a conta {user.email}. Use pelo menos 8 caracteres.</p>
            <label>Nova senha<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" autoFocus /></label>
            <label>Repita a senha<input type="password" value={senha2} onChange={(e) => setSenha2(e.target.value)} autoComplete="new-password" /></label>
            {erro && <div className="alert alert-error">{erro}</div>}
            <button type="submit" className="btn btn-primary btn-block" disabled={indo}>{indo ? 'Salvando…' : 'Salvar senha e entrar'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
