import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AdminShell from '../../components/AdminShell'
import AgendaDia from '../../components/AgendaDia'
import AgendaVazia from '../../components/AgendaVazia'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
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

  const { salao } = useAuth()
  // sem serviço ou sem profissional configurada não há o que marcar: mostra o caminho
  const [resumo, setResumo] = useState(undefined)
  useEffect(() => {
    if (!salao?.id) return
    supabase.rpc('primeiros_passos', { salao: salao.id }).then(({ data }) => setResumo(data ?? null))
  }, [salao?.id])
  const semAgenda = resumo && (Number(resumo.servicos ?? 0) === 0 || (resumo.tipo !== 'autonoma' && Number(resumo.equipe ?? 0) === 0))
  useEffect(() => {
    if (!salao?.id) return
    supabase
      .from('professionals')
      .select('id, name')
      .eq('salon_id', salao.id)     // só a equipe desta casa (as ativas são públicas pra cliente marcar)
      .eq('active', true)
      .order('name')
      .then(({ data }) => setProfissionais(data ?? []))
  }, [salao?.id])

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

      {semAgenda ? <AgendaVazia r={resumo} /> : (<>
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
        key={filtro + (salao?.id ?? '') + (params.get('dia') ?? '')}
        diaInicial={/^\d{4}-\d{2}-\d{2}$/.test(params.get('dia') ?? '') ? params.get('dia') : null}
        professionalId={filtro || null}
        salonId={salao?.id ?? null}
        mostrarProfissional={filtro === ''}
        pedidoDeEncaixe={pedidoDeEncaixe}
        semFab
      />
      </>)}
    </AdminShell>
  )
}
