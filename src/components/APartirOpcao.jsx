import { formatPreco } from '../lib/format'

// 3.80: o "a partir de" no cadastro do serviço. Para o que varia com o tipo, o tamanho ou o volume do cabelo
// (progressiva, coloração, mechas, alongamento…): a cliente vê "a partir de R$ X" na vitrine, na marcação e no
// WhatsApp, e o valor final se acerta no salão (a comanda deixa mudar o preço do item).
export default function APartirOpcao({ ligado, onMudar, preco = null, compacto = false }) {
  return (
    <label className={'a-partir-opcao' + (ligado ? ' ligado' : '') + (compacto ? ' compacto' : '')}>
      <input type="checkbox" className="a-partir-caixa" checked={Boolean(ligado)} onChange={(e) => onMudar(e.target.checked)} />
      <span className="a-partir-opcao-texto">
        <strong>Preço “a partir de”{ligado && Number(preco) > 0 ? <em> · a cliente vê a partir de {formatPreco(Number(preco))}</em> : null}</strong>
        {!compacto && <small>Para o que varia com o tipo, o tamanho ou o volume do cabelo. O valor final você acerta no salão.</small>}
      </span>
    </label>
  )
}
