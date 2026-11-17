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

// 3.85: o logo oficial da MIMO (o mesmo de public/mimo-logo.svg e public/mimo-pro-logo.svg), desenhado
// aqui para sair nítido em qualquer tamanho e sem pedir arquivo: o coração rosa com o rabinho e "mimo" em vinho;
// no "pro" (salão e profissional), o "pro" rosa embaixo. O viewBox corta as margens do arquivo original.
export const LOGO_CORACAO = 'M107 31 C94 14 65 19 65 45 C65 71 107 90 107 90 C107 90 149 71 149 45 C149 19 120 14 107 31 Z'
export const LOGO_RABO = 'M107 90 C129 94 148 104 166 118'
const LOGO_MIMO = 'm 146.99902,71.105469 3.32032,-1.708985 q 6.83593,-3.515625 12.25586,-3.515625 8.20312,0 10.9375,5.957032 10.00976,-5.957032 16.89453,-5.957032 12.40234,0 12.40234,13.525391 v 29.19922 l 4.58984,1.17187 V 113 h -22.80273 v -3.22266 l 4.10156,-1.17187 V 81.310547 q 0,-4.101563 -1.61133,-6.396485 -1.5625,-2.294921 -4.78515,-2.294921 -3.61328,0 -7.8125,2.050781 0.48828,2.050781 0.48828,4.736328 v 29.19922 l 4.58984,1.17187 V 113 h -22.80273 v -3.22266 l 4.10156,-1.17187 V 81.310547 q 0,-4.101563 -1.61133,-6.396485 -1.5625,-2.294921 -4.78515,-2.294921 -3.22266,0 -7.37305,1.904296 v 34.082033 l 4.19922,1.17187 V 113 h -22.80274 v -3.22266 l 4.49219,-1.17187 V 71.496094 l -4.49219,-1.171875 v -3.222657 h 17.82227 z m 77.39844,37.500001 5.0293,1.17187 V 113 h -24.1211 v -3.22266 l 4.98047,-1.17187 V 71.496094 l -4.6875,-1.171875 v -3.222657 h 18.79883 z M 209.79785,51.085937 q 0,-3.173828 2.19727,-5.322265 2.24609,-2.148438 5.32226,-2.148438 3.125,0 5.27344,2.197266 2.19727,2.148437 2.19727,5.273437 0,3.076172 -2.14844,5.322266 -2.14844,2.197266 -5.32227,2.197266 -3.125,0 -5.32226,-2.148438 -2.19727,-2.197265 -2.19727,-5.371094 z m 36.28516,20.019532 3.32031,-1.708985 q 6.83594,-3.515625 12.25586,-3.515625 8.20312,0 10.9375,5.957032 10.00977,-5.957032 16.89453,-5.957032 12.40234,0 12.40234,13.525391 v 29.19922 l 4.58985,1.17187 V 113 h -22.80274 v -3.22266 l 4.10157,-1.17187 V 81.310547 q 0,-4.101563 -1.61133,-6.396485 -1.5625,-2.294921 -4.78516,-2.294921 -3.61328,0 -7.8125,2.050781 0.48828,2.050781 0.48828,4.736328 v 29.19922 l 4.58985,1.17187 V 113 h -22.80274 v -3.22266 l 4.10157,-1.17187 V 81.310547 q 0,-4.101563 -1.61133,-6.396485 -1.5625,-2.294921 -4.78516,-2.294921 -3.22266,0 -7.37305,1.904296 v 34.082033 l 4.19922,1.17187 V 113 h -22.80273 v -3.22266 l 4.49219,-1.17187 V 71.496094 l -4.49219,-1.171875 v -3.222657 h 17.82226 z m 102.30078,18.701172 q 0,12.353519 -5.32227,18.261719 -5.27343,5.9082 -16.16211,5.9082 -10.54687,0 -15.72265,-5.95703 -5.17578,-6.00586 -5.17578,-18.212889 0,-12.158204 5.22461,-18.017579 5.27343,-5.908203 16.06445,-5.908203 10.88867,0 15.9668,6.103516 5.12695,6.054687 5.12695,17.822266 z m -14.30664,0 q 0,-10.742188 -1.61133,-14.84375 -1.5625,-4.150391 -5.46875,-4.150391 -3.75977,0 -5.22461,3.955078 -1.46484,3.955078 -1.46484,15.039063 0,11.279299 1.46484,15.283199 1.51367,4.00391 5.22461,4.00391 3.85742,0 5.46875,-4.19922 1.61133,-4.24805 1.61133,-15.087889 z'
const LOGO_PRO = 'm 275.27783,150.60352 q 0,7.1455 -2.87402,11.04785 -2.84766,3.87597 -8.06836,3.87597 -3.00586,0 -5.24707,-1.29199 -2.21484,-1.31836 -3.40137,-3.77051 h -0.1582 q 0.1582,0.79102 0.1582,4.79883 v 10.94238 h -7.40918 v -33.16992 q 0,-4.03418 -0.21094,-6.56543 h 7.19825 q 0.13183,0.47461 0.21093,1.87207 0.10547,1.39746 0.10547,2.76856 h 0.10547 q 2.50488,-5.24707 9.12305,-5.24707 4.9834,0 7.72558,3.84961 2.74219,3.82324 2.74219,10.88965 z m -7.72558,0 q 0,-9.59766 -5.87989,-9.59766 -2.95312,0 -4.53515,2.58398 -1.55567,2.58399 -1.55567,7.22461 0,4.61426 1.55567,7.14551 1.58203,2.50488 4.48242,2.50488 5.93262,0 5.93262,-9.86132 z M 279.26318,165 v -21.83203 q 0,-2.34668 -0.0791,-3.90235 -0.0527,-1.58203 -0.13183,-2.79492 h 7.0664 q 0.0791,0.47461 0.21094,2.90039 0.13184,2.39942 0.13184,3.19043 h 0.10546 q 1.08106,-3.00586 1.92481,-4.21875 0.84375,-1.23925 2.00391,-1.81933 1.16015,-0.60645 2.90039,-0.60645 1.42382,0 2.29394,0.39551 v 6.19629 q -1.79297,-0.39551 -3.16406,-0.39551 -2.76856,0 -4.32422,2.24121 -1.5293,2.24121 -1.5293,6.64453 V 165 Z m 46.12012,-14.29102 q 0,6.93457 -3.84961,10.88965 -3.84961,3.92871 -10.65234,3.92871 -6.6709,0 -10.46778,-3.95507 -3.79687,-3.95508 -3.79687,-10.86329 0,-6.88183 3.79687,-10.81054 3.79688,-3.95508 10.62598,-3.95508 6.98731,0 10.65234,3.82324 3.69141,3.79688 3.69141,10.94238 z m -7.75195,0 q 0,-5.08886 -1.66114,-7.38281 -1.66113,-2.29394 -4.82519,-2.29394 -6.75,0 -6.75,9.67675 0,4.77247 1.63477,7.27735 1.66113,2.47851 4.77246,2.47851 6.8291,0 6.8291,-9.75586 z'
export const LOGO_ROSA = '#FF2F73'
export const LOGO_VINHO = '#65142f'
//   pro      a variante MIMO Pro (área do salão e da profissional)
//   altura   em px (a largura segue a proporção)
//   claro    "mimo" em branco, para fundo escuro ou rosa
export function LogoMimo({ pro = false, altura = 32, claro = false, className = '', ...props }) {
  const h = pro ? 163 : 107
  return (
    <svg viewBox={`68 16 291 ${h}`} height={altura} width={Math.round((altura * 291) / h)} role="img" aria-label={pro ? 'MIMO Pro' : 'MIMO'}
      className={'logo-mimo' + (className ? ' ' + className : '')} {...props}>
      <g transform="translate(8,0)">
        <path d={LOGO_CORACAO} fill="none" stroke={LOGO_ROSA} strokeWidth="6" />
        <path d={LOGO_RABO} fill="none" stroke={LOGO_ROSA} strokeWidth="5" strokeLinecap="round" />
        <path d={LOGO_MIMO} fill={claro ? '#ffffff' : LOGO_VINHO} />
        {pro && <path d={LOGO_PRO} fill={LOGO_ROSA} />}
      </g>
    </svg>
  )
}

