// A conta de recebimento de um salão ou autônoma (Asaas BaaS).
//
// Chamada pelo app, com o token da dona:
//   POST { acao: 'criar', salao, dados }   cria a subconta e guarda a chave no Vault
//   POST { acao: 'situacao', salao }       relê aprovação e documentos pendentes
//
// A subconta é criada com a chave da conta-pai; a chave da subconta
// volta uma única vez e vai direto para o Vault (guardar_segredo). O
// que fica na tabela é o que a dona pode ver: ids, status, documentos.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { asaas, chavePai, corpoSubconta, situacaoDaSubconta, garantirChavePix, json, preflight, ErroAsaas, type DadosSubconta } from '../_shared/asaas.ts'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? ''
const servico = createClient(URL_SUPABASE, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ erro: 'entre na sua conta' }, 401)
  const quem = createClient(URL_SUPABASE, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: u } = await quem.auth.getUser()
  if (!u?.user) return json({ erro: 'entre na sua conta' }, 401)

  let corpo: { acao?: string; salao?: string; dados?: DadosSubconta } = {}
  try { corpo = await req.json() } catch { return json({ erro: 'corpo inválido' }, 400) }
  const salao = corpo.salao
  if (!salao) return json({ erro: 'salão?' }, 400)

  // só quem administra o salão mexe na conta dele
  const { data: admin } = await quem.rpc('is_admin_do_salao', { salao })
  if (!admin) return json({ erro: 'só a dona do salão pode fazer isso' }, 403)

  const nomeSegredo = `asaas_sub_${salao}`

  if (corpo.acao === 'criar') {
    const d = corpo.dados
    if (!d) return json({ erro: 'dados?' }, 400)
    const faltando = ['nome', 'email', 'documento', 'celular', 'renda_mensal', 'cep', 'endereco', 'numero', 'bairro'].filter((k) => !(d as Record<string, unknown>)[k])
    if (d.tipo_pessoa === 'fisica' && !d.nascimento) faltando.push('nascimento')
    if (faltando.length) return json({ erro: 'faltou: ' + faltando.join(', ') }, 400)

    const { data: ja, error: erroJa } = await servico.from('contas_de_recebimento').select('conta_id').eq('salon_id', salao).maybeSingle()
    if (erroJa) return json({ erro: 'o banco ainda não tem a migração 090 (pagamento pelo app): ' + erroJa.message }, 500)
    if (ja?.conta_id) return json({ erro: 'este salão já tem conta de recebimento' }, 409)
    // o Vault precisa estar pronto antes de criar lá fora: chave perdida é subconta perdida
    const { error: erroVault } = await servico.rpc('ler_segredo', { nome: nomeSegredo })
    if (erroVault) return json({ erro: 'o banco ainda não tem a migração 090 (ler_segredo): ' + erroVault.message }, 500)

    const webhook = {
      url: `${URL_SUPABASE}/functions/v1/pagamento-webhook`,
      token: Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? '',
      email: d.email,
    }
    if (!webhook.token) return json({ erro: 'ASAAS_WEBHOOK_TOKEN não configurado' }, 500)

    try {
      const criada = await asaas(chavePai(), 'POST', '/accounts', corpoSubconta(d, webhook))
      const chaveSub = String(criada.apiKey ?? '')
      if (!chaveSub) return json({ erro: 'o Asaas criou a subconta ' + criada.id + ' mas não devolveu a chave dela' }, 502)
      const { error: erroGuardar } = await servico.rpc('guardar_segredo', { nome: nomeSegredo, valor: chaveSub })
      if (erroGuardar) return json({ erro: 'subconta ' + criada.id + ' criada no Asaas, mas não deu para guardar a chave no Vault: ' + erroGuardar.message }, 500)
      const dadosVisiveis = { ...d, documento: d.documento.replace(/\D/g, '').replace(/^(\d{3})\d+(\d{2})$/, '$1***$2') }
      const { error: erroGravar } = await servico.from('contas_de_recebimento').upsert({
        salon_id: salao, provedor: 'asaas', conta_id: String(criada.id), wallet_id: String(criada.walletId ?? ''),
        tipo_pessoa: d.tipo_pessoa, documento: dadosVisiveis.documento, nome: d.nome, email: d.email, celular: d.celular,
        dados: dadosVisiveis, status: 'aguardando', criado_por: u.user.id, atualizado_em: new Date().toISOString(), erro: null,
      })
      if (erroGravar) return json({ erro: 'subconta ' + criada.id + ' criada no Asaas, mas não deu para gravar aqui: ' + erroGravar.message }, 500)
      // a situação inicial (a lista de documentos pode demorar uns 15 s para existir)
      let situ = null
      if (chaveSub) { try { situ = await situacaoDaSubconta(chaveSub) } catch (_) { /* ainda não */ } }
      // a chave Pix da subconta: sem ela não sai QR (pode falhar antes da aprovação; o "situacao" tenta de novo)
      const pix = await garantirChavePix(chaveSub)
      await servico.from('contas_de_recebimento').update({ pix_pronto: pix.ok, pix_chave: pix.chave ?? null, atualizado_em: new Date().toISOString() }).eq('salon_id', salao)
      if (situ) await servico.from('contas_de_recebimento').update({ status: situ.status, situacao: situ.situacao, documentos: situ.documentos, atualizado_em: new Date().toISOString() }).eq('salon_id', salao)
      return json({ ok: true, conta_id: criada.id, status: situ?.status ?? 'aguardando', documentos: situ?.documentos ?? [] })
    } catch (e) {
      const msg = e instanceof ErroAsaas ? e.message : String(e)
      await servico.from('contas_de_recebimento').upsert({ salon_id: salao, status: 'erro', erro: msg.slice(0, 300), criado_por: u.user.id, atualizado_em: new Date().toISOString() })
      return json({ erro: msg }, 502)
    }
  }

  if (corpo.acao === 'situacao') {
    const { data: chaveSub } = await servico.rpc('ler_segredo', { nome: nomeSegredo })
    if (!chaveSub) return json({ erro: 'este salão ainda não tem conta de recebimento' }, 404)
    try {
      const situ = await situacaoDaSubconta(String(chaveSub))
      const pix = await garantirChavePix(String(chaveSub))
      await servico.from('contas_de_recebimento').update({ status: situ.status, situacao: situ.situacao, documentos: situ.documentos, pix_pronto: pix.ok, pix_chave: pix.chave ?? null, erro: pix.ok ? null : ('Chave Pix: ' + (pix.erro ?? pix.status ?? 'pendente')), atualizado_em: new Date().toISOString() }).eq('salon_id', salao)
      return json({ ok: true, ...situ, pix_pronto: pix.ok })
    } catch (e) {
      return json({ erro: e instanceof ErroAsaas ? e.message : String(e) }, 502)
    }
  }

  return json({ erro: 'ação desconhecida' }, 400)
})
