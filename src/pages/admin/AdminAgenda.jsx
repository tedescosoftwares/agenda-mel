import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarPlus, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
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
import { isoHoje, somarDias, segundaDe, semanaDe, rotuloLongo, jornadaDoDia, bloqueiosDoDia, min } from '../../components/agenda/agendaComum'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useCategorias, categoriasDoSalao } from '../../lib/categorias'
import '../../agenda.css'

// 4.0: a Agenda do salão, de cara nova.
//   Computador (>= 1024px): Dia = o quadro do dia em modo agenda (uma coluna por profissional, as horas descendo, o
//   tamanho do cartão é a duração, folga e fora do horário sombreados, a linha da hora atual, arrastar para remarcar,
//   clicar no vazio para encaixar; no cartão aberto, concluir, não veio, remarcar, cancelar, WhatsApp). Semana = os 7
//   dias lado a lado, com a cor de cada profissional; clicar num dia abre o Dia. Com uma profissional no filtro, é a
//   semana só dela (fora do horário, folga e almoço sombreados; clicar no horário abre as ações, no vazio encaixa).
//   Celular: a lista por horário, com os livres no meio e as ações numa folha.
//   Em cima de tudo, a faixa dos pedidos que esperam a casa confirmar.
// Os dados do dia são os do PDV (pdv_dia); a jornada de cada uma vem de professional_hours.
const LARGO = 1024
const lerVista = () => { try { return localStorage.getItem('mimo-agenda-vista') === 'semana' ? 'semana' : 'dia' } catch { return 'dia' } }

