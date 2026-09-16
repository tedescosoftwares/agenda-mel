// O Asaas avisa: cobrança paga, estornada, apagada; subconta aprovada.
//
// Público (deploy com --no-verify-jwt). A porta é o token no header
// asaas-access-token, o mesmo ASAAS_WEBHOOK_TOKEN cadastrado no webhook
// de cada subconta. E antes de dar baixa a gente confere a cobrança na
// API com a chave da subconta: o POST sozinho não vale como prova.
//
// Sempre responde 200 para o que entende ou ignora; erro de verdade
// (banco fora) responde 500 e o Asaas tenta de novo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { obterCobranca, situacaoDaSubconta, json } from '../_shared/asaas.ts'

const servico = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true })
  const esperado = Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? ''
  const recebido = req.headers.get('asaas-access-token') ?? ''
  if (!esperado || recebido !== esperado) return json({ erro: 'token' }, 401)

  // deno-lint-ignore no-explicit-any
  let ev: any = null
  try { ev = await req.json() } catch { return json({ ok: true, ignorado: 'corpo' }) }
  const tipo = String(ev?.event ?? '')

  if (tipo.startsWith('PAYMENT_')) {
    const pay = ev.payment ?? {}
    const ref = String(pay.externalReference ?? '')
    const cobranca = String(pay.id ?? '')
    // a nossa linha: pela referência (o id do pagamento) ou pelo id da cobrança
    let linha = null
    if (/^[0-9a-f-]{36}$/i.test(ref)) {
      const { data } = await servico.from('pagamentos').select('id, salon_id, status, valor_cents').eq('id', ref).maybeSingle()
      linha = data
    }
    if (!linha && cobranca) {
      const { data } = await servico.from('pagamentos').select('id, salon_id, status, valor_cents').eq('cobranca_id', cobranca).maybeSingle()
      linha = data
    }
    if (!linha) return json({ ok: true, ignorado: 'cobrança desconhecida' })

    if (tipo === 'PAYMENT_RECEIVED' || tipo === 'PAYMENT_CONFIRMED') {
      // confere na fonte antes de acreditar
      const { data: chaveSub } = await servico.rpc('ler_segredo', { nome: `asaas_sub_${linha.salon_id}` })
      if (!chaveSub) return json({ erro: 'sem chave da subconta' }, 500)
      let real
      try { real = await obterCobranca(String(chaveSub), cobranca) } catch (e) { return json({ erro: 'não deu para conferir: ' + String(e) }, 500) }
      const st = String(real?.status ?? '')
      if (st !== 'RECEIVED' && st !== 'CONFIRMED') return json({ ok: true, ignorado: 'status ' + st })
      const liquido = real?.netValue != null ? Math.round(Number(real.netValue) * 100) : null
      const quando = real?.paymentDate ? new Date(real.paymentDate + 'T12:00:00-03:00').toISOString() : new Date().toISOString()
      const { data: r, error } = await servico.rpc('confirmar_pagamento', { pagamento: linha.id, cobranca, liquido, quando })
      if (error) return json({ erro: error.message }, 500)
      return json({ ok: true, resultado: r })
    }

    if (tipo === 'PAYMENT_REFUNDED') {
      await servico.from('pagamentos').update({ status: 'estornado', estornado_em: new Date().toISOString(), baixa_no_provedor_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
        .eq('id', linha.id).in('status', ['pago', 'estorno_pendente', 'retido'])
      return json({ ok: true })
    }

    if (tipo === 'PAYMENT_DELETED' || tipo === 'PAYMENT_OVERDUE') {
      await servico.from('pagamentos').update({ status: linha.status === 'aguardando' ? 'cancelado' : linha.status, baixa_no_provedor_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
        .eq('id', linha.id)
      return json({ ok: true })
    }
    return json({ ok: true, ignorado: tipo })
  }

  if (tipo.startsWith('ACCOUNT_STATUS_')) {
    // a subconta mudou de situação: relê tudo com a chave dela
    const contaId = String(ev.account?.id ?? ev.accountStatus?.id ?? '')
    if (!contaId) return json({ ok: true, ignorado: 'sem conta' })
    const { data: c } = await servico.from('contas_de_recebimento').select('salon_id').eq('conta_id', contaId).maybeSingle()
    if (!c) return json({ ok: true, ignorado: 'conta desconhecida' })
    const { data: chaveSub } = await servico.rpc('ler_segredo', { nome: `asaas_sub_${c.salon_id}` })
    if (!chaveSub) return json({ ok: true, ignorado: 'sem chave' })
    try {
      const situ = await situacaoDaSubconta(String(chaveSub))
      await servico.from('contas_de_recebimento').update({ status: situ.status, situacao: situ.situacao, documentos: situ.documentos, atualizado_em: new Date().toISOString() }).eq('salon_id', c.salon_id)
    } catch (e) { return json({ erro: String(e) }, 500) }
    return json({ ok: true })
  }

  return json({ ok: true, ignorado: tipo })
})
