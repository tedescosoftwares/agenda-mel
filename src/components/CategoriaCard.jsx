import { useEffect, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'

// O cartão de uma categoria, uma por linha, estilo capa de revista: a foto
// de ponta a ponta com zoom lento, um degradê suave no pé e só o nome,
// grande e limpo, com a contagem em versalete. Sem ícone, sem pastilha.
// Sem foto, um fundo "aurora" nos tons da categoria, com textura de grão
// e manchas de luz que derivam devagar. Os cartões entram escalonados e
// o toque responde. `indice` é a posição na lista (atraso e numeração).
export default function CategoriaCard({ nome, imagens, quantos, onAbrir, indice = 0, compacto = false }) {
  const lista = imagens?.length ? imagens : []
  const [i, setI] = useState(0)
  useEffect(() => {
    if (lista.length < 2) return
    const t = setInterval(() => setI((x) => (x + 1) % lista.length), 5000 + Math.floor(Math.random() * 1500))
    return () => clearInterval(t)
  }, [lista.length])
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
          : <span className="cat-card-aurora" />}
      </span>
      <span className="cat-card-num" aria-hidden="true">{String(indice + 1).padStart(2, '0')}</span>
      <span className="cat-card-rotulo">
        <strong>{nome}</strong>
        {conta && <span>{conta}</span>}
      </span>
      <span className="cat-card-ir" aria-hidden="true"><ArrowUpRight size={22} strokeWidth={1.8} /></span>
      {lista.length > 1 && <span className="cat-card-pontos" aria-hidden="true">{lista.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</span>}
    </button>
  )
}

// dois tons da marca por categoria, para o fundo sem foto
const PARES = [['#ff2d7a', '#aa4cff'], ['#aa4cff', '#ff7baa'], ['#ff7baa', '#ff9a6c'], ['#7c5cff', '#ff2d7a'], ['#ff5c8a', '#c86bff'], ['#f26b8a', '#8a5cff']]
function tomDe(nome) {
  let h = 0
  for (const ch of String(nome ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PARES[h % PARES.length]
}