function useLargo() {
  const [largo, setLargo] = useState(() => typeof window !== 'undefined' && window.innerWidth >= LARGO)
  useEffect(() => { const f = () => setLargo(window.innerWidth >= LARGO); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  return largo
}

export default function AdminAgenda() {
  const { salao } = useAuth()
  const [params, setParams] = useSearchParams()
  const largo = useLargo()
  const [vista, setVista] = useState(lerVista)
  const diaDaUrl = /^\d{4}-\d{2}-\d{2}$/.test(params.get('dia') ?? '') ? params.get('dia') : null
  const [dia, setDia] = useState(() => diaDaUrl ?? isoHoje())
  const [filtro, setFiltro] = useState('')
  const [profs, setProfs] = useState(null)        // null = ainda carregando
  const [horasProf, setHorasProf] = useState([])
  const [blocos, setBlocos] = useState([])        // professional_blocks: almoço e compromissos
  const [horasCasa, setHorasCasa] = useState([])
  const [servicos, setServicos] = useState([])
  const [clientes, setClientes] = useState([])
  const catsTodas = useCategorias()
  const cats = useMemo(() => categoriasDoSalao(catsTodas, salao?.id), [catsTodas, salao?.id])
  const [doDia, setDoDia] = useState(null)        // pdv_dia
  const [contagem, setContagem] = useState([])    // pdv_dias: quantos por dia
  const [daSemana, setDaSemana] = useState(null)  // os horários da semana (vista Semana)
  const [erro, setErro] = useState('')
  const [recarga, setRecarga] = useState(0)
  const [escolhendo, setEscolhendo] = useState(false)
  const [encaixe, setEncaixe] = useState(null)    // { prof, hora, dia? }
  const [abertoSemana, setAbertoSemana] = useState(null)      // o horário aberto na semana dela
  const [remarcandoSemana, setRemarcandoSemana] = useState(null)
  const recarregar = useCallback(() => setRecarga((n) => n + 1), [])

  useEffect(() => { if (diaDaUrl && diaDaUrl !== dia) setDia(diaDaUrl) }, [diaDaUrl]) // eslint-disable-line react-hooks/exhaustive-deps
  function trocarVista(v) { setVista(v); try { localStorage.setItem('mimo-agenda-vista', v) } catch { /* sem armazenamento */ } }
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
    const [d, c] = await Promise.all([
      supabase.rpc('pdv_dia', { salao: salao.id, dia }),
      supabase.rpc('pdv_dias', { salao: salao.id, de: somarDias(seg, -7), ate: somarDias(seg, 20) }),
    ])
    if (d.error) setErro('Não deu para abrir a agenda: ' + d.error.message)
    else { setErro(''); setDoDia(d.data) }
    setContagem(c.data ?? [])
  }, [salao?.id, dia])
  useEffect(() => { carregarDia() }, [carregarDia, recarga])
  useEffect(() => { if (dia !== isoHoje()) return; const t = setInterval(carregarDia, 60000); return () => clearInterval(t) }, [carregarDia, dia])

  // a semana inteira, só na vista Semana do computador
  // com uma profissional no filtro, o computador mostra a semana só dela
  const semanaDela = largo && Boolean(filtro)
  const verSemana = largo && (vista === 'semana' || semanaDela)
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
  const visiveis = filtro ? lista.filter((p) => p.id === filtro) : lista
  const jornada = useMemo(() => jornadaDoDia(horasProf, dia), [horasProf, dia])
  const bloqueios = useMemo(() => bloqueiosDoDia(blocos, dia), [blocos, dia])
  // a semana no formato da pdv_dia (a folha de ações lê cliente, servico, profissional e telefone)
  const itensSemana = useMemo(() => (daSemana ?? []).map((a) => ({
    ...a, cliente: a.profiles?.full_name || a.guest_name || 'Cliente', servico: a.service_name || a.services?.name || '',
    profissional: lista.find((p) => p.id === a.professional_id)?.name ?? '', telefone: a.profiles?.phone || a.guest_phone || null,
    price_cents: a.price_cents ?? (a.services?.price != null ? Math.round(Number(a.services.price) * 100) : null),
  })), [daSemana, lista])
  // a jornada e os bloqueios dela em cada dia da semana
  const sombrasDela = useMemo(() => (filtro ? Object.fromEntries(semanaDe(dia).map((d) => [d, { jornada: jornadaDoDia(horasProf, d)[filtro] ?? null, blocos: bloqueiosDoDia(blocos, d)[filtro] ?? [] }])) : null), [filtro, dia, horasProf, blocos])
  const profDela = filtro ? lista.find((p) => p.id === filtro) ?? null : null
  const agendaDoDia = doDia?.dia === dia ? (doDia?.agenda ?? []) : []
  const faixaCasa = useMemo(() => {
    const abertos = horasCasa.filter((h) => h.open)
    return abertos.length ? [Math.min(...abertos.map((h) => min(h.start_time))), Math.max(...abertos.map((h) => min(h.end_time)))] : [8 * 60, 20 * 60]
  }, [horasCasa])

  // o encaixe: com uma profissional na tela vai direto; com "Todas", pergunta com quem
  function novoEncaixe() {
    if (filtro) { setEncaixe({ prof: filtro, hora: '' }); return }
    if (lista.length === 1) { setEncaixe({ prof: lista[0].id, hora: '' }); return }
    setEscolhendo(true)
  }
  // o "Encaixe" da barra de baixo (e o atalho do Início) chegam aqui como ?encaixe=1
  const pediuPeloLink = Boolean(params.get('encaixe'))
  useEffect(() => {
    if (!pediuPeloLink || profs === null) return
    setParams({}, { replace: true })
    novoEncaixe()
  }, [pediuPeloLink, profs]) // eslint-disable-line react-hooks/exhaustive-deps

  const hoje = isoHoje()
  // o calendário escondido atrás do ícone: no Chrome do computador o clique no campo não abre sozinho
  const abrirCalendario = (e) => { try { e.currentTarget.showPicker?.() } catch { /* o navegador abre do jeito dele */ } }
  const navData = (
    <div className="ags-nav-data">
      <button type="button" className="ags-ic" onClick={() => irPara(somarDias(dia, verSemana ? -7 : -1))} aria-label={verSemana ? 'Semana anterior' : 'Dia anterior'}><ChevronLeft size={18} /></button>
      <button type="button" className={'btn-mini btn-mini-neutro' + (dia === hoje ? ' ags-hoje-on' : '')} onClick={() => irPara(hoje)}>Hoje</button>
      <button type="button" className="ags-ic" onClick={() => irPara(somarDias(dia, verSemana ? 7 : 1))} aria-label={verSemana ? 'Semana seguinte' : 'Dia seguinte'}><ChevronRight size={18} /></button>
      <strong className="ags-data">{verSemana ? (() => { const s = semanaDe(dia); const a = new Date(s[0] + 'T12:00:00'), b = new Date(s[6] + 'T12:00:00'); return `${a.getDate()} a ${b.getDate()} de ${b.toLocaleDateString('pt-BR', { month: 'long' })}` })() : rotuloLongo(dia)}</strong>
      <label className="ags-ic ags-cal" title="Escolher o dia"><CalendarDays size={17} /><input type="date" value={dia} onClick={abrirCalendario} onChange={(e) => e.target.value && irPara(e.target.value)} aria-label="Escolher o dia" /></label>
    </div>
  )

  return (
    <AdminShell amplo>
      <div className="ags-pagina">
        <div className="ags-topo">
          <h1>Agenda</h1>
          {largo && navData}
          <span className="ags-esp" />
          {largo && !semAgenda && !semanaDela && (
            <div className="ags-seg" role="tablist" aria-label="Como ver a agenda">
              <button type="button" role="tab" aria-selected={vista === 'dia'} className={vista === 'dia' ? 'on' : ''} onClick={() => trocarVista('dia')}>Dia</button>
              <button type="button" role="tab" aria-selected={vista === 'semana'} className={vista === 'semana' ? 'on' : ''} onClick={() => trocarVista('semana')}>Semana</button>
            </div>
          )}
          {largo && !semAgenda && lista.length > 1 && (
            <select className="ags-filtro" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Profissional">
              <option value="">Todas as profissionais</option>
              {lista.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {!largo && !semAgenda && <label className="ags-ic ags-cal" title="Escolher o dia"><CalendarDays size={17} /><input type="date" value={dia} onClick={abrirCalendario} onChange={(e) => e.target.value && irPara(e.target.value)} aria-label="Escolher o dia" /></label>}
          {!largo && !semAgenda && dia !== hoje && <button type="button" className="btn-mini btn-mini-neutro" onClick={() => irPara(hoje)}>Hoje</button>}
          {!semAgenda && lista.length > 0 && (
            <button type="button" className="btn btn-primary ags-novo" onClick={novoEncaixe}><CalendarPlus size={17} /> {largo ? 'Novo encaixe' : 'Encaixe'}</button>
          )}
        </div>

        {semAgenda ? <AgendaVazia r={resumo} /> : (
          <>
            <PedidosEsperando salaoId={salao?.id} recarga={recarga} onMudou={recarregar} compacto={!largo} />
            {erro && <div className="alert alert-error">{erro}</div>}
            {profs === null ? <p className="muted">Carregando…</p> : largo ? (
              verSemana ? (
                daSemana === null ? <p className="muted">Carregando a semana…</p>
                  : semanaDela && profDela
                    ? <AgendaSemana dias={semanaDe(dia)} itens={itensSemana.filter((a) => a.professional_id === filtro)} profs={lista} faixa={faixaCasa}
                        uma={profDela} sombras={sombrasDela} onAbrir={setAbertoSemana} onEncaixar={({ dia: d, hora }) => setEncaixe({ prof: filtro, hora, dia: d })}
                        onAbrirDia={(d) => { setFiltro(''); irPara(d); trocarVista('dia') }} />
                    : <AgendaSemana dias={semanaDe(dia)} itens={itensSemana} profs={lista} faixa={faixaCasa} onAbrirDia={(d) => { irPara(d); trocarVista('dia') }} />
              ) : (
                <div className="ags-quadro">
                  <QuadroDoDia modo="agenda" dia={dia} agenda={agendaDoDia.filter((a) => !filtro || a.professional_id === filtro)} semana={contagem} onTrocarDia={irPara}
                    profs={visiveis} todasProfs={lista} horas={horasCasa} jornada={jornada} bloqueios={bloqueios} servicos={servicos} cats={cats} clientes={clientes} salaoId={salao?.id} onMudou={recarregar} />
                </div>
              )
            ) : (
              <AgendaLista dia={dia} agenda={agendaDoDia} profs={lista} filtro={filtro} onFiltro={setFiltro} jornada={jornada} bloqueios={bloqueios} semana={contagem}
                onTrocarDia={irPara} onEncaixar={({ prof, hora }) => setEncaixe({ prof, hora })} onMudou={recarregar} />
            )}
          </>
        )}
      </div>

      {escolhendo && (
        <div className="modal-fundo" onClick={() => setEscolhendo(false)}>
          <div className="modal-caixa encaixe-quem" role="dialog" aria-modal="true" aria-labelledby="encaixe-quem-titulo" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-fechar" onClick={() => setEscolhendo(false)} aria-label="Fechar">×</button>
            <h3 id="encaixe-quem-titulo">Novo encaixe com quem?</h3>
            <p className="muted">Escolha a profissional que vai atender.</p>
            <div className="encaixe-quem-lista">
              {lista.map((p) => (
                <button key={p.id} type="button" className="encaixe-quem-item" onClick={() => { setEscolhendo(false); setEncaixe({ prof: p.id, hora: '' }) }}>
                  <Avatar nome={p.name} />
                  <span>{p.name}</span>
                </button>
              ))}
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
      {abertoSemana && <FolhaDoHorario a={abertoSemana} dia={abertoSemana.date} profs={lista} onFechar={() => setAbertoSemana(null)} onRemarcar={setRemarcandoSemana} onMudou={recarregar} />}
      {remarcandoSemana && <RemarcarHorario appt={remarcandoSemana} dia={remarcandoSemana.date} profs={lista} onFechar={() => setRemarcandoSemana(null)} onPronto={() => { setRemarcandoSemana(null); recarregar() }} />}
    </AdminShell>
  )
}
