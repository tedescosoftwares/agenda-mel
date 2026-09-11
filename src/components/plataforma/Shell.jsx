import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useDialogo } from '../../context/DialogoContext'
import { supabase } from '../../lib/supabase'
import { MarcaIcon, Wordmark, HomeIcon, PredioIcon, UsersIcon, LinkIcon, ListaIcon, MailIcon, GraficoIcon, EngrenagemIcon, SearchIcon, BellIcon, MaisIcon, MegafoneIcon, WhatsIcon } from '../icons'

// A casa da plataforma é um painel de PC (056): barra lateral com as
// oito seções, topo com a busca global (⌘K), o botão de ação da tela e
// quem está logada. Em tela estreita a lateral vira ícones.
const MENU = [
  { to: '/plataforma', end: true, label: 'Visão Geral', Icon: HomeIcon },
  { to: '/plataforma/saloes', label: 'Salões', Icon: PredioIcon },
  { to: '/plataforma/pessoas', label: 'Pessoas', Icon: UsersIcon },
  { to: '/plataforma/vinculos', label: 'Convites/Vínculos', Icon: LinkIcon },
  { to: '/plataforma/filas', label: 'Filas', Icon: ListaIcon },
  { to: '/plataforma/mensagens', label: 'Mensagens', Icon: WhatsIcon },
  { to: '/plataforma/recados', label: 'Recados', Icon: MegafoneIcon },
  { to: '/plataforma/metricas', label: 'Métricas', Icon: GraficoIcon },
  { to: '/plataforma/configuracoes', label: 'Configurações', Icon: EngrenagemIcon },
]

export default function Shell({ children, acao }) {
  const { signOut, profile, user } = useAuth()
  const { confirmar } = useDialogo()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const principal = useRef(null)
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState(null)
  const [menuAberto, setMenuAberto] = useState(false)
  const caixa = useRef(null)

  // a coluna principal é quem rola; ao trocar de tela, volta ao topo
  useEffect(() => { principal.current?.scrollTo({ top: 0 }) }, [pathname])

  // ⌘K / Ctrl+K foca a busca, como no mock
  useEffect(() => {
    const tecla = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); caixa.current?.focus() } }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  // busca global: pessoas pelo banco, salões pela lista
  useEffect(() => {
    const t = busca.trim()
    if (t.length < 2) { setAchados(null); return }
    const id = setTimeout(async () => {
      const [p, s] = await Promise.all([
        supabase.rpc('plataforma_pessoas', { busca: t, quantas: 6 }),
        supabase.rpc('plataforma_saloes'),
      ])
      const tt = t.toLowerCase()
      setAchados({
        pessoas: p.data ?? [],
        saloes: (s.data ?? []).filter((x) => x.nome.toLowerCase().includes(tt) || (x.dona || '').toLowerCase().includes(tt) || (x.codigo || '').toLowerCase() === tt || (x.cidade || '').toLowerCase().includes(tt)).slice(0, 6),
      })
    }, 250)
    return () => clearTimeout(id)
  }, [busca])

  async function sair() { if (await confirmar({ titulo: 'Sair da conta?', ok: 'Sair', cancelar: 'Ficar' })) signOut() }
  const nome = profile?.full_name || user?.email || 'Plataforma'

  return (
    <div className="plat">
      <aside className="plat-lateral">
        <div className="plat-marca">
          <MarcaIcon className="marca" id="plat" width={30} height={26} />
          <Wordmark tamanho={1.5} />
          <span className="plat-tag">plataforma</span>
        </div>
        <nav className="plat-menu">
          {MENU.map((m) => (
            <NavLink key={m.to} to={m.to} end={m.end} className={({ isActive }) => 'plat-item' + (isActive ? ' ativo' : '')}>
              <m.Icon /><span>{m.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="plat-lateral-pe">
          <MarcaIcon id="plat-pe" width={26} height={22} />
          <strong>Beleza que conecta pessoas</strong>
          <span>Mais organização. Mais tempo para o que realmente importa.</span>
        </div>
      </aside>

      <div className="plat-principal" ref={principal}>
        <header className="plat-topo">
          <div className="plat-busca">
            <SearchIcon />
            <input ref={caixa} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar salões, pessoas, e-mails ou telefones…" onBlur={() => setTimeout(() => setAchados(null), 150)} />
            <kbd>⌘ K</kbd>
            {achados && (
              <div className="plat-achados">
                {achados.saloes.length === 0 && achados.pessoas.length === 0 && <span className="muted">Nada com “{busca}”.</span>}
                {achados.saloes.length > 0 && <><span className="plat-achados-tit">Salões</span>{achados.saloes.map((s) => (
                  <button key={s.id} onMouseDown={() => { navigate(`/plataforma/saloes/${s.id}`); setBusca('') }}><PredioIcon /><span><strong>{s.nome}</strong><small>{s.tipo === 'autonoma' ? 'autônoma' : 'salão'} · {s.dona || 'sem dona'} · {s.codigo}</small></span></button>
                ))}</>}
                {achados.pessoas.length > 0 && <><span className="plat-achados-tit">Pessoas</span>{achados.pessoas.map((p) => (
                  <button key={p.id} onMouseDown={() => { navigate(`/plataforma/pessoas?q=${encodeURIComponent(p.email || p.nome || '')}`); setBusca('') }}><UsersIcon /><span><strong>{p.nome || 'sem nome'}</strong><small>{p.papel} · {p.email}{p.telefone ? ` · ${p.telefone}` : ''}</small></span></button>
                ))}</>}
              </div>
            )}
          </div>
          <div className="plat-topo-acoes">
            {acao && <button className="btn btn-primary plat-acao" onClick={acao.onClick}><MaisIcon /> {acao.rotulo}</button>}
            <button className="plat-sino" aria-label="Avisos"><BellIcon /><span className="nav-ponto" /></button>
            <div className="plat-usuaria" onClick={() => setMenuAberto((v) => !v)}>
              <span className="plat-avatar">{nome.charAt(0).toUpperCase()}</span>
              <span className="plat-usuaria-texto"><strong>{nome.split(' ').slice(0, 2).join(' ')}</strong><small>Admin · MIMO</small></span>
              <span className="plat-caret">⌄</span>
              {menuAberto && <div className="plat-achados plat-menu-usuaria"><button onMouseDown={sair}>Sair da conta</button></div>}
            </div>
          </div>
        </header>
        <main className="plat-conteudo">{children}</main>
      </div>
    </div>
  )
}
