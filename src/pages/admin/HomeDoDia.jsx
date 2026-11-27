import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, BellRing, CalendarDays, CalendarPlus, CheckCheck, ChevronRight, ClipboardCheck, Crown, Eye, EyeOff, HelpCircle, MessageCircle, Plus, QrCode, Scissors, UserPlus, Users, Hourglass } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { avisoDoAcesso } from '../../lib/acesso'
import { formatarCents, formatarPct, mesAtual, nomeDoMes } from '../../lib/numeros'
import { Contador, Faisca, Barras, Pessoa } from '../../components/admin/HomeDia'
import AvisosNovos from '../../components/AvisosNovos'
import PrimeirosPassos from '../../components/PrimeirosPassos'
import LigarAvisos from '../../components/LigarAvisos'

// A Home do salão já configurado (4.20), no desenho de banco digital: o cabeçalho na cor da casa, o faturamento do
// mês como o "saldo" (com o olho para esconder os valores), as ações em círculos, o que pede resposta em carrossel,
// o dia em lista, a equipe com o anel de ocupação e o mês em barras. Claro e escuro: todas as cores são variáveis
// em .hd; o tema (src/lib/tema.js) é do painel inteiro; aqui ele troca só as variáveis.
const CHAVE_OLHO = 'mimo-home-ocultar'
const ler = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const gravar = (k, v) => { try { localStorage.setItem(k, v) } catch { /* sem armazenamento */ } }
const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1)
const hm = (t) => String(t ?? '').slice(0, 5)

