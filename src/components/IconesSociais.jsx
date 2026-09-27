// Ícones das redes, no traço da MIMO (currentColor; a cor vem do lugar).
// O Lucide não traz marcas, então ficam aqui, simples e leves.
const base = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
export const IconeInstagram = ({ size = 16 }) => <svg {...base} width={size} height={size}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
export const IconeFacebook = ({ size = 16 }) => <svg {...base} width={size} height={size}><path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z" /></svg>
export const IconeTikTok = ({ size = 16 }) => <svg {...base} width={size} height={size}><path d="M9 12a4 4 0 1 0 4 4V4c0 3 2.5 5 5 5" /></svg>
export const IconeYoutube = ({ size = 16 }) => <svg {...base} width={size} height={size}><rect x="2.5" y="6" width="19" height="12" rx="4" /><path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" /></svg>
export const IconeSite = ({ size = 16 }) => <svg {...base} width={size} height={size}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>

export const REDES = [
  { chave: 'instagram', nome: 'Instagram', Icone: IconeInstagram, prefixo: '@', placeholder: 'seusalao', dica: 'só o @, sem o link' },
  { chave: 'facebook', nome: 'Facebook', Icone: IconeFacebook, prefixo: 'facebook.com/', placeholder: 'seusalao', dica: 'o que vem depois de facebook.com/' },
  { chave: 'tiktok', nome: 'TikTok', Icone: IconeTikTok, prefixo: '@', placeholder: 'seusalao', dica: 'só o @' },
  { chave: 'youtube', nome: 'YouTube', Icone: IconeYoutube, prefixo: 'youtube.com/', placeholder: '@seusalao', dica: 'o canal, depois de youtube.com/' },
  { chave: 'site', nome: 'Site', Icone: IconeSite, prefixo: 'https://', placeholder: 'www.seusalao.com.br', dica: 'o endereço do site' },
]

// limpa o que a pessoa colou: tira link, @ e barras; guarda só o identificador
export function limparRede(chave, v) {
  let t = String(v ?? '').trim()
  if (!t) return ''
  if (chave === 'site') return t.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  t = t.replace(/^https?:\/\/(www\.)?/i, '').replace(/^(instagram|facebook|tiktok|youtube)\.com\//i, '').replace(/^@/, '').replace(/\/+$/, '').split(/[?#]/)[0]
  return t.slice(0, 80)
}
export function linkDaRede(chave, v) {
  const t = limparRede(chave, v)
  if (!t) return null
  return { instagram: `https://instagram.com/${t}`, facebook: `https://facebook.com/${t}`, tiktok: `https://tiktok.com/@${t}`, youtube: `https://youtube.com/${t.startsWith('@') ? t : t}`, site: `https://${t}` }[chave]
}
