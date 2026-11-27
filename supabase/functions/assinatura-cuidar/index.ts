// Cuida das cobranças da MIMO (128; refeita na 3.94/234):
//   • a_criar (a rotina do banco deixou a próxima mensalidade pronta, vencendo no dia X): leva para o Asaas como Pix
//   • aguardando: confere no Asaas. Paga → confirma. Apagada lá → cancelada aqui. Passou do prazo (cancelar_em)
//     sem pagar → apaga no Asaas e fica cancelada (nada fica aberto para sempre, nem pagável depois).
// Não cria cobrança recorrente nem debita nada: só Pix que a dona paga.
//
// Roda pelo relógio (cuidar_das_assinaturas › chutar_assinaturas) com a chave de serviço, ou na unha:
//   curl -X POST .../functions/v1/assinatura-cuidar -H "Authorization: Bearer $SERVICE_ROLE_KEY"

import { clienteDoChamador, naoAutorizado, semPermissao } from '../_shared/porteiro.ts'
import { situacaoCobrancaMimo, apagarCobrancaMimo, situacaoAutorizacaoPixAutomatico, AMBIENTE, PAGO, ESTORNADA, AUTORIZADA, AUTORIZACAO_MORTA, json, ErroAsaas } from '../_shared/asaas.ts'
import { criarNoAsaas } from '../_shared/cobranca_mimo.ts'

