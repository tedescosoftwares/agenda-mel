import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Sem as credenciais o app roda, mas mostra um aviso na tela de login
// Modo demonstração: liga com VITE_DEMO=1 e o app inteiro roda com
// dados fictícios, sem banco. Ver src/lib/demo.js.
export const isDemo = import.meta.env.VITE_DEMO === '1'

export const isSupabaseConfigured = isDemo || Boolean(supabaseUrl && supabaseAnonKey)

// ---- A rede do celular não é a do PC ---------------------------------------
// Três coisas que o iPhone faz com um app instalado e que deixavam a
// tela "sem carregar nada":
//   1. corta a rede no fundo; a primeira requisição ao voltar cai
//      ("Load failed") ou fica pendurada sem resposta nenhuma
//   2. o token de acesso venceu enquanto o app dormia; a requisição
//      volta 401 "JWT expired" e a tela mostra vazio
//   3. ficou horas no fundo: o estado da tela é de outra era
// Aqui: tempo máximo por requisição, leitura repete quando cai, 401 de
// token vencido renova a sessão e refaz a chamada, e voltar do fundo
// depois de muito tempo recarrega o app.
const RPCS_DE_LEITURA = /\/rpc\/(minhas_agendas|config_publica|meu_perfil_resumo|contar_publico|meus_recados|relogio_status|resolver_codigo|horarios_livres|dias_com_vaga|meus_pedidos|saldo_creditos|vitrine_da_profissional|clientes_do_salao|minhas_trazidas|avaliacao_da_profissional|avaliacoes_da_profissional|minha_posicao|resumo_do_mes|resumo_do_salao|plataforma_[a-z_]+)(\?|$)/
const ESPERAS = [400, 1200, 2500]
const TEMPO_MAXIMO = 15000

let cliente = null
let renovando = null

function ehLeitura(url, opts) {
  const metodo = (opts.method || 'GET').toUpperCase()
  const caminho = String(url)
  return metodo === 'GET' || metodo === 'HEAD'
    || caminho.includes('/auth/v1/token')
    || (metodo === 'POST' && RPCS_DE_LEITURA.test(caminho))
}

function comTempoMaximo(opts) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('tempo esgotado', 'TimeoutError')), TEMPO_MAXIMO)
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort(opts.signal.reason)
    else opts.signal.addEventListener('abort', () => ctrl.abort(opts.signal.reason), { once: true })
  }
  return { opts: { ...opts, signal: ctrl.signal }, limpar: () => clearTimeout(timer) }
}

function trocarToken(opts, token) {
  const h = new Headers(opts.headers || {})
  if (h.has('Authorization')) h.set('Authorization', `Bearer ${token}`)
  return { ...opts, headers: h }
}

async function renovarSessao() {
  if (!cliente) return null
  if (!renovando) {
    renovando = cliente.auth.refreshSession()
      .then(({ data, error }) => {
        if (error || !data?.session) {
          // refresh token morto: a sessão acabou de verdade. Melhor a
          // tela de login que um app que parece quebrado.
          if (/refresh token|not found|invalid/i.test(String(error?.message))) cliente.auth.signOut().catch(() => {})
          return null
        }
        return data.session.access_token
      })
      .finally(() => { renovando = null })
  }
  return renovando
}

async function fetchResiliente(url, opts = {}) {
  const leitura = ehLeitura(url, opts)
  const ehAuth = String(url).includes('/auth/v1/')
  let ultimo
  for (let i = 0; i <= ESPERAS.length; i++) {
    const { opts: o, limpar } = comTempoMaximo(opts)
    try {
      const r = await fetch(url, o)
      limpar()
      // token vencido no meio do caminho: renova uma vez e refaz
      if (r.status === 401 && !ehAuth && i === 0) {
        const texto = await r.clone().text().catch(() => '')
        if (/jwt expired|PGRST301|token is expired/i.test(texto)) {
          const novo = await renovarSessao()
          if (novo) { opts = trocarToken(opts, novo); continue }
        }
      }
      return r
    } catch (e) {
      limpar()
      ultimo = e
      const cancelado = opts.signal?.aborted
      const deRede = e instanceof TypeError || e?.name === 'TimeoutError' || e?.name === 'AbortError' || /load failed|failed to fetch|network|tempo esgotado/i.test(String(e?.message))
      if (cancelado || !leitura || !deRede || i === ESPERAS.length) throw e
      await new Promise((r) => setTimeout(r, ESPERAS[i]))
    }
  }
  throw ultimo
}

// ficou muito tempo no fundo? recarrega: sessão, dados e tela, tudo fresco
if (typeof document !== 'undefined' && !isDemo) {
  let escondidoEm = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { escondidoEm = Date.now(); return }
    if (escondidoEm && Date.now() - escondidoEm > 20 * 60 * 1000) window.location.reload()
    escondidoEm = 0
  })
}

export const supabase = isDemo
  ? (await import('./demo.js')).demo
  : isSupabaseConfigured
    ? (cliente = createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: fetchResiliente } }))
    : null
