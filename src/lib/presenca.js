import { isDemo } from './supabase'
import { podeContar, origemDaVisita } from './eventos'
import { descreverAparelho, ehPaginaPublica } from './aparelho'

// O site ao vivo (3.44, migração 192): enquanto a pessoa está numa página
// pública com a aba à vista, uma batida a cada 25 s diz ao banco em que
// página ela está (site_presenca). Ao esconder a aba ou fechar, uma batida de
// saída. Nada fica no aparelho: o banco reconhece a visita pelo código do dia
// (o mesmo das métricas, 156), calcula a cidade aproximada pelo IP e não
// guarda o IP. Quem autorizou a localização no "Perto de você" (guiaPerto)
// manda a posição junto, arredondada. Robô, navegador automatizado e quem
// trabalha na Plataforma não contam (podeContar). Tudo é "manda e esquece".

const URL_BANCO = import.meta.env.VITE_SUPABASE_URL
const CHAVE = import.meta.env.VITE_SUPABASE_ANON_KEY
export const BATIDA_MS = 25000
export { descreverAparelho, ehPaginaPublica }

// ---- a batida ----
let atual = null      // a página de agora (null: fora do site público)
let relogio = null
let local = null      // a posição de quem autorizou a localização, arredondada
let ouvindo = false
let primeira = null   // o temporizador da batida da página nova (espera o título)

function corpo(extra) {
  const e = origemDaVisita()
  const a = descreverAparelho({ ua: navigator.userAgent, uaData: navigator.userAgentData, toque: navigator.maxTouchPoints || 0 })
  let tela = null
  try { tela = `${Math.round(window.screen.width)}x${Math.round(window.screen.height)}` } catch { /* sem screen */ }
  return {
    pagina_: atual, titulo_: String(document.title || '').slice(0, 140), origem_: e.origem, ref_: e.ref, utm_: e.utm,
    dispositivo_: a.dispositivo, sistema_: a.sistema, navegador_: a.navegador, tela_: tela, idioma_: String(navigator.language || '').slice(0, 16) || null,
    lat_: local?.lat ?? null, lng_: local?.lng ?? null, sair_: false, ...extra,
  }
}

function mandar(c) {
  if (isDemo) { import('./demoAoVivo.js').then((m) => m.demoPresenca?.(c)).catch(() => {}); return }
  if (!URL_BANCO || !CHAVE) return
  try {
    fetch(`${URL_BANCO}/rest/v1/rpc/site_presenca`, {
      method: 'POST', keepalive: true,
      headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(c),
    }).catch(() => {})
  } catch { /* sem fetch: segue a vida */ }
}

function bater(extra = {}) {
  if (!atual || !podeContar()) return
  mandar(corpo(extra))
}
const ligar = () => { if (!relogio) relogio = setInterval(() => { if (document.visibilityState === 'visible') bater() }, BATIDA_MS) }
const desligar = () => { clearInterval(relogio); relogio = null }

function ouvir() {
  if (ouvindo) return
  ouvindo = true
  document.addEventListener('visibilitychange', () => {
    if (!atual) return
    if (document.visibilityState === 'hidden') { bater({ sair_: true }); desligar() } else { bater(); ligar() }
  })
  window.addEventListener('pagehide', () => { if (atual) bater({ sair_: true }) })
}

// a página mudou (o App chama a cada troca de rota). Fora do site público, para.
export function presencaNaPagina(caminho) {
  if (typeof window === 'undefined') return
  if (!ehPaginaPublica(caminho) || !podeContar()) {
    if (atual) { bater({ sair_: true }); atual = null; desligar() }
    return
  }
  if (caminho === atual) return
  atual = caminho
  ouvir()
  clearTimeout(primeira)
  primeira = setTimeout(() => { if (document.visibilityState === 'visible') bater() }, 400) // o título da página nova chega depois da rota
  ligar()
}

// quem autorizou a localização no guia (guiaPerto): a próxima batida leva a posição, com 3 casas (~100 m)
export function informarLocal(posicao) {
  const lat = Number(posicao?.lat), lng = Number(posicao?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  local = { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 }
  if (atual && document.visibilityState === 'visible') bater()
}
