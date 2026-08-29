export const PASSO_MIN = 30 // grade de horários de 30 em 30 minutos

export function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function minToHora(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0')
  const m = String(min % 60).padStart(2, '0')
  return `${h}:${m}`
}

// Horários livres de um dia, respeitando o expediente da profissional,
// a duração do serviço e o que já está ocupado na agenda dela
export function gerarSlots({ inicio, fim, duracao, ocupados, ehHoje }) {
  const slots = []
  const fimMin = toMin(fim)
  const agora = new Date()
  const agoraMin = agora.getHours() * 60 + agora.getMinutes()

  const busy = (ocupados ?? []).map((o) => ({
    ini: toMin(o.start_time.slice(0, 5)),
    fim: toMin(o.end_time.slice(0, 5)),
  }))

  for (let t = toMin(inicio); t + duracao <= fimMin; t += PASSO_MIN) {
    if (ehHoje && t <= agoraMin) continue
    const conflito = busy.some((o) => t < o.fim && t + duracao > o.ini)
    if (!conflito) slots.push(minToHora(t))
  }
  return slots
}

export function formatDataLonga(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export function formatDataCurta(iso) {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

// "Maria Clara Souza" -> "MS"
export function iniciais(nome) {
  if (!nome) return '?'
  const partes = nome.trim().split(/\s+/)
  const primeira = partes[0]?.charAt(0) ?? ''
  const ultima = partes.length > 1 ? partes[partes.length - 1].charAt(0) : ''
  return (primeira + ultima).toUpperCase()
}

// "Ana Paula" -> "ana-paula"
export function gerarSlug(nome) {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
