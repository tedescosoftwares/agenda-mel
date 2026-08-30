import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDataCurta } from '../lib/booking'

// Quem está esperando vaga com esta profissional
export default function FilaEspera({ professionalId }) {
  const [fila, setFila] = useState([])
  const [aberta, setAberta] = useState(false)

  useEffect(() => {
    if (!professionalId) return
    supabase
      .from('waitlist_entries')
      .select('*, services (name), profiles (full_name, phone)')
      .eq('professional_id', professionalId)
      .eq('status', 'aguardando')
      .order('created_at')
      .then(({ data }) => setFila(data ?? []))
  }, [professionalId])

  if (fila.length === 0) return null

  return (
    <div className="card fila-painel">
      <button className="fila-cabecalho" onClick={() => setAberta((v) => !v)}>
        <span>
          <strong>{fila.length}</strong>{' '}
          {fila.length === 1 ? 'cliente esperando vaga' : 'clientes esperando vaga'}
        </span>
        <span className="muted">{aberta ? 'fechar' : 'ver'}</span>
      </button>

      {aberta && (
        <div className="fila-itens">
          {fila.map((f) => (
            <div key={f.id} className="fila-item">
              <span className="cliente-nome"><span className="nome-txt">{f.profiles?.full_name || 'Cliente'}</span></span>
              <span className="muted cliente-meta">
                {f.services?.name} · {f.window_start.slice(0, 5)}–
                {f.window_end.slice(0, 5)} · até {formatDataCurta(f.date_to)}
              </span>
            </div>
          ))}
          <p className="muted fila-nota">
            Quando um horário abre, a primeira da fila é avisada automaticamente.
          </p>
        </div>
      )}
    </div>
  )
}
