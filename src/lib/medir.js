// Medidor de largura, para abrir NO CELULAR: ?medir=1 na URL.
//
// Existe porque rolagem lateral no iPhone é o tipo de defeito que só
// aparece no iPhone — o Chromium daqui mede a mesma página e não vê
// nada. Então o app mede a si mesmo, no aparelho onde o problema
// existe, e mostra numa faixa: quanto a página está mais larga que a
// tela, e quais elementos passam da borda direita (com contorno
// vermelho neles). Não entra em produção por si só: só roda se a URL
// pedir, e não custa nada quando não pede.
export function ligarMedidor() {
  if (!/[?&]medir=1/.test(window.location.search)) return

  const faixa = document.createElement('pre')
  Object.assign(faixa.style, {
    position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: 99999,
    margin: '0', padding: '8px 10px', fontSize: '11px', lineHeight: '1.35',
    background: 'rgba(31,32,38,.92)', color: '#fff', whiteSpace: 'pre-wrap',
    maxHeight: '45vh', overflow: 'auto', fontFamily: 'ui-monospace, monospace',
  })
  document.body.appendChild(faixa)

  const marcados = new Set()
  function medir() {
    const W = window.innerWidth
    const doc = document.documentElement
    const linhas = [`tela ${W}px · página ${doc.scrollWidth}px · rolou ${Math.round(window.scrollX || doc.scrollLeft)}px`]
    for (const el of marcados) el.style.outline = ''
    marcados.clear()
    let n = 0
    for (const el of document.querySelectorAll('body *')) {
      if (el === faixa || faixa.contains(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      const cs = getComputedStyle(el)
      // o que rola de propósito (chips, dias) não é problema: só o que
      // está fora de um pai que rola
      const paiRola = el.closest('[style*="overflow"], .day-picker, .filtro-chips, .fileira-prof, .slots-grid')
      const passa = r.right - W
      if (passa > 1 && !paiRola) {
        el.style.outline = '2px solid #ff2d7a'
        marcados.add(el)
        const nome = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
        linhas.push(`+${Math.round(passa)}px  ${nome}  (larg ${Math.round(r.width)}, pos ${cs.position})`)
        if (++n >= 8) break
      }
    }
    if (n === 0) linhas.push('nenhum elemento passa da borda direita')
    faixa.textContent = linhas.join('\n')
  }
  medir()
  setInterval(medir, 1500)
}
