import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AdminShell from '../../components/AdminShell'
import { MEL_PADRAO } from '../../lib/mel'
import { supabase } from '../../lib/supabase'
import { useCategorias, temCategoria } from '../../lib/categorias'
import { useAuth } from '../../context/AuthContext'
import { mesAtual } from '../../lib/numeros'
import { toISODate } from '../../lib/format'
import { linkDoSalao } from '../../lib/endereco'
import PrimeiroAcessoHome from './PrimeiroAcessoHome'
import HomeDoDia from './HomeDoDia'
import { ArrowRight, X, ChevronRight } from 'lucide-react'

// Dashboard do salão (tela 23): o dia de hoje em quatro números, o
// faturamento do mês dia a dia, o que está esperando resposta, e os
// atalhos para o que se faz todo dia.
export default function AdminDashboard() {
  const { salao, profile } = useAuth()
  const [hoje, setHoje] = useState({ atendimentos: 0, faturamento: 0 })
  const [pendentes, setPendentes] = useState(0)
  const [naFila, setNaFila] = useState(0)
  const [linhas, setLinhas] = useState([])
  const [porDia, setPorDia] = useState([])
  const [pagosMes, setPagosMes] = useState(0)
  const [primeiros, setPrimeiros] = useState(null)
  const [cobertura, setCobertura] = useState(null)   // quem atende o quê, por categoria (2.94)
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
    const [ag, pend, fila, res, mesAg, pp, cb] = await Promise.all([
      supabase.from('appointments').select('price_cents, status').eq('salon_id', salaoId).eq('date', d).neq('status', 'cancelado'),
      supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('salon_id', salaoId).eq('status', 'pendente').gte('date', d),
      supabase.from('waitlist_entries').select('id, professionals!inner(salon_id)', { count: 'exact', head: true }).eq('professionals.salon_id', salaoId).eq('status', 'aguardando'),
      supabase.rpc('resumo_do_salao', { salao: salaoId, mes }),
      supabase.from('appointments').select('date, price_cents').eq('salon_id', salaoId).eq('status', 'concluido').gte('date', mes),
      supabase.rpc('primeiros_passos', { salao: salaoId }),
      supabase.rpc('cobertura_por_categoria', { salao: salaoId }),
    ])
    const lista = ag.data ?? []
    setHoje({ atendimentos: lista.length, faturamento: lista.reduce((s, a) => s + (a.price_cents ?? 0), 0) })
    setPendentes(pend.count ?? 0)
    setNaFila(fila.count ?? 0)
    setLinhas(res.data ?? [])
    const soma = {}
    for (const a of mesAg.data ?? []) soma[a.date] = (soma[a.date] ?? 0) + (a.price_cents ?? 0)
    setPorDia(Object.entries(soma).sort().map(([k, v]) => ({ x: k.slice(8, 10), y: v / 100 })))
    setPagosMes((mesAg.data ?? []).filter((a) => (a.price_cents ?? 0) > 0).length) // 4.43: a média por atendimento sai da mesma leitura do gráfico
    setPrimeiros(pp.data ?? null)
    setCobertura(Array.isArray(cb.data) ? cb.data : [])
    setHomeCarregada(true)
  }, [salaoId])
  useEffect(() => { carregar() }, [carregar])
  const totalMes = linhas.reduce((s, l) => s + Number(l.faturamento_cents ?? 0), 0)
  const atendMes = linhas.reduce((s, l) => s + Number(l.atendimentos ?? 0), 0)
  const ocup = linhas.length ? Math.round(linhas.reduce((s, l) => s + Number(l.ocupacao_bps ?? 0), 0) / linhas.length) : 0

  const nomeSalao = salao?.name ?? 'Meu salão'
  const linkSalao = linkDoSalao(salao)
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
          saudacao={saudacao} nomePessoa={nomePessoa} capaSalao={capaSalao} logoSalao={logoSalao} iniciaisSalao={iniciaisSalao} nomeSalao={nomeSalao}
          feitosConfig={feitosConfig} categoriasProntas={categoriasProntas} servicosProntos={servicosProntos} equipePronta={equipePronta}
          vinculosProntos={vinculosProntos} linkSalao={linkSalao}
        />
      </AdminShell>
    )
  }

  return (
    <AdminShell amplo>
      <TutorialPainel primeiroAcesso={primeiroAcesso} />
      <HomeDoDia
        salao={salao} nomePessoa={nomePessoa} saudacao={saudacao} logoSalao={logoSalao || capaSalao} iniciaisSalao={iniciaisSalao} salaoAtivo={salaoAtivo}
        hoje={hoje} pendentes={pendentes} naFila={naFila} linhas={linhas} porDia={porDia} pagosMes={pagosMes} totalMes={totalMes} atendMes={atendMes} ocup={ocup} primeiros={primeiros}
      />
    </AdminShell>
  )
}

const PASSOS_TOUR_DIA = [
  { alvo:'[data-tour="inicio"]', titulo:'Esse é o centro do seu salão', texto:'No topo ficam o olho, que esconde os valores quando tem cliente por perto, o tema claro ou escuro e a ajuda.' },
  { alvo:'[data-tour="numeros"]', titulo:'O mês, de bate-pronto', texto:'O faturamento do mês em destaque e, embaixo, quantos atendimentos tem hoje, quanto da agenda está ocupada e se tem fila.' },
  { alvo:'[data-tour="atalhos"]', titulo:'As ações do dia a dia', texto:'Novo horário, agenda, equipe, serviços, link e WhatsApp a um toque. O número em cima da Agenda são os pedidos esperando você.' },
  { alvo:'[data-tour="primeiros-passos"]', titulo:'O que pede a sua resposta', texto:'Pedidos para confirmar, baixas do dia, fila e equipe sem acesso aparecem aqui. Sem nada pendente, fica "Tudo em dia".' },
  { alvo:'[data-tour="link"]', titulo:'Sua equipe em um olhar', texto:'O anel em volta de cada profissional mostra quanto da agenda dela está ocupada no mês.' },
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


