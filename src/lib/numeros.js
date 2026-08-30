// Ajudantes das telas de números.
//
// O banco devolve dinheiro em centavos inteiros e percentual em
// pontos-base (1234 = 12,34%). A conversão para texto acontece aqui,
// num lugar só, para não sair 12.339999999% em canto nenhum.

export function formatarCents(cents) {
  return (Number(cents ?? 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

// R$ 3.850 — sem centavos, para os números grandes do topo
export function formatarReaisCurto(cents) {
  const reais = Math.round(Number(cents ?? 0) / 100)
  return 'R$ ' + reais.toLocaleString('pt-BR')
}

export function formatarPct(bps) {
  const pct = Number(bps ?? 0) / 100
  return pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'
}

// 2070 minutos -> "34h30"
export function formatarHoras(min) {
  const total = Math.max(0, Math.round(Number(min ?? 0)))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m}min`
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

// Quanto o mês está acima ou abaixo do anterior.
// Devolve null quando não há com o que comparar — melhor não mostrar
// nada do que mostrar "+100%" contra um mês vazio.
export function variacao(atual, anterior) {
  const a = Number(atual ?? 0)
  const b = Number(anterior ?? 0)
  if (!b) return null
  const pct = ((a - b) / b) * 100
  return {
    pct,
    texto: (pct >= 0 ? '+' : '−') + Math.abs(pct).toLocaleString('pt-BR', {
      maximumFractionDigits: 0,
    }) + '%',
    subiu: pct >= 0,
  }
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

export function nomeDoMes(iso) {
  const [ano, mes] = String(iso).split('-')
  return `${MESES[Number(mes) - 1]} de ${ano}`
}

// primeiro dia do mês, em YYYY-MM-DD, deslocado por N meses
export function mesDeslocado(iso, delta) {
  const [ano, mes] = String(iso).split('-').map(Number)
  const d = new Date(ano, mes - 1 + delta, 1)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
}

export function mesAtual() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
}

export function diasEmTexto(dias) {
  const n = Number(dias ?? 0)
  if (n <= 0) return 'hoje'
  if (n === 1) return 'ontem'
  if (n < 30) return `há ${n} dias`
  const meses = Math.floor(n / 30)
  return meses === 1 ? 'há 1 mês' : `há ${meses} meses`
}
