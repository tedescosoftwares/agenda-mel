import { LocateFixed, MapPin, LoaderCircle } from 'lucide-react'
import { useMinhaPosicao, pedirPosicao } from '../../lib/guiaPerto'
import '../../guia-perto.css'

// A barra da localização (3.49), em toda página do guia, logo abaixo do cabeçalho: de onde o site acha que a pessoa
// está e de onde veio esse dado. Com o GPS: "Você está em Peruíbe, SP · pelo GPS". Sem ele: "Perto de Peruíbe, SP ·
// pela sua conexão (aproximado)" e o botão "Usar minha localização" (um toque: aí até o Safari deixa o navegador
// perguntar). Quem vê a cidade errada entende, na hora, por que vale liberar a exata. Só aparece quando há o que dizer.
export default function BarraLocal() {
  const { origem, cidade, situacao } = useMinhaPosicao()
  const pedindo = situacao === 'pedindo'
  if (!origem && !pedindo && situacao !== 'negado') return null
  const gps = origem === 'gps'
  const nome = cidade ? `${cidade.cidade}${cidade.uf ? `, ${cidade.uf}` : ''}` : null
  return (
    <div className={'gd-local' + (gps ? ' gps' : '')} role="status" data-teste="barra-local" data-origem={origem ?? 'nenhuma'}>
      <div className="gd-wrap gd-local-in">
        {gps ? <LocateFixed size={16} aria-hidden="true" /> : <MapPin size={16} aria-hidden="true" />}
        <span className="gd-local-texto">
          {gps
            ? <>Você está em <b>{nome ?? 'um ponto exato'}</b> <small>pelo GPS</small></>
            : origem === 'ip'
              ? <>Perto de <b>{nome}</b> <small>pela sua conexão (aproximado)</small></>
              : pedindo ? <>Achando você…</> : <>Sem localização <small>o navegador está bloqueando</small></>}
        </span>
        {!gps && (
          <button type="button" className="gd-local-btn" onClick={() => pedirPosicao(true)} data-teste="barra-local-usar">
            {pedindo ? <><LoaderCircle size={14} className="gd-perto-gira" aria-hidden="true" /> Achando…</> : <><LocateFixed size={14} aria-hidden="true" /> {situacao === 'negado' ? 'Tentar de novo' : 'Usar minha localização'}</>}
          </button>
        )}
        {situacao === 'negado' && <small className="gd-local-dica">Toque no cadeado ao lado do endereço e permita a localização.</small>}
      </div>
    </div>
  )
}
