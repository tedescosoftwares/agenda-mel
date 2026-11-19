import { useEffect, useMemo, useState } from 'react'
import { isoHoje, DIAS_CURTOS, min, hhmm, corDa, primeiroNome } from './agendaComum'

// 4.0: a Agenda da semana, no computador: os 7 dias lado a lado, as horas descendo, cada horário com a cor da
// profissional (horários ao mesmo tempo dividem a largura). Com a equipe toda, clicar num horário ou num dia abre
// aquele dia no quadro, onde estão as ações.
// Com uma profissional só (`uma`, o filtro), é a semana dela: o fora do horário, a folga e o almoço sombreados em
// cada dia, clicar num horário abre as ações (onAbrir) e clicar no vazio encaixa naquele dia e hora (onEncaixar).
const nomeDe = (a) => a.cliente || a.profiles?.full_name || a.guest_name || 'Cliente'
const servicoDe = (a) => a.servico || a.service_name || a.services?.name || ''

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

export default function AgendaSemana({ dias, itens, profs, faixa = [8 * 60, 20 * 60], onAbrirDia, uma = null, sombras = null, onAbrir, onEncaixar }) {
  const hoje = isoHoje()
  const PX_HORA = uma ? 64 : 52
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 60000); return () => clearInterval(t) }, [])
  const agoraMin = agora.getHours() * 60 + agora.getMinutes()
  const [fantasma, setFantasma] = useState(null)   // { dia, ini } com o mouse no vazio (semana dela)

  const [ini, fim] = useMemo(() => {
    const todos = itens ?? []
    const jornadas = uma && sombras ? Object.values(sombras).map((s) => s.jornada).filter((j) => j?.open) : []
    const a = Math.min(faixa[0], ...todos.map((x) => min(x.start_time)), ...jornadas.map((j) => min(j.start)))
    const b = Math.max(faixa[1], ...todos.map((x) => min(x.end_time)), ...jornadas.map((j) => min(j.end)))
    return [Math.floor(a / 60) * 60, Math.ceil(b / 60) * 60]
  }, [itens, faixa, uma, sombras])
  const px = (m) => ((m - ini) / 60) * PX_HORA
  const altura = px(fim)
  const horas = []; for (let m = ini; m < fim; m += 60) horas.push(m)
  const porDia = useMemo(() => Object.fromEntries(dias.map((d) => [d, emFaixas((itens ?? []).filter((x) => x.date === d && x.status !== 'cancelado'))])), [dias, itens])

  // o minuto (de 30 em 30) embaixo do mouse numa coluna
  const minutoDo = (e) => { const r = e.currentTarget.getBoundingClientRect(); const m = ini + Math.floor(((e.clientY - r.top) / PX_HORA) * 2) * 30; return Math.max(ini, Math.min(fim - 30, m)) }
  const foraDoHorario = (d, m) => { const s = sombras?.[d]; if (!s) return false; const j = s.jornada; return Boolean((j && (!j.open || m < min(j.start) || m >= min(j.end))) || (s.blocos ?? []).some((b) => m >= b.ini && m < b.fim)) }
  const corUma = uma ? corDa(profs, uma.id) : null

  return (
    <div className={'ags-semana' + (uma ? ' uma' : '')}>
      <div className="ags-semana-cab">
        <span />
        {dias.map((d) => {
          const dt = new Date(d + 'T12:00:00'); const n = porDia[d].length
          const s = sombras?.[d]; const folga = uma && s && ((s.jornada && !s.jornada.open) || (s.blocos ?? []).some((b) => b.diaTodo))
          return (
            <button key={d} type="button" className={'ags-semana-dia' + (d === hoje ? ' hoje' : '')} onClick={() => onAbrirDia(d)} title={uma ? 'Ver o dia com a equipe toda' : undefined}>
              <small>{DIAS_CURTOS[dt.getDay()]}</small><b>{dt.getDate()}</b><span>{n ? `${n} ${n === 1 ? 'horário' : 'horários'}` : folga ? 'folga' : 'sem horários'}</span>
            </button>
          )
        })}
      </div>
      <div className="ags-semana-corpo" style={{ height: altura }}>
        <div className="ags-semana-horas">{horas.map((m) => <span key={m} style={{ top: px(m) }}>{hhmm(m)}</span>)}</div>
        {dias.map((d) => {
          const s = uma ? sombras?.[d] : null
          const j = s?.jornada
          const podeEncaixar = Boolean(uma && onEncaixar && d >= hoje)
          return (
            <div key={d} className={'ags-semana-col' + (d === hoje ? ' hoje' : '') + (d < hoje ? ' passado' : '') + (podeEncaixar ? ' encaixa' : '')} style={{ '--h': PX_HORA + 'px' }}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return
                if (podeEncaixar) onEncaixar({ dia: d, hora: hhmm(minutoDo(e)) })
                else if (!uma) onAbrirDia(d)
              }}
              onMouseMove={podeEncaixar ? (e) => { if (e.target !== e.currentTarget) { if (fantasma) setFantasma(null); return } const m = minutoDo(e); if (fantasma?.dia !== d || fantasma?.ini !== m) setFantasma({ dia: d, ini: m }) } : undefined}
              onMouseLeave={podeEncaixar ? () => setFantasma(null) : undefined}>
              {s && j && (j.open
                ? <>{min(j.start) > ini && <span className="quadro-fora" style={{ top: 0, height: px(min(j.start)) }} />}{min(j.end) < fim && <span className="quadro-fora" style={{ top: px(min(j.end)), bottom: 0 }} />}</>
                : <span className="quadro-fora quadro-folga" style={{ top: 0, bottom: 0 }}><em>Folga</em></span>)}
              {s && j?.open !== false && (s.blocos ?? []).map((b, i) => b.diaTodo
                ? <span key={'b' + i} className="quadro-fora quadro-folga" style={{ top: 0, bottom: 0 }}><em>{b.motivo || 'Bloqueado'}</em></span>
                : b.fim > ini && b.ini < fim && <span key={'b' + i} className="quadro-fora quadro-bloqueio" style={{ top: px(Math.max(b.ini, ini)), height: px(Math.min(b.fim, fim)) - px(Math.max(b.ini, ini)) }}>{px(b.fim) - px(b.ini) >= 22 && <em>{b.motivo || 'Bloqueado'}</em>}</span>)}
              {uma && d === hoje && agoraMin >= ini && agoraMin <= fim && <span className="quadro-agora" style={{ top: px(agoraMin) }} />}
              {fantasma?.dia === d && (() => { const fora = foraDoHorario(d, fantasma.ini); return <span className={'quadro-fantasma' + (fora ? ' fora' : '')} style={{ top: px(fantasma.ini), height: PX_HORA / 2 }}>+ {hhmm(fantasma.ini)}{fora && <small>fora do horário</small>}</span> })()}
              {porDia[d].map(({ a, faixa: f, de }) => {
                const c = corUma ?? corDa(profs, a.professional_id)
                const top = px(min(a.start_time))
                const h = Math.max(20, px(min(a.end_time)) - top - 2)
                const prof = profs.find((p) => p.id === a.professional_id)
                const agoraSim = uma && d === hoje && a.status === 'confirmado' && agoraMin >= min(a.start_time) && agoraMin < min(a.end_time)
                return (
                  <button key={a.id} type="button" className={'ags-semana-item ' + a.status + (agoraSim ? ' agora' : '')}
                    style={{ top, height: h, left: `calc(${(f / de) * 100}% + 2px)`, width: `calc(${100 / de}% - 4px)`, '--c': c.cor, '--v': c.veu }}
                    title={`${a.start_time.slice(0, 5)} · ${nomeDe(a)} · ${servicoDe(a)} · ${prof?.name ?? ''}`}
                    onMouseMove={() => { if (fantasma) setFantasma(null) }}
                    onClick={() => (uma && onAbrir ? onAbrir(a) : onAbrirDia(d))}>
                    <b>{a.start_time.slice(0, 5)} {nomeDe(a)}</b>
                    {h > 34 && <small>{uma ? servicoDe(a) : primeiroNome(prof?.name)}{a.status === 'pendente' ? ' · a confirmar' : a.status === 'faltou' ? ' · não veio' : ''}</small>}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
      <div className="ags-semana-legenda">
        {uma
          ? <><span><i style={{ background: corUma.cor }} />{uma.name}</span><span className="muted">Clique num horário para as ações · no vazio, para encaixar · no dia, para ver a equipe toda</span></>
          : profs.map((p) => { const c = corDa(profs, p.id); return <span key={p.id}><i style={{ background: c.cor }} />{p.name}</span> })}
      </div>
    </div>
  )
}
