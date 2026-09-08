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
// toque duplo rápido também dava zoom em alguns iPhones
let ultimoToque = 0
document.addEventListener('touchend', (e) => {
  const agora = Date.now()
  if (agora - ultimoToque < 300 && e.target.closest('input, textarea, [contenteditable]') === null) e.preventDefault()
  ultimoToque = agora
}, { passive: false })
