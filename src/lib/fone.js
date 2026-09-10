// Telefone brasileiro: máscara enquanto digita e validação.
//   formatarFone('13998710002') -> '(13) 99871-0002'
//   foneValido('(13) 99871-0002') -> true   (11 dígitos, DDD + 9)
export function soDigitos(v) {
  return String(v ?? '').replace(/\D/g, '').slice(0, 11)
}
export function formatarFone(v) {
  const d = soDigitos(v)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}
export function foneValido(v) {
  const d = soDigitos(v)
  return d.length === 11 && d[2] === '9' && d[0] !== '0'
}
