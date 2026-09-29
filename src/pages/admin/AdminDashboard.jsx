import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AdminShell from '../../components/AdminShell'
import AvisosNovos from '../../components/AvisosNovos'
import LigarAvisos from '../../components/LigarAvisos'
import PendenciasBaixa from '../../components/PendenciasBaixa'
import PrimeirosPassos from '../../components/PrimeirosPassos'
import AcessoAviso from '../../components/AcessoAviso'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatarCents, formatarReaisCurto, formatarPct, mesAtual, nomeDoMes } from '../../lib/numeros'
import GraficoLinha from '../../components/GraficoLinha'
import { toISODate } from '../../lib/format'
import { CalendarPlus, Users, Sparkles, MessageCircle, FileSignature, ArrowRight, CalendarDays, TrendingUp, Clock3, QrCode, Settings2, X, PlayCircle, ChevronRight } from 'lucide-react'

// Dashboard do salão (tela 23): o dia de hoje em quatro números, o
// faturamento do mês dia a dia, o que está esperando resposta, e os
// atalhos para o que se faz todo dia.
export default function AdminDashboard() {
  const { salao } = useAuth()
  const [hoje, setHoje] = useState({ atendimentos: 0, faturamento: 0 })
  const [pendentes, setPendentes] = useState(0)
  const [naFila, setNaFila] = useState(0)
  const [linhas, setLinhas] = useState([])
  const [porDia, setPorDia] = useState([])
  const [semContrato, setSemContrato] = useState([])
  const navigate = useNavigate()
  useEffect(() => {
    try {
      if (localStorage.getItem('mimo-pdv') === '1' && window.innerWidth >= 900 && !sessionStorage.getItem('mimo-pdv-pausado')) navigate('/admin/pdv', { replace: true })
    } catch { /* sem armazenamento */ }
  }, [navigate])
  const salaoId = salao?.id

  const carregar = useCallback(async () => {
    if (!salaoId) return
    const d = toISODate(new Date()), mes = mesAtual()
    const [ag, pend, fila, res, mesAg] = await Promise.all([
      supabase.from('appointments').select('price_cents, status').eq('salon_id', salaoId).eq('date', d).neq('status', 'cancelado'),
      supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('salon_id', salaoId).eq('status', 'pendente').gte('date', d),
      supabase.from('waitlist_entries').select('id', { count: 'exact', head: true }).eq('status', 'aguardando'),
      supabase.rpc('resumo_do_salao', { salao: salaoId, mes }),
      supabase.from('appointments').select('date, price_cents').eq('salon_id', salaoId).eq('status', 'concluido').gte('date', mes),
    ])
    const lista = ag.data ?? []
    setHoje({ atendimentos: lista.length, faturamento: lista.reduce((s, a) => s + (a.price_cents ?? 0), 0) })
    setPendentes(pend.count ?? 0)
    setNaFila(fila.count ?? 0)
    setLinhas(res.data ?? [])
    const soma = {}
    for (const a of mesAg.data ?? []) soma[a.date] = (soma[a.date] ?? 0) + (a.price_cents ?? 0)
    setPorDia(Object.entries(soma).sort().map(([k, v]) => ({ x: k.slice(8, 10), y: v / 100 })))
  }, [salaoId])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => {
    if (!salao?.id || salao?.tipo === 'autonoma') return
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
  const primeiraPalavra = nomeSalao.split(' ')[0]
  const hojeTexto = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  const temMovimento = hoje.atendimentos > 0 || totalMes > 0 || pendentes > 0 || naFila > 0

  return (
    <AdminShell amplo>
      <div className="admin-home">
        <TutorialPainel />

        <section className="admin-home-hero" data-tour="inicio">
          <div className="admin-home-hero-copy">
            <span className="admin-home-eyebrow"><Sparkles size={13} /> Seu salão na MIMO</span>
            <h1>{temMovimento ? <>Tudo acontecendo em <strong>{primeiraPalavra}</strong>, num só lugar.</> : <>Seu salão ganhou um <strong>centro de comando.</strong></>}</h1>
            <p>{temMovimento
              ? 'Agenda, equipe, clientes e números organizados para você bater o olho e saber o que precisa de atenção.'
              : 'Você já montou a base. Agora faltam poucos passos para começar a receber agendamentos de verdade.'}</p>
            <div className="admin-home-hero-acoes">
              <Link to="/admin/agenda" className="btn btn-primary"><CalendarDays size={16} /> Abrir agenda</Link>
              <Link to="/admin/configurar" className="btn btn-ghost"><Settings2 size={16} /> Continuar configuração</Link>
            </div>
          </div>

          <div className="admin-home-hoje">
            <div className="admin-home-hoje-topo">
              <span>Hoje</span>
              <small>{hojeTexto}</small>
            </div>
            <div className="admin-home-hoje-numero"><strong>{hoje.atendimentos}</strong><span>{hoje.atendimentos === 1 ? 'atendimento' : 'atendimentos'}</span></div>
            <div className="admin-home-hoje-linha">
              <span><TrendingUp size={14} /> previsto hoje</span>
              <strong>{formatarCents(hoje.faturamento)}</strong>
            </div>
            <Link to="/admin/agenda" className="admin-home-hoje-link">Ver agenda de hoje <ArrowRight size={14} /></Link>
          </div>
        </section>

        <div className="admin-home-alertas" data-tour="primeiros-passos">
          <AcessoAviso />
          <PrimeirosPassos salao={salao} />
          <AvisosNovos />
          <PendenciasBaixa para="/admin/fechar-dia" />
          <LigarAvisos texto="Pedidos, cancelamentos e clientes chamando no WhatsApp chegam na hora, mesmo com o app fechado." />
          {semContrato.length > 0 && (
            <Link to="/admin/equipe" className="card fin-alerta parceria-alerta">
              <FileSignature size={18} />
              <span><strong>Parceria ainda não formalizada.</strong> {semContrato.length === 1 ? `${semContrato[0].nome} está configurada como parceira na MIMO, mas não há contrato registrado.` : `${semContrato.length} profissionais estão configuradas como parceiras na MIMO, mas não há contrato registrado.`} Confira se a formalização da relação está adequada ao modelo adotado pelo salão. <u>Ver orientação</u></span>
            </Link>
          )}
        </div>

        <section className="admin-home-resumo" data-tour="numeros">
          <div className="admin-home-secao-topo">
            <div><span className="admin-home-label">Visão rápida</span><h2>Seu negócio hoje</h2></div>
            <span className="admin-home-data">{hojeTexto}</span>
          </div>

          <div className="admin-home-kpis">
            <div className="admin-home-kpi destaque">
              <span className="admin-home-kpi-icone"><CalendarDays size={18} /></span>
              <span className="admin-home-kpi-label">Atendimentos hoje</span>
              <strong>{hoje.atendimentos}</strong>
              <small>{formatarCents(hoje.faturamento)} em serviços agendados</small>
            </div>
            <div className="admin-home-kpi">
              <span className="admin-home-kpi-icone"><TrendingUp size={18} /></span>
              <span className="admin-home-kpi-label">{nomeDoMes(mesAtual()).split(' ')[0]}</span>
              <strong>{formatarReaisCurto(totalMes)}</strong>
              <small>{atendMes} {atendMes === 1 ? 'atendimento concluído' : 'atendimentos concluídos'}</small>
            </div>
            <Link to="/admin/agenda" className="admin-home-kpi admin-home-kpi-link">
              <span className="admin-home-kpi-icone"><Clock3 size={18} /></span>
              <span className="admin-home-kpi-label">Esperando confirmação</span>
              <strong>{pendentes}</strong>
              <small>{pendentes === 1 ? 'pedido precisa de resposta' : 'pedidos precisam de resposta'}</small>
            </Link>
            <div className="admin-home-kpi">
              <span className="admin-home-kpi-icone"><Users size={18} /></span>
              <span className="admin-home-kpi-label">Fila de espera</span>
              <strong>{naFila}</strong>
              <small>ocupação média de {formatarPct(ocup)}</small>
            </div>
          </div>
        </section>

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

          <aside className="admin-home-lateral" data-tour="atalhos">
            <section className="card admin-home-acoes">
              <div className="admin-home-secao-topo compacto">
                <div><span className="admin-home-label">Acesso rápido</span><h2>O que você pode fazer agora</h2></div>
              </div>
              <div className="admin-home-atalhos">
                <Link to="/admin/agenda?encaixe=1"><span><CalendarPlus size={18} /></span><strong>Novo encaixe</strong><small>Adicionar um atendimento manualmente</small><ArrowRight size={14} /></Link>
                <Link to="/admin/equipe"><span><Users size={18} /></span><strong>Equipe</strong><small>Profissionais e agendas</small><ArrowRight size={14} /></Link>
                <Link to="/admin/servicos"><span><Sparkles size={18} /></span><strong>Serviços</strong><small>Preços, duração e categorias</small><ArrowRight size={14} /></Link>
                <Link to="/admin/whatsapp"><span><MessageCircle size={18} /></span><strong>WhatsApp</strong><small>Mensagens e automações</small><ArrowRight size={14} /></Link>
              </div>
            </section>

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

        <section className="admin-home-link card" data-tour="link">
          <div>
            <span className="admin-home-link-icone"><QrCode size={20} /></span>
            <span><strong>Seu salão também vive fora deste painel.</strong><small>Quando serviços e equipe estiverem prontos, seu link e QR Code viram a porta de entrada das clientes.</small></span>
          </div>
          <Link to="/admin/configurar" className="btn btn-ghost">Preparar meu link <ArrowRight size={15} /></Link>
        </section>
      </div>
    </AdminShell>
  )
}

const PASSOS_TOUR = [
  { alvo:'[data-tour="inicio"]', titulo:'Esse é o centro do seu salão', texto:'Aqui você enxerga o dia, abre sua agenda e continua qualquer configuração que ainda faltar.' },
  { alvo:'[data-tour="primeiros-passos"]', titulo:'A MIMO te mostra o que falta', texto:'Enquanto o salão ainda estiver sendo preparado, esta área te conduz por serviços, equipe, ativação, link e QR.' },
  { alvo:'[data-tour="numeros"]', titulo:'Os números aparecem sem você caçar', texto:'Atendimentos, movimento do mês, pedidos pendentes e fila de espera ficam resumidos aqui.' },
  { alvo:'[data-tour="atalhos"]', titulo:'As ações do dia a dia ficam perto', texto:'Equipe, serviços, encaixes e WhatsApp estão a um toque. Você não precisa decorar menus.' },
  { alvo:'[data-tour="link"]', titulo:'E daqui seu salão vai para a rua', texto:'O link e o QR Code são a porta de entrada das clientes. Quando a configuração estiver pronta, é isso que você compartilha.' },
]

function TutorialPainel() {
  const [convite, setConvite] = useState(() => {
    try { return localStorage.getItem('mimo-tour-painel-concluido') !== '1' && sessionStorage.getItem('mimo-tour-painel-depois') !== '1' }
    catch { return true }
  })
  const [passo, setPasso] = useState(-1)
  const [rect, setRect] = useState(null)

  const ativo = passo >= 0
  const atual = PASSOS_TOUR[passo]

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
    if (passo >= PASSOS_TOUR.length - 1) {
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
          <span className="admin-tour-convite-icone"><PlayCircle size={21} /></span>
          <span><strong>Primeira vez por aqui?</strong><small>A MIMO pode te mostrar o básico deste painel em menos de 1 minuto.</small></span>
          <div><button type="button" className="btn btn-ghost" onClick={depois}>Agora não</button><button type="button" className="btn btn-primary" onClick={iniciar}>Me mostra <ArrowRight size={15} /></button></div>
        </div>
      )}

      {ativo && atual && (
        <div className="admin-tour-overlay">
          {rect && <div className="admin-tour-foco" style={{ top:rect.top - 8, left:rect.left - 8, width:rect.width + 16, height:rect.height + 16 }} />}
          <div className="admin-tour-card">
            <div className="admin-tour-card-topo"><span>{passo + 1} de {PASSOS_TOUR.length}</span><button type="button" onClick={fechar} aria-label="Fechar tutorial"><X size={17} /></button></div>
            <strong>{atual.titulo}</strong>
            <p>{atual.texto}</p>
            <div className="admin-tour-card-acoes">
              <button type="button" className="btn btn-ghost" onClick={fechar}>Sair do tour</button>
              <button type="button" className="btn btn-primary" onClick={proximo}>{passo === PASSOS_TOUR.length - 1 ? 'Pronto' : 'Próximo'} <ChevronRight size={15} /></button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
