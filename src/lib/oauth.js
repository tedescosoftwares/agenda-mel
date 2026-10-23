import { useEffect, useState } from 'react'
import { isDemo, supabase } from './supabase'
import { guardarConvite } from './convite'

// Entrar com o Google (3.60), na ponta da cliente. O Supabase cuida da conversa
// com o Google (Authentication → Providers → Google) e volta para o site com a
// sessão na própria URL (flowType implicit, ver supabase.js). O botão só aparece
// quando o provedor está ligado: o endpoint público de configuração do Auth diz
// quais estão (external: { google: true, … }). VITE_OAUTH=google,apple força a
// lista (o jeito antigo) sem perguntar.
const URL_SUPABASE = import.meta.env.VITE_SUPABASE_URL
const CHAVE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY
export const FORCADOS = String(import.meta.env.VITE_OAUTH || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

let cache = null
let pedido = null
export async function provedoresLigados() {
  if (cache) return cache
  if (FORCADOS.length) { cache = Object.fromEntries(FORCADOS.map((p) => [p, true])); return cache }
  if (isDemo) { cache = { google: true }; return cache }
  if (!URL_SUPABASE || !CHAVE_ANON) { cache = {}; return cache }
  if (!pedido) {
    pedido = fetch(`${URL_SUPABASE}/auth/v1/settings`, { headers: { apikey: CHAVE_ANON } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { cache = j?.external && typeof j.external === 'object' ? j.external : {}; return cache })
      .catch(() => { cache = {}; return cache })
  }
  return pedido
}

export function useProvedores() {
  const [prov, setProv] = useState(cache)
  useEffect(() => {
    let vivo = true
    provedoresLigados().then((p) => { if (vivo) setProv(p) })
    return () => { vivo = false }
  }, [])
  return prov ?? {}
}

// Abre o Google. `voltar` é para onde a pessoa volta depois: o /v/<código> quando
// veio por um convite (o código fica guardado e o vínculo nasce quando o perfil
// carregar, AuthContext), senão o início. A conta nova chega sem WhatsApp e o
// app pede antes de tudo (/cliente/completar, ProtectedRoute).
export async function entrarComGoogle({ convite, voltar } = {}) {
  if (convite) guardarConvite(convite)
  const caminho = voltar || (convite ? `/v/${convite}` : '/')
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + caminho, queryParams: { prompt: 'select_account' } },
  })
  return { error: error ? { message: traduzOAuth(error.message) } : null }
}

// 3.61.2: entrou pelo Google numa conta do OUTRO ambiente (a dona no mimo.com.vc,
// porque o Google tem o mesmo e-mail da conta dela). O AuthContext sai da conta e
// deixa aqui qual é o ambiente certo; o /login mostra o aviso com o link, igual ao
// login por e-mail. Vale 2 minutos: não limpa na leitura (o StrictMode lê duas vezes).
const CHAVE_CONTA_ERRADA = 'mimo-conta-errada'
export function guardarContaErrada(certo) { try { sessionStorage.setItem(CHAVE_CONTA_ERRADA, JSON.stringify({ certo, em: Date.now() })) } catch { /* sem armazenamento */ } }
export function lerContaErrada() {
  try {
    const v = JSON.parse(sessionStorage.getItem(CHAVE_CONTA_ERRADA) || 'null')
    return v && Date.now() - v.em < 120000 ? v.certo : null
  } catch { return null }
}
export function limparContaErrada() { try { sessionStorage.removeItem(CHAVE_CONTA_ERRADA) } catch { /* nada */ } }
export const MSG_CONTA_ERRADA = { pro: 'Essa conta é de profissional ou salão. Entre pelo MIMO Pro.', cliente: 'Essa conta é de cliente. Entre pelo MIMO, o app da cliente.' }

// a conta nasceu num provedor social (Google, Apple…), não por e-mail e senha
export function contaSocial(user) {
  const meta = user?.app_metadata ?? {}
  const lista = Array.isArray(meta.providers) ? meta.providers : meta.provider ? [meta.provider] : []
  return lista.some((p) => p && p !== 'email' && p !== 'phone')
}

// a cliente que entrou pelo Google e ainda não disse o WhatsApp: a tela "falta só
// o seu WhatsApp" vem antes de tudo. (Uma conta por e-mail sem telefone não cai
// aqui: a 067 zerou números repetidos de contas antigas, e elas seguem.)
export function precisaCompletar(user, profile) {
  return Boolean(profile && profile.role === 'cliente' && !profile.phone && contaSocial(user))
}

// o Google (ou o Supabase) pode voltar com erro no hash da URL: provedor
// desligado, acesso negado… Lê, limpa a URL e devolve a mensagem.
export function erroDoRetornoOAuth() {
  try {
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const cod = h.get('error_code') || h.get('error') || ''
    const desc = h.get('error_description') || ''
    if (!cod && !desc) return ''
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    return traduzOAuth(decodeURIComponent(desc.replace(/\+/g, ' ')) || cod)
  } catch { return '' }
}

export function traduzOAuth(msg) {
  const m = String(msg || '')
  if (/provider is not enabled|unsupported provider/i.test(m)) return 'Entrar com o Google ainda não está ligado. Entre com e-mail e senha, ou fale com o suporte.'
  if (/access_denied|cancel/i.test(m)) return 'Você cancelou no Google. Se quiser, é só tentar de novo.'
  if (/failed to fetch|load failed|network/i.test(m)) return 'Não foi possível conectar. Confira sua internet.'
  if (/database error/i.test(m)) return 'Não deu para criar a conta agora. Tenta de novo em um minuto, ou fale com o suporte.'
  return m || 'Não deu para entrar com o Google.'
}
