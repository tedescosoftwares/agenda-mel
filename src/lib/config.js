import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// config_publica (057): chave VAPID, endereço do app, Instagram… lida
// uma vez por sessão e compartilhada por quem precisar.
let promessa = null
export function carregarConfig() {
  if (!promessa) {
    promessa = supabase.rpc('config_publica').then(({ data }) => data ?? {}).catch(() => ({}))
  }
  return promessa
}

export function useConfig() {
  const [cfg, setCfg] = useState({})
  useEffect(() => { carregarConfig().then(setCfg) }, [])
  return cfg
}

export function instagramDe(cfg) {
  const h = (cfg?.instagram ?? '').replace(/^@/, '').trim()
  return h ? { handle: h, url: `https://instagram.com/${h}` } : null
}