// o coração do logo oficial, sozinho (ícone pequeno: menus, selos, "feito com MIMO")
export function MarcaIcon({ id: _id, cor = LOGO_ROSA, grosso = false, ...props }) {
  return (
    <svg viewBox="67 13 112 112" width={28} height={24} fill="none" aria-hidden="true" {...props}>
      <g transform="translate(8,0)">
        <path d={LOGO_CORACAO} stroke={cor} strokeWidth={grosso ? 10 : 7} strokeLinejoin="round" />
        <path d={LOGO_RABO} stroke={cor} strokeWidth={grosso ? 9 : 6} strokeLinecap="round" />
      </g>
    </svg>
  )
}

// antes era o "mimo" escrito com a fonte do site; agora é o logo oficial inteiro (tamanho em rem, como era)
export function Wordmark({ tamanho = 2.4, pro = false, ...props }) {
  return <LogoMimo pro={pro} altura={Math.round(tamanho * 16 * 1.15)} {...props} />
}

export function HeartIcon({ cheio = false, ...props }) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill={cheio ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" {...props}>
      <path d="M12 20.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 8.2a4.3 4.3 0 0 1 7.5 2.3c0 5.4-7.5 10-7.5 10Z" />
    </svg>
  )
}

export function StarIcon({ cheio = true, ...props }) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill={cheio ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 17l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8Z" />
    </svg>
  )
}

