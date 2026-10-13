import { useRouter, type Href } from 'expo-router'
import { useCallback } from 'react'

// Caminhos da web que o app abre na ponte (src/app/web.tsx). Só caminhos
// relativos da própria MIMO: nada de //outro-site.
export function caminhoSeguro(v: unknown): string {
  if (typeof v !== 'string' || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return '/'
  return v
}

// abrir('/cliente/home', 'Agendar') empilha a ponte por cima da tela atual
export function useAbrirWeb() {
  const router = useRouter()
  return useCallback(
    (ir: string, titulo?: string) => {
      router.push({ pathname: '/web', params: titulo ? { ir, titulo } : { ir } })
    },
    [router],
  )
}

// Caminhos da web que já têm tela nativa: um aviso, um link ou um botão com
// o caminho antigo cai na tela do app, não na ponte. Conforme as telas vão
// virando nativas, esta lista cresce; quando a ponte sumir, ela some junto.
const RESERVADAS = new Set(['data', 'hora', 'confirmar', 'sucesso'])
export function rotaNativa(caminho: string): Href | null {
  const [rota, busca = ''] = caminho.split('?')
  const q = new URLSearchParams(busca)
  const parametros = Object.fromEntries(q.entries())
  const m = (rota ?? '').match(/^\/cliente\/agendamento\/([^/]+)$/)
  if (m && !RESERVADAS.has(m[1]!)) return { pathname: '/agendamento/[id]', params: { id: m[1]!, ...(q.get('avaliar') === '1' ? { avaliar: '1' } : {}) } }
  if (rota === '/cliente/agendamento/data') return { pathname: '/agendar/data', params: parametros }
  if (rota === '/cliente/meus-agendamentos') return '/horarios'
  if (rota === '/cliente/notificacoes') return '/avisos'
  if (rota === '/cliente/fila-espera') return '/fila'
  if (rota === '/cliente/indicacao' || rota === '/indique') return '/indicacao'
  if (rota === '/cliente/home' || rota === '/') return '/'
  const sv = (rota ?? '').match(/^\/cliente\/profissional\/([^/]+)\/servicos$/)
  if (sv) return { pathname: '/agendar/servicos', params: { prof: sv[1]!, ...(q.get('servico') ? { servico: q.get('servico')! } : {}) } }
  const pr = (rota ?? '').match(/^\/cliente\/profissional\/([^/]+)$/)
  if (pr) return { pathname: '/profissional/[id]', params: { id: pr[1]! } }
  const cat = (rota ?? '').match(/^\/cliente\/salao\/([^/]+)\/categoria\/([^/]+)$/)
  if (cat) return { pathname: '/categoria', params: { salao: cat[1]!, cat: cat[2]! } }
  const sl = (rota ?? '').match(/^\/cliente\/salao\/([^/]+)$/)
  if (sl) return { pathname: '/salao/[id]', params: { id: sl[1]! } }
  const pg = (rota ?? '').match(/^\/cliente\/pagamento\/([^/]+)$/)
  if (pg) return { pathname: '/pagamento/[id]', params: { id: pg[1]! } }
  const cmd = (rota ?? '').match(/^\/cliente\/comanda\/([^/]+)$/)
  if (cmd) return { pathname: '/comanda/[id]', params: { id: cmd[1]!, ...(q.get('de') ? { de: q.get('de')! } : {}) } }
  const se = (rota ?? '').match(/^\/cliente\/servico\/([^/]+)$/)
  if (se) return { pathname: '/servico/[id]', params: { id: se[1]!, ...(q.get('prof') ? { prof: q.get('prof')! } : {}), ...(q.get('sel') ? { sel: q.get('sel')! } : {}) } }
  return null
}

// ir('/cliente/agendamento/abc', 'Agendamento'): nativo se já existe, senão a ponte
export function useIr() {
  const router = useRouter()
  const abrir = useAbrirWeb()
  return useCallback(
    (caminho: string, titulo?: string) => {
      const nativa = rotaNativa(caminhoSeguro(caminho))
      if (nativa) router.push(nativa)
      else abrir(caminho, titulo)
    },
    [router, abrir],
  )
}
