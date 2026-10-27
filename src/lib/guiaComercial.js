import { supabase } from './supabase'

// O WhatsApp comercial (3.74, migração 218): o site pergunta uma vez por sessão se a assistente está ligada, com que
// número e nome (comercial_publico, pública). Ligada, os botões de agenda do site (criar conta, falar com a MIMO, planos,
// o flutuante) abrem esse número; num banco sem a 218, ou desligada, tudo segue como antes.
let promessa = null
export function carregarComercialPublico() {
  if (!promessa) {
    promessa = supabase.rpc('comercial_publico')
      .then(({ data, error }) => (error || !data?.ligado || !data?.numero ? { ligado: false } : { ligado: true, numero: String(data.numero), nome: String(data.nome ?? '') }))
      .catch(() => ({ ligado: false }))
  }
  return promessa
}
// a frase que o botão do site deixa escrita (o motor da assistente reconhece a origem "botão")
export const FRASE_COMERCIAL = 'Oi! Quero conhecer a MIMO Agenda.'
export const linkComercial = (p, texto = FRASE_COMERCIAL) => `https://wa.me/${String(p.numero).replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`
