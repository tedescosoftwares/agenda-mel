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
  // a permissão é pedida ANTES de qualquer ida ao servidor: o iPhone só
  // aceita o pedido colado no toque da pessoa
  const permissao = await Notification.requestPermission()
  if (permissao !== 'granted') throw new Error('Sem permissão. Libere os avisos nos ajustes do celular.')
  const { data: cfg, error: erroCfg } = await supabase.rpc('config_publica')
  if (erroCfg) throw new Error('Não consegui ler a configuração: ' + erroCfg.message)
  const vapid = cfg?.vapid_public
  if (!vapid) throw new Error('Os avisos ainda não foram configurados no servidor (chave VAPID).')
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ParaBytes(vapid) })
  const { error } = await registrar(sub)
  if (error) throw new Error(error.message)
  return sub
}

export async function desativarPush() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await supabase.rpc('esquecer_celular', { endpoint_: sub.endpoint })
  await sub.unsubscribe()
}

// 4.17: o aparelho passa para a conta que está logada (migração 269). A linha do banco é uma por aparelho; antes
// ela ficava com a primeira conta que ligou os avisos, e quem entrava depois via "ligado" sem receber nada.
function registrar(sub) {
  const j = sub.toJSON()
  return supabase.rpc('registrar_celular', {
    endpoint_: sub.endpoint, p256dh_: j.keys?.p256dh, auth_: j.keys?.auth, agente_: navigator.userAgent.slice(0, 200),
  })
}

// Ao entrar (e ao abrir o app já logada): se este aparelho já tem os avisos ligados, confere que é para esta conta
// que eles vão. Não pede permissão nem cria assinatura: só acerta o dono da que existe. Uma vez por conta e aba.
let conferido = null
export async function conferirPush(userId) {
  if (!userId || conferido === userId || !suportaPush() || Notification.permission !== 'granted') return
  conferido = userId
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) await registrar(sub)
  } catch { conferido = null }
}

// Ao sair da conta: o aparelho deixa de receber os avisos dela. A assinatura do navegador fica, para a próxima
// conta que entrar aqui herdar os avisos sem ter de ligar de novo.
export async function soltarPush() {
  conferido = null
  if (!suportaPush()) return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) await supabase.rpc('esquecer_celular', { endpoint_: sub.endpoint })
  } catch { /* sair não pode depender disto */ }
}
