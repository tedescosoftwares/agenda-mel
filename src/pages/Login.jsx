import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homeDoPapel } from '../lib/roles'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { VERSAO } from '../lib/versao'
import { MarcaIcon, Wordmark } from '../components/icons'
import { extrairCodigo, guardarConvite } from '../lib/convite'

// Login (tela 02): "Bem-vinda de volta!", e-mail, senha, manter
// conectado, e a porta para quem esqueceu a senha ou não tem conta.
// O cadastro fica na mesma tela, trocado por um link.
//
// Duas coisas podem chegar pela URL e mudam o que o cadastro grava:
//   ?convite=ANA7K2   veio de um QR/link de uma agenda: o código vai nos
//                     metadados da conta e o servidor cria o vínculo
//   ?papel=autonoma|salao   veio de /comecar: a conta nasce como
//                     profissional (salão de uma) ou dona de salão
export default function Login() {
  const { user, role, loading, signIn, signUp } = useAuth()
  const [q] = useSearchParams()
  const convite = extrairCodigo(q.get('convite'))
  const papel = ['autonoma', 'salao'].includes(q.get('papel')) ? q.get('papel') : ''
  const [modo, setModo] = useState(q.get('modo') === 'cadastro' ? 'cadastro' : 'login') // login | cadastro | esqueci
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [nome, setNome] = useState('')
  const [fone, setFone] = useState('')
  const [negocio, setNegocio] = useState(q.get('negocio') || '')
  const [cidade, setCidade] = useState(q.get('cidade') || '')
  const [manter, setManter] = useState(true)
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [quemConvidou, setQuemConvidou] = useState(null)

  useEffect(() => {
    if (!convite) return
    guardarConvite(convite)
    supabase.rpc('resolver_codigo', { chave: convite }).then(({ data }) => setQuemConvidou(data ?? null))
  }, [convite])

  if (loading) return <div className="page-center"><p className="muted">Carregando…</p></div>
  if (user) return <Navigate to={homeDoPapel(role)} replace />

  async function enviar(e) {
    e.preventDefault()
    setErro(''); setInfo('')
    if (!isSupabaseConfigured) { setErro('Supabase ainda não configurado. Veja o README.'); return }
    setEnviando(true)
    try {
      if (modo === 'login') {
        try { if (!manter) sessionStorage.setItem('mimo-sessao-temporaria', '1') } catch { /* sem storage */ }
        const { error } = await signIn(email, senha)
        if (error) setErro(traduz(error.message))
      } else if (modo === 'cadastro') {
        if (!nome.trim()) { setErro('Diga seu nome.'); return }
        if (!fone.trim()) { setErro('Precisamos do seu WhatsApp: é por ele que os avisos chegam.'); return }
        if (papel === 'salao' && !negocio.trim()) { setErro('Diga o nome do salão.'); return }
        const extra = {}
        if (convite) extra.codigo_convite = convite
        if (papel) { extra.papel_desejado = papel; extra.nome_negocio = negocio.trim() || null; extra.cidade = cidade.trim() || null }
        const { error } = await signUp(email, senha, nome.trim(), fone.trim(), extra)
        if (error) setErro(traduz(error.message))
        else { setInfo('Conta criada! Confira seu e-mail para confirmar e depois entre aqui.'); setModo('login') }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/login' })
        if (error) setErro(traduz(error.message))
        else { setInfo('Se esse e-mail tiver conta, mandamos um link para criar uma senha nova.'); setModo('login') }
      }
    } finally { setEnviando(false) }
  }

  const titulo = modo === 'login' ? 'Bem-vinda de volta!'
    : modo === 'esqueci' ? 'Recuperar senha'
    : papel === 'salao' ? 'Cadastrar meu salão'
    : papel === 'autonoma' ? 'Criar minha agenda'
    : 'Criar sua conta'
  const sub = modo === 'login' ? 'Entre para continuar'
    : modo === 'esqueci' ? 'Mandamos um link para o seu e-mail'
    : papel ? 'Leva um minuto. Depois é só compartilhar seu código com as clientes.'
    : 'Leva menos de um minuto'

  return (
    <div className="page-center login-bg">
      <div className="card login-card">
        <div className="brand">
          <MarcaIcon className="brand-icon" width={52} height={46} id="login" />
          <Wordmark tamanho={2.6} />
          <p className="brand-assinatura">Agenda Mel</p>
        </div>

        {quemConvidou && (
          <div className="convite-faixa">
            <span aria-hidden="true">💌</span>
            <span><strong>{quemConvidou.nome}</strong> te convidou. {modo === 'cadastro' ? 'Crie a conta e você já entra na agenda.' : 'Entre e você já cai na agenda.'}</span>
          </div>
        )}

        <h2 className="login-titulo">{titulo}</h2>
        <p className="muted login-sub">{sub}</p>

        <form onSubmit={enviar} className="form">
          {modo === 'cadastro' && (
            <>
              <label>Nome completo<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Maria da Silva" autoComplete="name" /></label>
              <label>WhatsApp<input type="tel" value={fone} onChange={(e) => setFone(e.target.value)} placeholder="(11) 99999-9999" autoComplete="tel" required /></label>
              {papel === 'salao' && <label>Nome do salão<input value={negocio} onChange={(e) => setNegocio(e.target.value)} placeholder="Espaço Bela" /></label>}
              {papel && <label>Cidade<input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Santos" /></label>}
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
            {enviando ? 'Aguarde…' : modo === 'login' ? 'Entrar' : modo === 'cadastro' ? (papel ? 'Criar e começar' : 'Criar conta') : 'Enviar link'}
          </button>
        </form>

        <p className="login-troca muted">
          {modo === 'login' ? (
            <>Não tem conta? <button type="button" className="link-ver" onClick={() => { setModo('cadastro'); setErro('') }}>Cadastre-se</button></>
          ) : (
            <>Já tem conta? <button type="button" className="link-ver" onClick={() => { setModo('login'); setErro('') }}>Entrar</button></>
          )}
        </p>
        {!papel && !convite && modo === 'login' && (
          <Link to="/entrar" className="card login-convite">
            <span aria-hidden="true">📷</span>
            <span>
              <strong>Recebeu um QR ou código da sua profissional?</strong>
              <span className="muted">Escaneie ou digite pra entrar na agenda dela.</span>
            </span>
          </Link>
        )}
        {!papel && !convite && (
          <p className="login-troca muted" style={{ marginTop: '0.2rem' }}>
            Atende clientes? <Link to="/comecar" className="link-ver">Criar minha agenda</Link>
          </p>
        )}

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
    'User already registered': 'Este e-mail já tem conta. Entre com a senha, ou use "Esqueci a senha".',
    'Password should be at least 6 characters': 'A senha precisa ter pelo menos 6 caracteres.',
    'Failed to fetch': 'Não foi possível conectar. Confira sua internet.',
  }
  return mapa[msg] || msg
}
