import { useCallback, useEffect, useState } from 'react'
import { useDialogo } from '../context/DialogoContext'
import { supabase } from '../lib/supabase'

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

const FORM_VAZIO = {
  kind: 'semanal',
  weekday: 1,
  date: '',
  all_day: false,
  start_time: '12:00',
  end_time: '13:00',
  reason: '',
}

// Almoço, folga e compromisso — o que a agenda precisa saber para
// parar de vender horário que não existe.
export default function BloqueiosEditor({ professionalId }) {
  const { confirmar } = useDialogo()
  const [blocos, setBlocos] = useState([])
  const [form, setForm] = useState(FORM_VAZIO)
  const [abrindo, setAbrindo] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [error, setError] = useState('')

  const carregar = useCallback(async () => {
    if (!professionalId) return
    const { data, error } = await supabase
      .from('professional_blocks')
      .select('*')
      .eq('professional_id', professionalId)
      .order('kind')
      .order('weekday', { nullsFirst: true })
      .order('date', { nullsFirst: true })
    if (error) setError('Erro ao carregar: ' + error.message)
    else setBlocos(data)
  }, [professionalId])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function salvar(e) {
    e.preventDefault()
    setError('')

    if (form.kind === 'data' && !form.date) {
      setError('Escolha o dia do compromisso.')
      return
    }
    if (!form.all_day && form.start_time >= form.end_time) {
      setError('O horário final precisa ser depois do inicial.')
      return
    }

    setSalvando(true)
    const { error } = await supabase.from('professional_blocks').insert({
      professional_id: professionalId,
      kind: form.kind,
      weekday: form.kind === 'semanal' ? Number(form.weekday) : null,
      date: form.kind === 'data' ? form.date : null,
      all_day: form.all_day,
      start_time: form.all_day ? null : form.start_time,
      end_time: form.all_day ? null : form.end_time,
      reason: form.reason.trim() || null,
    })
    setSalvando(false)

    if (error) {
      setError('Erro ao salvar: ' + error.message)
      return
    }
    setForm(FORM_VAZIO)
    setAbrindo(false)
    carregar()
  }

  async function remover(bloco) {
    const ok = await confirmar({ titulo: 'Remover este bloqueio?', texto: 'O horário volta a aparecer livre para as clientes.', ok: 'Remover', perigo: true })
    if (!ok) return
    const { error } = await supabase
      .from('professional_blocks')
      .delete()
      .eq('id', bloco.id)
    if (error) setError('Erro ao remover: ' + error.message)
    else carregar()
  }

  return (
    <section className="secao">
      <h3 className="secao-titulo">Almoço, folga e compromissos</h3>
      <p className="muted campo-dica bloco-intro">
        Enquanto estiver aqui, o horário não aparece para ninguém agendar.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {blocos.length > 0 && (
        <div className="bloco-list">
          {blocos.map((b) => (
            <div key={b.id} className="card bloco-row">
              <div className="bloco-info">
                <span className="bloco-quando">
                  <span className="nome-txt">
                    {b.kind === 'semanal'
                      ? `Toda ${DIAS[b.weekday].toLowerCase()}`
                      : formatData(b.date)}
                  </span>
                </span>
                <span className="muted bloco-hora">
                  {b.all_day
                    ? 'o dia todo'
                    : `${b.start_time.slice(0, 5)} às ${b.end_time.slice(0, 5)}`}
                  {b.reason ? ` · ${b.reason}` : ''}
                </span>
              </div>
              <button
                className="btn-link-cancelar"
                onClick={() => remover(b)}
                aria-label="Remover bloqueio"
              >
                remover
              </button>
            </div>
          ))}
        </div>
      )}

      {abrindo ? (
        <form className="card form bloco-form" onSubmit={salvar}>
          <div className="prazo-opcoes">
            <button
              type="button"
              className={form.kind === 'semanal' ? 'chip active' : 'chip'}
              onClick={() => setForm({ ...form, kind: 'semanal' })}
            >
              Toda semana
            </button>
            <button
              type="button"
              className={form.kind === 'data' ? 'chip active' : 'chip'}
              onClick={() => setForm({ ...form, kind: 'data' })}
            >
              Um dia só
            </button>
          </div>

          {form.kind === 'semanal' ? (
            <label>
              Dia da semana
              <select
                value={form.weekday}
                onChange={(e) => setForm({ ...form, weekday: e.target.value })}
              >
                {DIAS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Dia
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </label>
          )}

          <label className="linha-check">
            <input
              type="checkbox"
              checked={form.all_day}
              onChange={(e) => setForm({ ...form, all_day: e.target.checked })}
            />
            <span>O dia todo</span>
          </label>

          {!form.all_day && (
            <div className="hours-times">
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              />
              <span className="muted">até</span>
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              />
            </div>
          )}

          <label>
            Motivo (opcional)
            <input
              type="text"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="Almoço, médico, folga…"
            />
          </label>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setAbrindo(false)}
            >
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={salvando}>
              {salvando ? 'Salvando…' : 'Bloquear'}
            </button>
          </div>
        </form>
      ) : (
        <button className="btn btn-small btn-bloquear" onClick={() => setAbrindo(true)}>
          + Bloquear um horário
        </button>
      )}
    </section>
  )
}

function formatData(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}
