import { useState } from 'react'
import { supabase } from '../lib/supabase'

const MENSAGEM = {
  aceita: null,
  recusada: null,
  expirada: 'Esse convite expirou — seu horário original continua valendo.',
  conflito: 'Esse horário acabou de ser ocupado. Seu horário original continua valendo.',
}

// Convite para vir mais cedo, na tela da cliente
export default function ConviteAdiantar({ oferta, servico, profissional, onRespondido }) {
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  async function responder(aceitar) {
    setEnviando(true)
    setError('')
    const { data, error } = await supabase.rpc('responder_antecipacao', {
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

  return (
    <div className="card convite-card">
      <span className="convite-selo">Dá para adiantar</span>
      <p className="convite-texto">
        {profissional ? <strong>{profissional}</strong> : 'Sua profissional'} pode
        te atender às <strong>{oferta.proposed_start_time.slice(0, 5)}</strong> em
        vez de {oferta.previous_start_time.slice(0, 5)}
        {servico ? ` (${servico})` : ''}.
      </p>
      <p className="muted convite-prazo">
        Você decide — sem resposta, o horário original continua valendo.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="convite-acoes">
        <button
          className="btn btn-ghost"
          onClick={() => responder(false)}
          disabled={enviando}
        >
          Manter {oferta.previous_start_time.slice(0, 5)}
        </button>
        <button
          className="btn btn-primary"
          onClick={() => responder(true)}
          disabled={enviando}
        >
          {enviando ? 'Aguarde…' : `Pode ser ${oferta.proposed_start_time.slice(0, 5)}`}
        </button>
      </div>
    </div>
  )
}
