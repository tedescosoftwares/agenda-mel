import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Lock, AtSign, MessageCircle, QrCode } from 'lucide-react'
import { MarcaIcon } from './icons'
import { DOMINIO_RAIZ } from '../lib/ambiente'
import '../arte-link.css'

// 3.85: a arte do link no cadastro (passo 3). Mostra, com o link que ela está escolhendo, onde ele vai aparecer:
// a barra do navegador, a bio do Instagram, a conversa no WhatsApp e o QR Code do balcão (um QR de verdade,
// que abre o endereço). Tudo muda enquanto ela digita, para dar vontade de escolher um nome bom.
//   endereco   o subdomínio (sem o .mimo.com.vc)
//   nome       o nome do salão
//   logo       a url do logo, se já subiu
export default function ArteDoLink({ endereco, nome, logo }) {
  const sub = endereco || 'seusalao'
  const url = `${sub}.${DOMINIO_RAIZ}`
  const [qr, setQr] = useState('')
  useEffect(() => {
    let vivo = true
    const t = setTimeout(() => {
      QRCode.toDataURL(`https://${url}`, { width: 220, margin: 1, color: { dark: '#65142f', light: '#ffffff' } })
        .then((d) => { if (vivo) setQr(d) }).catch(() => {})
    }, 300)
    return () => { vivo = false; clearTimeout(t) }
  }, [url])
  const iniciais = (nome || 'Seu salão').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="la" aria-hidden="true">
      <span className="la-brilho la-brilho-1" /><span className="la-brilho la-brilho-2" />
      <MarcaIcon className="la-coracao" width={54} height={54} />
      <div className="la-barra">
        <Lock size={13} />
        <span className="la-url"><b>{sub}</b>.{DOMINIO_RAIZ}</span>
      </div>
      <div className="la-cenas">
        <div className="la-cena la-insta">
          <span className="la-cena-rotulo"><AtSign size={12} /> Na bio</span>
          <div className="la-insta-perfil">
            <span className="la-ava">{logo ? <img src={logo} alt="" /> : iniciais}</span>
            <span className="la-insta-texto">
              <b>{nome || 'Seu salão'}</b>
              <small>Agende online ✨</small>
              <em>{url}</em>
            </span>
          </div>
        </div>
        <div className="la-cena la-whats">
          <span className="la-cena-rotulo"><MessageCircle size={12} /> No WhatsApp</span>
          <span className="la-balao">Oi! Marca seu horário por aqui 💕<em>{url}</em></span>
        </div>
        <div className="la-cena la-qr">
          <span className="la-cena-rotulo"><QrCode size={12} /> No balcão</span>
          <span className="la-placa">{qr ? <img src={qr} alt="" /> : <i />}<small>aponte a câmera</small></span>
        </div>
      </div>
    </div>
  )
}
