import { LocateFixed } from 'lucide-react'
import { useMinhaPosicao, pedirPosicao } from '../../lib/guiaPerto'
import '../../guia-perto.css'

// "Perto de você" (3.13; 3.49) nas listas do guia: a linha que diz de onde a ordem por distância parte. Com o GPS,
// "a partir de onde você está" e a distância em cada cartão; sem ele, a partir da cidade aproximada da conexão (e um
// toque para usar a localização exata). O pedido ao navegador acontece ao entrar no guia (src/lib/guiaPerto.js) e a
// barra do topo (BarraLocal) mostra de onde o dado veio; aqui é só a ordem da lista.

// parcial (3.40): { carregados, total } quando a ordem por distância vale só para o que já está na tela; onTudo pede a lista inteira
export default function PertoDeVoce({ ordenado, onOrdenar, parcial = null, onTudo }) {
  const { origem, cidade, situacao } = useMinhaPosicao()
  if (!origem) return null
  const gps = origem === 'gps'
  const deOnde = gps ? 'a partir de onde você está' : `a partir de ${cidade?.cidade ?? 'sua cidade'} (aproximado pela sua conexão)`
  return (
    <div className={'gd-perto-ok' + (gps ? '' : ' gd-perto-aprox')} role="status" data-teste="perto-linha" data-origem={origem}>
      <LocateFixed size={18} aria-hidden="true" />
      <span>{!ordenado
        ? (gps ? 'Sua localização está ativa: cada salão mostra a distância.' : `Sua cidade, pela conexão, parece ser ${cidade?.cidade ?? '…'}${cidade?.uf ? `, ${cidade.uf}` : ''} (aproximado).`)
        : parcial ? `Do mais perto para o mais longe entre os ${parcial.carregados.toLocaleString('pt-BR')} primeiros da lista, ${deOnde}.`
          : `Do mais perto para o mais longe, ${deOnde}.`}</span>
      {ordenado && parcial && onTudo && (
        <button type="button" className="gd-perto-link" onClick={onTudo} data-teste="perto-em-tudo">Ver os mais perto entre todos os {parcial.total.toLocaleString('pt-BR')}</button>
      )}
      {!gps && <button type="button" className="gd-perto-link" onClick={() => pedirPosicao(true)} data-teste="perto-usar-gps">{situacao === 'pedindo' ? 'Achando você…' : 'Usar minha localização exata'}</button>}
      <button type="button" className="gd-perto-link" onClick={() => onOrdenar(!ordenado)}>{ordenado ? 'Ordem normal' : 'Ordenar por distância'}</button>
    </div>
  )
}
