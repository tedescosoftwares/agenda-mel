import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AdminShell from '../../components/AdminShell'
import AvisosNovos from '../../components/AvisosNovos'
import LigarAvisos from '../../components/LigarAvisos'
import { CartaoInstalar } from '../../components/InstalarApp'
import PendenciasBaixa from '../../components/PendenciasBaixa'
import { MEL_PADRAO } from '../../lib/mel'
import PrimeirosPassos from '../../components/PrimeirosPassos'
import AcessoAviso from '../../components/AcessoAviso'
import { supabase } from '../../lib/supabase'
import { useCategorias, temCategoria } from '../../lib/categorias'
import { useAuth } from '../../context/AuthContext'
import { formatarCents, formatarReaisCurto, formatarPct, mesAtual, nomeDoMes } from '../../lib/numeros'
import GraficoLinha from '../../components/GraficoLinha'
import { toISODate } from '../../lib/format'
import { linkDoSalao } from '../../lib/endereco'
import PrimeiroAcessoHome from './PrimeiroAcessoHome'
import { Contador, Faisca, Anel } from '../../components/admin/HomeDia'
import { CalendarPlus, Users, Sparkles, MessageCircle, FileSignature, ArrowRight, CalendarDays, TrendingUp, Clock3, QrCode, X, ChevronRight, Activity, Rocket, BellRing, CalendarCheck2, ArrowUpRight, CheckCheck, Zap, UserPlus, Scissors } from 'lucide-react'
import { PARCERIA_LIGADA } from '../../lib/contratoParceria'

