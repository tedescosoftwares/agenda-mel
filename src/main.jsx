import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ligarMedidor } from './lib/medir.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

ligarMedidor()

// O Safari do iPhone ignora user-scalable=no dentro do navegador, mas
// respeita o cancelamento do gesto de pinça. Sem isto, a cliente
// belisca a agenda e a tela vira um site. (A plataforma de PC não é
// afetada: não há pinça no mouse.)
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false })
}
// ambiente pro (pro.mimo.com.vc): outro manifesto, outro nome na tela inicial
if (ehPro) {
  const link = document.querySelector('link[rel="manifest"]')
  if (link) link.setAttribute('href', '/manifest-pro.webmanifest')
  const titulo = document.querySelector('meta[name="apple-mobile-web-app-title"]')
  if (titulo) titulo.setAttribute('content', 'MIMO Pro')
  const cor = document.querySelector('meta[name="theme-color"]')
  if (cor) cor.setAttribute('content', '#aa4cff')
  document.title = 'MIMO Pro — sua agenda'
}

// (o toque duplo é barrado por CSS: touch-action em html/body. O jeito
// antigo, cancelando o touchend, roubava o teclado no iOS 18 instalado.)
