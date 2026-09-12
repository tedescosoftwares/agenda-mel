// A ficha de confiabilidade (076): atendimentos, faltas, cancelamentos
// e remarcações de uma cliente. Só aparece para quem atende e para a
// plataforma; a cliente nunca vê. Zero em tudo = uma linha discreta.
export default function FichaCliente({ atendimentos = 0, faltas = 0, cancelamentos = 0, tardios = 0, remarcacoes = 0, compacta = false, outras, comVoce = false, modo = 'chips' }) {
  const itens = [
    { n: atendimentos, um: 'atendimento', varios: 'atendimentos', tom: 'ok' },
    { n: faltas, um: 'falta', varios: 'faltas', tom: faltas > 0 ? 'ruim' : 'neutro' },
    { n: cancelamentos, um: 'cancelamento', varios: 'cancelamentos', tom: cancelamentos > 0 ? 'atencao' : 'neutro' },
    { n: tardios, um: 'em cima da hora', varios: 'em cima da hora', tom: 'ruim', soSeTem: true },
    { n: remarcacoes, um: 'remarcação', varios: 'remarcações', tom: 'neutro' },
  ]
  const mostrar = itens.filter((i) => (compacta || i.soSeTem) ? i.n > 0 : true)
  // outras === undefined: quem chamou não tem a segunda camada; null: menos de 3 horários com outras
  const segunda = outras === undefined ? null : outras
    ? `Com outras profissionais: faltou em ${outras.faltas_pct}% · cancelou ${outras.cancelamentos_pct}% · remarcou ${outras.remarcacoes_pct}%`
    : 'Sem histórico com outras profissionais'
  if (modo === 'linha') {
    return (
      <span className="ficha-bloco ficha-modo-linha">
        <span className="ficha-linha">
          <span className="ficha-linha-rotulo muted">com você</span>
          {mostrar.length === 0 ? <span className="muted">primeira vez</span> : mostrar.map((i, k) => (
            <span key={i.um} className={'fl ' + i.tom}>{k > 0 && <i className="fl-sep" />}<strong>{i.n}</strong> {i.n === 1 ? i.um : i.varios}</span>
          ))}
        </span>
        {segunda && <span className={'ficha-linha ficha-linha-outras' + (outras && (outras.faltas_pct >= 20 || outras.cancelamentos_pct >= 30) ? ' atencao' : '')}>
          <span className="ficha-linha-rotulo muted">com outras</span>
          {outras ? <><span className="fl"><strong>{outras.faltas_pct}%</strong> faltas</span><span className="fl"><i className="fl-sep" /><strong>{outras.cancelamentos_pct}%</strong> cancel.</span><span className="fl"><i className="fl-sep" /><strong>{outras.remarcacoes_pct}%</strong> remarc.</span></> : <span className="muted">sem histórico</span>}
        </span>}
      </span>
    )
  }
  return (
    <span className="ficha-bloco">
      {mostrar.length === 0
        ? <span className="ficha ficha-vazia muted">{comVoce || outras !== undefined ? 'primeira vez com você' : 'sem histórico'}</span>
        : <span className="ficha" aria-label="Ficha da cliente">
            {(comVoce || outras !== undefined) && <span className="ficha-rotulo muted">com você:</span>}
            {mostrar.map((i) => (
              <span key={i.um} className={'ficha-item ' + i.tom}>{i.n} {i.n === 1 ? i.um : i.varios}</span>
            ))}
          </span>}
      {segunda && <span className={'ficha-outras muted' + (outras && (outras.faltas_pct >= 20 || outras.cancelamentos_pct >= 30) ? ' atencao' : '')}>{segunda}</span>}
    </span>
  )
}
