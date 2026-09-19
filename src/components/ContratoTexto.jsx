// O contrato na tela (101), a partir dos mesmos blocos que vão para o
// PDF. Serve para a dona conferir antes de gerar e para a profissional
// ler antes de assinar.
export default function ContratoTexto({ blocos }) {
  if (!Array.isArray(blocos)) return null
  return (
    <article className="contrato">
      {blocos.map((b, i) => {
        if (b.t === 'titulo') return <h2 key={i} className="contrato-titulo">{b.x}</h2>
        if (b.t === 'sub') return <p key={i} className="muted contrato-sub">{b.x}</p>
        if (b.t === 'h') return <h3 key={i}>{b.x}</h3>
        if (b.t === 'p') return <p key={i}>{b.x}</p>
        if (b.t === 'lista') return <ul key={i}>{b.itens.map((x, k) => <li key={k}>{x}</li>)}</ul>
        if (b.t === 'nota') return <p key={i} className="muted contrato-nota">{b.x}</p>
        if (b.t === 'assinaturas') return (
          <div key={i} className="contrato-assinaturas">
            {b.partes.map((p, k) => <div key={k} className="contrato-assinatura"><span className="contrato-linha" /><small>{p.rotulo}</small><strong>{p.nome}</strong><span className="muted">{p.sub}</span></div>)}
          </div>
        )
        return null
      })}
    </article>
  )
}
