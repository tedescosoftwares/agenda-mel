import { useMemo, useState } from 'react'
import { toISODate } from '../lib/format'

const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

// Calendário de mês para escolher o dia.
//
// Substituiu a tira de 14 dias que rolava para o lado. A tira dava
// certo para "essa semana ou a próxima" e falhava para tudo mais: quem
// quisesse marcar dali a três semanas rolava às cegas, sem nunca ver o
// mês inteiro. Aqui a pessoa vê a forma do mês e onde estão os buracos.
//
// Dia fechado nasce desabilitado — clicar num dia que não existe e
// receber "nenhum horário" é a tela mentindo sobre a própria oferta.
export default function CalendarioMes({ valor, onEscolher, diaAberto, minimo }) {
  const hoje = useMemo(() => new Date(), [])
  const [ancora, setAncora] = useState(() => {
    const base = valor ? new Date(valor + 'T12:00:00') : hoje
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  const semanas = useMemo(() => {
    const primeiro = new Date(ancora.getFullYear(), ancora.getMonth(), 1)
    const ultimo = new Date(ancora.getFullYear(), ancora.getMonth() + 1, 0)
    const celulas = []
    // as casas vazias antes do dia 1, para a coluna bater com o dia da semana
    for (let i = 0; i < primeiro.getDay(); i++) celulas.push(null)
    for (let d = 1; d <= ultimo.getDate(); d++) {
      celulas.push(new Date(ancora.getFullYear(), ancora.getMonth(), d))
    }
    while (celulas.length % 7 !== 0) celulas.push(null)
    return Array.from({ length: celulas.length / 7 }, (_, i) =>
      celulas.slice(i * 7, i * 7 + 7),
    )
  }, [ancora])

  const pisoISO = minimo ?? toISODate(hoje)
  const mesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
  const podeVoltar = ancora > mesAtual

  function mover(passo) {
    setAncora((a) => new Date(a.getFullYear(), a.getMonth() + passo, 1))
  }

  return (
    <div className="card calendario">
      <div className="cal-topo">
        <button
          type="button"
          className="cal-seta"
          onClick={() => mover(-1)}
          disabled={!podeVoltar}
          aria-label="Mês anterior"
        >
          ‹
        </button>
        <strong>
          {MESES[ancora.getMonth()]} {ancora.getFullYear()}
        </strong>
        <button
          type="button"
          className="cal-seta"
          onClick={() => mover(1)}
          aria-label="Próximo mês"
        >
          ›
        </button>
      </div>

      <div className="cal-grade cal-cabecalho">
        {DIAS_SEMANA.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>

      {semanas.map((semana, i) => (
        <div key={i} className="cal-grade">
          {semana.map((d, j) => {
            if (!d) return <span key={j} className="cal-vazio" />
            const iso = toISODate(d)
            const passado = iso < pisoISO
            const fechado = diaAberto ? !diaAberto(d) : false
            const indisponivel = passado || fechado
            return (
              <button
                key={j}
                type="button"
                className={
                  'cal-dia' +
                  (iso === valor ? ' escolhido' : '') +
                  (iso === toISODate(hoje) ? ' hoje' : '')
                }
                disabled={indisponivel}
                onClick={() => onEscolher(iso)}
              >
                {d.getDate()}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
