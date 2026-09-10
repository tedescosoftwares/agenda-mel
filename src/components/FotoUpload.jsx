import { useState } from 'react'
import { supabase } from '../lib/supabase'
import Avatar from './Avatar'

const MAX_MB = 5
const BUCKET = 'professional-photos'

// Escolhe, envia e remove a foto de uma profissional.
// Devolve a URL pública (ou null) pelo onChange.
export default function FotoUpload({ nome, valor, pasta, onChange, onErro, bucket = BUCKET, compacto = false }) {
  const [enviando, setEnviando] = useState(false)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      onErro?.('Escolha um arquivo de imagem.')
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      onErro?.(`Imagem muito grande (máx. ${MAX_MB} MB).`)
      return
    }

    setEnviando(true)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      // a pasta é o identificador da profissional: cada uma só mexe na sua
      const path = `${pasta || 'equipe'}/${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, file, { contentType: file.type })
      if (error) {
        onErro?.('Erro ao enviar a foto: ' + error.message)
        return
      }
      const { data } = supabase.storage.from(bucket).getPublicUrl(path)
      const anterior = valor
      onChange(data.publicUrl)
      onErro?.('')
      await removerDoStorage(anterior, bucket)
    } finally {
      setEnviando(false)
    }
  }

  async function remover() {
    const anterior = valor
    onChange(null)
    await removerDoStorage(anterior, bucket)
  }

  if (compacto) {
    // só o avatar com o botãozinho da câmera em cima (perfil da cliente)
    return (
      <label className="avatar-trocar" title={valor ? 'Trocar foto' : 'Colocar foto'}>
        <Avatar nome={nome} foto={valor} grande />
        <span className="avatar-trocar-badge" aria-hidden="true">{enviando ? '…' : '📷'}</span>
        <input type="file" accept="image/*" onChange={handleFile} hidden disabled={enviando} />
      </label>
    )
  }

  return (
    <div className="foto-upload">
      <Avatar nome={nome} foto={valor} grande />

      <div className="foto-upload-acoes">
        <label className="btn btn-small foto-btn">
          {enviando ? 'Enviando…' : valor ? 'Trocar foto' : 'Escolher foto'}
          <input type="file" accept="image/*" onChange={handleFile} hidden />
        </label>
        {valor && (
          <button type="button" className="btn btn-small btn-danger" onClick={remover}>
            Remover
          </button>
        )}
        <span className="muted campo-dica">
          Quadrada fica melhor · até {MAX_MB} MB
        </span>
      </div>
    </div>
  )
}

// Melhor esforço: apaga a imagem antiga do Storage
async function removerDoStorage(url, bucket = BUCKET) {
  if (!url) return
  const path = url.split(`/${bucket}/`)[1]
  if (path) await supabase.storage.from(bucket).remove([path])
}
