// Avisos: para onde cada um leva e o "há 5 min". Lógica sem tela, usada
// pela web (src/lib/avisos.js) e pelo app (apps/mobile/src/lib/notificacoes.ts).

const DESTINO_CLIENTE = {
  agendamento_confirmado: '/cliente/meus-agendamentos', pedido_aceito: '/cliente/meus-agendamentos',
  pedido_recusado: '/cliente/home', lembrete_agendamento: '/cliente/meus-agendamentos',
  vaga_disponivel: '/cliente/meus-agendamentos', indicacao_creditada: '/cliente/indicacao',
  remarcacao_aceita: '/cliente/meus-agendamentos', remarcacao_recusada: '/cliente/meus-agendamentos',
  profissional_cancelou: '/cliente/meus-agendamentos', agenda_adiantada: '/cliente/meus-agendamentos',
}

export function destinoDoAviso(aviso, role) {
  // aviso de um horário leva ao próprio horário
  const appt = aviso.data?.appointment_id
  if (role === 'cliente' && appt && aviso.kind === 'avaliar_atendimento') return `/cliente/agendamento/${appt}?avaliar=1`
  if (role === 'cliente' && appt && aviso.kind !== 'remarcacao_recusada') return `/cliente/agendamento/${appt}`
  if (role === 'cliente' && DESTINO_CLIENTE[aviso.kind]) return DESTINO_CLIENTE[aviso.kind]
  if (aviso.action_url && aviso.action_url !== '/') return aviso.action_url
  if (role === 'cliente') return '/cliente/notificacoes'
  return '/avisos'
}

export function centralDoPapel(role) {
  return role === 'cliente' ? '/cliente/notificacoes' : '/avisos'
}

// 'agora', 'há 5 min', 'há 3h', 'ontem', '02/10'
export function relativo(iso, agora = Date.now()) {
  const quando = new Date(iso)
  const min = Math.round((agora - quando.getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.round(h / 24)
  if (d === 1) return 'ontem'
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(quando.getDate())}/${pad(quando.getMonth() + 1)}`
}
