import { useState } from 'react'
import ProShell from '../../components/ProShell'
import AgendaDia from '../../components/AgendaDia'
import AgendaSemana from '../../components/AgendaSemana'
import FilaEspera from '../../components/FilaEspera'
import SemFicha from './SemFicha'
import { useAuth } from '../../context/AuthContext'

export default function ProAgenda() {
  const { professional } = useAuth()
  const [vista, setVista] = useState('dia')
  const [diaEscolhido, setDiaEscolhido] = useState(null)

  if (!professional) return <SemFicha />

  const hoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <ProShell>
      <div className="page-head">
        <div>
          <h2>Minha agenda</h2>
          <p className="muted titulo-dia">{hoje}</p>
        </div>
      </div>
      <div className="filtro-chips vista-chips">
        <button
          className={vista === 'dia' ? 'chip active' : 'chip'}
          onClick={() => setVista('dia')}
        >
          Dia
        </button>
        <button
          className={vista === 'semana' ? 'chip active' : 'chip'}
          onClick={() => setVista('semana')}
        >
          Semana
        </button>
      </div>

      <FilaEspera professionalId={professional.id} />

      {vista === 'semana' ? (
        <AgendaSemana
          professionalId={professional.id}
          onEscolherDia={(iso) => {
            setDiaEscolhido(iso)
            setVista('dia')
          }}
        />
      ) : (
        <AgendaDia
          key={diaEscolhido ?? 'hoje'}
          professionalId={professional.id}
          diaInicial={diaEscolhido}
        />
      )}
    </ProShell>
  )
}
