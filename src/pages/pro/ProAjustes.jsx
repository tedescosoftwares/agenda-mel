import { useDialogo } from '../../context/DialogoContext'
import { Link, useNavigate } from 'react-router-dom'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import { useAuth } from '../../context/AuthContext'
import { ClockIcon, LinkIcon, ChevronIcon, BellIcon, MegafoneIcon } from '../../components/icons'
import { BadgePercent, Wallet, MapPin, FileSignature, Building2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import AvisosNoCelular from '../../components/AvisosNoCelular'
import AvisosPorEmail from '../../components/AvisosPorEmail'

// Hub das configurações da profissional. Cada item continua tendo a
// sua própria tela — aqui é só a porta de entrada.
export default function ProAjustes() {
  const { confirmar } = useDialogo()
  const { professional, signOut, negocio, recarregarPerfil } = useAuth()
  const navigate = useNavigate()
  // o caminho inverso (2.99.1): a autônoma que cresce vira salão sem refazer nada
  async function virarSalao() {
    const ok = await confirmar({ titulo: 'Virar salão?', texto: 'Você ganha o painel completo, equipe com agenda própria e a sua agenda continua igual, com o mesmo login. O plano só começa quando você ativar o salão.', ok: 'Virar salão', cancelar: 'Agora não' })
    if (!ok) return
    const { error } = await supabase.rpc('virar_salao', { salao: negocio?.id })
    if (error) { await confirmar({ titulo: 'Não deu', texto: error.message, ok: 'Entendi', cancelar: '' }); return }
    await recarregarPerfil?.()
    navigate('/admin', { replace: true })
  }

  if (!professional) return <SemFicha />

  return (
    <ProShell>
      <div className="page-head">
        <h2>Ajustes</h2>
        <p className="muted">{professional.name}</p>
      </div>

      <AvisosNoCelular />
      <AvisosPorEmail />

      <div className="cliente-list">
        <Link to="/pro/recados" className="card prof-row">
          <span className="ajuste-icone">
            <MegafoneIcon />
          </span>
          <div className="cliente-info">
            <span className="cliente-nome">
              <span className="nome-txt">Recados</span>
            </span>
            <span className="muted cliente-meta">
              Um aviso para todas as suas clientes, no celular
            </span>
          </div>
          <ChevronIcon />
        </Link>

        <Link to="/pro/receber" className="card prof-row">
          <span className="ajuste-icone">
            <Wallet />
          </span>
          <div className="cliente-info">
            <span className="cliente-nome">
              <span className="nome-txt">Receber pelo app</span>
            </span>
            <span className="muted cliente-meta">
              PIX ao marcar, política de cancelamento e o financeiro do mês
            </span>
          </div>
          <ChevronIcon />
        </Link>

        <Link to="/pro/local" className="card prof-row">
          <span className="ajuste-icone">
            <MapPin />
          </span>
          <div className="cliente-info">
            <span className="cliente-nome">
              <span className="nome-txt">Onde você atende</span>
            </span>
            <span className="muted cliente-meta">
              Endereço e pino no mapa para a cliente chegar
            </span>
          </div>
          <ChevronIcon />
        </Link>

        <Link to="/pro/contrato" className="card prof-row">
          <span className="ajuste-icone">
            <FileSignature />
          </span>
          <div className="cliente-info">
            <span className="cliente-nome">
              <span className="nome-txt">Meu contrato</span>
            </span>
            <span className="muted cliente-meta">
              O contrato de parceria com o salão, para ler e assinar
            </span>
          </div>
          <ChevronIcon />
        </Link>

        <Link to="/pro/promocoes" className="card prof-row">
          <span className="ajuste-icone">
            <BadgePercent />
          </span>
          <div className="cliente-info">
            <span className="cliente-nome">
              <span className="nome-txt">Promoções</span>
            </span>
            <span className="muted cliente-meta">
              Um criativo na home das suas clientes
            </span>
          </div>
          <ChevronIcon />
        </Link>

        <Link to="/pro/pedidos" className="card prof-row">
          <span className="ajuste-icone">
            <BellIcon />
          </span>
          <div className="cliente-info">
            <span className="cliente-nome">
              <span className="nome-txt">Pedidos de horário</span>
            </span>
            <span className="muted cliente-meta">
              Quem pediu pelo WhatsApp e espera seu sim, e o seu prazo
            </span>
          </div>
          <ChevronIcon />
        </Link>

        <Link to="/pro/horarios" className="card prof-row">
          <span className="ajuste-icone">
            <ClockIcon />
          </span>
          <div className="cliente-info">
            <span className="cliente-nome">
              <span className="nome-txt">Horários</span>
            </span>
            <span className="muted cliente-meta">
              Dias que você atende, almoço e folgas
            </span>
          </div>
          <ChevronIcon />
        </Link>

        <Link to="/pro/link" className="card prof-row">
          <span className="ajuste-icone">
            <LinkIcon />
          </span>
          <div className="cliente-info">
            <span className="cliente-nome">
              <span className="nome-txt">Meu link</span>
            </span>
            <span className="muted cliente-meta">
              O endereço que você passa para as clientes, e sua foto
            </span>
          </div>
          <ChevronIcon />
        </Link>

        <Link to="/pro/enviar" className="card prof-row">
          <span className="ajuste-icone">
            <LinkIcon />
          </span>
          <div className="cliente-info">
            <span className="cliente-nome">
              <span className="nome-txt">Pra enviar</span>
            </span>
            <span className="muted cliente-meta">
              Mensagens escritas, esperando você mandar pelo WhatsApp
            </span>
          </div>
          <ChevronIcon />
        </Link>

        <Link to="/pro/retorno" className="card prof-row">
          <span className="ajuste-icone">
            <ClockIcon />
          </span>
          <div className="cliente-info">
            <span className="cliente-nome">
              <span className="nome-txt">Avisos automáticos</span>
            </span>
            <span className="muted cliente-meta">
              Lembrete de véspera, obrigada pela visita e quem sumiu
            </span>
          </div>
          <ChevronIcon />
        </Link>
      </div>

      {negocio?.tipo === 'autonoma' && (
        <button type="button" className="card prof-row prof-row-virar" onClick={virarSalao}>
          <span className="ajuste-icone"><Building2 size={20} /></span>
          <div className="cliente-info">
            <span className="cliente-nome"><span className="nome-txt">Crescendo? Vire salão</span></span>
            <span className="muted cliente-meta">Equipe com agenda própria e painel completo. Sua agenda continua a mesma.</span>
          </div>
          <ChevronIcon />
        </button>
      )}

      <button
        className="btn btn-ghost btn-largo sair-conta"
        onClick={async () => { if (await confirmar({ titulo: 'Sair da conta?', ok: 'Sair', cancelar: 'Ficar' })) signOut() }}
      >
        Sair da conta
      </button>
    </ProShell>
  )
}
