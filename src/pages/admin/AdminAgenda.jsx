import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarPlus, ChevronLeft, ChevronRight, CalendarDays, CalendarRange, Columns3, UserRound, CircleHelp } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import AgendaVazia from '../../components/AgendaVazia'
import EncaixeModal from '../../components/EncaixeModal'
import Avatar from '../../components/Avatar'
import QuadroDoDia from '../../components/QuadroDoDia'
import AgendaLista from '../../components/agenda/AgendaLista'
import AgendaSemana from '../../components/agenda/AgendaSemana'
import PedidosEsperando from '../../components/agenda/PedidosEsperando'
import FolhaDoHorario from '../../components/agenda/FolhaDoHorario'
import RemarcarHorario from '../../components/agenda/RemarcarHorario'
import ComoUsarAgenda from '../../components/agenda/ComoUsarAgenda'
import { ResumoAgenda, LegendaAgenda } from '../../components/agenda/PecasAgenda'
import { isoHoje, somarDias, segundaDe, semanaDe, rotuloLongo, jornadaDoDia, bloqueiosDoDia, min, corDa, primeiroNome, iniciais } from '../../components/agenda/agendaComum'
import { remarcarHorario, pedeAviso } from '../../lib/acoesDoHorario'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useDialogo } from '../../context/DialogoContext'
import { useCategorias, categoriasDoSalao } from '../../lib/categorias'
import '../../agenda.css'

// 4.0: a Agenda do salão, de cara nova. 4.1: três abas no computador, e a Semana é a primeira.
//   Semana = os 7 dias lado a lado, a cor de cada profissional; clicar no horário abre as informações e as ações,
//   arrastar para outro dia ou hora remarca, clicar no vazio encaixa, clicar no dia abre o Dia.
//   Dia = o quadro do dia em modo agenda (uma coluna por profissional, folga, almoço e fora do horário sombreados,
//   arrastar para outra hora, outra profissional ou um dia da faixa de cima, clicar no vazio para encaixar).
//   Profissional = a semana de uma só, com o fora do horário, a folga e o almoço dela.
//   Celular: a lista por horário, com os livres no meio e as ações numa folha.
//   Em cima: o resumo do período e os pedidos que esperam a casa. Embaixo: a legenda. O "Como usar" ensina (abre
//   sozinho na primeira visita).
// Os dados do dia são os do PDV (pdv_dia); a semana vem de appointments; a jornada de professional_hours e o almoço
// de professional_blocks.
const LARGO = 1024
const VISTAS = ['semana', 'dia', 'prof']
const lerVista = () => { try { const v = localStorage.getItem('mimo-agenda-vista2'); return VISTAS.includes(v) ? v : 'semana' } catch { return 'semana' } }
const lerProf = () => { try { return localStorage.getItem('mimo-agenda-prof') || '' } catch { return '' } }
const CHAVE_TOUR = 'mimo-agenda-como-usar-v1'
const DIAS_LONGOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

