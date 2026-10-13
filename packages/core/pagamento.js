// Pagamento pelo app: rótulos, políticas e textos. O que é regra fica no
// banco e nas funções; aqui é só o que a web e o app mostram.

export const MODOS = {
  nao: { rotulo: 'Não recebo pelo app', curto: null, explica: 'A cliente marca e paga com você, no atendimento.' },
  opcional: { rotulo: 'A cliente escolhe', curto: 'Paga pelo app', explica: 'Ela pode pagar pelo app na hora de marcar ou depois, mas não é obrigada. O que ela paga entra confirmado.' },
  obrigatorio: { rotulo: 'Só com pagamento', curto: 'Só com pagamento', explica: 'O horário só fica reservado depois que o PIX cai, e já entra confirmado. É o que mais reduz falta.' },
}

export const SINAIS = [30, 50, 100]

// a política de cancelamento (094): três jeitos, nada em aberto
export const POLITICAS = {
  flexivel: { rotulo: 'Flexível', horas: 6, explica: 'Até 6 h antes, devolve o sinal (menos a taxa do PIX) ou remarca levando o sinal. Depois disso, o sinal vira crédito por 30 dias.' },
  moderada: { rotulo: 'Moderada', horas: 12, explica: 'Até 12 h antes, devolve o sinal (menos a taxa do PIX) ou remarca levando o sinal. Depois disso, o sinal vira crédito por 30 dias.' },
  rigorosa: { rotulo: 'Rigorosa', horas: 24, explica: 'Até 24 h antes, devolve o sinal (menos a taxa do PIX) ou remarca levando o sinal. Depois disso, o sinal vira crédito por 30 dias.' },
}
export const CREDITO_DIAS = 30
// a versão das condições que a cliente aceita antes de pagar (096): mude
// quando o texto mudar, para saber o que cada uma leu
export const TERMOS_VERSAO = '2026-09-17'
export const TAXA_PIX_TEXTO = 'até R$ 1,99'

// a mesma regra, contada para a cliente
export function textoPolitica(p) {
  const pol = POLITICAS[p] ?? POLITICAS.moderada
  return `Cancelamento ${pol.rotulo.toLowerCase()}: devolve até ${pol.horas} h antes (menos a taxa do PIX). Depois, o sinal vira crédito por ${CREDITO_DIAS} dias para remarcar.`
}

export function textoSinal(pct) {
  return pct >= 100 ? 'o valor inteiro' : `um sinal de ${pct}%`
}

// como funciona, prazos e taxas: o que a profissional lê antes de ativar.
// Os números vêm da negociação com o Asaas; ajuste aqui quando fechar.
export const COMO_FUNCIONA = {
  taxaPix: 'R$ 1,99 por PIX recebido (nos 3 primeiros meses, R$ 0,99)',
  prazo: 'o dinheiro fica disponível assim que o PIX cai, e o saque para a sua conta bancária é gratuito até 30 vezes por mês',
  provedor: 'Asaas Gestão Financeira Instituição de Pagamento S.A.',
}

export function formatCents(c) {
  return (Number(c ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
