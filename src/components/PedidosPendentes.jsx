import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Os pedidos esperando a profissional, fixos no topo da agenda.
//
// Ficavam só numa tela separada, e um pedido com prazo correndo escondido
// atrás de dois toques é um pedido que vence. Aqui ele fica na frente, no
// primeiro lugar que ela abre, independentemente do dia que ela está
// olhando — porque o pedido é de daqui a três semanas, mas o prazo é de
// agora.

function prazo(min) {
  if (min <= 0) return 'vencendo'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}

export default function PedidosPendentes({ aoResponder }) {
  const [pedidos, setPedidos] = useState([])
  const [mexendo, setMexendo] = useState('')
  const [erro, setErro] = useState('')

  const buscar = useCallback(async () => {
    const { data, error } = await supabase.rpc('meus_pedidos')
    if (!error) setPedidos(data ?? [])
  }, [])

  useEffect(() => {
    buscar()
  }, [buscar])

  async function responder(id, aceitou) {
    setMexendo(id)
    const { error } = await supabase.rpc('responder_pedido', { appt: id, aceitou })
    if (error) setErro(error.message)
    else {
      await buscar()
      aoResponder?.()
    }
    setMexendo('')
  }

  if (pedidos.length === 0) return null

  return (
    <section className="pedidos-topo" aria-label="Pedidos esperando resposta">
      <h3 className="pedidos-titulo">
        <span className="pedidos-bolha">{pedidos.length}</span>
        {pedidos.length === 1
          ? 'cliente esperando seu sim'
          : 'clientes esperando seu sim'}
      </h3>

      {erro && <p className="erro">{erro}</p>}

      <ul className="pedido-list">
        {pedidos.map((p) => (
          <li key={p.appointment_id} className="card pedido">
            <div className="pedido-quem">
              <strong>{p.cliente}</strong>
              <span className={'pedido-prazo' + (p.faltam_min <= 30 ? ' urgente' : '')}>
                {prazo(p.faltam_min)}
              </span>
            </div>
            <p className="pedido-oque">
              {p.servico}
              <span className="muted"> · {p.quando}</span>
            </p>
            <div className="pedido-botoes">
              <button
                className="btn btn-primary"
                onClick={() => responder(p.appointment_id, true)}
                disabled={mexendo === p.appointment_id}
              >
                Aceitar
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => responder(p.appointment_id, false)}
                disabled={mexendo === p.appointment_id}
              >
                Recusar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
