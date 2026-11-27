import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PainelPausado from './PainelPausado'
import SinoAvisos from './SinoAvisos'
import MenuDaConta, { ITENS_ADMIN } from './MenuDaConta'
import ClimaTopo from './ClimaTopo'
import MelDock from './MelDock'
import { InstalarNoMenu } from './InstalarApp'
import FaixaDoTeste from './FaixaDoTeste'
import { LogoMimo } from './icons'
import {
  CalendarIcon,
  UsersIcon,
  ClockIcon,
  HomeIcon,
} from './icons'
import { Sparkles, UserRound, WalletCards, Megaphone, Settings2, ChevronLeft, CreditCard, BarChart3, Search, Crown, Store, ChevronDown, CalendarHeart, Plus, Moon, Sun, LayoutGrid, Scissors, UserPlus, QrCode, MessageCircle, Clock, HelpCircle, X } from 'lucide-react'
import { lerTema, aplicarTema, trocarTema, ouvirTema } from '../lib/tema'

// Cinco posições na barra do celular (4.26): Início, Agenda, o "+" de novo horário no meio, Clientes e Menu.
// O Menu abre uma folha com todo o resto do painel em círculos (os mesmos da Home), para qualquer tela ficar
// a dois toques de qualquer outra. No computador nada disso aparece: o menu lateral já mostra tudo.
import { PIX_LIGADO } from '../lib/pixLigado'

const TABS = [
  { to: '/admin', end: true, label: 'Início', Icon: HomeIcon },
  { to: '/admin/agenda', label: 'Agenda', Icon: CalendarIcon },
  null,
  { to: '/admin/clientes', label: 'Clientes', Icon: UsersIcon },
  'menu',
]
const MENU = [
  { to: '/admin/equipe', label: 'Equipe', Icon: UserPlus },
  { to: '/admin/servicos', label: 'Serviços', Icon: Scissors },
  { to: '/admin/salao', label: 'Link e QR', Icon: QrCode },
  { to: '/admin/whatsapp', label: 'WhatsApp', Icon: MessageCircle },
  ...(PIX_LIGADO ? [{ to: '/admin/receber', label: 'Financeiro', Icon: WalletCards }] : []),
  { to: '/admin/promocoes', label: 'Marketing', Icon: Megaphone },
  { to: '/admin/numeros', label: 'Números', Icon: BarChart3 },
  { to: '/admin/horarios', label: 'Horários', Icon: Clock },
  { to: '/admin/assinatura', label: 'Assinatura', Icon: Crown },
  { to: '/admin/ajustes', label: 'Ajustes', Icon: Settings2 },
  { to: '/admin/guia', label: 'Ajuda', Icon: HelpCircle },
]

const DESKTOP_NAV = [
  { to: '/admin', end: true, label: 'Início', Icon: HomeIcon },
  { to: '/admin/agenda', label: 'Agenda', Icon: CalendarIcon },
  { to: '/admin/clientes', label: 'Clientes', Icon: UsersIcon },
  { to: '/admin/servicos', label: 'Serviços', Icon: Sparkles },
  { to: '/admin/equipe', label: 'Profissionais', Icon: UserRound },
  ...(PIX_LIGADO ? [{ to: '/admin/receber', label: 'Financeiro', Icon: WalletCards }] : []),
  { to: '/admin/promocoes', label: 'Marketing', Icon: Megaphone },
  { to: '/admin/numeros', label: 'Relatórios', Icon: BarChart3 },
  { to: '/admin/ajustes', label: 'Configurações', Icon: Settings2 },
]

