// Para onde cada papel vai ao entrar no app
export function homeDoPapel(role) {
  if (role === 'plataforma') return '/plataforma'
  if (role === 'admin') return '/admin'
  if (role === 'profissional') return '/pro/agenda'
  return '/cliente/home'
}
