import { Link } from 'react-router-dom'
import { MapPin, Store } from 'lucide-react'
import { Logo } from '../site/Pecas'
import { HUB } from '../../lib/paginas'

// O cabeçalho do guia (3.47): o guia tem cara própria, não é uma seção do site de vendas (sem "Para salões",
// "Funcionalidades", "Planos", "Entrar"...). A marca e "Cidades" levam ao índice do guia; o único caminho para o
// site da MIMO é "Tem um salão?", discreto, à direita. Usa a mesma barra fixa do site (ld-nav), então as páginas
// do guia não mudam de altura nem de recuo.
export default function NavGuia() {
  return (
    <header className="ld-nav gd-nav">
      <div className="ld-wrap ld-nav-in">
        <Link to="/saloes" className="gd-nav-marca" aria-label="Guia de salões da MIMO, todas as cidades">
          <Logo altura={44} />
          <span className="gd-nav-guia">Guia de salões</span>
        </Link>
        <nav className="gd-nav-links" aria-label="Guia">
          <Link to="/saloes" className="gd-nav-cidades"><MapPin size={16} aria-hidden="true" /> Cidades</Link>
          <Link to={HUB} className="gd-nav-salao" aria-label="Tem um salão? Conheça a MIMO"><Store size={16} aria-hidden="true" /><span className="gd-nav-salao-longo">Tem um salão?</span><span className="gd-nav-salao-curto">Para salões</span></Link>
        </nav>
      </div>
    </header>
  )
}
