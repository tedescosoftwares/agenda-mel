import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  Copy,
  ExternalLink,
  Headphones,
  Link2,
  PlayCircle,
  QrCode,
  Scissors,
  Settings2,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react'
import { AGENDA_ART_EXACT, MEL_ART_EXACT } from '../../assets/mockArtExact'
import './PrimeiroAcessoHome.css'

function money(cents = 0) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function MiniQr({ value }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    if (!value) {
      setSrc('')
      return () => { alive = false }
    }
    QRCode.toDataURL(value, {
      width: 180,
      margin: 1,
      color: { dark: '#40144f', light: '#ffffff' },
    }).then((url) => {
      if (alive) setSrc(url)
    }).catch(() => {
      if (alive) setSrc('')
    })
    return () => { alive = false }
  }, [value])
  return src ? <img className="fa-qr" src={src} alt="QR Code do salão" /> : null
}

function StepCard({ number, title, text, to, done, current }) {
  return (
    <Link className={'fa-step' + (done ? ' is-done' : '') + (current ? ' is-current' : '')} to={to}>
      <span className="fa-step-number">{done ? <BadgeCheck size={16} /> : number}</span>
      <span className="fa-step-copy">
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <ChevronRight size={15} />
    </Link>
  )
}

function QuickAction({ icon, title, text, to }) {
  return (
    <Link className="fa-quick-action" to={to}>
      <i>{icon}</i>
      <span><strong>{title}</strong><small>{text}</small></span>
      <ChevronRight size={14} />
    </Link>
  )
}

