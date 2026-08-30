import { useState } from 'react'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import FotoUpload from '../../components/FotoUpload'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

export default function ProLink() {
  const { professional, recarregarProfessional } = useAuth()
  const [copiado, setCopiado] = useState(false)
  const [erroFoto, setErroFoto] = useState('')

  if (!professional) return <SemFicha />

  async function salvarFoto(url) {
    const { error } = await supabase
      .from('professionals')
      .update({ photo_url: url })
      .eq('id', professional.id)
    if (error) {
      setErroFoto('Erro ao salvar a foto: ' + error.message)
      return
    }
    setErroFoto('')
    await recarregarProfessional()
  }

  const url = `${window.location.origin}/p/${professional.slug}`
  const mensagem = `Oi! Você pode agendar comigo por aqui: ${url}`

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch {
      setCopiado(false)
    }
  }

  return (
    <ProShell>
      <div className="page-head">
        <div>
          <h2>Meu link</h2>
          <p className="muted">Mande para as clientes agendarem com você</p>
        </div>
      </div>

      <div className="card foto-card">
        <h3>Sua foto</h3>
        <p className="muted">É ela que aparece no seu link para as clientes.</p>
        {erroFoto && <div className="alert alert-error">{erroFoto}</div>}
        <FotoUpload
          nome={professional.name}
          pasta={professional.id}
          valor={professional.photo_url}
          onChange={salvarFoto}
          onErro={setErroFoto}
        />
      </div>

      <div className="card link-card">
        <span className="muted">Seu endereço</span>
        <code className="link-url">{url}</code>

        <div className="link-acoes">
          <button className="btn btn-primary" onClick={copiar}>
            {copiado ? 'Copiado' : 'Copiar link'}
          </button>
          <a
            className="btn btn-whats"
            href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`}
            target="_blank"
            rel="noreferrer"
          >
            Enviar no WhatsApp
          </a>
        </div>

        <a className="voltar-link" href={url} target="_blank" rel="noreferrer">
          Ver como as clientes veem →
        </a>
      </div>

      <div className="card link-dica">
        <h3>Dicas</h3>
        <p className="muted">
          Coloque esse link na bio do Instagram e no seu status do WhatsApp. A
          cliente escolhe o serviço, o dia e o horário sozinha — você só confirma
          na aba Agenda.
        </p>
      </div>
    </ProShell>
  )
}
