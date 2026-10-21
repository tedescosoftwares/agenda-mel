import { useEffect, useRef, useState } from 'react'
import { carregarGoogleMaps, ESTILO_MAPA } from '../../../lib/googleMaps'

// O mapa do site ao vivo (3.44): um ponto por visita no site agora. Enquadra uma vez (quando chegam os primeiros
// pontos) e depois só põe, move e tira os pontos a cada leitura, sem pular o mapa a cada 5 s. Rosa: cidade pelo GPS
// de quem autorizou a localização; cinza: aproximada pelo IP (muitas visitas caem no mesmo ponto da cidade).
export default function MapaAoVivo({ pontos, altura = 300 }) {
  const el = useRef(null)
  const mapa = useRef(null)
  const google = useRef(null)
  const marcas = useRef(new Map())
  const enquadrou = useRef(false)
  const [pronto, setPronto] = useState(false)
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {
    let vivo = true
    const guardadas = marcas.current
    carregarGoogleMaps().then((g) => {
      if (!vivo || !el.current || mapa.current) return
      google.current = g
      mapa.current = new g.Map(el.current, {
        center: { lat: -24.0, lng: -46.6 }, zoom: 9,
        disableDefaultUI: true, zoomControl: true, clickableIcons: false,
        gestureHandling: 'cooperative', styles: ESTILO_MAPA, keyboardShortcuts: false,
      })
      setPronto(true)
    }).catch(() => { if (vivo) setFalhou(true) })
    return () => { vivo = false; for (const m of guardadas.values()) m.setMap(null); guardadas.clear(); mapa.current = null; google.current = null }
  }, [])

  useEffect(() => {
    const g = google.current, m = mapa.current
    if (!pronto || !g || !m) return
    const vistos = new Set()
    pontos.forEach((p, i) => {
      vistos.add(p.id)
      // várias visitas na mesma cidade pelo IP caem no mesmo ponto: um leve deslocamento separa
      const pos = { lat: p.lat + (p.gps ? 0 : ((i % 5) - 2) * 0.004), lng: p.lng + (p.gps ? 0 : ((Math.floor(i / 5) % 5) - 2) * 0.004) }
      const icone = { path: g.SymbolPath.CIRCLE, scale: 8, fillColor: p.gps ? '#FF2D7A' : '#8a8f9c', fillOpacity: 0.55, strokeColor: '#fff', strokeWeight: 2 }
      const ja = marcas.current.get(p.id)
      if (ja) { ja.setPosition(pos); ja.setTitle(p.titulo); ja.setIcon(icone) } else marcas.current.set(p.id, new g.Marker({ map: m, position: pos, title: p.titulo, icon: icone, optimized: true }))
    })
    for (const [id, mk] of marcas.current) if (!vistos.has(id)) { mk.setMap(null); marcas.current.delete(id) }
    if (!enquadrou.current && pontos.length) {
      enquadrou.current = true
      const limites = new g.LatLngBounds()
      for (const p of pontos) limites.extend({ lat: p.lat, lng: p.lng })
      m.fitBounds(limites, 40)
      g.event.addListenerOnce(m, 'idle', () => { if (m.getZoom() > 12) m.setZoom(12) })
    }
  }, [pontos, pronto])

  if (falhou) return <div className="mapa-caixa mapa-falhou" style={{ height: altura }}><span className="muted">O mapa não carregou. Confira a conexão.</span></div>
  return <div ref={el} className="mapa-caixa mapa-google pv-mapa" style={{ height: altura }} aria-label="Mapa com quem está no site agora" data-teste="ao-vivo-mapa" />
}
