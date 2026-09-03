import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import FotoUpload from '../../components/FotoUpload'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { CopiarIcon, CompartilharIcon } from '../../components/icons'

// Meu link público (tela 20): a prévia de como a cliente vê, o link,
// copiar, compartilhar, e o QR para imprimir e colar no espelho.
export default function ProLink() {
  const { professional, recarregarProfessional } = useAuth()
  const [copiado, setCopiado] = useState(false)
  const [erro, setErro] = useState('')
  const [mostrarQr, setMostrarQr] = useState(false)
  const canvas = useRef(null)

  const url = professional ? `${window.location.origin}/p/${professional.slug}` : ''

  useEffect(() => {
    if (!mostrarQr || !canvas.current || !url) return
    QRCode.toCanvas(canvas.current, url, { width: 220, margin: 1, color: { dark: '#1f2026', light: '#ffffff' } }).catch(() => {})
  }, [mostrarQr, url])

  if (!professional) return <SemFicha />

  async function salvarFoto(foto) {
    const { error } = await supabase.from('professionals').update({ photo_url: foto }).eq('id', professional.id)
    if (error) setErro(error.message); else { setErro(''); recarregarProfessional?.() }
  }
  const msg = `Oi! Você pode agendar comigo por aqui: ${url}`
  function copiar() { navigator.clipboard?.writeText(url); setCopiado(true); setTimeout(() => setCopiado(false), 2000) }
  function compartilhar() {
    if (navigator.share) navigator.share({ text: msg, url }).catch(() => {})
    else window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }
  function baixarQr() {
    const a = document.createElement('a'); a.download = `qr-${professional.slug}.png`; a.href = canvas.current.toDataURL('image/png'); a.click()
  }

  return (
    <ProShell titulo="Meu link público" voltar="/pro/ajustes">
      {erro && <div className="alert alert-error">{erro}</div>}

      <div className="card link-previa">
        <FotoUpload nome={professional.name} pasta={professional.id} valor={professional.photo_url} onChange={salvarFoto} onErro={setErro} />
        <strong>{professional.name}</strong>
        {professional.bio && <span className="muted">{professional.bio}</span>}
        <a className="link-url" href={url} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\//, '')}</a>
      </div>

      <div className="link-acoes-2">
        <button className="btn btn-ghost" onClick={copiar}><CopiarIcon /> {copiado ? 'Copiado!' : 'Copiar link'}</button>
        <button className="btn btn-primary" onClick={compartilhar}><CompartilharIcon /> Compartilhar</button>
      </div>

      <div className="card qr-card">
        <div className="cl-ajuste">
          <div className="cliente-info">
            <span className="cliente-nome"><span className="nome-txt">QR Code</span></span>
            <span className="muted cliente-meta">Imprima e cole no espelho ou no balcão</span>
          </div>
          <button className="btn-mini" onClick={() => setMostrarQr((v) => !v)}>{mostrarQr ? 'Esconder' : 'Ver QR'}</button>
        </div>
        {mostrarQr && (
          <div className="qr-area">
            <canvas ref={canvas} />
            <button className="btn-mini" onClick={baixarQr}>Baixar QR Code</button>
          </div>
        )}
      </div>

      <p className="muted" style={{ fontSize: '0.82rem' }}>Coloque o link na bio do Instagram e no status do WhatsApp. A cliente escolhe serviço, dia e hora sozinha — você só confirma.</p>
    </ProShell>
  )
}
