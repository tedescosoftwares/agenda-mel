// Empurra os avisos do app para os celulares, por dois caminhos:
//   Web Push  → o PWA (celular cadastrado em push_subscriptions, chave VAPID)
//   Expo Push → o app da loja (aparelho cadastrado em push_tokens_app; FCM e APNs por trás)
//
// Roda pelo relógio (mimo-push, a cada minuto) ou na unha:
//   curl -X POST .../functions/v1/enviar-push -H "Authorization: Bearer $SERVICE_ROLE_KEY"
//
// Segredos (supabase secrets set):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   o par gerado uma vez
//   VAPID_SUBJECT                          mailto:oi@mimo.com.vc
//   EXPO_ACCESS_TOKEN                      opcional: token de acesso da conta Expo (expo.dev → Access tokens),
//                                          para só a MIMO poder mandar pelos tokens dela
//
// Cada aviso vai para TODOS os celulares e aparelhos da pessoa. Celular que
// sumiu (404/410) e aparelho desinstalado (DeviceNotRegistered) são apagados;
// falha passageira só conta.

import { clienteDoChamador, naoAutorizado, semPermissao } from '../_shared/porteiro.ts'
import webpush from 'npm:web-push@3.6.7'

const LOTE = 30
const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send'

type Celular = { id: string; endpoint: string; p256dh: string; auth: string }
type Aparelho = { id: string; token: string; plataforma: string }
type Bilhete = { status?: string; message?: string; details?: { error?: string } }

Deno.serve(async (req) => {
  const db = clienteDoChamador(req)
  if (!db) return naoAutorizado()

  const pub = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
  const priv = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:oi@mimo.com.vc'
  if (!pub || !priv) return json({ erro: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY não configuradas' }, 500)
  webpush.setVapidDetails(subject, pub, priv)
  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN') ?? ''

  const { data: lote, error } = await db.rpc('puxar_push', { quantos: LOTE })
  if (semPermissao(error)) return naoAutorizado(error?.message)
  if (error) return json({ erro: error.message }, 500)

  let web = 0, app = 0, falhas = 0, apagados = 0
  for (const n of lote ?? []) {
    const celulares: Celular[] = n.celulares ?? []
    const aparelhos: Aparelho[] = n.aparelhos ?? []
    let okAqui = 0

    // ---- o PWA ----
    const carga = JSON.stringify({ title: n.title, body: n.body ?? '', url: n.action_url ?? '/', kind: n.kind, tag: n.kind, badge: n.nao_lidos ?? undefined })
    for (const c of celulares) {
      try {
        await webpush.sendNotification({ endpoint: c.endpoint, keys: { p256dh: c.p256dh, auth: c.auth } }, carga, { TTL: 60 * 60 * 6, urgency: 'high' })
        await db.rpc('push_resultado', { sub_id: c.id, ok: true, apagar: false })
        okAqui++; web++
      } catch (e) {
        const status = (e as { statusCode?: number })?.statusCode ?? 0
        const sumiu = status === 404 || status === 410
        await db.rpc('push_resultado', { sub_id: c.id, ok: false, apagar: sumiu })
        if (sumiu) apagados++; else falhas++
      }
    }

    // ---- o app da loja: um pedido ao Expo Push com todos os aparelhos da pessoa ----
    if (aparelhos.length) {
      const mensagens = aparelhos.map((a) => ({
        to: a.token, title: n.title, body: n.body ?? '', data: { url: n.action_url ?? '/', kind: n.kind },
        sound: 'default', channelId: 'avisos', priority: 'high', badge: n.nao_lidos ?? undefined,
      }))
      let bilhetes: Bilhete[] = []
      try {
        const r = await fetch(EXPO_PUSH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(expoToken ? { Authorization: `Bearer ${expoToken}` } : {}) },
          body: JSON.stringify(mensagens),
        })
        const j = (await r.json().catch(() => ({}))) as { data?: Bilhete[] }
        bilhetes = Array.isArray(j.data) ? j.data : []
      } catch { bilhetes = [] }
      for (let i = 0; i < aparelhos.length; i++) {
        const b = bilhetes[i]
        const ok = b?.status === 'ok'
        const sumiu = !ok && (b?.details?.error === 'DeviceNotRegistered' || /not a valid Expo push token/i.test(b?.message ?? ''))
        await db.rpc('token_app_resultado', { token_id: aparelhos[i].id, ok, apagar: sumiu })
        if (ok) { okAqui++; app++ } else if (sumiu) apagados++; else falhas++
      }
    }

    await db.from('notifications').update({ push_resultado: `${okAqui}/${celulares.length + aparelhos.length}` }).eq('id', n.notification_id)
  }
  return json({ avisos: lote?.length ?? 0, web, app, falhas, apagados })
})

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}
