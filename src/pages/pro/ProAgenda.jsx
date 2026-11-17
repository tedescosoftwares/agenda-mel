import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarPlus } from 'lucide-react'
import ProShell from '../../components/ProShell'
import AgendaDia from '../../components/AgendaDia'
import AgendaSemana from '../../components/AgendaSemana'
import PedidosPendentes from '../../components/PedidosPendentes'
import AvisosNovos from '../../components/AvisosNovos'
import LigarAvisos from '../../components/LigarAvisos'
import PendenciasBaixa from '../../components/PendenciasBaixa'
import SemFicha from './SemFicha'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import PrimeirosPassos from '../../components/PrimeirosPassos'
import AcessoAviso from '../../components/AcessoAviso'
import { CartaoInstalar } from '../../components/InstalarApp'
import FaixaDoSalao from '../../components/pro/FaixaDoSalao'
import AgendaLinhaDoTempo from '../../components/pro/AgendaLinhaDoTempo'
import { ehDaEquipe } from '../../lib/meuSalao'
import '../../pro-equipe.css'

// Agenda do dia (tela 15): os pedidos esperando no topo, o dia com
// status por atendimento, e o botão de encaixe fixo no pé.
// 3.90: a profissional da equipe vê só o que é dela: o salão no topo (com o
// WhatsApp da casa), a agenda, os avisos e recados. Sem teste grátis, sem
// encaixe, sem pendências do caixa: isso é com o salão.
export default function ProAgenda() {
  const { professional, negocio, profile } = useAuth()
  const [vista, setVista] = useState('dia')
  const [paraEnviar, setParaEnviar] = useState(0)
  const profId = professional?.id
  const equipe = ehDaEquipe({ professional, negocio })

  useEffect(() => {
    if (!profId || equipe) return
    let vivo = true
    supabase.rpc('quantas_para_enviar', { prof: profId }).then(({ data }) => { if (vivo) setParaEnviar(data ?? 0) })
    return () => { vivo = false }
  }, [profId, equipe])

  if (!professional) return <SemFicha />

  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  const abas = (
    <div className="abas abas-mini">
      <button className={vista === 'dia' ? 'aba active' : 'aba'} onClick={() => setVista('dia')}>Dia</button>
      <button className={vista === 'semana' ? 'aba active' : 'aba'} onClick={() => setVista('semana')}>Semana</button>
    </div>
  )

  // 3.91: a equipe vê a agenda como linha do tempo, só para ver (mudar algo é com o salão), sem
  // valores em R$ e sem responder pedidos (o salão responde, ou vale a regra de quando ninguém responde)
  if (equipe) {
    const primeiro = String(professional.name || profile?.full_name || '').trim().split(/\s+/)[0]
    return (
      // 3.93: no computador, duas colunas: a agenda larga à esquerda e o salão, o instalar e as
      // novidades à direita. No celular, uma coluna só, na mesma ordem de antes.
      <ProShell amplo>
        <div className="pe-grade">
          <div className="pe-ola">
            <h2>{primeiro ? `Oi, ${primeiro}` : 'Sua agenda'}</h2>
            <p className="muted">{hoje.charAt(0).toUpperCase() + hoje.slice(1)}</p>
          </div>
          <aside className="pe-lado">
            <FaixaDoSalao />
            <CartaoInstalar para="equipe" />
            <AvisosNovos />
            <LigarAvisos semInstalar texto="Recados do salão, horários novos e cancelamentos chegam na hora, mesmo com o app fechado." />
          </aside>
          <div className="pe-principal">
            <AgendaLinhaDoTempo professionalId={professional.id} />
          </div>
        </div>
      </ProShell>
    )
  }

  return (
    <ProShell>
      <AcessoAviso para="pro" />
      {negocio?.tipo === 'autonoma' && negocio?.onboarding_concluido_em && <PrimeirosPassos salao={negocio} para="pro" />}
      <div className="page-head">
        <div>
          <h2>Agenda</h2>
          <p className="muted titulo-dia">{hoje}</p>
        </div>
        {abas}
      </div>

      <CartaoInstalar />
      <AvisosNovos />
      <PendenciasBaixa />
      <LigarAvisos semInstalar texto="Pedido de horário, cancelamento e cliente chamando no WhatsApp chegam na hora, mesmo com o app fechado." />
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
        <Link to="/pro/encaixe" className="btn btn-primary btn-block btn-novo-encaixe"><CalendarPlus size={18} /> Novo encaixe</Link>
      </div>
    </ProShell>
  )
}
