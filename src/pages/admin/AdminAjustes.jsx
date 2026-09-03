import { Link } from 'react-router-dom'
import AdminShell from '../../components/AdminShell'
import { useAuth } from '../../context/AuthContext'
import {
  TeamIcon,
  GraficoIcon,
  SparkleIcon,
  ClockIcon,
  BellIcon,
  ChevronIcon,
} from '../../components/icons'

// Hub de ajustes do salão.
//
// Nasceu quando a barra do admin caiu de seis abas para cinco. Seis
// abas numa barra de celular dão 60px cada — o polegar erra. As três
// que saíram (O mês, Serviços, WhatsApp) não são o dia a dia de quem
// abre o app: são coisas que se configuram uma vez e se conferem de vez
// em quando. Aba é para o que se usa todo dia.
const ITENS = [
  {
    to: '/admin/equipe',
    Icon: TeamIcon,
    titulo: 'Equipe',
    resumo: 'Quem atende, com quais serviços, e o vínculo com a conta',
  },
  {
    to: '/admin/numeros',
    Icon: GraficoIcon,
    titulo: 'O mês',
    resumo: 'Faturamento, ocupação e atendimentos do salão',
  },
  {
    to: '/admin/servicos',
    Icon: SparkleIcon,
    titulo: 'Serviços',
    resumo: 'O que o salão oferece, com preço, duração e foto',
  },
  {
    to: '/admin/horarios',
    Icon: ClockIcon,
    titulo: 'Horário do salão',
    resumo: 'Os dias e horas em que a casa abre',
  },
  {
    to: '/admin/whatsapp',
    Icon: BellIcon,
    titulo: 'WhatsApp',
    resumo: 'Diagnóstico do canal, a IA e o bot que marca sozinho',
  },
]

export default function AdminAjustes() {
  const { salao, signOut } = useAuth()

  return (
    <AdminShell>
      <div className="page-head">
        <h2>Ajustes</h2>
        <p className="muted">{salao?.name ?? 'Meu salão'}</p>
      </div>

      <div className="cliente-list">
        {ITENS.map(({ to, Icon, titulo, resumo }) => (
          <Link key={to} to={to} className="card prof-row">
            <span className="ajuste-icone">
              <Icon />
            </span>
            <div className="cliente-info">
              <span className="cliente-nome">
                <span className="nome-txt">{titulo}</span>
              </span>
              <span className="muted cliente-meta">{resumo}</span>
            </div>
            <ChevronIcon />
          </Link>
        ))}
      </div>

      <button
        className="btn btn-ghost btn-block"
        onClick={() => {
          if (window.confirm('Sair da conta?')) signOut()
        }}
      >
        Sair da conta
      </button>
    </AdminShell>
  )
}
