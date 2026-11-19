// 4.0: o que a Agenda (quadro, semana e lista) compartilha: datas, minutos, a cor de cada profissional e os
// horários livres do dia.

export const isoHoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const somarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const segundaDe = (iso) => { const d = new Date(iso + 'T12:00:00'); return somarDias(iso, -((d.getDay() + 6) % 7)) }
export const semanaDe = (iso) => { const seg = segundaDe(iso); return Array.from({ length: 7 }, (_, i) => somarDias(seg, i)) }
export const min = (t) => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m }
export const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
export const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
export function rotuloLongo(iso) {
  const d = new Date(iso + 'T12:00:00')
  const t = `${DIAS[d.getDay()]}, ${d.getDate()} de ${d.toLocaleDateString('pt-BR', { month: 'long' })}`
  return t.charAt(0).toUpperCase() + t.slice(1)
}
export const primeiroNome = (n) => String(n ?? '').trim().split(/\s+/)[0] || ''
export const iniciais = (n) => String(n ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()

// a cor de cada profissional, pela ordem da equipe (a mesma no quadro, na semana e na lista)
const CORES = [
  ['#ff2d7a', '#ffe6ef'], ['#8b5cf6', '#efe8ff'], ['#f08c2b', '#fff1e2'], ['#12a06a', '#e3f6ee'],
  ['#3a6fd8', '#e6eefc'], ['#d6336c', '#fde4ee'], ['#0d9488', '#dff5f2'], ['#a16207', '#fbf1dc'],
]
export const corDa = (profs, id) => { const i = Math.max(0, profs.findIndex((p) => p.id === id)); const [cor, veu] = CORES[i % CORES.length]; return { cor, veu } }

// a jornada de cada profissional no dia: { [id]: { open, start, end } } (professional_hours do dia da semana)
export function jornadaDoDia(horas, iso) {
  const wd = new Date(iso + 'T12:00:00').getDay()
  const out = {}
  for (const h of horas ?? []) if (h.weekday === wd) out[h.professional_id] = { open: Boolean(h.open), start: String(h.start_time).slice(0, 5), end: String(h.end_time).slice(0, 5) }
  return out
}

// os bloqueios do dia (professional_blocks: o almoço de toda semana, o médico de um dia), por profissional:
// { [id]: [{ ini, fim, motivo, diaTodo }] }
export function bloqueiosDoDia(blocos, iso) {
  const wd = new Date(iso + 'T12:00:00').getDay()
  const out = {}
  for (const b of blocos ?? []) {
    const vale = b.kind === 'semanal' ? b.weekday === wd : b.kind === 'data' && String(b.date).slice(0, 10) === iso
    if (!vale) continue
    const item = b.all_day
      ? { ini: 0, fim: 24 * 60, motivo: b.reason || '', diaTodo: true }
      : { ini: min(b.start_time), fim: min(b.end_time), motivo: b.reason || '', diaTodo: false }
    ;(out[b.professional_id] ??= []).push(item)
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.ini - b.ini)
  return out
}

// os horários livres do dia, por profissional (no mínimo `minimo` minutos; hoje, só daqui para a frente). Iguais
// em mais de uma profissional viram um só ("Ana e Carla").
export function livresDoDia({ agenda, profs, jornada, bloqueios = null, dia, agora = new Date(), minimo = 45 }) {
  const hoje = dia === isoHoje()
  if (dia < isoHoje()) return []
  const agoraMin = agora.getHours() * 60 + agora.getMinutes()
  const porChave = new Map()
  for (const p of profs) {
    const j = jornada?.[p.id]
    if (!j?.open) continue
    const blocos = bloqueios?.[p.id] ?? []
    if (blocos.some((b) => b.diaTodo)) continue
    let cur = min(j.start)
    const fim = min(j.end)
    if (hoje) cur = Math.max(cur, Math.ceil(agoraMin / 15) * 15)
    const ocupados = (agenda ?? [])
      .filter((a) => a.professional_id === p.id && a.status !== 'cancelado' && a.status !== 'faltou')
      .map((a) => [min(a.start_time), min(a.end_time)])
      .concat(blocos.map((b) => [b.ini, b.fim]))
      .sort((x, y) => x[0] - y[0])
    const guardar = (ini, ate) => {
      if (ate - ini < minimo) return
      const k = `${ini}-${ate}`
      const g = porChave.get(k) ?? { ini, fim: ate, profs: [] }
      g.profs.push(p)
      porChave.set(k, g)
    }
    for (const [s, e] of ocupados) { if (s > cur) guardar(cur, Math.min(s, fim)); cur = Math.max(cur, e) }
    if (fim > cur) guardar(cur, fim)
  }
  return [...porChave.values()].sort((a, b) => a.ini - b.ini)
}
