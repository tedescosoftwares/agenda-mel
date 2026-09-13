import { useEffect, useState } from 'react'
import { capaPadrao } from '../lib/categorias'
import { ChevronRight } from 'lucide-react'

// O cartão de uma categoria (088): uma vitrine de imagens (até 10, que
// rodam sozinhas) com o nome por cima. O toque abre a página da
// categoria, com os serviços. `imagens` é a lista do salão ou a padrão;
// sem nada, um gradiente da marca.
export default function CategoriaCard({ nome, imagens, quantos, onAbrir, compacto = false }) {
  const lista = imagens?.length ? imagens : [capaPadrao(nome)]
  const [i, setI] = useState(0)
  useEffect(() => {
    if (lista.length < 2) return
    const t = setInterval(() => setI((x) => (x + 1) % lista.length), 4000 + Math.floor(Math.random() * 1500))
    return () => clearInterval(t)
  }, [lista.length])
  return (
    <button type="button" className={'cat-card' + (compacto ? ' compacto' : '')} onClick={onAbrir} aria-label={`${nome}: ver serviços`}>
      <span className="cat-card-capa">
        {lista.map((src, k) => <img key={src} src={src} alt="" loading={k === 0 ? 'eager' : 'lazy'} className={k === i ? 'on' : ''} />)}
        <span className="cat-card-veu">
          <strong>{nome}</strong>
          <span>{quantos != null ? `${quantos} ${quantos === 1 ? 'serviço' : 'serviços'}` : ''}<ChevronRight size={16} /></span>
        </span>
        {lista.length > 1 && <span className="cat-card-pontos">{lista.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</span>}
      </span>
    </button>
  )
}
