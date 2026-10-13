import { CalendarCheck, CircleCheck, CircleX, AlarmClock, Zap, Heart, Star, Gift, TriangleAlert, CalendarDays, Repeat, Megaphone, Bell, MessageCircle, Wallet, Hourglass, ClipboardCheck, MessageSquareWarning, CalendarX, Users, BadgePercent } from 'lucide-react'

// Um ícone por tipo de aviso e para onde cada um leva. Usado no banner
// ao vivo, na faixa de novidades e na central de avisos.
export const ICONE_AVISO = {
  agendamento_confirmado: CalendarCheck, pedido_aceito: CircleCheck, pedido_recusado: CircleX,
  lembrete_agendamento: AlarmClock, vaga_disponivel: AlarmClock, agenda_adiantada: Zap,
  convite_retorno: Heart, pos_atendimento: Star, indicacao_creditada: Gift,
  profissional_cancelou: TriangleAlert, agendamento_cancelado: TriangleAlert, cancelou_comigo: TriangleAlert,
  novo_agendamento: CalendarDays, pedido_de_aceite: CalendarDays, pedido_pelo_whatsapp: MessageCircle, atendimento_humano: MessageCircle,
  remarcacao_aceita: Repeat, remarcacao_recusada: CircleX, recado: Megaphone, afiliado_novo: Wallet, afiliado_cashback: Wallet,
  pedido_enviado: Hourglass, fechar_dia: ClipboardCheck, veio: ClipboardCheck, contestacao: MessageSquareWarning, troca_vencida: CalendarX, parte_recusada: TriangleAlert, visita_em_espera: Users, promocao_pendente: BadgePercent, promocao_aprovada: BadgePercent, promocao_recusada: BadgePercent, avaliar_atendimento: Star, pagamento_confirmado: Wallet, reserva_expirada: TriangleAlert, estorno_a_caminho: Wallet, sinal_retido: Wallet, estorno_sem_saldo: TriangleAlert, estorno_atrasado: Hourglass, sinal_em_credito: Wallet, credito_vencido: Wallet, agendamento_pago: Wallet, teste: Bell, teste_push: Bell,
}

// para onde cada aviso leva e o "há 5 min" vivem em packages/core (compartilhado com o app)
export { destinoDoAviso, centralDoPapel, relativo } from '../../packages/core/avisos.js'
