import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homeDoPapel } from '../lib/roles'
import { AMBIENTE, ehPro, ambienteDoPapel, irParaAmbiente } from '../lib/ambiente'
import { MarcaIcon, Wordmark } from '../components/icons'

// A abertura: marca, respiro, e vai. Fica na tela o tempo de o app
// descobrir quem está logado — nem um segundo a mais. Splash que segura
// a pessoa por decoração é pedágio.
export default function Splash() {
  const { user, role, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return
    const t = setTimeout(() => {
      if (!user) {
        // cliente: a porta é o código. Pro: a porta é o login da agenda.
        navigate(ehPro ? '/pro/entrar' : '/entrar', { replace: true })
        return
      }
      // logada no ambiente errado? vai para o certo, sem passar por tela
      const certo = ambienteDoPapel(role)
      if (certo && certo !== AMBIENTE) { irParaAmbiente(certo, homeDoPapel(role)); return }
      navigate(homeDoPapel(role), { replace: true })
    }, 650)
    return () => clearTimeout(t)
  }, [loading, user, role, navigate])

  return (
    <div className="splash">
      <MarcaIcon width={72} height={63} id="splash" />
      <Wordmark tamanho={3.2} />
      <p className="brand-assinatura">{ehPro ? 'Pro · sua agenda' : 'Agenda Mel'}</p>
      <p className="brand-slogan">Beleza na palma da mão</p>
      <span className="splash-roda" aria-label="Carregando" />
    </div>
  )
}
