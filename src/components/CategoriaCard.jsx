import { useEffect, useState } from 'react'
import { ChevronRight, Scissors, Hand, Eye, Sparkles, Flower2, Feather, Palette, Smile, PersonStanding, Brush } from 'lucide-react'

// O cartão de uma categoria: metade da largura, com a foto que o salão
// subiu (até 10, que rodam sozinhas) e o nome por cima. Sem foto, nada de
// gradiente inventado: um cartão limpo, com um ícone da categoria numa
// bolinha e o nome em preto. O toque abre a página da categoria.
export default function CategoriaCard({ nome, imagens, quantos, onAbrir, compacto = false }) {
  const lista = imagens?.length ? imagens : []
  const [i, setI] = useState(0)
  useEffect(() => {
    if (lista.length < 2) return
    const t = setInterval(() => setI((x) => (x + 1) % lista.length), 4000 + Math.floor(Math.random() * 1500))
    return () => clearInterval(t)
  }, [lista.length])
  const Icone = iconeDe(nome)
  const tom = tomDe(nome)
  const conta = quantos != null ? `${quantos} ${quantos === 1 ? 'serviço' : 'serviços'}` : ''
  return (
    <button type="button" className={'cat-card' + (compacto ? ' compacto' : '') + (lista.length ? ' com-foto' : ' sem-foto')} onClick={onAbrir} aria-label={`${nome}: ver serviços`} style={lista.length ? undefined : { '--cat-tom': tom }}>
      {lista.length ? (
        <span className="cat-card-capa">
          {lista.map((src, k) => <img key={src} src={src} alt="" loading={k === 0 ? 'eager' : 'lazy'} className={k === i ? 'on' : ''} />)}
          <span className="cat-card-veu">
            <strong>{nome}</strong>
            <span>{conta}<ChevronRight size={15} /></span>
          </span>
          {lista.length > 1 && <span className="cat-card-pontos">{lista.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</span>}
        </span>
      ) : (
        <span className="cat-card-limpo">
          <span className="cat-card-icone"><Icone size={22} strokeWidth={1.8} /></span>
          <strong>{nome}</strong>
          <span className="cat-card-conta">{conta}<ChevronRight size={15} /></span>
        </span>
      )}
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

// um tom suave por categoria, para a bolinha do ícone (nada gritante)
const TONS = ['#ff2d7a', '#aa4cff', '#ff7baa', '#e0568a', '#7c5cff', '#f26b8a']
function tomDe(nome) {
  let h = 0
  for (const ch of String(nome ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TONS[h % TONS.length]
}