export default function PrimeiroAcessoHome({
  saudacao,
  nomePessoa,
  capaSalao,
  logoSalao,
  iniciaisSalao,
  nomeSalao,
  hoje,
  clientesCount,
  feitosConfig,
  categoriasProntas,
  servicosProntos,
  equipePronta,
  linkPronto,
  linkSalao,
}) {
  const progresso = Math.max(0, Math.min(100, (Number(feitosConfig || 0) / 4) * 100))
  const abrirTour = () => window.dispatchEvent(new CustomEvent('mimo:abrir-tour-painel'))

  const steps = useMemo(() => ([
    {
      number: 1,
      title: 'Categorias de serviços',
      text: 'Organize os tipos de atendimento.',
      to: '/admin/configurar',
      done: categoriasProntas,
      current: !categoriasProntas,
    },
    {
      number: 2,
      title: 'Serviços',
      text: 'Cadastre duração, preço e detalhes.',
      to: '/admin/servicos',
      done: servicosProntos,
      current: categoriasProntas && !servicosProntos,
    },
    {
      number: 3,
      title: 'Profissionais',
      text: 'Monte sua equipe e defina as agendas.',
      to: '/admin/equipe',
      done: equipePronta,
      current: servicosProntos && !equipePronta,
    },
    {
      number: 4,
      title: 'Compartilhar link',
      text: 'Leve sua agenda para os clientes.',
      to: '/admin/salao',
      done: linkPronto,
      current: equipePronta && !linkPronto,
    },
  ]), [categoriasProntas, servicosProntos, equipePronta, linkPronto])

  return (
    <div className="fa-home">
      <section
        className="fa-hero"
        style={capaSalao ? { '--fa-cover': `url("${capaSalao}")` } : undefined}
        data-tour="inicio"
      >
        <div className="fa-hero-photo" aria-hidden="true" />
        <div className="fa-hero-glass" aria-hidden="true" />
        <div className="fa-orb fa-orb-pink" aria-hidden="true" />
        <div className="fa-orb fa-orb-purple" aria-hidden="true" />

        <div className="fa-hero-copy">
          <span className="fa-eyebrow"><Sparkles size={14} /> {saudacao}{nomePessoa ? `, ${nomePessoa}` : ''}</span>
          <h1>Seu salão ganhou um <em>centro de comando.</em></h1>
          <p>Organize sua agenda, sua equipe e receba mais clientes de forma simples, tudo em um só lugar.</p>

          <div className="fa-hero-actions">
            <Link className="fa-btn fa-btn-primary" to="/admin/configurar">
              <Settings2 size={17} />
              Continuar configuração
              <ArrowRight size={16} />
            </Link>
            <button className="fa-btn fa-btn-tour" type="button" onClick={abrirTour}>
              <PlayCircle size={17} />
              Fazer tour guiado
              <span>1 min</span>
            </button>
          </div>
        </div>

        <div className="fa-salon-card">
          <div className="fa-salon-head">
            <div className="fa-salon-photo">
              {logoSalao ? <img src={logoSalao} alt="" /> : capaSalao ? <img src={capaSalao} alt="" /> : <b>{iniciaisSalao || 'M'}</b>}
            </div>
            <div className="fa-salon-title">
              <small>Você está vendo</small>
              <strong>{nomeSalao}</strong>
            </div>
            <span className="fa-online"><i /> Online</span>
            <ChevronRight size={18} />
          </div>

          <div className="fa-salon-metrics">
            <div><small>Hoje</small><strong>{hoje?.atendimentos ?? 0}</strong><span>atendimentos</span></div>
            <div><small>Faturamento hoje</small><strong>{money(hoje?.faturamento)}</strong></div>
            <div><small>Novos clientes</small><strong>{clientesCount ?? 0}</strong></div>
          </div>

          <Link className="fa-salon-link" to="/admin/agenda">
            Ver agenda de hoje <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      <section className="fa-setup" data-tour="primeiros-passos">
        <div className="fa-setup-top">
          <div className="fa-setup-title">
            <span className="fa-icon-badge"><Sparkles size={20} /></span>
            <div>
              <span className="fa-eyebrow">Primeiros passos</span>
              <h2>Deixe seu salão pronto para receber clientes</h2>
              <p>Complete o essencial abaixo para liberar a agenda e começar a receber agendamentos de verdade.</p>
            </div>
          </div>

          <div className="fa-progress-wrap">
            <div className="fa-progress-meta"><strong>{feitosConfig} de 4 concluídos</strong></div>
            <div className="fa-progress"><i style={{ width: `${progresso}%` }} /></div>
          </div>

          <div className="fa-almost">
            <Sparkles size={17} />
            <div><strong>Falta pouco!</strong><small>Seu salão já está quase pronto.</small></div>
          </div>
        </div>

        <div className="fa-steps">
          {steps.map((step) => <StepCard key={step.number} {...step} />)}
        </div>
      </section>

      <section className="fa-board" data-tour="primeiro-operacao">
        <article className="fa-card fa-agenda-card">
          <header className="fa-card-head">
            <div><span className="fa-eyebrow">Seu dia</span><h3>Agenda de hoje</h3></div>
            <Link to="/admin/agenda">Ver agenda completa <ArrowRight size={14} /></Link>
          </header>
          <div className="fa-empty">
            <div className="fa-agenda-art"><img src={AGENDA_ART_EXACT} alt="" /></div>
            <strong>Ainda não há agendamentos para hoje.</strong>
            <p>Quando os primeiros clientes agendarem, eles aparecerão aqui com horário, serviço e profissional.</p>
            <Link className="fa-btn fa-btn-primary fa-btn-small" to="/admin/agenda?encaixe=1">
              <CalendarPlus size={15} />
              Fazer um agendamento teste
            </Link>
            <button type="button" onClick={abrirTour}>Como funciona?</button>
          </div>
        </article>

        <div className="fa-center-stack">
          <article className="fa-card fa-now-card">
            <header className="fa-card-head"><div><span className="fa-eyebrow">Agora na MIMO</span><h3>Seu salão está tomando forma</h3></div></header>
            <div className="fa-now-list">
              <div className="is-ok">
                <i><BadgeCheck size={16} /></i>
                <span><strong>Seu salão está online</strong><small>Clientes já podem acessar seu link.</small></span>
              </div>
              <Link to="/admin/configurar" className={categoriasProntas ? 'is-ok' : ''}>
                <i>{categoriasProntas ? <BadgeCheck size={16} /> : <Sparkles size={15} />}</i>
                <span><strong>{categoriasProntas ? 'Categorias criadas' : 'Crie suas categorias'}</strong><small>Organize o que você oferece.</small></span>
                <ChevronRight size={14} />
              </Link>
              <Link to="/admin/servicos" className={servicosProntos ? 'is-ok' : 'is-current'}>
                <i>{servicosProntos ? <BadgeCheck size={16} /> : <Scissors size={15} />}</i>
                <span><strong>{servicosProntos ? 'Serviços cadastrados' : 'Cadastre seus serviços'}</strong><small>{servicosProntos ? 'Sua vitrine já sabe o que você oferece.' : 'Falta esse passo para montar a agenda.'}</small></span>
                <ChevronRight size={14} />
              </Link>
              <button type="button" className="is-tour" onClick={abrirTour}>
                <i><PlayCircle size={16} /></i>
                <span><strong>Aprenda com o tour</strong><small>Veja o painel em menos de 1 minuto.</small></span>
                <ChevronRight size={14} />
              </button>
            </div>
          </article>

          <article className="fa-card fa-win-card">
            <div className="fa-win-head">
              <span className="fa-icon-badge trophy"><Trophy size={18} /></span>
              <div><strong>O que você vai conquistar</strong><small>Quando a configuração terminar, essa Home vira o centro da operação.</small></div>
            </div>
            <div className="fa-win-grid">
              <div><i><CalendarDays size={16} /></i><span><strong>Agenda organizada</strong><small>Veja o dia e quem vai atender.</small></span></div>
              <div><i><Users size={16} /></i><span><strong>Equipe em um só lugar</strong><small>Serviços, horários e agenda de cada profissional.</small></span></div>
              <div><i><BellRing size={16} /></i><span><strong>Pedidos de clientes</strong><small>Receba e confirme solicitações.</small></span></div>
              <div><i><Link2 size={16} /></i><span><strong>Seu salão para compartilhar</strong><small>Link e QR para marcarem sozinhos.</small></span></div>
            </div>
          </article>
        </div>

        <aside className="fa-right-stack">
          <article className="fa-card fa-quick-card" data-tour="atalhos">
            <header className="fa-card-head"><div><span className="fa-eyebrow">Acesso rápido</span><h3>Ações rápidas</h3></div></header>
            <div className="fa-quick-grid">
              <QuickAction icon={<Scissors size={17} />} title="Cadastrar serviço" text="Adicione o que seu salão oferece" to="/admin/servicos" />
              <QuickAction icon={<Users size={17} />} title="Adicionar profissional" text="Monte a equipe e os horários" to="/admin/equipe" />
              <QuickAction icon={<QrCode size={17} />} title="Ver meu salão" text="Confira sua página pública" to="/admin/salao" />
              <QuickAction icon={<Link2 size={17} />} title="Compartilhar link" text="Leve a agenda aos clientes" to="/admin/salao" />
            </div>
          </article>

          <article className="fa-card fa-share-card" data-tour="link">
            <div className="fa-share-copy">
              <span className="fa-eyebrow">Divulgue seu salão</span>
              <strong>Seu link já pode morar no Instagram, WhatsApp e balcão.</strong>
              <small>Copie o link ou use o QR Code.</small>
            </div>
            <div className="fa-share-row">
              <span className="fa-link-box">{linkSalao || 'seusalao.mimo.com.vc'}</span>
              {linkSalao && <MiniQr value={linkSalao} />}
            </div>
            <div className="fa-share-actions">
              {linkSalao && <button type="button" onClick={() => navigator.clipboard?.writeText(linkSalao)}><Copy size={13} /> Copiar link</button>}
              {linkSalao && <a href={linkSalao} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Abrir</a>}
            </div>
          </article>

          <article className="fa-card fa-help-card">
            <div className="fa-help-copy">
              <span className="fa-help-icon"><Headphones size={19} /></span>
              <div><strong>Precisa de ajuda?</strong><small>Acesse os tutoriais ou fale com o suporte da MIMO.</small></div>
              <Link to="/admin/guia">Acessar central de ajuda <ArrowRight size={13} /></Link>
            </div>
            <div className="fa-mel">
              <span>Oi! Eu sou a <b>Mel</b> 💗</span>
              <img src={MEL_ART_EXACT} alt="Mel, assistente virtual da MIMO" />
            </div>
          </article>
        </aside>
      </section>
    </div>
  )
}
