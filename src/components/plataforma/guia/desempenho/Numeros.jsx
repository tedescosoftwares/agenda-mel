import { useState } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import {
  n0, formatar, taxaTexto, taxaDeContato, somaDo, contataramDe, variacao, temComparacao, fraseDoPeriodo, textoDaFrase, detalheDoPeriodo, agruparDias,
} from '../../../../lib/guiaMetricas'
import { periodoCurto } from './comum'

// O topo da aba Desempenho (3.12): a frase que diz o período em linguagem
// simples e os cinco números, cada um com a tendência do período e a
// comparação honesta com o período anterior (só quando o banco manda o
// período anterior inteiro; antes zero não vira "+100%").

export default function Numeros({ dados }) {
  const frase = fraseDoPeriodo(dados)
  const detalhe = detalheDoPeriodo(dados)
  const t = dados.totais ?? {}, a = dados.totais_antes ?? {}
  const comparar = temComparacao(dados)
  const legenda = `vs. ${dados.dias} dias antes`
  const pessoas = n0(dados.visitantes)
  const contato = contataramDe(dados.contataram, pessoas)
  const pedidos = n0(dados.interesses?.quero_marcar)
  const toques = somaDo(dados, 'contato')
  const tx = taxaDeContato(dados.contataram, dados.visitantes)
  const txAntes = comparar ? taxaDeContato(dados.contataram_antes, dados.visitantes_antes) : null

  // a tendência: um ponto por dia até 31 dias; em 90 dias, grupos de 6 dias. Só dias
  // inteiros: hoje ainda não acabou e, no fim da linha, parecia uma queda que não houve
  const grupos = agruparDias((dados.por_dia ?? []).filter((p) => p.dia !== dados.ate), dados.dias)
  const com161 = grupos.some((p) => p.visitantes != null)
  const pontos = (f) => grupos.map((p) => ({ dia: p.dia, ate: p.ate, valor: f(p) }))

  return (
    <div className="pg-des-topo">
      <p className="pg-des-frase" aria-label={textoDaFrase(frase)}>
        {frase.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : <b key={i}>{p.forte}</b>))}
      </p>
      {detalhe && <p className="pg-des-detalhe">{detalhe}</p>}

      <div className="pg-des-nums">
        <Numero cor="visita" rotulo="Visitas" valor={formatar(t.visita)} sub="páginas abertas"
          v={comparar ? variacao(t.visita, a.visita) : null} legenda={legenda} dias={dados.dias}
          pontos={pontos((p) => n0(p.visitas))} unidade={['visita', 'visitas']} hoje={dados.ate} />
        <Numero cor="visita" rotulo="Pessoas" valor={formatar(pessoas)} sub="contadas dia a dia"
          v={comparar ? variacao(pessoas, dados.visitantes_antes) : null} legenda={legenda} dias={dados.dias}
          pontos={com161 ? pontos((p) => n0(p.visitantes)) : null} unidade={['pessoa', 'pessoas']} hoje={dados.ate} />
        <Numero cor="contato" rotulo="Tentaram contato" valor={formatar(contato)} sub={`${formatar(toques)} ${toques === 1 ? 'toque' : 'toques'} nos botões`}
          v={comparar ? variacao(contato, contataramDe(dados.contataram_antes, dados.visitantes_antes)) : null} legenda={legenda} dias={dados.dias}
          pontos={com161 ? pontos((p) => contataramDe(p.contataram, p.visitantes)) : null} unidade={['pessoa', 'pessoas']} hoje={dados.ate} />
        <Numero cor="contato" rotulo="Taxa de contato" valor={taxaTexto(tx)} sub="cada pessoa conta uma vez"
          taxaAntes={txAntes} tx={tx} dias={dados.dias}
          pontos={com161 ? pontos((p) => taxaDeContato(p.contataram, p.visitantes)) : null} formato={taxaTexto} hoje={dados.ate} />
        <Numero cor="pedido" rotulo="Pedidos pelo app" valor={formatar(pedidos)} sub={`${formatar(t.quero_marcar)} abriram o formulário`}
          v={comparar && dados.interesses_antes ? variacao(pedidos, n0(dados.interesses_antes.quero_marcar)) : null} legenda={legenda} dias={dados.dias}
          pontos={com161 ? pontos((p) => n0(p.pedidos)) : null} unidade={['pedido', 'pedidos']} hoje={dados.ate} />
      </div>
    </div>
  )
}

