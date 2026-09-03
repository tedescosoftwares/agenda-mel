import { useState } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homeDoPapel } from '../lib/roles'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { VERSAO } from '../lib/versao'
import { MarcaIcon, Wordmark } from '../components/icons'

// Login (tela 02): "Bem-vinda de volta!", e-mail, senha, manter
// conectado, e a porta para quem esqueceu a senha ou não tem conta.
// O cadastro fica na mesma tela, trocado por um link — não é uma aba,
// porque quem chega aqui quase sempre já tem conta.
export default function Login() {
  const { user, role, loading, signIn, signUp } = useAuth()
  const [modo, setModo] = useState('login') // login | cadastro | esqueci
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [nome, setNome] = useState('')
  const [fone, setFone] = useState('')
  const [manter, setManter] = useState(true)
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState('')
  const [enviando, setEnviando] = useState(false)

  if (loading) return <div className="page-center"><p className="muted">Carregando…</p></div>
  if (user) return <Navigate to={homeDoPapel(role)} replace />

  async function enviar(e) {
    e.preventDefault()
    setErro(''); setInfo('')
    if (!isSupabaseConfigured) { setErro('Supabase ainda não configurado. Veja o README.'); return }
    setEnviando(true)
    try {
      if (modo === 'login') {
        // "manter conectado" desligado: a sessão vive só nesta aba
        try { if (!manter) sessionStorage.setItem('mimo-sessao-temporaria', '1') } catch {}
        const { error } = await signIn(email, senha)
        if (error) setErro(traduz(error.message))
      } else if (modo === 'cadastro') {
        if (!nome.trim()) { setErro('Diga seu nome.'); return }
        const { error } = await signUp(email, senha, nome.trim(), fone.trim())
        if (error) setErro(traduz(error.message))
        else { setInfo('Conta criada! Confira seu e-mail para confirmar.'); setModo('login') }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/login' })
        if (error) setErro(traduz(error.message))
        else { setInfo('Se esse e-mail tiver conta, mandamos um link para criar uma senha nova.'); setModo('login') }
      }
    } finally { setEnviando(false) }
  }

  const titulo = { login: 'Bem-vinda de volta!', cadastro: 'Criar sua conta', esqueci: 'Recuperar senha' }[modo]
  const sub = { login: 'Entre para continuar', cadastro: 'Leva menos de um minuto', esqueci: 'Mandamos um link para o seu e-mail' }[modo]

  return (
    <div className="page-center login-bg">
      <div className="card login-card">
        <div className="brand">
          <MarcaIcon className="brand-icon" width={52} height={46} id="login" />
          <Wordmark tamanho={2.6} />
          <p className="brand-assinatura">Agenda Mel</p>
        </div>

        <h2 className="login-titulo">{titulo}</h2>
        <p className="muted login-sub">{sub}</p>

        <form onSubmit={enviar} className="form">
          {modo === 'cadastro' && (
            <>
              <label>Nome completo<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Maria da Silva" autoComplete="name" /></label>
              <label>WhatsApp<input type="tel" value={fone} onChange={(e) => setFone(e.target.value)} placeholder="(11) 99999-9999" autoComplete="tel" /></label>
            </>
          )}
          <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" autoComplete="email" required /></label>
          {modo !== 'esqueci' && (
            <label>Senha<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="••••••••" autoComplete={modo === 'login' ? 'current-password' : 'new-password'} minLength={6} required /></label>
          )}

          {modo === 'login' && (
            <div className="login-linha">
              <span className="chave-linha">
                <button type="button" className={'switch' + (manter ? ' on' : '')} onClick={() => setManter(!manter)} role="switch" aria-checked={manter} aria-label="Manter conectado" />
                <span>Manter conectado</span>
              </span>
              <button type="button" className="link-ver" onClick={() => { setModo('esqueci'); setErro('') }}>Esqueci a senha</button>
            </div>
          )}

          {erro && <div className="alert alert-error">{erro}</div>}
          {info && <div className="alert alert-info">{info}</div>}

          <button type="submit" className="btn btn-primary btn-block" disabled={enviando}>
            {enviando ? 'Aguarde…' : modo === 'login' ? 'Entrar' : modo === 'cadastro' ? 'Criar conta' : 'Enviar link'}
          </button>
        </form>

        <p className="login-troca muted">
          {modo === 'login' ? (
            <>Não tem conta? <button type="button" className="link-ver" onClick={() => { setModo('cadastro'); setErro('') }}>Cadastre-se</button></>
          ) : (
            <>Já tem conta? <button type="button" className="link-ver" onClick={() => { setModo('login'); setErro('') }}>Entrar</button></>
          )}
        </p>

        <p className="brand-slogan" style={{ marginTop: '1.2rem', marginBottom: 0, textAlign: 'center' }}>Beleza na palma da mão</p>
        <p className="versao-marca">v{VERSAO}</p>
      </div>
    </div>
  )
}

function traduz(msg) {
  const mapa = {
    'Invalid login credentials': 'E-mail ou senha incorretos.',
    'Email not confirmed': 'Confirme seu e-mail antes de entrar.',
    'User already registered': 'Este e-mail já está cadastrado.',
    'Password should be at least 6 characters': 'A senha precisa ter pelo menos 6 caracteres.',
    'Failed to fetch': 'Não foi possível conectar. Confira sua internet.',
  }
  return mapa[msg] || msg
}
