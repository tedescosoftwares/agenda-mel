import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X, Clock, StickyNote, CalendarDays } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toISODate, formatDuracao } from '../../lib/format'
import { useMeuSalao, linkWhatsApp } from '../../lib/meuSalao'
import { WhatsIcon } from '../icons'
import Portal from '../Portal'
import '../../pro-equipe.css'

// 3.91: a agenda da profissional da equipe como linha do tempo. A semana no topo (com bolinhas de
// quantos horários tem cada dia), a próxima cliente em destaque, a linha do "agora" e os buracos
// livres entre um atendimento e outro. Só para ver: tocar num horário abre os detalhes, e para mudar
// algo ela fala com o salão (o WhatsApp da casa já vem com o horário escrito). Sem valores em R$.

const ROTULO = { pendente: 'aguardando confirmação', concluido: 'atendida', faltou: 'não veio' }
const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']

const minutos = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0) }
const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const meioDia = (iso) => new Date(iso + 'T12:00:00')
function segundaDe(iso) {
  const d = meioDia(iso)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}
function maisDias(iso, n) { const d = meioDia(iso); d.setDate(d.getDate() + n); return toISODate(d) }
// só a primeira letra maiúscula (o capitalize do CSS fazia "17 De Novembro")
const maiuscula = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const nomeDa = (a) => a.profiles?.full_name || a.guest_name || 'Cliente'
const servicoDe = (a) => a.service_name || a.services?.name || 'Atendimento'
function emQuanto(min) {
  if (min < 1) return 'agora'
  if (min < 60) return `em ${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return `em ${h}h${m ? String(m).padStart(2, '0') : ''}`
}

export default function AgendaLinhaDoTempo({ professionalId }) {
  const [agora, setAgora] = useState(() => new Date())
  const hoje = toISODate(agora)
  const [dia, setDia] = useState(hoje)
  const [estado, setEstado] = useState(null)   // { de, itens } da semana carregada
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState(null)

  const segunda = segundaDe(dia)
  const semana = Array.from({ length: 7 }, (_, i) => { const d = new Date(segunda); d.setDate(segunda.getDate() + i); return toISODate(d) })
  const de = semana[0], ate = semana[6]

  // o relógio da tela: a linha do "agora" e o "em 25 min" andam sozinhos
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 60000); return () => clearInterval(t) }, [])

  const [vez, setVez] = useState(0)   // sobe para buscar de novo (voltou para o app)
  useEffect(() => {
    if (!professionalId) return
    let vivo = true
    supabase
      .from('appointments')
      .select('id, date, start_time, end_time, status, notes, client_id, guest_name, service_name, profiles (full_name), services (name, duration_minutes)')
      .eq('professional_id', professionalId)
      .gte('date', de)
      .lte('date', ate)
      .neq('status', 'cancelado')
      .order('start_time')
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) { setErro('Não deu para carregar a agenda agora. Tente de novo em instantes.'); return }
        setErro('')
        setEstado({ de, itens: (data ?? []).slice().sort((x, y) => (x.date + x.start_time).localeCompare(y.date + y.start_time)) })
      })
    return () => { vivo = false }
  }, [professionalId, de, ate, vez])

  // voltou para o app (do WhatsApp, do bloqueio de tela): relógio e horários em dia
  useEffect(() => {
    const voltou = () => { if (document.visibilityState === 'visible') { setAgora(new Date()); setVez((v) => v + 1) } }
    document.addEventListener('visibilitychange', voltou)
    return () => document.removeEventListener('visibilitychange', voltou)
  }, [])

  // arrastar para o lado troca de dia
  const toque = useRef(null)
  const inicioToque = (e) => { const t = e.touches[0]; toque.current = { x: t.clientX, y: t.clientY } }
  const fimToque = (e) => {
    const t0 = toque.current; toque.current = null
    if (!t0) return
    const t = e.changedTouches[0]
    const dx = t.clientX - t0.x, dy = t.clientY - t0.y
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) setDia((d) => maisDias(d, dx < 0 ? 1 : -1))
  }

  const carregando = !estado || estado.de !== de
  const itens = carregando ? [] : estado.itens
  const porDia = {}
  for (const a of itens) porDia[a.date] = (porDia[a.date] || 0) + 1
  const doDia = itens.filter((a) => a.date === dia)
  const ehHoje = dia === hoje
  const agoraMin = agora.getHours() * 60 + agora.getMinutes()

  // as linhas da linha do tempo: horários, buracos livres e o "agora"
  const linhas = []
  let agoraPosto = !ehHoje
  doDia.forEach((a, i) => {
    const ini = minutos(a.start_time)
    const fim = Math.max(minutos(a.end_time || a.start_time), ini)
    if (!agoraPosto && agoraMin < ini) { linhas.push({ tipo: 'agora', chave: 'agora' }); agoraPosto = true }
    const emCurso = ehHoje && agoraMin >= ini && agoraMin < fim
    if (emCurso) agoraPosto = true
    const passou = dia < hoje || (ehHoje && agoraMin >= fim)
    linhas.push({ tipo: 'horario', chave: a.id, a, ini, fim, emCurso, passou })
    const prox = doDia[i + 1]
    if (!prox) return
    const pIni = minutos(prox.start_time)
    if (pIni - fim < 30) return
    if (!agoraPosto && agoraMin >= fim && agoraMin < pIni) {
      linhas.push({ tipo: 'agora', chave: 'agora' }); agoraPosto = true
      linhas.push({ tipo: 'livre', chave: 'livre' + i, de: agoraMin, ate: pIni, desdeAgora: true })
    } else {
      linhas.push({ tipo: 'livre', chave: 'livre' + i, de: fim, ate: pIni })
    }
  })
  if (!agoraPosto && doDia.length) linhas.push({ tipo: 'agora', chave: 'agora' })

  // o destaque: quem está agora na cadeira, ou a próxima de hoje
  let destaque = null
  if (ehHoje) {
    const atual = linhas.find((l) => l.tipo === 'horario' && l.emCurso && l.a.status !== 'faltou')
    if (atual) destaque = { rotulo: `Agora · até ${hm(atual.fim)}`, l: atual }
    else {
      const prox = linhas.find((l) => l.tipo === 'horario' && l.ini > agoraMin && ['confirmado', 'pendente'].includes(l.a.status))
      if (prox) destaque = { rotulo: `Próxima · ${emQuanto(prox.ini - agoraMin)}`, l: prox }
    }
  }

  const primeiro = doDia[0], ultimo = doDia[doDia.length - 1]
  const mes = maiuscula(meioDia(dia).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }))
  const nomeDoDia = ehHoje ? 'Hoje' : dia === maisDias(hoje, 1) ? 'Amanhã' : dia === maisDias(hoje, -1) ? 'Ontem' : maiuscula(meioDia(dia).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric' }))

  return (
    <section className="lte">
      <div className="lte-semana-topo">
        <button type="button" className="lte-seta" onClick={() => setDia(maisDias(dia, -7))} aria-label="Semana anterior"><ChevronLeft size={18} /></button>
        <span className="lte-mes">{mes}</span>
        {dia !== hoje && <button type="button" className="lte-hoje" onClick={() => setDia(hoje)}>Hoje</button>}
        <button type="button" className="lte-seta" onClick={() => setDia(maisDias(dia, 7))} aria-label="Próxima semana"><ChevronRight size={18} /></button>
      </div>
      <div className="lte-semana" role="tablist" aria-label="Dias da semana">
        {semana.map((iso, i) => {
          const n = porDia[iso] || 0
          return (
            <button key={iso} type="button" role="tab" aria-selected={iso === dia}
              className={['lte-dia', iso === dia ? 'ativo' : '', iso === hoje ? 'hoje' : '', iso < hoje ? 'passado' : ''].filter(Boolean).join(' ')}
              onClick={() => setDia(iso)} aria-label={`${DIAS[i]} ${Number(iso.slice(8))}${n ? `, ${n} ${n === 1 ? 'horário' : 'horários'}` : ''}`}>
              <span className="lte-dia-nome">{DIAS[i]}</span>
              <span className="lte-dia-num">{Number(iso.slice(8))}</span>
              <span className="lte-dia-pontos" aria-hidden="true">
                {Array.from({ length: Math.min(n, 3) }, (_, k) => <i key={k} />)}
                {n > 3 && <b>+</b>}
              </span>
            </button>
          )
        })}
      </div>

      <div className="lte-corpo" onTouchStart={inicioToque} onTouchEnd={fimToque}>
        <div className="lte-resumo">
          <strong>{nomeDoDia}</strong>
          {!carregando && <span>{doDia.length === 0 ? 'nenhuma cliente' : `${doDia.length} ${doDia.length === 1 ? 'cliente' : 'clientes'} · ${primeiro.start_time.slice(0, 5)} às ${(ultimo.end_time || ultimo.start_time).slice(0, 5)}`}</span>}
        </div>

        {erro && <div className="alert alert-error">{erro}</div>}

        {carregando ? (
          <div className="lte-lista">{[0, 1, 2].map((k) => <div key={k} className="lte-esqueleto" />)}</div>
        ) : doDia.length === 0 ? (
          <div className="lte-vazio">
            <span className="lte-vazio-icone"><CalendarDays size={24} /></span>
            <strong>{dia < hoje ? 'Nenhum atendimento neste dia' : 'Dia livre por enquanto'}</strong>
            <span>{dia < hoje ? 'Nada marcado com você.' : 'Quando uma cliente marcar com você, aparece aqui e você recebe um aviso.'}</span>
          </div>
        ) : (
          <>
            {destaque && (
              <button type="button" className={destaque.l.emCurso ? 'lte-destaque agora' : 'lte-destaque'} onClick={() => setAberto(destaque.l.a)}>
                <span className="lte-destaque-rotulo">{destaque.rotulo}</span>
                <span className="lte-destaque-linha">
                  <span className="lte-destaque-hora">{hm(destaque.l.ini)}</span>
                  <span className="lte-destaque-quem">
                    <strong>{nomeDa(destaque.l.a)}</strong>
                    <span>{servicoDe(destaque.l.a)} · {formatDuracao(destaque.l.fim - destaque.l.ini || destaque.l.a.services?.duration_minutes || 0)}</span>
                  </span>
                </span>
                {destaque.l.a.status === 'pendente' && <span className="lte-selo pendente">aguardando confirmação</span>}
              </button>
            )}
            {ehHoje && !destaque && <p className="lte-fim-do-dia">Sem mais clientes por hoje.</p>}

            <ol className="lte-lista">
              {linhas.map((l) => {
                if (l.tipo === 'agora') return <li key={l.chave} className="lte-agora"><span>agora {hm(agoraMin)}</span></li>
                if (l.tipo === 'livre') {
                  return (
                    <li key={l.chave} className="lte-livre">
                      <span className="lte-hora">{l.desdeAgora ? '' : hm(l.de)}</span>
                      <span className="lte-livre-texto">livre até {hm(l.ate)} · {formatDuracao(l.ate - l.de)}</span>
                    </li>
                  )
                }
                const { a } = l
                return (
                  <li key={l.chave} className={['lte-item', `st-${a.status}`, l.passou ? 'passou' : '', l.emCurso ? 'em-curso' : ''].filter(Boolean).join(' ')}>
                    <button type="button" className="lte-item-botao" onClick={() => setAberto(a)}>
                      <span className="lte-hora">{hm(l.ini)}<small>{hm(l.fim)}</small></span>
                      <span className="lte-marca" aria-hidden="true" />
                      <span className="lte-item-texto">
                        <strong>{nomeDa(a)}</strong>
                        <span>{servicoDe(a)} · {formatDuracao(l.fim - l.ini || a.services?.duration_minutes || 0)}</span>
                        {ROTULO[a.status] && <span className={`lte-selo ${a.status}`}>{ROTULO[a.status]}</span>}
                      </span>
                      {a.notes && <StickyNote size={15} className="lte-tem-nota" aria-label="Tem observação" />}
                      <ChevronRight size={16} className="lte-item-seta" />
                    </button>
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </div>

      {aberto && <DetalheDoHorario a={aberto} fechar={() => setAberto(null)} />}
    </section>
  )
}

// a folha com os detalhes de um horário: só para ver; mudar algo é com o salão
function DetalheDoHorario({ a, fechar }) {
  const salao = useMeuSalao()
  const fecharRef = useRef(fechar)
  useEffect(() => { fecharRef.current = fechar })
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape') fecharRef.current() }
    document.addEventListener('keydown', tecla)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', tecla); document.body.style.overflow = antes }
  }, [])

  const ini = minutos(a.start_time), fim = Math.max(minutos(a.end_time || a.start_time), ini)
  const quando = maiuscula(meioDia(a.date).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))
  const curto = meioDia(a.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const whats = linkWhatsApp(salao?.whatsapp, `Oi! Sobre o horário de ${nomeDa(a)}, dia ${curto} às ${hm(ini)} (${servicoDe(a)}): `)

  return (
    <Portal>
    <div className="lte-fundo" onClick={fechar}>
      <div className="lte-folha" role="dialog" aria-modal="true" aria-labelledby="lte-folha-nome" onClick={(e) => e.stopPropagation()}>
        <span className="lte-pegador" aria-hidden="true" />
        <button type="button" className="lte-fechar" onClick={fechar} aria-label="Fechar"><X size={18} /></button>
        <span className={`lte-selo grande ${a.status}`}>{ROTULO[a.status] || 'confirmado'}</span>
        <h3 id="lte-folha-nome">{nomeDa(a)}</h3>
        <p className="lte-folha-servico">{servicoDe(a)}</p>
        <div className="lte-folha-quando">
          <Clock size={17} />
          <span><strong>{hm(ini)} às {hm(fim)}</strong> · {formatDuracao(fim - ini || a.services?.duration_minutes || 0)}<br /><span className="lte-folha-dia">{quando}</span></span>
        </div>
        {a.notes && (
          <div className="lte-folha-nota">
            <StickyNote size={16} />
            <span><b>Observação</b>{a.notes}</span>
          </div>
        )}
        {!a.client_id && <p className="lte-folha-dica">Marcado pelo salão, sem cadastro da cliente na MIMO.</p>}
        <p className="lte-folha-dica">Para remarcar, cancelar ou mudar algo neste horário, fale com o salão.</p>
        {whats && <a className="lte-folha-whats" href={whats} target="_blank" rel="noopener noreferrer"><WhatsIcon width={18} height={18} /> Falar com o salão sobre este horário</a>}
        <button type="button" className="btn btn-ghost btn-block lte-folha-ok" onClick={fechar}>Fechar</button>
      </div>
    </div>
    </Portal>
  )
}
