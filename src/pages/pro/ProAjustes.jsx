import { Link } from 'react-router-dom'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import { useAuth } from '../../context/AuthContext'
import { ClockIcon, LinkIcon, ChevronIcon, BellIcon } from '../../components/icons'

// Hub das configurações da profissional. Cada item continua tendo a
// sua própria tela — aqui é só a porta de entrada.
export default function ProAjustes() {
  const { professional, signOut } = useAuth()

  if (!professional) return <SemFicha />

  return (
    <ProShell>
      <div className="page-head">
        <h2>Ajustes</h2>
        <p className="muted">{professional.name}</p>
      </div>

      <div className="cliente-list">
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

      <button
        className="btn btn-ghost btn-largo sair-conta"
        onClick={() => window.confirm('Sair da conta?') && signOut()}
      >
        Sair da conta
      </button>
    </ProShell>
  )
}
