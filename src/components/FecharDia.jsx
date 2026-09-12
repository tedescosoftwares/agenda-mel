import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useDialogo } from '../context/DialogoContext'
import { formatDataLonga } from '../lib/booking'
import { toISODate } from '../lib/format'
import FichaCliente from './FichaCliente'
import { Check, UserX, CalendarClock, Hourglass, Repeat } from 'lucide-react'
import { iniciais } from '../lib/booking'

// Fechar o dia (077): o que terminou e espera baixa, um toque por
// cliente. Veio conclui; Não veio marca falta (ou, se ela tinha pedido
// troca sem resposta, cancela sem culpa dela); Remarcamos abre data e
// hora e move o horário sem contar duas vezes. O que concluiu sozinho
// nos últimos 3 dias aparece embaixo, para corrigir.
export default function FecharDia({ admin = false }) {
  const { confirmar } = useDialogo()
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')
  const [mexendo, setMexendo] = useState('')
  const [remarcando, setRemarcando] = useState(null)   // { id, data, hora }

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('pendencias_de_baixa')
    if (error) setErro(error.message)
    setLista(data ?? [])
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function baixa(p, resultado) {
    if (resultado === 'nao_veio') {
      const troca = p.troca
      const ok = await confirmar({
        titulo: troca ? 'Ela não veio, e tinha pedido troca' : `${primeiro(p.cliente)} não veio?`,
        texto: troca
          ? `Ela pediu para trocar para ${troca.quando} e ninguém respondeu a tempo. O horário será cancelado sem contar como falta dela; conta como pedido sem resposta.`
          : p.situacao === 'concluido_sozinho'
            ? 'Este atendimento concluiu sozinho. Marcar como falta desfaz isso e fica na ficha dela.'
            : 'Fica registrado na ficha dela, e ela recebe um aviso de ciência.',
        ok: troca ? 'Cancelar o horário' : 'Marcar falta', perigo: true,
      })
      if (!ok) return
    }
    setMexendo(p.appointment_id); setErro('')
    const { error } = await supabase.rpc('dar_baixa', { appt: p.appointment_id, resultado })
    setMexendo('')
    if (error) { setErro(error.message); return }
    carregar()
  }

  async function remarcar() {
    if (!remarcando?.data || !remarcando?.hora) return
    setMexendo(remarcando.id); setErro('')
    const { data, error } = await supabase.rpc('remarcar_por_fora', { appt: remarcando.id, nova_data: remarcando.data, nova_hora: remarcando.hora })
    setMexendo('')
    if (error) { setErro(error.message); return }
    if (data?.ok === false) { setErro(data.motivo === 'ocupado' ? 'Esse horário já está ocupado.' : 'Não deu para remarcar.'); return }
    setRemarcando(null)
    carregar()
  }

  const esperando = (lista ?? []).filter((p) => p.situacao === 'esperando')
  const sozinhos = (lista ?? []).filter((p) => p.situacao === 'concluido_sozinho')
  const porDia = agrupar(esperando)

  if (lista === null) return <p className="muted">Carregando…</p>
  return (
    <div className="fechar">
      {erro && <div className="alert alert-error">{erro}</div>}
      {esperando.length === 0 ? (
        <div className="card empty-state">
          <p>Nada esperando baixa.</p>
          <p className="muted">Cada horário que termina aparece aqui por 3 horas. O que você não responder conclui sozinho.</p>
        </div>
      ) : porDia.map(([dia, itens]) => (
        <section key={dia} className="fechar-dia">
          <div className="fechar-dia-cab"><h3>{rotuloDia(dia)}</h3><span className="fechar-dia-n">{itens.length} {itens.length === 1 ? 'atendimento' : 'atendimentos'}</span></div>
          {itens.map((p) => (
            <div key={p.appointment_id} className={'card fechar-item' + (p.troca ? ' troca' : '')}>
              <div className="fechar-cab">
                <span className="fechar-avatar">{iniciais(p.cliente)}</span>
                <div className="fechar-quem">
                  <strong>{p.cliente}</strong>
                  <span className="muted">{p.servico} · {p.inicio.slice(0, 5)}–{p.fim.slice(0, 5)}{admin ? ` · ${p.profissional}` : ''}</span>
                </div>
                {p.conclui_em && <span className="fechar-prazo" title="Sem resposta, conclui sozinho"><Hourglass size={12} /> até {new Date(p.conclui_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
              </div>
              {p.ficha && <FichaCliente modo="linha" atendimentos={p.ficha.comigo?.concluidos} faltas={p.ficha.comigo?.faltas} cancelamentos={p.ficha.comigo?.cancelamentos} tardios={p.ficha.comigo?.cancelamentos_tardios} remarcacoes={p.ficha.comigo?.remarcacoes} outras={p.ficha.outras} compacta />}
              {p.troca && <div className="fechar-aviso"><Repeat size={15} /><span>Ela pediu para trocar para <strong>{p.troca.quando}</strong> e ninguém respondeu. Depois do horário, a troca não vale mais: se ela não veio, o horário é cancelado sem falta para ela.</span></div>}
              {remarcando?.id === p.appointment_id ? (
                <div className="fechar-remarcar">
                  <label>Novo dia<input type="date" min={toISODate(new Date())} value={remarcando.data} onChange={(e) => setRemarcando({ ...remarcando, data: e.target.value })} /></label>
                  <label>Hora<input type="time" value={remarcando.hora} onChange={(e) => setRemarcando({ ...remarcando, hora: e.target.value })} /></label>
                  <button className="btn btn-primary" onClick={remarcar} disabled={mexendo === p.appointment_id || !remarcando.data || !remarcando.hora}>Remarcar</button>
                  <button className="btn btn-ghost" onClick={() => setRemarcando(null)}>Voltar</button>
                </div>
              ) : (
                <div className={'fechar-acoes' + (p.troca ? ' duas' : '')}>
                  <button className="fa fa-veio" disabled={mexendo === p.appointment_id} onClick={() => baixa(p, 'veio')}><Check size={20} /><span>Veio</span></button>
                  <button className="fa fa-nao" disabled={mexendo === p.appointment_id} onClick={() => baixa(p, 'nao_veio')}><UserX size={20} /><span>Não veio</span></button>
                  {!p.troca && <button className="fa fa-rem" disabled={mexendo === p.appointment_id} onClick={() => setRemarcando({ id: p.appointment_id, data: '', hora: p.inicio.slice(0, 5) })}><CalendarClock size={20} /><span>Remarcamos</span></button>}
                </div>
              )}
            </div>
          ))}
        </section>
      ))}

      {sozinhos.length > 0 && (
        <section className="fechar-dia fechar-sozinhos">
          <div className="fechar-dia-cab"><h3>Concluídos sozinhos</h3><span className="fechar-dia-n">3 dias para corrigir</span></div>
          <div className="card fechar-lista">
            {sozinhos.map((p) => (
              <div key={p.appointment_id} className="fechar-linha">
                <span className="fechar-avatar pequeno">{iniciais(p.cliente)}</span>
                <div className="fechar-quem">
                  <strong>{p.cliente}</strong>
                  <span className="muted">{p.servico} · {rotuloDia(p.dia)} {p.inicio.slice(0, 5)}{admin ? ` · ${p.profissional}` : ''}</span>
                </div>
                {p.pode_corrigir && <button className="btn-mini btn-mini-nao" disabled={mexendo === p.appointment_id} onClick={() => baixa(p, 'nao_veio')}>Não veio</button>}
              </div>
            ))}
          </div>
        </section>
      )}
      <p className="muted fechar-rodape">Falta e cancelamento em cima da hora ficam na ficha da cliente, que só você, o salão e a plataforma veem. <Link to={admin ? '/admin/agenda' : '/pro/agenda'}>Ver a agenda</Link></p>
    </div>
  )
}

function primeiro(nome) { return String(nome || 'Ela').split(' ')[0] }
function agrupar(itens) {
  const m = new Map()
  for (const p of itens) { if (!m.has(p.dia)) m.set(p.dia, []); m.get(p.dia).push(p) }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
}
function rotuloDia(iso) {
  const hoje = toISODate(new Date())
  if (iso === hoje) return 'Hoje'
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1)
  if (iso === toISODate(ontem)) return 'Ontem'
  return formatDataLonga(iso)
}
