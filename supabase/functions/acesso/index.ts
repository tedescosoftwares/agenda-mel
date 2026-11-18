// acesso (3.98, migração 242): a cliente que se cadastrou pelo WhatsApp (sem senha) entra no app.
//
//   ver          o link de criar senha (/s/<token>) ainda vale? Devolve o primeiro nome e o telefone escondido.
//   criar_senha  com o link válido: grava a senha (e o e-mail, se ela quiser; sem confirmar, o telefone já foi
//                confirmado pelo WhatsApp), gasta o link e devolve a sessão para o app entrar direto.
//   pedir_link   "Receber link no WhatsApp" (primeiro acesso ou esqueceu a senha): manda um link novo pelo WhatsApp da
//                MIMO. Responde igual tendo ou não cadastro (ninguém descobre quem é cliente). 3 por hora por número.
//   entrar       WhatsApp e senha: acha a conta pelo número (só telefone confirmado) e devolve a sessão. 8 tentativas
//                a cada 15 minutos por número.
//
// Pública (quem chama ainda não entrou): a chave anônima basta. Senha nunca vai pelo WhatsApp: só o link, que vale uma
// vez, por 7 dias; no banco fica só o hash do token. O WhatsApp da MIMO é a instância da casa (whatsapp_instancia_casa).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enviarPor } from '../_shared/canais.ts'
import { numeroCompleto, telefoneEscondido, tokenNovo, tokenValido, hashDoToken, urlDoLink, textoDoLinkPedido, senhaValida, emailValido, SITE_PADRAO } from '../_shared/acesso.ts'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? ''
const CHAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const CHAVE_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SITE = (Deno.env.get('SITE_URL') ?? '').trim() || SITE_PADRAO

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })
}

const servico = createClient(URL_SUPABASE, CHAVE_SERVICO, { auth: { persistSession: false } })
const primeiroNome = (n: unknown) => String(n ?? '').trim().split(' ')[0] || null
const LINK_RUIM: Record<string, string> = {
  usado: 'Esse link já foi usado. Para entrar de novo, peça outro em Entrar › Receber link no WhatsApp.',
  expirado: 'Esse link expirou. Peça outro em Entrar › Receber link no WhatsApp.',
  nao_existe: 'Esse link não vale. Peça outro em Entrar › Receber link no WhatsApp.',
}

// entra com o e-mail de entrada da conta (o do WhatsApp ou o que ela cadastrou) e devolve a sessão para o app
async function sessaoDe(conta: string, senha: string): Promise<{ access_token: string; refresh_token: string } | null> {
  const { data: u } = await servico.auth.admin.getUserById(conta)
  const email = u?.user?.email
  if (!email) return null
  const anon = createClient(URL_SUPABASE, CHAVE_ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await anon.auth.signInWithPassword({ email, password: senha })
  if (error || !data.session) return null
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true })
  if (req.method !== 'POST') return json({ erro: 'use POST' }, 405)
  let corpo: Record<string, unknown> = {}
  try { corpo = await req.json() } catch { /* vazio */ }
  const acao = String(corpo.acao ?? '')

  try {
    if (acao === 'ver' || acao === 'criar_senha') {
      if (!tokenValido(corpo.token)) return json({ erro: LINK_RUIM.nao_existe }, 400)
      const hash = await hashDoToken(String(corpo.token))
      const { data: v, error } = await servico.rpc('link_de_acesso_ver', { hash })
      if (error) return json({ erro: 'Não deu para abrir o link agora. Tente de novo em instantes.' }, 500)
      const link = (v ?? {}) as Record<string, unknown>
      if (!link.ok) return json({ erro: LINK_RUIM[String(link.motivo)] ?? LINK_RUIM.nao_existe, motivo: link.motivo ?? 'nao_existe' }, 410)
      if (acao === 'ver') return json({ ok: true, nome: primeiroNome(link.nome), telefone: telefoneEscondido(link.telefone) })

      const senha = String(corpo.senha ?? '')
      const ruim = senhaValida(senha)
      if (ruim) return json({ erro: ruim }, 400)
      const email = String(corpo.email ?? '').trim().toLowerCase()
      if (email && !emailValido(email)) return json({ erro: 'Confira o e-mail (ou deixe em branco).' }, 400)
      const conta = String(link.conta)
      const { error: e1 } = await servico.auth.admin.updateUserById(conta, email ? { password: senha, email, email_confirm: true } : { password: senha })
      if (e1) {
        const ja = /already|registered|exists|duplicate/i.test(e1.message ?? '')
        return json({ erro: ja ? 'Esse e-mail já tem cadastro na MIMO. Use outro ou deixe em branco.' : 'Não deu para criar a senha agora. Tente de novo.' }, ja ? 409 : 500)
      }
      await servico.rpc('link_de_acesso_usar', { hash })
      const sessao = await sessaoDe(conta, senha)
      return json({ ok: true, sessao })
    }

    if (acao === 'pedir_link') {
      const numero = numeroCompleto(corpo.telefone)
      if (!numero) return json({ erro: 'Confira o WhatsApp: DDD e número (ex.: 13 99999-1234).' }, 400)
      const resposta = { ok: true, mensagem: 'Se esse WhatsApp tiver cadastro na MIMO, o link chega em instantes.' }
      const { data: pode } = await servico.rpc('acesso_tentativa', { chave_: `link:${numero}`, maximo: 3, minutos: 60 })
      if (pode === false) return json({ erro: 'Você já pediu o link algumas vezes. Espere um pouco e tente de novo.' }, 429)
      const { data: conta } = await servico.rpc('conta_para_entrar', { tel: numero })
      if (!conta) return json(resposta)
      const token = tokenNovo()
      const { error: eg } = await servico.rpc('link_de_acesso_guardar', { conta, hash: await hashDoToken(token), origem_: 'app' })
      if (eg) return json({ erro: 'Não deu para mandar o link agora. Tente de novo em instantes.' }, 500)
      const { data: casa } = await servico.rpc('instancia_da_casa')
      const { data: p } = await servico.from('profiles').select('full_name').eq('id', conta).maybeSingle()
      const env = await enviarPor('evolution', { telefone: numero, corpo: textoDoLinkPedido(urlDoLink(token, SITE), p?.full_name), identificador: (casa as string | null) ?? null })
      if (!env.ok) console.error('acesso: o link não saiu pelo WhatsApp da MIMO:', env.erro)
      return json(resposta)
    }

    if (acao === 'entrar') {
      const numero = numeroCompleto(corpo.telefone)
      const senha = String(corpo.senha ?? '')
      if (!numero || !senha) return json({ erro: 'Digite o WhatsApp com DDD e a senha.' }, 400)
      const { data: pode } = await servico.rpc('acesso_tentativa', { chave_: `entrar:${numero}`, maximo: 8, minutos: 15 })
      if (pode === false) return json({ erro: 'Muitas tentativas. Espere 15 minutos ou receba um link no WhatsApp.' }, 429)
      const { data: conta } = await servico.rpc('conta_para_entrar', { tel: numero })
      const sessao = conta ? await sessaoDe(String(conta), senha) : null
      if (!sessao) return json({ erro: 'WhatsApp ou senha não conferem. No primeiro acesso, toque em Receber link no WhatsApp.' }, 401)
      return json({ ok: true, sessao })
    }

    return json({ erro: 'ação desconhecida' }, 400)
  } catch (e) {
    console.error('acesso:', e)
    return json({ erro: 'Não deu agora. Tente de novo em instantes.' }, 500)
  }
})
