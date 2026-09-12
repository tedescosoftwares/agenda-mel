// Gera os ícones do app a partir do coração da marca (MarcaIcon).
//
//   node scripts/gerar-icones.mjs
//
// Dois apps, dois ícones: a cliente (mimo.com.vc) em rosa, o pro
// (pro.mimo.com.vc) em roxo com o selo de check. Saem em public/:
//   pwa-192 / pwa-512 / pwa-maskable-512 / apple-180      cliente
//   pro-192 / pro-512 / pro-maskable-512 / pro-apple-180  pro
//   badge-96                                             monocromático (barra de status Android)
//   favicon.svg / favicon-pro.svg
// Usa o Chromium do Playwright para rasterizar o SVG.
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const CORACAO = 'M32 52 L11 31 C4 24 4 13 11 8 C17 3 26 4 32 11 C38 4 47 3 53 8 C60 13 60 24 53 31 L38 46'

// o coração (viewBox 64x56) centralizado num quadrado de `tam`, ocupando `frac` da largura
function marca({ tam, frac, cor = '#fff', traco = 9.5 }) {
  const w = tam * frac, s = w / 64, h = 56 * s
  const x = (tam - w) / 2, y = (tam - h) / 2 + s * 1.5
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="${CORACAO}" fill="none" stroke="${cor}" stroke-width="${traco}" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="32" cy="21" r="6" fill="${cor}"/>
  </g>`
}

function fundo(tam, id, cores, rx) {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${cores[0]}"/><stop offset="0.55" stop-color="${cores[1]}"/><stop offset="1" stop-color="${cores[2]}"/>
  </linearGradient></defs>
  <rect width="${tam}" height="${tam}" rx="${rx}" fill="url(#${id})"/>
  <path d="M0 ${tam * 0.62} C ${tam * 0.3} ${tam * 0.5}, ${tam * 0.7} ${tam * 0.9}, ${tam} ${tam * 0.55} L ${tam} ${tam} L 0 ${tam} Z" fill="#000" opacity="0.06"/>`
}

const ROSA = ['#ff8cc2', '#ff2d7a', '#b8086e']
const ROXO = ['#c49bff', '#aa4cff', '#5b1fa8']

// selo do pro: um círculo branco com check roxo no canto
function selo(tam) {
  const r = tam * 0.115, cx = tam * 0.78, cy = tam * 0.78
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff"/>
    <path d="M ${cx - r * 0.45} ${cy} l ${r * 0.3} ${r * 0.3} l ${r * 0.6} -${r * 0.62}" fill="none" stroke="#7a2bd6" stroke-width="${r * 0.22}" stroke-linecap="round" stroke-linejoin="round"/>`
}

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
  'pro-512': svg(512, fundo(512, 'e', ROXO, 112) + marca({ tam: 512, frac: 0.72 }) + selo(512)),
  'pro-192': svg(192, fundo(192, 'f', ROXO, 42) + marca({ tam: 192, frac: 0.72 }) + selo(192)),
  'pro-apple-180': svg(180, fundo(180, 'g', ROXO, 0) + marca({ tam: 180, frac: 0.72 }) + selo(180)),
  'pro-maskable-512': svg(512, fundo(512, 'h', ROXO, 0) + marca({ tam: 512, frac: 0.56 }) + selo(512)),
  // badge: só a silhueta branca, fundo transparente (Android pinta na cor da barra)
  'badge-96': svg(96, marca({ tam: 96, frac: 0.92, traco: 11 }), { transparente: true }),
}

writeFileSync('public/favicon.svg', svg(64, fundo(64, 'fav', ROSA, 14) + marca({ tam: 64, frac: 0.72 })) + '\n')
writeFileSync('public/favicon-pro.svg', svg(64, fundo(64, 'favp', ROXO, 14) + marca({ tam: 64, frac: 0.72 }) + selo(64)) + '\n')

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
