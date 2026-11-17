// 3.90: instalar o app (PWA) na tela de início, para a profissional (e para quem mais precisar).
//
// O Chrome do Android avisa UMA vez, logo que a página abre, que dá para instalar (beforeinstallprompt). Este
// módulo é importado no main.jsx para pegar esse aviso cedo e guardar; o botão "Instalar agora" usa depois.
// No iPhone não existe botão: só o caminho Compartilhar › Adicionar à Tela de Início (o guia ensina).
let adiado = null
const ouvintes = new Set()
const avisar = () => ouvintes.forEach((f) => { try { f() } catch { /* nada */ } })

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); adiado = e; avisar() })
  window.addEventListener('appinstalled', () => {
    adiado = null
    try { localStorage.setItem('mimo-app-instalado', '1') } catch { /* sem armazenamento */ }
    avisar()
  })
}

export const podeInstalarDireto = () => Boolean(adiado)
export function ouvirInstalacao(f) { ouvintes.add(f); return () => ouvintes.delete(f) }

// abre a janelinha do próprio Android; devolve true se ela aceitou
export async function instalarDireto() {
  if (!adiado) return false
  const e = adiado
  e.prompt()
  const r = await e.userChoice.catch(() => null)
  adiado = null
  avisar()
  return r?.outcome === 'accepted'
}

// já está aberto pelo ícone da tela de início?
export function estaInstalado() {
  if (typeof window === 'undefined') return false
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true)
}

// que aparelho e que navegador (para mostrar o passo a passo certo)
export function aparelho() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || ''
  const ios = /iPhone|iPad|iPod/i.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const android = /Android/i.test(ua)
  return {
    ios,
    android,
    celular: ios || android,
    samsung: /SamsungBrowser/i.test(ua),
    // Chrome, Firefox ou Edge no iPhone: o Compartilhar fica no alto (iOS 16.4+); se não tiver, é no Safari
    iosOutroNavegador: ios && /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua),
    // o navegador de dentro do Instagram ou do Facebook não instala: precisa abrir no navegador de verdade
    embutido: /Instagram|FBAN|FBAV|FB_IAB/i.test(ua),
    // 3.93: no computador também instala (Chrome e Edge; Safari do Mac a partir do Sonoma). O Firefox não.
    navegadorPc: !(ios || android) ? navegadorDoPc(ua) : null,
    mac: /Macintosh|Mac OS X/i.test(ua) && !ios,
  }
}

function navegadorDoPc(ua) {
  if (/Edg\//.test(ua)) return 'edge'
  if (/Firefox\//.test(ua)) return 'firefox'
  if (/OPR\//.test(ua)) return 'chrome'          // Opera instala igual ao Chrome
  if (/Chrome\//.test(ua)) return 'chrome'
  if (/Safari\//.test(ua) && /Macintosh/.test(ua)) return 'safari'
  return 'chrome'
}

// o cartão "Coloque na tela de início" some por uma semana quando ela toca em "Agora não"
const CHAVE_DISPENSA = 'mimo-instalar-dispensado-em'
export function cartaoDispensado() {
  try {
    const em = Number(localStorage.getItem(CHAVE_DISPENSA) || 0)
    return em > 0 && Date.now() - em < 7 * 86400e3
  } catch { return false }
}
export function dispensarCartao() {
  try { localStorage.setItem(CHAVE_DISPENSA, String(Date.now())) } catch { /* sem armazenamento */ }
}
