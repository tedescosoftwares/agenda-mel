import { useEffect, useState } from 'react'
import { ArrowRight, Scissors, Hand, Eye, Sparkles, Flower2, Feather, Palette, Smile, PersonStanding, Brush } from 'lucide-react'

// O cartão de uma categoria: largura inteira, uma por linha. Com foto do
// salão, a foto respira devagar (zoom lento) e o nome fica num vidro
// fosco no pé; sem foto, um fundo de tons suaves da categoria, com o
// ícone em marca d'água e o mesmo vidro. Os cartões entram escalonados,
// e o toque responde. `indice` é a posição na lista, para o atraso.
export default function CategoriaCard({ nome, imagens, quantos, onAbrir, indice = 0, compacto = false }) {
  const lista = imagens?.length ? imagens : []
  const [i, setI] = useState(0)
  useEffect(() => {
    if (lista.length < 2) return
    const t = setInterval(() => setI((x) => (x + 1) % lista.length), 5000 + Math.floor(Math.random() * 1500))
    return () => clearInterval(t)
  }, [lista.length])
  const Icone = iconeDe(nome)
  const [a, b] = tomDe(nome)
  const conta = quantos != null ? `${quantos} ${quantos === 1 ? 'serviço' : 'serviços'}` : ''
  return (
    <button
      type="button"
      className={'cat-card' + (compacto ? ' compacto' : '') + (lista.length ? ' com-foto' : ' sem-foto')}
      onClick={onAbrir}
      aria-label={`${nome}: ver serviços`}
      style={{ '--cat-a': a, '--cat-b': b, '--cat-atraso': `${Math.min(indice, 8) * 70}ms` }}
    >
      <span className="cat-card-fundo" aria-hidden="true">
        {lista.length
          ? lista.map((src, k) => <img key={src} src={src} alt="" loading={k === 0 ? 'eager' : 'lazy'} className={k === i ? 'on' : ''} />)
          : <span className="cat-card-marca"><Icone size={120} strokeWidth={1.1} /></span>}
      </span>
      <span className="cat-card-vidro">
        <span className="cat-card-icone"><Icone size={18} strokeWidth={2} /></span>
        <span className="cat-card-texto">
          <strong>{nome}</strong>
          <span>{conta}</span>
        </span>
        <span className="cat-card-seta"><ArrowRight size={16} /></span>
      </span>
      {lista.length > 1 && <span className="cat-card-pontos" aria-hidden="true">{lista.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</span>}
    </button>
  )
}

// o ícone que combina com o nome da categoria (a plataforma e o salão nomeiam livremente)
function iconeDe(nome) {
  const n = String(nome ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/cabelo|corte|escova|barba/.test(n)) return Scissors
  if (/unha|manicure|pedicure|esmalt/.test(n)) return Hand
  if (/sobrancelha|cilio|lash|brow/.test(n)) return Eye
  if (/rosto|pele|facial|skin/.test(n)) return Smile
  if (/massagem|bem-estar|relax|spa/.test(n)) return Flower2
  if (/depila|laser|cera/.test(n)) return Feather
  if (/maquiagem|make/.test(n)) return Palette
  if (/corpo|corporal|bronze/.test(n)) return PersonStanding
  if (/noiva|festa|evento|penteado/.test(n)) return Brush
  return Sparkles
}

// dois tons da marca por categoria, para o fundo sem foto
const PARES = [['#ff2d7a', '#aa4cff'], ['#aa4cff', '#ff7baa'], ['#ff7baa', '#ff9a6c'], ['#7c5cff', '#ff2d7a'], ['#ff5c8a', '#c86bff'], ['#f26b8a', '#8a5cff']]
function tomDe(nome) {
  let h = 0
  for (const ch of String(nome ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PARES[h % PARES.length]
}
