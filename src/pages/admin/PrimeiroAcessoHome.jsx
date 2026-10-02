import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import {
  ArrowRight, BellRing, CalendarDays, CalendarPlus, Check, ChevronRight, Copy,
  HelpCircle, Link2, PlayCircle, QrCode, Scissors, Settings2, Sparkles, Store,
  Sun, Trophy, Users, Zap,
} from 'lucide-react'
import { AGENDA_ART_EXACT } from '../../assets/mockArtExact'
import './PrimeiroAcessoHome.css'

// A home do primeiro acesso (2.85): o salão existe, falta montar a agenda.
// Uma tela só, sem rolar no desktop: hero com a foto do salão, os quatro
// primeiros passos, e embaixo agenda de hoje · agora na MIMO · ações
// rápidas + divulgar + ajuda com a Mel.
// a foto do hero é a capa que o salão subiu (fotos do espaço); só sem
// nenhuma foto entra a de estoque
const FUNDO_PADRAO = '/imagens/salao-1400.webp'

function money(cents = 0) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function MiniQr({ value }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    if (!value) { setSrc(''); return () => { alive = false } }
    QRCode.toDataURL(value, { width: 180, margin: 1, color: { dark: '#2c1636', light: '#ffffff' } })
      .then((url) => { if (alive) setSrc(url) }).catch(() => { if (alive) setSrc('') })
    return () => { alive = false }
  }, [value])
  return src ? <img className="fa-qr" src={src} alt="QR Code do salão" /> : <span className="fa-qr fa-qr-vazio" />
}

function StepCard({ number, title, text, to, done, current }) {
  return (
    <Link className={'fa-step' + (done ? ' is-done' : '') + (current ? ' is-current' : '')} to={to}>
      <span className="fa-step-number">{done ? <Check size={16} strokeWidth={3} /> : number}</span>
      <span className="fa-step-copy"><strong>{title}</strong><small>{text}</small></span>
      <ChevronRight size={16} />
    </Link>
  )
}

