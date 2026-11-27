import { MousePointerClick, Move, Plus } from 'lucide-react'
import { formatPreco } from '../../lib/format'
import { corDa } from './agendaComum'

// 4.1: o que deixa a Agenda menos seca: o resumo do período em cima e a legenda (o que cada estilo de cartão quer
// dizer, as cores da equipe e o que dá para fazer com o mouse) embaixo.

const reais = (c) => formatPreco(Number(c ?? 0) / 100).replace(',00', '')
const precoDe = (a) => (a.price_cents != null ? Number(a.price_cents) : Math.round(Number(a.services?.price ?? 0) * 100))

// o resumo: quantos horários, quanto está previsto, quantos já foram feitos e quantos esperam o salão
export function ResumoAgenda({ itens, titulo, extra = null }) {
  const vivos = (itens ?? []).filter((a) => a.status !== 'cancelado')
  const valendo = vivos.filter((a) => a.status !== 'faltou')
  const feitos = vivos.filter((a) => a.status === 'concluido').length
  const pend = vivos.filter((a) => a.status === 'pendente').length
  const faltas = vivos.filter((a) => a.status === 'faltou').length
  // 4.43: o que ainda não tem valor fica fora da soma e aparece contado (a combinar antes, sem valor depois de concluído)
  const semPreco = valendo.filter((a) => !(precoDe(a) > 0) && !a.comanda_id && !a.cortesia)
  const aCombinar = semPreco.filter((a) => a.status !== 'concluido').length, semValor = semPreco.length - aCombinar
  return (
    <div className="ags-resumo" aria-label={titulo}>
      <span className="ags-resumo-titulo">{titulo}</span>
      <span className="ags-resumo-item"><b>{vivos.length}</b> {vivos.length === 1 ? 'horário' : 'horários'}</span>
      <span className="ags-resumo-item"><b>{reais(valendo.reduce((t, a) => t + precoDe(a), 0))}</b> previstos</span>
      <span className="ags-resumo-item ok"><b>{feitos}</b> {feitos === 1 ? 'concluído' : 'concluídos'}</span>
      {aCombinar > 0 && <span className="ags-resumo-item"><b>{aCombinar}</b> a combinar</span>}
      {semValor > 0 && <span className="ags-resumo-item pend" title="Concluídos sem valor informado: abra o horário e toque em Informar o valor"><b>{semValor}</b> sem valor</span>}
      {pend > 0 && <span className="ags-resumo-item pend"><b>{pend}</b> a confirmar</span>}
      {faltas > 0 && <span className="ags-resumo-item falta"><b>{faltas}</b> não {faltas === 1 ? 'veio' : 'vieram'}</span>}
      {extra && <span className="ags-resumo-extra">{extra}</span>}
    </div>
  )
}

// a legenda: os estilos de cartão, as cores (equipe ou só ela) e as dicas de uso
export function LegendaAgenda({ profs = [], uma = null, dicas = 'semana' }) {
  const lista = uma ? [uma] : profs
  return (
    <div className="ags-legenda">
      <div className="ags-legenda-estilos">
        <span><i className="ags-amostra conf" /> Confirmado</span>
        <span><i className="ags-amostra pend" /> A confirmar</span>
        <span><i className="ags-amostra ok" /> Concluído</span>
        <span><i className="ags-amostra falta" /> Não veio</span>
        <span><i className="ags-amostra fora" /> {uma ? 'Almoço, folga ou fora do horário dela' : dicas === 'dia' ? 'Almoço, folga ou fora do horário' : 'Salão fechado'}</span>
      </div>
      {lista.length > 0 && dicas !== 'dia' && (
        <div className="ags-legenda-cores">
          {lista.map((p) => { const c = corDa(profs.length ? profs : lista, p.id); return <span key={p.id}><i style={{ background: c.cor }} />{p.name}</span> })}
        </div>
      )}
      <div className="ags-legenda-dicas">
        <span><MousePointerClick size={14} /> Clique num horário para ver tudo e agir</span>
        <span><Move size={14} /> {dicas === 'dia' ? 'Arraste para outra hora, outra profissional ou um dia da faixa de cima' : 'Arraste para outro dia ou hora para remarcar'}</span>
        <span><Plus size={14} /> Clique no vazio para encaixar</span>
      </div>
    </div>
  )
}