// Dashboard do salão (tela 23): o dia de hoje em quatro números, o
// faturamento do mês dia a dia, o que está esperando resposta, e os
// atalhos para o que se faz todo dia.
export default function AdminDashboard() {
  const { salao, profile } = useAuth()
  const [hoje, setHoje] = useState({ atendimentos: 0, faturamento: 0 })
  const [proximo, setProximo] = useState(null)
  const [pendentes, setPendentes] = useState(0)
  const [naFila, setNaFila] = useState(0)
  const [linhas, setLinhas] = useState([])
  const [porDia, setPorDia] = useState([])
  const [semContrato, setSemContrato] = useState([])
  const [primeiros, setPrimeiros] = useState(null)
  const [cobertura, setCobertura] = useState(null)   // quem atende o quê, por categoria (2.94)
  const [clientesCount, setClientesCount] = useState(0)
  const [homeCarregada, setHomeCarregada] = useState(false)
  const navigate = useNavigate()
  useEffect(() => {
    try {
      if (localStorage.getItem('mimo-pdv') === '1' && window.innerWidth >= 900 && !sessionStorage.getItem('mimo-pdv-pausado')) navigate('/admin/pdv', { replace: true })
    } catch { /* sem armazenamento */ }
  }, [navigate])
  const salaoId = salao?.id

  const carregar = useCallback(async () => {
    if (!salaoId) return
    setHomeCarregada(false)
    const d = toISODate(new Date()), mes = mesAtual()
    const [ag, pend, fila, res, mesAg, pp, clientes, cb] = await Promise.all([
      supabase.from('appointments').select('price_cents, status, start_time').eq('salon_id', salaoId).eq('date', d).neq('status', 'cancelado'),
      supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('salon_id', salaoId).eq('status', 'pendente').gte('date', d),
      supabase.from('waitlist_entries').select('id, professionals!inner(salon_id)', { count: 'exact', head: true }).eq('professionals.salon_id', salaoId).eq('status', 'aguardando'),
      supabase.rpc('resumo_do_salao', { salao: salaoId, mes }),
      supabase.from('appointments').select('date, price_cents').eq('salon_id', salaoId).eq('status', 'concluido').gte('date', mes),
      supabase.rpc('primeiros_passos', { salao: salaoId }),
      supabase.rpc('clientes_do_salao', { salao: salaoId }),
      supabase.rpc('cobertura_por_categoria', { salao: salaoId }),
    ])
    const lista = ag.data ?? []
    setHoje({ atendimentos: lista.length, faturamento: lista.reduce((s, a) => s + (a.price_cents ?? 0), 0) })
    // o próximo horário que ainda vai acontecer hoje (para o cartão "Hoje")
    const agoraHM = new Date().toTimeString().slice(0, 5)
    setProximo(lista.map((a) => String(a.start_time ?? '').slice(0, 5)).filter((h) => h && h >= agoraHM).sort()[0] ?? null)
    setPendentes(pend.count ?? 0)
    setNaFila(fila.count ?? 0)
    setLinhas(res.data ?? [])
    const soma = {}
    for (const a of mesAg.data ?? []) soma[a.date] = (soma[a.date] ?? 0) + (a.price_cents ?? 0)
    setPorDia(Object.entries(soma).sort().map(([k, v]) => ({ x: k.slice(8, 10), y: v / 100 })))
    setPrimeiros(pp.data ?? null)
    setCobertura(Array.isArray(cb.data) ? cb.data : [])
    setClientesCount(Array.isArray(clientes.data) ? clientes.data.length : 0)
    setHomeCarregada(true)
  }, [salaoId])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => {
    if (!PARCERIA_LIGADA || !salao?.id || salao?.tipo === 'autonoma') return
    // só quem foi configurada como parceira (ou de antes da 119, sem vínculo definido) entra no aviso
    Promise.all([supabase.rpc('parcerias_da_equipe', { salao: salao.id }), supabase.from('professionals').select('id, vinculo').eq('salon_id', salao.id)]).then(([{ data }, { data: profs }]) => {
      const parceiras = new Set((profs ?? []).filter((p) => !p.vinculo || p.vinculo === 'parceira').map((p) => p.id))
      setSemContrato((data ?? []).filter((l) => parceiras.has(l.professional_id) && (l.status === 'sem_contrato' || l.status === 'rascunho' || l.status === 'enviado')))
    })
  }, [salao?.id, salao?.tipo])

  const totalMes = linhas.reduce((s, l) => s + Number(l.faturamento_cents ?? 0), 0)
  const atendMes = linhas.reduce((s, l) => s + Number(l.atendimentos ?? 0), 0)
  const ocup = linhas.length ? Math.round(linhas.reduce((s, l) => s + Number(l.ocupacao_bps ?? 0), 0) / linhas.length) : 0
  const maior = Math.max(1, ...linhas.map((l) => Number(l.faturamento_cents ?? 0)))

  const nomeSalao = salao?.name ?? 'Meu salão'
  const linkSalao = linkDoSalao(salao)
  const hojeTexto = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  const servicosProntos = Number(primeiros?.servicos ?? 0) > 0
  const equipePronta = salao?.tipo === 'autonoma' || Number(primeiros?.equipe ?? 0) > 0
  const catsReais = useCategorias()
  // ids fantasmas não contam (2.96.1): só categoria que existe, ou uma sua
  const categoriasProntas = catsReais.length ? temCategoria(catsReais, salao?.id, salao?.categorias_escolhidas) : (Array.isArray(salao?.categorias_escolhidas) && salao.categorias_escolhidas.length > 0)
  const linkPronto = Boolean(salao?.ativado_em)
  // quem faz o quê (2.94): todo serviço ativo com pelo menos uma profissional (autônoma: automático)
  const vinculosProntos = salao?.tipo === 'autonoma' ? servicosProntos : (servicosProntos && cobertura !== null && cobertura.length > 0 && cobertura.every((c) => Number(c.sem_profissional ?? 0) === 0))
  const configConcluida = Boolean(primeiros?.feitos?.configuracao)
  const progressoConfig = [categoriasProntas, servicosProntos, equipePronta, vinculosProntos]
  const feitosConfig = progressoConfig.filter(Boolean).length
  const primeiroAcesso = primeiros !== null && !configConcluida && (!servicosProntos || !equipePronta || !linkPronto || !vinculosProntos)

  const salaoAtivo = Boolean(salao?.ativado_em)
  const fotosSalao = Array.isArray(salao?.fotos) ? salao.fotos : []
  const capaSalao = fotosSalao[0] || salao?.cover_url || salao?.foto_capa_url || ''
  const logoSalao = salao?.logo_url || ''
  const iniciaisSalao = nomeSalao.split(/\s+/).filter(Boolean).slice(0,2).map((x) => x[0]).join('').toUpperCase()
  const nomePessoa = profile?.full_name?.split(' ')?.[0] || ''
  const horaAgora = new Date().getHours()
  const saudacao = horaAgora < 12 ? 'Bom dia' : horaAgora < 18 ? 'Boa tarde' : 'Boa noite'

  const agoraMimo = primeiroAcesso
    ? {
        icone: <Rocket size={19} />,
        selo: 'Próximo passo',
        titulo: 'Termine a configuração para começar a receber agendamentos.',
        texto: 'Serviços, profissionais e o link do salão ficam prontos por aqui, sem voltar para o onboarding.',
        acao: 'Continuar configuração',
        para: '/admin/configurar',
      }
    : pendentes > 0
    ? {
        icone: <BellRing size={19} />,
        selo: 'Precisa da sua atenção',
        titulo: pendentes === 1 ? 'Tem 1 pedido esperando confirmação.' : `Tem ${pendentes} pedidos esperando confirmação.`,
        texto: 'Responder rápido deixa a agenda redonda e a cliente segura de que está tudo certo.',
        acao: 'Ver pedidos na agenda',
        para: '/admin/agenda',
      }
    : naFila > 0
      ? {
          icone: <Users size={19} />,
          selo: 'Oportunidade agora',
          titulo: naFila === 1 ? 'Tem 1 cliente esperando uma vaga.' : `Tem ${naFila} clientes esperando uma vaga.`,
          texto: 'Se algum horário abrir, sua fila já te mostra quem pode ocupar esse espaço.',
          acao: 'Abrir agenda',
          para: '/admin/agenda',
        }
      : hoje.atendimentos > 0
        ? {
            icone: <Activity size={19} />,
            selo: 'Seu salão está em movimento',
            titulo: hoje.atendimentos === 1 ? 'Você tem 1 atendimento hoje.' : `Você tem ${hoje.atendimentos} atendimentos hoje.`,
            texto: `${formatarCents(hoje.faturamento)} em serviços já estão na agenda de hoje.`,
            acao: 'Acompanhar meu dia',
            para: '/admin/agenda',
          }
        : salaoAtivo
          ? {
              icone: <Sparkles size={19} />,
              selo: 'Tudo tranquilo por aqui',
              titulo: 'Sua agenda está pronta para receber clientes.',
              texto: 'Hoje ainda está livre. É um bom momento para compartilhar seu link ou revisar seus serviços.',
              acao: 'Ver meu salão',
              para: '/admin/salao',
            }
          : {
              icone: <Rocket size={19} />,
              selo: 'Sua MIMO está tomando forma',
              titulo: 'A base está pronta. Agora vamos colocar seu salão para rodar.',
              texto: 'Cadastre serviços, organize sua equipe e então libere o link e o QR Code para as clientes.',
              acao: 'Continuar configuração',
              para: '/admin/configurar',
            }

  if (!homeCarregada) {
    return (
      <AdminShell amplo>
        <div className="admin-home admin-home-loading" aria-busy="true">
          <div className="admin-home-skeleton hero"></div>
          <div className="admin-home-skeleton passos"></div>
          <div className="admin-home-skeleton-grid">
            <div className="admin-home-skeleton agenda"></div>
            <div className="admin-home-skeleton centro"></div>
            <div className="admin-home-skeleton lateral"></div>
          </div>
        </div>
      </AdminShell>
    )
  }

  if (primeiroAcesso) {
    return (
      <AdminShell amplo primeiroAcesso>
        <TutorialPainel primeiroAcesso />
        <PrimeiroAcessoHome
          saudacao={saudacao}
          nomePessoa={nomePessoa}
          capaSalao={capaSalao}
          logoSalao={logoSalao}
          iniciaisSalao={iniciaisSalao}
          nomeSalao={nomeSalao}
          hoje={hoje}
          clientesCount={clientesCount}
          feitosConfig={feitosConfig}
          categoriasProntas={categoriasProntas}
          servicosProntos={servicosProntos}
          equipePronta={equipePronta}
          vinculosProntos={vinculosProntos}
          linkPronto={linkPronto}
          linkSalao={linkSalao}
        />
      </AdminShell>
    )
  }

  return (
    <AdminShell amplo>
      <div className="admin-home">
        <TutorialPainel primeiroAcesso={primeiroAcesso} />

        {/* 4.19: a Home do salão já configurado é do dia a dia: quem é, o que fazer agora e os números. A configuração
            é passageira: sai do topo e fica só o que ainda falta, no fim da página */}
        <header className="dia-topo" data-tour="inicio">
          <svg className="dia-topo-arte" viewBox="0 0 600 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
            <defs>
              <radialGradient id="dia-brilho-a" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#ff7baa" stopOpacity=".5" /><stop offset="1" stopColor="#ff7baa" stopOpacity="0" /></radialGradient>
              <radialGradient id="dia-brilho-b" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#aa4cff" stopOpacity=".34" /><stop offset="1" stopColor="#aa4cff" stopOpacity="0" /></radialGradient>
            </defs>
            <circle className="dia-topo-bolha a" cx="470" cy="40" r="150" fill="url(#dia-brilho-a)" />
            <circle className="dia-topo-bolha b" cx="580" cy="170" r="130" fill="url(#dia-brilho-b)" />
            <path className="dia-topo-fio" d="M300,170 C360,90 430,190 500,110 S590,60 620,90" />
            <path className="dia-topo-fio dois" d="M340,200 C400,130 450,210 530,150 S600,120 630,140" />
          </svg>
          <div className="dia-quem">
            <span className="dia-logo">{logoSalao ? <img src={logoSalao} alt="" /> : <b>{iniciaisSalao || 'M'}</b>}</span>
            <div>
              <small>{saudacao}{nomePessoa ? `, ${nomePessoa}` : ''} <Sparkles size={12} /></small>
              <h1>{nomeSalao}</h1>
              <span className="dia-chips">
                <span className={'dia-chip' + (salaoAtivo ? ' on' : '')}><i></i>{salaoAtivo ? 'Agenda ativa' : 'Agenda ainda não ativada'}</span>
                <span className="dia-chip"><CalendarDays size={12} /> {hojeTexto.charAt(0).toUpperCase() + hojeTexto.slice(1)}</span>
              </span>
            </div>
          </div>
          <div className="dia-acoes">
            <Link to="/admin/agenda?encaixe=1" className="btn btn-primary"><CalendarPlus size={17} /> Novo horário</Link>
            <Link to="/admin/agenda" className="btn btn-ghost"><CalendarDays size={17} /> Abrir agenda</Link>
          </div>
        </header>

        <section className="dia-kpis" data-tour="numeros" aria-label="Os números do salão">
          <Link to="/admin/agenda" className="dia-kpi tom-rosa">
            <span className="dia-kpi-topo"><span className="dia-kpi-icone"><CalendarCheck2 size={18} /></span><span className="dia-kpi-rotulo">Hoje</span><ArrowUpRight size={15} className="dia-kpi-seta" /></span>
            <strong><Contador valor={hoje.atendimentos} /></strong>
            <small>{hoje.atendimentos === 1 ? 'atendimento na agenda' : 'atendimentos na agenda'}</small>
            <span className="dia-kpi-pe"><span><Clock3 size={12} /> {proximo ? `Próximo às ${proximo}` : hoje.atendimentos > 0 ? 'Dia encerrado' : 'Dia livre'}</span><em>{formatarCents(hoje.faturamento)}</em></span>
          </Link>
          <Link to="/admin/agenda" className={'dia-kpi ' + (pendentes > 0 ? 'tom-alerta' : 'tom-menta')}>
            <span className="dia-kpi-topo"><span className="dia-kpi-icone">{pendentes > 0 ? <BellRing size={18} /> : <CheckCheck size={18} />}</span><span className="dia-kpi-rotulo">Esperando você</span><ArrowUpRight size={15} className="dia-kpi-seta" /></span>
            <strong><Contador valor={pendentes} /></strong>
            <small>{pendentes === 1 ? 'pedido para confirmar' : 'pedidos para confirmar'}</small>
            <span className="dia-kpi-pe"><span>{pendentes > 0 ? <><Zap size={12} /> Responder agora</> : <><CheckCheck size={12} /> Tudo em dia</>}</span></span>
          </Link>
          <Link to="/admin/numeros" className="dia-kpi tom-violeta">
            <span className="dia-kpi-topo"><span className="dia-kpi-icone"><TrendingUp size={18} /></span><span className="dia-kpi-rotulo">{(() => { const m = nomeDoMes(mesAtual()).split(' ')[0]; return m.charAt(0).toUpperCase() + m.slice(1) })()}</span><ArrowUpRight size={15} className="dia-kpi-seta" /></span>
            <strong><Contador valor={Math.round(totalMes / 100)} formato={(n) => 'R$ ' + n.toLocaleString('pt-BR')} /></strong>
            <small>{atendMes} {atendMes === 1 ? 'atendimento concluído' : 'atendimentos concluídos'}</small>
            <Faisca pontos={porDia} />
          </Link>
          <Link to="/admin/agenda" className={'dia-kpi com-anel ' + (naFila > 0 ? 'tom-alerta' : 'tom-azul')}>
            <span className="dia-kpi-topo"><span className="dia-kpi-icone"><Users size={18} /></span><span className="dia-kpi-rotulo">Fila de espera</span><ArrowUpRight size={15} className="dia-kpi-seta" /></span>
            <strong><Contador valor={naFila} /></strong>
            <small>{naFila === 1 ? 'cliente esperando vaga' : 'clientes esperando vaga'}</small>
            <span className="dia-kpi-anel"><Anel pct={ocup / 100}>{Math.round(ocup / 100)}%</Anel><em>ocupação<br />do mês</em></span>
          </Link>
        </section>

        <AcessoAviso compacto />

        <nav className="dia-atalhos" data-tour="atalhos" aria-label="Ações do dia a dia">
          <Link to="/admin/equipe" className="tom-rosa"><span><UserPlus size={19} /></span><div><strong>Adicionar profissional</strong><small>Mais uma agenda no salão</small></div><ChevronRight size={16} /></Link>
          <Link to="/admin/servicos" className="tom-violeta"><span><Scissors size={19} /></span><div><strong>Serviços</strong><small>Preços, duração e fotos</small></div><ChevronRight size={16} /></Link>
          <Link to="/admin/salao" className="tom-azul"><span><QrCode size={19} /></span><div><strong>Link e QR do salão</strong><small>Para divulgar e receber clientes</small></div><ChevronRight size={16} /></Link>
          <Link to="/admin/whatsapp" className="tom-menta"><span><MessageCircle size={19} /></span><div><strong>WhatsApp</strong><small>A assistente e as mensagens</small></div><ChevronRight size={16} /></Link>
        </nav>

        {(pendentes > 0 || naFila > 0) && <section className="admin-home-pulso admin-dia-pulso">
          <div className="admin-home-pulso-principal">
            <span className="admin-home-pulso-icone">{agoraMimo.icone}<i></i></span>
            <div>
              <small>{agoraMimo.selo}</small>
              <strong>{agoraMimo.titulo}</strong>
              <p>{agoraMimo.texto}</p>
            </div>
            <Link to={agoraMimo.para} className="admin-home-pulso-acao">{agoraMimo.acao} <ArrowRight size={14} /></Link>
          </div>
        </section>}

        <div className="admin-home-alertas" data-tour="primeiros-passos">
          <AcessoAviso soAlerta />
          <PrimeirosPassos salao={salao} parte="urgente" />
          <PendenciasBaixa para="/admin/fechar-dia" />
          <AvisosNovos />
          <CartaoInstalar para="salao" />
          <LigarAvisos semInstalar texto="Pedidos, cancelamentos e clientes chamando no WhatsApp chegam na hora, mesmo com o app fechado." />
          {PARCERIA_LIGADA && semContrato.length > 0 && (
            <Link to="/admin/equipe" className="card fin-alerta parceria-alerta">
              <FileSignature size={18} />
              <span><strong>Parceria ainda não formalizada.</strong> {semContrato.length === 1 ? `${semContrato[0].nome} está configurada como parceira na MIMO, mas não há contrato registrado.` : `${semContrato.length} profissionais estão configuradas como parceiras na MIMO, mas não há contrato registrado.`} Confira se a formalização da relação está adequada ao modelo adotado pelo salão. <u>Ver orientação</u></span>
            </Link>
          )}
        </div>

        <div className="admin-home-grade">
          <section className="card admin-home-grafico">
            <div className="admin-home-secao-topo compacto">
              <div><span className="admin-home-label">Movimento</span><h2>Faturamento do mês</h2></div>
              <span className="admin-home-total">{formatarReaisCurto(totalMes)}</span>
            </div>
            {porDia.length
              ? <GraficoLinha pontos={porDia} />
              : <div className="admin-home-vazio"><TrendingUp size={22} /><strong>Os números começam aqui.</strong><span>Quando os primeiros atendimentos forem concluídos, o movimento do mês aparece neste gráfico.</span></div>}
          </section>

          <aside className="admin-home-lateral">
            <section className="card admin-home-profissionais">
              <div className="admin-home-secao-topo compacto">
                <div><span className="admin-home-label">Equipe</span><h2>Por profissional</h2></div>
                <Link to="/admin/equipe">Ver equipe</Link>
              </div>
              <div className="barra-list">
                {linhas.slice(0, 5).map((l) => (
                  <div key={l.professional_id} className="barra-item">
                    <div className="barra-topo"><span className="barra-nome">{l.nome}</span><span className="barra-valor">{formatarCents(l.faturamento_cents)}</span></div>
                    <div className="barra-trilho"><span className="barra-preenche" style={{ width: `${Math.max(2, (Number(l.faturamento_cents) * 100) / maior)}%` }} /></div>
                    <span className="barra-nota">{l.atendimentos}× · {formatarPct(l.ocupacao_bps)} ocupada</span>
                  </div>
                ))}
                {linhas.length === 0 && <div className="admin-home-vazio mini"><Users size={19} /><strong>Sua equipe vai aparecer aqui.</strong><span>Adicione profissionais para acompanhar o movimento de cada agenda.</span></div>}
              </div>
            </section>
          </aside>
        </div>

        <div className="admin-dia-fim" data-tour="link">
          <PrimeirosPassos salao={salao} parte="resto" />
        </div>
      </div>
    </AdminShell>
  )
}

