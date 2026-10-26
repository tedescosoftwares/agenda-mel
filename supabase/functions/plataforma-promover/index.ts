// A promoção completa de um salão do guia (3.71, migração 215): a Plataforma cria a
// conta da dona, o salão com agenda, dispara os 7 dias grátis, emite a primeira
// mensalidade por Pix no Asaas e manda o e-mail e o WhatsApp com o link de criar a senha.
//
//   POST { lugar, dona: { nome, email, whatsapp, documento }, conta: 'automatica' | 'email',
//          tipo: 'salao' | 'autonoma', equipe, cobrar, enviar_whats, base }
//   com o token de quem está na Plataforma (perfil 'plataforma')
//
//   conta 'automatica'  a conta nasce confirmada (sem e-mail de confirmação); o link de
//                       criar a senha vai pelo WhatsApp e volta na resposta para copiar
//   conta 'email'       a conta nasce pelo convite: o e-mail leva o link que confirma e
//                       abre a tela de criar a senha
//   conta que já existe reaproveita; o link gerado é o de redefinir a senha
//
// Senha nunca pelo WhatsApp: o que vai é o link seguro de criar a senha (mimo.com.vc/senha).
// O banco faz o resto (plataforma_promover_guia, cobranca_mimo_lote, plataforma_promocao_mensagens).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { json, preflight } from '../_shared/asaas.ts'
import { criarNoAsaas } from '../_shared/cobranca_mimo.ts'
import { enviarPor } from '../_shared/canais.ts'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? ''
const servico = createClient(URL_SUPABASE, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
const SITES = /^https:\/\/(www\.)?mimo\.com\.vc$|^http:\/\/localhost(:\d+)?$|^http:\/\/127\.0\.0\.1(:\d+)?$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const senhaAleatoria = () => crypto.randomUUID().replace(/-/g, '') + 'Mm1!'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ erro: 'só POST' }, 405)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ erro: 'entre na sua conta' }, 401)
  const quem = createClient(URL_SUPABASE, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: u } = await quem.auth.getUser()
  if (!u?.user) return json({ erro: 'entre na sua conta' }, 401)
  const { data: perfil } = await servico.from('profiles').select('role').eq('id', u.user.id).maybeSingle()
  if (perfil?.role !== 'plataforma') return json({ erro: 'só a Plataforma promove um salão do guia' }, 403)

  // deno-lint-ignore no-explicit-any
  const corpo: any = await req.json().catch(() => ({}))
  const lugar = String(corpo.lugar ?? '')
  const dona = corpo.dona ?? {}
  const email = String(dona.email ?? '').trim().toLowerCase()
  const nome = String(dona.nome ?? '').trim()
  const whatsapp = digitos(dona.whatsapp)
  const documento = digitos(dona.documento)
  const tipo = corpo.tipo === 'autonoma' ? 'autonoma' : 'salao'
  const equipe = Math.max(1, Math.min(60, Number(corpo.equipe) || 1))
  const cobrar = tipo === 'salao' && corpo.cobrar !== false
  const modo = corpo.conta === 'email' ? 'email' : 'automatica'
  if (!lugar) return json({ erro: 'sem o salão do guia' }, 400)
  if (!EMAIL.test(email)) return json({ erro: 'Confere o e-mail da dona.' }, 400)
  if (!nome) return json({ erro: 'O nome da dona é obrigatório.' }, 400)
  if (documento && documento.length !== 11 && documento.length !== 14) return json({ erro: 'CPF tem 11 dígitos e CNPJ tem 14.' }, 400)
  const base = SITES.test(String(corpo.base ?? '')) ? String(corpo.base).replace(/\/+$/, '') : 'https://mimo.com.vc'
  const redirectTo = `${base}/senha`
  const meta = { full_name: nome, phone: whatsapp ? `+${whatsapp.replace(/^(?!55)/, '55')}` : null }

  // 1. a conta da dona
  const { data: conta, error: e1 } = await quem.rpc('plataforma_conta_por_email', { email_: email })
  if (e1) return json({ erro: e1.message }, 400)
  let uid: string | null = null
  let contaNova = false
  let linkSenha: string | null = null
  let avisoConta: string | null = null
  if (conta?.existe) {
    uid = String(conta.id)
    const { data: l, error } = await servico.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
    if (error) avisoConta = `A conta já existia; não deu para gerar o link de senha (${error.message}).`
    linkSenha = l?.properties?.action_link ?? null
  } else if (modo === 'email') {
    const { data: l, error } = await servico.auth.admin.generateLink({ type: 'invite', email, options: { data: meta, redirectTo } })
    if (error || !l?.user?.id) return json({ erro: `Não deu para criar a conta: ${error?.message ?? 'sem resposta'}` }, 400)
    uid = l.user.id
    linkSenha = l.properties?.action_link ?? null
    contaNova = true
  } else {
    const { data: c, error } = await servico.auth.admin.createUser({ email, email_confirm: true, password: senhaAleatoria(), user_metadata: meta })
    if (error || !c?.user?.id) return json({ erro: `Não deu para criar a conta: ${error?.message ?? 'sem resposta'}` }, 400)
    uid = c.user.id
    contaNova = true
    const { data: l, error: e2 } = await servico.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
    if (e2) avisoConta = `Conta criada, mas sem o link de senha (${e2.message}). Ela pode usar "Esqueci a senha" em ${base}/login.`
    linkSenha = l?.properties?.action_link ?? null
  }

  // 2. o salão, o teste de 7 dias e a cobrança reservada (tudo no banco, com os direitos de quem chamou)
  const { data: prom, error: e3 } = await quem.rpc('plataforma_promover_guia', {
    lugar_: lugar, dono_: uid, dados: { tipo, equipe, email, whatsapp, documento, nome, cobrar },
  })
  if (e3) return json({ erro: e3.message }, 400)
  if (!prom?.ok) return json({ ok: false, motivo: prom?.motivo ?? 'Não deu para promover.', conta: { id: uid, nova: contaNova, modo, email }, link_senha: linkSenha }, 200)

  // 3. o Pix no Asaas, na hora (só com CPF/CNPJ; sem ele a cobrança fica reservada no banco)
  // deno-lint-ignore no-explicit-any
  let cobranca: any = null
  if (prom.cobranca_id) {
    const { data: lote } = await quem.rpc('cobranca_mimo_lote', { cobranca: prom.cobranca_id })
    if (lote && digitos(lote.documento).length >= 11) {
      if (lote.copia_cola) cobranca = { id: prom.cobranca_id, ok: true, status: lote.status, copia_cola: lote.copia_cola, link_url: lote.link_url, total_cents: lote.total_cents, vencimento: lote.vencimento }
      else {
        const r = await criarNoAsaas(quem, lote)
        cobranca = { id: prom.cobranca_id, ...r, total_cents: lote.total_cents, vencimento: lote.vencimento }
      }
    } else {
      cobranca = { id: prom.cobranca_id, ok: false, status: 'a_criar', sem_documento: true, total_cents: lote?.total_cents ?? null, vencimento: lote?.vencimento ?? null }
    }
  }

  // 4. o e-mail (fila) e o WhatsApp (pelo número da MIMO, se estiver conectado)
  const { data: msg } = await quem.rpc('plataforma_promocao_mensagens', { salao: prom.salao_id, link_senha: linkSenha ?? `${base}/login`, modo, cobranca: prom.cobranca_id ?? null })
  // deno-lint-ignore no-explicit-any
  let whats: any = { enviado: false, texto: msg?.whats_texto ?? '', numero: msg?.whats_numero ?? '', erro: null }
  if (corpo.enviar_whats !== false && whats.numero) {
    const { data: cfg } = await servico.from('guia_whats_config').select('ligado, instancia').eq('id', 1).maybeSingle()
    if (cfg?.ligado && cfg.instancia) {
      const tel = String(whats.numero).replace(/^(?!55)/, '55')
      const r = await enviarPor('evolution', { telefone: tel, corpo: whats.texto, identificador: cfg.instancia }).catch((e) => ({ ok: false, erro: String(e) }))
      whats = { ...whats, enviado: Boolean(r.ok), erro: r.ok ? null : (r.erro ?? 'não enviou') }
    } else {
      whats = { ...whats, erro: 'o WhatsApp da MIMO não está conectado (aba WhatsApp do guia)' }
    }
  }

  return json({
    ok: true,
    conta: { id: uid, nova: contaNova, modo, email, aviso: avisoConta },
    link_senha: linkSenha,
    salao: { id: prom.salao_id, nome: prom.nome, slug: prom.slug, codigo: prom.codigo, novo: prom.novo, tipo: prom.tipo, plano: prom.plano, equipe: prom.equipe, mensalidade: prom.mensalidade, teste_dias: prom.teste_dias, acesso: prom.acesso },
    cobranca,
    email: { para: msg?.email ?? email, enviado: Boolean(msg?.email_enviado) },
    whats,
  })
})
