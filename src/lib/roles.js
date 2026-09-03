// Para onde cada papel vai ao entrar no app
export function homeDoPapel(role) {
  if (role === 'admin') return '/admin'
  if (role === 'profissional') return '/pro'
  return '/cliente/home'
}
