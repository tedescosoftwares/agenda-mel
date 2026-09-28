// Cuida das cobranças da MIMO (128): leva pro Asaas o que a rotina abriu
// (primeira cobrança, renovações, novas tentativas) e confere o que está
// aguardando (cartão, Pix Automático e Pix vencido), pra não depender só
// do webhook.
//
// Roda pelo relógio (chutar_assinaturas, dentro de cuidar_das_assinaturas)
// com a chave de serviço, ou na unha:
//   curl -X POST .../functions/v1/assinatura-cuidar -H "Authorization: Bearer $SERVICE_ROLE_KEY"

import { clienteDoChamador, naoAutorizado, semPermissao } from '../_shared/porteiro.ts'
import { obterCobrancaMimo, situacaoAutorizacaoPixAutomatico, AMBIENTE, PAGO, NAO_VAI_PAGAR, json, ErroAsaas } from '../_shared/asaas.ts'
import { criarNoAsaas } from '../_shared/cobranca_mimo.ts'

Deno.serve(async (req) => {
  const db = clienteDoChamador(req)
  if (!db) return naoAutorizado()
  const { data: lote, error } = await db.rpc('cobrancas_mimo_para_cuidar', { quantos: 30 })
  if (semPermissao(error)) return naoAutorizado(error?.message)
  if (error) return json({ erro: error.message }, 500)
  const sandbox = AMBIENTE !== 'producao'
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)

  let criadas = 0, pagas = 0, expiradas = 0, falhas = 0, conferidas = 0
  for (const c of lote ?? []) {
    try {
      if (c.status === 'a_criar') {
        // Pix Automático ainda não autorizado no banco: espera (a rotina volta a chamar)
        if (c.metodo === 'pix_automatico' && c.autorizacao_id && !/ACTIVE|APPROVED|AUTHORIZED/i.test(String(c.autorizacao_status ?? ''))) {
          const s = await situacaoAutorizacaoPixAutomatico(c.autorizacao_id).catch(() => null)
          if (s) await db.rpc('cobranca_mimo_atualizar', { cobranca: c.id, dados: { autorizacao_status: s.status } })
          if (!s || !/ACTIVE|APPROVED|AUTHORIZED/i.test(s.status)) {
            if (String(c.vencimento) < hoje) { await db.rpc('cobranca_mimo_falhou', { cobranca: c.id, motivo: 'Pix Automático ainda não autorizado no banco' }); falhas++ }
            continue
          }
        }
        const r = await criarNoAsaas(db, c)
        if (r.ok) { criadas++; if (r.status === 'pago') pagas++ } else falhas++
        continue
      }
      // aguardando: confere na fonte
      if (!c.cobranca_id) continue
      conferidas++
      const real = await obterCobrancaMimo(c.cobranca_id)
      const st = String(real?.status ?? '')
      if (PAGO.has(st) && (st !== 'RECEIVED_IN_CASH' || sandbox)) {
        const quando = real?.paymentDate ? new Date(real.paymentDate + 'T12:00:00-03:00').toISOString() : new Date().toISOString()
        await db.rpc('cobranca_mimo_confirmar', { cobranca: c.id, cobranca_asaas: c.cobranca_id, quando }); pagas++
      } else if (NAO_VAI_PAGAR.has(st) || (c.metodo === 'pix' && String(c.vencimento) < hoje && st === 'OVERDUE')) {
        if (c.metodo === 'pix') { await db.rpc('cobranca_mimo_atualizar', { cobranca: c.id, dados: { status: 'expirado', erro: 'venceu sem pagamento (' + st + ')' } }); expiradas++ }
        else { await db.rpc('cobranca_mimo_falhou', { cobranca: c.id, motivo: 'não pago (' + st + ')' }); falhas++ }
      } else {
        await db.rpc('cobranca_mimo_atualizar', { cobranca: c.id, dados: {} })   // marca a conferência
      }
    } catch (e) {
      await db.rpc('cobranca_mimo_atualizar', { cobranca: c.id, dados: { erro: e instanceof ErroAsaas ? e.message : String(e) } })
      falhas++
    }
  }
  return json({ lote: lote?.length ?? 0, criadas, pagas, expiradas, conferidas, falhas })
})
