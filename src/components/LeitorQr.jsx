import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

// Lê um QR com a câmera de trás, dentro do app (funciona no PWA do
// iPhone e no Android). Chama onLido(texto) uma vez e para. Quem usa
// decide o que fazer com o texto — aqui não se interpreta nada.
export default function LeitorQr({ onLido, onErro }) {
  const video = useRef(null)
  const canvas = useRef(null)
  const [pronto, setPronto] = useState(false)

  useEffect(() => {
    let stream = null
    let vivo = true
    let quadro = 0

    async function ligar() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
      } catch (e) {
        onErro?.(e?.name === 'NotAllowedError'
          ? 'Sem permissão para a câmera. Libere nos ajustes do navegador, ou digite o código.'
          : 'Não consegui abrir a câmera. Digite o código.')
        return
      }
      if (!vivo) { stream.getTracks().forEach((t) => t.stop()); return }
      const v = video.current
      v.srcObject = stream
      v.setAttribute('playsinline', 'true')
      await v.play().catch(() => {})
      setPronto(true)

      const ctx = canvas.current.getContext('2d', { willReadFrequently: true })
      const ler = () => {
        if (!vivo) return
        if (v.readyState === v.HAVE_ENOUGH_DATA) {
          // lê um quadro a cada dois: economiza bateria e ninguém percebe
          if (quadro++ % 2 === 0) {
            const w = Math.min(v.videoWidth, 640)
            const h = Math.round(v.videoHeight * (w / v.videoWidth))
            canvas.current.width = w; canvas.current.height = h
            ctx.drawImage(v, 0, 0, w, h)
            const img = ctx.getImageData(0, 0, w, h)
            const r = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })
            if (r?.data) { vivo = false; onLido(r.data); return }
          }
        }
        requestAnimationFrame(ler)
      }
      requestAnimationFrame(ler)
    }

    ligar()
    return () => {
      vivo = false
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onLido, onErro])

  return (
    <div className="leitor-qr">
      <video ref={video} muted playsInline />
      <canvas ref={canvas} hidden />
      <div className="leitor-mira" aria-hidden="true" />
      <p className="leitor-dica">{pronto ? 'Aponte para o QR da profissional' : 'Abrindo a câmera…'}</p>
    </div>
  )
}
