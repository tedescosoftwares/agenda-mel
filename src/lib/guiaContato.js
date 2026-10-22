import { supabase } from './supabase'

// O WhatsApp do guia (3.48, migração 195): o site pergunta uma vez por sessão se o recurso está ligado na Plataforma,
// com que número e em quais botões (guia_contato_config, pública). Num banco sem a 195, ou desligado, fica {ligado: false}
// e a página do salão segue como antes (WhatsApp e telefone do próprio salão).
let promessa = null
export function carregarContato() {
  if (!promessa) {
    promessa = supabase.rpc('guia_contato_config')
      .then(({ data, error }) => (error || !data?.ligado || !data?.numero ? { ligado: false } : { ligado: true, numero: String(data.numero), botoes: Array.isArray(data.botoes) ? data.botoes : [], msg_cliente: String(data.msg_cliente ?? '') }))
      .catch(() => ({ ligado: false }))
  }
  return promessa
}
