import { useEffect, useSyncExternalStore } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from './supabase'

// 3.90: a profissional da EQUIPE de um salão (não é a dona do negócio em que atende). Para ela, a área
// da MIMO é só o canal com o salão: a agenda dela, os avisos e recados, e o contato da casa. Teste
// grátis, assinatura, encaixe, números e serviços são assunto do salão e não aparecem.
export function ehDaEquipe({ professional, negocio }) {
  if (!professional?.salon_id) return false
  return !(negocio && negocio.id === professional.salon_id)
}

export function useDaEquipe() {
  const { professional, negocio } = useAuth()
  return ehDaEquipe({ professional, negocio })
}

// nome, contato e foto do salão em que ela atende (guardado entre as telas: não muda no meio do uso).
// 3.93: uma busca só para todas as telas, e quem mostra o salão (faixa da agenda, menu do computador,
// folha do horário) é avisado quando ela chega (useSyncExternalStore: sem perder o aviso se a busca
// terminar entre o desenho e o efeito, que deixava a faixa da agenda vazia).
const guardado = new Map()
const buscando = new Set()
const ouvintes = new Set()
function assinar(f) { ouvintes.add(f); return () => ouvintes.delete(f) }
function buscarSalao(id) {
  if (!id || guardado.has(id) || buscando.has(id)) return
  buscando.add(id)
  supabase.from('salons').select('id, name, whatsapp, phone, logo_url, city, bairro').eq('id', id).maybeSingle().then(({ data }) => {
    buscando.delete(id)
    if (!data) return
    guardado.set(id, data)
    ouvintes.forEach((f) => f())
  }, () => { buscando.delete(id) })
}
export function useMeuSalao() {
  const { professional } = useAuth()
  const id = professional?.salon_id ?? null
  const salao = useSyncExternalStore(assinar, () => (id ? guardado.get(id) ?? null : null))
  useEffect(() => { buscarSalao(id) }, [id])
  return salao
}

// "(13) 99120-3410" → "5513991203410" (link do WhatsApp); sem número que preste, null
export function linkWhatsApp(numero, texto) {
  let d = String(numero ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  if (!d.startsWith('55') || d.length <= 11) d = '55' + d
  return `https://wa.me/${d}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`
}
