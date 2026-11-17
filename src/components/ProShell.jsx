import { useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useNotificacoes } from '../context/NotificacoesContext'
import { ehDaEquipe } from '../lib/meuSalao'
import PainelPausado from './PainelPausado'
import SinoAvisos from './SinoAvisos'
import MenuDaConta, { ITENS_PRO } from './MenuDaConta'
import { CalendarIcon, SparkleIcon, GraficoIcon, VoltarIcon, ClockIcon, BellIcon, PessoaIcon, LogoMimo } from './icons'


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

export default function ProShell({ children, titulo, voltar }) {
  // só o miolo rola: ao trocar de página, volta para o topo dele
  const miolo = useRef(null)
  const { pathname } = useLocation()
  useEffect(() => { miolo.current?.scrollTo({ top: 0 }) }, [pathname])
  const { professional, negocio, acesso } = useAuth()
  const { naoLidos } = useNotificacoes()
  const equipe = ehDaEquipe({ professional, negocio })
  const abas = equipe ? TABS_EQUIPE : TABS

  return (
    <div className="admin-shell">
      <header className="topbar topbar-admin">
        {voltar && <NavLink to={voltar} className="topo-voltar" aria-label="Voltar">‹</NavLink>}
        {titulo ? (
          <span className="topo-titulo">{titulo}</span>
        ) : (
          <span className="brand-inline">
            <LogoMimo altura={30} pro />
          </span>
        )}
        <div className="topbar-acoes">
          {!equipe && <SinoAvisos to="/pro/avisos" />}
          <MenuDaConta itens={equipe ? [] : ITENS_PRO} papel={professional?.especialidade || 'Profissional'} foto={professional?.photo_url} />
        </div>
      </header>

      <main className="content admin-content" ref={miolo}><div className="miolo">{acesso?.fase === 'bloqueado' ? <PainelPausado para="pro" dona={!equipe} /> : children}</div></main>

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
                  {naoLidos > 0 && <span className="nav-contador" aria-label={`${naoLidos} avisos novos`}>{naoLidos > 9 ? '9+' : naoLidos}</span>}
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
