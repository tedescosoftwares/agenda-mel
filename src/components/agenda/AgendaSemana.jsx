import { useMemo } from 'react'
import { isoHoje, DIAS_CURTOS, min, hhmm, corDa, primeiroNome } from './agendaComum'

// 4.0: a Agenda da semana, no computador: os 7 dias lado a lado, as horas descendo, cada horário com a cor da
// profissional (horários ao mesmo tempo dividem a largura). Clicar num horário ou num dia abre aquele dia no
// quadro, onde estão as ações (concluir, remarcar, encaixar).
const PX_HORA = 52
const nomeDe = (a) => a.profiles?.full_name || a.guest_name || 'Cliente'

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

export default function AgendaSemana({ dias, itens, profs, faixa = [8 * 60, 20 * 60], onAbrirDia }) {
  const hoje = isoHoje()
  const [ini, fim] = useMemo(() => {
    const todos = itens ?? []
    const a = Math.min(faixa[0], ...todos.map((x) => min(x.start_time)))
    const b = Math.max(faixa[1], ...todos.map((x) => min(x.end_time)))
    return [Math.floor(a / 60) * 60, Math.ceil(b / 60) * 60]
  }, [itens, faixa])
  const altura = ((fim - ini) / 60) * PX_HORA
  const horas = []; for (let m = ini; m < fim; m += 60) horas.push(m)
  const porDia = useMemo(() => Object.fromEntries(dias.map((d) => [d, emFaixas((itens ?? []).filter((x) => x.date === d && x.status !== 'cancelado'))])), [dias, itens])

  return (
    <div className="ags-semana">
      <div className="ags-semana-cab">
        <span />
        {dias.map((d) => {
          const dt = new Date(d + 'T12:00:00'); const n = porDia[d].length
          return (
            <button key={d} type="button" className={'ags-semana-dia' + (d === hoje ? ' hoje' : '')} onClick={() => onAbrirDia(d)}>
              <small>{DIAS_CURTOS[dt.getDay()]}</small><b>{dt.getDate()}</b><span>{n ? `${n} ${n === 1 ? 'horário' : 'horários'}` : 'sem horários'}</span>
            </button>
          )
        })}
      </div>
      <div className="ags-semana-corpo" style={{ height: altura }}>
        <div className="ags-semana-horas">{horas.map((m) => <span key={m} style={{ top: ((m - ini) / 60) * PX_HORA }}>{hhmm(m)}</span>)}</div>
        {dias.map((d) => (
          <div key={d} className={'ags-semana-col' + (d === hoje ? ' hoje' : '') + (d < hoje ? ' passado' : '')} style={{ '--h': PX_HORA + 'px' }} onClick={(e) => { if (e.target === e.currentTarget) onAbrirDia(d) }}>
            {porDia[d].map(({ a, faixa: f, de }) => {
              const c = corDa(profs, a.professional_id)
              const top = ((min(a.start_time) - ini) / 60) * PX_HORA
              const h = Math.max(20, ((min(a.end_time) - min(a.start_time)) / 60) * PX_HORA - 2)
              const prof = profs.find((p) => p.id === a.professional_id)
              return (
                <button key={a.id} type="button" className={'ags-semana-item ' + a.status}
                  style={{ top, height: h, left: `calc(${(f / de) * 100}% + 2px)`, width: `calc(${100 / de}% - 4px)`, '--c': c.cor, '--v': c.veu }}
                  title={`${a.start_time.slice(0, 5)} · ${nomeDe(a)} · ${a.service_name || a.services?.name || ''} · ${prof?.name ?? ''}`}
                  onClick={() => onAbrirDia(d)}>
                  <b>{a.start_time.slice(0, 5)} {nomeDe(a)}</b>
                  {h > 34 && <small>{primeiroNome(prof?.name)}{a.status === 'pendente' ? ' · a confirmar' : ''}</small>}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="ags-semana-legenda">
        {profs.map((p) => { const c = corDa(profs, p.id); return <span key={p.id}><i style={{ background: c.cor }} />{p.name}</span> })}
      </div>
    </div>
  )
}
