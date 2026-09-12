import { CalendarCheck, CircleCheck, CircleX, AlarmClock, Zap, Heart, Star, Gift, TriangleAlert, CalendarDays, Repeat, Megaphone, Bell, MessageCircle, Wallet } from 'lucide-react'

// Um ícone por tipo de aviso e para onde cada um leva. Usado no banner
// ao vivo, na faixa de novidades e na central de avisos.
export const ICONE_AVISO = {
  agendamento_confirmado: CalendarCheck, pedido_aceito: CircleCheck, pedido_recusado: CircleX,
  lembrete_agendamento: AlarmClock, vaga_disponivel: AlarmClock, agenda_adiantada: Zap,
  convite_retorno: Heart, pos_atendimento: Star, indicacao_creditada: Gift,
  profissional_cancelou: TriangleAlert, agendamento_cancelado: TriangleAlert, cancelou_comigo: TriangleAlert,
  novo_agendamento: CalendarDays, pedido_de_aceite: CalendarDays, pedido_pelo_whatsapp: MessageCircle, atendimento_humano: MessageCircle,
  remarcacao_aceita: Repeat, remarcacao_recusada: CircleX, recado: Megaphone, afiliado_novo: Wallet, afiliado_cashback: Wallet,
  teste: Bell, teste_push: Bell,
}

const DESTINO_CLIENTE = {
  agendamento_confirmado: '/cliente/meus-agendamentos', pedido_aceito: '/cliente/meus-agendamentos',
  pedido_recusado: '/cliente/home', lembrete_agendamento: '/cliente/meus-agendamentos',
  vaga_disponivel: '/cliente/meus-agendamentos', indicacao_creditada: '/cliente/indicacao',
  remarcacao_aceita: '/cliente/meus-agendamentos', remarcacao_recusada: '/cliente/meus-agendamentos',
  profissional_cancelou: '/cliente/meus-agendamentos', agenda_adiantada: '/cliente/meus-agendamentos',
}

export function destinoDoAviso(aviso, role) {
  if (role === 'cliente' && DESTINO_CLIENTE[aviso.kind]) return DESTINO_CLIENTE[aviso.kind]
  if (aviso.action_url && aviso.action_url !== '/') return aviso.action_url
  if (role === 'cliente') return '/cliente/notificacoes'
  return '/avisos'
}

export function centralDoPapel(role) {
  return role === 'cliente' ? '/cliente/notificacoes' : '/avisos'
}

export function relativo(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.round(h / 24)
  if (d === 1) return 'ontem'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}