export default function HomeDoDia({ salao, nomePessoa, saudacao, logoSalao, iniciaisSalao, salaoAtivo, hoje, pendentes, naFila, linhas, porDia, pagosMes = 0, totalMes, atendMes, ocup, primeiros }) {
  const { acesso } = useAuth()
  const [oculto, setOculto] = useState(() => ler(CHAVE_OLHO) === '1')
  const [agenda, setAgenda] = useState(null)
  const [baixas, setBaixas] = useState(0)

  useEffect(() => {
    if (!salao?.id) return
    let vivo = true
    const d = new Date(), dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    supabase.from('appointments')
      .select('id, start_time, status, price_cents, service_name, guest_name, profiles (full_name), services (name), professionals (name)')
      .eq('salon_id', salao.id).eq('date', dia).neq('status', 'cancelado').order('start_time')
      .then(({ data }) => { if (vivo) setAgenda(data ?? []) })
    supabase.rpc('pendencias_de_baixa').then(({ data }) => { if (vivo) setBaixas((data ?? []).filter((p) => p.situacao === 'esperando').length) })
    return () => { vivo = false }
  }, [salao?.id])

  const mes = maiuscula(nomeDoMes(mesAtual()).split(' ')[0])
  const dinheiro = (cents) => (oculto ? 'R$ ••••' : formatarCents(cents))
  const agoraHM = new Date().toTimeString().slice(0, 5)
  const lista = agenda ?? []
  const proximos = lista.filter((a) => hm(a.start_time) >= agoraHM && a.status !== 'concluido')
  const noDia = (proximos.length ? proximos : lista).slice(0, 4)
  const semAcesso = Number(primeiros?.equipe_pendente ?? 0) + Number(primeiros?.equipe_rascunho ?? 0)
  const plano = avisoDoAcesso(acesso, { dona: true })

  // o que pede resposta, na ordem de urgência
  const avisos = [
    pendentes > 0 && { id: 'pedidos', tom: 'quente', Icone: BellRing, titulo: pendentes === 1 ? '1 pedido esperando você' : `${pendentes} pedidos esperando você`, texto: 'Confirme para garantir o horário da cliente.', acao: 'Responder', para: '/admin/agenda' },
    baixas > 0 && { id: 'baixas', Icone: ClipboardCheck, titulo: baixas === 1 ? '1 atendimento sem baixa' : `${baixas} atendimentos sem baixa`, texto: 'Veio, não veio ou remarcou. Sem resposta, conclui sozinho.', acao: 'Fechar o dia', para: '/admin/fechar-dia' },
    naFila > 0 && { id: 'fila', Icone: Hourglass, titulo: naFila === 1 ? '1 cliente na fila de espera' : `${naFila} clientes na fila de espera`, texto: 'Se abrir um horário, você já sabe quem chamar.', acao: 'Ver agenda', para: '/admin/agenda' },
    semAcesso > 0 && { id: 'equipe', Icone: Users, titulo: semAcesso === 1 ? '1 profissional sem acesso' : `${semAcesso} profissionais sem acesso`, texto: 'Já está na agenda, mas ainda não ativou o acesso dela.', acao: 'Ver equipe', para: '/admin/equipe' },
    plano && { id: 'plano', tom: plano.tom === 'calmo' ? 'ouro' : 'quente', Icone: Crown, titulo: plano.titulo, texto: plano.selo === 'Teste grátis' ? 'Sem cobrança automática. Você decide se renova.' : plano.texto, acao: plano.acao?.rotulo || 'Ver plano', para: plano.acao?.to || '/admin/assinatura' },
  ].filter(Boolean)

  const acoes = [
    { para: '/admin/agenda?encaixe=1', Icone: Plus, rotulo: 'Novo horário', principal: true },
    { para: '/admin/agenda', Icone: CalendarDays, rotulo: 'Agenda', selo: pendentes },
    { para: '/admin/equipe', Icone: UserPlus, rotulo: 'Equipe' },
    { para: '/admin/servicos', Icone: Scissors, rotulo: 'Serviços' },
    { para: '/admin/salao', Icone: QrCode, rotulo: 'Link e QR' },
    { para: '/admin/whatsapp', Icone: MessageCircle, rotulo: 'WhatsApp' },
    { para: '/admin/clientes', Icone: Users, rotulo: 'Clientes' },
    { para: '/admin/numeros', Icone: BarChart3, rotulo: 'Números' },
  ]
  const equipe = [...(linhas ?? [])].sort((a, b) => (Number(b.faturamento_cents) || 0) - (Number(a.faturamento_cents) || 0))
  const nomeDe = (a) => a.profiles?.full_name || a.guest_name || 'Cliente'
  const estado = (a) => a.status === 'pendente' ? ['pedido', 'Pedido'] : a.status === 'concluido' ? ['feito', 'Concluído'] : a.status === 'faltou' ? ['faltou', 'Faltou'] : ['ok', 'Confirmado']

  return (
    <div className="hd">
      <header className="hd-cab" data-tour="inicio">
        <svg className="hd-cab-arte" viewBox="0 0 400 220" preserveAspectRatio="xMaxYMin slice" aria-hidden="true">
          <circle cx="345" cy="20" r="120" /><circle cx="345" cy="20" r="82" /><circle cx="345" cy="20" r="46" />
          <path d="M-20,210 C70,150 150,230 240,170 S380,130 430,160" />
        </svg>
        <div className="hd-cab-linha">
          <span className="hd-logo">{logoSalao ? <img src={logoSalao} alt="" /> : <b>{iniciaisSalao || 'M'}</b>}</span>
          <div className="hd-cab-acoes">
            <button type="button" onClick={() => { const v = !oculto; setOculto(v); gravar(CHAVE_OLHO, v ? '1' : '0') }} aria-label={oculto ? 'Mostrar valores' : 'Esconder valores'} aria-pressed={oculto}>{oculto ? <EyeOff size={19} /> : <Eye size={19} />}</button>
            <Link to="/admin/guia" aria-label="Ajuda"><HelpCircle size={19} /></Link>
          </div>
        </div>
        <p className="hd-ola">{saudacao}{nomePessoa ? `, ${nomePessoa}` : ''}</p>
        <h1>{salao?.name ?? 'Meu salão'}</h1>
        <span className={'hd-estado' + (salaoAtivo ? ' on' : '')}><i />{salaoAtivo ? 'Agenda ativa' : 'Agenda ainda não ativada'} · {maiuscula(new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))}</span>
      </header>

      <div className="hd-corpo">
        <div className="hd-col">
          <Link to="/admin/numeros" className="hd-saldo" data-tour="numeros">
            <span className="hd-saldo-topo"><span>Faturamento de {mes.toLowerCase()}</span><ChevronRight size={18} /></span>
            <span className="hd-saldo-meio">
              <strong>{oculto ? 'R$ ••••' : <Contador valor={Math.round(totalMes / 100)} formato={(n) => 'R$ ' + n.toLocaleString('pt-BR')} />}</strong>
              <Faisca pontos={porDia} largura={120} altura={44} />
            </span>
            <small>{atendMes} {atendMes === 1 ? 'atendimento concluído' : 'atendimentos concluídos'} no mês</small>
            <span className="hd-saldo-pe">
              <span><em>Hoje</em><b><Contador valor={hoje.atendimentos} /></b><small>{dinheiro(hoje.faturamento)}</small></span>
              <span><em>Ocupação</em><b>{formatarPct(ocup)}</b><i className="hd-fio"><i style={{ width: `${Math.min(100, ocup / 100)}%` }} /></i></span>
              <span><em>Fila</em><b><Contador valor={naFila} /></b><small>{naFila === 1 ? 'esperando' : 'esperando'}</small></span>
            </span>
          </Link>

          <nav className="hd-acoes" data-tour="atalhos" aria-label="Ações do dia a dia">
            {acoes.map(({ para, Icone, rotulo, principal, selo }) => (
              <Link key={rotulo} to={para} className={principal ? 'principal' : ''}>
                <span className="hd-acao-bola"><Icone size={22} />{selo > 0 && <b>{selo}</b>}</span>
                <span>{rotulo}</span>
              </Link>
            ))}
          </nav>

          <section className="hd-avisos" data-tour="primeiros-passos" aria-label="O que pede a sua atenção">
            {avisos.length === 0 && <div className="hd-aviso calmo"><span className="hd-aviso-icone"><CheckCheck size={18} /></span><strong>Tudo em dia</strong><p>Nenhum pedido, baixa ou cliente esperando por você agora.</p></div>}
            {avisos.map(({ id, tom, Icone, titulo, texto, acao, para }) => (
              <Link key={id} to={para} className={'hd-aviso' + (tom ? ' ' + tom : '')}>
                <span className="hd-aviso-icone"><Icone size={18} /></span>
                <strong>{titulo}</strong>
                <p>{texto}</p>
                <span className="hd-aviso-acao">{acao} <ArrowRight size={14} /></span>
              </Link>
            ))}
          </section>

          {!salaoAtivo && <PrimeirosPassos salao={salao} parte="urgente" />}

          <section className="hd-secao">
            <Link to="/admin/agenda" className="hd-secao-topo">
              <span><h2>Hoje</h2><small>{hoje.atendimentos} {hoje.atendimentos === 1 ? 'atendimento' : 'atendimentos'} · {dinheiro(hoje.faturamento)} previstos</small></span>
              <ChevronRight size={20} />
            </Link>
            {agenda !== null && lista.length === 0 && (
              <div className="hd-vazio"><CalendarPlus size={22} /><strong>Dia livre</strong><p>Nenhum horário marcado para hoje.</p><Link to="/admin/agenda?encaixe=1" className="hd-botao">Marcar um horário</Link></div>
            )}
            {noDia.length > 0 && (
              <ul className="hd-dia">
                {!proximos.length && <li className="hd-dia-nota">Sem mais horários hoje. Estes foram os do dia:</li>}
                {noDia.map((a) => { const [classe, rotulo] = estado(a); return (
                  <li key={a.id} className={classe}>
                    <time>{hm(a.start_time)}</time>
                    <span className="hd-dia-quem"><strong>{nomeDe(a)}</strong><small>{a.services?.name || a.service_name || 'Atendimento'}{a.professionals?.name ? ` · ${a.professionals.name.split(' ')[0]}` : ''}</small></span>
                    <span className="hd-dia-lado"><b>{dinheiro(a.price_cents)}</b><em>{rotulo}</em></span>
                  </li>
                ) })}
              </ul>
            )}
            {lista.length > noDia.length && <Link to="/admin/agenda" className="hd-mais">Ver os {lista.length} horários de hoje <ArrowRight size={14} /></Link>}
          </section>
        </div>

        <div className="hd-col">
          <section className="hd-secao" data-tour="link">
            <Link to="/admin/equipe" className="hd-secao-topo">
              <span><h2>Equipe</h2><small>Quanto da agenda de cada uma está ocupada em {mes.toLowerCase()}</small></span>
              <ChevronRight size={20} />
            </Link>
            <div className="hd-equipe">
              {equipe.map((l) => (
                <Link key={l.professional_id} to="/admin/equipe" className="hd-pessoa">
                  <Pessoa nome={l.nome} pct={Number(l.ocupacao_bps ?? 0) / 100} />
                  <strong>{String(l.nome ?? '').split(' ')[0]}</strong>
                  <small>{formatarPct(l.ocupacao_bps)}</small>
                </Link>
              ))}
              <Link to="/admin/equipe" className="hd-pessoa nova"><span className="hd-pessoa-anel"><b><Plus size={22} /></b></span><strong>Adicionar</strong><small>profissional</small></Link>
            </div>
          </section>

          <section className="hd-secao">
            <Link to="/admin/numeros" className="hd-secao-topo">
              <span><h2>Movimento de {mes.toLowerCase()}</h2><small>Faturamento por dia, dos atendimentos concluídos</small></span>
              <ChevronRight size={20} />
            </Link>
            {porDia.length ? (oculto ? <p className="hd-oculto">Valores escondidos. Toque no olho, lá em cima, para ver.</p> : <Barras pontos={porDia} diasNoMes={new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()} hoje={new Date().getDate()} atendimentos={pagosMes} />)
              : <div className="hd-vazio"><BarChart3 size={22} /><strong>Os números começam aqui</strong><p>Quando os primeiros atendimentos forem concluídos, o movimento do mês aparece neste gráfico.</p></div>}
          </section>

          <div className="hd-novidades"><AvisosNovos /></div>
          <LigarAvisos semInstalar texto="Pedidos, cancelamentos e clientes chamando no WhatsApp chegam na hora, mesmo com o app fechado." />
          <div className="admin-dia-fim"><PrimeirosPassos salao={salao} parte="resto" /></div>
        </div>
      </div>
    </div>
  )
}
