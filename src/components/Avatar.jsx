import { iniciais } from '../lib/booking'

// Foto da profissional; sem foto, cai nas iniciais do nome
export default function Avatar({ nome, foto, grande = false, className = '' }) {
  const classes = [
    'avatar-iniciais',
    grande ? 'avatar-grande' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (foto) {
    return <img className={`${classes} avatar-foto`} src={foto} alt={nome ?? ''} />
  }
  return <div className={classes}>{iniciais(nome)}</div>
}
