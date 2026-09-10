import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

// O aviso de armazenamento. O MIMO não usa cookie de rastreio nem
// anúncio: guarda no aparelho só a sessão (para não pedir senha toda
// hora), preferências de tela e o cache do app para abrir sem sinal.
// Um "Entendi" basta, e não volta mais neste aparelho.
const CHAVE = 'mimo-armazenamento-ok'

export default function AvisoCookies() {
  const [visivel, setVisivel] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    try { setVisivel(!localStorage.getItem(CHAVE)) } catch { setVisivel(false) }
  }, [])

  if (!visivel || pathname === '/privacidade' || pathname === '/termos' || pathname.startsWith('/plataforma')) return null

  function ok() {
    try { localStorage.setItem(CHAVE, new Date().toISOString()) } catch { /* sem storage */ }
    setVisivel(false)
  }

  return (
    <div className="aviso-cookies" role="dialog" aria-live="polite" aria-label="Aviso sobre armazenamento">
      <p>O MIMO guarda no seu aparelho só o necessário: sua sessão, suas preferências e o cache do app. Sem rastreio, sem anúncio. <Link to="/privacidade">Saiba mais</Link></p>
      <button className="btn btn-primary" onClick={ok}>Entendi</button>
    </div>
  )
}
