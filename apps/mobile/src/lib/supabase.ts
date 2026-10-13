import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { AppState } from 'react-native'
import { CONFIGURADO, DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

// O mesmo projeto Supabase da web; a sessão fica no AsyncStorage do aparelho.
// Sem credenciais (EXPO_PUBLIC_* vazias) o app abre, mas a tela de entrar avisa.
// Em modo demonstração (EXPO_PUBLIC_DEMO=1) entra a imitação de src/lib/demo.ts.
function criar(): SupabaseClient {
  if (DEMO) {
    // require condicional: fora da demo o código dos dados fictícios nem entra no pacote
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('./demo') as typeof import('./demo')).demo
  }
  return createClient(CONFIGURADO ? SUPABASE_URL : 'https://nao-configurado.supabase.co', CONFIGURADO ? SUPABASE_ANON_KEY : 'nao-configurado', {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })
}

export const supabase = criar()

// renova o token só com o app na frente (recomendação do Supabase para React Native)
AppState.addEventListener('change', (estado) => {
  if (estado === 'active') supabase.auth.startAutoRefresh()
  else supabase.auth.stopAutoRefresh()
})
