import { isDemo } from './supabase'
import { DOMINIO_RAIZ } from './ambiente'

// As métricas do site (3.11): visitas e cliques das páginas públicas, sem
// cookie e sem guardar nada no aparelho de quem visita (o aviso do site
// promete "sem rastreio"). Quem conta visitante é o banco, com um código
// do dia que não identifica ninguém (migração 156, site_evento).
//
// Para evoluir:
//   - um tipo novo de evento é uma linha em site_eventos_tipos e uma
//     chamada registrarEvento('tipo') (ou data-evento="tipo" no botão);
//   - todo link dentro de um data-area já é classificado sozinho pelo
//     endereço (wa.me = whatsapp, tel: = ligar, maps = mapa, instagram,
//     outro site); data-area="heroi" diz também em que parte da página o
//     clique aconteceu, para saber qual botão converte mais;
//   - fora de um data-area (menu, rodapé, formulário) só conta o que tiver
//     data-evento: o WhatsApp da MIMO no rodapé não é contato com o salão.
//
// Não conta: robô, navegador automatizado, a prévia da Plataforma e o
// navegador de quem trabalha na Plataforma (naoContarAqui). Nunca trava a
// página: tudo é "manda e esquece", e erro some calado.

const URL_BANCO = import.meta.env.VITE_SUPABASE_URL
const CHAVE = import.meta.env.VITE_SUPABASE_ANON_KEY
const NAO_CONTAR = 'mimo-nao-contar'
const ROBO = /bot\b|bot\/|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|phantom|selenium|playwright|puppeteer/i

// quem trabalha na Plataforma não infla os números (o painel liga sozinho)
export function naoContarAqui(sim = true) {
  try { if (sim) localStorage.setItem(NAO_CONTAR, '1'); else localStorage.removeItem(NAO_CONTAR) } catch { /* sem storage */ }
}
export function contaAqui() {
  try { return !localStorage.getItem(NAO_CONTAR) } catch { return true }
}

export function podeContar() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (navigator.webdriver || ROBO.test(navigator.userAgent || '')) return false
  return contaAqui()
}

// de onde a pessoa veio. Só a primeira página da visita olha o referrer:
// depois disso, andar pelo site é "interno" (num app de uma página só, o
// document.referrer continua sendo o Google mesmo três cliques depois)
const ORIGENS = [
  [/(^|\.)google\./, 'google'], [/(^|\.)bing\.com$/, 'bing'], [/(^|\.)instagram\.com$|^l\.instagram\.com$/, 'instagram'],
  [/(^|\.)facebook\.com$|^l\.facebook\.com$|(^|\.)fb\.com$/, 'facebook'], [/(^|\.)whatsapp\.(com|net)$|^wa\.me$/, 'whatsapp'],
  [/(^|\.)tiktok\.com$/, 'tiktok'], [/(^|\.)youtube\.com$|^youtu\.be$/, 'youtube'],
]
let primeira = true
let entrada = null
export function origemDaVisita() {
  if (entrada) return entrada
  let origem = 'direto', ref = null, utm = null
  try {
    const q = new URLSearchParams(window.location.search)
    const u = { source: q.get('utm_source'), medium: q.get('utm_medium'), campaign: q.get('utm_campaign') }
    if (u.source || u.medium || u.campaign) utm = Object.fromEntries(Object.entries(u).filter(([, v]) => v).map(([k, v]) => [k, v.slice(0, 60)]))
    const r = document.referrer ? new URL(document.referrer) : null
    if (r && r.host && r.host !== window.location.host) {
      ref = r.hostname.toLowerCase().slice(0, 100)
      origem = ORIGENS.find(([re]) => re.test(ref))?.[1] ?? 'outro'
    } else if (r) origem = 'interno'
    const fonte = String(utm?.source ?? '').toLowerCase()
    const daUtm = ORIGENS.find(([, nome]) => fonte.includes(nome))?.[1]
    if (daUtm) origem = daUtm
  } catch { /* referrer estranho: fica "direto" */ }
  entrada = { origem, ref, utm }
  return entrada
}

