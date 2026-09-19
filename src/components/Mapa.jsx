import { lazy, Suspense } from 'react'

// O mapa, carregado só quando aparece: o Leaflet não pesa quem nunca
// abre uma página com endereço. Enquanto carrega, um retângulo que pulsa.
const MapaLeaflet = lazy(() => import('./MapaLeaflet'))

export default function Mapa(props) {
  return (
    <Suspense fallback={<div className="mapa-caixa mapa-carregando" style={{ height: props.altura ?? 200 }} aria-hidden="true" />}>
      <MapaLeaflet {...props} />
    </Suspense>
  )
}
