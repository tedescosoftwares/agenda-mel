import Constants from 'expo-constants'

type Extra = { variante?: 'cliente' | 'pro'; host?: string; versao?: string }
const extra = (Constants.expoConfig?.extra ?? {}) as Extra

// cliente (MIMO) ou pro (MIMO Pro): decidido no build, por APP_VARIANT (app.config.js)
export const VARIANTE: 'cliente' | 'pro' = extra.variante === 'pro' ? 'pro' : 'cliente'
export const NOME_DO_APP = VARIANTE === 'pro' ? 'MIMO Pro' : 'MIMO'
export const VERSAO = extra.versao ?? Constants.expoConfig?.version ?? '0.0.0'

// EXPO_PUBLIC_*: o Expo troca pelo valor na hora de empacotar. Precisa estar
// escrito por extenso, como abaixo (process.env[nome] não funciona).
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''
export const CONFIGURADO = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

// onde a web mora: a ponte (src/app/web.tsx) abre as telas daqui
const hostPadrao = extra.host ?? (VARIANTE === 'pro' ? 'pro.mimo.com.vc' : 'mimo.com.vc')
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || `https://${hostPadrao}`).replace(/\/+$/, '')
