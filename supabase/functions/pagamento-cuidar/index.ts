// Cuida do que ficou pendente lá no Asaas: estornos a fazer e cobranças
// de reservas que caíram (apaga para ninguém pagar tarde demais).
//
// Roda pelo relógio (chutar_pagamentos, dentro de rodar_rotinas) com a
// chave de serviço, ou na unha:
//   curl -X POST .../functions/v1/pagamento-cuidar -H "Authorization: Bearer $SERVICE_ROLE_KEY"

import { clienteDoChamador, naoAutorizado, semPermissao } from '../_shared/porteiro.ts'
import { estornarCobranca, apagarCobranca, json, ErroAsaas } from '../_shared/asaas.ts'

Deno.serve(async (req) => {
  const db = clienteDoChamador(req)
  if (!db) return naoAutorizado()
  const { data: lote, error } = await db.rpc('pagamentos_para_cuidar', { quantos: 20 })
  if (semPermissao(error)) return naoAutorizado(error?.message)
  if (error) return json({ erro: error.message }, 500)

  let estornados = 0, baixados = 0, falhas = 0
  for (const p of lote ?? []) {
    const { data: chaveSub } = await db.rpc('ler_segredo', { nome: `asaas_sub_${p.salon_id}` })
    if (!chaveSub) { await db.rpc('pagamento_cuidado', { pagamento: p.id, resultado: 'erro', detalhe: 'sem chave da subconta' }); falhas++; continue }
    try {
      if (p.status === 'estorno_pendente') {
        if (!p.cobranca_id) { await db.rpc('pagamento_cuidado', { pagamento: p.id, resultado: 'erro', detalhe: 'sem cobrança para estornar' }); falhas++; continue }
        await estornarCobranca(String(chaveSub), p.cobranca_id, p.estorno_cents && p.estorno_cents < p.valor_cents ? p.estorno_cents : null, p.motivo_estorno ?? 'cancelamento')
        await db.rpc('pagamento_cuidado', { pagamento: p.id, resultado: 'estornado' })
        estornados++
      } else {
        // expirado ou cancelado sem pagar: tira a cobrança do ar
        try { await apagarCobranca(String(chaveSub), p.cobranca_id) } catch (e) {
          // já apagada ou já paga: registra e segue
          if (!(e instanceof ErroAsaas && (e.status === 404 || e.status === 400))) throw e
        }
        await db.rpc('pagamento_cuidado', { pagamento: p.id, resultado: 'baixado' })
        baixados++
      }
    } catch (e) {
      await db.rpc('pagamento_cuidado', { pagamento: p.id, resultado: 'erro', detalhe: e instanceof ErroAsaas ? e.message : String(e) })
      falhas++
    }
  }
  return json({ pendentes: lote?.length ?? 0, estornados, baixados, falhas })
})
