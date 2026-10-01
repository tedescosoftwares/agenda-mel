import { lazy, Suspense } from 'react'
import { temGoogleMaps } from '../lib/googleMaps'

// O mapa, carregado só quando aparece: nem o Google nem o Leaflet pesam
// quem nunca abre uma página com endereço. Com chave do Google (2.82.1)
// é o Google Maps; sem, o Leaflet + OpenStreetMap de antes. Enquanto
// carrega, um retângulo que pulsa.
const MapaLeaflet = lazy(() => import('./MapaLeaflet'))
const MapaGoogle = lazy(() => import('./MapaGoogle'))

export default function Mapa(props) {
  const Qual = temGoogleMaps() ? MapaGoogle : MapaLeaflet
  return (
    <Suspense fallback={<div className="mapa-caixa mapa-carregando" style={{ height: props.altura ?? 200 }} aria-hidden="true" />}>
      <Qual {...props} />
    </Suspense>
  )
}
