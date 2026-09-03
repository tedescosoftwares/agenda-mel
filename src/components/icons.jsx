const base = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function CalendarIcon(props) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </svg>
  )
}

export function SparkleIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z" />
    </svg>
  )
}

export function ClockIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

export function UsersIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16.5 14.5c2.6 0.4 4.5 2.7 4.5 5.5" />
    </svg>
  )
}

export function ChevronIcon(props) {
  return (
    <svg {...base} width={18} height={18} {...props}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

export function SearchIcon(props) {
  return (
    <svg {...base} width={18} height={18} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  )
}

export function TeamIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="7" r="3.2" />
      <path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M4.5 11.5a2.2 2.2 0 1 0 0-4.4" />
      <path d="M19.5 11.5a2.2 2.2 0 1 1 0-4.4" />
    </svg>
  )
}

export function LinkIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
      <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
    </svg>
  )
}

export function BellIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.2 5.5 2 6.5H4c.8-1 2-2.5 2-6.5z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  )
}

export function GraficoIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </svg>
  )
}

export function VoltarIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  )
}

// A marca: a lâmpada em volta do espelho do salão
// A marca do MIMO: dois corações encaixados, o de trás vazado.
// Preenchido com o gradiente rosa→laranja da casa; por ser um gradiente
// em SVG, o id precisa ser único na página — daí o sufixo.
export function MarcaIcon({ id = 'mimo', ...props }) {
  const grad = `grad-${id}`
  return (
    <svg
      viewBox="0 0 32 26"
      width={26}
      height={21}
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff2d72" />
          <stop offset="100%" stopColor="#ff6a00" />
        </linearGradient>
      </defs>
      {/* o coração de trás, só contorno */}
      <path
        d="M9.6 24.4C5.2 20.9 1 17.7 1 12.6 1 8.9 3.9 6 7.5 6c2.1 0 4 1 5.2 2.6C13.9 7 15.8 6 17.9 6c3.6 0 6.5 2.9 6.5 6.6 0 5.1-4.2 8.3-8.6 11.8a3.6 3.6 0 0 1-4.4 0Z"
        stroke={`url(#${grad})`}
        strokeWidth="2"
        opacity="0.42"
      />
      {/* o da frente, cheio */}
      <path
        d="M22.3 23.6c-3.6-2.9-7-5.5-7-9.7 0-3 2.4-5.4 5.3-5.4 1.7 0 3.3.8 4.3 2.1 1-1.3 2.5-2.1 4.2-2.1 2.9 0 5.3 2.4 5.3 5.4 0 4.2-3.4 6.8-7 9.7a2.9 2.9 0 0 1-3.6 0Z"
        fill={`url(#${grad})`}
        transform="translate(-8.2 -4.6)"
      />
    </svg>
  )
}

export function HomeIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M3.5 10.4 12 3.6l8.5 6.8V20a1 1 0 0 1-1 1h-4.6v-6.1H9.1V21H4.5a1 1 0 0 1-1-1Z" />
    </svg>
  )
}

export function PessoaIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20.2c.6-3.6 3.6-5.8 7.2-5.8s6.6 2.2 7.2 5.8" />
    </svg>
  )
}

export function MaisIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor"
      strokeWidth={2.4} strokeLinecap="round" aria-hidden="true" {...props}>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  )
}
