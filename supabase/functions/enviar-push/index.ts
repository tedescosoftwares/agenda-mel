// Empurra os avisos do app para os celulares (Web Push).
//
// Roda pelo relógio (mimo-push, a cada minuto) ou na unha:
//   curl -X POST .../functions/v1/enviar-push -H "Authorization: Bearer $SERVICE_ROLE_KEY"
//
// Segredos (supabase secrets set):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   o par gerado uma vez
//   VAPID_SUBJECT                          mailto:oi@mimo.com.vc
//
// Cada aviso vai para TODOS os celulares da pessoa. Celular que sumiu
// (404/410) é apagado; falha passageira só conta.

import { clienteDoChamador, naoAutorizado, semPermissao } from '../_shared/porteiro.ts'
import webpush from 'npm:web-push@3.6.7'

const LOTE = 30

Deno.serve(async (req) => {
  const db = clienteDoChamador(req)
  if (!db) return naoAutorizado()

  const pub = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
  const priv = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:oi@mimo.com.vc'
  if (!pub || !priv) return json({ erro: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY não configuradas' }, 500)
  webpush.setVapidDetails(subject, pub, priv)

  const { data: lote, error } = await db.rpc('puxar_push', { quantos: LOTE })
  if (semPermissao(error)) return naoAutorizado(error?.message)
  if (error) return json({ erro: error.message }, 500)

  let enviados = 0, falhas = 0, apagados = 0
  for (const n of lote ?? []) {
    const carga = JSON.stringify({ title: n.title, body: n.body ?? '', url: n.action_url ?? '/', kind: n.kind, tag: n.kind })
    for (const c of n.celulares ?? []) {
      try {
        await webpush.sendNotification({ endpoint: c.endpoint, keys: { p256dh: c.p256dh, auth: c.auth } }, carga, { TTL: 60 * 60 * 6 })
        await db.rpc('push_resultado', { sub_id: c.id, ok: true, apagar: false })
        enviados++
      } catch (e) {
        const status = (e as { statusCode?: number })?.statusCode ?? 0
        const sumiu = status === 404 || status === 410
        await db.rpc('push_resultado', { sub_id: c.id, ok: false, apagar: sumiu })
        if (sumiu) apagados++; else falhas++
      }
    }
    await db.from('notifications').update({ push_resultado: `${enviados}/${(n.celulares ?? []).length}` }).eq('id', n.notification_id)
  }
  return json({ avisos: lote?.length ?? 0, enviados, falhas, apagados })
})

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}
