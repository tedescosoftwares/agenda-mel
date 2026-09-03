import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AdminShell from '../../components/AdminShell'
import AgendaDia from '../../components/AgendaDia'
import { supabase } from '../../lib/supabase'
import { toISODate } from '../../lib/format'

export default function AdminAgenda() {
  const [profissionais, setProfissionais] = useState([])
  const [filtro, setFiltro] = useState('') // '' = todas
  const [params, setParams] = useSearchParams()
  const [pedidoDeEncaixe, setPedidoDeEncaixe] = useState(0)

  // O "+" da barra de baixo chega aqui como ?encaixe=1. Encaixar exige
  // saber COM QUEM, e a agenda pode estar mostrando todas — então ou já
  // existe uma filtrada, ou a tela pede para escolher primeiro.
  useEffect(() => {
    if (!params.get('encaixe')) return
    setParams({}, { replace: true })
    if (filtro) setPedidoDeEncaixe((n) => n + 1)
    else setPrecisaEscolher(true)
  }, [params, setParams, filtro])

  const [precisaEscolher, setPrecisaEscolher] = useState(false)

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
              onClick={() => {
                setFiltro(p.id)
                setPrecisaEscolher(false)
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {precisaEscolher && (
        <div className="alert alert-warn">
          Escolha primeiro com qual profissional é o encaixe, ali em cima.
        </div>
      )}

      <AgendaDia
        key={filtro}
        professionalId={filtro || null}
        mostrarProfissional={filtro === ''}
        pedidoDeEncaixe={pedidoDeEncaixe}
        semFab
      />
    </AdminShell>
  )
}
