import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// O switch "Avisos por e-mail": confirmação, lembrete, remarcação e
// cancelamento chegam também no e-mail (058). Boas-vindas vai sempre.
export default function AvisosPorEmail() {
  const { profile, user, recarregarPerfil } = useAuth()
  const [erro, setErro] = useState('')
  const ligado = profile?.aceita_email !== false

  async function trocar() {
    setErro('')
    const { error } = await supabase.from('profiles').update({ aceita_email: !ligado }).eq('id', profile.id)
    if (error) setErro(error.message)
    else recarregarPerfil?.()
  }

  return (
    <>
      <div className="card cl-ajuste avisos-celular">
        <div className="cliente-info">
          <span className="cliente-nome"><span className="nome-txt">Avisos por e-mail</span></span>
          <span className="muted cliente-meta">{ligado ? (user?.email ? 'Confirmações e lembretes vão para ' + user.email : 'Confirmações e lembretes também no seu e-mail') : 'Só o app e o WhatsApp avisam'}</span>
        </div>
        <button className={'switch' + (ligado ? ' on' : '')} onClick={trocar} role="switch" aria-checked={ligado} aria-label="Avisos por e-mail" disabled={!profile} />
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}
    </>
  )
}
