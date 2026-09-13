import { capaPadrao } from '../lib/categorias'

// O cartão de uma categoria (087): uma imagem larga com o nome por cima
// e, dentro, os serviços daquela categoria. Estilo vitrine de app de
// delivery: a foto puxa o olho, a lista vem embaixo.
export default function CategoriaCard({ nome, imagem, quantos, children }) {
  return (
    <section className="cat-card">
      <div className="cat-card-capa">
        <img src={imagem || capaPadrao(nome)} alt="" loading="lazy" />
        <span className="cat-card-veu">
          <strong>{nome}</strong>
          {quantos != null && <span>{quantos} {quantos === 1 ? 'serviço' : 'serviços'}</span>}
        </span>
      </div>
      <div className="cat-card-corpo">{children}</div>
    </section>
  )
}
