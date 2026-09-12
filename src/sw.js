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
// o app pro (pro.mimo.com.vc) tem o ícone roxo; o da cliente, o rosa
const EH_PRO = self.location.hostname.startsWith('pro.')
const ICONE = EH_PRO ? '/pro-192.png' : '/pwa-192.png'
// avisos que pedem resposta ficam na tela até a pessoa tocar
const INSISTENTES = new Set(['pedido_de_aceite', 'vaga_disponivel', 'agenda_adiantada', 'atendimento_humano', 'pedido_pelo_whatsapp', 'recado'])

self.addEventListener('push', (event) => {
  let dados = {}
  try { dados = event.data ? event.data.json() : {} } catch { dados = { title: 'MIMO', body: event.data?.text?.() ?? '' } }
  const titulo = dados.title || 'MIMO'
  const opcoes = {
    body: dados.body || '',
    icon: ICONE,
    badge: '/badge-96.png',
    tag: dados.tag || dados.kind || 'mimo',
    renotify: true,
    requireInteraction: INSISTENTES.has(dados.kind),
    vibrate: [90, 40, 90],
    timestamp: Date.now(),
    data: { url: dados.url || '/', kind: dados.kind },
    lang: 'pt-BR',
  }
  event.waitUntil((async () => {
    await self.registration.showNotification(titulo, opcoes)
    // número no ícone do app (Android, iOS 16.4+ instalado): quantos não lidos
    if (typeof dados.badge === 'number' && 'setAppBadge' in self.navigator) {
      try { await self.navigator.setAppBadge(dados.badge) } catch { /* sem suporte */ }
    }
  })())
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
