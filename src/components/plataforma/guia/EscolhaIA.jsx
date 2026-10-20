import { IAS, MODELOS } from '../../../lib/guiaIa'

// Qual IA escreve (3.27): Gemini, Groq ou Claude (3.31), lado a lado. A escolha vale para a próxima geração (página
// da cidade, categoria ou salão) e fica lembrada no aparelho. O modelo que escreveu fica gravado no texto.
// 3.34: o modelo também, por IA ("Modelo padrão" é o do segredo); o Haiku faz o serviço por uma fração do Opus
export default function EscolhaIA({ g, compacta = false }) {
  const opcoes = MODELOS[g.ia] ?? []
  return (
    <>
      <div className={'pg-seg pg-ia' + (compacta ? ' pg-ia-compacta' : '')} role="radiogroup" aria-label="Qual IA escreve" title="Qual IA escreve o texto. O modelo usado fica gravado no texto gerado." data-teste="ia">
        {IAS.map(([id, nome]) => (
          <button key={id} type="button" role="radio" aria-checked={g.ia === id} className={g.ia === id ? 'ativo' : ''} onClick={() => g.setIa(id)}>{nome}</button>
        ))}
      </div>
      <select className={'pg-ia-modelo' + (compacta ? ' pg-ia-modelo-compacta' : '')} value={g.modelo ?? ''} onChange={(e) => g.setModelo(g.ia, e.target.value)} aria-label="Qual modelo" title="Qual modelo dessa IA escreve. Modelo padrão é o configurado no segredo da função." data-teste="modelo">
        <option value="">Modelo padrão</option>
        {opcoes.map((m) => <option key={m.id} value={m.id}>{m.nome} · {m.nota}</option>)}
      </select>
    </>
  )
}
