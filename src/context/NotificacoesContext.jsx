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
  // o último aviso que chegou com o app aberto: vira o banner do topo
  const [novo, setNovo] = useState(null)

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
    // aproveita a abertura do app para dois serviços de casa, os dois
    // idempotentes: passar vagas não respondidas adiante e mandar os
    // lembretes de véspera que ainda não saíram
    // (sem o .then o supabase-js não dispara a chamada)
    supabase.rpc('avancar_ofertas_expiradas').then(() => {})
    supabase.rpc('enviar_lembretes').then(() => {})

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
        (evento) => {
          carregar()
          // chegou agora, com o app aberto: mostra no topo, e o celular vibra
          if (evento?.eventType === 'INSERT' && evento.new) {
            setNovo(evento.new)
            try { navigator.vibrate?.([60, 30, 60]) } catch { /* sem suporte */ }
          }
        },
      )
      .subscribe()

    // o realtime cai quando o app fica em segundo plano; ao voltar, recarrega
    const aoVoltar = () => { if (document.visibilityState === 'visible') carregar() }
    document.addEventListener('visibilitychange', aoVoltar)

    return () => {
      supabase.removeChannel(canal)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [user, carregar])

  const naoLidos = useMemo(
    () => avisos.filter((a) => !a.read_at).length,
    [avisos],
  )

  // o número no ícone do app instalado (Android, iPhone 16.4+) acompanha os não lidos
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return
    try { if (naoLidos > 0) navigator.setAppBadge(naoLidos); else navigator.clearAppBadge?.() } catch { /* sem suporte */ }
  }, [naoLidos])

  async function marcarLido(id) {
    const marcadoEm = new Date().toISOString()
    setAvisos((prev) => prev.map((a) => (a.id === id && !a.read_at ? { ...a, read_at: marcadoEm } : a)))
    await supabase.from('notifications').update({ read_at: marcadoEm }).eq('id', id)
  }

  async function marcarTodosLidos() {
    if (!naoLidos) return
    const marcadoEm = new Date().toISOString()
    setAvisos((prev) =>
      prev.map((a) => (a.read_at ? a : { ...a, read_at: marcadoEm })),
    )
    await supabase.rpc('marcar_avisos_lidos')
  }

  const value = { avisos, naoLidos, loading, carregar, marcarTodosLidos, marcarLido, novo, dispensarNovo: () => setNovo(null) }

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
