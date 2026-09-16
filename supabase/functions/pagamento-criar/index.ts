// A cliente quer pagar um horário: abre a cobrança PIX na subconta da
// profissional e devolve o copia e cola.
//
//   POST { appointment_id }   com o token da cliente
//   → { ok, pagamento_id, copia_cola, valor_cents, expira_em }
//
// O banco decide o que pode (pagamento_preparar): horário dela, ainda
// não pago, salão que recebe pelo app, CPF preenchido. Aqui é só a
// conversa com o Asaas. O split manda a parte do MIMO para a wallet
// da conta-pai (MIMO_WALLET_ID / MIMO_TAXA_PCT).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { garantirCliente, criarCobrancaPix, json, preflight, ErroAsaas } from '../_shared/asaas.ts'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? ''
const servico = createClient(URL_SUPABASE, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ erro: 'entre na sua conta' }, 401)
  const quem = createClient(URL_SUPABASE, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: u } = await quem.auth.getUser()
  if (!u?.user) return json({ erro: 'entre na sua conta' }, 401)

  let corpo: { appointment_id?: string } = {}
  try { corpo = await req.json() } catch { return json({ erro: 'corpo inválido' }, 400) }
  if (!corpo.appointment_id) return json({ erro: 'horário?' }, 400)

  const { data: prep, error } = await servico.rpc('pagamento_preparar', { appt: corpo.appointment_id, cliente: u.user.id })
  if (error) return json({ erro: error.message }, 500)
  if (!prep?.ok) return json({ ok: false, motivo: prep?.motivo ?? 'não deu' }, prep?.motivo === 'sem_cpf' ? 200 : 400)

  // já tinha uma cobrança aberta: devolve ela
  if (prep.existente && prep.copia_cola) {
    return json({ ok: true, pagamento_id: prep.pagamento_id, copia_cola: prep.copia_cola, valor_cents: prep.valor_cents, expira_em: prep.expira_em, sinal_pct: prep.sinal_pct, existente: true })
  }

  const { data: chaveSub } = await servico.rpc('ler_segredo', { nome: `asaas_sub_${prep.salon_id}` })
  if (!chaveSub) return json({ erro: 'a conta de recebimento desta profissional não está pronta' }, 409)

  try {
    let customer: string = prep.customer_id ?? ''
    if (!customer) {
      customer = await garantirCliente(String(chaveSub), { nome: prep.cliente.nome ?? 'Cliente', cpf: prep.cliente.cpf, telefone: prep.cliente.telefone, email: u.user.email, ref: u.user.id })
      await servico.from('pagadores').upsert({ client_id: u.user.id, salon_id: prep.salon_id, customer_id: customer })
    }
    const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)   // dia local (UTC-3), o Asaas não aceita vencimento no passado
    const taxa = Number(Deno.env.get('MIMO_TAXA_PCT') ?? '0')
    const cob = await criarCobrancaPix(String(chaveSub), {
      customer, valorCents: prep.valor_cents, descricao: prep.descricao, ref: prep.pagamento_id, vencimento: hoje,
      splitWallet: Deno.env.get('MIMO_WALLET_ID') ?? undefined, splitPct: taxa,
    })
    const mimoCents = taxa > 0 && cob.netValue ? Math.round(cob.netValue * 100 * taxa / 100) : 0
    await servico.from('pagamentos').update({
      cobranca_id: cob.id, customer_id: customer, copia_cola: cob.copiaCola, link_url: cob.link,
      liquido_cents: cob.netValue != null ? Math.round(cob.netValue * 100) : null, mimo_cents: mimoCents, atualizado_em: new Date().toISOString(),
    }).eq('id', prep.pagamento_id)
    return json({ ok: true, pagamento_id: prep.pagamento_id, copia_cola: cob.copiaCola, valor_cents: prep.valor_cents, expira_em: prep.expira_em, sinal_pct: prep.sinal_pct, existente: false })
  } catch (e) {
    const msg = e instanceof ErroAsaas ? e.message : String(e)
    await servico.from('pagamentos').update({ status: 'falhou', erro: msg.slice(0, 300), atualizado_em: new Date().toISOString() }).eq('id', prep.pagamento_id)
    return json({ erro: 'Não deu para gerar o PIX: ' + msg }, 502)
  }
})
