import { Vazio } from '../../Pecas'
import { n0, formatar, taxa, taxaTexto } from '../../../../lib/guiaMetricas'

// Barras horizontais finas, uma cor só (cada lista é uma série só), com o
// número e a parte do total na ponta: o valor nunca depende do mouse.
export function Barras({ itens, total, cor = 'visita', vazio = 'Nada neste período.' }) {
  if (!itens.length) return <Vazio>{vazio}</Vazio>
  const max = Math.max(1, ...itens.map((i) => n0(i.n)))
  return (
    <ul className="pg-des-barras" data-cor={cor}>
      {itens.map((i) => (
        <li key={i.chave}>
          <span className="pg-des-barras-rotulo" title={i.rotulo}>{i.Icon && <i.Icon size={14} aria-hidden="true" />}{i.rotulo}</span>
          <span className="pg-des-barras-trilho"><i style={{ width: n0(i.n) > 0 ? `max(3px, ${(n0(i.n) / max) * 100}%)` : 0 }} /></span>
          <span className="pg-des-barras-n"><b>{formatar(i.n)}</b> <small>{taxaTexto(taxa(i.n, total))}</small></span>
        </li>
      ))}
    </ul>
  )
}

// uma barra só dividida em partes (celular x computador), com o rótulo de cada parte embaixo
export function Divisao({ partes, titulo }) {
  const total = partes.reduce((s, p) => s + n0(p.n), 0)
  if (!total) return null
  return (
    <div className="pg-des-divisao">
      <span className="pg-des-divisao-tit">{titulo}</span>
      <div className="pg-des-divisao-barra" role="img" aria-label={partes.map((p) => `${p.rotulo} ${taxaTexto(taxa(p.n, total))}`).join(', ')}>
        {partes.filter((p) => n0(p.n) > 0).map((p) => <i key={p.chave} data-cor={p.cor} style={{ flexGrow: n0(p.n) }} />)}
      </div>
      <ul className="pg-des-divisao-legenda">
        {partes.map((p) => (
          <li key={p.chave}><i data-cor={p.cor} aria-hidden="true" />{p.Icon && <p.Icon size={13} aria-hidden="true" />}{p.rotulo} <b>{taxaTexto(taxa(p.n, total))}</b> <small>{formatar(p.n)}</small></li>
        ))}
      </ul>
    </div>
  )
}
