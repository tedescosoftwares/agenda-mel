import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { CopiarIcon, CompartilharIcon } from './icons'
import { linkDoCodigo } from '../lib/convite'

// O código de entrada, do jeito que a profissional (ou o salão) mostra
// para a cliente: o QR grande, as seis letras embaixo para quem prefere
// digitar, e os botões de copiar/compartilhar o link. `onNovo` troca o
// código (o antigo morre na hora).
export default function CodigoQr({ codigo, nome, onNovo, mensagem }) {
  const canvas = useRef(null)
  const [copiado, setCopiado] = useState(false)
  const url = codigo ? linkDoCodigo(codigo) : ''

  useEffect(() => {
    if (!canvas.current || !url) return
    QRCode.toCanvas(canvas.current, url, { width: 240, margin: 1, color: { dark: '#1f2026', light: '#ffffff' } }).catch(() => {})
  }, [url])

  const texto = mensagem ?? `Entra na minha agenda pelo MIMO: ${url}\nOu digita o código ${codigo} no app.`
  function copiar() { navigator.clipboard?.writeText(url); setCopiado(true); setTimeout(() => setCopiado(false), 2000) }
  function compartilhar() {
    if (navigator.share) navigator.share({ title: nome, text: texto, url }).catch(() => {})
    else window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank')
  }

  if (!codigo) return <p className="muted">Sem código ainda. Rode a atualização do banco (053).</p>

  return (
    <div className="codigo-qr">
      <canvas ref={canvas} />
      <div className="codigo-letras" aria-label={`código ${codigo.split('').join(' ')}`}>{codigo}</div>
      <p className="muted codigo-dica">A cliente escaneia no app dela, abre o link ou digita as seis letras.</p>
      <div className="link-acoes-2">
        <button className="btn btn-ghost" onClick={copiar}><CopiarIcon /> {copiado ? 'Copiado!' : 'Copiar link'}</button>
        <button className="btn btn-primary" onClick={compartilhar}><CompartilharIcon /> Compartilhar</button>
      </div>
      {onNovo && <button className="link-ver codigo-novo" onClick={onNovo}>Gerar um código novo (o antigo deixa de valer)</button>}
    </div>
  )
}
