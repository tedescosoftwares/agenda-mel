import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, LocateFixed, LoaderCircle, Route, ShieldCheck, X } from 'lucide-react'
import Portal from '../Portal'
import { useMinhaPosicao, pedirPosicao, dispensar, dispensado, fecharNaVisita } from '../../lib/guiaPerto'
import '../../guia-perto.css'

// "Perto de você" (3.13) nas listas do guia. Ao entrar na página pela
// primeira vez, um modal explica o que a localização faz pela pessoa (a
// lista do mais perto para o mais longe, a distância em cada salão) e, com
// todas as letras, que o ponto fica guardado. O navegador só pergunta quando
// ela toca em "Ativar localização". "Agora não" guarda por 30 dias; fechar
// sem escolher vale só nesta visita. Quem fechou tem um botão discreto na
// lista para abrir de novo; quem já autorizou antes nem vê o modal (a
// posição chega sozinha) e só vê a linha "do mais perto para o mais longe".

let abriuSozinho = false // uma vez por visita, mesmo andando entre as páginas do guia

export default function PertoDeVoce({ ordenado, onOrdenar, cidade, bairros }) {
  const { posicao, situacao, permissao, fechadoNaVisita } = useMinhaPosicao()
  const [aberto, setAberto] = useState(false)
  const chip = useRef(null)

  // abre sozinho ao entrar, depois que a página assentou e se o navegador ainda vai perguntar
  useEffect(() => {
    if (abriuSozinho || posicao || permissao !== 'prompt' || fechadoNaVisita || dispensado()) return
    abriuSozinho = true
    const t = setTimeout(() => setAberto(true), 900)
    return () => clearTimeout(t)
  }, [posicao, permissao, fechadoNaVisita])
  // (a posição chegou, pelo modal ou sozinha: o ramo de cima nem desenha o modal)

  const fechar = (comoNao) => {
    if (comoNao) dispensar(); else fecharNaVisita()
    setAberto(false)
    requestAnimationFrame(() => chip.current?.focus())
  }

  if (posicao) {
    return (
      <div className="gd-perto-ok" role="status">
        <LocateFixed size={18} aria-hidden="true" />
        <span>{ordenado ? 'Do mais perto para o mais longe, a partir de onde você está.' : 'Sua localização está ativa: cada salão mostra a distância.'}</span>
        <button type="button" className="gd-perto-link" onClick={() => onOrdenar(!ordenado)}>{ordenado ? 'Ordem normal' : 'Ordenar por distância'}</button>
      </div>
    )
  }
  if (situacao === 'indisponivel' && permissao === 'denied' && !aberto) return null
  return (
    <>
      <div className="gd-perto-linha">
        <button ref={chip} type="button" className="gd-perto-chip" onClick={() => setAberto(true)}>
          <MapPin size={15} aria-hidden="true" /> Ver os mais perto de mim
        </button>
      </div>
      {aberto && <ModalPerto cidade={cidade} bairros={bairros} situacao={situacao} onFechar={fechar} />}
    </>
  )
}

function ModalPerto({ cidade, bairros, situacao, onFechar }) {
  const botao = useRef(null)
  const pedindo = situacao === 'pedindo'
  useEffect(() => {
    const antes = document.activeElement
    botao.current?.focus()
    const rolagem = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const tecla = (e) => { if (e.key === 'Escape') { e.preventDefault(); onFechar(false) } }
    window.addEventListener('keydown', tecla)
    return () => { window.removeEventListener('keydown', tecla); document.body.style.overflow = rolagem; antes?.focus?.() }
  }, [onFechar])
  const onde = cidade ? `${cidade} é grande` : 'A cidade é grande'
  const quantos = bairros > 1 ? `salão em ${bairros} bairros` : 'salão em vários bairros'

  return (
    <Portal>
      <div className="gd-perto-fundo" onClick={() => onFechar(false)} role="presentation">
        <div className="gd-perto-modal" role="dialog" aria-modal="true" aria-labelledby="gd-perto-t" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="gd-perto-x" onClick={() => onFechar(false)} aria-label="Fechar"><X size={18} /></button>
          <span className="gd-perto-icone" aria-hidden="true"><MapPin size={26} /></span>
          <h2 id="gd-perto-t">Quer ver os salões mais perto de você?</h2>
          <p className="gd-perto-lead">{onde} e o guia tem {quantos}. Com a sua localização, a lista fica do mais perto para o mais longe, e cada salão mostra a distância até você.</p>
          <ul className="gd-perto-beneficios">
            <li><LocateFixed size={18} aria-hidden="true" /><span><b>Os mais perto primeiro</b><small>A ordem muda na hora, aqui e nas páginas de bairro e de horário.</small></span></li>
            <li><Route size={18} aria-hidden="true" /><span><b>A distância em cada salão</b><small>Para escolher sem abrir o mapa: 350 m, 1,2 km, 4 km.</small></span></li>
            <li><ShieldCheck size={18} aria-hidden="true" /><span><b>Só quando você quiser</b><small>O navegador pergunta agora, e você desfaz quando quiser, nas configurações dele.</small></span></li>
          </ul>
          <p className="gd-perto-transp">
            Além de ordenar a lista, a MIMO guarda o ponto de onde você procurou, sem nome e sem cadastro, para saber de quais bairros as pessoas buscam salão e levar o guia para onde falta. <Link to="/privacidade">Saiba mais</Link>
          </p>
          {situacao === 'negado' && (
            <p className="gd-perto-erro">O navegador está bloqueando a localização para a MIMO. Para liberar, toque no cadeado ao lado do endereço, permita a localização e toque de novo em Ativar.</p>
          )}
          <div className="gd-perto-botoes">
            <button ref={botao} type="button" className="ld-btn ld-primario ld-grande" onClick={pedirPosicao} disabled={pedindo}>
              {pedindo ? <><LoaderCircle size={17} className="gd-perto-gira" aria-hidden="true" /> Achando você…</> : <><LocateFixed size={17} aria-hidden="true" /> Ativar localização</>}
            </button>
            <button type="button" className="ld-btn ld-fantasma ld-grande" onClick={() => onFechar(true)}>Agora não</button>
          </div>
        </div>
      </div>
    </Portal>
  )
}
