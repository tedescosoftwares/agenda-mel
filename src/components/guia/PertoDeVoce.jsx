import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, LocateFixed, LoaderCircle } from 'lucide-react'
import { useMinhaPosicao, pedirPosicao, dispensar, dispensado } from '../../lib/guiaPerto'
import '../../guia-perto.css'

// O aviso "Perto de você" (3.13) nas listas do guia. Diz o que é feito com a
// localização e que o ponto fica guardado: quem toca em "Ativar" sabe o que
// está autorizando. Some com "Agora não" (30 dias) ou quando a posição chega;
// aí vira a linha "do mais perto para o mais longe", com a opção de voltar
// à ordem normal. Com a permissão já dada antes, nem aparece: a posição
// chega sozinha.
export default function PertoDeVoce({ ordenado, onOrdenar }) {
  const { posicao, situacao } = useMinhaPosicao()
  const [fechado, setFechado] = useState(() => dispensado())

  if (posicao) {
    return (
      <div className="gd-perto gd-perto-ok" role="status">
        <LocateFixed size={18} aria-hidden="true" />
        <span>{ordenado ? 'Do mais perto para o mais longe, a partir de onde você está.' : 'Sua localização está ativa: cada salão mostra a distância.'}</span>
        <button type="button" className="gd-perto-link" onClick={() => onOrdenar(!ordenado)}>{ordenado ? 'Ordem normal' : 'Ordenar por distância'}</button>
      </div>
    )
  }
  if (fechado || situacao === 'indisponivel') return null
  const pedindo = situacao === 'pedindo'
  return (
    <div className="gd-perto" role="region" aria-label="Salões perto de você">
      <MapPin size={22} aria-hidden="true" />
      <div className="gd-perto-texto">
        <strong>Quer ver os salões mais perto de você?</strong>
        <p>
          Com a sua localização, a lista fica do mais perto para o mais longe, com a distância em cada um.
          A MIMO guarda o ponto onde você estava, no mapa de acessos do guia, para saber de onde as pessoas procuram salão.
          Sem nome, sem cadastro. <Link to="/privacidade">Saiba mais</Link>
        </p>
        {situacao === 'negado' && <p className="gd-perto-erro">A localização está bloqueada para a MIMO neste navegador. Libere nas configurações do site e tente de novo.</p>}
        <div className="gd-perto-botoes">
          <button type="button" className="ld-btn ld-primario" onClick={pedirPosicao} disabled={pedindo}>
            {pedindo ? <><LoaderCircle size={16} className="gd-perto-gira" aria-hidden="true" /> Achando você…</> : <><LocateFixed size={16} aria-hidden="true" /> Ativar localização</>}
          </button>
          <button type="button" className="ld-btn ld-fantasma" onClick={() => { dispensar(); setFechado(true) }}>Agora não</button>
        </div>
      </div>
    </div>
  )
}
