import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Portal from '../Portal'

// 4.1: o passo a passo da Agenda: escurece a tela, acende uma parte de cada vez (as abas, um horário, o vazio, os
// pedidos, a legenda) e explica num cartão ao lado. Abre sozinho na primeira visita e pelo botão "Como usar".
// Passo cujo alvo não está na tela (sem pedidos, sem horários) é pulado.
export default function ComoUsarAgenda({ passos, onFechar }) {
  const validos = useMemo(() => passos.filter((p) => !p.alvo || document.querySelector(p.alvo)), [passos])
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const [tam, setTam] = useState({ w: 340, h: 200 })
  const cartao = useRef(null)
  const passo = validos[i]

  // acende o alvo do passo (rola até ele) e acompanha se a tela mudar de tamanho
  useLayoutEffect(() => {
    if (!passo) return
    const el = passo.alvo ? document.querySelector(passo.alvo) : null
    if (el) {
      const r0 = el.getBoundingClientRect()
      if (r0.top < 80 || r0.bottom > window.innerHeight - 40) el.scrollIntoView({ block: 'center' })
    }
    const medir = () => { const r = el?.getBoundingClientRect(); setRect(r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null) }
    medir()
    window.addEventListener('resize', medir); window.addEventListener('scroll', medir, true)
    return () => { window.removeEventListener('resize', medir); window.removeEventListener('scroll', medir, true) }
  }, [passo])
  useLayoutEffect(() => { const c = cartao.current; if (c) setTam({ w: c.offsetWidth, h: c.offsetHeight }) }, [i, rect])
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape') onFechar(); if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, validos.length - 1)); if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1)) }
    window.addEventListener('keydown', tecla); return () => window.removeEventListener('keydown', tecla)
  }, [onFechar, validos.length])

  if (!passo) return null
  const ultimo = i === validos.length - 1
  const vw = window.innerWidth, vh = window.innerHeight, folga = 14
  // o cartão vai embaixo do alvo; sem espaço, em cima; alvo alto demais, ao lado; sem alvo, no meio
  let pos
  if (!rect) pos = { left: (vw - tam.w) / 2, top: (vh - tam.h) / 2 }
  else {
    const centroX = Math.min(Math.max(12, rect.x + rect.w / 2 - tam.w / 2), vw - tam.w - 12)
    if (rect.y + rect.h + folga + tam.h < vh - 8) pos = { left: centroX, top: rect.y + rect.h + folga }
    else if (rect.y - folga - tam.h > 8) pos = { left: centroX, top: rect.y - folga - tam.h }
    else if (rect.x + rect.w + folga + tam.w < vw - 8) pos = { left: rect.x + rect.w + folga, top: Math.min(Math.max(12, rect.y + 20), vh - tam.h - 12) }
    else if (rect.x - folga - tam.w > 8) pos = { left: rect.x - folga - tam.w, top: Math.min(Math.max(12, rect.y + 20), vh - tam.h - 12) }
    else pos = { left: (vw - tam.w) / 2, top: vh - tam.h - 16 }
  }
  return (
    <Portal>
      <div className="ags-tour" role="dialog" aria-modal="true" aria-labelledby="ags-tour-t">
        {rect ? <div className="ags-tour-foco" style={{ left: rect.x - 6, top: rect.y - 6, width: rect.w + 12, height: rect.h + 12 }} /> : <div className="ags-tour-escuro" />}
        <div className="ags-tour-cartao" ref={cartao} style={pos}>
          <small className="ags-tour-n">{i + 1} de {validos.length}</small>
          <b id="ags-tour-t">{passo.titulo}</b>
          <p>{passo.texto}</p>
          <div className="ags-tour-botoes">
            <button type="button" className="ags-tour-pular" onClick={onFechar}>{ultimo ? '' : 'Pular'}</button>
            <span>
              {i > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setI(i - 1)}>Voltar</button>}
              <button type="button" className="btn btn-primary btn-sm" onClick={() => (ultimo ? onFechar() : setI(i + 1))} autoFocus>{ultimo ? 'Entendi' : 'Próximo'}</button>
            </span>
          </div>
          <span className="ags-tour-pontos" aria-hidden="true">{validos.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</span>
        </div>
      </div>
    </Portal>
  )
}
