import { supabase, isDemo } from './supabase'

// Pagamento pelo app (090): o que o front precisa saber e como fala com
// as Edge Functions. Tudo que é regra fica no banco e nas funções; aqui
// é só rótulo e transporte.

export const MODOS = {
  nao: { rotulo: 'Não recebo pelo app', curto: null, explica: 'A cliente marca e paga com você, no atendimento.' },
  opcional: { rotulo: 'A cliente escolhe', curto: 'Paga pelo app', explica: 'Ela pode pagar pelo app na hora de marcar ou depois, mas não é obrigada.' },
  obrigatorio: { rotulo: 'Só com pagamento', curto: 'Só com pagamento', explica: 'O horário só fica reservado depois que o PIX cai. É o que mais reduz falta.' },
}

export const SINAIS = [30, 50, 100]

// a política de cancelamento (094): três jeitos, nada em aberto
export const POLITICAS = {
  flexivel: { rotulo: 'Flexível', horas: 6, explica: 'Até 6 h antes, devolve o sinal (menos a taxa do PIX) ou remarca levando o sinal. Depois disso, o sinal vira crédito por 30 dias.' },
  moderada: { rotulo: 'Moderada', horas: 12, explica: 'Até 12 h antes, devolve o sinal (menos a taxa do PIX) ou remarca levando o sinal. Depois disso, o sinal vira crédito por 30 dias.' },
  rigorosa: { rotulo: 'Rigorosa', horas: 24, explica: 'Até 24 h antes, devolve o sinal (menos a taxa do PIX) ou remarca levando o sinal. Depois disso, o sinal vira crédito por 30 dias.' },
}
export const CREDITO_DIAS = 30

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

// chama uma Edge Function com o token da pessoa logada
export async function chamar(nome, corpo) {
  if (isDemo) return demoFuncao(nome, corpo)
  const { data, error } = await supabase.functions.invoke(nome, { body: corpo })
  if (error) {
    // a função respondeu com erro e um corpo explicando
    let detalhe = error.message
    try { const j = await error.context?.json?.(); if (j?.erro) detalhe = j.erro } catch { /* sem corpo */ }
    throw new Error(detalhe)
  }
  if (data?.erro) throw new Error(data.erro)
  return data
}

export function formatCents(c) {
  return (Number(c ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// no demo as funções "dão certo" com dados fictícios
function demoFuncao(nome, corpo) {
  if (nome === 'pagamento-criar') {
    return { ok: true, pagamento_id: 'pg-demo', valor_cents: 4250, sinal_pct: 50, sandbox: true, expira_em: new Date(Date.now() + 14 * 60e3).toISOString(), existente: false,
      copia_cola: '00020126580014br.gov.bcb.pix0136demo-mimo-' + (corpo?.appointment_id ?? 'x') + '5204000053039865406017.505802BR5904MIMO6006Santos62070503***6304ABCD' }
  }
  if (nome === 'conta-recebimento') {
    return { ok: true, conta_id: 'acc_demo', status: corpo?.acao === 'criar' ? 'aguardando' : 'aprovada', documentos: corpo?.acao === 'criar' ? [{ id: 'd1', status: 'NOT_SENT', titulo: 'Documento de identificação', link: 'https://exemplo.local/onboarding' }] : [] }
  }
  return { ok: true }
}
