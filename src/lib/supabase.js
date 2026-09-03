import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Sem as credenciais o app roda, mas mostra um aviso na tela de login
// Modo demonstração: liga com VITE_DEMO=1 e o app inteiro roda com
// dados fictícios, sem banco. Ver src/lib/demo.js.
export const isDemo = import.meta.env.VITE_DEMO === '1'

export const isSupabaseConfigured = isDemo || Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isDemo
  ? (await import('./demo.js')).demo
  : isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null
