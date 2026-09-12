import { useCallback, useEffect, useState } from 'react'
import { Star, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatDataCurta } from '../lib/booking'
import AvaliarModal from './AvaliarModal'

// Atendimento concluído sem avaliação: a cliente não precisa ir ao
// histórico. Na primeira abertura do app sobe a folha de avaliar; se
// ela disser "depois", fica um cartão no alto de toda tela, que só
// some quando ela avaliar. Um por vez, o mais recente primeiro; olha
// só os últimos 45 dias, para não cobrar coisa velha.
const CHAVE_SESSAO = 'mimo-avaliar-depois'
export default function AvaliarConvite() {
  const { user } = useAuth()
  const [pendente, setPendente] = useState(null)
  const [aberto, setAberto] = useState(false)

  const buscar = useCallback(async () => {
    const desde = new Date(Date.now() - 45 * 86400e3).toISOString().slice(0, 10)
    const { data: feitos } = await supabase.from('appointments')
      .select('id, date, professional_id, service_id, services (name), professionals (id, name, photo_url)')
      .eq('client_id', user.id).eq('status', 'concluido').gte('date', desde)
      .order('date', { ascending: false }).order('start_time', { ascending: false }).limit(10)
    if (!feitos?.length) { setPendente(null); return }
    const { data: notas } = await supabase.from('reviews').select('appointment_id').in('appointment_id', feitos.map((a) => a.id))
    const ja = new Set((notas ?? []).map((r) => r.appointment_id))
    const falta = feitos.find((a) => !ja.has(a.id) && a.professionals) ?? null
    setPendente(falta)
    let adiado = false
    try { adiado = sessionStorage.getItem(CHAVE_SESSAO) === falta?.id } catch { /* sem storage */ }
    if (falta && !adiado) setAberto(true)
  }, [user.id])
  useEffect(() => { buscar() }, [buscar])

  if (!pendente) return null
  function depois() {
    try { sessionStorage.setItem(CHAVE_SESSAO, pendente.id) } catch { /* sem storage */ }
    setAberto(false)
  }
  const primeiro = pendente.professionals?.name?.split(' ')[0]

  return (
    <>
      {!aberto && (
        <button type="button" className="card avaliar-convite" onClick={() => setAberto(true)}>
          <span className="avaliar-convite-estrelas">{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={14} />)}</span>
          <span className="avaliar-convite-texto">
            <strong>Como foi com {primeiro}?</strong>
            <span className="muted">{pendente.services?.name} · {formatDataCurta(pendente.date)}. Leva 10 segundos.</span>
          </span>
          <ChevronRight size={18} />
        </button>
      )}
      {aberto && (
        <AvaliarModal appt={pendente} onFechar={depois} onPronto={() => { setAberto(false); buscar() }} />
      )}
    </>
  )
}
