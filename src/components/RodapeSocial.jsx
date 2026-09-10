import { Link } from 'react-router-dom'
import { useConfig, instagramDe } from '../lib/config'
import { InstagramIcon } from './icons'

// O pé de página das portas de entrada e das páginas públicas: o
// Instagram da casa e os dois links que a LGPD pede à mão.
export default function RodapeSocial({ compacto = false }) {
  const insta = instagramDe(useConfig())
  return (
    <footer className={'rodape-social' + (compacto ? ' compacto' : '')}>
      {insta && (
        <a className="rodape-insta" href={insta.url} target="_blank" rel="noopener noreferrer" aria-label={`Instagram @${insta.handle}`}>
          <InstagramIcon /><span>{insta.handle}</span>
        </a>
      )}
      <nav className="rodape-links muted">
        <Link to="/termos">Termos de uso</Link>
        <span aria-hidden="true">·</span>
        <Link to="/privacidade">Privacidade</Link>
      </nav>
    </footer>
  )
}
