import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useSeo } from '../../lib/seo'
import { NavSite, PeSite } from '../../components/site/Pecas'
import '../../landing.css'

// Rota que não existe: antes de desistir, olha a tabela de
// redirecionamentos da plataforma (uma URL antiga pode ter virado outra).
// Sem redirecionamento, mostra um 404 de gente, com caminho de volta.
// O 301 de verdade é do servidor; aqui é o que dá para fazer no navegador.
export default function NaoEncontrada() {
  const { pathname } = useLocation()
  const [destino, setDestino] = useState(undefined)
  useEffect(() => {
    let vivo = true
    Promise.resolve(supabase.from('redirects').select('to_path').eq('from_path', pathname).eq('active', true).maybeSingle())
      .then(({ data }) => vivo && setDestino(data?.to_path || null)).catch(() => vivo && setDestino(null))
    return () => { vivo = false }
  }, [pathname])
  useSeo({ titulo: 'Página não encontrada | MIMO', descricao: 'Essa página não existe mais.', caminho: pathname, noindex: true })
  if (destino === undefined) return null
  if (destino) return destino.startsWith('http') ? (window.location.replace(destino), null) : <Navigate to={destino} replace />
  return (
    <div className="ld sp">
      <NavSite />
      <main><section><div className="ld-wrap sp-404"><span className="ld-kicker">404</span><h1>Essa página não existe.</h1><p className="ld-lead">Pode ter mudado de endereço ou o link veio errado. Os caminhos mais úteis:</p><div className="sp-404-links"><Link className="ld-btn ld-primario" to="/">Início</Link><Link className="ld-btn ld-fantasma" to="/blog">Blog</Link><Link className="ld-btn ld-fantasma" to="/sistema-para-salao-de-beleza">Sistema para salão</Link></div></div></section></main>
      <PeSite />
    </div>
  )
}