export function VoltarSetaIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M15 5.5 8.5 12l6.5 6.5" />
    </svg>
  )
}

export function CalendarioCheckIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4M9 15l2 2 4-4.2" />
    </svg>
  )
}

export function QrIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" />
    </svg>
  )
}

export function CompartilharIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 3.5v11M8 7.5l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
    </svg>
  )
}

export function CopiarIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
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

// ---- ícones do painel da plataforma (056) ----
export function MailIcon(props) {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>)
}
export function WhatsIcon(props) {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M4 20l1.3-3.9A8 8 0 1 1 8.2 19.2L4 20z" /><path d="M9.5 9.5c0 3 2 5 5 5l1-1.2-1.6-1-1 .7c-.9-.4-1.5-1-1.9-1.9l.7-1-1-1.6-1.2 1z" /></svg>)
}
export function ListaIcon(props) {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M9 6h11M9 12h11M9 18h11" /><path d="m4 6 1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></svg>)
}
export function EngrenagemIcon(props) {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>)
}
export function PredioIcon(props) {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M3 21h18M5 21V8l7-4 7 4v13" /><path d="M9 21v-5h6v5M9 11h.01M15 11h.01M12 11h.01" /></svg>)
}
export function ConviteIcon(props) {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M19 8v6M16 11h6" /></svg>)
}
export function TendenciaIcon(props) {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M3 17 9 11l4 4 8-8" /><path d="M15 7h6v6" /></svg>)
}
export function PulsoIcon(props) {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>)
}
export function AlertaIcon(props) {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>)
}
export function SetaIcon(props) {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M5 12h14M13 6l6 6-6 6" /></svg>)
}
export function MegafoneIcon(props) {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" /><path d="M15 9.5a3 3 0 0 1 0 5" /><path d="M18 7a7 7 0 0 1 0 10" /><path d="M7 14v5" /></svg>)
}
export function InstagramIcon(props) {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.3" cy="6.7" r="0.9" fill="currentColor" stroke="none" /></svg>)
}
export function CameraIcon(props) {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>)
}
export function EscudoIcon(props) {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z" /><path d="m9 12 2 2 4-4" /></svg>)
}
export function PinoIcon(props) {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z" /><circle cx="12" cy="10" r="2.2" /></svg>)
}
