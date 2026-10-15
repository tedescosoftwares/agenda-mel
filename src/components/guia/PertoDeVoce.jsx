import { useEffect, useRef, useState } from 'react'
import { MapPin, LocateFixed, LoaderCircle, X } from 'lucide-react'
import Portal from '../Portal'
import { useMinhaPosicao, pedirPosicao, dispensar, dispensado, fecharNaVisita } from '../../lib/guiaPerto'
import '../../guia-perto.css'

// "Perto de você" (3.13) nas listas do guia. Ao entrar na página pela
// primeira vez, um modal curto e gentil pede a localização: é para indicar
// os salões mais perto, com mais precisão (o que é feito com o ponto está
// na política de privacidade, como o aviso de cookies aponta). O navegador
// só pergunta quando ela toca em "Sim, pode" (no celular, o modal espera o
// primeiro gesto da pessoa). "Agora não" guarda por 30 dias;
// fechar sem escolher vale só nesta visita. Quem fechou tem um botão
// discreto na lista para abrir de novo; quem já autorizou antes nem vê o
// modal (a posição chega sozinha) e só vê a linha "do mais perto para o
// mais longe".

let abriuSozinho = false // uma vez por visita, mesmo andando entre as páginas do guia

export default function PertoDeVoce({ ordenado, onOrdenar }) {
  const { posicao, situacao, permissao, fechadoNaVisita } = useMinhaPosicao()
  const [aberto, setAberto] = useState(false)
  const chip = useRef(null)

  // abre sozinho ao entrar, depois que a página assentou e se o navegador ainda vai perguntar.
  // No celular, só depois do primeiro gesto (rolar ou tocar): nada de cobrir a página na
  // chegada, que é o que o Google penaliza em "interstitial" no celular (3.14).
  useEffect(() => {
    if (abriuSozinho || posicao || permissao !== 'prompt' || fechadoNaVisita || dispensado()) return
    const abrir = () => { abriuSozinho = true; setAberto(true) }
    const celular = typeof matchMedia === 'function' && matchMedia('(max-width: 600px), (pointer: coarse)').matches
    let t
    if (!celular) { t = setTimeout(abrir, 900); return () => clearTimeout(t) }
    // só a rolagem conta (um toque no aviso de cookies não é "quero ver a lista"); e só depois que a página assentou
    const desde = Date.now()
    const gesto = () => { if (Date.now() - desde < 600) return; tirar(); t = setTimeout(abrir, 400) }
    const tirar = () => window.removeEventListener('scroll', gesto)
    window.addEventListener('scroll', gesto, { passive: true })
    return () => { tirar(); clearTimeout(t) }
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
      {aberto && <ModalPerto situacao={situacao} onFechar={fechar} />}
    </>
  )
}

function ModalPerto({ situacao, onFechar }) {
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

  return (
    <Portal>
      <div className="gd-perto-fundo" onClick={() => onFechar(false)} role="presentation">
        <div className="gd-perto-modal" role="dialog" aria-modal="true" aria-labelledby="gd-perto-t" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="gd-perto-x" onClick={() => onFechar(false)} aria-label="Fechar"><X size={18} /></button>
          <span className="gd-perto-icone" aria-hidden="true"><MapPin size={26} /></span>
          <h2 id="gd-perto-t">Pode liberar sua localização?</h2>
          <p className="gd-perto-lead">Assim a gente indica os salões mais perto de você, com mais precisão. Leva um segundo, e você muda quando quiser.</p>
          {situacao === 'negado' && (
            <p className="gd-perto-erro">O navegador está bloqueando a localização para a MIMO. Toque no cadeado ao lado do endereço, permita a localização e tente de novo.</p>
          )}
          <div className="gd-perto-botoes">
            <button ref={botao} type="button" className="ld-btn ld-primario ld-grande" onClick={pedirPosicao} disabled={pedindo}>
              {pedindo ? <><LoaderCircle size={17} className="gd-perto-gira" aria-hidden="true" /> Achando você…</> : <><LocateFixed size={17} aria-hidden="true" /> Sim, pode</>}
            </button>
            <button type="button" className="ld-btn ld-fantasma ld-grande" onClick={() => onFechar(true)}>Agora não</button>
          </div>
        </div>
      </div>
    </Portal>
  )
}
