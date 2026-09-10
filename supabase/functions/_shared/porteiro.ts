// Quem pode drenar as filas (WhatsApp, e-mail, push)?
//
// Antes cada função comparava o token do chamador com a variável
// SUPABASE_SERVICE_ROLE_KEY. Isso quebra quando a chave é trocada no
// painel, quando o projeto passa para as chaves novas (sb_secret_...)
// ou quando a variável e o Vault ficam com versões diferentes: a
// função responde 401 "não autorizado" com a chave certa na mão.
//
// Agora a função usa o token do próprio chamador para falar com o
// banco. O gateway já validou a assinatura, e as funções puxar_*
// são revogadas de anon e authenticated: se o token não for de
// serviço, a primeira consulta volta "permission denied" e a função
// responde 401 do mesmo jeito, sem depender de comparação de string.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export function clienteDoChamador(req: Request): SupabaseClient | null {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', token, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

// erro de permissão do PostgREST => quem chamou não é a chave de serviço
export function semPermissao(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42501' || /permission denied|invalid api key|jwt/i.test(error.message ?? '')
}

export function naoAutorizado(detalhe?: string): Response {
  return new Response(JSON.stringify({ erro: 'não autorizado', detalhe: detalhe ?? 'chame com a chave de serviço (service_role ou sb_secret_)' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}
