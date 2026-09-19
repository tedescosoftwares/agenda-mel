import { Navigation, MapPinned, Compass } from 'lucide-react'
import Mapa from './Mapa'
import { linksDeRota, temPino, ehIos } from '../lib/geo'

// "Como chegar" da cliente: o mapa com o pino (um toque abre a rota) e os
// atalhos para o app de mapas. Sem pino, só os atalhos, buscando pelo
// texto do endereço. Sem endereço nenhum, não aparece.
export default function ComoChegar({ lat, lng, nome, endereco, cidade, altura = 150 }) {
  const pino = temPino(lat, lng)
  const rotas = linksDeRota({ lat, lng, nome, endereco, cidade })
  if (!rotas) return null
  return (
    <div className="como-chegar">
      {pino && (
        <div className="como-chegar-mapa">
          <Mapa lat={Number(lat)} lng={Number(lng)} zoom={16} interativo={false} altura={altura} />
          <a href={rotas.google} target="_blank" rel="noreferrer" aria-label={`Abrir a rota até ${nome ?? 'o salão'}`} />
          <span className="como-chegar-toque"><Navigation size={12} /> Toque para a rota</span>
        </div>
      )}
      <div className="rota-chips">
        <a className="rota-chip" href={rotas.google} target="_blank" rel="noreferrer"><MapPinned size={14} /> Google Maps</a>
        <a className="rota-chip" href={rotas.waze} target="_blank" rel="noreferrer"><Navigation size={14} /> Waze</a>
        {rotas.apple && ehIos() && <a className="rota-chip" href={rotas.apple} target="_blank" rel="noreferrer"><Compass size={14} /> Apple Maps</a>}
      </div>
    </div>
  )
}
