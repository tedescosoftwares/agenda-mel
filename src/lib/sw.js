// O service worker (abrir sem internet, avisos push, instalar na tela inicial)
// só se registra quando um pedaço do app carrega: as telas de entrada e as
// rotas /cliente, /pro, /admin e /plataforma importam este módulo. O site
// público não precisa dele e, antes, fazia cada visitante baixar o app inteiro
// em segundo plano. Quem já tem o app instalado segue com o mesmo SW.
export function registrarSW() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !import.meta.env.PROD) return
  const registrar = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
  if (document.readyState === 'complete') registrar()
  else window.addEventListener('load', registrar, { once: true })
}
registrarSW()
