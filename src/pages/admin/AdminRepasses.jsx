import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { HandCoins, ChevronDown, ChevronUp, Download, FileSignature, Info } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { formatCents } from '../../lib/pagamento'

// Repasses: o que é de quem, num período. Cada item de comanda fechada
// sabe a profissional que o fez; aqui eles são somados por pessoa, com o
// desconto rateado, e a cota do contrato de parceria vigente (quando há)
// diz quanto é dela e quanto é da casa. Ainda não move dinheiro: é a
// base em que o split vai se apoiar.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const hoje = () => new Date()
const PERIODOS = [
  { id: 'hoje', rotulo: 'Hoje', calc: () => [iso(hoje()), iso(hoje())] },
  { id: 'semana', rotulo: 'Esta semana', calc: () => { const h = hoje(); const i = new Date(h); i.setDate(h.getDate() - ((h.getDay() + 6) % 7)); return [iso(i), iso(h)] } },
  { id: 'quinzena', rotulo: '15 dias', calc: () => { const h = hoje(); const i = new Date(h); i.setDate(h.getDate() - 14); return [iso(i), iso(h)] } },
  { id: 'mes', rotulo: 'Este mês', calc: () => { const h = hoje(); return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(h)] } },
  { id: 'mes-passado', rotulo: 'Mês passado', calc: () => { const h = hoje(); return [iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), iso(new Date(h.getFullYear(), h.getMonth(), 0))] } },
]
const PERIODICIDADE = { semanal: 'toda semana', quinzenal: 'a cada 15 dias', mensal: 'todo mês' }
const dataCurta = (d) => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })

