import { useEffect, useSyncExternalStore } from 'react'
import { registrarEvento } from './eventos'

// "Perto de você" (3.13): a localização da pessoa nas listas do guia, só
// quando ela toca em "Ativar localização". O navegador pergunta na hora do
// toque; a distância até cada salão é calculada aqui, no aparelho; o ponto
// exato vai para o banco uma vez por visita, como o evento 'localizacao'
// (o aviso diz isso com todas as letras; a política de privacidade também).
// Quem já autorizou antes não vê o aviso de novo: a posição é lida sem
// perguntar, porque a permissão do navegador continua valendo, e o ponto
// vai de novo. "Agora não" fica no aparelho por 30 dias (é preferência,
// como o aviso de cookies promete).

const NAO = 'mimo-perto-nao'
const DIAS_NAO = 30

// situacao: sem | pedindo | ok | negado | indisponivel
let estado = { posicao: null, situacao: 'sem', dispensado: false }
let olhou = false   // já conferiu a permissão nesta visita
let mandou = false  // o ponto já foi para o banco nesta visita
const ouvintes = new Set()
function mudar(parte) {
  estado = { ...estado, ...parte }
  for (const f of ouvintes) f()
}
const assinar = (f) => { ouvintes.add(f); return () => ouvintes.delete(f) }
const ler = () => estado

export function dispensado() {
  try { return Number(localStorage.getItem(NAO) || 0) > Date.now() - DIAS_NAO * 86400e3 } catch { return false }
}
export function dispensar() {
  try { localStorage.setItem(NAO, String(Date.now())) } catch { /* sem storage */ }
  mudar({ dispensado: true })
}

// a permissão já dada antes (o navegador conta quando sabe)
async function permissaoDada() {
  try {
    const p = await navigator.permissions.query({ name: 'geolocation' })
    return p.state === 'granted'
  } catch { return false }
}

// pede a posição ao navegador (na primeira vez, é ele que pergunta à pessoa)
export function pedirPosicao() {
  if (estado.situacao === 'pedindo' || estado.posicao) return
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { mudar({ situacao: 'indisponivel' }); return }
  mudar({ situacao: 'pedindo' })
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const posicao = { lat: p.coords.latitude, lng: p.coords.longitude, prec: Math.round(p.coords.accuracy ?? 0) }
      mudar({ posicao, situacao: 'ok' })
      if (!mandou) { mandou = true; registrarEvento('localizacao', { dados: posicao }) }
    },
    (e) => mudar({ situacao: e?.code === 1 ? 'negado' : 'indisponivel' }),
    // sem alta precisão: mais rápido e gasta menos bateria; para ordenar salões, 100 m bastam
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60e3 },
  )
}

// olhar: false nas prévias da Plataforma (nada de ler a posição de quem trabalha)
export function useMinhaPosicao({ olhar = true } = {}) {
  const atual = useSyncExternalStore(assinar, ler, ler)
  useEffect(() => {
    if (!olhar || olhou) return
    olhou = true
    permissaoDada().then((sim) => { if (sim) pedirPosicao() })
  }, [olhar])
  return atual
}

// distância em linha reta, em km (haversine)
export function distanciaKm(a, b) {
  const R = 6371, rad = (g) => (g * Math.PI) / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
// "350 m", "1,2 km", "12 km"
export function kmTexto(km) {
  if (km == null || !Number.isFinite(km)) return ''
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`
  return `${Math.round(km)} km`
}
// cada lugar ganha distancia (km) a partir da posição; sem coordenada, fica sem e vai para o fim
export function comDistancia(lugares, posicao, ordenar = true) {
  if (!posicao) return lugares
  const lista = lugares.map((l) => {
    const lat = Number(l.latitude), lng = Number(l.longitude)
    const tem = l.latitude != null && l.longitude != null && Number.isFinite(lat) && Number.isFinite(lng)
    return { ...l, distancia: tem ? distanciaKm(posicao, { lat, lng }) : null }
  })
  if (!ordenar) return lista
  return lista.map((l, i) => [l, i]).sort(([a, i], [b, j]) => {
    if (a.distancia == null && b.distancia == null) return i - j
    if (a.distancia == null) return 1
    if (b.distancia == null) return -1
    return a.distancia - b.distancia || i - j
  }).map(([l]) => l)
}
