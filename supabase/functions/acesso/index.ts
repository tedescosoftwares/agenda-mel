// acesso (3.98, migração 242): a cliente que se cadastrou pelo WhatsApp (sem senha) entra no app.
//
//   ver          o link de criar senha (/s/<token>) ainda vale? Devolve o primeiro nome e o telefone escondido.
//   criar_senha  com o link válido: grava a senha (e o e-mail, se ela quiser; sem confirmar, o telefone já foi
//                confirmado pelo WhatsApp), gasta o link e devolve a sessão para o app entrar direto.
//   pedir_link   "Receber link no WhatsApp" (primeiro acesso ou esqueceu a senha): manda um link novo pelo WhatsApp da
//                MIMO. Responde igual tendo ou não cadastro (ninguém descobre quem é cliente). 3 por hora por número.
//   visita       4.13 (migração 268): marcar sem criar conta. Nome, sobrenome e WhatsApp viram uma conta leve, sem senha,
//                e a sessão volta para o site seguir até o horário. O número NÃO foi conferido: um número que já tem
//                conta não entra por aqui (devolve existe: true; ela recebe o link no WhatsApp ou usa a senha).
//                Liga e desliga em config_publica.agendar_sem_cadastro. 3 por hora por número e 150 por hora no total.
//   convite_criar  4.38 (migração 272): a profissional cria a senha no link do convite do salão; sem segundo e-mail.
//   convite_whats  4.38: o salão manda esse convite pelo WhatsApp da MIMO (precisa estar logado como o salão).
//   entrar       WhatsApp e senha: acha a conta pelo número (só telefone confirmado) e devolve a sessão. 8 tentativas
//                a cada 15 minutos por número.
//
// Pública (quem chama ainda não entrou): a chave anônima basta. Senha nunca vai pelo WhatsApp: só o link, que vale uma
// vez, por 7 dias; no banco fica só o hash do token. O WhatsApp da MIMO é a instância da casa (whatsapp_instancia_casa).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enviarPor } from '../_shared/canais.ts'
import { numeroCompleto, telefoneEscondido, telefoneBonito, emailDoWhatsapp, nomeDeVerdade, tokenNovo, tokenValido, hashDoToken, urlDoLink, textoDoLinkPedido, senhaValida, emailValido, SITE_PADRAO } from '../_shared/acesso.ts'

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
      // 4.13: abrir o link prova que o número é dela. Se a conta veio do site (número só digitado), quem estava dentro sai.
      const { data: eraNova } = await servico.rpc('conta_conferida_pelo_link', { conta })
      if (eraNova === true) await servico.rpc('conta_encerrar_sessoes', { conta }).then(() => {}, () => {})
      const sessao = await sessaoDe(conta, senha)
      return json({ ok: true, sessao })
    }

    if (acao === 'pedir_link') {
      const numero = numeroCompleto(corpo.telefone)
      if (!numero) return json({ erro: 'Confira o WhatsApp: DDD e número (ex.: 13 99999-1234).' }, 400)
      const resposta = { ok: true, mensagem: 'Se esse WhatsApp tiver cadastro na MIMO, o link chega em instantes.' }
      const { data: pode } = await servico.rpc('acesso_tentativa', { chave_: `link:${numero}`, maximo: 3, minutos: 60 })
      if (pode === false) return json({ erro: 'Você já pediu o link algumas vezes. Espere um pouco e tente de novo.' }, 429)
      let { data: conta } = await servico.rpc('conta_para_entrar', { tel: numero })
      // 4.13: a conta feita pelo site ainda não tem o número conferido; o link é o que confere
      if (!conta) conta = (await servico.rpc('conta_para_link', { tel: numero })).data ?? null
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

    if (acao === 'visita') {
      const { data: cfg } = await servico.from('config_publica').select('valor').eq('chave', 'agendar_sem_cadastro').maybeSingle()
      if (cfg?.valor !== 'ligado') return json({ erro: 'Para marcar, crie sua conta ou entre.', desligado: true }, 403)
      const nome = nomeDeVerdade(`${String(corpo.nome ?? '').trim()} ${String(corpo.sobrenome ?? '').trim()}`)
      if (!nome) return json({ erro: 'Confira o nome e o sobrenome.' }, 400)
      const numero = numeroCompleto(corpo.telefone)
      if (!numero) return json({ erro: 'Confira o WhatsApp: DDD e número (ex.: 13 99999-1234).' }, 400)
      const { data: p1 } = await servico.rpc('acesso_tentativa', { chave_: `visita:${numero}`, maximo: 3, minutos: 60 })
      if (p1 === false) return json({ erro: 'Muitas tentativas com esse número. Espere um pouco ou entre com a sua conta.' }, 429)
      const { data: ja } = await servico.rpc('cliente_pelo_telefone', { tel: numero })
      if (ja) return json({ ok: false, existe: true })
      const { data: p2 } = await servico.rpc('acesso_tentativa', { chave_: 'visita:todas', maximo: 150, minutos: 60 })
      if (p2 === false) return json({ erro: 'Muita gente marcando agora. Crie sua conta ou tente de novo em alguns minutos.', cheio: true }, 429)
      // a senha é sorteada aqui e ninguém fica com ela: serve só para abrir esta sessão. Ela cria a dela depois, pelo link.
      const senha = tokenNovo(40)
      const email = emailDoWhatsapp(numero)
      const { data: novo, error: e1 } = await servico.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { full_name: nome, phone: telefoneBonito(numero), origem: 'site' } })
      if (e1 || !novo?.user?.id) {
        if (/already|registered|exists|duplicate/i.test(e1?.message ?? '')) return json({ ok: false, existe: true })
        console.error('acesso visita: não criou a conta:', e1?.message)
        return json({ erro: 'Não deu para continuar agora. Tente de novo em instantes.' }, 500)
      }
      await servico.rpc('cliente_da_visita', { conta: novo.user.id })
      const sessao = await sessaoDe(novo.user.id, senha)
      if (!sessao) return json({ erro: 'Não deu para continuar agora. Tente de novo em instantes.' }, 500)
      return json({ ok: true, sessao, nome: primeiroNome(nome) })
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

    // 4.38 (migração 272): a profissional abre o link do convite (/ativar/<token>) e cria a senha ali mesmo. O link
    // chegou no e-mail ou no WhatsApp que o salão cadastrou: isso já é a prova. A conta nasce com o e-mail do convite
    // confirmado (sem o segundo e-mail), o gatilho do cadastro liga a agenda (ativar_token) e a sessão volta pronta.
    if (acao === 'convite_criar') {
      const token = String(corpo.token ?? '').toLowerCase()
      if (!/^[a-f0-9]{16}$/.test(token)) return json({ erro: 'Esse link de acesso não vale. Peça outro ao salão.' }, 400)
      const { data: pode } = await servico.rpc('acesso_tentativa', { chave_: `convite_criar:${token}`, maximo: 8, minutos: 15 })
      if (pode === false) return json({ erro: 'Muitas tentativas. Espere 15 minutos e tente de novo.' }, 429)
      const senha = String(corpo.senha ?? '')
      const ruim = senhaValida(senha)
      if (ruim) return json({ erro: ruim }, 400)
      const { data: a } = await servico.rpc('acesso_por_token', { token })
      const conv = (a ?? null) as Record<string, any> | null
      if (!conv) return json({ erro: 'Link de acesso não encontrado. Confira com o salão.' }, 404)
      if (conv.usado || conv.tem_conta) return json({ erro: 'Esse acesso já foi ativado. É só entrar com a sua conta.', usado: true }, 409)
      if (conv.situacao === 'inativa') return json({ erro: 'Essa agenda está desativada. Fale com o salão.' }, 409)
      const email = String(conv.profissional?.email ?? '').trim().toLowerCase()
      if (!emailValido(email)) return json({ erro: 'O salão ainda não cadastrou o seu e-mail. Peça para ele completar e mandar o acesso de novo.' }, 409)
      const meta: Record<string, unknown> = { full_name: conv.profissional?.nome ?? '', phone: conv.profissional?.telefone ?? '', ativar_token: token }
      if (corpo.termos) meta.termos = corpo.termos
      if (corpo.aceites && typeof corpo.aceites === 'object') meta.aceites = corpo.aceites
      const { data: novo, error: e1 } = await servico.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: meta })
      if (e1 || !novo?.user?.id) {
        if (/already|registered|exists|duplicate/i.test(e1?.message ?? '')) return json({ ok: false, existe: true })
        console.error('acesso convite_criar: não criou a conta:', e1?.message)
        return json({ erro: 'Não deu para criar a conta agora. Tente de novo em instantes.' }, 500)
      }
      // o gatilho do cadastro já liga a agenda; se por algum motivo não ligou, liga aqui e diz o porquê se não der
      const { data: depois } = await servico.rpc('acesso_por_token', { token })
      if (!(depois as Record<string, any> | null)?.tem_conta) {
        const { error: e2 } = await servico.rpc('ativar_acesso_interno', { conta: novo.user.id, token, fone: conv.profissional?.telefone ?? null })
        if (e2) {
          await servico.auth.admin.deleteUser(novo.user.id).then(() => {}, () => {})
          return json({ erro: e2.message || 'Não deu para ativar o acesso. Fale com o salão.' }, 409)
        }
      }
      const sessao = await sessaoDe(novo.user.id, senha)
      return json({ ok: true, sessao })
    }

    // 4.38: o salão manda o acesso da profissional pelo WhatsApp da MIMO. Quem confere se pode é o banco
    // (acesso_convite_whats, com a conta de quem chamou); aqui só sai a mensagem. 3 por hora por profissional.
    if (acao === 'convite_whats') {
      const autorizacao = req.headers.get('Authorization') ?? ''
      if (!autorizacao) return json({ erro: 'Entre na sua conta para mandar o acesso.' }, 401)
      const prof = String(corpo.prof ?? '')
      const dela = createClient(URL_SUPABASE, CHAVE_ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: autorizacao } } })
      const { data: c, error: ec } = await dela.rpc('acesso_convite_whats', { prof, base: String(corpo.base ?? '') })
      if (ec) return json({ erro: ec.message || 'Não deu para preparar o acesso.' }, 400)
      const conv = (c ?? {}) as Record<string, any>
      const numero = numeroCompleto(conv.telefone)
      if (!numero) return json({ erro: 'Confira o WhatsApp dela: DDD e número.' }, 400)
      const { data: pode } = await servico.rpc('acesso_tentativa', { chave_: `convite_whats:${prof}`, maximo: 3, minutos: 60 })
      if (pode === false) return json({ erro: 'Você já mandou o acesso dela algumas vezes agora há pouco. Espere um pouco ou copie o link.' }, 429)
      const { data: casa } = await servico.rpc('instancia_da_casa')
      if (!casa) return json({ erro: 'O WhatsApp da MIMO não está conectado agora. Mande por e-mail ou copie o link.', sem_whats: true }, 503)
      const env = await enviarPor('evolution', { telefone: numero, corpo: String(conv.texto ?? ''), identificador: casa as string })
      if (!env.ok) {
        console.error('acesso convite_whats: não saiu:', env.erro)
        return json({ erro: 'A mensagem não saiu pelo WhatsApp agora. Mande por e-mail ou copie o link.', sem_whats: true }, 502)
      }
      return json({ ok: true, telefone: telefoneBonito(numero) })
    }

    return json({ erro: 'ação desconhecida' }, 400)
  } catch (e) {
    console.error('acesso:', e)
    return json({ erro: 'Não deu agora. Tente de novo em instantes.' }, 500)
  }
})
