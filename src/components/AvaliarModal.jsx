import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatDataCurta } from '../lib/booking'
import { StarIcon } from './icons'

// A folha de avaliar um atendimento: estrelas e um comentário opcional.
// Usada no histórico e no convite que aparece sozinho (2.17).
export default
function AvaliarModal({ appt, onFechar, onPronto }) {
  const { user } = useAuth()
  const [nota, setNota] = useState(0)
  const [texto, setTexto] = useState('')
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  async function enviar() {
    if (!nota) return
    setSaving(true)
    const { error } = await supabase.from('reviews').insert({
      appointment_id: appt.id, client_id: user.id, professional_id: appt.professional_id, nota, comentario: texto.trim() || null,
    })
    setSaving(false)
    if (error) setErro(error.message)
    else onPronto()
  }

  return (
    <div className="modal-fundo" onClick={onFechar}>
      <div className="modal-caixa" onClick={(e) => e.stopPropagation()}>
        <h3>Como foi com {appt.professionals?.name?.split(' ')[0]}?</h3>
        <p className="muted">{appt.services?.name} · {formatDataCurta(appt.date)}</p>
        <div className="estrelas-escolha">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" className={n <= nota ? 'on' : ''} onClick={() => setNota(n)} aria-label={`${n} estrelas`}>
              <StarIcon cheio={n <= nota} width={30} height={30} />
            </button>
          ))}
        </div>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} placeholder="Conta pra gente (opcional)" />
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className="modal-acoes">
          <button className="btn btn-ghost" onClick={onFechar}>Depois</button>
          <button className="btn btn-primary" onClick={enviar} disabled={!nota || saving}>{saving ? 'Enviando…' : 'Enviar avaliação'}</button>
        </div>
      </div>
    </div>
  )
}
