import { useEffect, useRef, useState } from 'react'
import { carregarGoogleMaps, PINO_SVG, ESTILO_MAPA } from '../lib/googleMaps'

// O mapa do Google (2.82.1), com a mesma cara do MapaLeaflet: um pino da
// marca; quando `arrastavel`, a dona arrasta o pino ou toca no mapa para
// movê-lo e `onMover(lat, lng)` recebe a posição nova. Só entra na tela
// por `Mapa`, que escolhe este quando há chave.
export default function MapaGoogle({ lat, lng, zoom = 16, arrastavel = false, interativo = true, onMover, altura = 200 }) {
  const el = useRef(null)
  const mapa = useRef(null)
  const pino = useRef(null)
  const cb = useRef(onMover)
  const [falhou, setFalhou] = useState(false)
  useEffect(() => { cb.current = onMover }, [onMover])

  useEffect(() => {
    let vivo = true
    carregarGoogleMaps().then((g) => {
      if (!vivo || !el.current || mapa.current) return
      const m = new g.Map(el.current, {
        center: { lat, lng }, zoom,
        disableDefaultUI: true,
        zoomControl: arrastavel,
        clickableIcons: false,
        gestureHandling: !interativo ? 'none' : arrastavel ? 'greedy' : 'cooperative',
        styles: ESTILO_MAPA,
        keyboardShortcuts: false,
      })
      const p = new g.Marker({
        map: m, position: { lat, lng }, draggable: arrastavel,
        icon: { url: PINO_SVG, scaledSize: new g.Size(34, 44), anchor: new g.Point(17, 42) },
      })
      if (arrastavel) {
        p.addListener('dragend', () => { const q = p.getPosition(); cb.current?.(q.lat(), q.lng()) })
        m.addListener('click', (e) => { p.setPosition(e.latLng); cb.current?.(e.latLng.lat(), e.latLng.lng()) })
      }
      mapa.current = m
      pino.current = p
    }).catch(() => { if (vivo) setFalhou(true) })
    return () => { vivo = false; mapa.current = null; pino.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mapa.current || !pino.current) return
    const atual = pino.current.getPosition()
    if (atual && Math.abs(atual.lat() - lat) < 1e-7 && Math.abs(atual.lng() - lng) < 1e-7) return
    pino.current.setPosition({ lat, lng })
    mapa.current.panTo({ lat, lng })
  }, [lat, lng])

  if (falhou) return <div className="mapa-caixa mapa-falhou" style={{ height: altura }}><span className="muted">O mapa não carregou. Confira a conexão.</span></div>
  return <div ref={el} className="mapa-caixa mapa-google" style={{ height: altura }} />
}
