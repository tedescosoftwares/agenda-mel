import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homeDoPapel } from '../lib/roles'
import { AMBIENTE, ehPro, ambienteDoPapel } from '../lib/ambiente'
import AmbienteErrado from '../components/AmbienteErrado'
import { LogoMimo } from '../components/icons'
import Landing from './publico/Landing'

// A abertura: marca, respiro, e vai. Fica na tela o tempo de o app
// descobrir quem está logado — nem um segundo a mais. Splash que segura
// a pessoa por decoração é pedágio.
export default function Splash() {
  const { user, role, loading } = useAuth()
  const navigate = useNavigate()

  // instalado no celular (PWA) abre direto na agenda; no navegador, a landing é a casa de quem está logada (2.60)
  const naApp = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone)
  const porIndicacao = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('indique')
  // 4.9 (D1): a cliente logada vai para a agenda dela; a landing é a porta de quem ainda não entrou
  const ficaNaLanding = !ehPro && !porIndicacao && !naApp && !(user && role === 'cliente')

  useEffect(() => {
    if (loading) return
    const t = setTimeout(() => {
      if (user && ficaNaLanding) return
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
  }, [loading, user, role, navigate, ficaNaLanding])

  // mimo.com.vc no navegador: a porta da rua, logada ou não
  if (!loading && ficaNaLanding) return <Landing />
  const certo = !loading && user ? ambienteDoPapel(role) : null
  if (certo && certo !== AMBIENTE) return <AmbienteErrado role={role} />

  return (
    <div className="splash">
      <LogoMimo altura={84} pro={ehPro} className="brand-logo" />
      <p className="brand-assinatura">{ehPro ? 'Sua agenda de salão' : 'Sua agenda de beleza'}</p>
      <p className="brand-slogan">Beleza na palma da mão</p>
      <span className="splash-roda" aria-label="Carregando" />
    </div>
  )
}
