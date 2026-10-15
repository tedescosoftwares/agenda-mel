import { useEffect, useRef, useState } from 'react'
import { Send, Copy, Check, X } from 'lucide-react'
import Portal from '../../../Portal'
import { SITE_GUIA } from '../../../../lib/guiaSeo'
import { mensagemParaDono, zapDoDono } from '../../../../lib/guiaMetricas'

// A mensagem para o dono do salão (3.11), com os números do período: dá
// para mudar o texto, copiar ou abrir direto no WhatsApp do salão.
// semFotos (3.16.1): a página está sem foto, e a mensagem pede as fotos.
export default function ModalDono({ linha, dias, cidade, semFotos = false, onFechar }) {
  // o endereço público de verdade (é ele que vai na mensagem)
  const url = SITE_GUIA + linha.pagina
  const [texto, setTexto] = useState(() => mensagemParaDono(linha, { dias, url, cidade, semFotos }))
  const [copiado, setCopiado] = useState(false)
  const zap = zapDoDono(linha, texto)
  const caixa = useRef(null)
  // o foco entra no texto ao abrir e volta para o botão de onde veio ao fechar
  useEffect(() => {
    const antes = document.activeElement
    caixa.current?.focus()
    return () => antes?.focus?.()
  }, [])
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onFechar])
  async function copiar() {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { /* sem área de transferência */ }
  }
  return (
    <Portal>
      <div className="modal-fundo plat-modal-fundo" onClick={onFechar} role="presentation">
        <div className="modal-caixa plat-modal pg-modal-dono" role="dialog" aria-modal="true" aria-labelledby="pg-dono-t" onClick={(e) => e.stopPropagation()}>
          <div className="pg-modal-topo">
            <h3 id="pg-dono-t">Mensagem para {linha.nome}</h3>
            <button type="button" onClick={onFechar} aria-label="Fechar"><X size={16} /></button>
          </div>
          <p className="muted">Os números dos últimos {dias} dias, prontos para mandar. {semFotos ? 'A página ainda não tem foto: o texto pede. ' : ''}Dá para mudar o texto antes.</p>
          <textarea ref={caixa} className="pg-dono-texto" rows={10} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Texto da mensagem" />
          <div className="pg-modal-botoes">
            <button type="button" className="btn btn-ghost" onClick={copiar}>{copiado ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar</>}</button>
            {zap
              ? <a className="btn btn-primary" href={zap} target="_blank" rel="noopener noreferrer"><Send size={15} /> Abrir no WhatsApp do salão</a>
              : <span className="muted">O salão não divulga WhatsApp: copie e mande por outro canal.</span>}
          </div>
        </div>
      </div>
    </Portal>
  )
}
