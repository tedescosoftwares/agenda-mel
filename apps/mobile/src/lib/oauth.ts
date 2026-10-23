import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import type { User } from '@supabase/supabase-js'
import type { Perfil } from '@/context/sessao'
import { DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { supabase } from './supabase'

// Entrar com o Google (3.60), no app da cliente. O navegador do sistema abre o
// Google; o Google volta para o Supabase; o Supabase devolve para o app
// (mimo://auth/google, que precisa estar nas Redirect URLs do projeto) com a
// sessão na própria URL. Nada de SDK nativo do Google: o mesmo cliente OAuth da
// web serve. A conta nova chega sem WhatsApp e o app pede antes de tudo
// (src/app/completar.tsx, pela trava em _layout.tsx).

// fecha a aba do navegador na volta (web); no celular não faz nada
WebBrowser.maybeCompleteAuthSession()

let cache: Record<string, boolean> | null = null
// quais provedores estão ligados no Supabase (Authentication → Providers): o
// endpoint público de configuração do Auth diz (external: { google: true, … })
export async function provedoresLigados(): Promise<Record<string, boolean>> {
  if (cache) return cache
  if (DEMO) return (cache = { google: true })
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return (cache = {})
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } })
    const j = r.ok ? ((await r.json()) as { external?: Record<string, boolean> }) : null
    cache = j?.external && typeof j.external === 'object' ? j.external : {}
  } catch {
    cache = {}
  }
  return cache
}

// o caminho de volta para o app; vira mimo://auth/google no app instalado
export const voltaDoGoogle = () => Linking.createURL('auth/google')

// Abre o Google e espera a volta. Devolve a mensagem de erro, ou null quando
// entrou (ou quando a pessoa fechou o navegador sem entrar: aí não há o que dizer).
export async function entrarComGoogle(): Promise<string | null> {
  const redirectTo = voltaDoGoogle()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
  })
  if (error) return traduzirOAuth(error.message)
  if (DEMO) return null // a demo já "entrou" (src/lib/demo.ts)
  if (!data?.url) return 'Não deu para abrir o Google agora. Tenta de novo.'
  const r = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
  if (r.type !== 'success') return r.type === 'cancel' || r.type === 'dismiss' ? null : 'Não deu para entrar com o Google.'
  return sessaoDaUrl(r.url)
}

// A URL de volta: #access_token=…&refresh_token=… (fluxo implícito) ou ?code=…
// (PKCE); o erro vem em error_description. Guarda a sessão e devolve o erro, ou null.
export async function sessaoDaUrl(url: string): Promise<string | null> {
  const p = parametros(url)
  if (p.error_description || p.error) return traduzirOAuth(p.error_description || p.error || '')
  if (p.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(p.code)
    return error ? traduzirOAuth(error.message) : null
  }
  if (p.access_token && p.refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token: p.access_token, refresh_token: p.refresh_token })
    return error ? traduzirOAuth(error.message) : null
  }
  return 'O Google voltou sem a sessão. Tenta de novo.'
}

// a URL tem a sessão (ou um erro) do Google?
export const urlDoGoogle = (url: string) => /[?#&](access_token|code|error_description|error)=/.test(url)

function parametros(url: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const parte of url.split(/[?#]/).slice(1)) {
    for (const par of parte.split('&')) {
      const [k, v = ''] = par.split('=')
      if (k) {
        try {
          out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '))
        } catch {
          out[k] = v
        }
      }
    }
  }
  return out
}

// a conta nasceu num provedor social (Google, Apple…), não por e-mail e senha
export function contaSocial(usuario: User | null | undefined): boolean {
  const meta = (usuario?.app_metadata ?? {}) as { provider?: string; providers?: string[] }
  const lista = Array.isArray(meta.providers) ? meta.providers : meta.provider ? [meta.provider] : []
  return lista.some((p) => p && p !== 'email' && p !== 'phone')
}

// a cliente que entrou pelo Google e ainda não disse o WhatsApp: a tela
// "falta só o seu WhatsApp" vem antes das abas. Enquanto o perfil não chegou
// (perfilPronto=false) a conta social espera lá, em vez de piscar as abas.
export function precisaCompletar(usuario: User | null | undefined, perfil: Perfil | null, perfilPronto: boolean): boolean {
  if (!usuario || !contaSocial(usuario)) return false
  if (!perfilPronto) return true
  return Boolean(perfil && (perfil.role === 'cliente' || perfil.role === null) && !perfil.phone)
}

export function traduzirOAuth(m: string): string {
  if (/provider is not enabled|unsupported provider/i.test(m)) return 'Entrar com o Google ainda não está ligado. Entre com e-mail e senha, ou fale com o suporte.'
  if (/access_denied|cancel/i.test(m)) return 'Você cancelou no Google. Se quiser, é só tentar de novo.'
  if (/network|fetch|failed/i.test(m)) return 'Sem conexão. Confere a internet do celular e tenta de novo.'
  if (/database error/i.test(m)) return 'Não deu para criar a conta agora. Tenta de novo em um minuto, ou fale com o suporte.'
  return m || 'Não deu para entrar com o Google.'
}
