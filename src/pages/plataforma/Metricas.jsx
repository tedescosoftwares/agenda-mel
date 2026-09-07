import { useEffect, useState } from 'react'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho, Painel, Vazio } from '../../components/plataforma/Pecas'
import GraficoLinha from '../../components/GraficoLinha'
import { supabase } from '../../lib/supabase'
import { GraficoIcon } from '../../components/icons'
import { formatarCents } from '../../lib/indicacao'

// Métricas: as séries semanais do MIMO inteiro. Doze semanas, um
// gráfico por medida. Sem projeção, sem estimativa: é o que aconteceu.
const MEDIDAS = [
  ['atendimentos', 'Atendimentos concluídos', (v) => v],
  ['faturamento_cents', 'Faturamento atendido', (v) => formatarCents(v)],
  ['contas', 'Contas novas', (v) => v],
  ['vinculos', 'Vínculos criados', (v) => v],
  ['whats', 'WhatsApps enviados', (v) => v],
  ['faltas', 'Faltas', (v) => v],
]

export default function Metricas() {
  const [serie, setSerie] = useState(null)
  const [erro, setErro] = useState('')
  useEffect(() => { supabase.rpc('plataforma_series', { semanas: 12 }).then(({ data, error }) => { if (error) setErro(error.message); setSerie(data ?? []) }) }, [])

  return (
    <Shell>
      <Cabecalho titulo="Métricas" sub="As últimas doze semanas do MIMO inteiro, medida por medida." direita={<div className="plat-periodo">📅 Últimas 12 semanas</div>} />
      {erro && <div className="alert alert-error">{erro}</div>}
      {!serie ? <Vazio>Carregando…</Vazio> : (
        <div className="plat-grade-3">
          {MEDIDAS.map(([k, titulo, fmt]) => {
            const pontos = serie.map((s) => ({ x: new Date(s.fim + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), y: Number(s[k] ?? 0) }))
            const total = pontos.reduce((a, p) => a + p.y, 0)
            const ult = pontos[pontos.length - 1]?.y ?? 0, pen = pontos[pontos.length - 2]?.y ?? 0
            return (
              <Painel key={k} Icon={GraficoIcon} titulo={titulo} sub={`${fmt(total)} em 12 semanas`} direita={<span className={'plat-delta ' + (ult >= pen ? 'sobe' : 'desce')}>{ult >= pen ? '↗' : '↘'} {fmt(ult)} <small className="muted">na semana</small></span>}>
                <GraficoLinha pontos={pontos} altura={140} />
              </Painel>
            )
          })}
        </div>
      )}
    </Shell>
  )
}
