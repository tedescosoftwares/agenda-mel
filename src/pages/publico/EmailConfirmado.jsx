import { useEffect, useState } from 'react'
import { Check, MailWarning } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { MarcaIcon, Wordmark } from '../../components/icons'
import { urlDoAmbiente } from '../../lib/ambiente'

// Onde o link do e-mail de confirmação cai (2.81.2). Não volta pro meio do
// cadastro: diz que deu certo e manda a pessoa de volta pra aba onde estava,
// que percebe sozinha a confirmação e segue. Se ela fechou aquela aba, o
// botão continua por aqui (o link já entrou logada neste navegador).
export default function EmailConfirmado() {
  const { user, loading } = useAuth()
  const [erro] = useState(() => {
    try {
      const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const cod = h.get('error_code') || ''; const desc = h.get('error_description') || ''
      if (!cod && !desc) return ''
      window.history.replaceState(null, '', window.location.pathname)
      if (/otp_expired|expired|invalid/i.test(cod + desc)) return 'vencido'
      return decodeURIComponent(desc.replace(/\+/g, ' '))
    } catch { return '' }
  })
  useEffect(() => { document.title = 'E-mail confirmado · MIMO' }, [])

  if (erro) {
    return (
      <Caixa icone={<MailWarning size={22} />} titulo={erro === 'vencido' ? 'Esse link já foi usado ou venceu' : 'Não deu para confirmar'}>
        <p className="muted login-sub">{erro === 'vencido' ? 'Se você já confirmou, é só entrar com e-mail e senha. Se não, peça um novo link na tela de cadastro, em "Reenviar e-mail".' : erro}</p>
        <a href={urlDoAmbiente('pro', '/pro/entrar')} className="btn btn-primary btn-block">Entrar</a>
      </Caixa>
    )
  }
  return (
    <Caixa icone={<Check size={22} />} titulo="E-mail confirmado" ok>
      <p className="muted login-sub">Pronto, sua conta está ativa. <strong>Volte para a aba onde você estava fazendo o cadastro:</strong> ela já percebeu a confirmação e seguiu sozinha.</p>
      <p className="muted login-sub">Fechou aquela aba? Sem problema, continue por aqui.</p>
      {!loading && (
        <a href={urlDoAmbiente('pro', user ? '/onboarding' : '/pro/entrar')} className="btn btn-primary btn-block">{user ? 'Continuar por aqui' : 'Entrar e continuar'}</a>
      )}
    </Caixa>
  )
}

function Caixa({ icone, titulo, ok = false, children }) {
  return (
    <div className="page-center login-bg">
      <div className="card login-card entrar-card">
        <div className="brand">
          <MarcaIcon className="brand-icon" width={44} height={40} id="email-confirmado" />
          <Wordmark tamanho={2.2} />
        </div>
        <span className={ok ? 'ce-check' : 'ce-icone'} style={{ margin: '0.6rem auto 0' }}>{icone}</span>
        <h2 className="login-titulo">{titulo}</h2>
        {children}
        <p className="brand-slogan" style={{ marginTop: '1.2rem', marginBottom: 0, textAlign: 'center' }}>Beleza na palma da mão</p>
      </div>
    </div>
  )
}
