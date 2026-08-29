import { useEffect, useState } from 'react'
import AdminShell from '../../components/AdminShell'
import AgendaDia from '../../components/AgendaDia'
import { supabase } from '../../lib/supabase'
import { toISODate } from '../../lib/format'

export default function AdminAgenda() {
  const [profissionais, setProfissionais] = useState([])
  const [filtro, setFiltro] = useState('') // '' = todas

  useEffect(() => {
    supabase
      .from('professionals')
      .select('id, name')
      .eq('active', true)
      .order('name')
      .then(({ data }) => setProfissionais(data ?? []))
  }, [])

  const tituloDia = new Date(toISODate(new Date()) + 'T12:00:00').toLocaleDateString(
    'pt-BR',
    { weekday: 'long', day: 'numeric', month: 'long' },
  )

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <h2>Agenda</h2>
          <p className="muted titulo-dia">{tituloDia}</p>
        </div>
      </div>

      {profissionais.length > 0 && (
        <div className="filtro-chips">
          <button
            className={filtro === '' ? 'chip active' : 'chip'}
            onClick={() => setFiltro('')}
          >
            Todas
          </button>
          {profissionais.map((p) => (
            <button
              key={p.id}
              className={filtro === p.id ? 'chip active' : 'chip'}
              onClick={() => setFiltro(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <AgendaDia
        key={filtro}
        professionalId={filtro || null}
        mostrarProfissional={filtro === ''}
      />
    </AdminShell>
  )
}
