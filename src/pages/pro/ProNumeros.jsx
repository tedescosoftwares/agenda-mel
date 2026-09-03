import { useCallback, useEffect, useState } from 'react'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatarCents, formatarReaisCurto, formatarPct, mesAtual, mesDeslocado, nomeDoMes } from '../../lib/numeros'
import GraficoLinha from '../../components/GraficoLinha'

// Números do mês (tela 22): quatro cartões e a linha do faturamento
// dia a dia. A linha vem dos próprios atendimentos concluídos — não
// existe tabela de "faturamento por dia", e não precisa.
export default function ProNumeros() {
  const { professional } = useAuth()
  const [mes, setMes] = useState(mesAtual())
  const [r, setR] = useState(null)
  const [porDia, setPorDia] = useState([])
  const [erro, setErro] = useState('')
  const profId = professional?.id

  const carregar = useCallback(async () => {
    if (!profId) return
    const ini = mes, fim = mesDeslocado(mes, 1)
    const [res, ag] = await Promise.all([
      supabase.rpc('resumo_do_mes', { prof: profId, mes }),
      supabase.from('appointments').select('date, price_cents, status').eq('professional_id', profId).gte('date', ini).lt('date', fim).eq('status', 'concluido'),
    ])
    if (res.error) setErro(res.error.message)
    else setR(Array.isArray(res.data) ? res.data[0] : res.data)
    const soma = {}
    for (const a of ag.data ?? []) soma[a.date] = (soma[a.date] ?? 0) + (a.price_cents ?? 0)
    setPorDia(Object.entries(soma).sort().map(([d, v]) => ({ x: d.slice(8, 10), y: v / 100 })))
  }, [profId, mes])
  useEffect(() => { carregar() }, [carregar])

  if (!professional) return <SemFicha />

  const var_ = r && r.faturamento_mes_anterior_cents ? Math.round(((r.faturamento_cents - r.faturamento_mes_anterior_cents) / r.faturamento_mes_anterior_cents) * 100) : null

  return (
    <ProShell>
      <div className="page-head">
        <div><h2>Números do mês</h2><p className="muted">{nomeDoMes(mes)}</p></div>
        <div className="mes-nav-mini">
          <button className="cal-seta" onClick={() => setMes(mesDeslocado(mes, -1))} aria-label="Mês anterior">‹</button>
          <button className="cal-seta" onClick={() => setMes(mesDeslocado(mes, 1))} disabled={mes >= mesAtual()} aria-label="Próximo mês">›</button>
        </div>
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}
      {r && (
        <>
          <div className="kpis">
            <div className="card kpi"><span className="muted">Agendamentos</span><strong>{r.atendimentos}</strong><span className="kpi-nota">{r.clientes} clientes</span></div>
            <div className="card kpi"><span className="muted">Faturamento</span><strong>{formatarReaisCurto(r.faturamento_cents)}</strong>{var_ != null && <span className={'kpi-nota ' + (var_ >= 0 ? 'mais' : 'menos')}>{var_ >= 0 ? '+' : ''}{var_}% vs mês anterior</span>}</div>
            <div className="card kpi"><span className="muted">Taxa de ocupação</span><strong>{formatarPct(r.ocupacao_bps)}</strong><span className="kpi-nota">da agenda aberta</span></div>
            <div className="card kpi"><span className="muted">Faltas</span><strong>{r.faltas}</strong><span className="kpi-nota">{formatarPct(r.taxa_falta_bps)} dos horários</span></div>
          </div>

          <div className="card">
            <div className="secao-cabeca" style={{ margin: '0 0 0.4rem' }}><h3>Faturamento por dia</h3><span className="muted" style={{ fontSize: '0.8rem' }}>ticket médio {formatarCents(r.ticket_medio_cents)}</span></div>
            {porDia.length ? <GraficoLinha pontos={porDia} /> : <p className="muted">Sem atendimentos concluídos neste mês.</p>}
          </div>
        </>
      )}
    </ProShell>
  )
}
