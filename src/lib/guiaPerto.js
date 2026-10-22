import { useEffect, useSyncExternalStore } from 'react'
import { registrarEvento } from './eventos'
import { informarLocal } from './presenca'
import { supabase } from './supabase'

// "Perto de você" (3.13; refeito na 3.49): ao entrar em qualquer página do guia, o site pede a localização ao navegador
// na hora (é ele que pergunta à pessoa, uma vez; depois lembra a resposta). Enquanto ela não responde, ou se recusa, a
// cidade vem aproximada pelo IP da conexão (site_minha_cidade, migração 196; nada é guardado) e a tela diz de onde veio
// ("Peruíbe, SP · pela sua conexão"): quem vê a cidade errada entende por que vale liberar a exata, num toque. Com o
// GPS, a distância até cada salão é calculada no aparelho, o ponto vai para o banco uma vez por visita (evento
// 'localizacao', como a política diz) e a cidade certa aparece. Nas prévias da Plataforma nada disso roda (olhar: false).

// situacao: sem | pedindo | ok | negado | indisponivel
// permissao: desconhecida | granted | prompt | denied (o que o navegador conta antes de perguntar)
// aprox: a cidade pelo IP ({cidade, uf, lat, lng}); aproxPonto: só o ponto dela (o mesmo objeto, estável, para ordenar)
// cidadeGps: a cidade do ponto do GPS (pelo banco), para a barra dizer "Você está em Peruíbe, SP"
let estado = { posicao: null, situacao: 'sem', permissao: 'desconhecida', aprox: null, aproxPonto: null, aproxLida: false, cidadeGps: null }
let olhou = false   // já conferiu a permissão nesta visita
let mandou = false  // o ponto já foi para o banco nesta visita
const ouvintes = new Set()
function mudar(parte) {
  estado = { ...estado, ...parte }
  for (const f of ouvintes) f()
}
const assinar = (f) => { ouvintes.add(f); return () => ouvintes.delete(f) }
const ler = () => estado

// "de onde eu pareço estar?": pelo IP da conexão ou, com o ponto, a cidade do GPS. Num banco sem a 196, fica sem
async function perguntarCidade(ponto = null) {
  try {
    const { data, error } = await supabase.rpc('site_minha_cidade', ponto ? { lat_: ponto.lat, lng_: ponto.lng } : {})
    if (error || !data?.cidade) return null
    const lat = Number(data.lat), lng = Number(data.lng)
    return { cidade: String(data.cidade), uf: data.uf ? String(data.uf) : null, lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null }
  } catch { return null }
}
async function lerAprox() {
  if (estado.aproxLida) return
  mudar({ aproxLida: true })
  const c = await perguntarCidade()
  if (c) mudar({ aprox: c, aproxPonto: c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : null })
}

// o que o navegador já sabe da permissão (Chrome, Firefox, Safari 16+); sem a API, 'prompt'. Salvo quando ela já
// bloqueou, pede a posição na hora: é o navegador que pergunta, e só na primeira vez
async function olharPermissao() {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { mudar({ permissao: 'denied', situacao: 'indisponivel' }); return }
  let p = 'prompt'
  try { p = (await navigator.permissions.query({ name: 'geolocation' })).state } catch { /* Safari antigo: não conta */ }
  mudar({ permissao: p })
  if (p !== 'denied') pedirPosicao()
}

// pede a posição ao navegador (na primeira vez, é ele que pergunta à pessoa). O botão da barra chama com toque: aí
// o pedido vai mesmo que outro esteja pendente (o automático pode estar parado num navegador que só pergunta com um gesto)
export function pedirPosicao(toque = false) {
  if (estado.posicao || (estado.situacao === 'pedindo' && toque !== true)) return
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { mudar({ situacao: 'indisponivel' }); return }
  mudar({ situacao: 'pedindo' })
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const posicao = { lat: p.coords.latitude, lng: p.coords.longitude, prec: Math.round(p.coords.accuracy ?? 0) }
      mudar({ posicao, situacao: 'ok', permissao: 'granted' })
      informarLocal(posicao) // 3.44: o site ao vivo mostra a cidade certa de quem autorizou
      if (!mandou) { mandou = true; registrarEvento('localizacao', { dados: posicao }) }
      perguntarCidade(posicao).then((c) => { if (c) mudar({ cidadeGps: c }) })
    },
    (e) => mudar(e?.code === 1 ? { situacao: 'negado', permissao: 'denied' } : { situacao: 'indisponivel' }),
    // sem alta precisão: mais rápido e gasta menos bateria; para ordenar salões, 100 m bastam
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60e3 },
  )
}

// olhar: false nas prévias da Plataforma (nada de ler a posição de quem trabalha)
// referencia: o ponto para ordenar (o GPS; sem ele, o centro da cidade aproximada) · origem: 'gps' | 'ip' | null
// cidade: a cidade que a tela mostra (a do GPS, quando o banco já disse qual é; senão a aproximada)
export function useMinhaPosicao({ olhar = true } = {}) {
  const atual = useSyncExternalStore(assinar, ler, ler)
  useEffect(() => {
    if (!olhar || olhou) return
    olhou = true
    lerAprox()
    olharPermissao()
  }, [olhar])
  const origem = atual.posicao ? 'gps' : atual.aproxPonto ? 'ip' : null
  return { ...atual, origem, referencia: atual.posicao ?? atual.aproxPonto, cidade: atual.posicao ? atual.cidadeGps : atual.aprox }
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
// cada lugar ganha distancia (km) a partir do ponto; sem coordenada, fica sem e vai para o fim.
// mostrar: false (3.49) ordena pela cidade aproximada do IP mas não escreve "a 3 km" nos cartões (seria chute)
export function comDistancia(lugares, posicao, ordenar = true, mostrar = true) {
  if (!posicao) return lugares
  const lista = lugares.map((l) => {
    const lat = Number(l.latitude), lng = Number(l.longitude)
    const tem = l.latitude != null && l.longitude != null && Number.isFinite(lat) && Number.isFinite(lng)
    return { ...l, distancia: tem ? distanciaKm(posicao, { lat, lng }) : null }
  })
  const pronta = !ordenar ? lista : lista.map((l, i) => [l, i]).sort(([a, i], [b, j]) => {
    if (a.distancia == null && b.distancia == null) return i - j
    if (a.distancia == null) return 1
    if (b.distancia == null) return -1
    return a.distancia - b.distancia || i - j
  }).map(([l]) => l)
  return mostrar ? pronta : pronta.map((l) => ({ ...l, distancia: null }))
}
