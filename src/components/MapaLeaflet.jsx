import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// O mapa de verdade (Leaflet + tiles do OpenStreetMap, sem chave). Só
// entra na tela por `Mapa`, que carrega este pedaço sob demanda. Um pino
// da marca; quando `arrastavel`, a dona arrasta o pino ou toca no mapa
// para movê-lo e `onMover(lat, lng)` recebe a posição nova.
const PINO = L.divIcon({
  className: 'mapa-pino',
  html: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 44" aria-hidden="true"><path d="M17 1C8.2 1 1 8.1 1 16.9 1 28 17 43 17 43s16-15 16-26.1C33 8.1 25.8 1 17 1z" fill="#FF2D7A" stroke="#fff" stroke-width="2"/><circle cx="17" cy="17" r="6" fill="#fff"/></svg>',
  iconSize: [34, 44],
  iconAnchor: [17, 42],
})

export default function MapaLeaflet({ lat, lng, zoom = 16, arrastavel = false, interativo = true, onMover, altura = 200 }) {
  const el = useRef(null)
  const mapa = useRef(null)
  const pino = useRef(null)
  const cb = useRef(onMover)
  useEffect(() => { cb.current = onMover }, [onMover])

  useEffect(() => {
    if (!el.current || mapa.current) return
    const m = L.map(el.current, {
      zoomControl: arrastavel, attributionControl: true,
      dragging: interativo, touchZoom: interativo, scrollWheelZoom: arrastavel, doubleClickZoom: arrastavel,
      boxZoom: false, keyboard: false,
    })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>' }).addTo(m)
    m.setView([lat, lng], zoom)
    const p = L.marker([lat, lng], { icon: PINO, draggable: arrastavel, keyboard: false }).addTo(m)
    if (arrastavel) {
      p.on('dragend', () => { const q = p.getLatLng(); cb.current?.(q.lat, q.lng) })
      m.on('click', (e) => { p.setLatLng(e.latlng); cb.current?.(e.latlng.lat, e.latlng.lng) })
    }
    mapa.current = m
    pino.current = p
    // o container pode nascer dentro de algo que ainda está abrindo
    const t = setTimeout(() => m.invalidateSize(), 250)
    return () => { clearTimeout(t); m.remove(); mapa.current = null; pino.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mapa.current || !pino.current) return
    const atual = pino.current.getLatLng()
    if (Math.abs(atual.lat - lat) < 1e-7 && Math.abs(atual.lng - lng) < 1e-7) return
    pino.current.setLatLng([lat, lng])
    mapa.current.setView([lat, lng], mapa.current.getZoom(), { animate: true })
  }, [lat, lng])

  return <div ref={el} className="mapa-caixa" style={{ height: altura }} />
}
