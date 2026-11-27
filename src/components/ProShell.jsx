import { useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useNotificacoes } from '../context/NotificacoesContext'
import { ehDaEquipe, useMeuSalao, useConfirmaPedidos, linkWhatsApp } from '../lib/meuSalao'
import { Inbox } from 'lucide-react'
import PainelPausado from './PainelPausado'
import SinoAvisos from './SinoAvisos'
import MenuDaConta, { ITENS_PRO } from './MenuDaConta'
import Avatar from './Avatar'
import { InstalarNoMenu, ConviteInstalar } from './InstalarApp'
import { CalendarIcon, SparkleIcon, GraficoIcon, VoltarIcon, ClockIcon, BellIcon, PessoaIcon, LogoMimo, WhatsIcon } from './icons'
import '../pro-equipe.css'


const TABS = [
  { to: '/pro/agenda', label: 'Agenda', Icon: CalendarIcon },
  { to: '/pro/retorno', label: 'Volta', Icon: VoltarIcon },
  { to: '/pro/numeros', label: 'O mês', Icon: GraficoIcon },
  { to: '/pro/servicos', label: 'Serviços', Icon: SparkleIcon },
  { to: '/pro/ajustes', label: 'Ajustes', Icon: ClockIcon },
]
// 3.90: a profissional da equipe de um salão usa a MIMO como canal com o salão: a agenda dela,
// os avisos (recados do salão, horários novos e cancelados) e a conta (contato do salão, app).
// Encaixe, números, serviços e retorno ficam com o salão. A autônoma (dona do negócio) segue com tudo.
const TABS_EQUIPE = [
  { to: '/pro/agenda', label: 'Agenda', Icon: CalendarIcon },
  { to: '/pro/avisos', label: 'Avisos', Icon: BellIcon, sino: true },
  { to: '/pro/conta', label: 'Conta', Icon: PessoaIcon },
]
// 3.93: no computador o menu fica na lateral (a barra de baixo some a partir de 960px, como no
// painel do salão). A autônoma ganha também os Avisos no menu.
const MENU_AUTONOMA = [
  TABS[0],
  { to: '/pro/avisos', label: 'Avisos', Icon: BellIcon, sino: true },
  ...TABS.slice(1),
]

export default function ProShell({ children, titulo, voltar, amplo = false }) {
  // só o miolo rola: ao trocar de página, volta para o topo dele
  const miolo = useRef(null)
  const { pathname } = useLocation()
  useEffect(() => { miolo.current?.scrollTo({ top: 0 }) }, [pathname])
  const { professional, negocio, acesso, profile } = useAuth()
  const { naoLidos } = useNotificacoes()
  const equipe = ehDaEquipe({ professional, negocio })
  // 4.11: quando o salão deixa a confirmação com ela, a equipe ganha a aba Pedidos
  const confirma = useConfirmaPedidos()
  const tabsEquipe = confirma ? [TABS_EQUIPE[0], { to: '/pro/pedidos', label: 'Pedidos', Icon: Inbox }, ...TABS_EQUIPE.slice(1)] : TABS_EQUIPE
  const abas = equipe ? tabsEquipe : TABS
  const menu = equipe ? tabsEquipe : MENU_AUTONOMA
  const nome = professional?.name || profile?.full_name || ''
  const primeiroNome = nome.trim().split(/\s+/)[0] || 'Conta'
  const contador = naoLidos > 0 ? <span className="nav-contador" aria-label={`${naoLidos} avisos novos`}>{naoLidos > 9 ? '9+' : naoLidos}</span> : null

  return (
    <div className={'admin-shell pro-shell' + (amplo ? ' admin-shell-amplo' : '')}>
      <ConviteInstalar para={equipe ? 'equipe' : 'pro'} />
      <aside className="admin-desktop-sidebar pro-sidebar" aria-label="Navegação principal">
        <div className="admin-sidebar-marca">
          <span><LogoMimo altura={38} pro /></span>
        </div>
        <nav className="admin-sidebar-nav">
          {menu.map(({ to, label, Icon, sino }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'admin-sidebar-item ativo' : 'admin-sidebar-item')}>
              <Icon width={18} height={18} />
              <span>{label}</span>
              {sino && naoLidos > 0 && <span className="pro-sidebar-contador">{naoLidos > 9 ? '9+' : naoLidos}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-rodape pro-sidebar-rodape">
          <InstalarNoMenu para={equipe ? 'equipe' : 'pro'} />
          {equipe ? <SalaoNoMenu /> : negocio?.name ? (
            <div className="pro-sidebar-salao">
              <Avatar nome={negocio.name} foto={negocio.logo_url} />
              <span><strong>{negocio.name}</strong><small>Seu negócio</small></span>
            </div>
          ) : null}
        </div>
      </aside>

      <div className="admin-shell-workspace">
        <header className="topbar topbar-admin pro-topo">
          <div className="topbar-admin-esquerda">
            {voltar && <NavLink to={voltar} className="topo-voltar" aria-label="Voltar">‹</NavLink>}
            {titulo ? (
              <span className="topo-titulo">{titulo}</span>
            ) : (
              <span className="brand-inline">
                <LogoMimo altura={30} pro />
              </span>
            )}
          </div>
          <div className="pro-topo-meio" aria-hidden="true" />
          <div className="topbar-acoes">
            {!equipe && <SinoAvisos to="/pro/avisos" />}
            <div className="admin-topbar-user">
              <MenuDaConta itens={equipe ? [] : ITENS_PRO} papel={professional?.especialidade || 'Profissional'} foto={professional?.photo_url} />
              <span><strong>{primeiroNome}</strong><small>{professional?.especialidade || 'Profissional'}</small></span>
            </div>
          </div>
        </header>

        <main className="content admin-content" ref={miolo}><div className="miolo">{acesso?.fase === 'bloqueado' ? <PainelPausado para="pro" dona={!equipe} /> : children}</div></main>
      </div>

      <nav className={equipe ? 'bottom-nav nav-equipe' : 'bottom-nav'}>
        <div className="bottom-nav-inner">
          {abas.map(({ to, end, label, Icon, sino }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
            >
              {sino ? (
                <span className="nav-icone">
                  <Icon />
                  {contador}
                </span>
              ) : <Icon />}
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

// no menu do computador: o salão em que ela atende, com o atalho do WhatsApp da casa
function SalaoNoMenu() {
  const salao = useMeuSalao()
  if (!salao) return null
  const whats = linkWhatsApp(salao.whatsapp)
  return (
    <div className="pro-sidebar-salao">
      <Avatar nome={salao.name} foto={salao.logo_url} />
      <span><strong>{salao.name}</strong><small>Seu salão</small></span>
      {whats && <a href={whats} target="_blank" rel="noopener noreferrer" className="pro-sidebar-whats" aria-label={`Falar com ${salao.name} no WhatsApp`} title="Falar com o salão"><WhatsIcon width={16} height={16} /></a>}
    </div>
  )
}