export default function AdminRepasses() {
  const { salao } = useAuth()
  const [periodo, setPeriodo] = useState('semana')
  const [[de, ate], setFaixa] = useState(() => PERIODOS[1].calc())
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [aberto, setAberto] = useState(null)

  const carregar = useCallback(async () => {
    if (!salao?.id || !de || !ate) return
    setCarregando(true)
    const { data, error } = await supabase.rpc('pdv_repasse', { salao: salao.id, de, ate })
    setCarregando(false)
    if (error) { setErro(error.message); return }
    setErro(''); setDados(data)
  }, [salao?.id, de, ate])
  useEffect(() => { carregar() }, [carregar])

  function escolher(id) { setPeriodo(id); const p = PERIODOS.find((x) => x.id === id); if (p) setFaixa(p.calc()) }
  function mudarData(qual, v) { setPeriodo('custom'); setFaixa(([a, b]) => (qual === 'de' ? [v, b] : [a, v])) }

  function baixarCsv() {
    const linhas = [['dia', 'cliente', 'profissional', 'servico', 'qtd', 'bruto', 'desconto', 'liquido', 'cota_pct', 'repasse']]
    for (const i of dados?.itens ?? []) linhas.push([i.dia, i.cliente, i.profissional ?? '', i.nome, i.qtd, i.valor_cents / 100, i.desconto_cents / 100, i.liquido_cents / 100, i.cota_pct ?? '', i.repasse_cents == null ? '' : i.repasse_cents / 100])
    const csv = linhas.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `repasses-${de}-a-${ate}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  const t = dados?.total
  const pessoas = dados?.por_profissional ?? []
  const itensDe = (pid) => (dados?.itens ?? []).filter((i) => (i.professional_id ?? null) === (pid ?? null))

  return (
    <AdminShell>
      <div className="page-head">
        <div><h2>Repasses</h2><p className="muted">O que é de cada profissional, já separado por serviço.</p></div>
        {dados && (dados.itens ?? []).length > 0 && <button type="button" className="btn btn-secondary" onClick={baixarCsv}><Download size={15} /> Planilha</button>}
      </div>

      <div className="rp-periodo">
        <div className="chips">
          {PERIODOS.map((p) => <button key={p.id} type="button" className={'chip' + (periodo === p.id ? ' active' : '')} onClick={() => escolher(p.id)}>{p.rotulo}</button>)}
        </div>
        <div className="rp-datas">
          <label>de <input type="date" value={de} max={ate} onChange={(e) => mudarData('de', e.target.value)} /></label>
          <label>até <input type="date" value={ate} min={de} onChange={(e) => mudarData('ate', e.target.value)} /></label>
        </div>
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}
      {carregando && !dados && <p className="muted">Somando…</p>}

      {t && (
        <div className="rp-total card">
          <div><span>Bruto</span><strong>{formatCents(t.bruto_cents)}</strong></div>
          <div><span>Descontos</span><strong>− {formatCents(t.desconto_cents)}</strong></div>
          <div className="rp-total-liq"><span>Líquido</span><strong>{formatCents(t.liquido_cents)}</strong></div>
          <div><span>Comandas</span><strong>{t.comandas}</strong><small className="muted">{t.itens} {t.itens === 1 ? 'serviço' : 'serviços'}</small></div>
          {t.repasse_cents > 0 && <div className="rp-total-rep"><span>Para a equipe</span><strong>{formatCents(t.repasse_cents)}</strong><small className="muted">pela cota dos contratos</small></div>}
        </div>
      )}

      {dados && pessoas.length === 0 && <p className="muted">Nenhuma comanda fechada entre {dataCurta(de)} e {dataCurta(ate)}.</p>}

      <div className="rp-lista">
        {pessoas.map((p) => {
          const ab = aberto === (p.professional_id ?? 'sem')
          return (
            <div key={p.professional_id ?? 'sem'} className={'card rp-pessoa' + (ab ? ' aberta' : '')}>
              <button type="button" className="rp-pessoa-topo" onClick={() => setAberto(ab ? null : (p.professional_id ?? 'sem'))} aria-expanded={ab}>
                <span className="rp-avatar">{(p.nome ?? '?').charAt(0)}</span>
                <span className="rp-pessoa-quem">
                  <strong>{p.nome}</strong>
                  <span className="muted">{p.comandas} {p.comandas === 1 ? 'comanda' : 'comandas'} · {p.itens} {p.itens === 1 ? 'serviço' : 'serviços'}
                    {p.contrato ? ` · cota de ${Number(p.contrato.cota_pct)}% do ${p.contrato.base_calculo === 'liquido' ? 'líquido' : 'bruto'}, ${PERIODICIDADE[p.contrato.periodicidade] ?? p.contrato.periodicidade}` : ' · sem contrato de parceria'}
                  </span>
                </span>
                <span className="rp-pessoa-numeros">
                  <span className="rp-num"><small>líquido</small><strong>{formatCents(p.liquido_cents)}</strong></span>
                  {p.contrato ? <span className="rp-num rp-num-rep"><small>para ela</small><strong>{formatCents(p.repasse_cents)}</strong></span> : <span className="rp-num rp-num-vazio"><small>para ela</small><strong>—</strong></span>}
                  {p.contrato && <span className="rp-num"><small>para a casa</small><strong>{formatCents(p.casa_cents)}</strong></span>}
                </span>
                {ab ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {ab && (
                <div className="rp-itens">
                  {!p.contrato && p.professional_id && <p className="rp-aviso"><FileSignature size={14} /> Sem contrato vigente, a cota não é calculada. <Link to={`/admin/equipe/${p.professional_id}/parceria`}>Fazer o contrato de parceria</Link>.</p>}
                  <table>
                    <thead><tr><th>Dia</th><th>Cliente</th><th>Serviço</th><th className="n">Bruto</th><th className="n">Desc.</th><th className="n">Líquido</th>{p.contrato && <th className="n">Cota</th>}{p.contrato && <th className="n">Para ela</th>}</tr></thead>
                    <tbody>
                      {itensDe(p.professional_id).map((i) => (
                        <tr key={i.id}>
                          <td>{dataCurta(i.dia)}</td><td>{i.cliente}</td><td>{i.nome}{i.qtd > 1 ? ` ×${i.qtd}` : ''}</td>
                          <td className="n">{formatCents(i.valor_cents)}</td><td className="n muted">{i.desconto_cents ? `− ${formatCents(i.desconto_cents)}` : ''}</td><td className="n">{formatCents(i.liquido_cents)}</td>
                          {p.contrato && <td className="n muted">{i.cota_pct != null ? `${Number(i.cota_pct)}%` : ''}</td>}{p.contrato && <td className="n"><strong>{i.repasse_cents != null ? formatCents(i.repasse_cents) : ''}</strong></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="card rp-como">
        <p><Info size={15} /> <strong>Como é contado.</strong> Cada serviço da comanda fica com a profissional que o fez, mesmo quando a cliente passou por mais de uma na mesma visita. O desconto da comanda é rateado na proporção do valor de cada serviço. O sinal pago pelo app não muda nada aqui: ele é só uma forma de pagamento. A cota vem do contrato de parceria vigente (com as exceções por serviço, se houver). Comandas estornadas saem da conta.</p>
        <p className="muted"><HandCoins size={14} /> A transferência do repasse pelo app vem depois; por enquanto esta tela e a planilha são o fechamento.</p>
      </div>
    </AdminShell>
  )
}
