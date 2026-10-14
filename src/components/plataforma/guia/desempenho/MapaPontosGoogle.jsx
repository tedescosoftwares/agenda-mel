import { useEffect, useRef, useState } from 'react'
import { carregarGoogleMaps, ESTILO_MAPA } from '../../../../lib/googleMaps'

// Os pontos do mapa de acessos (3.13) no Google Maps, com a chave e o
// carregador que o app já usa (2.82.1) e a mesma cara limpa do MapaGoogle.
// Carregado sob demanda por MapaAcessos, que escolhe este quando há chave e
// o Leaflet quando não há. Cada ponto é um círculo meio transparente do
// tamanho da tela (não cresce com o zoom): onde muita gente ativou, a
// mancha fica mais forte. A dica diz quando foi e o salão mais perto.
const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const dicaDe = (p) => [quando(p.em), p.lugar ? `perto de ${p.lugar}${p.km != null ? ` (${String(p.km).replace('.', ',')} km)` : ''}` : null, p.prec ? `precisão ${p.prec} m` : null].filter(Boolean).join(' · ')

export default function MapaPontosGoogle({ pontos, altura = 380 }) {
  const el = useRef(null)
  const mapa = useRef(null)
  const marcas = useRef([])
  const google = useRef(null)
  const [pronto, setPronto] = useState(false)
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {
    let vivo = true
    carregarGoogleMaps().then((g) => {
      if (!vivo || !el.current || mapa.current) return
      google.current = g
      mapa.current = new g.Map(el.current, {
        center: { lat: -24.18, lng: -46.79 }, zoom: 12,
        disableDefaultUI: true, zoomControl: true, clickableIcons: false,
        gestureHandling: 'cooperative', styles: ESTILO_MAPA, keyboardShortcuts: false,
      })
      setPronto(true)
    }).catch(() => { if (vivo) setFalhou(true) })
    return () => { vivo = false; mapa.current = null; google.current = null }
  }, [])

  useEffect(() => {
    const g = google.current, m = mapa.current
    if (!pronto || !g || !m) return
    for (const x of marcas.current) x.setMap(null)
    marcas.current = []
    const limites = new g.LatLngBounds()
    for (const p of pontos) {
      const pos = { lat: p.lat, lng: p.lng }
      marcas.current.push(new g.Marker({
        map: m, position: pos, title: dicaDe(p), clickable: true, optimized: true,
        icon: { path: g.SymbolPath.CIRCLE, scale: 7, fillColor: '#FF2D7A', fillOpacity: 0.3, strokeColor: '#FF2D7A', strokeOpacity: 0.7, strokeWeight: 1 },
      }))
      limites.extend(pos)
    }
    if (pontos.length) {
      m.fitBounds(limites, 40)
      // um ponto só (ou todos juntos) não vira zoom de rua
      g.event.addListenerOnce(m, 'idle', () => { if (m.getZoom() > 15) m.setZoom(15) })
    }
  }, [pontos, pronto])

  if (falhou) return <div className="mapa-caixa pg-des-mapa mapa-falhou" style={{ height: altura }}><span className="muted">O mapa não carregou. Confira a conexão.</span></div>
  return <div ref={el} className="mapa-caixa mapa-google pg-des-mapa" style={{ height: altura }} aria-label="Mapa com os pontos de quem ativou a localização" />
}
