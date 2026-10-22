import { useEffect, useRef, useState } from 'react'
import { carregarGoogleMaps, ESTILO_MAPA } from '../../../lib/googleMaps'

// O mapa do site ao vivo (3.44; bolinhas refeitas na 3.49.5): um ponto por visita no site agora e (3.49) por quem
// passou no período. Rosa: cidade pelo GPS de quem autorizou a localização; roxo: aproximada pelo IP. "No site agora"
// é um ponto grande com halo (bem visível); "passou" é menor, mas com a mesma cor viva (antes era cinza apagado).
// Enquadra uma vez (quando chegam os primeiros pontos) e depois só põe, move e tira os pontos a cada leitura.

// um pouco mais de personalidade só aqui: a terra com um tom de ameixa bem leve, a água mais viva, as cidades em ameixa
const ESTILO_VIVO = [
  ...ESTILO_MAPA,
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f6f1f8' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dcebf2' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#7a3d8f' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#e7d9ee' }] },
]

const COR = { gps: '#FF2D7A', ip: '#7C3AED' }
// o ícone com halo: desenhado uma vez por combinação (gps/ip × agora/passou) e guardado
function icone(g, tipo, ativo, cache) {
  const chave = `${tipo}-${ativo ? 'a' : 'p'}`
  const feito = cache.get(chave)
  if (feito) return feito
  const cor = COR[tipo] ?? COR.ip
  const W = ativo ? 42 : 30, c = W / 2
  const halo = ativo ? 19 : 13, core = ativo ? 9 : 6.5
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">`
    + `<circle cx="${c}" cy="${c}" r="${halo}" fill="${cor}" opacity="${ativo ? 0.26 : 0.18}"/>`
    + (ativo ? `<circle cx="${c}" cy="${c}" r="${core + 4}" fill="${cor}" opacity="0.45"/>` : '')
    + `<circle cx="${c}" cy="${c}" r="${core}" fill="${cor}" stroke="#ffffff" stroke-width="${ativo ? 2.5 : 1.75}"/></svg>`
  const ic = { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new g.Size(W, W), anchor: new g.Point(c, c) }
  cache.set(chave, ic)
  return ic
}

export default function MapaAoVivo({ pontos, altura = 300 }) {
  const el = useRef(null)
  const mapa = useRef(null)
  const google = useRef(null)
  const marcas = useRef(new Map())
  const icones = useRef(new Map())
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
        gestureHandling: 'cooperative', styles: ESTILO_VIVO, keyboardShortcuts: false,
        backgroundColor: '#f6f1f8',
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
      const ativo = p.ativo !== false
      const ic = icone(g, p.gps ? 'gps' : 'ip', ativo, icones.current)
      const z = (ativo ? 20 : 10) + (p.gps ? 2 : 0)
      const ja = marcas.current.get(p.id)
      if (ja) { ja.setPosition(pos); ja.setTitle(p.titulo); ja.setIcon(ic); ja.setZIndex(z) } else marcas.current.set(p.id, new g.Marker({ map: m, position: pos, title: p.titulo, icon: ic, optimized: true, zIndex: z }))
    })
    for (const [id, mk] of marcas.current) if (!vistos.has(id)) { mk.setMap(null); marcas.current.delete(id) }
    if (!enquadrou.current && pontos.length) {
      enquadrou.current = true
      const limites = new g.LatLngBounds()
      for (const p of pontos) limites.extend({ lat: p.lat, lng: p.lng })
      m.fitBounds(limites, 48)
      g.event.addListenerOnce(m, 'idle', () => { if (m.getZoom() > 12) m.setZoom(12) })
    }
  }, [pontos, pronto])

  if (falhou) return <div className="mapa-caixa mapa-falhou" style={{ height: altura }}><span className="muted">O mapa não carregou. Confira a conexão.</span></div>
  return <div ref={el} className="mapa-caixa mapa-google pv-mapa" style={{ height: altura }} aria-label="Mapa com quem está no site agora" data-teste="ao-vivo-mapa" />
}
