import { Phone } from 'lucide-react'
import '../../pro-equipe.css'
import { useAuth } from '../../context/AuthContext'
import { useMeuSalao, linkWhatsApp } from '../../lib/meuSalao'
import Avatar from '../Avatar'
import { WhatsIcon } from '../icons'

// 3.90: no topo da agenda da profissional da equipe, o salão em que ela atende e o
// atalho para falar com a casa. É o canal direto: o recado do salão chega nos Avisos,
// a resposta dela vai pelo WhatsApp do salão.
export default function FaixaDoSalao({ grande = false }) {
  const { professional } = useAuth()
  const salao = useMeuSalao()
  if (!salao) return <div className={grande ? 'pe-faixa pe-faixa-grande pe-faixa-vazia' : 'pe-faixa pe-faixa-vazia'} aria-hidden="true" />
  const primeiro = String(professional?.name ?? '').trim().split(/\s+/)[0]
  const whats = linkWhatsApp(salao.whatsapp, primeiro ? `Oi! Aqui é ${primeiro}, da equipe.` : null)
  const tel = String(salao.phone ?? '').replace(/\D/g, '')
  return (
    <div className={grande ? 'card pe-faixa pe-faixa-grande' : 'card pe-faixa'}>
      <Avatar nome={salao.name} foto={salao.logo_url} className="pe-faixa-logo" />
      <span className="pe-faixa-texto">
        <span className="pe-faixa-rotulo">Seu salão</span>
        <strong>{salao.name}</strong>
        {grande && (salao.bairro || salao.city) && <span className="pe-faixa-onde">{[salao.bairro, salao.city].filter(Boolean).join(' · ')}</span>}
      </span>
      {whats ? (
        <a className="pe-faixa-botao" href={whats} target="_blank" rel="noopener noreferrer" aria-label={`Falar com ${salao.name} no WhatsApp`}>
          <WhatsIcon width={17} height={17} /> <span>{grande ? 'WhatsApp do salão' : 'Falar'}</span>
        </a>
      ) : tel.length >= 10 ? (
        <a className="pe-faixa-botao" href={`tel:+55${tel.replace(/^55(?=\d{10,11}$)/, '')}`} aria-label={`Ligar para ${salao.name}`}>
          <Phone size={16} /> <span>Ligar</span>
        </a>
      ) : null}
    </div>
  )
}
