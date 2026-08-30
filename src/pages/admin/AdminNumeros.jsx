import { useCallback, useEffect, useState } from 'react'
import AdminShell from '../../components/AdminShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  formatarCents,
  formatarReaisCurto,
  formatarPct,
  nomeDoMes,
  mesDeslocado,
  mesAtual,
} from '../../lib/numeros'

// O mês do salão inteiro, uma linha por profissional.
export default function AdminNumeros() {
  const { salao } = useAuth()
  const [mes, setMes] = useState(mesAtual())
  const [linhas, setLinhas] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  const salaoId = salao?.id

  const buscar = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('resumo_do_salao', {
      salao: salaoId ?? null,
      mes,
    })
    if (error) setErro('Erro ao carregar: ' + error.message)
    else {
      setLinhas(data ?? [])
      setErro('')
    }
    setLoading(false)
  }, [salaoId, mes])

  useEffect(() => {
    buscar()
  }, [buscar])

  const total = linhas.reduce((s, l) => s + Number(l.faturamento_cents ?? 0), 0)
  const atendimentos = linhas.reduce((s, l) => s + Number(l.atendimentos ?? 0), 0)
  const faltas = linhas.reduce((s, l) => s + Number(l.faltas ?? 0), 0)
  const maior = Math.max(1, ...linhas.map((l) => Number(l.faturamento_cents ?? 0)))

  return (
    <AdminShell>
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
        {mes !== mesAtual() && (
          <button className="btn-mini btn-mini-neutro" onClick={() => setMes(mesAtual())}>
            voltar para o atual
          </button>
        )}
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : atendimentos === 0 ? (
        <div className="card empty-state">
          <h3>Nada fechado neste mês</h3>
          <p>Os números aparecem conforme a equipe conclui os atendimentos.</p>
        </div>
      ) : (
        <>
          <div className="card numero-heroi">
            <span className="numero-rotulo">entrou no salão</span>
            <strong className="numero-grande">{formatarReaisCurto(total)}</strong>
            <span className="numero-nota">
              {atendimentos} atendimento{atendimentos === 1 ? '' : 's'}
              {faltas > 0 && ` · ${faltas} não vieram`}
            </span>
          </div>

          <section className="secao">
            <h3 className="secao-titulo">Por profissional</h3>
            <div className="barra-list">
              {linhas.map((l) => (
                <div key={l.professional_id} className="barra-item">
                  <div className="barra-topo">
                    <span className="barra-nome">{l.nome}</span>
                    <span className="barra-valor">
                      {formatarCents(l.faturamento_cents)}
                    </span>
                  </div>
                  <div className="barra-trilho">
                    <span
                      className="barra-preenche"
                      style={{
                        width: `${Math.max(2, (Number(l.faturamento_cents) * 100) / maior)}%`,
                      }}
                    />
                  </div>
                  <span className="barra-nota">
                    {l.atendimentos}× · agenda {formatarPct(l.ocupacao_bps)} ocupada
                    {l.faltas > 0 && ` · ${l.faltas} faltas`}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </AdminShell>
  )
}
