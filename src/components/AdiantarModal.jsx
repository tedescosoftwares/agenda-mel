import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const PRAZOS = [
  { valor: 10, texto: '10 min' },
  { valor: 15, texto: '15 min' },
  { valor: 30, texto: '30 min' },
  { valor: 60, texto: '1 hora' },
]

// Convida a cliente a vir mais cedo. Nada muda sem a resposta dela.
export default function AdiantarModal({ appt, onFechar, onPronto }) {
  const [maisCedo, setMaisCedo] = useState(null)
  const [hora, setHora] = useState('')
  const [prazo, setPrazo] = useState(15)
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .rpc('horario_mais_cedo_possivel', { appt_id: appt.id })
      .then(({ data, error }) => {
        if (error) {
          setError('Erro ao calcular: ' + error.message)
        } else if (data) {
          const hhmm = String(data).slice(0, 5)
          setMaisCedo(hhmm)
          setHora(hhmm)
        }
        setCarregando(false)
      })
  }, [appt.id])

  const atual = appt.start_time.slice(0, 5)

  async function enviar() {
    setEnviando(true)
    setError('')
    const { error } = await supabase.rpc('propor_antecipacao', {
      appt_id: appt.id,
      novo_inicio: hora,
      minutos_para_responder: prazo,
    })
    setEnviando(false)
    if (error) {
      setError(error.message)
      return
    }
    onPronto?.()
  }

  return (
    <div className="modal-fundo" onClick={onFechar}>
      <div className="card modal-caixa" onClick={(e) => e.stopPropagation()} role="dialog">
        <button className="modal-fechar" onClick={onFechar} aria-label="Fechar">
          ×
        </button>

        <h3>Adiantar horário</h3>
        <p className="muted modal-resumo">
          {appt.profiles?.full_name || 'Cliente'} · {appt.services?.name} · hoje
          às {atual}
        </p>

        {carregando ? (
          <p className="muted">Calculando…</p>
        ) : !maisCedo ? (
          <>
            <div className="alert alert-warn">
              Não dá para adiantar este atendimento agora — o horário anterior
              está ocupado ou o expediente ainda não abriu.
            </div>
            <button className="btn btn-ghost btn-block" onClick={onFechar}>
              Fechar
            </button>
          </>
        ) : (
          <>
            <div className="form">
              <label>
                Novo horário
                <input
                  type="time"
                  value={hora}
                  min={maisCedo}
                  max={atual}
                  step={300}
                  onChange={(e) => setHora(e.target.value)}
                />
                <span className="muted campo-dica">
                  Mais cedo possível: {maisCedo}
                </span>
              </label>

              <div className="prazo-campo">
                <span className="img-field-label">Prazo para ela responder</span>
                <div className="prazo-opcoes">
                  {PRAZOS.map((p) => (
                    <button
                      key={p.valor}
                      type="button"
                      className={prazo === p.valor ? 'chip active' : 'chip'}
                      onClick={() => setPrazo(p.valor)}
                    >
                      {p.texto}
                    </button>
                  ))}
                </div>
              </div>

              {error && <div className="alert alert-error">{error}</div>}

              <p className="muted campo-dica">
                Ela recebe um aviso no app e decide. Sem resposta no prazo, o
                horário original continua valendo.
              </p>
            </div>

            <div className="form-actions">
              <button className="btn btn-ghost" onClick={onFechar}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={enviar}
                disabled={enviando || !hora || hora >= atual}
              >
                {enviando ? 'Enviando…' : 'Convidar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
