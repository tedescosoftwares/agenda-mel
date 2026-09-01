import { useEffect, useState } from 'react'
import AdminShell from '../../components/AdminShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const DIAS = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
]

export default function AdminHours() {
  const { salao } = useAuth()
  const [hours, setHours] = useState([])
  const [endereco, setEndereco] = useState('')
  const [salvandoUrl, setSalvandoUrl] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEndereco(salao?.app_url ?? '')
  }, [salao])

  useEffect(() => {
    if (!salao?.id) return
    supabase
      .from('business_hours')
      .select('*')
      .eq('salon_id', salao.id)
      .order('weekday')
      .then(({ data, error }) => {
        if (error) {
          setError('Erro ao carregar horários: ' + error.message)
        } else if (data.length === 0) {
          setError(
            'Nenhum horário encontrado — rode o arquivo supabase/003_business_hours.sql no SQL Editor do Supabase.',
          )
        } else {
          setHours(
            data.map((h) => ({
              ...h,
              start_time: h.start_time.slice(0, 5),
              end_time: h.end_time.slice(0, 5),
            })),
          )
        }
        setLoading(false)
      })
  }, [salao])

  function updateDay(weekday, patch) {
    setHours((prev) =>
      prev.map((h) => (h.weekday === weekday ? { ...h, ...patch } : h)),
    )
    setInfo('')
  }

  async function handleSave() {
    setError('')
    setInfo('')

    for (const h of hours) {
      if (h.open && h.start_time >= h.end_time) {
        setError(`${DIAS[h.weekday]}: o horário final precisa ser depois do inicial.`)
        return
      }
    }

    setSaving(true)
    for (const h of hours) {
      const { error } = await supabase
        .from('business_hours')
        .update({
          open: h.open,
          start_time: h.start_time,
          end_time: h.end_time,
        })
        .eq('salon_id', salao.id)
        .eq('weekday', h.weekday)
      if (error) {
        setError('Erro ao salvar: ' + error.message)
        setSaving(false)
        return
      }
    }
    setSaving(false)
    setInfo('Horários salvos.')
  }

  async function salvarEndereco(e) {
    e.preventDefault()
    if (!salao?.id) return
    setSalvandoUrl(true)
    setError('')
    const limpo = endereco.trim().replace(/\/+$/, '')
    const { error: erro } = await supabase
      .from('salons')
      .update({ app_url: limpo || null })
      .eq('id', salao.id)
    setSalvandoUrl(false)
    if (erro) setError('Não deu para salvar o endereço: ' + erro.message)
    else setInfo(limpo ? 'Endereço salvo. As mensagens já vão com o link.' : 'Endereço apagado.')
  }

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <h2>Horário padrão do salão</h2>
          <p className="muted">
            Serve de base para as profissionais novas. Cada uma ajusta o
            horário dela no app dela.
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {info && <div className="alert alert-info">{info}</div>}

      <form className="card form endereco-app" onSubmit={salvarEndereco}>
        <label>
          Endereço do app na internet
          <input
            type="url"
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
            placeholder="https://agendamel.vercel.app"
            inputMode="url"
          />
        </label>
        <p className="muted nota-endereco">
          É o link que vai nas mensagens de WhatsApp para a cliente abrir a
          agenda. Enquanto estiver vazio, as mensagens saem sem link — melhor
          do que mandar um endereço que só funciona na sua máquina.
        </p>
        <button className="btn btn-primary" type="submit" disabled={salvandoUrl}>
          {salvandoUrl ? 'Salvando…' : 'Salvar endereço'}
        </button>
      </form>

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : (
        hours.length > 0 && (
          <>
            <div className="hours-list">
              {hours.map((h) => (
                <div
                  key={h.weekday}
                  className={h.open ? 'card hours-row' : 'card hours-row closed'}
                >
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={h.open}
                      onChange={(e) =>
                        updateDay(h.weekday, { open: e.target.checked })
                      }
                    />
                    <span></span>
                  </label>

                  <span className="hours-dia">{DIAS[h.weekday]}</span>

                  {h.open ? (
                    <div className="hours-times">
                      <input
                        type="time"
                        value={h.start_time}
                        onChange={(e) =>
                          updateDay(h.weekday, { start_time: e.target.value })
                        }
                      />
                      <span className="muted">até</span>
                      <input
                        type="time"
                        value={h.end_time}
                        onChange={(e) =>
                          updateDay(h.weekday, { end_time: e.target.value })
                        }
                      />
                    </div>
                  ) : (
                    <span className="muted">Fechado</span>
                  )}
                </div>
              ))}
            </div>

            <div className="form-actions hours-save">
              <button
                className="btn btn-primary btn-block"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Salvando…' : 'Salvar horários'}
              </button>
            </div>
          </>
        )
      )}
    </AdminShell>
  )
}
