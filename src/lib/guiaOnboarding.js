import { supabase } from './supabase'

// O agente de onboarding pelo WhatsApp (3.55, migração 203): o site pergunta uma vez por sessão se o agente está ligado
// na Plataforma, com que número e qual é a frase do botão (guia_onboarding_publico, pública). Num banco sem a 203, ou
// desligado, fica {ligado: false} e as landings seguem só com o "Criar minha conta" de sempre.
let promessa = null
export function carregarOnboardingPublico() {
  if (!promessa) {
    promessa = supabase.rpc('guia_onboarding_publico')
      .then(({ data, error }) => (error || !data?.ligado || !data?.numero ? { ligado: false } : { ligado: true, numero: String(data.numero), frase: String(data.frase ?? '') }))
      .catch(() => ({ ligado: false }))
  }
  return promessa
}

// a frase do botão vai guardada normalizada (minúsculas, sem acento); no botão ela aparece arrumada
export function fraseDoBotao(frase) {
  const f = String(frase ?? '').trim() || 'quero criar minha conta na mimo agenda'
  return (f.charAt(0).toUpperCase() + f.slice(1)).replace(/\bmimo agenda\b/gi, 'MIMO Agenda').replace(/\bmimo\b/gi, 'MIMO')
}
export function linkOnboardingWhats(p) {
  return `https://wa.me/${String(p.numero).replace(/\D/g, '')}?text=${encodeURIComponent(fraseDoBotao(p.frase))}`
}
