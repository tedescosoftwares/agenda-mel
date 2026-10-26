import { supabase, isDemo } from './supabase'
import { planoDoNegocio, reais } from './planos'

// A promoção completa de um salão do guia (3.71): a Edge Function plataforma-promover faz a conta da
// dona, o salão, o teste de 7 dias, o Pix no Asaas e as mensagens; aqui é só a chamada (e a demo).
export async function promoverCompleto(p) {
  if (isDemo) return demo(p)
  const { data, error } = await supabase.functions.invoke('plataforma-promover', { body: { ...p, base: window.location.origin } })
  if (error) {
    // o corpo do erro vem no contexto da resposta (FunctionsHttpError)
    let motivo = error.message
    try { const j = await error.context?.json?.(); if (j?.erro) motivo = j.erro } catch { /* fica a mensagem */ }
    return { ok: false, motivo }
  }
  if (!data?.ok) return { ok: false, motivo: data?.motivo ?? data?.erro ?? 'Não deu para promover.', ...data }
  return data
}

async function demo(p) {
  await new Promise((r) => setTimeout(r, 400))
  const { data: r } = await supabase.rpc('guia_promover', { lugar_: p.lugar, dono_email_: p.dona.email, tipo_: p.tipo })
  if (!r?.ok) return { ok: false, motivo: r?.motivo ?? 'Não deu para promover.' }
  const pl = planoDoNegocio(p.tipo, p.equipe)
  const plano = pl.plano
  const valor = Math.round(pl.total * 100)
  const vence = new Date(Date.now() + 7 * 864e5)
  const cobranca = p.tipo === 'salao' && p.cobrar !== false
    ? (p.dona.documento ? { id: 'cob-demo', ok: true, status: 'aguardando', copia_cola: '00020126580014br.gov.bcb.pix0136demo-mimo-promocao-0000-0000-000000000520400005303986540' + (valor / 100).toFixed(2) + '5802BR5904MIMO6009Itanhaem62070503***6304DEMO', total_cents: valor, vencimento: vence.toISOString().slice(0, 10) }
      : { id: 'cob-demo', ok: false, status: 'a_criar', sem_documento: true, total_cents: valor, vencimento: vence.toISOString().slice(0, 10) })
    : null
  const numero = String(p.dona.whatsapp ?? '').replace(/\D/g, '')
  const texto = `Oi, ${String(p.dona.nome).split(' ')[0]}! Aqui é a MIMO 💗 Criamos a agenda do ${r.nome}: plano ${pl.nome}${p.tipo === 'autonoma' ? '' : ` (até ${p.equipe} profissionais), com 7 dias grátis para começar`}. Crie a sua senha e entre por este link: https://mimo.com.vc/senha#demo${cobranca?.ok ? `\n\nA primeira mensalidade (${reais(valor / 100)}) vence em ${vence.toLocaleDateString('pt-BR')}.\nPix copia e cola:\n${cobranca.copia_cola}` : ''}`
  return {
    ok: true,
    conta: { id: 'u-demo', nova: true, modo: p.conta === 'email' ? 'email' : 'automatica', email: p.dona.email, aviso: null },
    link_senha: 'https://mimo.com.vc/senha#demo',
    salao: { id: r.salao_id, nome: r.nome, slug: r.slug, codigo: 'DEMO42', novo: true, tipo: p.tipo, plano, equipe: p.equipe, teste_dias: 7 },
    cobranca,
    email: { para: p.dona.email, enviado: true },
    whats: { enviado: p.enviar_whats !== false && Boolean(numero), texto, numero, erro: numero ? null : 'sem WhatsApp' },
  }
}
