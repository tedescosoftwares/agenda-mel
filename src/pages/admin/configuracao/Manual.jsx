import { Lock, HelpCircle, ArrowRight, Check, LayoutGrid, Sparkles, Users, Link2, ClipboardCheck } from 'lucide-react'
import Portal from '../../../components/Portal'

// O mini manual da configuração inicial (2.96): a ordem das etapas, o que
// cada uma precisa e o que libera. A mesma fonte alimenta as travas do
// stepper (dependenciasOk) e os avisos dentro das etapas (Trava).

export const PASSOS = [
  { id: 'categorias', rotulo: 'Categorias', Icone: LayoutGrid, titulo: 'O que você oferece', oque: 'Marque as áreas do seu espaço: cabelo, unhas, cílios… É o mapa de tudo que vem depois.', precisa: null, libera: 'as sugestões de serviço' },
  { id: 'servicos', rotulo: 'Serviços', Icone: Sparkles, titulo: 'Monte seu menu de serviços', oque: 'Adicione do catálogo com um toque ou crie o seu. Preço e duração ficam do seu jeito.', precisa: 'pelo menos uma categoria', libera: 'o “Quem faz o quê”', depende: ['categorias'] },
  { id: 'profissionais', rotulo: 'Profissionais', Icone: Users, titulo: 'Quem atende', oque: 'Cadastre quem trabalha com você. Nome e WhatsApp bastam; o resto dá para completar depois.', precisa: null, libera: 'o “Quem faz o quê”' },
  { id: 'vinculos', rotulo: 'Quem faz o quê', Icone: Link2, titulo: 'Ligue serviço a profissional', oque: 'Marque quem faz cada serviço. É assim que a MIMO sabe em qual agenda o atendimento pode entrar.', precisa: 'serviços e profissionais cadastrados', libera: 'a revisão sem bloqueios', depende: ['servicos', 'profissionais'] },
  { id: 'revisao', rotulo: 'Revisão', Icone: ClipboardCheck, titulo: 'Tudo pronto?', oque: 'Confira o resumo, resolva o que estiver bloqueando e conclua. Depois, faça um agendamento de teste pela agenda.', precisa: null, libera: 'seu salão na MIMO' },
]
export const PASSO_POR_ID = Object.fromEntries(PASSOS.map((p) => [p.id, p]))

// feitas: { categorias, servicos, profissionais, vinculos } vindas dos dados
export function dependenciasOk(id, feitas) {
  const p = PASSO_POR_ID[id]
  if (!p?.depende) return true
  return p.depende.every((d) => Boolean(feitas?.[d]))
}
export function oQueFalta(id, feitas, autonoma = false) {
  const p = PASSO_POR_ID[id]
  return (p?.depende ?? []).filter((d) => !feitas?.[d]).map((d) => (autonoma && d === 'profissionais' ? 'Sua agenda' : PASSO_POR_ID[d].rotulo))
}

// o cartão de etapa travada: por que não dá, e o botão que leva para resolver
export function Trava({ titulo, texto, acao, onAcao, onManual }) {
  return (
    <div className="cfg-trava" role="status">
      <span className="cfg-trava-icone"><Lock size={20} /></span>
      <div className="cfg-trava-txt">
        <strong>{titulo}</strong>
        <p>{texto}</p>
        <div className="cfg-trava-acoes">
          {acao && <button type="button" className="btn btn-primary" onClick={onAcao}>{acao} <ArrowRight size={15} /></button>}
          {onManual && <button type="button" className="btn btn-ghost" onClick={onManual}><HelpCircle size={15} /> Como funciona</button>}
        </div>
      </div>
    </div>
  )
}

// o manual em si, numa folha
export function ManualDaConfiguracao({ atual, feitas = {}, autonoma = false, onFechar, onIr }) {
  const passos = autonoma ? PASSOS.filter((p) => p.id !== 'vinculos').map((p) => (p.id === 'profissionais' ? { ...p, rotulo: 'Sua agenda', titulo: 'Sua agenda', oque: 'Você é quem atende: só confirmamos que todos os serviços entram na sua agenda.', libera: 'a revisão' } : p)) : PASSOS
  return (
    <Portal><div className="modal-fundo cfg-manual-fundo" onClick={onFechar}>
      <div className="cfg-manual" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Como funciona a configuração">
        <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">×</button>
        <header className="cfg-manual-topo">
          <span className="cfg-eyebrow">Mini manual</span>
          <h3>Como funciona a configuração</h3>
          <p>Cinco passos, nessa ordem, porque um alimenta o outro. Pode parar quando quiser: tudo fica salvo, e dá para ajustar depois no painel.</p>
        </header>
        <ol className="cfg-manual-lista">
          {passos.map((p, i) => {
            const feita = Boolean(feitas[p.id])
            const liberada = dependenciasOk(p.id, feitas)
            const falta = oQueFalta(p.id, feitas, autonoma)
            return (
              <li key={p.id} className={(p.id === atual ? 'atual' : '') + (feita ? ' feita' : '') + (!liberada ? ' travada' : '')}>
                <span className="cfg-manual-num">{feita ? <Check size={13} strokeWidth={3} /> : !liberada ? <Lock size={12} /> : i + 1}</span>
                <div className="cfg-manual-txt">
                  <strong><p.Icone size={15} /> {p.rotulo}{p.id === atual && <em>você está aqui</em>}</strong>
                  <p>{p.oque}</p>
                  <dl>
                    <div><dt>Precisa de</dt><dd>{p.precisa ?? 'nada, pode começar'}</dd></div>
                    <div><dt>Libera</dt><dd>{p.libera}</dd></div>
                  </dl>
                  {!liberada && <small className="cfg-manual-falta"><Lock size={11} /> Travada até terminar: {falta.join(' e ')}</small>}
                  {onIr && liberada && p.id !== atual && <button type="button" className="plat-link" onClick={() => { onIr(p.id); onFechar() }}>Ir para {p.rotulo} <ArrowRight size={12} /></button>}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div></Portal>
  )
}
