import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminShell from '../../components/AdminShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatarCents, formatarReaisCurto, formatarPct, mesAtual, nomeDoMes } from '../../lib/numeros'
import GraficoLinha from '../../components/GraficoLinha'
import { toISODate } from '../../lib/format'

// Dashboard do salão (tela 23): o dia de hoje em quatro números, o
// faturamento do mês dia a dia, o que está esperando resposta, e os
// atalhos para o que se faz todo dia.
export default function AdminDashboard() {
  const { salao } = useAuth()
  const [hoje, setHoje] = useState({ atendimentos: 0, faturamento: 0 })
  const [pendentes, setPendentes] = useState(0)
  const [naFila, setNaFila] = useState(0)
  const [linhas, setLinhas] = useState([])
  const [porDia, setPorDia] = useState([])
  const salaoId = salao?.id

  const carregar = useCallback(async () => {
    if (!salaoId) return
    const d = toISODate(new Date()), mes = mesAtual()
    const [ag, pend, fila, res, mesAg] = await Promise.all([
      supabase.from('appointments').select('price_cents, status').eq('salon_id', salaoId).eq('date', d).neq('status', 'cancelado'),
      supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('salon_id', salaoId).eq('status', 'pendente').gte('date', d),
      supabase.from('waitlist_entries').select('id', { count: 'exact', head: true }).eq('status', 'aguardando'),
      supabase.rpc('resumo_do_salao', { salao: salaoId, mes }),
      supabase.from('appointments').select('date, price_cents').eq('salon_id', salaoId).eq('status', 'concluido').gte('date', mes),
    ])
    const lista = ag.data ?? []
    setHoje({ atendimentos: lista.length, faturamento: lista.reduce((s, a) => s + (a.price_cents ?? 0), 0) })
    setPendentes(pend.count ?? 0)
    setNaFila(fila.count ?? 0)
    setLinhas(res.data ?? [])
    const soma = {}
    for (const a of mesAg.data ?? []) soma[a.date] = (soma[a.date] ?? 0) + (a.price_cents ?? 0)
    setPorDia(Object.entries(soma).sort().map(([k, v]) => ({ x: k.slice(8, 10), y: v / 100 })))
  }, [salaoId])
  useEffect(() => { carregar() }, [carregar])

  const totalMes = linhas.reduce((s, l) => s + Number(l.faturamento_cents ?? 0), 0)
  const atendMes = linhas.reduce((s, l) => s + Number(l.atendimentos ?? 0), 0)
  const ocup = linhas.length ? Math.round(linhas.reduce((s, l) => s + Number(l.ocupacao_bps ?? 0), 0) / linhas.length) : 0
  const maior = Math.max(1, ...linhas.map((l) => Number(l.faturamento_cents ?? 0)))

  return (
    <AdminShell>
      <div className="page-head"><div><h2>{salao?.name ?? 'Meu salão'}</h2><p className="muted titulo-dia">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div></div>

      <div className="kpis">
        <div className="card kpi"><span className="muted">Hoje</span><strong>{hoje.atendimentos}</strong><span className="kpi-nota">atendimentos · {formatarCents(hoje.faturamento)}</span></div>
        <div className="card kpi"><span className="muted">{nomeDoMes(mesAtual()).split(' ')[0]}</span><strong>{formatarReaisCurto(totalMes)}</strong><span className="kpi-nota">{atendMes} atendimentos</span></div>
        <Link to="/admin/agenda" className="card kpi kpi-link"><span className="muted">Esperando aceite</span><strong>{pendentes}</strong><span className="kpi-nota">pedidos pendentes</span></Link>
        <div className="card kpi"><span className="muted">Fila de espera</span><strong>{naFila}</strong><span className="kpi-nota">ocupação {formatarPct(ocup)}</span></div>
      </div>

      <div className="card">
        <div className="secao-cabeca" style={{ margin: '0 0 0.4rem' }}><h3>Faturamento do mês</h3></div>
        {porDia.length ? <GraficoLinha pontos={porDia} /> : <p className="muted">Nada concluído neste mês ainda.</p>}
      </div>

      <h3 className="secao-titulo">Por profissional</h3>
      <div className="card barra-list">
        {linhas.map((l) => (
          <div key={l.professional_id} className="barra-item">
            <div className="barra-topo"><span className="barra-nome">{l.nome}</span><span className="barra-valor">{formatarCents(l.faturamento_cents)}</span></div>
            <div className="barra-trilho"><span className="barra-preenche" style={{ width: `${Math.max(2, (Number(l.faturamento_cents) * 100) / maior)}%` }} /></div>
            <span className="barra-nota">{l.atendimentos}× · {formatarPct(l.ocupacao_bps)} ocupada</span>
          </div>
        ))}
        {linhas.length === 0 && <p className="muted" style={{ margin: 0 }}>Sem números neste mês.</p>}
      </div>

      <h3 className="secao-titulo">Atalhos</h3>
      <div className="atalhos">
        <Link to="/admin/agenda?encaixe=1" className="card atalho"><span>➕</span>Novo encaixe</Link>
        <Link to="/admin/equipe" className="card atalho"><span>👩‍🦰</span>Equipe</Link>
        <Link to="/admin/servicos" className="card atalho"><span>✨</span>Serviços</Link>
        <Link to="/admin/whatsapp" className="card atalho"><span>💬</span>WhatsApp</Link>
      </div>
    </AdminShell>
  )
}
