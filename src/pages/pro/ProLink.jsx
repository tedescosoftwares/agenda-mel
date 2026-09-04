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
  const [vitrine, setVitrine] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)

  const url = professional ? `${window.location.origin}/p/${professional.slug}` : ''

  useEffect(() => {
    if (!mostrarQr || !canvas.current || !url) return
    QRCode.toCanvas(canvas.current, url, { width: 220, margin: 1, color: { dark: '#1f2026', light: '#ffffff' } }).catch(() => {})
  }, [mostrarQr, url])

  if (!professional) return <SemFicha />

  // o que a vitrine mostra e só ela preenche: uma linha embaixo do nome,
  // o @ do Instagram, o WhatsApp que ela ESCOLHE mostrar, e a bio
  const form = vitrine ?? {
    especialidade: professional.especialidade ?? '',
    instagram: professional.instagram ?? '',
    whatsapp_publico: professional.whatsapp_publico ?? '',
    bio: professional.bio ?? '',
  }
  const mudar = (campo) => (e) => { setSalvo(false); setVitrine({ ...form, [campo]: e.target.value }) }
  async function salvarVitrine() {
    setSalvando(true)
    const { error } = await supabase.from('professionals').update({
      especialidade: form.especialidade.trim() || null,
      instagram: form.instagram.trim().replace(/^@/, '') || null,
      whatsapp_publico: form.whatsapp_publico.trim() || null,
      bio: form.bio.trim() || null,
    }).eq('id', professional.id)
    setSalvando(false)
    if (error) setErro(error.message); else { setErro(''); setSalvo(true); recarregarProfessional?.() }
  }

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

      <h3 className="secao-titulo">Sua vitrine</h3>
      <div className="card form vit-form">
        <label>Uma linha embaixo do seu nome<input value={form.especialidade} onChange={mudar('especialidade')} placeholder="Nail designer · gel e decoradas" maxLength={60} /></label>
        <label>Instagram<input value={form.instagram} onChange={mudar('instagram')} placeholder="@seu.perfil" autoCapitalize="none" /></label>
        <label>WhatsApp para a cliente falar com você<input type="tel" value={form.whatsapp_publico} onChange={mudar('whatsapp_publico')} placeholder="(13) 99999-9999 — vazio = não mostra" /></label>
        <label>Sobre você<textarea value={form.bio} onChange={mudar('bio')} rows={4} placeholder="Como você atende, há quanto tempo, o que a cliente pode esperar." /></label>
        <button className="btn btn-primary btn-block" onClick={salvarVitrine} disabled={salvando || !vitrine}>{salvando ? 'Salvando…' : salvo ? 'Salvo ✓' : 'Salvar vitrine'}</button>
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