function useLargo() {
  const [largo, setLargo] = useState(() => typeof window !== 'undefined' && window.innerWidth >= LARGO)
  useEffect(() => { const f = () => setLargo(window.innerWidth >= LARGO); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  return largo
}

const PASSOS_PC = [
  { alvo: '.ags-abas', titulo: 'Três jeitos de ver a agenda', texto: 'Semana mostra a casa toda, os 7 dias. Dia mostra uma coluna por profissional. Profissional mostra a semana de uma só, com o almoço e a folga dela.' },
  { alvo: '.ags-semana-item.movel, .ags-semana-item', titulo: 'Clique num horário para ver tudo', texto: 'Abre os dados da cliente, o histórico dela na casa e as ações: concluir, não veio, remarcar, mandar WhatsApp e cancelar.' },
  { alvo: '.ags-semana-item.movel', titulo: 'Arraste para remarcar', texto: 'Segure o cartão e solte em outro dia ou outra hora. A gente pergunta antes de mover, e você escolhe se a cliente e a profissional são avisadas.' },
  { alvo: '.ags-semana-col.encaixa', titulo: 'Clique no vazio para encaixar', texto: 'Passe o mouse num espaço livre e aparece a hora. Clicando, você escolhe a profissional e marca ali, para quem ligou ou chegou na porta.' },
  { alvo: '.ags-pedidos', titulo: 'Pedidos esperando você', texto: 'Quem marcou pelo app ou pelo WhatsApp e espera o salão confirmar. Confirme ou recuse por aqui: ela é avisada na hora.' },
  { alvo: '.ags-legenda', titulo: 'O que cada cartão quer dizer', texto: 'Cada profissional tem uma cor. Tracejado é a confirmar, apagado é concluído, riscado é não veio, e o listrado é almoço, folga ou salão fechado.' },
  { alvo: '.ags-ajuda', titulo: 'Quando quiser rever', texto: 'Este botão mostra este passo a passo de novo.' },
]
const PASSOS_CEL = [
  { alvo: '.ags-dias', titulo: 'Escolha o dia', texto: 'Toque num dia para ver a agenda dele. O número em cima é quantos horários ele tem.' },
  { alvo: '.ags-fichas', titulo: 'Uma profissional por vez', texto: 'Toque no nome para ver só a agenda dela, com o almoço.' },
  { alvo: '.ags-li-toque', titulo: 'Toque num horário', texto: 'Abre as ações: concluir, não veio, remarcar, mandar WhatsApp e cancelar.' },
  { alvo: '.ags-li.livre', titulo: 'Os horários livres', texto: 'Os buracos da agenda aparecem no meio da lista. Toque em Encaixar para marcar alguém ali.' },
  { alvo: '.ags-pedidos', titulo: 'Pedidos esperando você', texto: 'Quem marcou pelo app ou pelo WhatsApp e espera o salão confirmar. Confirme ou recuse por aqui.' },
  { alvo: '.ags-ajuda', titulo: 'Quando quiser rever', texto: 'Este botão mostra este passo a passo de novo.' },
]

export default function AdminAgenda() {
  const { salao } = useAuth()
  const { confirmar } = useDialogo()
  const [params, setParams] = useSearchParams()
  const largo = useLargo()
  const [vista, setVista] = useState(lerVista)
  const diaDaUrl = /^\d{4}-\d{2}-\d{2}$/.test(params.get('dia') ?? '') ? params.get('dia') : null
  const [dia, setDia] = useState(() => diaDaUrl ?? isoHoje())
  const [filtro, setFiltro] = useState('')        // celular: as fichas de profissional
  const [profSel, setProfSel] = useState(lerProf) // computador: a aba Profissional
  const [profs, setProfs] = useState(null)        // null = ainda carregando
  const [horasProf, setHorasProf] = useState([])
  const [blocos, setBlocos] = useState([])        // professional_blocks: almoço e compromissos
  const [horasCasa, setHorasCasa] = useState([])
  const [servicos, setServicos] = useState([])
  const [clientes, setClientes] = useState([])
  const catsTodas = useCategorias()
  const cats = useMemo(() => categoriasDoSalao(catsTodas, salao?.id), [catsTodas, salao?.id])
  const [doDia, setDoDia] = useState(null)        // pdv_dia
  const [cortesias, setCortesias] = useState(() => new Set()) // 4.43: os R$ 0 de propósito
  const [contagem, setContagem] = useState([])    // pdv_dias: quantos por dia
  const [daSemana, setDaSemana] = useState(null)  // os horários da semana (Semana e Profissional)
  const [erro, setErro] = useState('')
  const [recarga, setRecarga] = useState(0)
  const [escolhendo, setEscolhendo] = useState(null) // { dia?, hora? }: encaixe com quem?
  const [encaixe, setEncaixe] = useState(null)    // { prof, hora, dia? }
  const [abertoSemana, setAbertoSemana] = useState(null)      // o horário aberto (Semana e Profissional)
  const [remarcandoSemana, setRemarcandoSemana] = useState(null)
  const [tour, setTour] = useState(false)
  const recarregar = useCallback(() => setRecarga((n) => n + 1), [])

  useEffect(() => { if (diaDaUrl && diaDaUrl !== dia) setDia(diaDaUrl) }, [diaDaUrl]) // eslint-disable-line react-hooks/exhaustive-deps
  // 4.55: ?prof=<id> abre a Agenda já nela (a Equipe manda para cá quando é para remarcar os horários de quem está saindo)
  const profDaUrl = params.get('prof')
  useEffect(() => { if (!profDaUrl) return; setFiltro(profDaUrl); setProfSel(profDaUrl); setVista('prof') }, [profDaUrl])
  function trocarVista(v) { setVista(v); try { localStorage.setItem('mimo-agenda-vista2', v) } catch { /* sem armazenamento */ } }
  function escolherProf(id) { setProfSel(id); try { localStorage.setItem('mimo-agenda-prof', id) } catch { /* sem armazenamento */ } }
  function irPara(d) { setDia(d); if (diaDaUrl) setParams({}, { replace: true }) }

  // sem serviço ou sem profissional não há o que marcar: mostra o caminho
  const [resumo, setResumo] = useState(undefined)
  useEffect(() => {
    if (!salao?.id) return
    supabase.rpc('primeiros_passos', { salao: salao.id }).then(({ data }) => setResumo(data ?? null))
  }, [salao?.id])
  const semAgenda = resumo && (Number(resumo.servicos ?? 0) === 0 || (resumo.tipo !== 'autonoma' && Number(resumo.equipe ?? 0) === 0))

  // o que muda pouco: a equipe, a jornada, o horário da casa, os serviços e as clientes
  useEffect(() => {
    if (!salao?.id) return
    let vivo = true
    ;(async () => {
      const [p, bh, sv, cl] = await Promise.all([
        supabase.from('professionals').select('id, name, photo_url, active').eq('salon_id', salao.id).eq('active', true).order('name'),
        supabase.from('business_hours').select('weekday, open, start_time, end_time').eq('salon_id', salao.id),
        supabase.from('services').select('id, name, price, duration_minutes, categoria_id, active').eq('salon_id', salao.id).eq('active', true).order('name'),
        supabase.rpc('clientes_do_salao', { salao: salao.id }),
      ])
      if (!vivo) return
      const lista = p.data ?? []
      setProfs(lista); setHorasCasa(bh.data ?? []); setServicos(sv.data ?? []); setClientes(cl.data ?? [])
      if (lista.length) {
        const ids = lista.map((x) => x.id)
        const [hp, bl] = await Promise.all([
          supabase.from('professional_hours').select('professional_id, weekday, open, start_time, end_time').in('professional_id', ids),
          supabase.from('professional_blocks').select('professional_id, kind, weekday, date, all_day, start_time, end_time, reason').in('professional_id', ids),
        ])
        if (vivo) { setHorasProf(hp.data ?? []); setBlocos(bl.data ?? []) }
      }
    })()
    return () => { vivo = false }
  }, [salao?.id])

  // o dia (e a contagem da semana em volta); hoje, confere de novo a cada minuto
  const carregarDia = useCallback(async () => {
    if (!salao?.id) return
    const seg = segundaDe(dia)
    const [d, c, cort] = await Promise.all([
      supabase.rpc('pdv_dia', { salao: salao.id, dia }),
      supabase.rpc('pdv_dias', { salao: salao.id, de: somarDias(seg, -7), ate: somarDias(seg, 20) }),
      // 4.43 (migração 275): as cortesias da semana (R$ 0 de propósito não é "sem valor"); num banco sem a 275, nenhuma
      supabase.from('appointments').select('id').eq('salon_id', salao.id).gte('date', seg).lte('date', somarDias(seg, 6)).eq('cortesia', true),
    ])
    const cortesias = new Set((cort.error ? [] : cort.data ?? []).map((x) => x.id))
    setCortesias(cortesias)
    if (d.error) setErro('Não deu para abrir a agenda: ' + d.error.message)
    else { setErro(''); setDoDia(cortesias.size ? { ...d.data, agenda: (d.data?.agenda ?? []).map((a) => (cortesias.has(a.id) ? { ...a, cortesia: true } : a)) } : d.data) }
    setContagem(c.data ?? [])
  }, [salao?.id, dia])
  useEffect(() => { carregarDia() }, [carregarDia, recarga])
  useEffect(() => { if (dia !== isoHoje()) return; const t = setInterval(carregarDia, 60000); return () => clearInterval(t) }, [carregarDia, dia])

  // a semana inteira: abas Semana e Profissional do computador
  const verSemana = largo && vista !== 'dia'
  useEffect(() => {
    if (!verSemana || !salao?.id) return
    let vivo = true
    const dias = semanaDe(dia)
    supabase.from('appointments')
      .select('id, date, start_time, end_time, status, professional_id, client_id, guest_name, guest_phone, remarca_de, service_name, price_cents, profiles (full_name, phone), services (name, price)')
      .eq('salon_id', salao.id).gte('date', dias[0]).lte('date', dias[6]).neq('status', 'cancelado')
      .order('date').order('start_time')
      .then(({ data, error }) => { if (!vivo) return; if (error) setErro(error.message); setDaSemana((data ?? []).filter((a) => a.date >= dias[0] && a.date <= dias[6] && a.status !== 'cancelado')) })
    return () => { vivo = false }
  }, [verSemana, salao?.id, dia, recarga])

  const lista = useMemo(() => profs ?? [], [profs])
  const jornada = useMemo(() => jornadaDoDia(horasProf, dia), [horasProf, dia])
  const bloqueios = useMemo(() => bloqueiosDoDia(blocos, dia), [blocos, dia])
  const diasDaSemana = useMemo(() => semanaDe(dia), [dia])
  // a semana no formato da pdv_dia (a folha lê cliente, servico, profissional e telefone)
  const itensSemana = useMemo(() => (daSemana ?? []).map((a) => ({
    ...a, cortesia: cortesias.has(a.id), cliente: a.profiles?.full_name || a.guest_name || 'Cliente', servico: a.service_name || a.services?.name || '',
    profissional: lista.find((p) => p.id === a.professional_id)?.name ?? '', telefone: a.profiles?.phone || a.guest_phone || null,
    price_cents: a.price_cents ?? (a.services?.price != null ? Math.round(Number(a.services.price) * 100) : null),
  })), [daSemana, lista, cortesias])
  // a aba Profissional: a escolhida (ou a primeira), a jornada e os bloqueios dela em cada dia
  const profDela = vista === 'prof' ? (lista.find((p) => p.id === profSel) ?? lista[0] ?? null) : null
  const sombrasDela = useMemo(() => (profDela ? Object.fromEntries(diasDaSemana.map((d) => [d, { jornada: jornadaDoDia(horasProf, d)[profDela.id] ?? null, blocos: bloqueiosDoDia(blocos, d)[profDela.id] ?? [] }])) : null), [profDela, diasDaSemana, horasProf, blocos])
  // a Semana da casa: o salão fechado sombreado (business_hours de cada dia)
  const sombrasCasa = useMemo(() => Object.fromEntries(diasDaSemana.map((d) => { const wd = new Date(d + 'T12:00:00').getDay(); const h = horasCasa.find((x) => x.weekday === wd); return [d, { jornada: h ? { open: Boolean(h.open), start: String(h.start_time).slice(0, 5), end: String(h.end_time).slice(0, 5) } : null, blocos: [] }] })), [diasDaSemana, horasCasa])
  const agendaDoDia = doDia?.dia === dia ? (doDia?.agenda ?? []) : []
  const faixaCasa = useMemo(() => {
    const abertos = horasCasa.filter((h) => h.open)
    return abertos.length ? [Math.min(...abertos.map((h) => min(h.start_time))), Math.max(...abertos.map((h) => min(h.end_time)))] : [8 * 60, 20 * 60]
  }, [horasCasa])

  // o encaixe: com uma profissional (a aba Profissional, ou a equipe de uma pessoa) vai direto; senão, pergunta com quem
  function encaixar({ dia: d, hora } = {}) {
    if (profDela) { setEncaixe({ prof: profDela.id, hora: hora ?? '', dia: d }); return }
    if (lista.length === 1) { setEncaixe({ prof: lista[0].id, hora: hora ?? '', dia: d }); return }
    setEscolhendo({ dia: d, hora })
  }
  const novoEncaixe = () => (!largo && filtro ? setEncaixe({ prof: filtro, hora: '' }) : encaixar())
  // o "Encaixe" da barra de baixo (e o atalho do Início) chegam aqui como ?encaixe=1
  const pediuPeloLink = Boolean(params.get('encaixe'))
  useEffect(() => {
    if (!pediuPeloLink || profs === null) return
    setParams({}, { replace: true })
    novoEncaixe()
  }, [pediuPeloLink, profs]) // eslint-disable-line react-hooks/exhaustive-deps

  // arrastar na semana: pergunta e move (a mesma profissional; o antigo é cancelado e ela é avisada do novo)
  async function moverNaSemana(a, { dia: d, hora }) {
    const ok = await confirmar({ titulo: `Mover ${a.cliente} para ${rotuloLongo(d).toLowerCase()}, às ${hora}?`, texto: `Continua com ${primeiroNome(a.profissional)}. O horário antigo é cancelado e o novo entra no lugar.`, ok: 'Mover', cancelar: 'Deixar como está', opcao: pedeAviso })
    if (!ok) return
    const r = await remarcarHorario(a, { dia: d, hora, prof: a.professional_id, avisar: ok.marcada })
    if (!r.ok) { if (r.erro) setErro(r.erro); return }
    setErro(''); recarregar()
  }

  // o passo a passo: abre sozinho na primeira visita, quando a tela já tem o que mostrar
  const pronto = profs !== null && !semAgenda && resumo !== undefined && (largo ? (vista !== 'dia' ? daSemana !== null : doDia !== null) : doDia !== null)
  useEffect(() => {
    if (!pronto) return
    let visto = true
    try { visto = Boolean(localStorage.getItem(CHAVE_TOUR)) } catch { visto = true }
    if (visto) return
    const t = setTimeout(() => { if (largo && vista !== 'semana') trocarVista('semana'); setTour(true) }, 700)
    return () => clearTimeout(t)
  }, [pronto]) // eslint-disable-line react-hooks/exhaustive-deps
  function abrirTour() { if (largo && vista !== 'semana') trocarVista('semana'); setTimeout(() => setTour(true), 250) }
  function fecharTour() { setTour(false); try { localStorage.setItem(CHAVE_TOUR, '1') } catch { /* sem armazenamento */ } }

  // o resumo do período (a linha de números em cima)
  const doPeriodo = !largo || vista === 'dia' ? agendaDoDia : vista === 'prof' && profDela ? itensSemana.filter((a) => a.professional_id === profDela.id) : itensSemana
  const extraResumo = (() => {
    if (!largo || vista === 'dia') {
      if (dia !== isoHoje()) return null
      const agoraMin = new Date().getHours() * 60 + new Date().getMinutes()
      const prox = agendaDoDia.filter((a) => (a.status === 'confirmado' || a.status === 'pendente') && min(a.start_time) > agoraMin).sort((x, y) => min(x.start_time) - min(y.start_time))[0]
      return prox ? `Próximo: ${prox.start_time.slice(0, 5)}, ${prox.cliente} com ${primeiroNome(prox.profissional)}` : null
    }
    if (vista === 'prof' && profDela) {
      const folgas = [0, 1, 2, 3, 4, 5, 6].filter((wd) => horasProf.some((h) => h.professional_id === profDela.id && h.weekday === wd && !h.open)).map((wd) => DIAS_LONGOS[wd])
      const almoco = blocos.find((b) => b.professional_id === profDela.id && b.kind === 'semanal' && !b.all_day)
      return [almoco ? `${(almoco.reason || 'Pausa').toLowerCase()} ${String(almoco.start_time).slice(0, 5)}–${String(almoco.end_time).slice(0, 5)}` : '', folgas.length ? `folga: ${folgas.join(', ')}` : ''].filter(Boolean).join(' · ') || null
    }
    const n = Object.fromEntries(diasDaSemana.map((d) => [d, itensSemana.filter((a) => a.date === d).length]))
    const cheio = diasDaSemana.reduce((m, d) => (n[d] > (n[m] ?? -1) ? d : m), diasDaSemana[0])
    return n[cheio] ? `Dia mais cheio: ${DIAS_LONGOS[new Date(cheio + 'T12:00:00').getDay()]} (${n[cheio]})` : null
  })()
  const rotuloSemana = (() => { const a = new Date(diasDaSemana[0] + 'T12:00:00'), b = new Date(diasDaSemana[6] + 'T12:00:00'); return a.getMonth() === b.getMonth() ? `${a.getDate()} a ${b.getDate()} de ${b.toLocaleDateString('pt-BR', { month: 'long' })}` : `${a.getDate()} de ${a.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')} a ${b.getDate()} de ${b.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}` })()
  const tituloResumo = !largo || vista === 'dia' ? (dia === isoHoje() ? 'Hoje' : rotuloLongo(dia)) : vista === 'prof' && profDela ? `Semana de ${primeiroNome(profDela.name)}` : 'Esta semana'

  const hoje = isoHoje()
  // o calendário escondido atrás do ícone: no Chrome do computador o clique no campo não abre sozinho
  const abrirCalendario = (e) => { try { e.currentTarget.showPicker?.() } catch { /* o navegador abre do jeito dele */ } }
  const navData = (
    <div className="ags-nav-data">
      <button type="button" className="ags-ic" onClick={() => irPara(somarDias(dia, verSemana ? -7 : -1))} aria-label={verSemana ? 'Semana anterior' : 'Dia anterior'}><ChevronLeft size={18} /></button>
      <button type="button" className={'btn-mini btn-mini-neutro' + ((verSemana ? diasDaSemana.includes(hoje) : dia === hoje) ? ' ags-hoje-on' : '')} onClick={() => irPara(hoje)}>Hoje</button>
      <button type="button" className="ags-ic" onClick={() => irPara(somarDias(dia, verSemana ? 7 : 1))} aria-label={verSemana ? 'Semana seguinte' : 'Dia seguinte'}><ChevronRight size={18} /></button>
      <strong className="ags-data">{verSemana ? rotuloSemana : rotuloLongo(dia)}</strong>
      <label className="ags-ic ags-cal" title="Escolher o dia"><CalendarDays size={17} /><input type="date" value={dia} onClick={abrirCalendario} onChange={(e) => e.target.value && irPara(e.target.value)} aria-label="Escolher o dia" /></label>
    </div>
  )
  const quantasDela = (id) => itensSemana.filter((a) => a.professional_id === id).length

  return (
    <AdminShell amplo>
      <div className="ags-pagina">
        <div className="ags-topo">
          <h1>Agenda</h1>
          {largo && !semAgenda && (
            <div className="ags-abas" role="tablist" aria-label="Como ver a agenda">
              <button type="button" role="tab" aria-selected={vista === 'semana'} className={vista === 'semana' ? 'on' : ''} onClick={() => trocarVista('semana')}><CalendarRange size={16} /> Semana</button>
              <button type="button" role="tab" aria-selected={vista === 'dia'} className={vista === 'dia' ? 'on' : ''} onClick={() => trocarVista('dia')}><Columns3 size={16} /> Dia</button>
              <button type="button" role="tab" aria-selected={vista === 'prof'} className={vista === 'prof' ? 'on' : ''} onClick={() => trocarVista('prof')}><UserRound size={16} /> Profissional</button>
            </div>
          )}
          <span className="ags-esp" />
          {!semAgenda && <button type="button" className="ags-ajuda" onClick={abrirTour} aria-label="Como usar a agenda"><CircleHelp size={17} />{largo && <span>Como usar</span>}</button>}
          {!largo && !semAgenda && <label className="ags-ic ags-cal" title="Escolher o dia"><CalendarDays size={17} /><input type="date" value={dia} onClick={abrirCalendario} onChange={(e) => e.target.value && irPara(e.target.value)} aria-label="Escolher o dia" /></label>}
          {!largo && !semAgenda && dia !== hoje && <button type="button" className="btn-mini btn-mini-neutro" onClick={() => irPara(hoje)}>Hoje</button>}
          {!semAgenda && lista.length > 0 && (
            <button type="button" className="btn btn-primary ags-novo" onClick={novoEncaixe}><CalendarPlus size={17} /> {largo ? 'Novo encaixe' : 'Encaixe'}</button>
          )}
        </div>

        {largo && !semAgenda && (
          <div className="ags-barra">
            {navData}
            {vista === 'prof' && lista.length > 0 && (
              <div className="ags-quem" role="tablist" aria-label="Profissional">
                {lista.map((p) => { const c = corDa(lista, p.id); const on = profDela?.id === p.id; const n = quantasDela(p.id); return (
                  <button key={p.id} type="button" role="tab" aria-selected={on} className={'ags-quem-item' + (on ? ' on' : '')} style={{ '--c': c.cor, '--v': c.veu }} onClick={() => escolherProf(p.id)}>
                    <i>{iniciais(p.name)}</i><span>{primeiroNome(p.name)}</span>{daSemana !== null && <small>{n}</small>}
                  </button>
                ) })}
              </div>
            )}
            {vista !== 'prof' && <span className="ags-barra-dica muted">{vista === 'semana' ? 'A casa toda, os 7 dias. Clique no dia para ver uma coluna por profissional.' : 'Uma coluna por profissional. Para a semana de uma só, use a aba Profissional.'}</span>}
          </div>
        )}

        {semAgenda ? <AgendaVazia r={resumo} /> : (
          <>
            {profs !== null && (largo ? (vista === 'dia' ? doDia !== null : daSemana !== null) : doDia !== null) && <ResumoAgenda itens={doPeriodo} titulo={tituloResumo} extra={extraResumo} />}
            <PedidosEsperando salaoId={salao?.id} recarga={recarga} onMudou={recarregar} compacto={!largo} />
            {erro && <div className="alert alert-error">{erro}</div>}
            {profs === null ? <p className="muted">Carregando…</p> : largo ? (
              verSemana ? (
                daSemana === null ? <p className="muted">Carregando a semana…</p>
                  : vista === 'prof' && profDela
                    ? <AgendaSemana dias={diasDaSemana} itens={itensSemana.filter((a) => a.professional_id === profDela.id)} profs={lista} faixa={faixaCasa}
                        uma={profDela} sombras={sombrasDela} onAbrir={setAbertoSemana} onEncaixar={encaixar} onMover={moverNaSemana}
                        onAbrirDia={(d) => { irPara(d); trocarVista('dia') }} />
                    : <AgendaSemana dias={diasDaSemana} itens={itensSemana} profs={lista} faixa={faixaCasa} sombras={sombrasCasa}
                        onAbrir={setAbertoSemana} onEncaixar={encaixar} onMover={moverNaSemana} onAbrirDia={(d) => { irPara(d); trocarVista('dia') }} />
              ) : (
                <>
                  <div className="ags-quadro">
                    <QuadroDoDia modo="agenda" dia={dia} agenda={agendaDoDia} semana={contagem} onTrocarDia={irPara}
                      profs={lista} todasProfs={lista} horas={horasCasa} jornada={jornada} bloqueios={bloqueios} servicos={servicos} cats={cats} clientes={clientes} salaoId={salao?.id} onMudou={recarregar} />
                  </div>
                  <LegendaAgenda profs={lista} dicas="dia" />
                </>
              )
            ) : (
              <AgendaLista dia={dia} agenda={agendaDoDia} profs={lista} filtro={filtro} onFiltro={setFiltro} jornada={jornada} bloqueios={bloqueios} semana={contagem}
                onTrocarDia={irPara} onEncaixar={({ prof, hora, livres }) => (prof ? setEncaixe({ prof, hora }) : setEscolhendo({ hora, so: livres }))} onMudou={recarregar} />
            )}
          </>
        )}
      </div>

      {escolhendo && (
        <div className="modal-fundo" onClick={() => setEscolhendo(null)}>
          <div className="modal-caixa encaixe-quem" role="dialog" aria-modal="true" aria-labelledby="encaixe-quem-titulo" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-fechar" onClick={() => setEscolhendo(null)} aria-label="Fechar">×</button>
            <h3 id="encaixe-quem-titulo">{escolhendo.dia ? `Encaixe ${escolhendo.dia === hoje ? 'hoje' : `na ${DIAS_LONGOS[new Date(escolhendo.dia + 'T12:00:00').getDay()]}, ${new Date(escolhendo.dia + 'T12:00:00').getDate()}`}${escolhendo.hora ? ` às ${escolhendo.hora}` : ''}: com quem?` : escolhendo.hora ? `Encaixe às ${escolhendo.hora}: com quem?` : 'Novo encaixe com quem?'}</h3>
            {lista.length === 0
              ? <><p className="muted">Ainda não há profissional na equipe. Cadastre a primeira (pode ser você) para encaixar um horário.</p><Link className="btn btn-primary btn-block" to="/admin/equipe">Cadastrar profissional</Link></>
              : <p className="muted">Escolha a profissional que vai atender.</p>}
            <div className="encaixe-quem-lista">
              {/* 4.35: vindo de um horário livre da lista, só quem está livre naquela hora */}
              {lista.filter((p) => !escolhendo.so || escolhendo.so.includes(p.id)).map((p) => {
                const d = escolhendo.dia ?? dia; const j = jornadaDoDia(horasProf, d)[p.id]; const t = escolhendo.hora ? min(escolhendo.hora) : null
                const fora = j && (!j.open || (t != null && (t < min(j.start) || t >= min(j.end))))
                return (
                  <button key={p.id} type="button" className="encaixe-quem-item" onClick={() => { setEscolhendo(null); setEncaixe({ prof: p.id, hora: escolhendo.hora ?? '', dia: escolhendo.dia }) }}>
                    <Avatar nome={p.name} />
                    <span className="ags-quem-nome">{p.name}{fora && <small className="muted">{j.open ? 'fora do horário dela nesse dia' : 'folga nesse dia'}</small>}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {encaixe && (
        <EncaixeModal
          professionalId={encaixe.prof}
          data={encaixe.dia ?? dia}
          horaInicial={encaixe.hora}
          onFechar={() => setEncaixe(null)}
          onPronto={() => { setEncaixe(null); recarregar() }}
        />
      )}
      {abertoSemana && <FolhaDoHorario a={abertoSemana} dia={abertoSemana.date} profs={lista} completo salaoId={salao?.id} onFechar={() => setAbertoSemana(null)} onRemarcar={setRemarcandoSemana} onMudou={recarregar} />}
      {remarcandoSemana && <RemarcarHorario appt={remarcandoSemana} dia={remarcandoSemana.date} profs={lista} onFechar={() => setRemarcandoSemana(null)} onPronto={() => { setRemarcandoSemana(null); recarregar() }} />}
      {tour && <ComoUsarAgenda passos={largo ? PASSOS_PC : PASSOS_CEL} onFechar={fecharTour} />}
    </AdminShell>
  )
}