function aparelho() {
  try { return window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 1024 ? 'celular' : 'computador' } catch { return null }
}

// manda e esquece. keepalive: o clique no WhatsApp troca de página na hora
// e o pedido ainda assim chega ao banco
export function registrarEvento(tipo, { pagina, area = null, dados = null, origem: forcarOrigem = null } = {}) {
  if (!podeContar() || !tipo) return
  const caminho = pagina ?? window.location.pathname
  const e = origemDaVisita()
  const corpo = {
    tipo_: tipo,
    pagina_: caminho,
    origem_: forcarOrigem ?? e.origem,
    ref_: forcarOrigem ? null : e.ref,
    aparelho_: aparelho(),
    area_: area,
    utm_: e.utm,
    dados_: dados,
  }
  if (isDemo) {
    import('./demoGuia.js').then((m) => m.demoEvento?.(corpo)).catch(() => {})
    import('./demoAoVivo.js').then((m) => m.demoAcao?.(corpo)).catch(() => {})
    return
  }
  if (!URL_BANCO || !CHAVE) return
  try {
    fetch(`${URL_BANCO}/rest/v1/rpc/site_evento`, {
      method: 'POST',
      keepalive: true,
      headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    }).catch(() => {})
  } catch { /* navegador sem fetch: segue a vida */ }
}

// a visita de uma página. Só a página com que o site abriu leva a origem de
// fora; chegar navegando pelo site (do blog, da home, de outra página do
// guia) é "interno". O react-router marca a primeira entrada do histórico
// com idx 0. O banco ainda junta visitas repetidas da mesma pessoa em 30 minutos.
let ultima = { caminho: '', em: 0 }
export function registrarVisita(pagina) {
  const caminho = pagina ?? (typeof window !== 'undefined' ? window.location.pathname : '')
  // o React monta duas vezes em desenvolvimento: a mesma página em 3 s é uma só
  if (ultima.caminho === caminho && Date.now() - ultima.em < 3000) return
  ultima = { caminho, em: Date.now() }
  let deFora = primeira
  try { if (window.history.state?.idx > 0) deFora = false } catch { /* sem history */ }
  registrarEvento('visita', { pagina: caminho, origem: deFora ? null : 'interno' })
  primeira = false
}

// o tipo de um link pelo endereço; null = link interno (vira visita da outra página)
export function tipoDoLink(href) {
  const h = String(href ?? '').trim()
  if (!h || h.startsWith('#')) return null
  if (/^tel:/i.test(h)) return 'ligar'
  if (/^mailto:/i.test(h)) return 'email'
  let u
  try { u = new URL(h, window.location.href) } catch { return null }
  const host = u.hostname.toLowerCase()
  if (host === 'wa.me' || /(^|\.)whatsapp\.com$/.test(host)) return 'whatsapp'
  if (/(^|\.)google\.[a-z.]+$/.test(host) && /\/maps/.test(u.pathname) || host === 'maps.app.goo.gl' || host === 'goo.gl') return 'mapa'
  if (/(^|\.)instagram\.com$/.test(host)) return 'instagram'
  // a própria MIMO (e a área do profissional) não é o site do salão
  if (u.host === window.location.host || host === DOMINIO_RAIZ || host === `pro.${DOMINIO_RAIZ}` || host === `www.${DOMINIO_RAIZ}`) return null
  return 'site'
}

// onClickCapture do embrulho da página: classifica o que foi tocado e registra.
// data-evento no elemento manda mais que o endereço do link; link sem
// data-evento só conta dentro de um data-area (o conteúdo do salão).
export function aoClicarNaPagina(e) {
  const alvo = e.target?.closest?.('[data-evento], a[href]')
  if (!alvo || alvo.closest('.ld-nav, .ld-pe')) return
  const zona = alvo.closest('[data-area]')
  const tipo = alvo.dataset?.evento || (alvo.tagName === 'A' && zona ? tipoDoLink(alvo.getAttribute('href')) : null)
  if (!tipo) return
  registrarEvento(tipo, { area: zona?.dataset.area ?? null })
}
