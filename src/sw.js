/* eslint-env serviceworker */
// O service worker do MIMO. Duas responsabilidades:
//   1. cache do app (Workbox), para abrir rápido e funcionar sem sinal
//   2. push: mostrar o aviso que o servidor mandou e abrir a tela certa
//
// Antes o vite-plugin-pwa gerava este arquivo sozinho; passou a ser
// escrito à mão (injectManifest) porque push exige código nosso aqui.
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { clientsClaim } from 'workbox-core'

self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// qualquer rota do app (/cliente/home, /p/ana…) abre com o index.html
// do cache; a API e as funções não passam por aqui
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), {
  denylist: [/^\/functions\//, /^\/rest\//, /^\/auth\//, /^\/storage\//],
}))

// ---- push ---------------------------------------------------------------
self.addEventListener('push', (event) => {
  let dados = {}
  try { dados = event.data ? event.data.json() : {} } catch { dados = { title: 'MIMO', body: event.data?.text?.() ?? '' } }
  const titulo = dados.title || 'MIMO'
  const opcoes = {
    body: dados.body || '',
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    tag: dados.tag || dados.kind || 'mimo',
    renotify: Boolean(dados.tag),
    data: { url: dados.url || '/' },
    lang: 'pt-BR',
  }
  event.waitUntil(self.registration.showNotification(titulo, opcoes))
})

// toque no aviso: foca o app se estiver aberto, senão abre na tela certa
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of abertas) {
      if ('focus' in c) {
        await c.focus()
        if ('navigate' in c && c.url !== url) await c.navigate(url).catch(() => {})
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})
