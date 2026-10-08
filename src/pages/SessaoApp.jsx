import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// /sessao-app?ir=/cliente/home — a porta por onde o app da loja (apps/mobile)
// abre a web. O app injeta window.__mimoSessao (access_token + refresh_token)
// antes da página carregar; aqui essa sessão vira a do navegador embutido e a
// pessoa cai direto onde o app pediu. Sem sessão injetada, só encaminha: é o
// caso de criar conta ou entrar pela própria web, dentro do app.
export default function SessaoApp() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  useEffect(() => {
    let vivo = true
    const ir = destinoSeguro(params.get('ir'))
    ;(async () => {
      const s = typeof window !== 'undefined' ? window.__mimoSessao : null
      if (s?.access_token && s?.refresh_token && supabase?.auth?.setSession) {
        try { await supabase.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token }) } catch { /* token velho: a tela de login resolve */ }
      }
      if (vivo) navigate(ir, { replace: true })
    })()
    return () => { vivo = false }
  }, [])

  return (
    <div className="page-center">
      <p className="muted">Abrindo…</p>
    </div>
  )
}

// só caminhos da própria MIMO: nada de //outro-site nem http://
function destinoSeguro(v) {
  if (!v || typeof v !== 'string') return '/'
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return '/'
  return v
}
