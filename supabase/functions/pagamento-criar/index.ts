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
import { garantirCliente, criarCobrancaPix, garantirChavePix, pagarQrSandbox, baixarEmDinheiroSandbox, chavePai, AMBIENTE, json, preflight, ErroAsaas } from '../_shared/asaas.ts'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? ''
const servico = createClient(URL_SUPABASE, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ erro: 'entre na sua conta' }, 401)
  const quem = createClient(URL_SUPABASE, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: u } = await quem.auth.getUser()
  if (!u?.user) return json({ erro: 'entre na sua conta' }, 401)

  let corpo: { appointment_id?: string; simular?: boolean } = {}
  try { corpo = await req.json() } catch { return json({ erro: 'corpo inválido' }, 400) }
  if (!corpo.appointment_id) return json({ erro: 'horário?' }, 400)
  const sandbox = AMBIENTE !== 'producao'

  // sandbox: a conta do MIMO paga o QR, como uma cliente faria. Nunca em produção.
  if (corpo.simular) {
    if (!sandbox) return json({ erro: 'simulação só existe no sandbox' }, 403)
    const { data: pg } = await servico.from('pagamentos').select('id, salon_id, cobranca_id, copia_cola, valor_cents, status').eq('appointment_id', corpo.appointment_id).eq('client_id', u.user.id).eq('status', 'aguardando').order('criado_em', { ascending: false }).limit(1).maybeSingle()
    if (!pg?.cobranca_id) return json({ erro: 'não há PIX aguardando para este horário' }, 404)
    let motivoPix = ''
    // 1º: a conta do MIMO paga o QR (precisa de saldo e chave Pix no sandbox)
    try {
      const r = await pagarQrSandbox(chavePai(), pg.copia_cola, pg.valor_cents, pg.id)
      return json({ ok: true, jeito: 'pix', transacao: r.id || null, status: r.status, pendente: r.status !== 'DONE', repetida: r.repetida })
    } catch (e) { motivoPix = e instanceof ErroAsaas ? e.message : String(e) /* sem saldo ou sem chave: vai pelo 2º */ }
    // 2º: a subconta dá baixa como "recebido em dinheiro"; dispara o mesmo webhook
    const { data: chaveSub } = await servico.rpc('ler_segredo', { nome: `asaas_sub_${pg.salon_id}` })
    if (!chaveSub) return json({ erro: 'sem chave da subconta' }, 409)
    try {
      await baixarEmDinheiroSandbox(String(chaveSub), pg.cobranca_id, pg.valor_cents)
      return json({ ok: true, jeito: 'baixa', motivo_pix: motivoPix })
    } catch (e) {
      return json({ erro: 'A simulação não passou: ' + (e instanceof ErroAsaas ? e.message : String(e)) }, 502)
    }
  }

  const { data: prep, error } = await servico.rpc('pagamento_preparar', { appt: corpo.appointment_id, cliente: u.user.id })
  if (error) return json({ erro: error.message }, 500)
  if (!prep?.ok) return json({ ok: false, motivo: prep?.motivo ?? 'não deu' }, prep?.motivo === 'sem_cpf' ? 200 : 400)

  // já tinha uma cobrança aberta: devolve ela
  if (prep.existente && prep.copia_cola) {
    return json({ ok: true, pagamento_id: prep.pagamento_id, copia_cola: prep.copia_cola, valor_cents: prep.valor_cents, expira_em: prep.expira_em, sinal_pct: prep.sinal_pct, existente: true, sandbox })
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
    const pedido = { customer, valorCents: prep.valor_cents, descricao: prep.descricao, ref: prep.pagamento_id, vencimento: hoje, splitWallet: Deno.env.get('MIMO_WALLET_ID') ?? undefined, splitPct: taxa }
    let cob
    try {
      cob = await criarCobrancaPix(String(chaveSub), pedido)
    } catch (e) {
      // subconta sem chave Pix: cria uma aleatória e tenta de novo uma vez
      if (e instanceof ErroAsaas && /chave pix/i.test(e.message)) {
        const pix = await garantirChavePix(String(chaveSub))
        await servico.from('contas_de_recebimento').update({ pix_pronto: pix.ok, pix_chave: pix.chave ?? null, atualizado_em: new Date().toISOString() }).eq('salon_id', prep.salon_id)
        if (!pix.ok) throw new ErroAsaas(409, 'a conta de recebimento ainda não tem chave Pix ativa' + (pix.status === 'AWAITING_ACTIVATION' ? ' (ativação em andamento, tente em instantes)' : pix.erro ? ': ' + pix.erro : ''))
        cob = await criarCobrancaPix(String(chaveSub), pedido)
      } else throw e
    }
    const mimoCents = taxa > 0 && cob.netValue ? Math.round(cob.netValue * 100 * taxa / 100) : 0
    await servico.from('pagamentos').update({
      cobranca_id: cob.id, customer_id: customer, copia_cola: cob.copiaCola, link_url: cob.link,
      liquido_cents: cob.netValue != null ? Math.round(cob.netValue * 100) : null, mimo_cents: mimoCents, atualizado_em: new Date().toISOString(),
    }).eq('id', prep.pagamento_id)
    return json({ ok: true, pagamento_id: prep.pagamento_id, copia_cola: cob.copiaCola, valor_cents: prep.valor_cents, expira_em: prep.expira_em, sinal_pct: prep.sinal_pct, existente: false, sandbox })
  } catch (e) {
    const msg = e instanceof ErroAsaas ? e.message : String(e)
    await servico.from('pagamentos').update({ status: 'falhou', erro: msg.slice(0, 300), atualizado_em: new Date().toISOString() }).eq('id', prep.pagamento_id)
    return json({ erro: 'Não deu para gerar o PIX: ' + msg }, 502)
  }
})
