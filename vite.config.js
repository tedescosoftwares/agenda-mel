import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  server: {
    // aceita conexão de fora da máquina (celular na mesma rede, túnel)
    host: true,
    // o Vite recusa Host desconhecido desde a v6; libera os túneis
    allowedHosts: [
      '.ngrok-free.dev',
      '.ngrok-free.app',
      '.ngrok.io',
      '.trycloudflare.com',
      '.loca.lt',
    ],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'fontes/*.woff2'],
      // o service worker é nosso (src/sw.js): cache do app + push
      strategies: 'injectManifest',
      // o registro do SW não entra mais no index.html: é o app que registra (src/lib/sw.js),
      // para o site público não baixar o app inteiro em segundo plano (3.2)
      injectRegister: null,
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // O bundle principal passou de 2 MiB (o limite padrão do Workbox). Acima
        // do limite o plugin ABORTA o build no closeBundle, depois de já ter
        // escrito o sw.js sem o app no precache: foi assim que a VPS ficou meses
        // publicando "meio build" (sem as páginas estáticas e sem o sitemap) e
        // o erro só aparecia como "hook: closeBundle". 4 MiB dá folga; o remédio
        // de verdade é separar o site público do app (ver README, SEO).
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: 'MIMO — Agenda Mel',
        short_name: 'MIMO',
        description: 'Beleza na palma da mão',
        lang: 'pt-BR',
        id: '/',
        scope: '/',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f2f7',
        theme_color: '#ffffff',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
