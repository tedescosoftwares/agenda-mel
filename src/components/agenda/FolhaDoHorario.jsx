import { useEffect, useState } from 'react'
import { Check, Ban, UserX, CalendarClock, MessageCircle, X, RotateCcw } from 'lucide-react'
import Portal from '../Portal'
import { useDialogo } from '../../context/DialogoContext'
import { formatPreco } from '../../lib/format'
import { concluirHorario, marcarFalta, cancelarHorario, decidirPedido, perdoarFalta, jaComecou, passouDaTolerancia, ativo, zapDaCliente } from '../../lib/acoesDoHorario'
import { corDa, primeiroNome, iniciais } from './agendaComum'

// 4.0: as ações de um horário numa folha: sobe de baixo no celular (lista) e fica no meio da tela no computador
// (a semana de uma profissional). O horário vem no formato da pdv_dia (cliente, servico, profissional, telefone).
const valor = (a) => (a.price_cents != null ? formatPreco(a.price_cents / 100).replace(',00', '') : '')

export default function FolhaDoHorario({ a, dia, profs, onFechar, onRemarcar, onMudou }) {
  const { confirmar } = useDialogo()
  const [indo, setIndo] = useState(false)
  const [erro, setErro] = useState('')
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 60000); return () => clearInterval(t) }, [])
  useEffect(() => { const esc = (e) => { if (e.key === 'Escape') onFechar() }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc) }, [onFechar])
  const d = dia ?? a.date

  async function agir(fn) {
    setIndo(true); setErro('')
    const r = await fn()
    setIndo(false)
    if (!r.ok) { if (r.erro) setErro(r.erro); return }
    onFechar()
    onMudou?.()
  }

  const c = corDa(profs, a.professional_id)
  const visitas = typeof a.atendimentos === 'number' ? (a.atendimentos === 0 ? 'Primeira vez na casa' : `${a.atendimentos + 1}ª visita`) : ''
  const faltas = a.faltas > 0 ? `${a.faltas} ${a.faltas === 1 ? 'falta' : 'faltas'}` : ''
  return (
    <Portal><div className="ags-folha-fundo" onClick={onFechar}>
      <div className="ags-folha" role="dialog" aria-modal="true" aria-labelledby="ags-folha-t" onClick={(e) => e.stopPropagation()}>
        <span className="ags-folha-pega" aria-hidden="true" />
        <div className="ags-folha-cab">
          <span className="ags-av" style={{ background: c.veu, color: c.cor }}>{iniciais(a.cliente)}</span>
          <div><b id="ags-folha-t">{a.cliente}</b><small>{a.servico} · {a.start_time.slice(0, 5)}–{a.end_time.slice(0, 5)} · {primeiroNome(a.profissional)}{valor(a) ? ` · ${valor(a)}` : ''}</small>
            {a.client_id ? ((visitas || faltas) && <small>{[visitas, faltas].filter(Boolean).join(' · ')}</small>) : <small>Cliente avulsa, sem conta</small>}
          </div>
          <button type="button" className="ags-folha-x" onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        </div>
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className="ags-folha-acoes">
          {a.status === 'pendente' && <>
            <button type="button" className="ags-acao ok" disabled={indo} onClick={() => agir(() => decidirPedido(a, true, confirmar))}><Check size={18} /> Confirmar pedido</button>
            <button type="button" className="ags-acao nao" disabled={indo} onClick={() => agir(() => decidirPedido(a, false, confirmar))}><Ban size={18} /> Recusar</button>
          </>}
          {a.status === 'confirmado' && jaComecou(a, d, agora) && <button type="button" className="ags-acao ok" disabled={indo} onClick={() => agir(() => concluirHorario(a, confirmar))}><Check size={18} /> Concluir atendimento</button>}
          {a.status === 'confirmado' && passouDaTolerancia(a, d, 15, agora) && <button type="button" className="ags-acao" disabled={indo} onClick={() => agir(() => marcarFalta(a, confirmar))}><UserX size={18} /> Não veio</button>}
          {a.status === 'faltou' && <button type="button" className="ags-acao" disabled={indo} onClick={() => agir(() => perdoarFalta(a))}><RotateCcw size={18} /> Perdoar a falta</button>}
          {ativo(a) && !a.comanda_id && <button type="button" className="ags-acao" disabled={indo} onClick={() => { onFechar(); onRemarcar(a) }}><CalendarClock size={18} /> Remarcar</button>}
          {zapDaCliente(a) && <a className="ags-acao" href={zapDaCliente(a)} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} /> Mandar WhatsApp</a>}
          {a.status === 'confirmado' && !a.comanda_id && <button type="button" className="ags-acao nao" disabled={indo} onClick={() => agir(() => cancelarHorario(a, confirmar))}><X size={18} /> Cancelar horário</button>}
          {a.status === 'concluido' && <p className="muted ags-folha-nota">Atendimento concluído{a.comanda_id ? ', com a comanda fechada' : ''}.</p>}
        </div>
      </div>
    </div></Portal>
  )
}
