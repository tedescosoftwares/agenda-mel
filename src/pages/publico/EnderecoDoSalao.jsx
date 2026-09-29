import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { SUBDOMINIO, urlDoAmbiente, urlDoEndereco } from '../../lib/ambiente'
import { MarcaIcon, Wordmark } from '../../components/icons'
import EntrarPorCodigo from './EntrarPorCodigo'
import PaginaProfissional from './PaginaProfissional'

// O endereço próprio do salão (2.80): studiomel.mimo.com.vc.
//
// Só duas páginas vivem aqui: a raiz (a casa) e /<slug> (a profissional
// da casa). Qualquer outro caminho volta para o domínio principal, com a
// sessão junto (o cookie é da raiz). Quem responde de quem é o nome é
// resolver_endereco(); um endereço trocado redireciona para o novo.

// caminhos do app que nunca são nome de profissional
const RESERVADOS = new Set(['login', 'cadastro', 'entrar', 'comecar', 'onboarding', 'splash', 'landing', 'blog', 'planos', 'sobre', 'contato', 'termos', 'privacidade', 'estilo', 'agenda', 'perfil', 'cliente', 'pro', 'admin', 'plataforma', 'p', 'v', 'convite', 'equipe', 'ativar', 'bem-vinda', 'assets', 'imagens'])

// decide o que este host mostra para o caminho atual
export function NoEndereco() {
  const { pathname, search, hash } = useLocation()
  const m = pathname.match(/^\/([a-z0-9-]+)\/?$/)
  const prof = pathname === '/' ? null : (m && !RESERVADOS.has(m[1]) ? m[1] : undefined)
  useEffect(() => {
    if (prof !== undefined) return
    // (no PC o "subdomínio" é ?endereco=…: sai dele para não voltar aqui)
    const q = new URLSearchParams(search); q.delete('endereco')
    const busca = q.toString() ? `?${q}` : ''
    window.location.replace(urlDoAmbiente('cliente', pathname + busca + hash))
  }, [prof, pathname, search, hash])
  if (prof === undefined) return null
  return <EnderecoDoSalao prof={prof} />
}

export default function EnderecoDoSalao({ prof }) {
  const [r, setR] = useState(undefined)
  useEffect(() => {
    let vivo = true
    setR(undefined)
    supabase.rpc('resolver_endereco', { nome: SUBDOMINIO, prof: prof ?? null })
      .then(({ data }) => { if (vivo) setR(data ?? null) })
      .catch(() => { if (vivo) setR(null) })
    return () => { vivo = false }
  }, [prof])
  useEffect(() => {
    if (r?.redirecionar) window.location.replace(urlDoEndereco(r.redirecionar, prof ? `/${prof}` : '/'))
  }, [r, prof])

  if (r === undefined) return <div className="page-center"><p className="muted">Carregando…</p></div>
  if (r?.redirecionar) return null
  if (!r) return <EnderecoVazio titulo="Esse endereço não existe" texto="Confira o link com o salão, ou entre pelo código de seis letras que fica no balcão." />
  if (r.tipo === 'indisponivel') return <EnderecoVazio titulo={`${r.nome} está com o endereço pausado`} texto="O salão precisa regularizar a assinatura para o endereço voltar a abrir. Se você já é cliente, entra pelo app." />
  if (r.tipo === 'profissional') return <PaginaProfissional slug={r.slug} />
  return <EntrarPorCodigo codigo={r.codigo} alvo={r} />
}

function EnderecoVazio({ titulo, texto }) {
  return (
    <div className="page-center login-bg">
      <div className="card login-card entrar-card">
        <div className="brand">
          <MarcaIcon className="brand-icon" width={44} height={40} id="endereco" />
          <Wordmark tamanho={2.2} />
        </div>
        <h2 className="login-titulo">{titulo}</h2>
        <p className="muted login-sub">{texto}</p>
        <div className="entrar-opcoes">
          <a href={urlDoAmbiente('cliente', '/entrar')} className="btn btn-primary btn-block">Entrar com o código</a>
          <a href={urlDoAmbiente('cliente', '/')} className="btn btn-ghost btn-block">Ir para o MIMO</a>
        </div>
        <p className="brand-slogan" style={{ marginTop: '1.2rem', marginBottom: 0, textAlign: 'center' }}>Beleza na palma da mão</p>
      </div>
    </div>
  )
}
