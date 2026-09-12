import { useEffect, useState } from 'react'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho, Painel, Vazio, Kpi, Iniciais } from '../../components/plataforma/Pecas'
import GraficoLinha from '../../components/GraficoLinha'
import { supabase } from '../../lib/supabase'
import { GraficoIcon } from '../../components/icons'
import { formatarCents } from '../../lib/indicacao'
import { CalendarDays, UserX } from 'lucide-react'

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
  const [conf, setConf] = useState(null)
  const [erro, setErro] = useState('')
  useEffect(() => { supabase.rpc('plataforma_series', { semanas: 12 }).then(({ data, error }) => { if (error) setErro(error.message); setSerie(data ?? []) }) }, [])
  useEffect(() => { supabase.rpc('plataforma_confiabilidade', { dias: 30 }).then(({ data }) => setConf(data ?? null)) }, [])
  const taxa = conf ? (conf.concluidos + conf.faltas > 0 ? Math.round((conf.faltas / (conf.concluidos + conf.faltas)) * 100) : 0) : 0

  return (
    <Shell>
      <Cabecalho titulo="Métricas" sub="As últimas doze semanas do MIMO inteiro, medida por medida." direita={<div className="plat-periodo"><CalendarDays size={15} /> Últimas 12 semanas</div>} />
      {erro && <div className="alert alert-error">{erro}</div>}

      <Painel Icon={UserX} titulo="Confiabilidade das clientes" sub="Últimos 30 dias. Falta, cancelamento e remarcação por cliente; a cliente nunca vê isso." className="plat-conf">
        {!conf ? <Vazio>Carregando…</Vazio> : (
          <div className="plat-conf-grade">
            <div className="plat-grade-4 plat-conf-kpis">
              <Kpi Icon={UserX} cor="carmim" n={conf.faltas} rotulo="faltas" sub={`${taxa}% dos atendimentos`} />
              <Kpi Icon={CalendarDays} cor="ambar" n={conf.cancelamentos} rotulo="cancelamentos pela cliente" sub={`${conf.cancelamentos_tardios} em cima da hora`} />
              <Kpi Icon={CalendarDays} cor="roxo" n={conf.remarcacoes} rotulo="remarcações pedidas" sub="pelo app ou pelo bot" />
              <Kpi Icon={CalendarDays} cor="azul" n={conf.cancelamentos_da_casa} rotulo="cancelados pela casa" sub="profissional ou salão" />
            </div>
            <div className="plat-conf-lista">
              <h4>Quem mais faltou</h4>
              {(conf.faltosas ?? []).length === 0 ? <Vazio>Ninguém faltou nos últimos 30 dias.</Vazio> : (
                <ul className="plat-lista-curta">{conf.faltosas.map((f) => <li key={f.id}><Iniciais nome={f.nome} /><strong>{f.nome}</strong><small className="muted">{f.salao}</small><span className="ficha-item ruim">{f.faltas} {f.faltas === 1 ? 'falta' : 'faltas'}</span></li>)}</ul>
              )}
            </div>
          </div>
        )}
      </Painel>

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
