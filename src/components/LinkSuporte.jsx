import { useConfig } from '../lib/config'
import { useAuth } from '../context/AuthContext'
import { numeroWhats, linkWhats, chamada } from '../lib/contato'

// O WhatsApp da MIMO dentro do app: um link com a conversa já começada
// ("Sou Ana, do Studio Mel, e preciso de ajuda com..."). O número vem de
// config_publica.whatsapp_suporte (Plataforma > Configurações) ou da
// reserva em lib/contato.js.
export default function LinkSuporte({ chamada: nome = 'suporte', className, children, ...resto }) {
  const cfg = useConfig()
  const { profile, salao } = useAuth()
  const quem = profile?.full_name ? profile.full_name + (salao?.name ? `, do ${salao.name}` : '') : ''
  return <a href={linkWhats(numeroWhats(cfg), chamada(nome, quem, cfg).texto)} target="_blank" rel="noopener noreferrer" className={className} {...resto}>{children}</a>
}
