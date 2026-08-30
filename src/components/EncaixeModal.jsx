import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDuracao, formatPreco } from '../lib/format'
import { formatDataLonga } from '../lib/booking'

// Encaixe manual: a cliente ligou, apareceu na porta, ou simplesmente
// não usa o app. O horário entra na agenda do mesmo jeito.
export default function EncaixeModal({ professionalId, data, onFechar, onPronto }) {
  const [services, setServices] = useState([])
  const [servicoId, setServicoId] = useState('')
  const [hora, setHora] = useState('')
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('professional_services')
      .select('services (id, name, duration_minutes, price, active)')
      .eq('professional_id', professionalId)
      .then(({ data }) => {
        const lista = (data ?? [])
          .map((v) => v.services)
          .filter((s) => s?.active)
          .sort((a, b) => a.name.localeCompare(b.name))
        setServices(lista)
        if (lista.length) setServicoId(lista[0].id)
      })
  }, [professionalId])

  const servico = services.find((s) => s.id === servicoId)

  async function salvar(e) {
    e.preventDefault()
    setError('')

    if (!servicoId || !hora || !nome.trim()) {
      setError('Preencha o serviço, o horário e o nome.')
      return
    }

    setSalvando(true)
    const { error } = await supabase.rpc('encaixar_atendimento', {
      prof: professionalId,
      servico: servicoId,
      dia: data,
      inicio: hora,
      nome_cliente: nome.trim(),
      telefone: telefone.trim() || null,
    })
    setSalvando(false)

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

        <h3>Encaixar atendimento</h3>
        <p className="muted modal-resumo">{formatDataLonga(data)}</p>

        <form className="form" onSubmit={salvar}>
          <label>
            Serviço
            <select
              value={servicoId}
              onChange={(e) => setServicoId(e.target.value)}
              required
            >
              {services.length === 0 && <option value="">Nenhum serviço ativo</option>}
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {formatDuracao(s.duration_minutes)} ·{' '}
                  {formatPreco(s.price)}
                </option>
              ))}
            </select>
          </label>

          <label>
            Começa às
            <input
              type="time"
              value={hora}
              step={300}
              onChange={(e) => setHora(e.target.value)}
              required
            />
            {servico && hora && (
              <span className="muted campo-dica">
                Termina às {calcularFim(hora, servico.duration_minutes)}
              </span>
            )}
          </label>

          <label>
            Nome da cliente
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Como você anota na agenda"
              required
            />
          </label>

          <label>
            WhatsApp (opcional)
            <input
              type="tel"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="(13) 99999-9999"
            />
          </label>

          {error && <div className="alert alert-error">{error}</div>}

          <p className="muted campo-dica">
            O encaixe pode cair fora da grade de horários, mas nunca por cima
            de outro atendimento.
          </p>

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onFechar}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={salvando}>
              {salvando ? 'Encaixando…' : 'Encaixar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function calcularFim(hhmm, minutos) {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m + minutos
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
