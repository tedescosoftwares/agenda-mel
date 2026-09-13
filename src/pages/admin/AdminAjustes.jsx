import { useDialogo } from '../../context/DialogoContext'
import { Link } from 'react-router-dom'
import AdminShell from '../../components/AdminShell'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import CodigoQr from '../../components/CodigoQr'
import AvisosNoCelular from '../../components/AvisosNoCelular'
import AvisosPorEmail from '../../components/AvisosPorEmail'
import { useState } from 'react'
import {
  MegafoneIcon,
  TeamIcon,
  GraficoIcon,
  SparkleIcon,
  ClockIcon,
  BellIcon,
  ChevronIcon,
} from '../../components/icons'
import { BadgePercent } from 'lucide-react'

// Hub de ajustes do salão.
//
// Nasceu quando a barra do admin caiu de seis abas para cinco. Seis
// abas numa barra de celular dão 60px cada — o polegar erra. As três
// que saíram (O mês, Serviços, WhatsApp) não são o dia a dia de quem
// abre o app: são coisas que se configuram uma vez e se conferem de vez
// em quando. Aba é para o que se usa todo dia.
const ITENS = [
  {
    to: '/admin/recados',
    Icon: MegafoneIcon,
    titulo: 'Recados',
    resumo: 'Um aviso para a carteira ou para a equipe, no celular',
  },
  {
    to: '/admin/promocoes',
    Icon: BadgePercent,
    titulo: 'Promoções',
    resumo: 'Um criativo na home das clientes da carteira',
  },
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
  const { confirmar } = useDialogo()
  const { salao, signOut } = useAuth()
  const [codigo, setCodigo] = useState(salao?.codigo ?? null)
  const [erro, setErro] = useState('')

  async function novoCodigo() {
    const ok = await confirmar({ titulo: 'Gerar um código novo para o salão?', texto: 'O QR do balcão e o link antigos deixam de funcionar. Quem já entrou continua.', ok: 'Gerar novo' })
    if (!ok) return
    const { data, error } = await supabase.rpc('novo_codigo_do_salao', { salao: salao.id })
    if (error) setErro(error.message); else setCodigo(data)
  }

  return (
    <AdminShell>
      <div className="page-head">
        <h2>Ajustes</h2>
        <p className="muted">{salao?.name ?? 'Meu salão'}</p>
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}
      <AvisosNoCelular />
      <AvisosPorEmail />

      <h3 className="secao-titulo">Código do salão</h3>
      <div className="card">
        <CodigoQr codigo={codigo ?? salao?.codigo} nome={salao?.name} onNovo={salao ? novoCodigo : undefined}
          mensagem={`Entra na agenda do ${salao?.name ?? 'salão'} pelo MIMO: ${window.location.origin}/v/${codigo ?? salao?.codigo}\nOu digita o código ${codigo ?? salao?.codigo} no app.`} />
      </div>
      <p className="muted" style={{ fontSize: '0.82rem' }}>Imprima e deixe no balcão. Quem entra por aqui vê todas as profissionais da casa. Cada profissional tem o código dela em Meu link, e a cliente que entra por ele fica registrada como trazida por ela.</p>

      <h3 className="secao-titulo">Configurações</h3>
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
        onClick={async () => {
          if (await confirmar({ titulo: 'Sair da conta?', ok: 'Sair', cancelar: 'Ficar' })) signOut()
        }}
      >
        Sair da conta
      </button>
    </AdminShell>
  )
}
