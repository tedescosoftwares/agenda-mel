import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

// Login/cadastro rápido dentro da página pública da profissional:
// a cliente escolhe tudo primeiro e só se identifica para fechar.
export default function AuthModal({ resumo, onClose }) {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setInfo('')
    setSubmitting(true)
    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password)
        if (error) setError(traduzErro(error.message))
        // sucesso: o AuthContext atualiza a sessão e a página conclui sozinha
      } else {
        if (!fullName.trim()) {
          setError('Informe seu nome completo.')
          return
        }
        const { error } = await signUp(email, password, fullName.trim(), phone.trim())
        if (error) {
          setError(traduzErro(error.message))
        } else {
          setInfo(
            'Conta criada! Se pedirmos confirmação por e-mail, confirme e volte aqui para concluir o agendamento.',
          )
        }
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-fundo" onClick={onClose}>
      <div
        className="card modal-caixa"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button className="modal-fechar" onClick={onClose} aria-label="Fechar">
          ×
        </button>

        <h3>Falta só identificar você</h3>
        {resumo && <p className="muted modal-resumo">{resumo}</p>}

        <div className="tabs">
          <button
            type="button"
            className={mode === 'login' ? 'tab active' : 'tab'}
            onClick={() => {
              setMode('login')
              setError('')
            }}
          >
            Já tenho conta
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

        <form className="form" onSubmit={handleSubmit}>
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
                  placeholder="(13) 99999-9999"
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
                ? 'Entrar e agendar'
                : 'Criar conta'}
          </button>
        </form>
      </div>
    </div>
  )
}

function traduzErro(msg) {
  const mapa = {
    'Invalid login credentials': 'E-mail ou senha incorretos.',
    'Email not confirmed': 'Confirme seu e-mail antes de entrar.',
    'User already registered':
      'Este e-mail já está cadastrado — use a aba "Já tenho conta".',
    'Password should be at least 6 characters':
      'A senha precisa ter pelo menos 6 caracteres.',
    'Failed to fetch':
      'Não foi possível conectar ao servidor. Verifique sua internet.',
  }
  return mapa[msg] || msg
}
