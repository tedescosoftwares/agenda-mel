import { useEffect, useMemo, useState } from 'react'
import { Check, Hourglass, UserX } from 'lucide-react'
import { isoHoje, DIAS_CURTOS, min, hhmm, corDa, primeiroNome } from './agendaComum'
import { LegendaAgenda } from './PecasAgenda'

// 4.0: a Agenda da semana, no computador: os 7 dias lado a lado, as horas descendo, cada horário com a cor da
// profissional (horários ao mesmo tempo dividem a largura).
// 4.1: é a vista padrão. Clicar num horário abre as informações dele (onAbrir); arrastar o cartão para outro dia ou
// hora remarca (onMover, a página confirma); clicar no vazio encaixa naquele dia e hora (onEncaixar); clicar no dia,
// em cima, abre o Dia (uma coluna por profissional). `sombras` sombreia o que não é horário: com a equipe toda, o
// salão fechado; com uma profissional só (`uma`, a aba Profissional), o fora do horário, a folga e o almoço dela.
const nomeDe = (a) => a.cliente || a.profiles?.full_name || a.guest_name || 'Cliente'
const servicoDe = (a) => a.servico || a.service_name || a.services?.name || ''
const movel = (a) => a.status === 'pendente' || a.status === 'confirmado'

// faixas lado a lado para quem se sobrepõe no mesmo dia
function emFaixas(lista) {
  const ord = [...lista].sort((a, b) => min(a.start_time) - min(b.start_time) || min(b.end_time) - min(a.end_time))
  const out = []
  let grupo = [], fimGrupo = -1
  const fechar = () => { const n = Math.max(1, ...grupo.map((g) => g.faixa + 1)); grupo.forEach((g) => out.push({ ...g, de: n })); grupo = [] }
  for (const a of ord) {
    const s = min(a.start_time), e = min(a.end_time)
    if (grupo.length && s >= fimGrupo) { fechar(); fimGrupo = -1 }
    const usadas = new Set(grupo.filter((g) => min(g.a.end_time) > s).map((g) => g.faixa))
    let f = 0; while (usadas.has(f)) f++
    grupo.push({ a, faixa: f })
    fimGrupo = Math.max(fimGrupo, e)
  }
  if (grupo.length) fechar()
  return out
}

