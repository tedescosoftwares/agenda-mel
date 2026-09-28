// A dona escolhe como pagar a MIMO (128).
//
//   POST { salao, acao, ... }   com o token da dona
//   acao:
//     cartao          { cartao: {nome, numero, mes, ano, cvv}, titular: {cep, numero}, cobrar_agora }
//                     tokeniza (o número não fica guardado), vincula; com cobrar_agora paga o
//                     primeiro mês na hora (30 + 7 dias de bônus)
//     pix_automatico  cria a autorização (modo MANUAL) e devolve o QR pra autorizar no banco
//     pix_avista      abre a cobrança do primeiro mês por Pix e devolve o copia e cola
//     conferir        relê a autorização do Pix Automático / a cobrança Pix pendente
//     cancelar        cancela a autorização no Asaas e a assinatura (usa até o fim do pago)
//     simular         só no sandbox: dá baixa na cobrança Pix pendente como se tivesse pago
//
// O banco decide o que pode (assinatura_preparar); aqui é só a conversa
// com o Asaas, na conta-pai.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { garantirClienteMimo, tokenizarCartao, criarAutorizacaoPixAutomatico, situacaoAutorizacaoPixAutomatico, cancelarAutorizacaoPixAutomatico, obterCobrancaMimo, baixarCobrancaMimoSandbox, apagarCobrancaMimo, AMBIENTE, PAGO, json, preflight, ErroAsaas } from '../_shared/asaas.ts'
import { criarNoAsaas } from '../_shared/cobranca_mimo.ts'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? ''
const servico = createClient(URL_SUPABASE, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ erro: 'entre na sua conta' }, 401)
  const quem = createClient(URL_SUPABASE, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: u } = await quem.auth.getUser()
  if (!u?.user) return json({ erro: 'entre na sua conta' }, 401)

  // deno-lint-ignore no-explicit-any
  let corpo: any = {}
  try { corpo = await req.json() } catch { return json({ erro: 'corpo inválido' }, 400) }
  if (!corpo.salao || !corpo.acao) return json({ erro: 'salão e ação?' }, 400)
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || '127.0.0.1'
  const sandbox = AMBIENTE !== 'producao'

  // só a dona passa daqui (a função confere)
  const { data: prep, error: ePrep } = await quem.rpc('assinatura_preparar', { salao: corpo.salao })
  if (ePrep) return json({ erro: ePrep.message }, 403)
  const salao: string = prep.salon_id
  const acesso = () => servico.rpc('acesso_do_salao', { salao }).then((r) => r.data)

  try {
    if (corpo.acao === 'cartao') {
      const c = corpo.cartao ?? {}; const t = corpo.titular ?? {}
      if (!c.numero || !c.nome || !c.mes || !c.ano || !c.cvv) return json({ erro: 'Preencha os dados do cartão.' }, 400)
      const customer = prep.customer_id || await garantirClienteMimo({ nome: prep.razao_social, documento: prep.documento, telefone: prep.telefone, email: prep.email, ref: `salao:${salao}` })
      const tk = await tokenizarCartao(customer, c, { nome: c.nome, email: prep.email, documento: t.documento || prep.documento, cep: t.cep || prep.cep || '', numero: t.numero || prep.numero || '', telefone: prep.telefone }, ip)
      if (!tk.token) return json({ erro: 'O Asaas não devolveu o token do cartão.' }, 502)
      await servico.rpc('assinatura_metodo_definir', { salao, metodo_: 'cartao', dados: { customer_id: customer, cartao_token: tk.token, cartao_final: tk.final, cartao_bandeira: tk.bandeira } })
      let cobranca = null
      if (corpo.cobrar_agora) {
        const { data: ab, error } = await servico.rpc('cobranca_mimo_abrir', { salao, tipo_: 'avista', metodo_: 'cartao' })
        if (error) return json({ erro: error.message }, 400)
        const { data: lote } = await servico.rpc('cobrancas_mimo_para_cuidar', { quantos: 50 })
        const linha = (lote ?? []).find((x: { id: string }) => x.id === ab.id)
        cobranca = linha ? await criarNoAsaas(servico, linha, ip) : { ok: false, erro: 'cobrança não encontrada' }
        if (!cobranca.ok) return json({ erro: 'O cartão foi vinculado, mas a cobrança não passou: ' + cobranca.erro, acesso: await acesso() }, 402)
      }
      return json({ ok: true, cartao: { final: tk.final, bandeira: tk.bandeira }, cobranca, acesso: await acesso() })
    }

    if (corpo.acao === 'pix_automatico') {
      const customer = prep.customer_id || await garantirClienteMimo({ nome: prep.razao_social, documento: prep.documento, telefone: prep.telefone, email: prep.email, ref: `salao:${salao}` })
      // já tem uma autorização em pé? devolve ela
      if (prep.autorizacao_id && prep.metodo === 'pix_automatico') {
        const s = await situacaoAutorizacaoPixAutomatico(prep.autorizacao_id).catch(() => null)
        if (s && !/CANCEL|EXPIRED|REJECT/i.test(s.status)) {
          await servico.rpc('assinatura_metodo_definir', { salao, metodo_: 'pix_automatico', dados: { autorizacao_status: s.status, autorizacao_qr: s.copiaCola || undefined, autorizacao_imagem: s.imagem || undefined } })
          return json({ ok: true, autorizacao: s, existente: true, acesso: await acesso() })
        }
      }
      const cobrarEm = prep.acesso?.cobrar_em ?? prep.acesso?.ate
      const inicio = (cobrarEm ? new Date(cobrarEm) : new Date(Date.now() + 8 * 86400e3)).toISOString().slice(0, 10)
      const teto = Math.max(Number(prep.mensalidade?.total_cents ?? 4490) * 2, 20000)   // folga pro plano crescer
      const a = await criarAutorizacaoPixAutomatico({ customer, descricao: `MIMO · ${prep.nome}`, inicio, tetoCents: teto, ref: `salao:${salao}` })
      await servico.rpc('assinatura_metodo_definir', { salao, metodo_: 'pix_automatico', dados: { customer_id: customer, autorizacao_id: a.id, autorizacao_status: a.status, autorizacao_qr: a.copiaCola, autorizacao_imagem: a.imagem } })
      return json({ ok: true, autorizacao: a, existente: false, acesso: await acesso() })
    }

    if (corpo.acao === 'pix_avista') {
      const customer = prep.customer_id || await garantirClienteMimo({ nome: prep.razao_social, documento: prep.documento, telefone: prep.telefone, email: prep.email, ref: `salao:${salao}` })
      if (prep.metodo !== 'pix') await servico.rpc('assinatura_metodo_definir', { salao, metodo_: 'pix', dados: { customer_id: customer } })
      const { data: ab, error } = await servico.rpc('cobranca_mimo_abrir', { salao, tipo_: 'avista', metodo_: 'pix' })
      if (error) return json({ erro: error.message }, 400)
      const { data: lote } = await servico.rpc('cobrancas_mimo_para_cuidar', { quantos: 50 })
      const linha = (lote ?? []).find((x: { id: string }) => x.id === ab.id)
      if (!linha) {
        // já existia e já tem QR
        const { data: c } = await servico.from('cobrancas_mimo').select('id, copia_cola, total_cents, vencimento, status').eq('id', ab.id).maybeSingle()
        return json({ ok: true, cobranca: c ? { ok: true, status: c.status, copia_cola: c.copia_cola, total_cents: c.total_cents, vencimento: c.vencimento, id: c.id, sandbox } : null, acesso: await acesso() })
      }
      const r = await criarNoAsaas(servico, linha, ip)
      if (!r.ok) return json({ erro: 'Não deu para gerar o Pix: ' + r.erro }, 502)
      return json({ ok: true, cobranca: { ...r, id: ab.id, total_cents: linha.total_cents, vencimento: linha.vencimento }, acesso: await acesso() })
    }

    if (corpo.acao === 'conferir') {
      if (prep.metodo === 'pix_automatico' && prep.autorizacao_id) {
        const s = await situacaoAutorizacaoPixAutomatico(prep.autorizacao_id)
        await servico.rpc('assinatura_metodo_definir', { salao, metodo_: 'pix_automatico', dados: { autorizacao_status: s.status, autorizacao_qr: s.copiaCola || undefined, autorizacao_imagem: s.imagem || undefined } })
      }
      // a cobrança Pix pendente: caiu?
      const { data: pend } = await servico.from('cobrancas_mimo').select('id, cobranca_id, status').eq('salon_id', salao).eq('status', 'aguardando').order('criado_em', { ascending: false }).limit(1).maybeSingle()
      if (pend?.cobranca_id) {
        const real = await obterCobrancaMimo(pend.cobranca_id).catch(() => null)
        const st = String(real?.status ?? '')
        if (PAGO.has(st) && (st !== 'RECEIVED_IN_CASH' || sandbox)) await servico.rpc('cobranca_mimo_confirmar', { cobranca: pend.id, cobranca_asaas: pend.cobranca_id, quando: real?.paymentDate ? new Date(real.paymentDate + 'T12:00:00-03:00').toISOString() : new Date().toISOString() })
      }
      return json({ ok: true, acesso: await acesso() })
    }

    if (corpo.acao === 'cancelar') {
      if (prep.autorizacao_id) { try { await cancelarAutorizacaoPixAutomatico(prep.autorizacao_id) } catch (_) { /* segue: o banco desvincula mesmo assim */ } }
      const { data: pend } = await servico.from('cobrancas_mimo').select('id, cobranca_id').eq('salon_id', salao).in('status', ['aguardando']).limit(5)
      for (const p of pend ?? []) { if (p.cobranca_id) await apagarCobrancaMimo(p.cobranca_id).catch(() => {}) }
      const { data: ac, error } = await quem.rpc('assinatura_cancelar', { salao })
      if (error) return json({ erro: error.message }, 400)
      return json({ ok: true, acesso: ac })
    }

    if (corpo.acao === 'simular') {
      if (!sandbox) return json({ erro: 'simulação só existe no sandbox' }, 403)
      const { data: pend } = await servico.from('cobrancas_mimo').select('id, cobranca_id, total_cents').eq('salon_id', salao).eq('status', 'aguardando').order('criado_em', { ascending: false }).limit(1).maybeSingle()
      if (!pend?.cobranca_id) return json({ erro: 'não há cobrança aguardando' }, 404)
      await baixarCobrancaMimoSandbox(pend.cobranca_id, pend.total_cents)
      await servico.rpc('cobranca_mimo_confirmar', { cobranca: pend.id, cobranca_asaas: pend.cobranca_id, quando: new Date().toISOString() })
      return json({ ok: true, acesso: await acesso() })
    }

    return json({ erro: 'ação desconhecida' }, 400)
  } catch (e) {
    const msg = e instanceof ErroAsaas ? e.message : String(e)
    return json({ erro: msg }, e instanceof ErroAsaas && e.status < 500 ? 400 : 502)
  }
})
