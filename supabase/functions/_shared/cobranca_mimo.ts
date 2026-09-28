// Leva uma cobrança da MIMO (cobrancas_mimo) pro Asaas, pelo método dela,
// e grava o que voltou. Usada pela função da dona (à vista, na hora) e
// pela do relógio (primeira cobrança e renovações).
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { garantirClienteMimo, cobrarCartao, cobrarPixMimo, cobrarPixAutomatico, AMBIENTE, PAGO, ErroAsaas } from './asaas.ts'

// deno-lint-ignore no-explicit-any
export type Lote = Record<string, any>

export async function criarNoAsaas(db: SupabaseClient, c: Lote, ip = '127.0.0.1') {
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
  const vencimento = c.vencimento && String(c.vencimento) > hoje ? String(c.vencimento) : hoje
  const ref = `mimo:${c.id}`
  try {
    let customer: string = c.customer_id ?? ''
    if (!customer) {
      customer = await garantirClienteMimo({ nome: c.nome, documento: c.documento, telefone: c.telefone, email: c.email, ref: `salao:${c.salon_id}` })
    }
    if (c.metodo === 'cartao') {
      if (!c.cartao_token) throw new ErroAsaas(409, 'sem cartão vinculado')
      const r = await cobrarCartao({ customer, token: c.cartao_token, valorCents: c.total_cents, descricao: c.descricao, ref, vencimento, ip })
      const pago = PAGO.has(r.status)
      await db.rpc('cobranca_mimo_atualizar', { cobranca: c.id, dados: { status: pago ? 'aguardando' : 'aguardando', cobranca_id: r.id, link_url: r.link, customer_id: customer, tentativa: true } })
      if (pago) await db.rpc('cobranca_mimo_confirmar', { cobranca: c.id, cobranca_asaas: r.id, quando: new Date().toISOString() })
      else if (!['PENDING', 'AWAITING_RISK_ANALYSIS'].includes(r.status)) await db.rpc('cobranca_mimo_falhou', { cobranca: c.id, motivo: 'cartão não autorizado (' + r.status + ')' })
      return { ok: true, status: pago ? 'pago' : 'aguardando', cobranca_id: r.id }
    }
    if (c.metodo === 'pix_automatico') {
      if (!c.autorizacao_id) throw new ErroAsaas(409, 'sem autorização de Pix Automático')
      const r = await cobrarPixAutomatico({ customer, autorizacao: c.autorizacao_id, valorCents: c.total_cents, descricao: c.descricao, ref, vencimento })
      await db.rpc('cobranca_mimo_atualizar', { cobranca: c.id, dados: { status: 'aguardando', cobranca_id: r.id, customer_id: customer, tentativa: true } })
      if (PAGO.has(r.status)) await db.rpc('cobranca_mimo_confirmar', { cobranca: c.id, cobranca_asaas: r.id, quando: new Date().toISOString() })
      return { ok: true, status: PAGO.has(r.status) ? 'pago' : 'aguardando', cobranca_id: r.id }
    }
    // pix avulso: QR pra dona pagar
    const r = await cobrarPixMimo({ customer, valorCents: c.total_cents, descricao: c.descricao, ref, vencimento })
    await db.rpc('cobranca_mimo_atualizar', { cobranca: c.id, dados: { status: 'aguardando', cobranca_id: r.id, copia_cola: r.copiaCola, link_url: r.link, customer_id: customer, tentativa: true } })
    return { ok: true, status: 'aguardando', cobranca_id: r.id, copia_cola: r.copiaCola, imagem: r.imagem, expira: r.expira, sandbox: AMBIENTE !== 'producao' }
  } catch (e) {
    const msg = e instanceof ErroAsaas ? e.message : String(e)
    await db.rpc('cobranca_mimo_falhou', { cobranca: c.id, motivo: msg })
    return { ok: false, erro: msg }
  }
}
