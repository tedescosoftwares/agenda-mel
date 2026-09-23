import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Menu, X } from 'lucide-react'
import { MarcaIcon } from '../icons'
import { urlDoAmbiente } from '../../lib/ambiente'

// As peças do site público (mimo.com.vc): barra, rodapé, fotos, logo,
// coração de pincel e o "aparece ao rolar". A landing e as páginas de
// SEO/blog usam as mesmas, para o site inteiro parecer uma casa só.

export const comecarEm = (tipo) => urlDoAmbiente('pro', tipo ? `/comecar?tipo=${tipo}` : '/comecar')
export const entrarEm = () => urlDoAmbiente('pro', '/pro/entrar')

export function Coracao({ className }) {
  return (
    <svg viewBox="0 0 64 60" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M32 54 C 12 40, 4 29, 7 17 C 10 7, 22 5, 31 16 C 41 5, 54 7, 57 17 C 60 29, 52 40, 32 54 Z" />
      <path d="M33 51 C 15 38, 9 28, 11 19" strokeWidth="4" opacity="0.55" />
    </svg>
  )
}

// a marca como nos cartazes: MIMO em caixa alta com o coração sobre o i
export function MarcaCartaz() {
  return (
    <span className="ld-cz-marca" aria-label="mimo">
      <span className="ld-cz-marca-nome">M<b>i<Coracao /></b>MO</span>
      <small>agenda de salão</small>
    </span>
  )
}

// as fotos do pacote da marca: WebP em dois tamanhos, preguiçosas
// fora do herói. A alt descreve a cena, não repete o título.
export function Foto({ nome, alt, className = '', prioridade = false }) {
  return (
    <img
      className={'ld-foto ' + className}
      src={`/imagens/${nome}-1400.webp`}
      srcSet={`/imagens/${nome}-720.webp 720w, /imagens/${nome}-1400.webp 1400w`}
      sizes="(max-width: 700px) 100vw, 640px"
      alt={alt}
      loading={prioridade ? 'eager' : 'lazy'}
      fetchPriority={prioridade ? 'high' : 'auto'}
      decoding="async"
    />
  )
}

export function Logo({ altura = 40 }) {
  return <img src="/mimo-logo.svg" alt="MIMO" height={altura} style={{ height: altura, width: 'auto' }} />
}