export default function PrimeiroAcessoHome({
  saudacao, nomePessoa, capaSalao, logoSalao, iniciaisSalao, nomeSalao, hoje, clientesCount,
  feitosConfig, categoriasProntas, servicosProntos, equipePronta, linkPronto, linkSalao,
}) {
  const progresso = Math.max(0, Math.min(100, (Number(feitosConfig || 0) / 4) * 100))
  const abrirTour = () => window.dispatchEvent(new CustomEvent('mimo:abrir-tour-painel'))
  const [copiado, setCopiado] = useState(false)
  function copiar() { if (!linkSalao) return; navigator.clipboard?.writeText(linkSalao); setCopiado(true); setTimeout(() => setCopiado(false), 1800) }
  const linkCurto = (linkSalao || 'seusalao.mimo.com.vc').replace(/^https?:\/\//, '').replace(/\/$/, '')
  const faltam = 4 - Number(feitosConfig || 0)

  const steps = useMemo(() => ([
    { number: 1, title: 'Categorias de serviços', text: 'Ex: Cabelo, Unha, Estética.', to: '/admin/configurar', done: categoriasProntas, current: !categoriasProntas },
    { number: 2, title: 'Serviços', text: 'Nome, duração e preço.', to: '/admin/servicos', done: servicosProntos, current: categoriasProntas && !servicosProntos },
    { number: 3, title: 'Profissionais', text: 'Sua equipe e as agendas.', to: '/admin/equipe', done: equipePronta, current: servicosProntos && !equipePronta },
    { number: 4, title: 'Compartilhar link', text: 'Divulgue e receba clientes.', to: '/admin/salao', done: linkPronto, current: equipePronta && !linkPronto },
  ]), [categoriasProntas, servicosProntos, equipePronta, linkPronto])

  return (
    <div className="fa-home">
      <section className="fa-hero" style={{ '--fa-fundo': `url("${capaSalao || FUNDO_PADRAO}")` }} data-tour="inicio">
        <div className="fa-hero-copy">
          <span className="fa-eyebrow"><Sun size={14} /> {saudacao}{nomePessoa ? `, ${nomePessoa}` : ''} <Sun size={14} /></span>
          <h1>Seu salão ganhou<br />um <em>centro de comando.</em></h1>
          <p>Organize sua agenda, sua equipe e receba mais clientes de forma simples, tudo em um só lugar.</p>
          <div className="fa-hero-actions">
            <Link className="fa-btn fa-btn-primary" to="/admin/configurar"><Settings2 size={17} /> Continuar configuração <ArrowRight size={16} /></Link>
            <button className="fa-btn fa-btn-tour" type="button" onClick={abrirTour}><PlayCircle size={18} /> Fazer tour guiado <span>1 min</span></button>
          </div>
        </div>

        <div className="fa-salon-card">
          <div className="fa-salon-head">
            <div className="fa-salon-photo">
              {logoSalao ? <img src={logoSalao} alt="" /> : capaSalao ? <img src={capaSalao} alt="" /> : <b>{iniciaisSalao || 'M'}</b>}
            </div>
            <div className="fa-salon-title">
              <span className="fa-online"><i /> Online</span>
              <strong>{nomeSalao}</strong>
            </div>
            <Link to="/admin/salao" className="fa-salon-go" aria-label="Ver meu salão"><ChevronRight size={20} /></Link>
          </div>
          <div className="fa-salon-metrics">
            <div><small>Hoje</small><strong>{hoje?.atendimentos ?? 0}</strong><span>atendimentos</span></div>
            <div><small>Faturamento hoje</small><strong>{money(hoje?.faturamento)}</strong></div>
            <div><small>Novos clientes</small><strong>{clientesCount ?? 0}</strong></div>
          </div>
        </div>
      </section>

      <section className="fa-setup" data-tour="primeiros-passos">
        <div className="fa-setup-top">
          <div className="fa-setup-title">
            <span className="fa-icon-badge"><CalendarDays size={22} /></span>
            <div>
              <span className="fa-eyebrow"><Sparkles size={12} /> Primeiros passos</span>
              <h2>Deixe seu salão pronto para receber clientes</h2>
              <p>Complete as etapas abaixo para liberar sua agenda e começar a receber agendamentos.</p>
            </div>
          </div>
          <div className="fa-progress-wrap">
            <div className="fa-progress"><i style={{ width: `${progresso}%` }} /></div>
            <div className="fa-progress-meta">{feitosConfig} de 4 concluídos</div>
          </div>
          <div className="fa-almost">
            <span className="fa-almost-icone"><Sparkles size={18} /></span>
            <div><strong>{faltam <= 1 ? 'Falta pouco!' : 'Vamos lá!'}</strong><small>{faltam <= 1 ? 'Seu salão já está quase pronto.' : `Faltam ${faltam} passos para liberar a agenda.`}</small></div>
          </div>
        </div>
        <div className="fa-steps">
          {steps.map((step) => <StepCard key={step.number} {...step} />)}
        </div>
      </section>

      <section className="fa-board" data-tour="primeiro-operacao">
        <article className="fa-card fa-agenda-card">
          <header className="fa-card-head">
            <div className="fa-card-titulo"><span className="fa-icon-badge"><CalendarDays size={20} /></span><h3>Agenda de hoje</h3></div>
            <Link to="/admin/agenda">Ver agenda completa <ArrowRight size={14} /></Link>
          </header>
          <div className="fa-empty">
            <div className="fa-agenda-art"><img src={AGENDA_ART_EXACT} alt="" /></div>
            <strong>Ainda não há agendamentos para hoje.</strong>
            <p>Quando os primeiros clientes agendarem, eles aparecerão aqui.</p>
            <Link className="fa-btn fa-btn-primary" to="/admin/agenda?encaixe=1"><CalendarPlus size={16} /> Fazer um agendamento teste</Link>
            <button type="button" onClick={abrirTour}><HelpCircle size={14} /> Como funciona?</button>
          </div>
        </article>

        <div className="fa-center-stack">
          <article className="fa-card fa-now-card">
            <header className="fa-card-head"><div className="fa-card-titulo"><span className="fa-icon-badge"><Zap size={20} /></span><h3>Agora na MIMO</h3></div></header>
            <div className="fa-now-list">
              <div className="is-ok">
                <i><Check size={15} strokeWidth={3} /></i>
                <span><strong>Seu salão está online</strong><small>Clientes já podem acessar seu link.</small></span>
              </div>
              <Link to="/admin/configurar" className={categoriasProntas ? 'is-ok' : 'is-todo'}>
                <i>{categoriasProntas ? <Check size={15} strokeWidth={3} /> : null}</i>
                <span><strong>{categoriasProntas ? 'Categorias criadas' : 'Crie suas categorias'}</strong><small>{categoriasProntas ? 'Suas categorias de serviços estão prontas.' : 'Organize o que você oferece.'}</small></span>
                {!categoriasProntas && <ChevronRight size={16} />}
              </Link>
              <Link to="/admin/servicos" className={servicosProntos ? 'is-ok' : 'is-todo'}>
                <i>{servicosProntos ? <Check size={15} strokeWidth={3} /> : null}</i>
                <span><strong>{servicosProntos ? 'Serviços cadastrados' : 'Cadastre seus serviços'}</strong><small>{servicosProntos ? 'Sua vitrine já sabe o que você oferece.' : `${faltam === 1 ? 'Falta 1 passo' : `Faltam ${faltam} passos`} para liberar sua agenda.`}</small></span>
                {!servicosProntos && <ChevronRight size={16} />}
              </Link>
              <button type="button" className="is-tour" onClick={abrirTour}>
                <i><PlayCircle size={16} /></i>
                <span><strong>Aprenda com o tour</strong><small>Veja como usar o painel em 1 minuto.</small></span>
                <ChevronRight size={16} />
              </button>
            </div>
          </article>

          <article className="fa-card fa-win-card">
            <header className="fa-card-head"><div className="fa-card-titulo"><span className="fa-icon-badge trophy"><Trophy size={18} /></span><h3>O que você vai conquistar</h3></div></header>
            <div className="fa-win-grid">
              <div><i><CalendarDays size={17} /></i><span><strong>Agenda organizada</strong><small>Veja todos os atendimentos do dia e quem vai atender.</small></span></div>
              <div><i><Users size={17} /></i><span><strong>Equipe em um só lugar</strong><small>Serviços, horários e agenda de cada profissional.</small></span></div>
              <div><i><BellRing size={17} /></i><span><strong>Pedidos de clientes</strong><small>Receba e confirme solicitações de agendamento.</small></span></div>
              <div><i><Link2 size={17} /></i><span><strong>Seu salão para compartilhar</strong><small>Link e QR para clientes marcarem sozinhos.</small></span></div>
            </div>
          </article>
        </div>

        <aside className="fa-right-stack">
          <article className="fa-card fa-quick-card" data-tour="atalhos">
            <header className="fa-card-head"><div className="fa-card-titulo"><span className="fa-icon-badge"><Zap size={20} /></span><h3>Ações rápidas</h3></div></header>
            <div className="fa-quick-grid">
              <Link className="fa-quick-action" to="/admin/servicos"><i><Scissors size={18} /></i><span>Novo serviço</span></Link>
              <Link className="fa-quick-action" to="/admin/equipe"><i><Users size={18} /></i><span>Nova profissional</span></Link>
              <Link className="fa-quick-action" to="/admin/salao"><i><Store size={18} /></i><span>Ver meu salão</span></Link>
              <button type="button" className="fa-quick-action" onClick={copiar}><i><Link2 size={18} /></i><span>{copiado ? 'Link copiado!' : 'Compartilhar link'}</span></button>
            </div>
          </article>

          <article className="fa-card fa-share-card" data-tour="link">
            <div className="fa-share-copy">
              <div className="fa-card-titulo"><span className="fa-icon-badge"><QrCode size={20} /></span><h3>Divulgue seu salão</h3></div>
              <small>Compartilhe seu link e comece a receber clientes.</small>
              <button type="button" className="fa-link-box" onClick={copiar} title="Copiar link">
                <Link2 size={15} /><span>{linkCurto}</span><Copy size={15} />
              </button>
            </div>
            <div className="fa-share-qr">
              <MiniQr value={linkSalao} />
              <small>Escanear QR</small>
            </div>
          </article>

        </aside>
      </section>

    </div>
  )
}