export default function AgendaSemana({ dias, itens, profs, faixa = [8 * 60, 20 * 60], onAbrirDia, uma = null, sombras = null, onAbrir, onEncaixar, onMover }) {
  const hoje = isoHoje()
  const PX_HORA = uma ? 64 : 60
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 60000); return () => clearInterval(t) }, [])
  const agoraMin = agora.getHours() * 60 + agora.getMinutes()
  const [fantasma, setFantasma] = useState(null)     // { dia, ini } com o mouse no vazio
  const [arrastando, setArrastando] = useState(null) // o horário no ar
  const [sombra, setSombra] = useState(null)         // { dia, ini } onde ele vai cair

  const [ini, fim] = useMemo(() => {
    const todos = itens ?? []
    const jornadas = sombras ? Object.values(sombras).map((s) => s.jornada).filter((j) => j?.open) : []
    const a = Math.min(faixa[0], ...todos.map((x) => min(x.start_time)), ...jornadas.map((j) => min(j.start)))
    const b = Math.max(faixa[1], ...todos.map((x) => min(x.end_time)), ...jornadas.map((j) => min(j.end)))
    return [Math.floor(a / 60) * 60, Math.ceil(b / 60) * 60]
  }, [itens, faixa, sombras])
  const px = (m) => ((m - ini) / 60) * PX_HORA
  const altura = px(fim)
  const horas = []; for (let m = ini; m < fim; m += 60) horas.push(m)
  const porDia = useMemo(() => Object.fromEntries(dias.map((d) => [d, emFaixas((itens ?? []).filter((x) => x.date === d && x.status !== 'cancelado'))])), [dias, itens])

  // o minuto embaixo do mouse numa coluna: de 30 em 30 para encaixar, de 15 em 15 para soltar
  const minutoDo = (e, passo = 30) => { const r = e.currentTarget.getBoundingClientRect(); const m = ini + Math.floor(((e.clientY - r.top) / PX_HORA) * (60 / passo)) * passo; return Math.max(ini, Math.min(fim - passo, m)) }
  const foraDoHorario = (d, m) => { const s = sombras?.[d]; if (!s) return false; const j = s.jornada; return Boolean((j && (!j.open || m < min(j.start) || m >= min(j.end))) || (s.blocos ?? []).some((b) => m >= b.ini && m < b.fim)) }
  const corUma = uma ? corDa(profs, uma.id) : null
  const fechadoTxt = uma ? 'Folga' : 'Fechado'

  return (
    <div className={'ags-semana' + (uma ? ' uma' : '') + (arrastando ? ' arrastando' : '')}>
      <div className="ags-semana-cab">
        <span />
        {dias.map((d) => {
          const dt = new Date(d + 'T12:00:00'); const n = porDia[d].length
          const s = sombras?.[d]; const fechado = s && ((s.jornada && !s.jornada.open) || (s.blocos ?? []).some((b) => b.diaTodo))
          return (
            <button key={d} type="button" className={'ags-semana-dia' + (d === hoje ? ' hoje' : '')} onClick={() => onAbrirDia(d)} title="Ver este dia com uma coluna por profissional">
              <small>{DIAS_CURTOS[dt.getDay()]}</small><b>{dt.getDate()}</b><span>{n ? `${n} ${n === 1 ? 'horário' : 'horários'}` : fechado ? fechadoTxt.toLowerCase() : d < hoje ? 'sem horários' : 'livre'}</span>
            </button>
          )
        })}
      </div>
      <div className="ags-semana-corpo" style={{ height: altura }}>
        <div className="ags-semana-horas">{horas.map((m) => <span key={m} style={{ top: px(m) }}>{hhmm(m)}</span>)}</div>
        {dias.map((d) => {
          const s = sombras?.[d]
          const j = s?.jornada
          const futuro = d >= hoje
          const podeEncaixar = Boolean(onEncaixar && futuro)
          const podeSoltar = Boolean(onMover && futuro && arrastando)
          return (
            <div key={d} className={'ags-semana-col' + (d === hoje ? ' hoje' : '') + (d < hoje ? ' passado' : '') + (podeEncaixar ? ' encaixa' : '') + (sombra?.dia === d ? ' alvo' : '')} style={{ '--h': PX_HORA + 'px' }}
              onClick={(e) => { if (e.target === e.currentTarget && podeEncaixar) onEncaixar({ dia: d, hora: hhmm(minutoDo(e)) }) }}
              onMouseMove={podeEncaixar ? (e) => { if (arrastando || e.target !== e.currentTarget) { if (fantasma) setFantasma(null); return } const m = minutoDo(e); if (fantasma?.dia !== d || fantasma?.ini !== m) setFantasma({ dia: d, ini: m }) } : undefined}
              onMouseLeave={podeEncaixar ? () => setFantasma(null) : undefined}
              onDragOver={podeSoltar ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const m = minutoDo(e, 15); if (sombra?.dia !== d || sombra?.ini !== m) setSombra({ dia: d, ini: m }) } : undefined}
              onDragLeave={podeSoltar ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSombra((x) => (x?.dia === d ? null : x)) } : undefined}
              onDrop={podeSoltar ? (e) => { e.preventDefault(); const a = arrastando; const m = minutoDo(e, 15); setSombra(null); setArrastando(null); if (a && (d !== a.date || m !== min(a.start_time))) onMover(a, { dia: d, hora: hhmm(m) }) } : undefined}>
              {s && j && (j.open
                ? <>{min(j.start) > ini && <span className="quadro-fora" style={{ top: 0, height: px(min(j.start)) }} />}{min(j.end) < fim && <span className="quadro-fora" style={{ top: px(min(j.end)), bottom: 0 }} />}</>
                : <span className="quadro-fora quadro-folga" style={{ top: 0, bottom: 0 }}><em>{fechadoTxt}</em></span>)}
              {s && j?.open !== false && (s.blocos ?? []).map((b, i) => b.diaTodo
                ? <span key={'b' + i} className="quadro-fora quadro-folga" style={{ top: 0, bottom: 0 }}><em>{b.motivo || 'Bloqueado'}</em></span>
                : b.fim > ini && b.ini < fim && <span key={'b' + i} className="quadro-fora quadro-bloqueio" style={{ top: px(Math.max(b.ini, ini)), height: px(Math.min(b.fim, fim)) - px(Math.max(b.ini, ini)) }}>{px(b.fim) - px(b.ini) >= 22 && <em>{b.motivo || 'Bloqueado'}</em>}</span>)}
              {d === hoje && agoraMin >= ini && agoraMin <= fim && <span className="quadro-agora" style={{ top: px(agoraMin) }} />}
              {fantasma?.dia === d && !arrastando && (() => { const fora = foraDoHorario(d, fantasma.ini); return <span className={'quadro-fantasma' + (fora ? ' fora' : '')} style={{ top: px(fantasma.ini), height: PX_HORA / 2 }}>+ Encaixar às {hhmm(fantasma.ini)}{fora && <small>{uma ? 'fora do horário dela' : 'salão fechado'}</small>}</span> })()}
              {sombra?.dia === d && arrastando && <span className="quadro-sombra" style={{ top: px(sombra.ini), height: Math.max(20, px(sombra.ini + min(arrastando.end_time) - min(arrastando.start_time)) - px(sombra.ini)) }}>{hhmm(sombra.ini)} · solte aqui</span>}
              {porDia[d].map(({ a, faixa: f, de }) => {
                const c = corUma ?? corDa(profs, a.professional_id)
                const top = px(min(a.start_time))
                const h = Math.max(22, px(min(a.end_time)) - top - 2)
                const prof = profs.find((p) => p.id === a.professional_id)
                const agoraSim = d === hoje && a.status === 'confirmado' && agoraMin >= min(a.start_time) && agoraMin < min(a.end_time)
                const arrasta = Boolean(onMover && movel(a))
                return (
                  <div key={a.id} role="button" tabIndex={0} draggable={arrasta} className={'ags-semana-item ' + a.status + (agoraSim ? ' agora' : '') + (arrasta ? ' movel' : '') + (arrastando?.id === a.id ? ' no-ar' : '')}
                    style={{ top, height: h, left: `calc(${(f / de) * 100}% + 2px)`, width: `calc(${100 / de}% - 4px)`, '--c': c.cor, '--v': c.veu }}
                    title={`${a.start_time.slice(0, 5)}–${a.end_time.slice(0, 5)} · ${nomeDe(a)} · ${servicoDe(a)} · ${prof?.name ?? ''}${arrasta ? ' · arraste para remarcar' : ''}`}
                    onMouseMove={() => { if (fantasma) setFantasma(null) }}
                    onDragStart={arrasta ? (e) => { e.dataTransfer.setData('text/plain', a.id); e.dataTransfer.effectAllowed = 'move'; setFantasma(null); setArrastando(a) } : undefined}
                    onDragEnd={arrasta ? () => { setArrastando(null); setSombra(null) } : undefined}
                    onClick={() => (onAbrir ? onAbrir(a) : onAbrirDia(d))}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (onAbrir) onAbrir(a); else onAbrirDia(d) } }}>
                    <b>{a.status === 'concluido' ? <Check size={11} /> : a.status === 'pendente' ? <Hourglass size={11} /> : a.status === 'faltou' ? <UserX size={11} /> : null}{a.start_time.slice(0, 5)} {nomeDe(a)}</b>
                    {h > 36 && <small>{servicoDe(a)}{!uma && prof ? ` · ${primeiroNome(prof.name)}` : ''}</small>}
                    {h > 54 && a.status === 'pendente' && <small className="ags-semana-pend">a confirmar</small>}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      <LegendaAgenda profs={profs} uma={uma} dicas="semana" />
    </div>
  )
}
