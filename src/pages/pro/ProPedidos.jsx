import { useCallback, useEffect, useState } from 'react'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import FilaEspera from '../../components/FilaEspera'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Pedidos pendentes (tela 16): duas abas — o que espera o seu sim, e
// quem está na fila de espera. Cada pedido mostra quanto tempo falta
// para o prazo vencer, porque passado o prazo o sistema decide sozinho
// do jeito que ela configurou embaixo.

function prazo(min) {
  if (min == null) return ''
  if (min <= 0) return 'vencendo'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

export default function ProPedidos() {
  const { professional } = useAuth()
  const [aba, setAba] = useState('pendentes')
  const [pedidos, setPedidos] = useState([])
  const [cfg, setCfg] = useState(null)
  const [respondendo, setRespondendo] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(true)
  const profId = professional?.id

  const buscar = useCallback(async () => {
    if (!profId) return
    const [lista, conf] = await Promise.all([
      supabase.rpc('meus_pedidos'),
      supabase.from('professionals').select('aceite_manual, minutos_para_aceitar, ao_expirar').eq('id', profId).maybeSingle(),
    ])
    if (lista.error) setErro(lista.error.message)
    else { setPedidos(lista.data ?? []); setCfg(conf.data ?? null); setErro('') }
    setLoading(false)
  }, [profId])
  useEffect(() => { buscar() }, [buscar])

  if (!professional) return <SemFicha />

  async function responder(id, aceitou) {
    setRespondendo(id)
    const { error } = await supabase.rpc('responder_pedido', { appt: id, aceitou })
    if (error) setErro(error.message)
    else await buscar()
    setRespondendo('')
  }

  async function salvar(mudanca) {
    const { error } = await supabase.from('professionals').update(mudanca).eq('id', profId)
    if (error) setErro(error.message)
    else setCfg((c) => ({ ...c, ...mudanca }))
  }

  return (
    <ProShell titulo="Pedidos pendentes" voltar="/pro/agenda">
      <div className="abas">
        <button className={aba === 'pendentes' ? 'aba active' : 'aba'} onClick={() => setAba('pendentes')}>Pendentes{pedidos.length ? ` (${pedidos.length})` : ''}</button>
        <button className={aba === 'fila' ? 'aba active' : 'aba'} onClick={() => setAba('fila')}>Fila de espera</button>
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}

      {aba === 'fila' && <FilaEspera professionalId={profId} />}

      {aba === 'pendentes' && (loading ? <p className="muted">Carregando…</p> : pedidos.length === 0 ? (
        <div className="card empty-state"><p>Nenhum pedido esperando você.</p><p className="muted">Quando uma cliente marcar, aparece aqui e no seu WhatsApp.</p></div>
      ) : (
        <div className="cliente-list">
          {pedidos.map((p) => (
            <div key={p.appointment_id} className="card pedido-card">
              <div className="pedido-topo">
                <strong>{p.cliente}</strong>
                <span className={'pedido-prazo' + (p.faltam_min != null && p.faltam_min < 30 ? ' urgente' : '')}>⏱ {prazo(p.faltam_min)}</span>
              </div>
              <span className="pedido-servico">{p.servico}</span>
              <span className="muted">{p.quando}</span>
              <div className="pedido-acoes">
                <button className="btn btn-ghost" disabled={respondendo === p.appointment_id} onClick={() => responder(p.appointment_id, false)}>Recusar</button>
                <button className="btn btn-primary" disabled={respondendo === p.appointment_id} onClick={() => responder(p.appointment_id, true)}>Aceitar</button>
              </div>
            </div>
          ))}
        </div>
      ))}

      {aba === 'pendentes' && cfg && (
        <>
          <h3 className="secao-titulo">Como você aprova</h3>
          <div className="card cl-ajuste">
            <div className="cliente-info">
              <span className="cliente-nome"><span className="nome-txt">Pedir minha confirmação</span></span>
              <span className="muted cliente-meta">Desligado, todo horário entra confirmado direto</span>
            </div>
            <button className={'switch' + (cfg.aceite_manual ? ' on' : '')} role="switch" aria-checked={cfg.aceite_manual} onClick={() => salvar({ aceite_manual: !cfg.aceite_manual })} aria-label="Pedir minha confirmação" />
          </div>
          {cfg.aceite_manual && (
            <div className="card">
              <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>Tempo limite para responder</p>
              <div className="filtro-chips">
                {[30, 60, 120, 240, 480].map((m) => (
                  <button key={m} className={cfg.minutos_para_aceitar === m ? 'chip active' : 'chip'} onClick={() => salvar({ minutos_para_aceitar: m })}>{prazo(m)}</button>
                ))}
              </div>
              <p className="muted" style={{ margin: '0.9rem 0 0.5rem', fontSize: '0.85rem' }}>Se o tempo passar</p>
              <div className="filtro-chips">
                <button className={cfg.ao_expirar === 'confirma' ? 'chip active' : 'chip'} onClick={() => salvar({ ao_expirar: 'confirma' })}>confirmar sozinho</button>
                <button className={cfg.ao_expirar === 'cancela' ? 'chip active' : 'chip'} onClick={() => salvar({ ao_expirar: 'cancela' })}>cancelar</button>
              </div>
            </div>
          )}
        </>
      )}
    </ProShell>
  )
}
