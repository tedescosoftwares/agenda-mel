import { Filter } from 'lucide-react'
import { Painel } from '../../Pecas'
import { n0, formatar, taxa, taxaTexto, contataramDe, deCada100 } from '../../../../lib/guiaMetricas'

// O caminho do período (3.12): visitou -> tentou contato -> pediu horário
// pelo app. Todas as barras saem do mesmo ponto e medem contra quem
// visitou, e cada etapa diz quanto é "de quem visitou" (o pedido é o
// formulário; quem pede nem sempre tocou antes em outro contato, então a
// conta é sempre contra o começo, não contra a etapa de cima).

export default function Funil({ dados }) {
  const pessoas = n0(dados.visitantes)
  const contato = contataramDe(dados.contataram, pessoas)
  const pedidos = n0(dados.interesses?.quero_marcar)
  const etapas = [
    { cor: 'visita', rotulo: 'Visitaram', n: pessoas, unidade: ['pessoa', 'pessoas'] },
    { cor: 'contato', rotulo: 'Tentaram contato', n: contato, unidade: ['pessoa', 'pessoas'] },
    { cor: 'pedido', rotulo: 'Pediram horário pelo app', n: pedidos, unidade: ['pedido', 'pedidos'] },
  ]
  const c100 = deCada100(contato, pessoas)
  const sub = !pessoas ? 'Aparece quando alguém abrir as páginas.'
    : `De cada 100 pessoas que visitaram, ${c100} ${c100 === '1' || c100 === 'menos de 1' ? 'tentou' : 'tentaram'} falar com o salão.`
  return (
    <Painel Icon={Filter} className="pg-des-funil-painel" titulo="Do clique ao pedido" sub={sub}>
      <ol className="pg-des-funil">
        {etapas.map((e, i) => {
          const largura = pessoas ? Math.min(100, (e.n / pessoas) * 100) : 0
          return (
            <li key={e.cor} data-cor={e.cor}>
              <div className="pg-des-funil-topo">
                <span>{e.rotulo}</span>
                <span><b>{formatar(e.n)}</b> <small>{e.n === 1 ? e.unidade[0] : e.unidade[1]}</small></span>
              </div>
              <span className="pg-des-funil-trilho"><i style={{ width: e.n > 0 ? `max(3px, ${largura}%)` : 0 }} /></span>
              {i > 0 && <small className="pg-des-funil-pct">{pessoas ? `${taxaTexto(taxa(e.n, pessoas))} de quem visitou` : '–'}</small>}
            </li>
          )
        })}
      </ol>
      <p className="pg-des-nota">Pessoas contam uma vez por dia. O pedido é o formulário "Quero marcar aqui pelo app" enviado.</p>
    </Painel>
  )
}
