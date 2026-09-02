import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ProShell from '../../components/ProShell'
import AgendaDia from '../../components/AgendaDia'
import AgendaSemana from '../../components/AgendaSemana'
import FilaEspera from '../../components/FilaEspera'
import PedidosPendentes from '../../components/PedidosPendentes'
import SemFicha from './SemFicha'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { ChevronIcon } from '../../components/icons'

export default function ProAgenda() {
  const { professional } = useAuth()
  const [vista, setVista] = useState('dia')
  const [diaEscolhido, setDiaEscolhido] = useState(null)
  const [paraEnviar, setParaEnviar] = useState(0)

  const profId = professional?.id

  // mensagens escritas esperando a mão dela — o lugar onde ela olha
  useEffect(() => {
    if (!profId) return
    let vivo = true
    supabase.rpc('quantas_para_enviar', { prof: profId }).then(({ data }) => {
      if (vivo) setParaEnviar(data ?? 0)
    })
    return () => {
      vivo = false
    }
  }, [profId])

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
      <PedidosPendentes aoResponder={() => setDiaEscolhido((d) => (d ? d : d))} />

      {paraEnviar > 0 && (
        <Link to="/pro/enviar" className="card aviso-enviar">
          <span className="cliente-info">
            <span className="cliente-nome">
              <span className="nome-txt">
                {paraEnviar} mensagem{paraEnviar === 1 ? '' : 's'} pra enviar
              </span>
            </span>
            <span className="muted cliente-meta">
              Já estão escritas — é só tocar e mandar
            </span>
          </span>
          <ChevronIcon />
        </Link>
      )}

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
