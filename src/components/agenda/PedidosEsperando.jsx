import { useCallback, useEffect, useState } from 'react'
import { Bell, X, Check, Ban } from 'lucide-react'
import Portal from '../Portal'
import { supabase } from '../../lib/supabase'
import { useDialogo } from '../../context/DialogoContext'
import { decidirPedido } from '../../lib/acoesDoHorario'
import { formatPreco } from '../../lib/format'

// 4.0: a faixa do topo da Agenda: os pedidos de horário (de hoje em diante) que esperam a casa confirmar, com
// "Ver e confirmar" (a lista com Confirmar e Recusar em cada um). Sem pedido, a faixa nem aparece.
const isoHoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const somar = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function quando(p) {
  const h = String(p.start_time).slice(0, 5)
  const hoje = isoHoje()
  if (p.date === hoje) return `às ${h}`
  if (p.date === somar(hoje, 1)) return `amanhã às ${h}`
  const d = new Date(p.date + 'T12:00:00')
  return `${d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' }).replace('.', '')} às ${h}`
}
const nome = (p) => p.profiles?.full_name || p.guest_name || 'Cliente'
const primeiro = (n) => String(n ?? '').split(' ')[0]

export default function PedidosEsperando({ salaoId, recarga = 0, onMudou, compacto = false }) {
  const { confirmar } = useDialogo()
  const [lista, setLista] = useState([])
  const [aberta, setAberta] = useState(false)
  const [indo, setIndo] = useState(null)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    if (!salaoId) return
    const { data } = await supabase
      .from('appointments')
      .select('id, date, start_time, end_time, status, client_id, guest_name, remarca_de, professional_id, service_name, price_cents, profiles (full_name, phone), services (name, price), professionals (name)')
      .eq('salon_id', salaoId).eq('status', 'pendente').gte('date', isoHoje())
      .order('date').order('start_time').limit(30)
    setLista((data ?? []).filter((p) => p.status === 'pendente'))
  }, [salaoId])
  useEffect(() => { carregar() }, [carregar, recarga])

  async function decidir(p, aceitou) {
    setIndo(p.id); setErro('')
    const r = await decidirPedido(p, aceitou, confirmar)
    setIndo(null)
    if (!r.ok) { if (r.erro) setErro(r.erro); return }
    await carregar()
    onMudou?.()
  }

  if (!lista.length) return null
  const resumo = lista.slice(0, 2).map((p) => `${nome(p)} ${quando(p)} com ${primeiro(p.professionals?.name)}`).join(' · ') + (lista.length > 2 ? ` · e mais ${lista.length - 2}` : '')
  return (
    <>
      <div className={'ags-pedidos' + (compacto ? ' compacto' : '')} role="status">
        <Bell size={18} aria-hidden="true" />
        <span>{compacto
          ? <><b>{lista.length} {lista.length === 1 ? 'pedido' : 'pedidos'}</b> esperando você</>
          : <><b>{lista.length} {lista.length === 1 ? 'pedido esperando' : 'pedidos esperando'} você:</b> {resumo}</>}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAberta(true)}>{compacto ? 'Ver' : 'Ver e confirmar'}</button>
      </div>
      {aberta && (
        <Portal><div className="modal-fundo" onClick={() => setAberta(false)}>
          <div className="modal-caixa ags-pedidos-lista" role="dialog" aria-modal="true" aria-labelledby="ags-pedidos-t" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-fechar" onClick={() => setAberta(false)} aria-label="Fechar"><X size={18} /></button>
            <h3 id="ags-pedidos-t">Pedidos esperando você</h3>
            <p className="muted">Quem marcou espera a resposta do salão. Confirmado ou recusado, ela é avisada na hora.</p>
            {erro && <div className="alert alert-error">{erro}</div>}
            <ul>
              {lista.map((p) => (
                <li key={p.id}>
                  <div>
                    <strong>{nome(p)}</strong>
                    <small>{p.remarca_de ? 'Pediu para trocar · ' : ''}{p.service_name || p.services?.name} · {quando(p)} · {primeiro(p.professionals?.name)}{p.price_cents != null ? ` · ${formatPreco(p.price_cents / 100)}` : ''}</small>
                  </div>
                  <span className="ags-pedidos-botoes">
                    <button type="button" className="btn-mini btn-mini-ok" disabled={indo === p.id} onClick={() => decidir(p, true)}><Check size={14} /> Confirmar</button>
                    <button type="button" className="btn-mini btn-mini-nao" disabled={indo === p.id} onClick={() => decidir(p, false)}><Ban size={14} /> Recusar</button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div></Portal>
      )}
    </>
  )
}
