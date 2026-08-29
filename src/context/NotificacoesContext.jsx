import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useAuth } from './AuthContext'

const NotificacoesContext = createContext(null)

export function NotificacoesProvider({ children }) {
  const { user } = useAuth()
  const [avisos, setAvisos] = useState([])
  const [loading, setLoading] = useState(false)

  const carregar = useCallback(async () => {
    if (!user) {
      setAvisos([])
      return
    }
    const agora = new Date().toISOString()
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .or(`expires_at.is.null,expires_at.gt.${agora}`)
      .order('created_at', { ascending: false })
      .limit(50)
    setAvisos(data ?? [])
    setLoading(false)
  }, [user])

  useEffect(() => {
    if (!isSupabaseConfigured || !user) {
      setAvisos([])
      return
    }
    setLoading(true)
    carregar()

    // avisos entram na tela sem precisar recarregar
    const canal = supabase
      .channel(`avisos-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => carregar(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [user, carregar])

  const naoLidos = useMemo(
    () => avisos.filter((a) => !a.read_at).length,
    [avisos],
  )

  async function marcarTodosLidos() {
    if (!naoLidos) return
    const marcadoEm = new Date().toISOString()
    setAvisos((prev) =>
      prev.map((a) => (a.read_at ? a : { ...a, read_at: marcadoEm })),
    )
    await supabase.rpc('marcar_avisos_lidos')
  }

  const value = { avisos, naoLidos, loading, carregar, marcarTodosLidos }

  return (
    <NotificacoesContext.Provider value={value}>
      {children}
    </NotificacoesContext.Provider>
  )
}

export function useNotificacoes() {
  const ctx = useContext(NotificacoesContext)
  if (!ctx) {
    throw new Error('useNotificacoes deve ser usado dentro de NotificacoesProvider')
  }
  return ctx
}
