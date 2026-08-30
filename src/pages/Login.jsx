import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homeDoPapel } from '../lib/roles'
import { isSupabaseConfigured } from '../lib/supabase'
import { VERSAO, ENTREGA } from '../lib/versao'

export default function Login() {
  const { user, role, loading, signIn, signUp } = useAuth()
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (loading) {
    return (
      <div className="page-center">
        <p className="muted">Carregando…</p>
      </div>
    )
  }

  if (user) {
    return <Navigate to={homeDoPapel(role)} replace />
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setInfo('')

    if (!isSupabaseConfigured) {
      setError('Supabase ainda não configurado. Veja o README para criar o .env.')
      return
    }

    setSubmitting(true)
    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password)
        if (error) setError(traduzErro(error.message))
      } else {
        if (!fullName.trim()) {
          setError('Informe seu nome completo.')
          return
        }
        const { error } = await signUp(email, password, fullName.trim(), phone.trim())
        if (error) {
          setError(traduzErro(error.message))
        } else {
          setInfo('Conta criada! Verifique seu e-mail para confirmar o cadastro.')
          setMode('login')
        }
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-center login-bg">
      <div className="card login-card">
        <div className="brand">
          <span className="brand-icon">✿</span>
          <h1>Agenda Mel</h1>
          <p className="muted">Agendamento de serviços estéticos</p>
        </div>

        {!isSupabaseConfigured && (
          <div className="alert alert-warn">
            Supabase não configurado — copie <code>.env.example</code> para{' '}
            <code>.env</code> e preencha as chaves (veja o README).
          </div>
        )}

        <div className="tabs">
          <button
            type="button"
            className={mode === 'login' ? 'tab active' : 'tab'}
            onClick={() => {
              setMode('login')
              setError('')
            }}
          >
            Entrar
          </button>
          <button
            type="button"
            className={mode === 'signup' ? 'tab active' : 'tab'}
            onClick={() => {
              setMode('signup')
              setError('')
            }}
          >
            Criar conta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="form">
          {mode === 'signup' && (
            <>
              <label>
                Nome completo
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Maria da Silva"
                  autoComplete="name"
                />
              </label>
              <label>
                WhatsApp (opcional)
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(11) 99999-9999"
                  autoComplete="tel"
                />
              </label>
            </>
          )}

          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@email.com"
              autoComplete="email"
              required
            />
          </label>

          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
          </label>

          {error && <div className="alert alert-error">{error}</div>}
          {info && <div className="alert alert-info">{info}</div>}

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting
              ? 'Aguarde…'
              : mode === 'login'
                ? 'Entrar'
                : 'Criar conta'}
          </button>
        </form>

        <p className="versao-marca">
          v{VERSAO} · {ENTREGA}
        </p>
      </div>
    </div>
  )
}

function traduzErro(msg) {
  const mapa = {
    'Invalid login credentials': 'E-mail ou senha incorretos.',
    'Email not confirmed': 'Confirme seu e-mail antes de entrar.',
    'User already registered': 'Este e-mail já está cadastrado.',
    'Password should be at least 6 characters':
      'A senha precisa ter pelo menos 6 caracteres.',
    'Failed to fetch':
      'Não foi possível conectar ao servidor. Verifique a URL e a chave no arquivo .env (e reinicie o npm run dev depois de editar), sua internet, e se o projeto no Supabase está ativo.',
  }
  return mapa[msg] || msg
}