Deno.serve(async (req) => {
  const db = clienteDoChamador(req)
  if (!db) return naoAutorizado()
  const { data: lote, error } = await db.rpc('cobrancas_mimo_para_cuidar', { quantos: 30 })
  if (semPermissao(error)) return naoAutorizado(error?.message)
  if (error) return json({ erro: error.message }, 500)
  const sandbox = AMBIENTE !== 'producao'
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
  const pagou = (st: string) => PAGO.has(st) && (st !== 'RECEIVED_IN_CASH' || sandbox)
  const quandoPagou = (real: { paymentDate?: string } | null) => real?.paymentDate ? new Date(real.paymentDate + 'T12:00:00-03:00').toISOString() : new Date().toISOString()

  let criadas = 0, pagas = 0, canceladas = 0, falhas = 0, conferidas = 0
  for (const c of lote ?? []) {
    // o prazo para pagar (234); antes da migração a linha não trazia: vencimento + 3
    const prazo = String(c.cancelar_em ?? '') || somarDias(String(c.vencimento), 3)
    try {
      // 4.45 (migração 276): a cobrança saiu porque a equipe mudou (ou a dona trocou de plano) e ainda está viva no
      // Asaas: apaga lá, para ninguém pagar o valor velho. Se ela pagou antes, o pagamento vale e a nova é que sai.
      if (c.status === 'cancelado') {
        if (!c.cobranca_id) { await db.rpc('cobranca_mimo_apagada', { cobranca: c.id, paga: false }); continue }
        const antes = await situacaoCobrancaMimo(c.cobranca_id)
        let foiPaga = pagou(antes.status), real = antes.real
        if (!foiPaga && !antes.apagada) {
          try { await apagarCobrancaMimo(c.cobranca_id) } catch (e) {
            const de_novo = await situacaoCobrancaMimo(c.cobranca_id)
            if (pagou(de_novo.status)) { foiPaga = true; real = de_novo.real } else if (!de_novo.apagada) throw e
          }
        }
        if (foiPaga) {
          await db.rpc('cobranca_mimo_apagada', { cobranca: c.id, paga: true })
          await db.rpc('cobranca_mimo_confirmar', { cobranca: c.id, cobranca_asaas: c.cobranca_id, quando: quandoPagou(real) }); pagas++
        } else { await db.rpc('cobranca_mimo_apagada', { cobranca: c.id, paga: false }); canceladas++ }
        continue
      }
      if (c.status === 'a_criar') {
        // só Pix nesta versão; cartão e Pix Automático antigos não são mais levados ao Asaas
        // sem CPF/CNPJ o Asaas recusa: cancela quieta (a dona vê o motivo certo quando tocar em pagar)
        if (!String(c.documento ?? '').replace(/\D/g, '')) {
          await db.rpc('cobranca_mimo_atualizar', { cobranca: c.id, dados: { status: 'cancelado', erro: 'sem CPF/CNPJ no cadastro do salão' } })
          canceladas++
          continue
        }
        if (c.metodo !== 'pix' || prazo < hoje) {
          await db.rpc('cobranca_mimo_atualizar', { cobranca: c.id, dados: { status: 'cancelado', erro: c.metodo !== 'pix' ? 'forma de pagamento desligada' : 'passou do prazo antes de ir ao Asaas' } })
          canceladas++
          continue
        }
        const r = await criarNoAsaas(db, c)
        if (r.ok) { criadas++; if (r.status === 'pago') pagas++ } else falhas++
        continue
      }

      // o primeiro mês do Pix Automático antigo: é o QR da autorização, sem cobrança própria
      if (!c.cobranca_id && c.metodo === 'pix_automatico' && c.autorizacao_id) {
        conferidas++
        const s = await situacaoAutorizacaoPixAutomatico(c.autorizacao_id)
        await db.rpc('cobranca_mimo_atualizar', { cobranca: c.id, dados: { autorizacao_status: s.status } })
        if (AUTORIZADA.test(s.status)) { await db.rpc('cobranca_mimo_confirmar', { cobranca: c.id, cobranca_asaas: null, quando: new Date().toISOString() }); pagas++ }
        else if (AUTORIZACAO_MORTA.test(s.status)) { await db.rpc('cobranca_mimo_atualizar', { cobranca: c.id, dados: { status: 'cancelado', erro: 'autorização ' + s.status } }); canceladas++ }
        continue
      }

      if (!c.cobranca_id) continue
      conferidas++
      const sit = await situacaoCobrancaMimo(c.cobranca_id)
      if (pagou(sit.status)) {
        await db.rpc('cobranca_mimo_confirmar', { cobranca: c.id, cobranca_asaas: c.cobranca_id, quando: quandoPagou(sit.real) }); pagas++
        continue
      }
      if (sit.apagada || ESTORNADA.has(sit.status)) {
        await db.rpc('cobranca_mimo_atualizar', { cobranca: c.id, dados: { status: 'cancelado', erro: sit.apagada ? 'apagada no Asaas' : 'não vai ser paga (' + sit.status + ')' } })
        canceladas++
        continue
      }
      if (prazo < hoje) {
        // passou do prazo sem pagar: apaga no Asaas (assim ninguém paga uma cobrança velha) e cancela aqui.
        // Se o Asaas recusar o apagar, relê: pode ter sido paga no meio do caminho.
        try {
          await apagarCobrancaMimo(c.cobranca_id)
        } catch (e) {
          const de_novo = await situacaoCobrancaMimo(c.cobranca_id)
          if (pagou(de_novo.status)) { await db.rpc('cobranca_mimo_confirmar', { cobranca: c.id, cobranca_asaas: c.cobranca_id, quando: quandoPagou(de_novo.real) }); pagas++; continue }
          if (!de_novo.apagada) throw e
        }
        await db.rpc('cobranca_mimo_atualizar', { cobranca: c.id, dados: { status: 'cancelado', erro: 'não paga até ' + prazo.split('-').reverse().join('/') } })
        canceladas++
        continue
      }
      await db.rpc('cobranca_mimo_atualizar', { cobranca: c.id, dados: {} })   // marca a conferência
    } catch (e) {
      await db.rpc('cobranca_mimo_atualizar', { cobranca: c.id, dados: { erro: e instanceof ErroAsaas ? e.message : String(e), ...(c.status === 'cancelado' ? { tentativa: true } : {}) } })
      falhas++
    }
  }
  return json({ lote: lote?.length ?? 0, criadas, pagas, canceladas, conferidas, falhas })
})

function somarDias(iso: string, dias: number) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}
