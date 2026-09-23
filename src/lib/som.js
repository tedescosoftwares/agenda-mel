// Os sons do balcão (106), sintetizados na hora: nada de arquivo para
// baixar. O navegador só toca depois de um gesto da pessoa, então o
// contexto nasce no primeiro clique e fica guardado.
let ctx = null
export function preparar() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
  } catch { ctx = null }
  return Boolean(ctx)
}
function nota(freq, inicio, dur, ganho = 0.18, tipo = 'sine') {
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.type = tipo; o.frequency.setValueAtTime(freq, ctx.currentTime + inicio)
  g.gain.setValueAtTime(0.0001, ctx.currentTime + inicio)
  g.gain.exponentialRampToValueAtTime(ganho, ctx.currentTime + inicio + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + inicio + dur)
  o.connect(g); g.connect(ctx.destination)
  o.start(ctx.currentTime + inicio); o.stop(ctx.currentTime + inicio + dur + 0.05)
}
// novo: duas notas subindo · atencao: duas descendo · dinheiro: três subindo, mais brilhante
export function tocar(tipo = 'novo') {
  if (!preparar()) return
  try {
    if (tipo === 'dinheiro') { nota(880, 0, 0.12, 0.16, 'triangle'); nota(1175, 0.11, 0.12, 0.16, 'triangle'); nota(1568, 0.22, 0.28, 0.18, 'triangle') }
    else if (tipo === 'atencao') { nota(740, 0, 0.16, 0.18); nota(523, 0.17, 0.3, 0.16) }
    else if (tipo === 'estrela') { nota(1047, 0, 0.09, 0.14, 'triangle'); nota(1319, 0.08, 0.09, 0.14, 'triangle'); nota(1568, 0.16, 0.09, 0.14, 'triangle'); nota(2093, 0.24, 0.3, 0.16, 'triangle') }
    else { nota(659, 0, 0.14, 0.16); nota(988, 0.13, 0.3, 0.18) }
  } catch { /* sem áudio */ }
}
