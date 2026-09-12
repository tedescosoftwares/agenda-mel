import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { useNotificacoes } from '../context/NotificacoesContext'
import { useAuth } from '../context/AuthContext'
import { ICONE_AVISO, destinoDoAviso } from '../lib/avisos'

// Chegou um aviso com o app aberto: desce um cartão do topo, como a
// notificação do celular. Toque leva à tela certa e marca lido; some
// sozinho em 8 s. Fora das telas logadas não aparece.
export default function AvisoAoVivo() {
  const { novo, dispensarNovo, marcarLido } = useNotificacoes()
  const { role } = useAuth()
  const navigate = useNavigate()
  const [visivel, setVisivel] = useState(false)

  useEffect(() => {
    if (!novo) { setVisivel(false); return }
    setVisivel(true)
    const t = setTimeout(() => { setVisivel(false); setTimeout(dispensarNovo, 300) }, 8000)
    return () => clearTimeout(t)
  }, [novo, dispensarNovo])

  if (!novo || !role || role === 'plataforma') return null
  const Icone = ICONE_AVISO[novo.kind] ?? ICONE_AVISO.teste

  function abrir() {
    marcarLido(novo.id)
    setVisivel(false)
    navigate(destinoDoAviso(novo, role))
    setTimeout(dispensarNovo, 300)
  }
  function fechar(e) { e.stopPropagation(); setVisivel(false); setTimeout(dispensarNovo, 300) }

  return (
    <div className={'aviso-vivo' + (visivel ? ' aberto' : '')} role="status" onClick={abrir}>
      <span className="aviso-vivo-icone"><Icone size={20} /></span>
      <span className="aviso-vivo-texto">
        <strong>{novo.title}</strong>
        {novo.body && <span>{novo.body}</span>}
      </span>
      <button type="button" className="aviso-vivo-fechar" onClick={fechar} aria-label="Fechar"><X size={16} /></button>
    </div>
  )
}
