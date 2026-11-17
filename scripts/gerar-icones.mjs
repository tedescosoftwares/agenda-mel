// Gera os ícones do app a partir do coração do logo oficial (3.85: o mesmo de public/mimo-logo.svg).
//
//   NODE_PATH=$(npm root -g) CHROME=/opt/pw-browsers/chromium node scripts/gerar-icones.mjs
//
// Dois apps, dois ícones: a cliente (mimo.com.vc) com o coração branco no rosa, o pro
// (pro.mimo.com.vc) com o coração rosa no vinho do logo. Saem em public/:
//   pwa-192 / pwa-512 / pwa-maskable-512 / apple-180      cliente
//   pro-192 / pro-512 / pro-maskable-512 / pro-apple-180  pro
//   badge-96                                             monocromático (barra de status Android)
//   favicon.svg / favicon-pro.svg
// Usa o Chromium do Playwright para rasterizar o SVG.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
const { chromium } = createRequire(import.meta.url)('playwright')

// o coração e o rabinho do logo oficial (nas coordenadas do arquivo)
const CORACAO = 'M107 31 C94 14 65 19 65 45 C65 71 107 90 107 90 C107 90 149 71 149 45 C149 19 120 14 107 31 Z'
const RABO = 'M107 90 C129 94 148 104 166 118'
// a caixa do desenho com o traço: x 61..170, y 16..122
const CX = 115.5, CY = 69, LARG = 109

// o coração centralizado num quadrado de `tam`, ocupando `frac` da largura
function marca({ tam, frac, cor = '#fff', traco = 9 }) {
  const s = (tam * frac) / LARG
  return `<g transform="translate(${tam / 2} ${tam / 2}) scale(${s}) translate(${-CX} ${-CY})">
    <path d="${CORACAO}" fill="none" stroke="${cor}" stroke-width="${traco}" stroke-linejoin="round"/>
    <path d="${RABO}" fill="none" stroke="${cor}" stroke-width="${traco * 0.85}" stroke-linecap="round"/>
  </g>`
}

function fundo(tam, id, cores, rx) {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${cores[0]}"/><stop offset="0.55" stop-color="${cores[1]}"/><stop offset="1" stop-color="${cores[2]}"/>
  </linearGradient></defs>
  <rect width="${tam}" height="${tam}" rx="${rx}" fill="url(#${id})"/>
  <path d="M0 ${tam * 0.62} C ${tam * 0.3} ${tam * 0.5}, ${tam * 0.7} ${tam * 0.9}, ${tam} ${tam * 0.55} L ${tam} ${tam} L 0 ${tam} Z" fill="#000" opacity="0.06"/>`
}

const ROSA = ['#ff7aa8', '#ff2f73', '#d4135a']
const VINHO = ['#8e2347', '#65142f', '#420b1e']
const ROSA_LOGO = '#ff2f73'

function svg(tam, corpo, { transparente = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tam}" height="${tam}" viewBox="0 0 ${tam} ${tam}"${transparente ? '' : ''}>${corpo}</svg>`
}

const ICONES = {
  // arredondado (o sistema não recorta): cantos nossos
  'pwa-512': svg(512, fundo(512, 'a', ROSA, 112) + marca({ tam: 512, frac: 0.72 })),
  'pwa-192': svg(192, fundo(192, 'b', ROSA, 42) + marca({ tam: 192, frac: 0.72 })),
  'apple-180': svg(180, fundo(180, 'c', ROSA, 0) + marca({ tam: 180, frac: 0.72 })),
  // maskable: o sistema recorta o círculo/squircle dele; a marca fica na zona segura (60%)
  'pwa-maskable-512': svg(512, fundo(512, 'd', ROSA, 0) + marca({ tam: 512, frac: 0.56 })),
  'pro-512': svg(512, fundo(512, 'e', VINHO, 112) + marca({ tam: 512, frac: 0.72, cor: ROSA_LOGO })),
  'pro-192': svg(192, fundo(192, 'f', VINHO, 42) + marca({ tam: 192, frac: 0.72, cor: ROSA_LOGO })),
  'pro-apple-180': svg(180, fundo(180, 'g', VINHO, 0) + marca({ tam: 180, frac: 0.72, cor: ROSA_LOGO })),
  'pro-maskable-512': svg(512, fundo(512, 'h', VINHO, 0) + marca({ tam: 512, frac: 0.56, cor: ROSA_LOGO })),
  // badge: só a silhueta branca, fundo transparente (Android pinta na cor da barra)
  'badge-96': svg(96, marca({ tam: 96, frac: 0.92, traco: 12 }), { transparente: true }),
}

writeFileSync('public/favicon.svg', svg(64, fundo(64, 'fav', ROSA, 14) + marca({ tam: 64, frac: 0.76, traco: 11 })) + '\n')
writeFileSync('public/favicon-pro.svg', svg(64, fundo(64, 'favp', VINHO, 14) + marca({ tam: 64, frac: 0.76, cor: ROSA_LOGO, traco: 11 })) + '\n')

const b = await chromium.launch({ executablePath: process.env.CHROME || undefined })
for (const [nome, s] of Object.entries(ICONES)) {
  const tam = Number(s.match(/width="(\d+)"/)[1])
  const p = await b.newPage({ viewport: { width: tam, height: tam }, deviceScaleFactor: 1 })
  await p.setContent(`<style>html,body{margin:0;background:transparent}</style>${s}`)
  await p.screenshot({ path: `public/${nome}.png`, omitBackground: true, clip: { x: 0, y: 0, width: tam, height: tam } })
  await p.close()
  console.log('public/' + nome + '.png')
}
await b.close()
