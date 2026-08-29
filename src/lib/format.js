export function formatPreco(valor) {
  return Number(valor).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export function formatDuracao(min) {
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

// Combos mostram a soma das durações como tempo médio, não como
// tempo exato — hora fechada passaria a impressão errada
export function labelDuracao(service) {
  const txt = formatDuracao(service.duration_minutes)
  return service.is_combo ? `tempo médio ~${txt}` : txt
}

// Data local no formato YYYY-MM-DD (sem sustos de fuso horário)
export function toISODate(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
