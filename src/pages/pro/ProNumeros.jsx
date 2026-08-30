import { useCallback, useEffect, useState } from 'react'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import {
  formatarCents,
  formatarReaisCurto,
  formatarPct,
  formatarHoras,
  variacao,
  nomeDoMes,
  mesDeslocado,
  mesAtual,
} from '../../lib/numeros'
import { ChevronIcon } from '../../components/icons'

// O mês em números: o que a profissional hoje só tem de cabeça.
export default function ProNumeros() {
  const { professional } = useAuth()
  const [mes, setMes] = useState(mesAtual())
  const [resumo, setResumo] = useState(null)
  const [servicos, setServicos] = useState([])
  const [clientes, setClientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const profId = professional?.id

  const buscar = useCallback(async () => {
    if (!profId) return
    setLoading(true)
    const [r, s, c] = await Promise.all([
      supabase.rpc('resumo_do_mes', { prof: profId, mes }),
      supabase.rpc('faturamento_por_servico', { prof: profId, mes }),
      supabase.rpc('melhores_clientes', { prof: profId, meses: 6, limite: 5 }),
    ])
    if (r.error) setError('Erro ao carregar: ' + r.error.message)
    else {
      setResumo(Array.isArray(r.data) ? r.data[0] : r.data)
      setError('')
    }
    setServicos(s.data ?? [])
    setClientes(c.data ?? [])
    setLoading(false)
  }, [profId, mes])

  useEffect(() => {
    buscar()
  }, [buscar])

  if (!professional) return <SemFicha />

  const comparacao = resumo
    ? variacao(resumo.faturamento_cents, resumo.faturamento_mes_anterior_cents)
    : null
  const ehMesAtual = mes === mesAtual()

  return (
    <ProShell>
      <div className="page-head">
        <h2>O mês</h2>
        <p className="muted">{nomeDoMes(mes)}</p>
      </div>

      <div className="mes-nav">
        <button
          className="btn-mini btn-mini-neutro"
          onClick={() => setMes(mesDeslocado(mes, -1))}
        >
          mês anterior
        </button>
        {!ehMesAtual && (
          <button className="btn-mini btn-mini-neutro" onClick={() => setMes(mesAtual())}>
            voltar para o atual
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading || !resumo ? (
        <p className="muted">Carregando…</p>
      ) : resumo.atendimentos === 0 && resumo.faltas === 0 ? (
        <div className="card empty-state">
          <h3>Nada fechado neste mês</h3>
          <p>Os números aparecem conforme você conclui os atendimentos.</p>
        </div>
      ) : (
        <>
          <div className="card numero-heroi">
            <span className="numero-rotulo">entrou no mês</span>
            <strong className="numero-grande">
              {formatarReaisCurto(resumo.faturamento_cents)}
            </strong>
            {comparacao && (
              <span className={comparacao.subiu ? 'delta subiu' : 'delta caiu'}>
                {comparacao.texto} sobre {nomeDoMes(mesDeslocado(mes, -1)).split(' de ')[0]}
              </span>
            )}
            {ehMesAtual && (
              <span className="numero-nota">o mês ainda está correndo</span>
            )}
          </div>

          <div className="grade-numeros">
            <Cartao
              rotulo="atendimentos"
              valor={resumo.atendimentos}
              nota={`${resumo.clientes} cliente${resumo.clientes === 1 ? '' : 's'}`}
            />
            <Cartao
              rotulo="ticket médio"
              valor={formatarCents(resumo.ticket_medio_cents)}
            />
            <Cartao
              rotulo="agenda ocupada"
              valor={formatarPct(resumo.ocupacao_bps)}
              nota={`${formatarHoras(resumo.minutos_ocupados)} de ${formatarHoras(
                resumo.minutos_disponiveis,
              )}`}
            />
            <Cartao
              rotulo="não vieram"
              valor={resumo.faltas}
              nota={`${formatarPct(resumo.taxa_falta_bps)} dos horários`}
              alerta={resumo.taxa_falta_bps > 1000}
            />
            <Cartao
              rotulo="clientes novas"
              valor={resumo.clientes_novas}
              nota="primeira vez com você"
            />
            <Cartao
              rotulo="crédito abatido"
              valor={formatarCents(resumo.descontos_cents)}
              nota="indique e ganhe"
            />
          </div>

          {servicos.length > 0 && (
            <section className="secao">
              <h3 className="secao-titulo">O que mais rendeu</h3>
              <div className="barra-list">
                {servicos.map((s) => (
                  <div key={s.servico} className="barra-item">
                    <div className="barra-topo">
                      <span className="barra-nome">{s.servico}</span>
                      <span className="barra-valor">{formatarCents(s.total_cents)}</span>
                    </div>
                    <div className="barra-trilho">
                      <span
                        className="barra-preenche"
                        style={{ width: `${Math.max(2, s.fatia_bps / 100)}%` }}
                      />
                    </div>
                    <span className="barra-nota">
                      {s.quantidade}× · {formatarPct(s.fatia_bps)} do mês
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {clientes.length > 0 && (
            <section className="secao">
              <h3 className="secao-titulo">Quem mais volta</h3>
              <p className="secao-nota">últimos seis meses</p>
              <div className="cliente-list">
                {clientes.map((c) => (
                  <div key={c.client_id} className="card cliente-row">
                    <div className="cliente-info">
                      <span className="cliente-nome">
                        <span className="nome-txt">{c.nome}</span>
                      </span>
                      <span className="muted cliente-meta">
                        {c.visitas} visita{c.visitas === 1 ? '' : 's'} ·{' '}
                        {formatarCents(c.total_cents)}
                      </span>
                    </div>
                    <ChevronIcon />
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </ProShell>
  )
}

function Cartao({ rotulo, valor, nota, alerta }) {
  return (
    <div className={alerta ? 'card numero-cartao alerta' : 'card numero-cartao'}>
      <span className="numero-rotulo">{rotulo}</span>
      <strong className="numero-medio">{valor}</strong>
      {nota && <span className="numero-nota">{nota}</span>}
    </div>
  )
}
