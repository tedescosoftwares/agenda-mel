import { formatPreco } from '../lib/format'
import { Lightbulb } from 'lucide-react'

// 3.80: o "a partir de" no cadastro do serviço. Para o que varia com o tipo, o tamanho ou o volume do cabelo
// (progressiva, coloração, mechas, alongamento…): a cliente vê "a partir de R$ X" na vitrine, na marcação e no
// WhatsApp, e o valor final se acerta no salão (a comanda deixa mudar o preço do item).
// 4.44: com o preço vazio, uma dica antes: sem preço a cliente vê "a combinar" e todo atendimento pede o valor ao
// concluir; se o serviço varia, o menor valor com "a partir de" dá referência à cliente e ao dia. Não obriga nada.
// `dica={false}` onde o preço é obrigatório e o campo ainda está vazio (a tela já cobra o preço; a dica é para o zero)
export default function APartirOpcao({ ligado, onMudar, preco = null, compacto = false, dica = true }) {
  const semPreco = dica && !(Number(preco) > 0)
  return (
    <>
      {semPreco && (
        <div className={'a-partir-dica' + (compacto ? ' compacto' : '')} role="note">
          <Lightbulb size={16} aria-hidden="true" />
          <span>
            {ligado
              ? <><strong>Falta o menor valor.</strong> Coloque no preço o mínimo que esse serviço custa: a cliente vê “a partir de” esse valor.</>
              : <><strong>Sem preço, a cliente vê “a combinar”</strong> e você informa o valor a cada atendimento.{!compacto && ' Se o serviço varia, coloque o menor valor e marque “a partir de”: ela já sabe a faixa antes de marcar, e você acerta o valor final ao concluir.'}</>}
            {!ligado && <button type="button" className="link-ver a-partir-dica-botao" onClick={() => onMudar(true)}>Usar “a partir de”</button>}
          </span>
        </div>
      )}
      <label className={'a-partir-opcao' + (ligado ? ' ligado' : '') + (compacto ? ' compacto' : '')}>
        <input type="checkbox" className="a-partir-caixa" checked={Boolean(ligado)} onChange={(e) => onMudar(e.target.checked)} />
        <span className="a-partir-opcao-texto">
          <strong>Preço “a partir de”{ligado && Number(preco) > 0 ? <em> · a cliente vê a partir de {formatPreco(Number(preco))}</em> : null}</strong>
          {!compacto && <small>Para o que varia com o tipo, o tamanho ou o volume do cabelo. O valor final você acerta no salão.</small>}
        </span>
      </label>
    </>
  )
}
