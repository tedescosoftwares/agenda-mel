// A página do salão (3.79): o que a web (src/components/salao) e o app (apps/mobile/src/app/salao) mostram igual.
// Sem tela aqui: o "aberto agora", o preço de um serviço (com "a partir de" quando a equipe cobra diferente),
// a duração, o primeiro nome e a lista de quem faz.

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const minutos = (h) => {
  const [a, b] = String(h ?? '').split(':').map(Number)
  return Number.isFinite(a) ? a * 60 + (Number.isFinite(b) ? b : 0) : null
}
// '09:00:00' → '9h'; '18:30:00' → '18h30'
export function horaCurta(h) {
  const m = minutos(h)
  if (m == null) return ''
  const hh = Math.floor(m / 60), mm = m % 60
  return mm ? `${hh}h${String(mm).padStart(2, '0')}` : `${hh}h`
}

// o horário da casa agora: { aberto, texto } ou null sem horário cadastrado
//   aberto: "Aberto agora · fecha às 18h"
//   fechado: "Fechado · abre hoje às 9h" / "abre amanhã às 9h" / "abre seg às 9h"
export function situacaoAgora(horarios, agora = new Date()) {
  const lista = (horarios ?? []).filter((h) => h && h.open && minutos(h.start_time) != null && minutos(h.end_time) != null)
  if (!lista.length) return null
  const porDia = new Map(lista.map((h) => [Number(h.weekday), h]))
  const dia = agora.getDay()
  const agoraMin = agora.getHours() * 60 + agora.getMinutes()
  const hoje = porDia.get(dia)
  if (hoje && agoraMin >= minutos(hoje.start_time) && agoraMin < minutos(hoje.end_time)) {
    return { aberto: true, texto: `Aberto agora · fecha às ${horaCurta(hoje.end_time)}` }
  }
  if (hoje && agoraMin < minutos(hoje.start_time)) return { aberto: false, texto: `Fechado · abre hoje às ${horaCurta(hoje.start_time)}` }
  for (let i = 1; i <= 7; i++) {
    const d = (dia + i) % 7
    const h = porDia.get(d)
    if (h) return { aberto: false, texto: `Fechado · abre ${i === 1 ? 'amanhã' : DIAS_CURTOS[d]} às ${horaCurta(h.start_time)}` }
  }
  return null
}

// o preço que a vitrine mostra: o menor entre a equipe (preço próprio de cada uma, ou o do serviço) e se é
// "a partir de" (o salão marcou, ou a equipe cobra diferente). `prof` limita a uma profissional.
export function precoDoServico(sv, prof = null) {
  const base = Number(sv?.price ?? 0)
  const quem = (sv?.quem ?? []).filter((q) => !prof || q.id === prof)
  const valores = quem.length ? quem.map((q) => (q.preco_cents != null ? Number(q.preco_cents) / 100 : base)) : [base]
  const menor = Math.min(...valores), maior = Math.max(...valores)
  return { valor: menor, aPartir: Boolean(sv?.a_partir) || maior > menor }
}

// a duração da vitrine, em minutos: a de quem faz (ou a do serviço)
export function duracaoDoServico(sv, prof = null) {
  const base = Number(sv?.duration_minutes ?? 0)
  const quem = (sv?.quem ?? []).filter((q) => !prof || q.id === prof)
  const valores = quem.map((q) => (q.duracao_minutos != null ? Number(q.duracao_minutos) : base)).filter((n) => n > 0)
  return valores.length ? Math.min(...valores) : base
}

export const primeiroNome = (nome) => String(nome ?? '').trim().split(/\s+/)[0] ?? ''

// "com Ana", "com Ana e Bia", "com Ana, Bia +2"
export function quemFaz(sv) {
  const nomes = (sv?.quem ?? []).map((q) => primeiroNome(q.nome)).filter(Boolean)
  if (!nomes.length) return ''
  if (nomes.length === 1) return `com ${nomes[0]}`
  if (nomes.length === 2) return `com ${nomes[0]} e ${nomes[1]}`
  return `com ${nomes[0]}, ${nomes[1]} +${nomes.length - 2}`
}

// o menor preço da casa, para o "a partir de R$ X" do botão de marcar
export function menorPrecoDaCasa(servicos) {
  const vs = (servicos ?? []).filter((s) => (s.quem ?? []).length).map((s) => precoDoServico(s).valor).filter((v) => v > 0)
  return vs.length ? Math.min(...vs) : null
}

// 3.80: o preço "a partir de" (o salão marca no cadastro do serviço: varia pelo tipo e tamanho do cabelo, volume…).
// Num pedido com vários serviços (`lista`), basta um ser "a partir de" para o total também ser.
export const ehAPartir = (sv) => Boolean(sv?.a_partir) || (Array.isArray(sv?.lista) && sv.lista.some((x) => x?.a_partir))
export const prefixoAPartir = (sv) => (ehAPartir(sv) ? 'a partir de ' : '')
export const AVISO_A_PARTIR = 'O valor final pode variar com o tipo, o tamanho e o volume do cabelo e é confirmado no salão.'
