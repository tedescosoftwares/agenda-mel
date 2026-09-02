import { useCallback, useEffect, useState } from 'react'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Os pedidos de horário que chegaram pelo WhatsApp e esperam ela.
//
// A cliente já escolheu tudo e o horário está guardado no nome dela —
// mas só vira agendamento quando esta tela (ou um "1" no WhatsApp) diz
// que sim. Por isso o tempo restante aparece em cada pedido: passado o
// prazo, o sistema resolve sozinho do jeito que ela configurou aqui
// embaixo, e ela precisa saber disso sem ter que perguntar.

function prazoLegivel(min) {
  if (min <= 0) return 'vencendo'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

export default function ProPedidos() {
  const { professional } = useAuth()
  const [pedidos, setPedidos] = useState([])
  const [cfg, setCfg] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [respondendo, setRespondendo] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(true)

  const profId = professional?.id

  const buscar = useCallback(async () => {
    if (!profId) return
    setLoading(true)
    const [lista, conf] = await Promise.all([
      supabase.rpc('meus_pedidos'),
      supabase
        .from('professionals')
        .select('aceite_manual, minutos_para_aceitar, ao_expirar')
        .eq('id', profId)
        .maybeSingle(),
    ])
    if (lista.error) setErro(lista.error.message)
    else {
      setPedidos(lista.data ?? [])
      setCfg(conf.data ?? null)
      setErro('')
    }
    setLoading(false)
  }, [profId])

  useEffect(() => {
    buscar()
  }, [buscar])

  async function responder(id, aceitou) {
    setRespondendo(id)
    const { error } = await supabase.rpc('responder_pedido', {
      appt: id,
      aceitou,
    })
    if (error) setErro(error.message)
    else await buscar()
    setRespondendo('')
  }

  async function salvar(mudanca) {
    setSalvando(true)
    const novo = { ...cfg, ...mudanca }
    setCfg(novo)
    const { error } = await supabase
      .from('professionals')
      .update(mudanca)
      .eq('id', profId)
    if (error) setErro(error.message)
    setSalvando(false)
  }

  if (!professional) return <SemFicha />

  return (
    <ProShell>
      <div className="page-head">
        <h2>Pedidos de horário</h2>
        <p className="muted">
          {pedidos.length === 0
            ? 'Nenhum pedido esperando você.'
            : pedidos.length === 1
              ? '1 pedido esperando sua resposta.'
              : `${pedidos.length} pedidos esperando sua resposta.`}
        </p>
      </div>

      {erro && <p className="erro">{erro}</p>}

      <ul className="pedido-list">
        {pedidos.map((p) => (
          <li key={p.appointment_id} className="card pedido">
            <div className="pedido-quem">
              <strong>{p.cliente}</strong>
              <span className={'pedido-prazo' + (p.faltam_min <= 15 ? ' urgente' : '')}>
                {prazoLegivel(p.faltam_min)}
              </span>
            </div>
            <p className="pedido-oque">
              {p.servico}
              <span className="muted"> · {p.quando}</span>
            </p>
            <div className="pedido-botoes">
              <button
                className="btn btn-primario"
                onClick={() => responder(p.appointment_id, true)}
                disabled={respondendo === p.appointment_id}
              >
                Aceitar
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => responder(p.appointment_id, false)}
                disabled={respondendo === p.appointment_id}
              >
                Recusar
              </button>
            </div>
          </li>
        ))}
      </ul>

      {!loading && cfg && (
        <>
          <div className="page-head" style={{ marginTop: '2rem' }}>
            <h3>Como você quer receber</h3>
          </div>

          <div className="card ajuste-bloco">
            <label className="linha-switch">
              <span>
                <strong>Pedir minha confirmação</strong>
                <span className="muted">
                  Desligado, o horário já entra marcado direto na agenda.
                </span>
              </span>
              <input
                type="checkbox"
                checked={cfg.aceite_manual}
                onChange={(e) => salvar({ aceite_manual: e.target.checked })}
                disabled={salvando}
              />
            </label>

            {cfg.aceite_manual && (
              <>
                <label className="linha-campo">
                  <span>
                    <strong>Tempo para responder</strong>
                    <span className="muted">
                      Depois disso o sistema resolve sozinho.
                    </span>
                  </span>
                  <select
                    value={cfg.minutos_para_aceitar}
                    onChange={(e) =>
                      salvar({ minutos_para_aceitar: Number(e.target.value) })
                    }
                    disabled={salvando}
                  >
                    <option value={15}>15 minutos</option>
                    <option value={30}>30 minutos</option>
                    <option value={60}>1 hora</option>
                    <option value={120}>2 horas</option>
                    <option value={360}>6 horas</option>
                    <option value={1440}>1 dia</option>
                  </select>
                </label>

                <label className="linha-campo">
                  <span>
                    <strong>Se eu não responder</strong>
                    <span className="muted">
                      {cfg.ao_expirar === 'confirma'
                        ? 'O horário entra na agenda e a cliente é avisada.'
                        : 'O pedido é recusado e a vaga volta a ficar livre.'}
                    </span>
                  </span>
                  <select
                    value={cfg.ao_expirar}
                    onChange={(e) => salvar({ ao_expirar: e.target.value })}
                    disabled={salvando}
                  >
                    <option value="confirma">Aceitar</option>
                    <option value="cancela">Recusar</option>
                  </select>
                </label>
              </>
            )}
          </div>
        </>
      )}
    </ProShell>
  )
}
