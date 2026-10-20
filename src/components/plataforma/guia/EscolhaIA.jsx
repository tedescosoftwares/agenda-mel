import { IAS } from '../../../lib/guiaIa'

// Qual IA escreve (3.27): Gemini, Groq ou Claude (3.31), lado a lado. A escolha vale para a próxima geração (página
// da cidade, categoria ou salão) e fica lembrada no aparelho. O modelo que escreveu fica gravado no texto.
export default function EscolhaIA({ g, compacta = false }) {
  return (
    <div className={'pg-seg pg-ia' + (compacta ? ' pg-ia-compacta' : '')} role="radiogroup" aria-label="Qual IA escreve" title="Qual IA escreve o texto. O modelo usado fica gravado no texto gerado." data-teste="ia">
      {IAS.map(([id, nome]) => (
        <button key={id} type="button" role="radio" aria-checked={g.ia === id} className={g.ia === id ? 'ativo' : ''} onClick={() => g.setIa(id)}>{nome}</button>
      ))}
    </div>
  )
}
