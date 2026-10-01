// O Google Maps no app (2.82.1): mapa do pino e geocodificação.
//
// A chave vem do build (VITE_GOOGLE_MAPS_KEY, no .env da VPS). É chave
// pública de front: a proteção é a restrição por domínio e por API no
// console do Google. Sem chave, o app cai no Leaflet + OpenStreetMap e
// no Nominatim, como antes. O script só é carregado quando um mapa
// aparece, uma vez por página.
export const CHAVE_GOOGLE_MAPS = String(import.meta.env.VITE_GOOGLE_MAPS_KEY ?? '').trim()
export const temGoogleMaps = () => Boolean(CHAVE_GOOGLE_MAPS)

let carregando = null
export function carregarGoogleMaps() {
  if (typeof window === 'undefined') return Promise.reject(new Error('sem janela'))
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps)
  if (carregando) return carregando
  if (!temGoogleMaps()) return Promise.reject(new Error('sem chave do Google Maps'))
  carregando = new Promise((ok, erro) => {
    const nome = '__mimoGoogleMapsPronto'
    window[nome] = () => { delete window[nome]; ok(window.google.maps) }
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CHAVE_GOOGLE_MAPS)}&v=weekly&loading=async&language=pt-BR&region=BR&callback=${nome}`
    s.async = true
    s.onerror = () => { carregando = null; delete window[nome]; erro(new Error('Não deu para carregar o Google Maps.')) }
    document.head.appendChild(s)
  })
  return carregando
}

// o pino da marca, o mesmo desenho do Leaflet
export const PINO_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 44" width="34" height="44"><path d="M17 1C8.2 1 1 8.1 1 16.9 1 28 17 43 17 43s16-15 16-26.1C33 8.1 25.8 1 17 1z" fill="#FF2D7A" stroke="#fff" stroke-width="2"/><circle cx="17" cy="17" r="6" fill="#fff"/></svg>')

// um mapa limpo: sem pontos de interesse gritando, sem controles que não usamos
export const ESTILO_MAPA = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
]
