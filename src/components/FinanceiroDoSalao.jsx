import { useCallback, useEffect, useState } from 'react'
import { TriangleAlert, Wallet, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { chamar, formatCents } from '../lib/pagamento'
import { formatarReaisCurto, nomeDoMes, mesDeslocado, mesAtual, variacao } from '../lib/numeros'
import GraficoLinha from './GraficoLinha'

// O financeiro do que passa pelo app (094): o mês em números, o que ainda
// vai acontecer (devoluções, créditos, o resto no atendimento), quem
// trouxe o quê e cada movimento. Vale para o salão e para a autônoma.
const ROTULO = { aguardando: 'aguardando PIX', pago: 'pago', expirado: 'expirou', cancelado: 'cancelado', estorno_pendente: 'devolvendo', estornado: 'devolvido', retido: 'ficou com você', falhou: 'falhou', credito: 'crédito' }
const FILTROS = [['tudo', 'Tudo'], ['pago', 'Pagos'], ['devolucao', 'Devoluções'], ['credito', 'Créditos'], ['retido', 'Retidos']]

export default function FinanceiroDoSalao({ salao, aoMexer }) {
  const [mes, setMes] = useState(mesAtual())
  const [f, setF] = useState(null)
  const [erro, setErro] = useState('')
  const [filtro, setFiltro] = useState('tudo')
  const [mexendo, setMexendo] = useState(false)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('financeiro_do_salao', { salao, mes })
    if (error) setErro(error.message); else { setF(data ?? null); setErro('') }
  }, [salao, mes])
  useEffect(() => { carregar() }, [carregar])

  async function devolverAgora(pagamentoId) {
    setMexendo(true); setErro('')
    try {
      const r = await chamar('conta-recebimento', { acao: 'devolver', salao, pagamento_id: pagamentoId })
      if (r?.ok === false) setErro('A devolução não saiu: ' + r.erro)
      await carregar(); aoMexer?.()
    } catch (e) { setErro(e.message) } finally { setMexendo(false) }
  }

  if (erro && !f) return <div className="alert alert-error">{erro}</div>
  if (!f) return <p className="muted">Carregando…</p>

  const var_ = variacao(f.recebido_cents, f.recebido_anterior_cents)
  const pontos = (f.por_dia ?? []).map((d) => ({ x: d.dia.slice(8, 10), y: d.recebido_cents / 100 }))
  const movimentos = (f.movimentos ?? []).filter((m) => {
    if (filtro === 'tudo') return true
    if (filtro === 'pago') return m.status === 'pago'
    if (filtro === 'devolucao') return m.status === 'estorno_pendente' || m.status === 'estornado'
    return m.status === filtro
  })
  const custo = (f.taxas_cents ?? 0) + (f.mimo_cents ?? 0)

  return (
    <>
      <div className="mes-nav">
        <button className="btn-mini btn-mini-neutro" onClick={() => setMes(mesDeslocado(mes, -1))}>mês anterior</button>
        <span className="muted fin-mes">{capitalizar(nomeDoMes(mes))}</span>
        {mes !== mesAtual() ? <button className="btn-mini btn-mini-neutro" onClick={() => setMes(mesDeslocado(mes, 1))}>mês seguinte</button> : <button className="btn-mini btn-mini-neutro" onClick={carregar}><RefreshCw size={12} /></button>}
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}

      {f.devolucoes_paradas > 0 && (
        <div className="card fin-alerta">
          <TriangleAlert size={18} />
          <span><strong>{f.devolucoes_paradas === 1 ? '1 devolução parada' : `${f.devolucoes_paradas} devoluções paradas`} por falta de saldo.</strong> Deposite na chave Pix da conta de recebimento (aba Conta) e toque em "Tentar devolver agora" na lista abaixo.</span>
        </div>
      )}

      <div className="card numero-heroi">
        <span className="numero-rotulo">recebido pelo app</span>
        <strong className="numero-grande">{formatarReaisCurto(f.recebido_cents)}</strong>
        <span className="numero-nota">
          {f.pagamentos} {f.pagamentos === 1 ? 'pagamento' : 'pagamentos'}{f.clientes > 0 && ` · ${f.clientes} ${f.clientes === 1 ? 'cliente' : 'clientes'}`}
          {var_ && <span className={'kpi-nota ' + (var_.subiu ? 'mais' : 'menos')}> · {var_.texto} vs. mês anterior</span>}
        </span>
      </div>

      <div className="kpis">
        <div className="card kpi"><span className="muted">Líquido para você</span><strong>{formatarReaisCurto(f.liquido_cents)}</strong><span className="kpi-nota">depois de {formatCents(custo)} de taxas{f.mimo_cents > 0 ? ' e MIMO' : ''}</span></div>
        <div className="card kpi"><span className="muted">Falta receber no atendimento</span><strong>{formatarReaisCurto(f.a_receber_cents)}</strong><span className="kpi-nota">o resto dos sinais pagos</span></div>
        <div className="card kpi"><span className="muted">Devolvido</span><strong>{formatarReaisCurto(f.devolvido_cents)}</strong><span className="kpi-nota">{f.a_devolver_cents > 0 ? `${formatCents(f.a_devolver_cents)} ainda a devolver` : 'cancelamentos no prazo'}</span></div>
        <div className="card kpi"><span className="muted">Ficou com você</span><strong>{formatarReaisCurto(f.retido_cents)}</strong><span className="kpi-nota">sinais retidos e créditos vencidos</span></div>
        <div className="card kpi"><span className="muted">Créditos em aberto</span><strong>{formatarReaisCurto(f.creditos_cents)}</strong><span className="kpi-nota">{f.creditos > 0 ? `${f.creditos} ${f.creditos === 1 ? 'cliente vai remarcar' : 'clientes vão remarcar'}` : 'ninguém com crédito parado'}</span></div>
        <div className="card kpi"><span className="muted">Saldo na conta</span><strong>{f.saldo_cents != null ? formatarReaisCurto(f.saldo_cents) : '—'}</strong><span className="kpi-nota">{f.saldo_em ? `lido ${new Date(f.saldo_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'toque em Atualizar na aba Conta'}</span></div>
      </div>

      {pontos.length > 1 && (
        <div className="card fin-grafico">
          <span className="numero-rotulo">por dia</span>
          <GraficoLinha pontos={pontos} altura={130} />
        </div>
      )}

      {(f.por_profissional ?? []).length > 1 && (
        <section className="secao">
          <h3 className="secao-titulo">Por profissional</h3>
          <div className="barra-list">
            {f.por_profissional.map((l) => {
              const maior = Math.max(1, ...f.por_profissional.map((x) => Number(x.recebido_cents)))
              return (
                <div key={l.id} className="barra-item">
                  <div className="barra-topo"><span className="barra-nome">{l.nome}</span><span className="barra-valor">{formatCents(l.recebido_cents)}</span></div>
                  <div className="barra-trilho"><span className="barra-preenche" style={{ width: `${Math.max(2, (Number(l.recebido_cents) * 100) / maior)}%` }} /></div>
                  <span className="muted barra-nota">{l.quantos} {l.quantos === 1 ? 'pagamento' : 'pagamentos'} · líquido {formatCents(l.liquido_cents)}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="secao">
        <h3 className="secao-titulo">Movimentos</h3>
        <div className="chips fin-filtros">
          {FILTROS.map(([k, r]) => <button key={k} type="button" className={'chip' + (filtro === k ? ' active' : '')} onClick={() => setFiltro(k)}>{r}</button>)}
        </div>
        {movimentos.length === 0 ? (
          <div className="card empty-state"><p className="muted">{f.movimentos?.length ? 'Nada com esse filtro neste mês.' : 'Nenhum movimento neste mês. Quando uma cliente pagar pelo app, aparece aqui.'}</p></div>
        ) : (
          <div className="cliente-list">
            {movimentos.map((m) => (
              <div key={m.id} className="card pag-linha">
                <div className="pag-info">
                  <strong>{m.cliente}</strong>
                  <span className="muted">{m.servico ?? 'Atendimento'}{m.profissional ? ` · ${m.profissional}` : ''}</span>
                  <span className="muted">{m.dia ? new Date(m.dia + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''} {m.hora?.slice(0, 5)}{m.sinal_pct && m.sinal_pct < 100 ? ` · sinal de ${m.sinal_pct}%` : ''}</span>
                </div>
                <div className="pag-valor">
                  <strong>{formatCents(m.valor_cents)}</strong>
                  <span className={`badge badge-pag-${m.status}`}>{m.status === 'estorno_pendente' && m.tentativas_estorno >= 2 ? 'devolução parada' : ROTULO[m.status] ?? m.status}</span>
                  {m.status === 'pago' && m.liquido_cents != null && m.liquido_cents !== m.valor_cents && <span className="muted pag-erro">líquido {formatCents(m.liquido_cents - (m.mimo_cents ?? 0))}</span>}
                  {(m.status === 'estorno_pendente' || m.status === 'estornado') && m.estorno_cents != null && m.estorno_cents !== m.valor_cents && <span className="muted pag-erro">devolve {formatCents(m.estorno_cents)}</span>}
                  {m.status === 'credito' && m.credito_ate && <span className="muted pag-erro">vale até {new Date(m.credito_ate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>}
                  {m.status === 'estorno_pendente' && m.erro && <span className="muted pag-erro">{m.erro.includes('aldo') ? 'falta saldo na conta' : m.erro}</span>}
                  {m.status === 'estorno_pendente' && m.tentativas_estorno > 0 && m.proxima_tentativa_em && <span className="muted pag-erro">tenta de novo {new Date(m.proxima_tentativa_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
                  {m.status === 'estorno_pendente' && <button type="button" className="btn-mini" onClick={() => devolverAgora(m.id)} disabled={mexendo}>Tentar devolver agora</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="muted fin-rodape"><Wallet size={13} /> O dinheiro fica na sua conta de recebimento, em seu nome. O saque para o banco por aqui está a caminho; até lá, peça pelo suporte do MIMO.</p>
    </>
  )
}

const capitalizar = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '')