export default function AdminShell({ children, amplo = false, primeiroAcesso = false }) {
  // só o miolo rola: ao trocar de página, volta para o topo dele
  const miolo = useRef(null)
  const { pathname } = useLocation()
  useEffect(() => { miolo.current?.scrollTo({ top: 0 }) }, [pathname])
  // 4.21: o tema do painel (claro ou escuro) vale enquanto o painel está aberto
  const [tema, setTema] = useState(lerTema)
  useEffect(() => { aplicarTema(lerTema()); const parar = ouvirTema(setTema); return () => { parar(); aplicarTema('claro') } }, [])
  const { salao, acesso, profile, saloes, trocarSalao, professional } = useAuth()
  // a dona que também atende (2.99) vê a própria agenda no menu
  const donaAtende = Boolean(professional && professional.salon_id === salao?.id)
  const nav = donaAtende ? [...DESKTOP_NAV.slice(0, 2), { to: '/pro/agenda', label: 'Minha agenda', Icon: CalendarHeart }, ...DESKTOP_NAV.slice(2)] : DESKTOP_NAV
  const navigate = useNavigate()
  const menu = donaAtende ? [{ to: '/pro/agenda', label: 'Minha agenda', Icon: CalendarHeart }, ...MENU] : MENU
  const [menuAberto, setMenuAberto] = useState(false)
  useEffect(() => { setMenuAberto(false) }, [pathname])
  useEffect(() => {
    if (!menuAberto) return
    const esc = (e) => { if (e.key === 'Escape') setMenuAberto(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [menuAberto])
  const noMenu = menu.some((m) => pathname === m.to || pathname.startsWith(m.to + '/'))
  const [busca, setBusca] = useState('')
  const [trocaAberta, setTrocaAberta] = useState(false)
  const nomePessoa = profile?.full_name || 'Conta MIMO'
  const primeiroNome = nomePessoa.split(' ')[0] || 'Conta'
  const fotos = Array.isArray(salao?.fotos) ? salao.fotos : []
  const thumbSalao = salao?.logo_url || fotos[0] || salao?.cover_url || salao?.foto_capa_url || ''
  const plano = acesso?.fase === 'teste'
    ? { titulo:'Teste gratuito', texto: acesso?.aguardando_configuracao ? 'Começa quando a agenda estiver pronta' : `${Math.max(0, Number(acesso?.dias ?? 0))} dias restantes` }
    : acesso?.fase === 'ativa'
      ? { titulo:'Plano ativo', texto:'Acesso liberado' }
      : acesso?.fase === 'configurando'
        ? { titulo:'Teste gratuito', texto:'Ainda não começou' }
        : { titulo:'Plano e assinatura', texto:'Ver acesso e cobrança' }

  function buscar(e) {
    e.preventDefault()
    const q = busca.trim()
    if (!q) return
    navigate('/admin/clientes?busca=' + encodeURIComponent(q))
  }

  return (
    <div className={'admin-shell' + (amplo ? ' admin-shell-amplo' : '') + (primeiroAcesso ? ' admin-shell-primeiro-acesso' : '')}>
      {/* a Mel (2.89.4): na home fala de tudo; nas outras telas acompanha só a configuração inicial */}
      <MelDock escopo={pathname === '/admin' ? 'tudo' : 'configuracao'} />
      <aside className="admin-desktop-sidebar" aria-label="Navegação principal">
        <div className="admin-sidebar-marca">
          <span><LogoMimo altura={38} pro /></span>
          <ChevronLeft size={17} />
        </div>
        <nav className="admin-sidebar-nav">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => isActive ? 'admin-sidebar-item ativo' : 'admin-sidebar-item'}
            >
              <item.Icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-rodape">
          <InstalarNoMenu para="salao" />
          <NavLink to="/admin/assinatura" className="admin-sidebar-plano">
            <span className="admin-sidebar-plano-icone"><Crown size={17} /></span>
            <span><strong>{plano.titulo}</strong><small>{plano.texto}</small></span>
            <span className="admin-sidebar-plano-cta">Ver planos</span>
          </NavLink>
          <button type="button" className="admin-sidebar-salao" onClick={() => setTrocaAberta((v) => !v)}>
            <span className="admin-sidebar-salao-avatar">{thumbSalao ? <img src={thumbSalao} alt="" /> : <Store size={17} />}</span>
            <span><strong>{salao?.name || 'Meu salão'}</strong><small>{saloes?.length > 1 ? 'Trocar salão' : 'Meu salão'}</small></span>
            {saloes?.length > 1 && <ChevronDown size={14} />}
          </button>
          {trocaAberta && saloes?.length > 1 && (
            <div className="admin-sidebar-troca">
              {saloes.map((item) => (
                <button key={item.id} type="button" className={item.id === salao?.id ? 'ativo' : ''} onClick={() => { trocarSalao(item.id); setTrocaAberta(false) }}>
                  {item.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <div className={primeiroAcesso ? 'admin-first-workspace' : 'admin-shell-workspace'}>
      <FaixaDoTeste />
      <header className={'topbar topbar-admin' + (primeiroAcesso ? ' topbar-admin-primeiro' : '')}>
        <div className="topbar-admin-esquerda">
          <span className="brand-inline">
            <LogoMimo altura={30} pro />
          </span>
          <button type="button" className="admin-topbar-negocio" onClick={() => saloes?.length > 1 && setTrocaAberta((v) => !v)}>
            <span className="admin-topbar-negocio-avatar">{thumbSalao ? <img src={thumbSalao} alt="" /> : <Store size={16} />}</span>
            <span><strong>{salao?.name || 'Meu salão'}</strong></span>
            {saloes?.length > 1 && <ChevronDown size={14} />}
          </button>
          <span className="admin-topbar-online"><i></i> Online</span>
          <ClimaTopo />
        </div>

        <form className="admin-topbar-busca" onSubmit={buscar}>
          <Search size={16} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente, serviço ou agendamento..." aria-label="Buscar no painel" />
          <kbd>Ctrl + K</kbd>
        </form>

        <div className="topbar-acoes">
          <button type="button" className="admin-topbar-tema" onClick={trocarTema} aria-label={tema === 'escuro' ? 'Usar tema claro' : 'Usar tema escuro'} title={tema === 'escuro' ? 'Tema claro' : 'Tema escuro'}>{tema === 'escuro' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <SinoAvisos />
          <div className="admin-topbar-user">
            <MenuDaConta itens={ITENS_ADMIN} papel={salao?.name ? `Administração · ${salao.name}` : 'Administração do salão'} />
            <span><strong>{primeiroNome}</strong><small>Proprietário</small></span>
          </div>
        </div>
      </header>

      <main className={'content admin-content' + (primeiroAcesso ? ' admin-content-primeiro' : '')} ref={miolo}><div className="miolo">{acesso?.fase === 'bloqueado' && pathname !== '/admin/assinatura' ? <PainelPausado para="admin" /> : children}</div></main>
      </div>

      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {TABS.map((t) =>
            t === null ? (
              <button key="novo" type="button" className="nav-item nav-novo" onClick={() => navigate('/admin/agenda?encaixe=1')}>
                <span className="nav-novo-bola"><Plus size={24} strokeWidth={2.2} /></span>
                <span>Novo horário</span>
              </button>
            ) : t === 'menu' ? (
              <button key="menu" type="button" className={'nav-item nav-menu' + (noMenu || menuAberto ? ' active' : '')} onClick={() => setMenuAberto((v) => !v)} aria-expanded={menuAberto} aria-haspopup="dialog">
                <LayoutGrid />
                <span>Menu</span>
              </button>
            ) : (
              <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}>
                <t.Icon />
                <span>{t.label}</span>
              </NavLink>
            ),
          )}
        </div>
      </nav>

      {menuAberto && (
        <div className="nav-folha-fundo" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setMenuAberto(false) }}>
          <div className="nav-folha" role="dialog" aria-modal="true" aria-label="Menu do painel">
            <span className="nav-folha-alca" aria-hidden="true" />
            <div className="nav-folha-topo">
              <strong>{salao?.name ?? 'Menu'}</strong>
              <button type="button" onClick={() => setMenuAberto(false)} aria-label="Fechar"><X size={18} /></button>
            </div>
            <div className="nav-folha-grade">
              {menu.map((m) => (
                <NavLink key={m.to} to={m.to} onClick={() => setMenuAberto(false)} className={({ isActive }) => (isActive ? 'on' : '')}>
                  <span className="nav-folha-bola"><m.Icon size={22} /></span>
                  <span>{m.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

