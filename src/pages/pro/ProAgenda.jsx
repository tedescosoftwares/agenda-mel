import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ProShell from '../../components/ProShell'
import AgendaDia from '../../components/AgendaDia'
import AgendaSemana from '../../components/AgendaSemana'
import PedidosPendentes from '../../components/PedidosPendentes'
import SemFicha from './SemFicha'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

// Agenda do dia (tela 15): os pedidos esperando no topo, o dia com
// status por atendimento, e o botão de encaixe fixo no pé.
export default function ProAgenda() {
  const { professional } = useAuth()
  const [vista, setVista] = useState('dia')
  const [paraEnviar, setParaEnviar] = useState(0)
  const profId = professional?.id

  useEffect(() => {
    if (!profId) return
    let vivo = true
    supabase.rpc('quantas_para_enviar', { prof: profId }).then(({ data }) => { if (vivo) setParaEnviar(data ?? 0) })
    return () => { vivo = false }
  }, [profId])

  if (!professional) return <SemFicha />

  return (
    <ProShell>
      <div className="page-head">
        <div>
          <h2>Agenda</h2>
          <p className="muted titulo-dia">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <div className="abas abas-mini">
          <button className={vista === 'dia' ? 'aba active' : 'aba'} onClick={() => setVista('dia')}>Dia</button>
          <button className={vista === 'semana' ? 'aba active' : 'aba'} onClick={() => setVista('semana')}>Semana</button>
        </div>
      </div>

      <PedidosPendentes />

      {paraEnviar > 0 && (
        <Link to="/pro/enviar" className="card aviso-enviar">
          <span className="cliente-info">
            <span className="cliente-nome"><span className="nome-txt">{paraEnviar} mensagem{paraEnviar === 1 ? '' : 's'} pra enviar</span></span>
            <span className="muted cliente-meta">Já estão escritas — é só tocar e mandar</span>
          </span>
        </Link>
      )}

      {vista === 'dia' ? <AgendaDia professionalId={professional.id} semFab /> : <AgendaSemana professionalId={professional.id} />}

      <div className="rodape-fixo">
        <Link to="/pro/encaixe" className="btn btn-primary btn-block">+ Novo encaixe</Link>
      </div>
    </ProShell>
  )
}
