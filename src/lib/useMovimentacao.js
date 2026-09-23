import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { tocar } from './som'

// A movimentação ao vivo do salão (106): ouve os horários, os pagamentos
// e os avisos da dona pelo Realtime e transforma cada mudança num evento
// legível, com o som certo. Serve ao PDV, mas é genérico.
//   evento = { id, tipo, titulo, texto, quando, appointment_id, som }
const ROTULO_STATUS = { pendente: 'pediu horário', confirmado: 'confirmado', cancelado: 'cancelado', concluido: 'concluído', faltou: 'não veio', aguardando_pagamento: 'aguardando o PIX' }
const DEMO = import.meta.env.VITE_DEMO === '1'

export function useMovimentacao({ salaoId, userId, ligado = true, som = true, onEvento }) {
  const [eventos, setEventos] = useState([])
  const [naoVistos, setNaoVistos] = useState(0)
  const vistos = useRef(new Map())       // chave → quando, para não repetir
  const cb = useRef(onEvento); cb.current = onEvento
  const somRef = useRef(som); somRef.current = som

  const emitir = useCallback((ev) => {
    const chave = ev.chave ?? ev.id
    const agora = Date.now()
    const antes = vistos.current.get(chave)
    if (antes && agora - antes < 8000) return
    vistos.current.set(chave, agora)
    if (vistos.current.size > 300) vistos.current.delete(vistos.current.keys().next().value)
    const pronto = { ...ev, quando: ev.quando ?? new Date().toISOString() }
    setEventos((l) => [pronto, ...l].slice(0, 60))
    setNaoVistos((n) => n + 1)
    if (somRef.current && pronto.som) tocar(pronto.som)
    cb.current?.(pronto)
  }, [])

  // detalhes de um horário, para a frase ter nome, serviço e hora
  const descrever = useCallback(async (id) => {
    const { data } = await supabase.from('appointments')
      .select('id, date, start_time, status, service_name, guest_name, pago_cents, price_cents, profiles (full_name), professionals (name), services (name)')
      .eq('id', id).maybeSingle()
    if (!data) return null
    const dt = new Date(data.date + 'T12:00:00')
    const hoje = new Date(); const ehHoje = dt.toDateString() === hoje.toDateString()
    return {
      cliente: data.profiles?.full_name ?? data.guest_name ?? 'Cliente',
      servico: data.service_name ?? data.services?.name ?? 'atendimento',
      profissional: data.professionals?.name?.split(' ')[0] ?? '',
      quando: `${ehHoje ? 'hoje' : dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${String(data.start_time).slice(0, 5)}`,
      status: data.status, pago: data.pago_cents ?? 0, preco: data.price_cents ?? 0,
    }
  }, [])

  useEffect(() => {
    if (!ligado || !salaoId || !userId) return
    if (DEMO) {
      const t1 = setTimeout(() => emitir({ id: 'd1', tipo: 'novo', titulo: 'Novo horário', texto: 'Beatriz Costa marcou Spa dos pés com Fernanda, hoje às 14:00.', som: 'novo' }), 1200)
      const t2 = setTimeout(() => emitir({ id: 'd2', tipo: 'pago', titulo: 'PIX caiu', texto: 'Carla Mendes pagou R$ 30,00 de sinal de Escova, hoje às 10:30.', som: 'dinheiro' }), 2400)
      const t3 = setTimeout(() => emitir({ id: 'd3', tipo: 'avaliacao', titulo: 'Nova avaliação ★★★★★', texto: 'Juliana Silva avaliou a Escova com Ana: “Amei, saiu perfeita!”', som: 'estrela' }), 3800)
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
    }
    const canal = supabase.channel(`pdv-${salaoId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'appointments', filter: `salon_id=eq.${salaoId}` }, async (p) => {
        const a = p.new; if (!a) return
        const d = await descrever(a.id); if (!d) return
        if (a.status === 'cancelado') return
        const encaixe = Boolean(a.guest_name) || a.status === 'confirmado'
        emitir({ id: `novo-${a.id}`, chave: `novo-${a.id}`, tipo: 'novo', appointment_id: a.id, som: 'novo',
          titulo: a.remarca_de ? 'Remarcação' : a.status === 'pendente' ? 'Pedido de horário' : 'Novo horário',
          texto: `${d.cliente} · ${d.servico}${d.profissional ? ` com ${d.profissional}` : ''}, ${d.quando}${encaixe && !a.remarca_de ? ' (encaixe)' : ''}.` })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'appointments', filter: `salon_id=eq.${salaoId}` }, async (p) => {
        const a = p.new, o = p.old; if (!a) return
        const mudouStatus = o?.status && o.status !== a.status
        const mudouHora = o?.start_time && (o.start_time !== a.start_time || o.date !== a.date)
        if (!mudouStatus && !mudouHora) return
        if (mudouStatus && a.status === 'cancelado' && a.motivo_cancelamento === 'remarcado_pela_casa') return  // o novo horário já avisa
        const d = await descrever(a.id); if (!d) return
        if (mudouStatus) {
          const tipo = a.status === 'cancelado' ? 'cancelou' : a.status === 'faltou' ? 'faltou' : a.status === 'concluido' ? 'concluido' : 'status'
          if (a.status === 'concluido' && a.baixa_por === 'salao') return   // fechou aqui no balcão
          emitir({ id: `st-${a.id}-${a.status}`, chave: `st-${a.id}-${a.status}`, tipo, appointment_id: a.id, som: tipo === 'cancelou' || tipo === 'faltou' ? 'atencao' : 'novo',
            titulo: a.status === 'cancelado' ? `Cancelou${a.cancelado_por === 'cliente' ? ' (a cliente)' : a.cancelado_por === 'sistema' ? '' : ' (a casa)'}` : a.status === 'confirmado' ? 'Horário confirmado' : a.status === 'concluido' ? 'Atendimento concluído' : a.status === 'faltou' ? 'Não veio' : ROTULO_STATUS[a.status] ?? a.status,
            texto: `${d.cliente} · ${d.servico}${d.profissional ? ` com ${d.profissional}` : ''}, ${d.quando}.` })
        } else {
          emitir({ id: `hora-${a.id}-${a.start_time}`, chave: `hora-${a.id}-${a.start_time}`, tipo: 'remarcou', appointment_id: a.id, som: 'novo', titulo: 'Horário mudou',
            texto: `${d.cliente} · ${d.servico}${d.profissional ? ` com ${d.profissional}` : ''} agora é ${d.quando}.` })
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pagamentos', filter: `salon_id=eq.${salaoId}` }, async (p) => {
        const g = p.new, o = p.old; if (!g || !o || o.status === g.status) return
        if (g.status !== 'pago' && g.status !== 'estornado') return
        const d = g.appointment_id ? await descrever(g.appointment_id) : null
        const valor = (g.valor_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        emitir({ id: `pg-${g.id}-${g.status}`, chave: `pg-${g.id}-${g.status}`, tipo: g.status === 'pago' ? 'pago' : 'estorno', appointment_id: g.appointment_id, som: g.status === 'pago' ? 'dinheiro' : 'atencao',
          titulo: g.status === 'pago' ? 'PIX caiu' : 'Devolução feita',
          texto: d ? `${d.cliente} ${g.status === 'pago' ? 'pagou' : 'recebeu de volta'} ${valor}${g.sinal_pct && g.sinal_pct < 100 ? ' de sinal' : ''} de ${d.servico}, ${d.quando}.` : `${valor} ${g.status === 'pago' ? 'recebido' : 'devolvido'} pelo app.` })
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reviews', filter: `salon_id=eq.${salaoId}` }, async (p) => {
        const r = p.new; if (!r?.nota) return
        const d = r.appointment_id ? await descrever(r.appointment_id) : null
        const estrelas = '★'.repeat(r.nota) + '☆'.repeat(5 - r.nota)
        const fala = r.comentario ? ` “${String(r.comentario).trim().slice(0, 140)}${String(r.comentario).trim().length > 140 ? '…' : ''}”` : ''
        emitir({ id: `av-${r.id}`, chave: `av-${r.id}`, tipo: 'avaliacao', appointment_id: r.appointment_id, som: r.nota >= 4 ? 'estrela' : 'atencao',
          titulo: `Nova avaliação ${estrelas}`,
          texto: d ? `${d.cliente} avaliou ${d.servico}${d.profissional ? ` com ${d.profissional}` : ''}${fala ? ':' : '.'}${fala}` : `Uma cliente avaliou com ${r.nota} ${r.nota === 1 ? 'estrela' : 'estrelas'}.${fala}` })
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (p) => {
        const n = p.new; if (!n) return
        // os avisos que não nascem de horário nem de pagamento (WhatsApp, contrato, fila…)
        if (['novo_agendamento', 'pedido_de_aceite', 'cancelou_comigo', 'agendamento_pago', 'remarcacao_aceita', 'estorno_feito', 'agendamento_confirmado', 'agendamento_cancelado'].includes(n.kind)) return
        emitir({ id: `n-${n.id}`, chave: `n-${n.id}`, tipo: 'aviso', som: n.kind === 'atendimento_humano' || n.kind === 'pedido_pelo_whatsapp' ? 'atencao' : 'novo', titulo: n.title, texto: n.body ?? '' })
      })
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [ligado, salaoId, userId, emitir, descrever])

  const marcarVistos = useCallback(() => setNaoVistos(0), [])
  const limpar = useCallback(() => { setEventos([]); setNaoVistos(0) }, [])
  return { eventos, naoVistos, marcarVistos, limpar }
}
