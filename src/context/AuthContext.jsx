import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [professional, setProfessional] = useState(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!isSupabaseConfigured) return

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (!session) setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) {
        setProfile(null)
        setProfessional(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) return
    let cancelled = false

    async function carregarPerfil() {
      const { data: perfil } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()
      if (cancelled) return
      setProfile(perfil)

      // profissional: carrega a ficha dela (agenda, serviços, link)
      if (perfil?.role === 'profissional') {
        const { data: ficha } = await supabase
          .from('professionals')
          .select('*')
          .eq('user_id', session.user.id)
          .maybeSingle()
        if (cancelled) return
        setProfessional(ficha ?? null)
      } else {
        setProfessional(null)
      }
      setLoading(false)
    }

    carregarPerfil()
    return () => {
      cancelled = true
    }
  }, [session])

  // usada quando a profissional edita a própria ficha (foto, etc.)
  async function recarregarProfessional() {
    if (!session?.user) return
    const { data } = await supabase
      .from('professionals')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle()
    setProfessional(data ?? null)
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signUp(email, password, fullName, phone) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone },
      },
    })
    return { error }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    professional,
    recarregarProfessional,
    role: profile?.role ?? null,
    loading,
    signIn,
    signUp,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return ctx
}
