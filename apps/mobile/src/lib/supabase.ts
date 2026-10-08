import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { AppState } from 'react-native'
import { CONFIGURADO, SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

// O mesmo projeto Supabase da web; a sessão fica no AsyncStorage do aparelho.
// Sem credenciais (EXPO_PUBLIC_* vazias) o app abre, mas a tela de entrar avisa.
export const supabase = createClient(
  CONFIGURADO ? SUPABASE_URL : 'https://nao-configurado.supabase.co',
  CONFIGURADO ? SUPABASE_ANON_KEY : 'nao-configurado',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
)

// renova o token só com o app na frente (recomendação do Supabase para React Native)
AppState.addEventListener('change', (estado) => {
  if (estado === 'active') supabase.auth.startAutoRefresh()
  else supabase.auth.stopAutoRefresh()
})