const PASSOS_TOUR_DIA = [
  { alvo:'[data-tour="inicio"]', titulo:'Esse é o centro do seu salão', texto:'Aqui você enxerga o dia, abre sua agenda e continua qualquer configuração que ainda faltar.' },
  { alvo:'[data-tour="primeiros-passos"]', titulo:'A MIMO te mostra o que falta', texto:'Enquanto o salão ainda estiver sendo preparado, esta área te conduz por serviços, equipe, ativação, link e QR.' },
  { alvo:'[data-tour="numeros"]', titulo:'Os números aparecem sem você caçar', texto:'Atendimentos, movimento do mês, pedidos pendentes e fila de espera ficam resumidos aqui.' },
  { alvo:'[data-tour="atalhos"]', titulo:'As ações do dia a dia ficam perto', texto:'Equipe, serviços, encaixes e WhatsApp estão a um toque. Você não precisa decorar menus.' },
  { alvo:'[data-tour="link"]', titulo:'E daqui seu salão vai para a rua', texto:'O link e o QR Code são a porta de entrada das clientes. Quando a configuração estiver pronta, é isso que você compartilha.' },
]

const PASSOS_TOUR_PRIMEIRO = [
  { alvo:'[data-tour="inicio"]', titulo:'Esse é o centro do seu salão', texto:'A Home mostra o que já está pronto, o que falta e o caminho mais curto para colocar sua agenda para rodar.' },
  { alvo:'[data-tour="primeiros-passos"]', titulo:'Comece por estes quatro passos', texto:'Categorias, serviços, profissionais e o link público. Conforme você conclui, essa área vai desaparecendo e o painel do dia a dia assume o lugar.' },
  { alvo:'[data-tour="primeiro-operacao"]', titulo:'Aqui nasce a rotina do salão', texto:'A agenda, os pedidos e os resultados vão aparecer nesta área quando os primeiros clientes começarem a marcar.' },
  { alvo:'[data-tour="atalhos"]', titulo:'Você não precisa decorar menus', texto:'As ações mais comuns ficam perto enquanto você ainda está montando o salão.' },
  { alvo:'[data-tour="link"]', titulo:'Esse é o endereço do seu salão na MIMO', texto:'Quando estiver tudo pronto, compartilhe o link ou o QR Code no WhatsApp, Instagram e no balcão.' },
]

