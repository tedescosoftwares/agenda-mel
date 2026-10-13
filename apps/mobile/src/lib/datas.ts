// A data de aniversário como a pessoa digita ("23/08/1994") e como o banco
// guarda ("1994-08-23"). Usado no perfil e no cadastro.
export const mascaraData = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 8)
  return d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}
export const paraIso = (v: string) => {
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const [, d, mes, a] = m
  const dt = new Date(Number(a), Number(mes) - 1, Number(d))
  if (dt.getFullYear() !== Number(a) || dt.getMonth() !== Number(mes) - 1 || dt.getDate() !== Number(d)) return null
  return `${a}-${mes}-${d}`
}
export const deIso = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

// aniversário possível: a partir de 1920 e não no futuro
export function nascimentoOk(iso: string): boolean {
  const d = new Date(iso + 'T12:00:00')
  return !Number.isNaN(d.getTime()) && d.getFullYear() >= 1920 && d <= new Date()
}