// um número do topo: rótulo, valor, comparação e tendência
function Numero({ cor, rotulo, valor, sub, v, legenda, dias, taxaAntes, tx, pontos, unidade, formato, hoje }) {
  let comparacao = null
  if (taxaAntes != null) {
    // a taxa compara o número de antes, não um "% de %"
    const dir = tx > taxaAntes ? 'sobe' : tx < taxaAntes ? 'desce' : 'igual'
    comparacao = <span className={'pg-des-delta ' + dir}><Seta dir={dir} /> era {taxaTexto(taxaAntes)} <small>nos {dias} dias antes</small></span>
  } else if (v && v.pct == null) {
    comparacao = <span className="pg-des-delta igual">nos {dias} dias antes, nenhum</span>
  } else if (v) {
    comparacao = <span className={'pg-des-delta ' + v.dir}><Seta dir={v.dir} /> {v.pct > 0 ? '+' : ''}{formatar(v.pct)}% <small>{legenda}</small></span>
  }
  return (
    <div className="pg-des-num" data-cor={cor}>
      <span className="pg-des-num-rotulo"><i className="pg-des-chave" aria-hidden="true" />{rotulo}</span>
      <strong>{valor}</strong>
      <span className="pg-des-num-sub">{sub}</span>
      {comparacao ?? <span className="pg-des-delta igual pg-des-sem">sem período anterior para comparar</span>}
      {pontos && <Tendencia pontos={pontos} rotulo={rotulo} unidade={unidade} formato={formato} hoje={hoje} />}
    </div>
  )
}

function Seta({ dir }) {
  const Ic = dir === 'sobe' ? TrendingUp : dir === 'desce' ? TrendingDown : Minus
  return <Ic size={14} aria-hidden="true" />
}

// a tendência (sparkline): a linha no SVG esticado (traço sem distorcer) e o
// ponto, o fio e a dica em HTML por cima, para ficarem redondos em qualquer largura.
// Começa no zero: uma subida pequena parece pequena. Vai até ontem (dias inteiros).
function Tendencia({ pontos, rotulo, unidade, formato = formatar, hoje }) {
  const [focoBruto, setFoco] = useState(null)
  const vals = pontos.map((p) => p.valor)
  const validos = vals.filter((x) => x != null)
  if (pontos.length < 2 || !validos.length) return <div className="pg-des-tend vazia" aria-hidden="true" />
  const max = Math.max(1e-9, ...validos)
  const A = 32
  const x = (i) => (i / (pontos.length - 1)) * 100
  const y = (val) => A - 3 - (val / max) * (A - 6)
  // um valor que falta (taxa num dia sem visita) quebra a linha em vez de cair a zero
  let d = '', area = '', ini = null
  vals.forEach((val, i) => {
    if (val == null) { if (ini != null) area += `L${x(i - 1)},${A}L${x(ini)},${A}Z`; ini = null; return }
    d += `${ini == null ? 'M' : 'L'}${x(i)},${y(val)}`
    area += `${ini == null ? 'M' : 'L'}${x(i)},${y(val)}`
    if (ini == null) ini = i
  })
  if (ini != null) area += `L${x(vals.length - 1)},${A}L${x(ini)},${A}Z`
  const ultimo = vals.findLastIndex((val) => val != null)
  // o ponto em foco só vale se ainda existe na série: o período pode mudar com o ponteiro parado em cima
  const foco = focoBruto != null && focoBruto < pontos.length ? focoBruto : null
  const i = foco ?? ultimo
  const p = pontos[i]
  const qual = (val) => (val == null ? 'sem visita' : unidade ? `${formatar(val)} ${val === 1 ? unidade[0] : unidade[1]}` : formato(val))
  const mover = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setFoco(Math.max(0, Math.min(pontos.length - 1, Math.round(((e.clientX - r.left) / r.width) * (pontos.length - 1)))))
  }
  return (
    <div className="pg-des-tend" onPointerMove={mover} onPointerLeave={() => setFoco(null)}
      role="img" aria-label={`${rotulo}: tendência do período até ontem, de ${qual(vals[0])} no começo a ${qual(vals[ultimo])} no fim`}>
      <svg viewBox={`0 0 100 ${A}`} preserveAspectRatio="none" aria-hidden="true">
        <path className="pg-des-tend-area" d={area} />
        <path className="pg-des-tend-linha" d={d} vectorEffect="non-scaling-stroke" />
      </svg>
      {foco != null && <span className="pg-des-tend-fio" style={{ left: `${x(i)}%` }} />}
      {p.valor != null && <span className="pg-des-tend-ponto" style={{ left: `${x(i)}%`, top: `${(y(p.valor) / A) * 100}%` }} />}
      {foco != null && (
        <span className="pg-des-tend-dica" style={{ left: `${Math.min(80, Math.max(20, x(i)))}%` }}>
          <b>{qual(p.valor)}</b> <small>{periodoCurto(p, hoje)}</small>
        </span>
      )}
    </div>
  )
}
