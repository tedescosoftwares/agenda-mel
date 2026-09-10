import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Sem as credenciais o app roda, mas mostra um aviso na tela de login
// Modo demonstração: liga com VITE_DEMO=1 e o app inteiro roda com
// dados fictícios, sem banco. Ver src/lib/demo.js.
export const isDemo = import.meta.env.VITE_DEMO === '1'

export const isSupabaseConfigured = isDemo || Boolean(supabaseUrl && supabaseAnonKey)

// "Load failed" (Safari) / "Failed to fetch" (Chrome): a requisição nem
// chegou — celular saindo do fundo, troca de Wi-Fi para 4G, túnel. Uma
// leitura pode simplesmente tentar de novo. Uma escrita não: repetir um
// "enviar recado" duplicaria. Então só GET, o token do login, e as RPCs
// que são só leitura.
const RPCS_DE_LEITURA = /\/rpc\/(minhas_agendas|config_publica|meu_perfil_resumo|contar_publico|meus_recados|relogio_status|resolver_codigo|horarios_livres|dias_com_vaga|meus_pedidos|saldo_creditos|vitrine_da_profissional|clientes_do_salao|minhas_trazidas|avaliacao_da_profissional|avaliacoes_da_profissional|minha_posicao|resumo_do_mes|resumo_do_salao|plataforma_[a-z_]+)(\?|$)/
const ESPERAS = [400, 1200, 2500]

async function fetchComRetentativa(url, opts = {}) {
  const metodo = (opts.method || 'GET').toUpperCase()
  const caminho = String(url)
  const podeRepetir = metodo === 'GET' || metodo === 'HEAD'
    || caminho.includes('/auth/v1/token')
    || (metodo === 'POST' && RPCS_DE_LEITURA.test(caminho))
  let ultimo
  for (let i = 0; i <= ESPERAS.length; i++) {
    try {
      return await fetch(url, opts)
    } catch (e) {
      ultimo = e
      const deRede = e instanceof TypeError || /load failed|failed to fetch|network/i.test(String(e?.message))
      if (!podeRepetir || !deRede || i === ESPERAS.length || opts.signal?.aborted) throw e
      await new Promise((r) => setTimeout(r, ESPERAS[i]))
    }
  }
  throw ultimo
}

export const supabase = isDemo
  ? (await import('./demo.js')).demo
  : isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: fetchComRetentativa } })
    : null
