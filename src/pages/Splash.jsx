import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homeDoPapel } from '../lib/roles'
import { AMBIENTE, ehPro, ambienteDoPapel } from '../lib/ambiente'
import AmbienteErrado from '../components/AmbienteErrado'
import { MarcaIcon, Wordmark } from '../components/icons'
import Landing from './publico/Landing'

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
        // pro: a porta é o login da agenda. Cliente sem login vê a
        // landing (abaixo) — a não ser que tenha chegado por um convite.
        if (ehPro) navigate('/pro/entrar', { replace: true })
        else if (new URLSearchParams(window.location.search).has('indique')) navigate('/entrar', { replace: true })
        return
      }
      // logada no ambiente errado? a tela de aviso cuida (abaixo)
      const certo = ambienteDoPapel(role)
      if (certo && certo !== AMBIENTE) return
      navigate(homeDoPapel(role), { replace: true })
    }, 650)
    return () => clearTimeout(t)
  }, [loading, user, role, navigate])

  const certo = !loading && user ? ambienteDoPapel(role) : null
  if (certo && certo !== AMBIENTE) return <AmbienteErrado role={role} />
  // mimo.com.vc sem login: a porta da rua
  if (!loading && !user && !ehPro && !new URLSearchParams(window.location.search).has('indique')) return <Landing />

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
