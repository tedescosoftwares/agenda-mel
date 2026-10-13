import type { Icone } from '@/components/ui'

// Avisos no app: um ícone por tipo (o mesmo mapa da web, src/lib/avisos.js,
// com os ícones do Ionicons) e, do core, para onde cada um leva e o "há 5 min".
export { destinoDoAviso, relativo } from '@mimo/core'

export type Aviso = {
  id: string
  kind: string
  title: string
  body: string | null
  data: Record<string, unknown> | null
  action_url: string | null
  created_at: string
  read_at: string | null
}

const ICONES: Record<string, Icone> = {
  agendamento_confirmado: 'calendar', pedido_aceito: 'checkmark-circle', pedido_recusado: 'close-circle',
  lembrete_agendamento: 'alarm', vaga_disponivel: 'alarm', agenda_adiantada: 'flash',
  convite_retorno: 'heart', pos_atendimento: 'star', avaliar_atendimento: 'star', indicacao_creditada: 'gift',
  profissional_cancelou: 'warning', agendamento_cancelado: 'warning', cancelou_comigo: 'warning', reserva_expirada: 'warning',
  novo_agendamento: 'calendar', pedido_de_aceite: 'calendar', pedido_enviado: 'hourglass',
  remarcacao_aceita: 'repeat', remarcacao_recusada: 'close-circle', recado: 'megaphone', troca_vencida: 'calendar-clear',
  pagamento_confirmado: 'wallet', agendamento_pago: 'wallet', estorno_a_caminho: 'wallet', sinal_retido: 'wallet',
  sinal_em_credito: 'wallet', credito_vencido: 'wallet', estorno_sem_saldo: 'warning', estorno_atrasado: 'hourglass',
  promocao_aprovada: 'pricetag', promocao_recusada: 'pricetag', promocao_pendente: 'pricetag',
}

export const iconeDoAviso = (kind: string): Icone => ICONES[kind] ?? 'notifications'
