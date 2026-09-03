// Gráfico de linha em SVG puro, sem biblioteca. Recebe [{x, y}] e
// desenha a curva, a área sob ela e o maior ponto marcado. Não tem
// eixo Y numerado de propósito: numa tela de 390px o número do pico e
// o rótulo do dia já contam a história.
export default function GraficoLinha({ pontos, altura = 150 }) {
  if (!pontos.length) return null
  const W = 340, H = altura, px = 10, py = 24
  const max = Math.max(...pontos.map((p) => p.y), 1)
  const X = (i) => px + (i * (W - 2 * px)) / Math.max(1, pontos.length - 1)
  const Y = (v) => H - py - (v / max) * (H - 2 * py)
  // um ponto só não faz linha: desenha um traço curto para a área existir
  const serie = pontos.length === 1 ? [pontos[0], pontos[0]] : pontos
  const Xs = (i) => pontos.length === 1 ? px + i * (W - 2 * px) : X(i)
  const d = serie.map((p, i) => `${i ? 'L' : 'M'}${Xs(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')
  const area = `${d} L${Xs(serie.length - 1).toFixed(1)},${H - py} L${Xs(0).toFixed(1)},${H - py} Z`
  const iMax = pontos.findIndex((p) => p.y === max)
  const passo = Math.ceil(pontos.length / 6)
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="grafico-linha" role="img" aria-label="Faturamento por dia">
      <defs>
        <linearGradient id="gl-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff2d7a" stopOpacity="0.28" /><stop offset="1" stopColor="#ff2d7a" stopOpacity="0" /></linearGradient>
      </defs>
      <path d={area} fill="url(#gl-area)" />
      <path d={d} fill="none" stroke="#ff2d7a" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {pontos.map((p, i) => <circle key={i} cx={X(i)} cy={Y(p.y)} r={i === iMax ? 5 : 2.5} fill={i === iMax ? '#ff2d7a' : '#fff'} stroke="#ff2d7a" strokeWidth="1.5" />)}
      <text x={X(iMax)} y={Y(max) - 9} textAnchor="middle" fontSize="11" fontWeight="600" fill="#1f2026">R$ {max.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</text>
      {pontos.map((p, i) => (i % passo === 0 || i === pontos.length - 1) && <text key={'t' + i} x={X(i)} y={H + 12} textAnchor="middle" fontSize="10" fill="#9a9ea8">{p.x}</text>)}
    </svg>
  )
}
