import { useState } from 'react'
import { supabase } from '../lib/supabase'
import Avatar from './Avatar'

const MAX_MB = 5
const BUCKET = 'professional-photos'

// Escolhe, envia e remove a foto de uma profissional.
// Devolve a URL pública (ou null) pelo onChange.
export default function FotoUpload({ nome, valor, onChange, onErro }) {
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
      const path = `${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type })
      if (error) {
        onErro?.('Erro ao enviar a foto: ' + error.message)
        return
      }
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
      const anterior = valor
      onChange(data.publicUrl)
      onErro?.('')
      await removerDoStorage(anterior)
    } finally {
      setEnviando(false)
    }
  }

  async function remover() {
    const anterior = valor
    onChange(null)
    await removerDoStorage(anterior)
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
async function removerDoStorage(url) {
  if (!url) return
  const path = url.split(`/${BUCKET}/`)[1]
  if (path) await supabase.storage.from(BUCKET).remove([path])
}
