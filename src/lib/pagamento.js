import { supabase, isDemo } from './supabase'

// Pagamento pelo app (090): o que o front precisa saber e como fala com
// as Edge Functions. Tudo que é regra fica no banco e nas funções; aqui
// é só rótulo e transporte.

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
  if (nome === 'assinatura-metodo') {
    const acesso = { fase: 'teste', tipo: 'salao', situacao: 'teste', teste: true, dias: 5, ate: new Date(Date.now() + 5 * 86400e3).toISOString(), cobrar_em: new Date(Date.now() + 5 * 86400e3).toISOString(), mensalidade: { agendas: 5, plano: 'pro', valor_cents: 6970, desconto_cents: 0, total_cents: 6970 }, bonus_usado: false }
    const qr = '00020126580014br.gov.bcb.pix0136demo-mimo-assinatura5204000053039865406069.705802BR5904MIMO6006Santos62070503***6304ABCD'
    if (corpo?.acao === 'inicio_pix') return { ok: true, cobranca: { id: 'cm-inicial', status: 'aguardando', metodo: 'pix', copia_cola: qr, total_cents: 5576, vencimento: new Date().toISOString().slice(0, 10), sandbox: true }, acesso: { fase: 'configurando', tipo: 'salao', ativacao_pendente: true } }
    if (corpo?.acao === 'inicio_cartao') return { ok: true, cobranca: { id: 'cm-inicial', status: 'CONFIRMED', metodo: 'cartao', total_cents: 5576 }, cartao: { final: '4242', bandeira: 'VISA' }, acesso: { ...acesso, fase: 'ativa', teste: false, ate: new Date(Date.now() + 30 * 86400e3).toISOString(), metodo: 'cartao', recorrente: false } }
    if (corpo?.acao === 'inicio_conferir') return { ok: true, estado: { desconto_pct: 20, valor_cents: 6970, oferta_cents: 5576, cobranca: { id: 'cm-inicial', status: 'pago', metodo: 'pix', total_cents: 5576 } }, acesso: { ...acesso, fase: 'ativa', teste: false, ate: new Date(Date.now() + 30 * 86400e3).toISOString(), metodo: 'pix', recorrente: false } }
    if (corpo?.acao === 'inicio_cancelar') return { ok: true, estado: { desconto_pct: 20, valor_cents: 6970, oferta_cents: 5576, cobranca: null }, acesso: { fase: 'configurando', tipo: 'salao', ativacao_pendente: true } }
    if (corpo?.acao === 'renovar_pix') return { ok: true, cobranca: { id: 'cm-renovar', status: 'aguardando', metodo: 'pix', copia_cola: qr, total_cents: 6970, vencimento: new Date().toISOString().slice(0, 10), sandbox: true }, acesso }
    if (corpo?.acao === 'renovar_cartao') return { ok: true, cobranca: { id: 'cm-renovar', status: 'CONFIRMED', metodo: 'cartao', total_cents: 6970 }, cartao: { final: '4242', bandeira: 'VISA' }, acesso: { ...acesso, fase: 'ativa', teste: false, ate: new Date(Date.now() + 30 * 86400e3).toISOString(), metodo: 'cartao', recorrente: false } }
    if (corpo?.acao === 'cartao') return { ok: true, cartao: { final: '4242', bandeira: 'VISA' }, cobranca: corpo.cobrar_agora ? { ok: true, status: 'pago' } : null, acesso: corpo.cobrar_agora ? { ...acesso, fase: 'ativa', ate: new Date(Date.now() + 37 * 86400e3).toISOString(), metodo: 'cartao', cartao_final: '4242' } : { ...acesso, metodo: 'cartao', cartao_final: '4242' } }
    if (corpo?.acao === 'pix_automatico') return { ok: true, autorizacao: { id: 'aut_demo', status: 'CREATED', copiaCola: qr, imagem: null }, cobranca: { id: 'cm-pa', total_cents: 6270, status: 'aguardando' }, acesso: { ...acesso, metodo: 'pix_automatico', desconto_pct: 10, autorizacao_status: 'CREATED', autorizacao_qr: qr, pendente: { id: 'cm-pa', status: 'aguardando', metodo: 'pix_automatico', copia_cola: qr, total_cents: 6270 } } }
    if (corpo?.acao === 'pix_avista') return { ok: true, cobranca: { ok: true, id: 'cm-demo', status: 'aguardando', copia_cola: qr, total_cents: 6970, vencimento: new Date().toISOString().slice(0, 10), sandbox: true }, acesso: { ...acesso, metodo: 'pix', pendente: { id: 'cm-demo', status: 'aguardando', metodo: 'pix', copia_cola: qr, total_cents: 6970 } } }
    if (corpo?.acao === 'conferir') return { ok: true, acesso: { ...acesso, metodo: 'pix_automatico', autorizacao_status: 'CREATED', pendente: { id: 'cm-pa', status: 'aguardando', metodo: 'pix_automatico', total_cents: 6270 } } }
    if (corpo?.acao === 'simular') return { ok: true, acesso: { ...acesso, fase: 'ativa', ate: new Date(Date.now() + 37 * 86400e3).toISOString(), metodo: 'pix_automatico', autorizacao_status: 'ACTIVE', pendente: null } }
    if (corpo?.acao === 'cancelar') return { ok: true, acesso: { ...acesso, metodo: null } }
    if (corpo?.acao === 'descartar_pix') return { ok: true, descartados: 1, acesso: { ...acesso, pendente: null } }
  }
  return { ok: true }
}
