import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Info, TrendingUp, Smartphone, AlertTriangle } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { formatCents } from '../../lib/pagamento'

// Projeção da semana: uma ESTIMATIVA. Soma o que está marcado (confirmado
// e pendente) com o que já foi feito, e separa o que já entrou no caixa
// (sinal pelo app, comandas fechadas) do que ainda depende de a cliente
// vir. Ninguém aqui promete nada: horário pendente pode não virar, e a
// cliente pode faltar.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const somar = (isoD, n) => { const d = new Date(isoD + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d) }
const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
const dataCurta = (d) => new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0)

export default function AdminProjecao() {
  const { salao } = useAuth()
  const [inicio, setInicio] = useState(() => { const h = new Date(); h.setDate(h.getDate() - ((h.getDay() + 6) % 7)); return iso(h) })
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    if (!salao?.id) return
    const { data, error } = await supabase.rpc('projecao_semanal', { salao: salao.id, inicio })
    if (error) { setErro(error.message); return }
    setErro(''); setDados(data)
  }, [salao?.id, inicio])
  useEffect(() => { carregar() }, [carregar])

  const t = dados?.total
  const hoje = dados?.hoje
  const aVir = t ? t.confirmado_cents + t.pendente_cents : 0
  const jaEntrou = t ? t.realizado_cents + t.sinal_cents : 0
  const faltaReceber = t ? Math.max(0, aVir - t.sinal_cents) : 0
  const passada = dados?.semana_passada
  const semanaAtual = hoje && hoje >= dados.inicio && hoje <= dados.fim
  const rotuloSemana = dados ? `${dataCurta(dados.inicio)} a ${dataCurta(dados.fim)}${semanaAtual ? ' · esta semana' : hoje && dados.fim < hoje ? ' · já passou' : ''}` : ''

  return (
    <AdminShell>
      <div className="page-head">
        <div><h2>Projeção da semana</h2><p className="muted">Uma estimativa a partir do que está marcado. Não é faturamento.</p></div>
      </div>

      <div className="pj-nav">
        <button type="button" className="quadro-nav-btn" onClick={() => setInicio((x) => somar(x, -7))} aria-label="Semana anterior"><ChevronLeft size={18} /></button>
        <strong>{rotuloSemana}</strong>
        <button type="button" className="quadro-nav-btn" onClick={() => setInicio((x) => somar(x, 7))} aria-label="Semana seguinte"><ChevronRight size={18} /></button>
        {!semanaAtual && <button type="button" className="btn-mini btn-mini-neutro" onClick={() => { const h = new Date(); h.setDate(h.getDate() - ((h.getDay() + 6) % 7)); setInicio(iso(h)) }}>esta semana</button>}
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}
      {!dados && !erro && <p className="muted">Somando…</p>}

      {t && (
        <>
          <div className="card pj-estimativa">
            <div className="pj-principal">
              <span className="pj-rotulo"><TrendingUp size={14} /> Estimativa da semana</span>
              <strong>{formatCents(t.previsto_cents)}</strong>
              <span className="muted">{t.horarios} {t.horarios === 1 ? 'horário' : 'horários'} · {t.confirmados} confirmados · {t.pendentes} a confirmar · {t.concluidos} feitos{passada?.realizado_cents ? ` · semana passada fechou em ${formatCents(passada.realizado_cents)}` : ''}</span>
            </div>
            <div className="pj-partes">
              <div className="pj-parte feito"><span>Já fechado no caixa</span><strong>{formatCents(t.realizado_cents)}</strong><small className="muted">{t.concluidos} {t.concluidos === 1 ? 'atendimento' : 'atendimentos'} concluídos</small></div>
              <div className="pj-parte sinal"><span><Smartphone size={12} /> Sinal já recebido pelo app</span><strong>{formatCents(t.sinal_cents)}</strong><small className="muted">dos horários que ainda vão acontecer</small></div>
              <div className="pj-parte a-vir"><span>Ainda depende de a cliente vir</span><strong>{formatCents(faltaReceber)}</strong><small className="muted">{formatCents(t.confirmado_cents)} confirmados + {formatCents(t.pendente_cents)} a confirmar, menos o sinal</small></div>
            </div>
            <div className="pj-barra" aria-hidden="true">
              <span className="feito" style={{ width: `${pct(t.realizado_cents, t.previsto_cents)}%` }} />
              <span className="sinal" style={{ width: `${pct(t.sinal_cents, t.previsto_cents)}%` }} />
            </div>
            <p className="muted pj-legenda">{pct(jaEntrou, t.previsto_cents)}% da estimativa já está no caixa (fechado + sinal). {t.perdido_cents > 0 ? `Faltas já tiraram ${formatCents(t.perdido_cents)} da semana.` : ''}</p>
          </div>

          <div className="card pj-dias">
            <table>
              <thead><tr><th>Dia</th><th className="n">Horários</th><th className="n">Confirmados</th><th className="n">A confirmar</th><th className="n">Estimativa</th><th className="n">Sinal no app</th><th className="n">Fechado</th></tr></thead>
              <tbody>
                {(dados.dias ?? []).map((d, i) => {
                  const passado = hoje && d.dia < hoje; const ehHoje = d.dia === hoje
                  return (
                    <tr key={d.dia} className={(ehHoje ? 'hoje' : '') + (passado ? ' passado' : '')}>
                      <td><strong>{DIAS[i]}</strong> <span className="muted">{dataCurta(d.dia)}</span>{ehHoje && <em className="pj-hoje">hoje</em>}</td>
                      <td className="n">{d.horarios}{d.faltas > 0 ? <span className="muted"> · {d.faltas} {d.faltas === 1 ? 'falta' : 'faltas'}</span> : ''}</td>
                      <td className="n">{formatCents(d.confirmado_cents)}</td>
                      <td className="n muted">{d.pendente_cents ? formatCents(d.pendente_cents) : ''}</td>
                      <td className="n"><strong>{formatCents(d.previsto_cents)}</strong></td>
                      <td className="n sinal">{d.sinal_cents ? formatCents(d.sinal_cents) : ''}</td>
                      <td className="n feito">{d.realizado_cents ? formatCents(d.realizado_cents) : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot><tr><td>Semana</td><td className="n">{t.horarios}</td><td className="n">{formatCents(t.confirmado_cents)}</td><td className="n muted">{formatCents(t.pendente_cents)}</td><td className="n"><strong>{formatCents(t.previsto_cents)}</strong></td><td className="n sinal">{formatCents(t.sinal_cents)}</td><td className="n feito">{formatCents(t.realizado_cents)}</td></tr></tfoot>
            </table>
          </div>

          {(dados.por_profissional ?? []).length > 0 && (
            <section className="secao">
              <h3 className="secao-titulo">Por profissional</h3>
              <div className="card pj-profs">
                {dados.por_profissional.map((p) => (
                  <div key={p.professional_id ?? 'sem'} className="pj-prof">
                    <span className="rp-avatar">{(p.nome ?? '?').charAt(0)}</span>
                    <span className="pj-prof-texto"><strong>{p.nome}</strong><span className="muted">{p.horarios} {p.horarios === 1 ? 'horário' : 'horários'}{p.pendentes ? ` · ${p.pendentes} a confirmar` : ''}</span></span>
                    <span className="pj-prof-num"><small>estimativa</small><strong>{formatCents(p.previsto_cents)}</strong></span>
                    <span className="pj-prof-num sinal"><small>sinal</small><strong>{formatCents(p.sinal_cents)}</strong></span>
                    <span className="pj-prof-num feito"><small>fechado</small><strong>{formatCents(p.realizado_cents)}</strong></span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <div className="card rp-como">
        <p><AlertTriangle size={15} /> <strong>É só uma estimativa.</strong> A conta soma o preço dos horários confirmados e a confirmar com o que já foi fechado. Horário a confirmar pode não virar, cliente pode faltar, e a comanda pode fechar com mais (ou menos) serviço do que foi marcado. O que é certo: o sinal já recebido pelo app e as comandas fechadas.</p>
        <p className="muted"><Info size={14} /> "Fechado" usa o valor da comanda; sem comanda, o valor do horário concluído. Faltas saem da estimativa.</p>
      </div>
    </AdminShell>
  )
}
