import { useRouter, type Href } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useCallback } from 'react'
import { WEB_URL } from './config'

// Caminhos da web que chegam ao app por um aviso push, por um link ou por um
// botão com o caminho antigo. Só caminhos relativos da própria MIMO: nada de
// //outro-site.
export function caminhoSeguro(v: unknown): string {
  if (typeof v !== 'string' || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return '/'
  return v
}

// Um caminho da web sem tela no app abre no navegador do sistema. Sem WebView:
// a sessão do app não sai do app; a página pede login se precisar.
export function useAbrirWeb() {
  return useCallback((ir: string) => {
    WebBrowser.openBrowserAsync(`${WEB_URL}${caminhoSeguro(ir)}`).catch(() => {})
  }, [])
}

// Caminhos da web que têm tela nativa: um aviso, um link ou um botão com o
// caminho antigo cai na tela do app.
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
  if (rota === '/cliente/perfil') return '/perfil'
  if (rota === '/cliente/saloes' || rota === '/entrar') return '/saloes'
  if (rota === '/cadastro') return { pathname: '/cadastro', params: q.get('convite') ? { convite: q.get('convite')! } : {} }
  if (rota === '/login') return { pathname: '/entrar', params: q.get('convite') ? { convite: q.get('convite')! } : {} }
  const v = (rota ?? '').match(/^\/v\/([^/]+)$/)
  if (v) return { pathname: '/v/[codigo]', params: { codigo: v[1]! } }
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

// ir('/cliente/agendamento/abc'): a tela nativa; sem tela, o navegador
export function useIr() {
  const router = useRouter()
  const abrir = useAbrirWeb()
  return useCallback(
    (caminho: string) => {
      const nativa = rotaNativa(caminhoSeguro(caminho))
      if (nativa) router.push(nativa)
      else abrir(caminho)
    },
    [router, abrir],
  )
}
