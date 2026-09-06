// Drena a fila de e-mail (email_outbox) pelo Resend.
//
// Roda pelo relógio (mimo-emails, a cada minuto) ou na unha:
//   curl -X POST .../functions/v1/enviar-email -H "Authorization: Bearer $SERVICE_ROLE_KEY"
//
// Segredos (supabase secrets set):
//   RESEND_API_KEY   re_...
//   EMAIL_DE         'MIMO <oi@seudominio.com>' — o domínio precisa estar
//                    verificado no Resend. Sem isso, cai no remetente de
//                    teste do Resend, que só entrega para o dono da conta.
//
// Idempotente: puxar_emails() marca 'enviando' com skip locked.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const LOTE = 20

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? ''
  const chave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!chave || auth !== `Bearer ${chave}`) {
    return json({ erro: 'não autorizado' }, 401)
  }

  const resend = Deno.env.get('RESEND_API_KEY') ?? ''
  const de = Deno.env.get('EMAIL_DE') ?? 'MIMO <onboarding@resend.dev>'
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', chave, { auth: { persistSession: false } })

  const { data: fila, error } = await db.rpc('puxar_emails', { quantos: LOTE })
  if (error) return json({ erro: error.message }, 500)
  if (!resend) {
    // sem chave, devolve tudo para a fila e avisa uma vez só
    for (const m of fila ?? []) await db.rpc('falhar_email', { mensagem_id: m.id, motivo: 'RESEND_API_KEY não configurada', permanente: false })
    return json({ erro: 'RESEND_API_KEY não configurada', devolvidos: fila?.length ?? 0 }, 500)
  }

  let enviados = 0, falhas = 0
  for (const m of fila ?? []) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resend}` },
        body: JSON.stringify({
          from: de,
          to: [m.nome ? `${m.nome} <${m.para}>` : m.para],
          subject: m.assunto,
          html: m.html,
          text: m.texto ?? undefined,
          tags: [{ name: 'kind', value: String(m.kind).replace(/[^a-zA-Z0-9_-]/g, '_') }],
        }),
      })
      const corpo = await r.json().catch(() => ({}))
      if (r.ok && corpo?.id) {
        await db.rpc('confirmar_email', { mensagem_id: m.id, id_provedor: corpo.id })
        enviados++
      } else {
        // 4xx que não seja limite de taxa não melhora tentando de novo
        const permanente = r.status >= 400 && r.status < 500 && r.status !== 429
        await db.rpc('falhar_email', { mensagem_id: m.id, motivo: `${r.status} ${corpo?.message ?? corpo?.name ?? ''}`.trim(), permanente })
        falhas++
      }
    } catch (e) {
      await db.rpc('falhar_email', { mensagem_id: m.id, motivo: String(e).slice(0, 300), permanente: false })
      falhas++
    }
    // o plano gratuito do Resend aceita 2 por segundo
    await new Promise((r) => setTimeout(r, 600))
  }

  return json({ puxados: fila?.length ?? 0, enviados, falhas })
})

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}
