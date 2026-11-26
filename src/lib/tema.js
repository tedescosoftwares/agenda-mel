// O tema do painel do salão (4.21): claro ou escuro, escolhido no botão da lua e lembrado no aparelho.
// Vale só dentro do painel (o AdminShell liga ao montar e desliga ao sair): o app da cliente não muda.
const CHAVE = 'mimo-tema'
const EVENTO = 'mimo:tema'

export function lerTema() {
  try { return localStorage.getItem(CHAVE) === 'escuro' ? 'escuro' : 'claro' } catch { return 'claro' }
}
export function aplicarTema(tema) {
  if (typeof document === 'undefined') return
  if (tema === 'escuro') document.documentElement.dataset.tema = 'escuro'
  else delete document.documentElement.dataset.tema
}
export function trocarTema() {
  const novo = lerTema() === 'escuro' ? 'claro' : 'escuro'
  try { localStorage.setItem(CHAVE, novo) } catch { /* sem armazenamento */ }
  aplicarTema(novo)
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: novo }))
  return novo
}
// para as telas saberem quando o tema muda (o botão pode estar na barra de cima ou na Home)
export function ouvirTema(fn) {
  const ouvir = (e) => fn(e.detail)
  window.addEventListener(EVENTO, ouvir)
  return () => window.removeEventListener(EVENTO, ouvir)
}
