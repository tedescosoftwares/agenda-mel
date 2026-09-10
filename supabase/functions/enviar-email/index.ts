// Drena a fila de e-mail (email_outbox) pelo Resend.
//
// Roda pelo relógio (mimo-emails, a cada minuto) ou na unha:
//   curl -X POST .../functions/v1/enviar-email -H "Authorization: Bearer $SERVICE_ROLE_KEY"
//
// Segredos (supabase secrets set):
//   RESEND_API_KEY   re_...
//   EMAIL_DE         remetente; padrão 'MIMO <oi@mimo.com.vc>'. O domínio
//                    precisa estar verificado no Resend (DKIM + SPF). Para
//                    testar sem domínio: 'MIMO <onboarding@resend.dev>',
//                    que só entrega para o dono da conta do Resend.
//   EMAIL_RESPONDER  opcional; para onde vai a resposta da cliente
//                    (ex.: 'contato@mimo.com.vc')
//
// Idempotente: puxar_emails() marca 'enviando' com skip locked.

import { clienteDoChamador, naoAutorizado, semPermissao } from '../_shared/porteiro.ts'

const LOTE = 20

Deno.serve(async (req) => {
  const db = clienteDoChamador(req)
  if (!db) return naoAutorizado()

  const resend = Deno.env.get('RESEND_API_KEY') ?? ''
  const de = Deno.env.get('EMAIL_DE') ?? 'MIMO <oi@mimo.com.vc>'
  const responder = Deno.env.get('EMAIL_RESPONDER') || undefined

  const { data: fila, error } = await db.rpc('puxar_emails', { quantos: LOTE })
  if (semPermissao(error)) return naoAutorizado(error?.message)
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
          reply_to: responder,
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
