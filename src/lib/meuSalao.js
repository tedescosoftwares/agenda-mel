import { useEffect, useState } from 'react'
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

// nome, contato e foto do salão em que ela atende (guardado entre as telas: não muda no meio do uso)
const guardado = new Map()
export function useMeuSalao() {
  const { professional } = useAuth()
  const id = professional?.salon_id ?? null
  const [, setVez] = useState(0)
  useEffect(() => {
    if (!id || guardado.has(id)) return
    let vivo = true
    supabase.from('salons').select('id, name, whatsapp, phone, logo_url, city, bairro').eq('id', id).maybeSingle().then(({ data }) => {
      if (!data) return
      guardado.set(id, data)
      if (vivo) setVez((v) => v + 1)
    })
    return () => { vivo = false }
  }, [id])
  return id ? guardado.get(id) ?? null : null
}

// "(13) 99120-3410" → "5513991203410" (link do WhatsApp); sem número que preste, null
export function linkWhatsApp(numero, texto) {
  let d = String(numero ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  if (!d.startsWith('55') || d.length <= 11) d = '55' + d
  return `https://wa.me/${d}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`
}
