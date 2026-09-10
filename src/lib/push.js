import { supabase } from './supabase'

// Push no PWA: pedir permissão, registrar o celular no banco, desligar.
// No iPhone só funciona com o MIMO instalado na tela inicial (iOS 16.4+);
// no Safari aberto nem existe a API. O app explica isso em vez de falhar.

export function suportaPush() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}
export function ehIphone() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
}
export function estaInstalado() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
}

// 'ligado' | 'desligado' | 'bloqueado' | 'sem_suporte' | 'instale'
export async function estadoPush() {
  if (!suportaPush()) return ehIphone() && !estaInstalado() ? 'instale' : 'sem_suporte'
  if (Notification.permission === 'denied') return 'bloqueado'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'ligado' : 'desligado'
}

function b64ParaBytes(b64) {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(s)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export async function ativarPush(userId) {
  if (!suportaPush()) throw new Error('Este navegador não recebe avisos.')
  const { data: cfg } = await supabase.rpc('config_publica')
  const vapid = cfg?.vapid_public
  if (!vapid) throw new Error('Os avisos ainda não foram configurados no servidor (chave VAPID).')
  const permissao = await Notification.requestPermission()
  if (permissao !== 'granted') throw new Error('Sem permissão. Libere os avisos nos ajustes do celular.')
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ParaBytes(vapid) })
  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId, endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
    agente: navigator.userAgent.slice(0, 200),
  }, { onConflict: 'endpoint' })
  if (error) throw new Error(error.message)
  return sub
}

export async function desativarPush() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}
