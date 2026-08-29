import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDataLonga } from '../lib/booking'

const MENSAGEM = {
  expirada: 'O tempo dessa vaga acabou — ela passou para a próxima da fila.',
  conflito: 'Essa vaga acabou de ser preenchida.',
}

// "Abriu uma vaga" — a primeira da fila tem um tempo para responder.
export default function OfertaVaga({ oferta, onRespondido }) {
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  const [minutosRestantes, setMinutosRestantes] = useState(null)

  // conta regressiva do tempo que a vaga fica guardada
  useEffect(() => {
    function atualizar() {
      setMinutosRestantes(
        Math.max(0, Math.round((new Date(oferta.expires_at) - Date.now()) / 60000)),
      )
    }
    atualizar()
    const t = setInterval(atualizar, 30000)
    return () => clearInterval(t)
  }, [oferta.expires_at])

  async function responder(aceitar) {
    setEnviando(true)
    setError('')
    const { data, error } = await supabase.rpc('responder_vaga', {
      oferta_id: oferta.id,
      aceitar,
    })
    setEnviando(false)
    if (error) {
      setError(error.message)
      return
    }
    if (MENSAGEM[data]) {
      setError(MENSAGEM[data])
      setTimeout(() => onRespondido?.(), 2500)
      return
    }
    onRespondido?.()
  }

  const entrada = oferta.waitlist_entries

  return (
    <div className="card convite-card">
      <span className="convite-selo">🔔 Abriu uma vaga</span>
      <p className="convite-texto">
        <strong>{entrada?.services?.name}</strong> com{' '}
        {entrada?.professionals?.name}
        <br />
        {formatDataLonga(oferta.date)} às{' '}
        <strong>{oferta.start_time.slice(0, 5)}</strong>
      </p>
      <p className="muted convite-prazo">
        {minutosRestantes === null
          ? 'Guardada para você.'
          : minutosRestantes > 0
          ? `Guardada para você por mais ${minutosRestantes} min.`
          : 'O tempo está acabando.'}{' '}
        Depois disso passa para a próxima da fila.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="convite-acoes">
        <button
          className="btn btn-ghost"
          onClick={() => responder(false)}
          disabled={enviando}
        >
          Agora não
        </button>
        <button
          className="btn btn-primary"
          onClick={() => responder(true)}
          disabled={enviando}
        >
          {enviando ? 'Aguarde…' : 'Quero essa vaga'}
        </button>
      </div>
    </div>
  )
}
