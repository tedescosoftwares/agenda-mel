import { Link } from 'react-router-dom'
import { BellIcon } from './icons'
import { useNotificacoes } from '../context/NotificacoesContext'

export default function SinoAvisos({ to = '/avisos' }) {
  const { naoLidos } = useNotificacoes()

  return (
    <Link to={to} className="sino" aria-label="Avisos">
      <BellIcon width={21} height={21} />
      {naoLidos > 0 && (
        <span className="sino-contador">{naoLidos > 9 ? '9+' : naoLidos}</span>
      )}
    </Link>
  )
}
