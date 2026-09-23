import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Info, TrendingUp, TrendingDown, Smartphone, AlertTriangle, Users, Clock3 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatCents } from '../lib/pagamento'

// Projeção da semana (aba do PDV): uma ESTIMATIVA. Soma o que está marcado
// (confirmado e pendente) com o que já foi feito, e separa o que já entrou
// no caixa (sinal pelo app, comandas fechadas) do que ainda depende de a
// cliente vir. Reparte pela cota (contrato, ou o padrão da casa), mede a
// ocupação da agenda e mostra as últimas semanas pra comparar.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const somar = (isoD, n) => { const d = new Date(isoD + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d) }
const inicioDaSemana = () => { const h = new Date(); h.setDate(h.getDate() - ((h.getDay() + 6) % 7)); return iso(h) }
const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
const dataCurta = (d) => new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0)
const horas = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}` : `${min}min`)

export default function ProjecaoSemana({ salaoId, profs = [] }) {
  const [inicio, setInicio] = useState(inicioDaSemana)
  const [prof, setProf] = useState('')
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [tabela, setTabela] = useState(false)

  const carregar = useCallback(async () => {
    if (!salaoId) return
    const { data, error } = await supabase.rpc('projecao_semanal', { salao: salaoId, inicio, prof: prof || null })
    if (error) { setErro(error.message); return }
    setErro(''); setDados(data)
  }, [salaoId, inicio, prof])
  useEffect(() => { carregar() }, [carregar])

  const t = dados?.total
  const hoje = dados?.hoje
  const semanaAtual = hoje && hoje >= dados.inicio && hoje <= dados.fim
  const passada = dados?.semana_passada
  const delta = passada?.realizado_cents ? Math.round(((t?.previsto_cents ?? 0) - passada.realizado_cents) / passada.realizado_cents * 100) : null
  const aVir = t ? Math.max(0, t.confirmado_cents + t.pendente_cents - t.sinal_cents) : 0
  const noCaixa = t ? t.realizado_cents + t.sinal_cents : 0
  const ocup = t ? pct(t.minutos_marcados, t.minutos_abertos) : 0
  const maxDia = useMemo(() => Math.max(1, ...(dados?.dias ?? []).map((d) => d.previsto_cents)), [dados])
  const maxSem = useMemo(() => Math.max(1, ...(dados?.semanas ?? []).map((s) => Math.max(s.previsto_cents, s.realizado_cents))), [dados])
  const diaMaior = useMemo(() => (dados?.dias ?? []).reduce((m, d) => (d.previsto_cents > (m?.previsto_cents ?? 0) ? d : m), null), [dados])
  const profNome = prof ? profs.find((p) => p.id === prof)?.name?.split(' ')[0] : null

  return (
    <div className="pdv-projecao">
      <div className="pdv-projecao-topo">
        <h3>Projeção da semana</h3>
        <p className="muted">Uma estimativa a partir do que está marcado. Não é faturamento.</p>
      </div>

      <div className="pj-filtros">
        <div className="pj-nav">
          <button type="button" className="quadro-nav-btn" onClick={() => setInicio((x) => somar(x, -7))} aria-label="Semana anterior"><ChevronLeft size={18} /></button>
          <strong>{dados ? `${dataCurta(dados.inicio)} a ${dataCurta(dados.fim)}` : '…'}{semanaAtual ? ' · esta semana' : hoje && dados?.fim < hoje ? ' · já passou' : dados && hoje && dados.inicio > hoje ? ' · ainda vem' : ''}</strong>
          <button type="button" className="quadro-nav-btn" onClick={() => setInicio((x) => somar(x, 7))} aria-label="Semana seguinte"><ChevronRight size={18} /></button>
          {!semanaAtual && dados && <button type="button" className="btn-mini btn-mini-neutro" onClick={() => setInicio(inicioDaSemana())}>esta semana</button>}
        </div>
        {profs.length > 1 && (
          <div className="chips pj-profs-chips">
            <button type="button" className={'chip' + (!prof ? ' active' : '')} onClick={() => setProf('')}>Todas</button>
            {profs.map((p) => <button key={p.id} type="button" className={'chip' + (prof === p.id ? ' active' : '')} onClick={() => setProf(p.id)}>{p.name.split(' ')[0]}</button>)}
          </div>
        )}
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}
      {!dados && !erro && <p className="muted">Somando…</p>}

      {t && (
        <>
          <div className="pj-grade">
            <div className="card pj-hero">
              <span className="pj-rotulo"><TrendingUp size={14} /> Estimativa da semana{profNome ? ` · ${profNome}` : ''}</span>
              <strong className="pj-hero-num">{formatCents(t.previsto_cents)}</strong>
              <span className="pj-hero-delta">
                {delta != null ? <em className={delta >= 0 ? 'sobe' : 'desce'}>{delta >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />} {delta >= 0 ? '+' : ''}{delta}% sobre a semana passada</em> : <em className="muted">sem semana passada pra comparar</em>}
              </span>
              <span className="muted pj-hero-linha">{t.horarios} {t.horarios === 1 ? 'horário' : 'horários'} · {t.confirmados} confirmados · {t.pendentes} a confirmar · {t.concluidos} feitos{t.faltas ? ` · ${t.faltas} ${t.faltas === 1 ? 'falta' : 'faltas'}` : ''}</span>
              <div className="pj-barra" aria-hidden="true">
                <span className="feito" style={{ width: `${pct(t.realizado_cents, t.previsto_cents)}%` }} />
                <span className="sinal" style={{ width: `${pct(t.sinal_cents, t.previsto_cents)}%` }} />
              </div>
              <span className="muted pj-legenda">{pct(noCaixa, t.previsto_cents)}% já está no caixa (fechado + sinal). {t.perdido_cents > 0 ? `Faltas tiraram ${formatCents(t.perdido_cents)}.` : ''}</span>
            </div>

            <div className="pj-tiles">
              <div className="pj-tile feito"><span>Já fechado no caixa</span><strong>{formatCents(t.realizado_cents)}</strong><small className="muted">{t.concluidos} {t.concluidos === 1 ? 'atendimento' : 'atendimentos'}</small></div>
              <div className="pj-tile sinal"><span><Smartphone size={12} /> Sinal recebido pelo app</span><strong>{formatCents(t.sinal_cents)}</strong><small className="muted">dos horários que ainda vêm</small></div>
              <div className="pj-tile a-vir"><span>Depende de a cliente vir</span><strong>{formatCents(aVir)}</strong><small className="muted">{formatCents(t.confirmado_cents)} confirmados + {formatCents(t.pendente_cents)} a confirmar, menos o sinal</small></div>
              <div className="pj-tile"><span><Clock3 size={12} /> Ocupação da agenda</span><strong>{ocup}%</strong><small className="muted">{horas(t.minutos_marcados)} marcadas de {horas(t.minutos_abertos)} abertas</small><span className="pj-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, ocup)}%` }} /></span></div>
              <div className="pj-tile"><span>Ticket médio</span><strong>{formatCents(t.ticket_medio_cents)}</strong><small className="muted">por horário</small></div>
              <div className="pj-tile casa"><span><Users size={12} /> Casa e equipe</span><strong>{formatCents(t.casa_cents)} <small>casa</small></strong><small className="muted">{formatCents(t.equipe_cents)} para a equipe, pela cota{dados.padrao ? ` (padrão ${Number(dados.padrao.cota_pct)}%)` : ''}</small></div>
            </div>
          </div>

          <div className="card pj-chart-card">
            <div className="pj-chart-topo">
              <strong>Por dia</strong>
              <span className="pj-legenda-cores"><i className="feito" /> fechado <i className="sinal" /> sinal no app <i className="a-vir" /> a vir</span>
              <button type="button" className="btn-mini btn-mini-neutro" onClick={() => setTabela((x) => !x)}>{tabela ? 'ver barras' : 'ver tabela'}</button>
            </div>
            {!tabela ? (
              <div className="pj-chart" role="img" aria-label="Estimativa por dia da semana, empilhando fechado, sinal e a vir">
                {(dados.dias ?? []).map((d, i) => {
                  const ehHoje = d.dia === hoje; const passado = hoje && d.dia < hoje
                  const avir = Math.max(0, d.confirmado_cents + d.pendente_cents - d.sinal_cents)
                  const h = (v) => `${(v / maxDia) * 100}%`
                  const rotulo = ehHoje || (diaMaior && diaMaior.dia === d.dia)
                  return (
                    <div key={d.dia} className={'pj-col' + (ehHoje ? ' hoje' : '') + (passado ? ' passado' : '')}>
                      <div className="pj-col-area">
                        {rotulo && d.previsto_cents > 0 && <span className="pj-col-valor">{formatCents(d.previsto_cents)}</span>}
                        <div className="pj-col-pilha" style={{ height: h(d.previsto_cents) }}>
                          {avir > 0 && <span className="a-vir" style={{ flex: avir }} />}
                          {d.sinal_cents > 0 && <span className="sinal" style={{ flex: d.sinal_cents }} />}
                          {d.realizado_cents > 0 && <span className="feito" style={{ flex: d.realizado_cents }} />}
                        </div>
                        <div className="pj-tip" role="tooltip">
                          <strong>{DIAS[i]} {dataCurta(d.dia)} · {formatCents(d.previsto_cents)}</strong>
                          <span>{d.horarios} {d.horarios === 1 ? 'horário' : 'horários'}{d.pendentes ? ` (${d.pendentes} a confirmar)` : ''}{d.faltas ? ` · ${d.faltas} ${d.faltas === 1 ? 'falta' : 'faltas'}` : ''}</span>
                          <span>fechado {formatCents(d.realizado_cents)} · sinal {formatCents(d.sinal_cents)} · a vir {formatCents(avir)}</span>
                          <span>ocupação {pct(d.minutos_marcados, d.minutos_abertos)}%</span>
                        </div>
                      </div>
                      <span className="pj-col-dia"><b>{DIAS[i]}</b><small>{String(d.dia).slice(8, 10)}</small></span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <table className="pj-tabela">
                <thead><tr><th>Dia</th><th className="n">Horários</th><th className="n">Ocupação</th><th className="n">Confirmados</th><th className="n">A confirmar</th><th className="n">Estimativa</th><th className="n">Sinal no app</th><th className="n">Fechado</th></tr></thead>
                <tbody>
                  {(dados.dias ?? []).map((d, i) => (
                    <tr key={d.dia} className={(d.dia === hoje ? 'hoje' : '') + (hoje && d.dia < hoje ? ' passado' : '')}>
                      <td><strong>{DIAS[i]}</strong> <span className="muted">{dataCurta(d.dia)}</span>{d.dia === hoje && <em className="pj-hoje">hoje</em>}</td>
                      <td className="n">{d.horarios}{d.faltas > 0 ? <span className="muted"> · {d.faltas} {d.faltas === 1 ? 'falta' : 'faltas'}</span> : ''}</td>
                      <td className="n">{d.minutos_abertos ? `${pct(d.minutos_marcados, d.minutos_abertos)}%` : <span className="muted">fechado</span>}</td>
                      <td className="n">{formatCents(d.confirmado_cents)}</td>
                      <td className="n muted">{d.pendente_cents ? formatCents(d.pendente_cents) : ''}</td>
                      <td className="n"><strong>{formatCents(d.previsto_cents)}</strong></td>
                      <td className="n sinal">{d.sinal_cents ? formatCents(d.sinal_cents) : ''}</td>
                      <td className="n feito">{d.realizado_cents ? formatCents(d.realizado_cents) : ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td>Semana</td><td className="n">{t.horarios}</td><td className="n">{ocup}%</td><td className="n">{formatCents(t.confirmado_cents)}</td><td className="n muted">{formatCents(t.pendente_cents)}</td><td className="n"><strong>{formatCents(t.previsto_cents)}</strong></td><td className="n sinal">{formatCents(t.sinal_cents)}</td><td className="n feito">{formatCents(t.realizado_cents)}</td></tr></tfoot>
              </table>
            )}
          </div>

          <div className="pj-duas">
            <div className="card pj-chart-card">
              <div className="pj-chart-topo"><strong>Últimas semanas</strong><span className="pj-legenda-cores"><i className="feito" /> fechou <i className="estimativa" /> estimativa</span></div>
              <div className="pj-chart pj-chart-semanas" role="img" aria-label="Fechado nas últimas semanas e a estimativa desta">
                {(dados.semanas ?? []).map((s) => {
                  const atual = s.inicio === dados.inicio; const futura = hoje && s.inicio > hoje
                  const mostra = atual || futura ? s.previsto_cents : s.realizado_cents
                  return (
                    <div key={s.inicio} className={'pj-col' + (atual ? ' hoje' : '')}>
                      <div className="pj-col-area">
                        {atual && mostra > 0 && <span className="pj-col-valor">{formatCents(mostra)}</span>}
                        <div className={'pj-col-uma ' + (atual || futura ? 'estimativa' : 'feito')} style={{ height: `${(mostra / maxSem) * 100}%` }} />
                        <div className="pj-tip" role="tooltip"><strong>{dataCurta(s.inicio)} a {dataCurta(somar(s.inicio, 6))}</strong><span>{atual || futura ? 'estimativa' : 'fechou em'} {formatCents(mostra)} · {s.horarios} horários</span>{!atual && !futura && s.previsto_cents !== s.realizado_cents ? <span>estava estimado em {formatCents(s.previsto_cents)}</span> : null}</div>
                      </div>
                      <span className="pj-col-dia"><b>{String(s.inicio).slice(8, 10)}/{String(s.inicio).slice(5, 7)}</b></span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="card pj-profs-card">
              <div className="pj-chart-topo"><strong>Por profissional</strong><span className="muted">cota do contrato ou padrão da casa</span></div>
              <div className="pj-profs">
                {(dados.por_profissional ?? []).map((p) => (
                  <div key={p.professional_id ?? 'sem'} className="pj-prof">
                    <span className="rp-avatar">{(p.nome ?? '?').charAt(0)}</span>
                    <span className="pj-prof-texto"><strong>{p.nome}</strong><span className="muted">{p.horarios} {p.horarios === 1 ? 'horário' : 'horários'}{p.pendentes ? ` · ${p.pendentes} a confirmar` : ''} · ocupação {pct(p.minutos_marcados, p.minutos_abertos)}% · cota {Number(p.cota_pct)}%{p.contrato ? '' : ' (padrão)'}</span></span>
                    <span className="pj-prof-num"><small>estimativa</small><strong>{formatCents(p.previsto_cents)}</strong></span>
                    <span className="pj-prof-num equipe"><small>para ela</small><strong>{formatCents(p.equipe_cents)}</strong></span>
                    <span className="pj-prof-num"><small>para a casa</small><strong>{formatCents(p.casa_cents)}</strong></span>
                    <span className="pj-prof-num sinal"><small>sinal</small><strong>{formatCents(p.sinal_cents)}</strong></span>
                    <span className="pj-prof-num feito"><small>fechado</small><strong>{formatCents(p.realizado_cents)}</strong></span>
                  </div>
                ))}
                {(dados.por_profissional ?? []).length === 0 && <p className="muted">Nenhum horário nesta semana.</p>}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="card rp-como">
        <p><AlertTriangle size={15} /> <strong>É só uma estimativa.</strong> Soma o preço dos horários confirmados e a confirmar com o que já foi fechado. Horário a confirmar pode não virar, cliente pode faltar, e a comanda pode fechar com mais (ou menos) serviço do que foi marcado. Certo mesmo: o sinal já recebido pelo app e as comandas fechadas.</p>
        <p className="muted"><Info size={14} /> "Fechado" usa a comanda; sem comanda, o valor do horário concluído. Faltas saem. A parte da equipe usa a cota do contrato vigente, ou a cota padrão da casa; a ocupação compara as horas marcadas com o expediente de cada profissional.</p>
      </div>
    </div>
  )
}
