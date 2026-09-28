import { chamar } from './pagamento'
import { REGRAS } from './acesso'

// A assinatura paga (128): rótulos e a conversa com a Edge Function
// assinatura-metodo. Regra fica no banco; aqui é transporte e texto.
export const METODOS = {
  pix_automatico: { rotulo: 'Pix Automático', curto: 'Pix Automático', desconto: REGRAS.descontoPixAutomaticoPct, explica: 'Você autoriza uma vez no app do seu banco e o débito cai sozinho todo mês. Sem cartão, sem esquecer.' },
  cartao: { rotulo: 'Cartão de crédito', curto: 'cartão', desconto: 0, explica: 'Cobrado automaticamente todo mês no cartão. O número não fica guardado na MIMO.' },
  pix: { rotulo: 'Pix à vista', curto: 'Pix', desconto: 0, explica: 'Paga hoje pelo QR Code. Todo mês a gente manda o Pix do mês seguinte pra você pagar.' },
}

export const comDesconto = (cents, pct) => Math.floor((cents * (100 - pct)) / 100 / 10) * 10

export function rotuloDoMetodo(acesso) {
  if (!acesso?.metodo) return null
  if (acesso.metodo === 'cartao') return `Cartão ${acesso.cartao_bandeira ? acesso.cartao_bandeira + ' ' : ''}final ${acesso.cartao_final ?? '····'}`
  if (acesso.metodo === 'pix_automatico') return 'Pix Automático' + (autorizado(acesso) ? '' : ' (aguardando a autorização no banco)')
  return 'Pix à vista, mês a mês'
}

export const autorizado = (acesso) => /ACTIVE|APPROVED|AUTHORIZED/i.test(String(acesso?.autorizacao_status ?? ''))

// { salao, acao, ...extra } → o que a função devolveu (lança com a mensagem de erro)
export const assinatura = (acao, salao, extra = {}) => chamar('assinatura-metodo', { salao, acao, ...extra })

export const mascaraCartao = (v) => v.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ')
export const mascaraValidade = (v) => { const d = v.replace(/\D/g, '').slice(0, 4); return d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d }
export function cartaoValido(numero) {
  const d = numero.replace(/\D/g, '')
  if (d.length < 13) return false
  let soma = 0, dobra = false
  for (let i = d.length - 1; i >= 0; i--) { let n = Number(d[i]); if (dobra) { n *= 2; if (n > 9) n -= 9 } soma += n; dobra = !dobra }
  return soma % 10 === 0
}
