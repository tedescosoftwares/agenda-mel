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
export function Barras({ pontos = [], altura = 120, diasNoMes = 0, hoje = 0, atendimentos = 0 }) {
  if (!pontos.length) return null
  // 4.43: o mês inteiro no eixo (dia sem movimento vira um ponto na linha), para o salão de pouco movimento não parecer
  // um gráfico quebrado; com poucos dias, cada barra mostra o seu valor; e embaixo, o resumo em palavras
  const valorDe = new Map(pontos.map((p) => [Number(p.x), Number(p.y) || 0]))
  const serie = diasNoMes ? Array.from({ length: diasNoMes }, (_, k) => ({ x: String(k + 1).padStart(2, '0'), y: valorDe.get(k + 1) ?? 0, futuro: hoje > 0 && k + 1 > hoje })) : pontos.map((p) => ({ x: p.x, y: Number(p.y) || 0 }))
  const max = Math.max(...serie.map((p) => p.y), 1)
  const n = serie.length, larg = 100 / n
  const iMax = serie.findIndex((p) => p.y === max)
  const ativos = serie.filter((p) => p.y > 0)
  const todos = ativos.length <= 5
  const passo = Math.ceil(n / 6)
  const total = ativos.reduce((s, p) => s + p.y, 0)
  const rs = (v) => 'R$ ' + Math.round(v).toLocaleString('pt-BR')
  return (
    <div className="hd-barras" style={{ '--hd-barras-alt': `${altura}px` }} role="img" aria-label="Faturamento por dia do mês">
      <div className="hd-barras-area">
        {serie.map((p, i) => (
          <span key={i} className={'hd-barra' + (i === iMax ? ' maior' : '') + (p.y > 0 ? '' : ' zero') + (p.futuro ? ' futuro' : '') + (i === hoje - 1 ? ' hoje' : '')} style={{ width: `${larg}%`, '--h': `${p.y > 0 ? Math.max(6, (p.y / max) * 100) : 0}%`, '--i': i }}>
            {p.y > 0 && (todos || i === iMax) && <em>{rs(p.y)}</em>}
            <i />
          </span>
        ))}
      </div>
      <div className="hd-barras-eixo">{serie.map((p, i) => <span key={i} style={{ width: `${larg}%` }} className={p.y > 0 && todos ? 'com' : ''}>{(todos ? p.y > 0 : i % passo === 0 || i === n - 1) || (todos && (i === 0 || i === n - 1)) ? p.x : ''}</span>)}</div>
      {diasNoMes > 0 && (
        <div className="hd-barras-resumo">
          <span><b>{ativos.length}</b> {ativos.length === 1 ? 'dia com movimento' : 'dias com movimento'}</span>
          <span>Melhor dia: <b>{serie[iMax]?.x}</b>, {rs(max)}</span>
          {atendimentos > 0 && <span>Média por atendimento: <b>{rs(total / atendimentos)}</b></span>}
        </div>
      )}
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