function TutorialPainel({ primeiroAcesso = false }) {
  const [convite, setConvite] = useState(() => {
    try { return localStorage.getItem('mimo-tour-painel-concluido') !== '1' && sessionStorage.getItem('mimo-tour-painel-depois') !== '1' }
    catch { return true }
  })
  const [passo, setPasso] = useState(-1)
  const [rect, setRect] = useState(null)

  const passos = primeiroAcesso ? PASSOS_TOUR_PRIMEIRO : PASSOS_TOUR_DIA
  const ativo = passo >= 0
  const atual = passos[passo]

  useEffect(() => {
    const abrir = () => iniciar()
    window.addEventListener('mimo:abrir-tour-painel', abrir)
    // a Mel manda para cá com ?tour=1 (2.89)
    if (new URLSearchParams(window.location.search).get('tour') === '1') { window.history.replaceState({}, '', '/admin'); setTimeout(abrir, 400) }
    return () => window.removeEventListener('mimo:abrir-tour-painel', abrir)
  }, [])

  useEffect(() => {
    if (!ativo || !atual) return
    const atualizar = () => {
      const el = document.querySelector(atual.alvo)
      if (!el) { setRect(null); return }
      el.scrollIntoView({ behavior:'smooth', block:'center' })
      setTimeout(() => {
        const r = el.getBoundingClientRect()
        setRect({ top:r.top, left:r.left, width:r.width, height:r.height })
      }, 300)
    }
    atualizar()
    window.addEventListener('resize', atualizar)
    return () => window.removeEventListener('resize', atualizar)
  }, [ativo, atual])

  function depois() {
    try { sessionStorage.setItem('mimo-tour-painel-depois', '1') } catch { /* segue */ }
    setConvite(false)
  }
  function iniciar() { setConvite(false); setPasso(0) }
  function fechar() { setPasso(-1) }
  function proximo() {
    if (passo >= passos.length - 1) {
      try { localStorage.setItem('mimo-tour-painel-concluido', '1') } catch { /* segue */ }
      setPasso(-1)
      return
    }
    setPasso((x) => x + 1)
  }

  return (
    <>
      {convite && (
        <div className="admin-tour-convite">
          <img className="admin-tour-mel" src={MEL_PADRAO} alt="" />
          <span><strong>Primeira vez por aqui?</strong><small>Eu sou a Mel. Te mostro o básico deste painel em menos de 1 minuto.</small></span>
          <div><button type="button" className="btn btn-ghost" onClick={depois}>Agora não</button><button type="button" className="btn btn-primary" onClick={iniciar}>Me mostra <ArrowRight size={15} /></button></div>
        </div>
      )}

      {ativo && atual && (
        <div className="admin-tour-overlay">
          {rect && <div className="admin-tour-foco" style={{ top:rect.top - 8, left:rect.left - 8, width:rect.width + 16, height:rect.height + 16 }} />}
          <div className="admin-tour-card com-mel">
            <img className="admin-tour-mel grande" src={MEL_PADRAO} alt="Mel" />
            <div className="admin-tour-card-topo"><span>Mel · {passo + 1} de {passos.length}</span><button type="button" onClick={fechar} aria-label="Fechar tutorial"><X size={17} /></button></div>
            <strong>{atual.titulo}</strong>
            <p>{atual.texto}</p>
            <div className="admin-tour-card-acoes">
              <button type="button" className="btn btn-ghost" onClick={fechar}>Sair do tour</button>
              <button type="button" className="btn btn-primary" onClick={proximo}>{passo === passos.length - 1 ? 'Pronto' : 'Próximo'} <ChevronRight size={15} /></button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}


