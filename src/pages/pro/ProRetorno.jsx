import { useCallback, useEffect, useState } from 'react'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { diasEmTexto } from '../../lib/numeros'
import { formatDataCurta } from '../../lib/booking'

// Quem passou do tempo de voltar e não tem nada marcado.
// A pergunta que ninguém responde de cabeça.
export default function ProRetorno() {
  const { professional } = useAuth()
  const [lista, setLista] = useState([])
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [chamando, setChamando] = useState(null)
  const [abrirAjustes, setAbrirAjustes] = useState(false)

  const profId = professional?.id

  const buscar = useCallback(async () => {
    if (!profId) return
    const [l, c] = await Promise.all([
      supabase.rpc('clientes_para_retorno', { prof: profId }),
      supabase.rpc('config_retorno', { prof: profId }),
    ])
    if (l.error) setErro('Erro ao carregar: ' + l.error.message)
    else {
      setLista(l.data ?? [])
      setErro('')
    }
    setConfig(Array.isArray(c.data) ? c.data[0] : c.data)
    setLoading(false)
  }, [profId])

  useEffect(() => {
    buscar()
  }, [buscar])

  if (!professional) return <SemFicha />

  async function chamar(cliente) {
    setChamando(cliente.client_id)
    setErro('')
    const { error } = await supabase.rpc('chamar_de_volta', {
      cliente: cliente.client_id,
      prof: profId,
    })
    setChamando(null)
    if (error) {
      setErro(error.message)
      return
    }
    setAviso(`${primeiroNome(cliente.nome)} recebeu o convite.`)
    buscar()
  }

  async function chamarTodas() {
    const quantas = lista.filter((c) => c.pode_chamar).length
    if (!quantas) return
    const ok = window.confirm(
      `Enviar o convite de volta para ${quantas} cliente${quantas === 1 ? '' : 's'}?`,
    )
    if (!ok) return
    setChamando('todas')
    const { data, error } = await supabase.rpc('chamar_todas_de_volta', { prof: profId })
    setChamando(null)
    if (error) {
      setErro(error.message)
      return
    }
    setAviso(`${data} convite${data === 1 ? '' : 's'} enviado${data === 1 ? '' : 's'}.`)
    buscar()
  }

  async function salvarConfig(campo, valor) {
    const { error } = await supabase
      .from('professionals')
      .update({ [campo]: valor })
      .eq('id', profId)
    if (error) setErro('Erro ao salvar: ' + error.message)
    else setConfig((c) => ({ ...c, [campo]: valor }))
  }

  const chamaveis = lista.filter((c) => c.pode_chamar).length

  return (
    <ProShell>
      <div className="page-head">
        <h2>Volta pra cá</h2>
        <p className="muted">
          Quem já passou do tempo de voltar e não tem horário marcado
        </p>
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}
      {aviso && <div className="alert alert-info">{aviso}</div>}

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : lista.length === 0 ? (
        <div className="card empty-state">
          <h3>Ninguém sumiu</h3>
          <p>
            Todas as suas clientes voltaram dentro do tempo, ou já têm horário
            marcado. Quando alguém atrasar, ela aparece aqui.
          </p>
        </div>
      ) : (
        <>
          {chamaveis > 1 && (
            <button
              className="btn btn-primary btn-largo"
              onClick={chamarTodas}
              disabled={chamando === 'todas'}
            >
              {chamando === 'todas'
                ? 'Enviando…'
                : `Chamar as ${chamaveis} de volta`}
            </button>
          )}

          <div className="cliente-list retorno-list">
            {lista.map((c) => (
              <div key={c.client_id} className="card retorno-row">
                <div className="cliente-info">
                  <span className="cliente-nome">
                    <span className="nome-txt">{c.nome}</span>
                  </span>
                  <span className="muted cliente-meta">
                    {c.servico ?? 'atendimento'} · {diasEmTexto(c.dias_sem_vir)} ·{' '}
                    {c.total_visitas} visita{c.total_visitas === 1 ? '' : 's'}
                  </span>
                  <span className="retorno-prazo">
                    devia ter voltado em {formatDataCurta(c.voltaria_em)}
                  </span>
                </div>
                {c.pode_chamar ? (
                  <button
                    className="btn-mini btn-mini-neutro"
                    onClick={() => chamar(c)}
                    disabled={chamando === c.client_id}
                  >
                    {chamando === c.client_id ? '…' : 'chamar'}
                  </button>
                ) : (
                  <span className="badge badge-espera">já chamada</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <section className="secao">
        <button
          type="button"
          className="secao-toggle"
          onClick={() => setAbrirAjustes((v) => !v)}
        >
          <h3 className="secao-titulo">Avisos automáticos</h3>
          <span className="secao-seta">{abrirAjustes ? '−' : '+'}</span>
        </button>

        {abrirAjustes && config && (
          <div className="card form ajustes-retorno">
            <label className="linha-ajuste">
              <span>
                <strong>Lembrete de véspera</strong>
                <span className="muted">
                  Aviso no app antes do horário. 0 desliga.
                </span>
              </span>
              <input
                type="number"
                min={0}
                max={168}
                value={config.reminder_hours_before}
                onChange={(e) =>
                  salvarConfig('reminder_hours_before', Number(e.target.value))
                }
              />
            </label>

            <label className="linha-ajuste">
              <span>
                <strong>Obrigada pela visita</strong>
                <span className="muted">
                  Ao concluir, avisa a cliente e sugere quando voltar.
                </span>
              </span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={config.followup_active}
                  onChange={(e) => salvarConfig('followup_active', e.target.checked)}
                />
                <span></span>
              </span>
            </label>

            <label className="linha-ajuste">
              <span>
                <strong>Sumiu depois de (dias)</strong>
                <span className="muted">
                  Vale quando o serviço não tem tempo de retorno próprio.
                </span>
              </span>
              <input
                type="number"
                min={7}
                max={365}
                value={config.winback_after_days}
                onChange={(e) =>
                  salvarConfig('winback_after_days', Number(e.target.value))
                }
              />
            </label>

            <label className="linha-ajuste">
              <span>
                <strong>Descanso entre chamadas (dias)</strong>
                <span className="muted">
                  A mesma cliente não é chamada duas vezes nesse intervalo.
                </span>
              </span>
              <input
                type="number"
                min={7}
                max={365}
                value={config.winback_cooldown_days}
                onChange={(e) =>
                  salvarConfig('winback_cooldown_days', Number(e.target.value))
                }
              />
            </label>

            <p className="muted nota-rodape">
              A cliente também manda: quem desliga os avisos no perfil não é
              chamada, nem aqui nem no automático.
            </p>
          </div>
        )}
      </section>
    </ProShell>
  )
}

function primeiroNome(nome) {
  return String(nome || 'A cliente').split(' ')[0]
}
