import { useEffect, useSyncExternalStore } from 'react'
import { registrarEvento } from './eventos'

// "Perto de você" (3.13): a localização da pessoa nas listas do guia, só
// quando ela toca em "Ativar localização" no modal que explica o porquê.
// O navegador pergunta na hora do toque; a distância até cada salão é
// calculada aqui, no aparelho; o ponto exato vai para o banco uma vez por
// visita, como o evento 'localizacao' (o modal diz isso; a política de
// privacidade também). Quem já autorizou antes não vê o modal: a posição é
// lida sem perguntar, porque a permissão do navegador continua valendo, e
// o ponto vai de novo. "Agora não" fica no aparelho por 30 dias (é
// preferência, como o aviso de cookies promete); fechar o modal sem
// escolher vale só para esta visita.

const NAO = 'mimo-perto-nao'
const DIAS_NAO = 30

// situacao: sem | pedindo | ok | negado | indisponivel
// permissao: desconhecida | granted | prompt | denied (o que o navegador conta antes de perguntar)
let estado = { posicao: null, situacao: 'sem', permissao: 'desconhecida', fechadoNaVisita: false }
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
// "Agora não": 30 dias sem o modal voltar sozinho (o botão "Perto de mim" continua na lista)
export function dispensar() {
  try { localStorage.setItem(NAO, String(Date.now())) } catch { /* sem storage */ }
  mudar({ fechadoNaVisita: true })
}
// fechou sem escolher (Esc, toque fora): só nesta visita
export function fecharNaVisita() { mudar({ fechadoNaVisita: true }) }

// o que o navegador já sabe da permissão (Chrome, Firefox, Safari 16+); sem a API, 'prompt'
async function olharPermissao() {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { mudar({ permissao: 'denied', situacao: 'indisponivel' }); return }
  let p = 'prompt'
  try { p = (await navigator.permissions.query({ name: 'geolocation' })).state } catch { /* Safari antigo: não conta */ }
  mudar({ permissao: p })
  if (p === 'granted') pedirPosicao()
}

// pede a posição ao navegador (na primeira vez, é ele que pergunta à pessoa)
export function pedirPosicao() {
  if (estado.situacao === 'pedindo' || estado.posicao) return
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { mudar({ situacao: 'indisponivel' }); return }
  mudar({ situacao: 'pedindo' })
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const posicao = { lat: p.coords.latitude, lng: p.coords.longitude, prec: Math.round(p.coords.accuracy ?? 0) }
      mudar({ posicao, situacao: 'ok', permissao: 'granted' })
      if (!mandou) { mandou = true; registrarEvento('localizacao', { dados: posicao }) }
    },
    (e) => mudar(e?.code === 1 ? { situacao: 'negado', permissao: 'denied' } : { situacao: 'indisponivel' }),
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
    olharPermissao()
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
