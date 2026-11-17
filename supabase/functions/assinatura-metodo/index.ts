// A dona escolhe como pagar a MIMO (128).
//
//   POST { salao, acao, ... }   com o token da dona
//   acao:
//     cartao          { cartao: {nome, numero, mes, ano, cvv}, titular: {cep, numero}, cobrar_agora }
//                     tokeniza (o número não fica guardado), vincula; com cobrar_agora paga o
//                     primeiro mês na hora (30 + 7 dias de bônus)
//     pix_automatico  abre a cobrança do primeiro mês (30 + 7 de bônus, 10% off) e cria a
//                     autorização: o QR paga esse mês e autoriza os próximos (jornada 3)
//     pix_avista      abre a cobrança do primeiro mês por Pix e devolve o copia e cola
//     conferir        relê a autorização do Pix Automático / a cobrança Pix pendente
//     descartar_pix   apaga o Pix à vista que ficou aguardando (ela mudou de ideia)
//     cancelar        cancela a autorização no Asaas e a assinatura (usa até o fim do pago)
//     simular         só no sandbox: dá baixa na cobrança Pix pendente como se tivesse pago
//
// O banco decide o que pode (assinatura_preparar); aqui é só a conversa
// com o Asaas, na conta-pai.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { asaas, chavePai, ESTORNADA, acharCobrancaMimoPorRef, pixDaCobrancaMimo, garantirClienteMimo, tokenizarCartao, cobrarCartaoAvulso, cobrarPixMimo, criarAutorizacaoPixAutomatico, situacaoAutorizacaoPixAutomatico, cancelarAutorizacaoPixAutomatico, obterCobrancaMimo, baixarCobrancaMimoSandbox, apagarCobrancaMimo, AMBIENTE, PAGO, AUTORIZADA, AUTORIZACAO_MORTA, json, preflight, ErroAsaas } from '../_shared/asaas.ts'
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
  // um Pix à vista aguardando não faz sentido junto com outro método: some
  async function descartarPixPendente() {
    const { data: pend } = await servico.from('cobrancas_mimo').select('id, cobranca_id, metodo').eq('salon_id', salao).in('metodo', ['pix', 'pix_automatico']).eq('tipo', 'avista').in('status', ['a_criar', 'aguardando', 'falhou'])
    for (const c of pend ?? []) {
      if (c.cobranca_id) await apagarCobrancaMimo(c.cobranca_id).catch(() => {})
      await servico.rpc('cobranca_mimo_atualizar', { cobranca: c.id, dados: { status: 'cancelado', erro: 'trocou a forma de pagamento' } })
    }
    // uma autorização de Pix Automático que nunca foi paga também cai
    if (prep.autorizacao_id && prep.metodo === 'pix_automatico' && !AUTORIZADA.test(String(prep.autorizacao_status ?? ''))) {
      await cancelarAutorizacaoPixAutomatico(prep.autorizacao_id).catch(() => {})
    }
    return (pend ?? []).length
  }

  // 3.85: ao sair do sandbox para a produção, o cliente e as cobranças guardados são do sandbox e não existem no
  // Asaas de verdade. Antes de usar, confere neste Asaas: o cliente que não existir é achado (ou criado) de novo pelo
  // CPF/CNPJ, e a cobrança aberta que não existir (ou que não vai mais ser paga) é refeita.
  async function clienteDaqui(): Promise<string> {
    if (prep.customer_id) {
      const c = await asaas(chavePai(), 'GET', `/customers/${prep.customer_id}`).catch(() => null)
      if (c?.id && !c?.deleted) return String(c.id)
    }
    return await garantirClienteMimo({
      nome: prep.razao_social, documento: prep.documento, telefone: prep.telefone,
      email: prep.email, ref: `salao:${salao}`,
    })
  }
  async function cobrancaViva(id: string | null | undefined): Promise<boolean> {
    if (!id) return false
    // 3.94: vencida (OVERDUE) ainda vale: o Pix pode ser pago até o prazo da MIMO (antes, criava outra no Asaas)
    const c = await obterCobrancaMimo(id).catch(() => null)
    return Boolean(c?.id) && !c?.deleted && !ESTORNADA.has(String(c?.status ?? ''))
  }
  // 3.94: o plano pedido (1, 6 ou 12 meses)
  function mesesDoPedido(): number {
    const m = Number(corpo.meses ?? 1)
    return [1, 6, 12].includes(m) ? m : 1
  }
  // as cobranças que o banco acabou de substituir saem do Asaas (para não ficarem pagáveis)
  // deno-lint-ignore no-explicit-any
  async function apagarAnteriores(ab: any) {
    for (const id of (ab?.anteriores ?? []) as string[]) {
      if (id) await apagarCobrancaMimo(id).catch(() => {})
    }
  }
  // a rotina (ou uma tentativa que caiu) já criou o Pix desta linha no Asaas? Então é ele: grava e devolve
  // deno-lint-ignore no-explicit-any
  async function jaNoAsaas(ab: any) {
    const p = await acharCobrancaMimoPorRef(`mimo:${ab.id}`).catch(() => null)
    if (!p?.id || PAGO.has(String(p.status ?? '')) || ESTORNADA.has(String(p.status ?? ''))) return null
    const q = await pixDaCobrancaMimo(String(p.id)).catch(() => null)
    if (!q?.copiaCola) return null
    await servico.rpc('cobranca_mimo_atualizar', { cobranca: ab.id, dados: { status: 'aguardando', cobranca_id: String(p.id), copia_cola: q.copiaCola, link_url: p.invoiceUrl ?? null } })
    return { status: 'aguardando', cobranca_id: String(p.id), copia_cola: q.copiaCola, imagem: q.imagem, link_url: p.invoiceUrl ?? null }
  }
  function descricaoDoPlano(meses: number, inicial: boolean, pct: number) {
    const plano = meses === 12 ? 'Plano anual' : meses === 6 ? 'Plano semestral' : inicial ? 'Primeira mensalidade' : 'Mensalidade'
    return `${plano} MIMO · ${prep.nome}${pct > 0 ? ` · ${pct}% de desconto` : ''}`
  }

  try {
    // Fluxos recorrentes antigos ficam no código só como referência para uma
    // evolução futura, mas não podem ser acionados nesta versão.
    if (['cartao', 'pix_automatico', 'pix_avista'].includes(String(corpo.acao))) {
      return json({ erro: 'Recorrência desativada nesta versão. Use pagamento avulso por Pix ou cartão.' }, 410)
    }

    // 2.81: ativação inicial sem recorrência. O banco calcula os 20% e
    // reserva a cobrança; esta função só conversa com o Asaas.
    if (corpo.acao === 'inicio_pix') {
      const meses = mesesDoPedido()
      const { data: ab, error } = await quem.rpc('cobranca_inicial_abrir', meses === 1 ? { salao, metodo_: 'pix' } : { salao, metodo_: 'pix', meses_: meses })
      if (error) return json({ erro: error.message }, 400)
      await apagarAnteriores(ab)

      // cobrança já criada no Asaas numa tentativa anterior: reaproveita, se ela existe neste Asaas e ainda vale
      if (ab?.cobranca_id && ab?.copia_cola && await cobrancaViva(ab.cobranca_id)) {
        return json({ ok: true, cobranca: { ...ab, sandbox }, acesso: await acesso() })
      }

      const ja = await jaNoAsaas(ab)
      if (ja) return json({ ok: true, cobranca: { ...ab, ...ja, sandbox }, acesso: await acesso() })
      const customer = await clienteDaqui()
      const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
      const r = await cobrarPixMimo({
        customer,
        valorCents: Number(ab.total_cents),
        descricao: descricaoDoPlano(Number(ab.meses ?? 1), true, Number(ab.desconto_pct ?? 0)),
        ref: `mimo:${ab.id}`,
        vencimento: String(ab.vencimento ?? '') > hoje ? String(ab.vencimento) : hoje,
      })
      await servico.rpc('cobranca_mimo_atualizar', {
        cobranca: ab.id,
        dados: {
          status: 'aguardando',
          cobranca_id: r.id,
          copia_cola: r.copiaCola,
          link_url: r.link,
          customer_id: customer,
          tentativa: true,
        },
      })
      return json({
        ok: true,
        cobranca: {
          ...ab, status: 'aguardando', cobranca_id: r.id,
          copia_cola: r.copiaCola, imagem: r.imagem, link_url: r.link,
          sandbox,
        },
        acesso: await acesso(),
      })
    }

    // 3.85: a ativação é só por Pix. O cartão fica no código para uma volta futura, mas não roda.
    if (corpo.acao === 'inicio_cartao') {
      return json({ erro: 'O pagamento da MIMO é só por Pix. Use "Pagar com Pix".' }, 410)
    }
    if (corpo.acao === 'inicio_cartao_desligado') {
      const c = corpo.cartao ?? {}; const t = corpo.titular ?? {}
      if (!c.numero || !c.nome || !c.mes || !c.ano || !c.cvv) return json({ erro: 'Preencha os dados do cartão.' }, 400)
      const { data: ab, error } = await quem.rpc('cobranca_inicial_abrir', { salao, metodo_: 'cartao' })
      if (error) return json({ erro: error.message }, 400)

      const customer = prep.customer_id || await garantirClienteMimo({
        nome: prep.razao_social, documento: prep.documento, telefone: prep.telefone,
        email: prep.email, ref: `salao:${salao}`,
      })
      const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
      const r = await cobrarCartaoAvulso({
        customer,
        cartao: c,
        titular: {
          nome: c.nome,
          email: prep.email,
          documento: t.documento || prep.documento,
          cep: t.cep || prep.cep || '',
          numero: t.numero || prep.numero || '',
          telefone: prep.telefone,
        },
        valorCents: Number(ab.total_cents),
        descricao: `Primeira mensalidade MIMO · ${prep.nome} · 20% de desconto`,
        ref: `mimo:${ab.id}`,
        vencimento: hoje,
        ip,
      })
      await servico.rpc('cobranca_mimo_atualizar', {
        cobranca: ab.id,
        dados: {
          status: PAGO.has(r.status) ? 'aguardando' : 'aguardando',
          cobranca_id: r.id,
          link_url: r.link,
          customer_id: customer,
          tentativa: true,
        },
      })
      if (PAGO.has(r.status)) {
        await servico.rpc('cobranca_mimo_confirmar', { cobranca: ab.id, cobranca_asaas: r.id, quando: new Date().toISOString() })
      } else if (!['PENDING', 'AWAITING_RISK_ANALYSIS'].includes(r.status)) {
        await servico.rpc('cobranca_mimo_falhou', { cobranca: ab.id, motivo: 'cartão não autorizado (' + r.status + ')' })
        return json({ erro: 'O cartão não foi autorizado. Tente outro cartão ou use Pix.', status: r.status }, 402)
      }
      return json({ ok: true, cobranca: { ...ab, status: r.status, cobranca_id: r.id }, cartao: { final: r.final, bandeira: r.bandeira }, acesso: await acesso() })
    }

    if (corpo.acao === 'inicio_conferir') {
      const { data: estado, error } = await quem.rpc('ativacao_inicial_estado', { salao })
      if (error) return json({ erro: error.message }, 400)
      const cob = estado?.cobranca
      if (cob?.cobranca_id && cob?.status !== 'pago') {
        const real = await obterCobrancaMimo(cob.cobranca_id).catch(() => null)
        const st = String(real?.status ?? '')
        if (PAGO.has(st) && (st !== 'RECEIVED_IN_CASH' || sandbox)) {
          await servico.rpc('cobranca_mimo_confirmar', { cobranca: cob.id, cobranca_asaas: cob.cobranca_id, quando: real?.paymentDate ? new Date(real.paymentDate + 'T12:00:00-03:00').toISOString() : new Date().toISOString() })
        }
      }
      return json({ ok: true, estado: (await quem.rpc('ativacao_inicial_estado', { salao })).data, acesso: await acesso() })
    }

    if (corpo.acao === 'inicio_cancelar') {
      const { data: estado } = await quem.rpc('ativacao_inicial_estado', { salao })
      const cob = estado?.cobranca
      const id = cob?.cobranca_id

      // Pode ter pago no exato instante em que tocou "trocar opção".
      // Nesse caso o pagamento vence a corrida: confirma e não cancela.
      if (id) {
        const real = await obterCobrancaMimo(id).catch(() => null)
        const st = String(real?.status ?? '')
        if (PAGO.has(st) && (st !== 'RECEIVED_IN_CASH' || sandbox)) {
          await servico.rpc('cobranca_mimo_confirmar', {
            cobranca: cob.id,
            cobranca_asaas: id,
            quando: real?.paymentDate ? new Date(real.paymentDate + 'T12:00:00-03:00').toISOString() : new Date().toISOString(),
          })
          return json({ erro: 'O pagamento acabou de ser confirmado. Seu salão já está ativo.', acesso: await acesso() }, 409)
        }
        await apagarCobrancaMimo(id).catch(() => {})
      }

      await quem.rpc('cobranca_inicial_cancelar', { salao })
      return json({ ok: true, estado: (await quem.rpc('ativacao_inicial_estado', { salao })).data, acesso: await acesso() })
    }

    // 3.94: a mensalidade (renovação, ou "pagar agora" no teste). Uma aberta por vez: o banco devolve a que já
    // existe (mesmo plano, no prazo) ou abre outra e lista as anteriores, que saem do Asaas aqui. Vence no dia X
    // (o fim do período atual) ou, para quem já passou do prazo, em 3 dias.
    if (corpo.acao === 'renovar_pix') {
      const meses = mesesDoPedido()
      const { data: ab, error } = await quem.rpc('cobranca_manual_abrir', meses === 1 ? { salao, metodo_: 'pix' } : { salao, metodo_: 'pix', meses_: meses })
      if (error) return json({ erro: error.message }, 400)
      await apagarAnteriores(ab)
      if (ab?.cobranca_id && ab?.copia_cola && await cobrancaViva(ab.cobranca_id)) return json({ ok: true, cobranca: { ...ab, sandbox }, acesso: await acesso() })

      const ja = await jaNoAsaas(ab)
      if (ja) return json({ ok: true, cobranca: { ...ab, ...ja, sandbox }, acesso: await acesso() })
      const customer = await clienteDaqui()
      const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
      const r = await cobrarPixMimo({
        customer,
        valorCents: Number(ab.total_cents),
        descricao: descricaoDoPlano(Number(ab.meses ?? 1), false, Number(ab.desconto_pct ?? 0)),
        ref: `mimo:${ab.id}`,
        vencimento: String(ab.vencimento ?? '') > hoje ? String(ab.vencimento) : hoje,
      })
      await servico.rpc('cobranca_mimo_atualizar', {
        cobranca: ab.id,
        dados: { status: 'aguardando', cobranca_id: r.id, copia_cola: r.copiaCola, link_url: r.link, customer_id: customer, tentativa: true },
      })
      return json({ ok: true, cobranca: { ...ab, status: 'aguardando', cobranca_id: r.id, copia_cola: r.copiaCola, imagem: r.imagem, link_url: r.link, sandbox }, acesso: await acesso() })
    }

    if (corpo.acao === 'renovar_cartao') {
      return json({ erro: 'O pagamento da MIMO é só por Pix. Use "Renovar por Pix".' }, 410)
    }
    if (corpo.acao === 'renovar_cartao_desligado') {
      const c = corpo.cartao ?? {}; const t = corpo.titular ?? {}
      if (!c.numero || !c.nome || !c.mes || !c.ano || !c.cvv) return json({ erro: 'Preencha os dados do cartão.' }, 400)
      const { data: ab, error } = await quem.rpc('cobranca_manual_abrir', { salao, metodo_: 'cartao' })
      if (error) return json({ erro: error.message }, 400)

      const customer = prep.customer_id || await garantirClienteMimo({
        nome: prep.razao_social, documento: prep.documento, telefone: prep.telefone,
        email: prep.email, ref: `salao:${salao}`,
      })
      const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
      const r = await cobrarCartaoAvulso({
        customer,
        cartao: c,
        titular: {
          nome: c.nome, email: prep.email, documento: t.documento || prep.documento,
          cep: t.cep || prep.cep || '', numero: t.numero || prep.numero || '', telefone: prep.telefone,
        },
        valorCents: Number(ab.total_cents),
        descricao: `Mensalidade MIMO · ${prep.nome}`,
        ref: `mimo:${ab.id}`,
        vencimento: hoje,
        ip,
      })
      await servico.rpc('cobranca_mimo_atualizar', {
        cobranca: ab.id,
        dados: { status: 'aguardando', cobranca_id: r.id, link_url: r.link, customer_id: customer, tentativa: true },
      })
      if (PAGO.has(r.status)) {
        await servico.rpc('cobranca_mimo_confirmar', { cobranca: ab.id, cobranca_asaas: r.id, quando: new Date().toISOString() })
      } else if (!['PENDING', 'AWAITING_RISK_ANALYSIS'].includes(r.status)) {
        await servico.rpc('cobranca_mimo_falhou', { cobranca: ab.id, motivo: 'cartão não autorizado (' + r.status + ')' })
        return json({ erro: 'O cartão não foi autorizado. Tente outro cartão ou use Pix.', status: r.status }, 402)
      }
      return json({ ok: true, cobranca: { ...ab, status: r.status, cobranca_id: r.id }, cartao: { final: r.final, bandeira: r.bandeira }, acesso: await acesso() })
    }

        if (corpo.acao === 'cartao') {
      const c = corpo.cartao ?? {}; const t = corpo.titular ?? {}
      if (!c.numero || !c.nome || !c.mes || !c.ano || !c.cvv) return json({ erro: 'Preencha os dados do cartão.' }, 400)
      const customer = prep.customer_id || await garantirClienteMimo({ nome: prep.razao_social, documento: prep.documento, telefone: prep.telefone, email: prep.email, ref: `salao:${salao}` })
      await descartarPixPendente()
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
      // já tem uma autorização viva com QR pra pagar? devolve ela
      if (prep.autorizacao_id && prep.metodo === 'pix_automatico') {
        const st = await situacaoAutorizacaoPixAutomatico(prep.autorizacao_id).catch(() => null)
        if (st && !AUTORIZACAO_MORTA.test(st.status)) {
          await servico.rpc('assinatura_metodo_definir', { salao, metodo_: 'pix_automatico', dados: { autorizacao_status: st.status, autorizacao_qr: st.copiaCola || undefined, autorizacao_imagem: st.imagem || undefined } })
          const { data: cob } = await servico.from('cobrancas_mimo').select('id, total_cents, periodo_fim, status').eq('salon_id', salao).eq('metodo', 'pix_automatico').in('status', ['aguardando', 'a_criar']).order('criado_em', { ascending: false }).limit(1).maybeSingle()
          return json({ ok: true, autorizacao: st, cobranca: cob, existente: true, acesso: await acesso() })
        }
      }
      await descartarPixPendente()
      // o primeiro mês (com o desconto do Pix Automático) é o QR da autorização
      await servico.rpc('assinatura_metodo_definir', { salao, metodo_: 'pix_automatico', dados: { customer_id: customer } })
      const { data: ab, error } = await servico.rpc('cobranca_mimo_abrir', { salao, tipo_: 'avista', metodo_: 'pix_automatico' })
      if (error) return json({ erro: error.message }, 400)
      const { data: cob } = await servico.from('cobrancas_mimo').select('id, total_cents, periodo_inicio, periodo_fim, status').eq('id', ab.id).maybeSingle()
      if (!cob) return json({ erro: 'cobrança não encontrada' }, 500)
      const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
      let a
      try {
        a = await criarAutorizacaoPixAutomatico({ customer, contrato: `MIMO${String(salao).replace(/-/g, '')}`, descricao: `MIMO ${prep.nome}`, primeiroCents: cob.total_cents, inicio: hoje })
      } catch (e) {
        await servico.rpc('cobranca_mimo_falhou', { cobranca: cob.id, motivo: e instanceof ErroAsaas ? e.message : String(e) })
        throw e
      }
      await servico.rpc('cobranca_mimo_atualizar', { cobranca: cob.id, dados: { status: 'aguardando', copia_cola: a.copiaCola, tentativa: true } })
      await servico.rpc('assinatura_metodo_definir', { salao, metodo_: 'pix_automatico', dados: { customer_id: customer, autorizacao_id: a.id, autorizacao_status: a.status, autorizacao_qr: a.copiaCola, autorizacao_imagem: a.imagem } })
      return json({ ok: true, autorizacao: a, cobranca: cob, existente: false, acesso: await acesso() })
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
        const st = await situacaoAutorizacaoPixAutomatico(prep.autorizacao_id)
        await servico.rpc('assinatura_metodo_definir', { salao, metodo_: 'pix_automatico', dados: { autorizacao_status: st.status } })
        const { data: cob } = await servico.from('cobrancas_mimo').select('id').eq('salon_id', salao).eq('metodo', 'pix_automatico').eq('tipo', 'avista').eq('status', 'aguardando').order('criado_em', { ascending: false }).limit(1).maybeSingle()
        if (cob && AUTORIZADA.test(st.status)) await servico.rpc('cobranca_mimo_confirmar', { cobranca: cob.id, cobranca_asaas: null, quando: new Date().toISOString() })
        if (cob && AUTORIZACAO_MORTA.test(st.status)) await servico.rpc('cobranca_mimo_atualizar', { cobranca: cob.id, dados: { status: 'expirado', erro: 'autorização ' + st.status } })
      }
      // a cobrança Pix (avulsa ou recorrente) pendente: caiu?
      const { data: pend } = await servico.from('cobrancas_mimo').select('id, cobranca_id, status').eq('salon_id', salao).eq('status', 'aguardando').not('cobranca_id', 'is', null).order('criado_em', { ascending: false }).limit(1).maybeSingle()
      if (pend?.cobranca_id) {
        const real = await obterCobrancaMimo(pend.cobranca_id).catch(() => null)
        const st = String(real?.status ?? '')
        if (PAGO.has(st) && (st !== 'RECEIVED_IN_CASH' || sandbox)) await servico.rpc('cobranca_mimo_confirmar', { cobranca: pend.id, cobranca_asaas: pend.cobranca_id, quando: real?.paymentDate ? new Date(real.paymentDate + 'T12:00:00-03:00').toISOString() : new Date().toISOString() })
      }
      return json({ ok: true, acesso: await acesso() })
    }

    if (corpo.acao === 'descartar_pix') {
      const n = await descartarPixPendente()
      return json({ ok: true, descartados: n, acesso: await acesso() })
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
      const { data: pend } = await servico.from('cobrancas_mimo').select('id, cobranca_id, total_cents, metodo').eq('salon_id', salao).eq('status', 'aguardando').order('criado_em', { ascending: false }).limit(1).maybeSingle()
      if (!pend) return json({ erro: 'não há cobrança aguardando' }, 404)
      if (pend.cobranca_id) await baixarCobrancaMimoSandbox(pend.cobranca_id, pend.total_cents)
      else if (pend.metodo === 'pix_automatico') await servico.rpc('assinatura_metodo_definir', { salao, metodo_: 'pix_automatico', dados: { autorizacao_status: 'ACTIVE' } })   // como se o banco tivesse confirmado
      else return json({ erro: 'cobrança sem id no Asaas' }, 409)
      await servico.rpc('cobranca_mimo_confirmar', { cobranca: pend.id, cobranca_asaas: pend.cobranca_id, quando: new Date().toISOString() })
      return json({ ok: true, acesso: await acesso() })
    }

    return json({ erro: 'ação desconhecida' }, 400)
  } catch (e) {
    const msg = e instanceof ErroAsaas ? e.message : String(e)
    return json({ erro: msg }, e instanceof ErroAsaas && e.status < 500 ? 400 : 502)
  }
})
