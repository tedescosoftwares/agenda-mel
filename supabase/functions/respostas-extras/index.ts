// Respostas extras da assistente (3.99, migração 248): a dona compra um pacote por Pix, na conta da MIMO.
//
//   POST { salao, acao, ... }   com o token de quem manda no salão
//   acao:
//     pix       { respostas: 500 | 1000 | 2000 }  abre (ou reaproveita) a compra e devolve o Pix (copia e cola e QR)
//     conferir  { compra }  confere no Asaas; pago, o saldo entra (o aviso do Asaas também faz isso sozinho)
//     simular   { compra }  só no sandbox: dá baixa no Pix como se tivesse pago
//
// 4.10 (migração 265): a mesma conversa serve às agendas a mais do plano. Com { tipo: 'agendas' } a ação pix recebe
//     pix       { agendas: n }   n profissionais além das liberadas; o valor é a diferença da mensalidade × os meses
//                                que faltam do período pago (agendas_compra_*), referência agendas:<id>
//
// O banco decide o que pode e guarda tudo (respostas_compra_*); aqui é só a conversa com o Asaas. A referência no
// Asaas é respostas:<id> (o aviso do Asaas, em pagamento-webhook, credita por ela).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { asaas, chavePai, garantirClienteMimo, cobrarPixMimo, acharCobrancaMimoPorRef, pixDaCobrancaMimo, obterCobrancaMimo, apagarCobrancaMimo, baixarCobrancaMimoSandbox, AMBIENTE, PAGO, ESTORNADA, json, preflight, ErroAsaas } from '../_shared/asaas.ts'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? ''
const servico = createClient(URL_SUPABASE, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
const milhar = (n: number) => n.toLocaleString('pt-BR')

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
  const sandbox = AMBIENTE !== 'producao'
  // o que se compra: respostas da assistente (padrão) ou agendas a mais do plano
  const AG = corpo.tipo === 'agendas'
  const F = AG ? 'agendas_compra' : 'respostas_compra'
  const REF = AG ? 'agendas' : 'respostas'
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)

  // pagou de verdade (no sandbox, a baixa manual também vale)
  const pagou = (st: string) => PAGO.has(st) && (st !== 'RECEIVED_IN_CASH' || sandbox)
  // deno-lint-ignore no-explicit-any
  async function creditar(compra: string, real: any) {
    const quando = real?.paymentDate ? new Date(real.paymentDate + 'T12:00:00-03:00').toISOString() : new Date().toISOString()
    const { error } = await servico.rpc(`${F}_paga`, { compra, cobranca_asaas: real?.id ? String(real.id) : null, quando })
    if (error) throw new Error(error.message)
  }
  async function estado(compra: string) {
    const { data, error } = await quem.rpc(`${F}_estado`, { compra })
    if (error) throw new Error(error.message)
    return data
  }

  try {
    if (corpo.acao === 'pix') {
      const { data: ab, error } = AG
        ? await quem.rpc('agendas_compra_abrir', { salao: corpo.salao, agendas_: Number(corpo.agendas) })
        : await quem.rpc('respostas_compra_abrir', { salao: corpo.salao, respostas_: Number(corpo.respostas) })
      if (error) return json({ erro: error.message }, 400)
      // as compras que este pedido substituiu saem do Asaas (para não ficarem pagáveis)
      for (const id of (ab?.anteriores ?? []) as string[]) if (id) await apagarCobrancaMimo(id).catch(() => {})
      const pronta = (cobranca_id: string, copia_cola: string, imagem: string | null) =>
        json({ ok: true, compra: { id: ab.id, respostas: ab.respostas, agendas: ab.agendas, meses: ab.meses, valor_cents: ab.valor_cents, status: 'aguardando', cobranca_id, copia_cola, imagem, sandbox } })

      // já criada antes (tocou de novo): se ainda vale no Asaas, é ela
      if (ab?.cobranca_id && ab?.copia_cola) {
        const real = await obterCobrancaMimo(ab.cobranca_id).catch(() => null)
        if (real?.id && !real?.deleted && !ESTORNADA.has(String(real?.status ?? ''))) {
          if (pagou(String(real.status))) { await creditar(ab.id, real); return json({ ok: true, compra: { ...(await estado(ab.id)), sandbox } }) }
          const q = await pixDaCobrancaMimo(ab.cobranca_id).catch(() => null)
          return pronta(ab.cobranca_id, q?.copiaCola || ab.copia_cola, q?.imagem ?? null)
        }
      }
      // uma tentativa que caiu depois de criar no Asaas: acha pela referência
      const achada = await acharCobrancaMimoPorRef(`${REF}:${ab.id}`).catch(() => null)
      if (achada?.id && !PAGO.has(String(achada.status ?? '')) && !ESTORNADA.has(String(achada.status ?? ''))) {
        const q = await pixDaCobrancaMimo(String(achada.id)).catch(() => null)
        if (q?.copiaCola) {
          await servico.rpc(`${F}_atualizar`, { compra: ab.id, cobranca_id_: String(achada.id), copia_cola_: q.copiaCola })
          return pronta(String(achada.id), q.copiaCola, q.imagem)
        }
      }

      const cli = ab.cliente ?? {}
      let customer: string | null = null
      if (cli.customer_id) {
        const c = await asaas(chavePai(), 'GET', `/customers/${cli.customer_id}`).catch(() => null)
        if (c?.id && !c?.deleted) customer = String(c.id)
      }
      if (!customer) {
        customer = await garantirClienteMimo({ nome: cli.razao_social || cli.nome, documento: cli.documento ?? '', telefone: cli.telefone, email: cli.email, ref: `salao:${corpo.salao}` })
      }
      const r = await cobrarPixMimo({
        customer,
        valorCents: Number(ab.valor_cents),
        descricao: AG
          ? `${ab.agendas} ${Number(ab.agendas) === 1 ? 'agenda a mais' : 'agendas a mais'} no plano${Number(ab.meses) > 1 ? ` (${ab.meses} meses)` : ''} · ${cli.nome ?? 'MIMO'}`
          : `${milhar(Number(ab.respostas))} respostas extras da assistente · ${cli.nome ?? 'MIMO'}`,
        ref: `${REF}:${ab.id}`,
        vencimento: hoje,
      })
      await servico.rpc(`${F}_atualizar`, { compra: ab.id, cobranca_id_: r.id, copia_cola_: r.copiaCola })
      return pronta(r.id, r.copiaCola, r.imagem)
    }

    if (corpo.acao === 'conferir') {
      const atual = await estado(String(corpo.compra))
      if (atual?.status === 'aguardando' && atual?.cobranca_id) {
        const real = await obterCobrancaMimo(atual.cobranca_id).catch(() => null)
        if (real && pagou(String(real.status ?? ''))) await creditar(atual.id, real)
      }
      return json({ ok: true, compra: await estado(String(corpo.compra)) })
    }

    if (corpo.acao === 'simular') {
      if (!sandbox) return json({ erro: 'só no ambiente de testes' }, 403)
      const atual = await estado(String(corpo.compra))
      if (atual?.status === 'aguardando' && atual?.cobranca_id) {
        await baixarCobrancaMimoSandbox(atual.cobranca_id, Number(atual.valor_cents))
        const real = await obterCobrancaMimo(atual.cobranca_id).catch(() => null)
        await creditar(atual.id, real ?? { id: atual.cobranca_id })
      }
      return json({ ok: true, compra: await estado(String(corpo.compra)) })
    }

    return json({ erro: 'ação desconhecida' }, 400)
  } catch (e) {
    if (e instanceof ErroAsaas) return json({ erro: e.message }, e.status >= 400 && e.status < 500 ? 400 : 502)
    console.error('respostas-extras:', e)
    return json({ erro: 'Não deu para gerar o Pix agora. Tente de novo em instantes.' }, 500)
  }
})