// aparece quando entra na tela (uma vez só)
// `chave` muda quando a página passa de 'carregando' para 'com conteúdo':
// aí o ref existe e os observadores nascem de verdade
export function useRevelar(chave = true) {
  const ref = useRef(null)
  useEffect(() => {
    const raiz = ref.current
    if (!raiz || !('IntersectionObserver' in window) || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    raiz.classList.add('ld-anima')
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { e.target.classList.add('ld-vis'); io.unobserve(e.target) }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
    const olhar = () => raiz.querySelectorAll('.ld-rv:not(.ld-vis)').forEach((el) => io.observe(el))
    olhar()
    // o conteúdo que chega depois (artigos do banco, fotos) também entra
    const mo = new MutationObserver(olhar)
    mo.observe(raiz, { childList: true, subtree: true })
    return () => { io.disconnect(); mo.disconnect(); raiz.classList.remove('ld-anima') }
  }, [chave])
  return ref
}

export function Cabeca({ kicker, titulo, children, centro = false, claro = false }) {
  return (
    <div className={'ld-cabeca ld-rv' + (centro ? ' ld-centro' : '') + (claro ? ' ld-cabeca-clara' : '')}>
      <span className="ld-kicker">{kicker}</span>
      <h2>{titulo.map((l, i) => <span key={i}>{l}</span>)}</h2>
      {children && <p>{children}</p>}
    </div>
  )
}


// os links da barra apontam para as seções da landing; fora dela viram
// endereço completo (/#saloes), e "Conteúdos" vai para o blog
const LINKS = [['/#saloes', 'Para salões'], ['/#autonomas', 'Para autônomas'], ['/#funcionalidades', 'Funcionalidades'], ['/#como-funciona', 'Como funciona'], ['/#planos', 'Planos'], ['/blog', 'Conteúdos']]

export function NavSite() {
  const [menu, setMenu] = useState(false)
  const [entrarAberto, setEntrarAberto] = useState(false)
  const entrarRef = useRef(null)
  const comecar = comecarEm
  const entrar = entrarEm()

  useEffect(() => {
    if (!menu && !entrarAberto) return
    const tecla = (e) => { if (e.key === 'Escape') { setMenu(false); setEntrarAberto(false) } }
    const fora = (e) => { if (entrarRef.current && !entrarRef.current.contains(e.target)) setEntrarAberto(false) }
    window.addEventListener('keydown', tecla)
    document.addEventListener('pointerdown', fora)
    return () => { window.removeEventListener('keydown', tecla); document.removeEventListener('pointerdown', fora) }
  }, [menu, entrarAberto])
  const links = LINKS

  return (
      <header className="ld-nav">
        <div className="ld-wrap ld-nav-in">
          <Link to="/" className="ld-logo" aria-label="MIMO, início"><Logo altura={52} /></Link>
          <nav className="ld-links" aria-label="Seções">{links.map(([h, t]) => (h.startsWith('/#') ? <a key={h} href={h}>{t}</a> : <Link key={h} to={h}>{t}</Link>))}</nav>
          <div className="ld-acoes">
            <div className="ld-entrar" ref={entrarRef}>
              <button className="ld-btn ld-fantasma" aria-haspopup="menu" aria-expanded={entrarAberto} onClick={() => setEntrarAberto((a) => !a)}>Entrar <ChevronDown size={16} /></button>
              {entrarAberto && (
                <div className="ld-entrar-menu" role="menu">
                  <a role="menuitem" href={entrar}><MarcaIcon width={22} height={19} id="ld-en-pro" /><span><b>MIMO Pro</b><small>Salão e profissional · pro.mimo.com.vc</small></span></a>
                  <Link role="menuitem" to="/entrar"><MarcaIcon width={22} height={19} id="ld-en-cli" /><span><b>MIMO</b><small>Cliente: entrar com o código · mimo.com.vc</small></span></Link>
                </div>
              )}
            </div>
            <a className="ld-btn ld-primario" href={comecar()}>Começar agora</a>
            <button className="ld-menu-btn" aria-label={menu ? 'Fechar menu' : 'Abrir menu'} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>{menu ? <X size={22} /> : <Menu size={22} />}</button>
          </div>
        </div>
        {menu && (
          <div className="ld-menu" onClick={() => setMenu(false)}>
            {links.map(([h, t]) => (h.startsWith('/#') ? <a key={h} href={h}>{t}</a> : <Link key={h} to={h}>{t}</Link>))}
            <a className="ld-btn ld-primario" href={comecar()}>Começar agora</a>
            <div className="ld-menu-entrar">
              <span>Entrar</span>
              <a href={entrar}><b>MIMO Pro</b><small>salão e profissional</small></a>
              <Link to="/entrar"><b>MIMO</b><small>cliente, com o código</small></Link>
            </div>
          </div>
        )}
      </header>
  )
}

export function PeSite() {
  const entrar = entrarEm()
  return (
      <footer className="ld-pe">
        <div className="ld-wrap ld-pe-in">
          <div>
            <Logo altura={44} />
            <p>Beleza, organização e relacionamento.</p>
          </div>
          <nav className="ld-pe-links" aria-label="Rodapé">
            <Link to="/termos">Termos de uso</Link>
            <Link to="/privacidade">Privacidade</Link>
            <Link to="/contato">Contato</Link>
            <Link to="/sobre">Sobre</Link>
            <Link to="/blog">Blog</Link>
            <Link to="/entrar">Sou cliente</Link>
            <a href={entrar}>Sou profissional</a>
          </nav>
          <div className="ld-pe-fim">mimo.com.vc<br />© {new Date().getFullYear()} MIMO Desenvolvimento Ltda</div>
        </div>
      </footer>
  )
}
