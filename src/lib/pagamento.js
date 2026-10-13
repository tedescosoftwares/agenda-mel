import { supabase, isDemo } from './supabase'

// Pagamento pelo app (090): o que o front precisa saber e como fala com
// as Edge Functions. Tudo que é regra fica no banco e nas funções; aqui
// é só rótulo e transporte.

// modos, políticas, textos e formatCents vivem em packages/core (compartilhado com o app)
export { MODOS, SINAIS, POLITICAS, CREDITO_DIAS, TERMOS_VERSAO, TAXA_PIX_TEXTO, textoPolitica, textoSinal, COMO_FUNCIONA, formatCents } from '../../packages/core/pagamento.js'

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
