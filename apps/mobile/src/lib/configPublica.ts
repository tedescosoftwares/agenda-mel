import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// config_publica (057): o WhatsApp da MIMO, as chamadas, o Instagram… lida
// uma vez por sessão e compartilhada por quem precisar (como na web, src/lib/config.js).
export type ConfigPublica = Record<string, unknown>
let promessa: Promise<ConfigPublica> | null = null
export function carregarConfig(): Promise<ConfigPublica> {
  if (!promessa) {
    promessa = Promise.resolve(supabase.rpc('config_publica'))
      .then(({ data }) => (data as ConfigPublica | null) ?? {})
      .catch(() => ({}) as ConfigPublica)
  }
  return promessa
}

export function useConfig(): ConfigPublica {
  const [cfg, setCfg] = useState<ConfigPublica>({})
  useEffect(() => {
    let vivo = true
    carregarConfig().then((c) => {
      if (vivo) setCfg(c)
    })
    return () => {
      vivo = false
    }
  }, [])
  return cfg
}
