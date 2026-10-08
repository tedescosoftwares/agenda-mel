import { dentroDoApp, supabase } from './supabase'

// A MIMO dentro do app da loja (apps/mobile): a tela é a web, numa WebView, e
// a sessão é do app. O app abre /sessao-app?ir=... com window.__mimoSessao
// injetada antes da página carregar; daqui para lá vai o que a web descobre
// sozinha (login feito na WebView, token renovado, saída). Tudo em JSON:
//   app -> web   window.__mimoSessao = { access_token, refresh_token } e o evento 'mimo:sessao'
//   web -> app   { tipo: 'sessao', access_token, refresh_token }
//                { tipo: 'sair' } | { tipo: 'fechar' } | { tipo: 'abrir', url } | { tipo: 'titulo', texto }
export { dentroDoApp }

export function mandarAoApp(msg) {
  if (!dentroDoApp) return false
  try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); return true } catch { return false }
}

// o AuthContext chama a cada mudança de sessão
export function avisarSessao(evento, session) {
  if (!dentroDoApp) return
  if (evento === 'SIGNED_OUT') { mandarAoApp({ tipo: 'sair' }); return }
  if (!session || (evento !== 'SIGNED_IN' && evento !== 'TOKEN_REFRESHED')) return
  // é a sessão que o próprio app injetou: não devolve, senão vira pingue-pongue
  if (window.__mimoSessao?.access_token === session.access_token) return
  window.__mimoSessao = { access_token: session.access_token, refresh_token: session.refresh_token }
  mandarAoApp({ tipo: 'sessao', access_token: session.access_token, refresh_token: session.refresh_token })
}

// o app renovou o token (ou entrou de novo): a web assume a sessão dele
export function ouvirApp() {
  if (!dentroDoApp || !supabase?.auth?.setSession) return () => {}
  const assumir = () => {
    const s = window.__mimoSessao
    if (s?.access_token && s?.refresh_token) {
      supabase.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token }).catch(() => { /* a tela de login resolve */ })
    }
  }
  window.addEventListener('mimo:sessao', assumir)
  return () => window.removeEventListener('mimo:sessao', assumir)
}

// a web sabe que está no app (CSS: html.mimo-app)
if (dentroDoApp) {
  try { document.documentElement.classList.add('mimo-app') } catch { /* sem DOM */ }
}
