import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Os pontos do mapa de acessos (3.13) no Leaflet, com os tiles do
// OpenStreetMap (sem chave). Carregado sob demanda por MapaAcessos. Cada
// ponto é um círculo meio transparente: onde muita gente ativou, a mancha
// fica mais forte. A dica diz quando foi e o salão mais perto.
const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function MapaPontos({ pontos, altura = 380 }) {
  const el = useRef(null)
  const mapa = useRef(null)
  const camada = useRef(null)

  useEffect(() => {
    if (!el.current || mapa.current) return
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>' }).addTo(m)
    m.setView([-24.18, -46.79], 12)
    mapa.current = m
    const t = setTimeout(() => m.invalidateSize(), 250)
    return () => { clearTimeout(t); m.remove(); mapa.current = null; camada.current = null }
  }, [])

  useEffect(() => {
    const m = mapa.current
    if (!m) return
    camada.current?.remove()
    const g = L.layerGroup()
    for (const p of pontos) {
      const dica = [quando(p.em), p.lugar ? `perto de ${p.lugar}${p.km != null ? ` (${String(p.km).replace('.', ',')} km)` : ''}` : null, p.prec ? `precisão ${p.prec} m` : null].filter(Boolean).join(' · ')
      L.circleMarker([p.lat, p.lng], { radius: 7, color: '#FF2D7A', weight: 1, opacity: 0.7, fillColor: '#FF2D7A', fillOpacity: 0.3 }).bindTooltip(dica).addTo(g)
    }
    g.addTo(m)
    camada.current = g
    if (pontos.length) m.fitBounds(L.latLngBounds(pontos.map((p) => [p.lat, p.lng])).pad(0.15), { maxZoom: 15 })
  }, [pontos])

  return <div ref={el} className="mapa-caixa pg-des-mapa" style={{ height: altura }} aria-label="Mapa com os pontos de quem ativou a localização" />
}
