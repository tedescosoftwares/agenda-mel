// Datas e textos curtos em português, sem depender do Intl do aparelho.
// Dinheiro e duração vêm do core compartilhado com a web.
export { formatDuracao, formatPreco, toISODate } from '@mimo/core'

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const pad = (n: number) => String(n).padStart(2, '0')

// 'YYYY-MM-DD' vira a meia-noite local (sem sustos de fuso)
export function dataLocal(iso: string): Date {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1)
}
export const diaSemana = (iso: string) => DIAS[dataLocal(iso).getDay()] ?? ''
export const diaNumero = (iso: string) => String(dataLocal(iso).getDate())
export const mesCurto = (iso: string) => MESES[dataLocal(iso).getMonth()] ?? ''
export const dataCurta = (iso: string) => {
  const d = dataLocal(iso)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}
export const hora = (hhmmss: string) => hhmmss.slice(0, 5)

// 'hoje', 'amanhã', 'em 3 dias', 'em 2 semanas'
export function emQuanto(iso: string): string {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const dias = Math.round((dataLocal(iso).getTime() - hoje.getTime()) / 86400000)
  if (dias < 0) return 'passou'
  if (dias === 0) return 'hoje'
  if (dias === 1) return 'amanhã'
  if (dias < 7) return `em ${dias} dias`
  const semanas = Math.round(dias / 7)
  return semanas === 1 ? 'em 1 semana' : `em ${semanas} semanas`
}

export function iniciais(nome?: string | null): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean)
  const letras = partes.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('')
  return letras || '?'
}
export const primeiroNome = (nome?: string | null) => (nome ?? '').trim().split(/\s+/)[0] ?? ''
export function saudacao(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}
