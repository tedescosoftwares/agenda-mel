import { useEffect, useId, useRef, useState } from 'react'

// Peças da Home do dia a dia do salão (4.19): o número que sobe, a faísca do mês e o anel de ocupação.
// Tudo em SVG e CSS, sem biblioteca; quem pediu menos movimento no aparelho vê o valor final direto.

const semMovimento = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// o número sobe de zero até o valor em ~0,7 s (uma vez, quando o valor chega)
export function Contador({ valor = 0, formato = (n) => String(n), ms = 700 }) {
  const alvo = Number(valor) || 0
  const [n, setN] = useState(semMovimento() ? alvo : 0)
  const de = useRef(0)
  useEffect(() => {
    if (semMovimento()) { setN(alvo); de.current = alvo; return }
    const inicio = de.current, t0 = performance.now()
    let quadro
    const passo = (t) => {
      const p = Math.min(1, (t - t0) / ms), suave = 1 - Math.pow(1 - p, 3)
      setN(Math.round(inicio + (alvo - inicio) * suave))
      if (p < 1) quadro = requestAnimationFrame(passo)
      else de.current = alvo
    }
    quadro = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(quadro)
  }, [alvo, ms])
  return <>{formato(n)}</>
}

// a linha do mês em miniatura: pontos {x, y}; sem dados, uma linha de base pontilhada
export function Faisca({ pontos = [], largura = 132, altura = 40 }) {
  const id = useId()
  if (pontos.length < 2) {
    return <svg className="dia-faisca vazia" viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none" aria-hidden="true"><line x1="2" y1={altura - 6} x2={largura - 2} y2={altura - 6} /></svg>
  }
  const ys = pontos.map((p) => Number(p.y) || 0), max = Math.max(...ys), min = Math.min(...ys), faixa = max - min || 1
  const xy = ys.map((y, i) => [2 + (i * (largura - 4)) / (ys.length - 1), 5 + (1 - (y - min) / faixa) * (altura - 12)])
  // curva suave entre os pontos (meio caminho como ponto de controle)
  const linha = xy.reduce((d, [x, y], i) => {
    if (i === 0) return `M${x.toFixed(1)},${y.toFixed(1)}`
    const [px, py] = xy[i - 1], mx = (px + x) / 2
    return `${d} C${mx.toFixed(1)},${py.toFixed(1)} ${mx.toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`
  }, '')
  const [ux] = xy[xy.length - 1]
  return (
    <svg className="dia-faisca" viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".28" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
      <path className="dia-faisca-area" d={`${linha} L${ux.toFixed(1)},${altura} L2,${altura} Z`} fill={`url(#${id})`} />
      <path className="dia-faisca-linha" d={linha} pathLength="1" />
    </svg>
  )
}

// anel de 0 a 100%, com o texto no meio
export function Anel({ pct = 0, children, tamanho = 58 }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0)), r = 24, volta = 2 * Math.PI * r
  return (
    <span className="dia-anel" style={{ width: tamanho, height: tamanho }}>
      <svg viewBox="0 0 58 58" aria-hidden="true">
        <circle className="dia-anel-trilho" cx="29" cy="29" r={r} />
        <circle className="dia-anel-valor" cx="29" cy="29" r={r} strokeDasharray={volta} style={{ '--dia-anel-fim': volta * (1 - p / 100), '--dia-anel-volta': volta }} />
      </svg>
      <b>{children}</b>
    </span>
  )
}

// barras do mês: um retângulo por dia com movimento; a maior fica em destaque
export function Barras({ pontos = [], altura = 120 }) {
  if (!pontos.length) return null
  const max = Math.max(...pontos.map((p) => Number(p.y) || 0), 1)
  const n = pontos.length, larg = 100 / n
  const iMax = pontos.findIndex((p) => (Number(p.y) || 0) === max)
  const passo = Math.ceil(n / 6)
  return (
    <div className="hd-barras" style={{ '--hd-barras-alt': `${altura}px` }} role="img" aria-label="Faturamento por dia do mês">
      <div className="hd-barras-area">
        {pontos.map((p, i) => (
          <span key={i} className={'hd-barra' + (i === iMax ? ' maior' : '')} style={{ width: `${larg}%`, '--h': `${Math.max(4, ((Number(p.y) || 0) / max) * 100)}%`, '--i': i }}>
            {i === iMax && <em>R$ {Math.round(max).toLocaleString('pt-BR')}</em>}
            <i />
          </span>
        ))}
      </div>
      <div className="hd-barras-eixo">{pontos.map((p, i) => <span key={i} style={{ width: `${larg}%` }}>{i % passo === 0 || i === n - 1 ? p.x : ''}</span>)}</div>
    </div>
  )
}

// a pessoa da equipe com o anel de ocupação em volta
export function Pessoa({ nome, pct = 0, children }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0)), r = 30, volta = 2 * Math.PI * r
  const iniciais = String(nome ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase()
  return (
    <span className="hd-pessoa-anel">
      <svg viewBox="0 0 68 68" aria-hidden="true">
        <circle className="hd-pessoa-trilho" cx="34" cy="34" r={r} />
        <circle className="hd-pessoa-valor" cx="34" cy="34" r={r} strokeDasharray={volta} style={{ '--dia-anel-fim': volta * (1 - p / 100), '--dia-anel-volta': volta }} />
      </svg>
      <b>{children ?? iniciais}</b>
    </span>
  )
}
