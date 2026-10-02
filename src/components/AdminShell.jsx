import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PainelPausado from './PainelPausado'
import SinoAvisos from './SinoAvisos'
import MenuDaConta, { ITENS_ADMIN } from './MenuDaConta'
import ClimaTopo from './ClimaTopo'
import MelDock from './MelDock'
import { MarcaIcon, Wordmark } from './icons'
import {
  CalendarIcon,
  UsersIcon,
  ClockIcon,
  MaisIcon,
  HomeIcon,
} from './icons'
import { Sparkles, UserRound, WalletCards, Megaphone, Settings2, ChevronLeft, CreditCard, BarChart3, Search, Crown, Store, ChevronDown } from 'lucide-react'

// Cinco abas, não seis. Numa barra de celular, seis alvos dão 60px
// cada e o polegar erra. O mês, Serviços e WhatsApp foram para dentro
// de Ajustes: são coisas que se configuram, não o dia a dia.
// O botão do meio é a ação da casa — encaixar alguém agora.
const TABS = [
  { to: '/admin', end: true, label: 'Início', Icon: HomeIcon },
  { to: '/admin/agenda', label: 'Agenda', Icon: CalendarIcon },
  null,
  { to: '/admin/clientes', label: 'Clientes', Icon: UsersIcon },
  { to: '/admin/ajustes', label: 'Ajustes', Icon: ClockIcon },
]

const DESKTOP_NAV = [
  { to: '/admin', end: true, label: 'Início', Icon: HomeIcon },
  { to: '/admin/agenda', label: 'Agenda', Icon: CalendarIcon },
  { to: '/admin/clientes', label: 'Clientes', Icon: UsersIcon },
  { to: '/admin/servicos', label: 'Serviços', Icon: Sparkles },
  { to: '/admin/equipe', label: 'Profissionais', Icon: UserRound },
  { to: '/admin/receber', label: 'Financeiro', Icon: WalletCards },
  { to: '/admin/promocoes', label: 'Marketing', Icon: Megaphone },
  { to: '/admin/numeros', label: 'Relatórios', Icon: BarChart3 },
  { to: '/admin/ajustes', label: 'Configurações', Icon: Settings2 },
]

export default function AdminShell({ children, amplo = false, primeiroAcesso = false }) {
  // só o miolo rola: ao trocar de página, volta para o topo dele
  const miolo = useRef(null)
  const { pathname } = useLocation()
  useEffect(() => { miolo.current?.scrollTo({ top: 0 }) }, [pathname])
  const { salao, acesso, profile, saloes, trocarSalao } = useAuth()
  const navigate = useNavigate()
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
          <span><MarcaIcon className="marca" id="lateral" /><Wordmark tamanho={1.7} /></span>
          <ChevronLeft size={17} />
        </div>
        <nav className="admin-sidebar-nav">
          {DESKTOP_NAV.map((item) => (
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
      <header className={'topbar topbar-admin' + (primeiroAcesso ? ' topbar-admin-primeiro' : '')}>
        <div className="topbar-admin-esquerda">
          <span className="brand-inline">
            <MarcaIcon className="marca" id="topo" />
            <Wordmark tamanho={1.35} />
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
          <SinoAvisos />
          <div className="admin-topbar-user">
            <MenuDaConta itens={ITENS_ADMIN} papel={salao?.name ? `Administração · ${salao.name}` : 'Administração do salão'} />
            <span><strong>{primeiroNome}</strong><small>Proprietário</small></span>
          </div>
        </div>
      </header>

      <main className={'content admin-content' + (primeiroAcesso ? ' admin-content-primeiro' : '')} ref={miolo}><div className="miolo">{acesso?.fase === 'bloqueado' ? <PainelPausado para="admin" /> : children}</div></main>
      </div>

      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {TABS.map((t) =>
            t === null ? (
              <button
                key="mais"
                className="nav-mais"
                onClick={() => navigate('/admin/agenda?encaixe=1')}
                aria-label="Novo encaixe"
              >
                <MaisIcon />
              </button>
            ) : (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  isActive ? 'nav-item active' : 'nav-item'
                }
              >
                <t.Icon />
                <span>{t.label}</span>
              </NavLink>
            ),
          )}
        </div>
      </nav>
    </div>
  )
}

