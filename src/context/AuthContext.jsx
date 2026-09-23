import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { lerCodigoGuardado, limparCodigoGuardado } from '../lib/indicacao'
import { lerConvite, limparConvite } from '../lib/convite'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [professional, setProfessional] = useState(null)
  const [salao, setSalao] = useState(null)
  const [saloes, setSaloes] = useState([])      // todos os salões que a admin administra
  const [negocio, setNegocio] = useState(null)   // o negócio que ela é dona (salão ou a agenda de autônoma): quem passa pelo onboarding
  // as agendas em que a cliente entrou (053). Sem nenhuma, não há app.
  // null = ainda não sei (carregando ou a rede falhou); [] = sei que não tem
  const [vinculos, setVinculos] = useState(null)
  const [erroRede, setErroRede] = useState('')
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
        setSalao(null)
        setNegocio(null)
        setVinculos(null)
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
      if (perfil?.role === 'admin' || perfil?.role === 'profissional') { await carregarNegocio(session.user.id); if (cancelled) return } else setNegocio(null)

      // admin: carrega os salões que ela administra. Com mais de um, vale o
      // que ela escolheu por último neste aparelho (Ajustes › Trocar de salão);
      // antes era sempre o primeiro da lista, e quem tinha dois gravava no errado
      if (perfil?.role === 'admin') {
        const { data: vinculos } = await supabase
          .from('salon_members')
          .select('salon_id, salons (*)')
          .eq('user_id', session.user.id)
          .eq('papel', 'admin')
        if (cancelled) return
        const lista = (vinculos ?? []).map((v) => v.salons).filter(Boolean).sort((a, b) => String(a.name).localeCompare(String(b.name)))
        let preferido = null
        try { preferido = localStorage.getItem('mimo-salao-admin') } catch { /* sem armazenamento */ }
        setSaloes(lista)
        setSalao(lista.find((x) => x.id === preferido) ?? lista[0] ?? null)
      } else {
        setSaloes([])
        setSalao(null)
      }

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

      // veio por um convite de indicação: registra uma única vez
      const codigo = lerCodigoGuardado()
      if (codigo && perfil?.role === 'cliente') {
        const { data: resultado } = await supabase.rpc('registrar_indicacao', {
          codigo,
        })
        // qualquer desfecho encerra a tentativa: não insistimos
        if (resultado !== 'codigo_invalido') limparCodigoGuardado()
      }

      // cliente: entrou por um link /v/<código> antes de logar? entra agora.
      // (quem se cadastrou já entrou pelo servidor; aqui é quem já tinha conta)
      if (perfil?.role === 'cliente') {
        const convite = lerConvite()
        if (convite) {
          const { error } = await supabase.rpc('vincular', { codigo: convite, jeito: 'link' })
          if (!error) limparConvite()
        }
        const { data: agendas, error: erroAgendas } = await supabase.rpc('minhas_agendas')
        if (cancelled) return
        // falhou a rede? fica "não sei" — a tela espera e tenta de novo,
        // em vez de mandar para o QR como se não houvesse agenda nenhuma
        if (erroAgendas) { setErroRede(erroAgendas.message); setVinculos(null) }
        else { setErroRede(''); setVinculos(Array.isArray(agendas) ? agendas : []) }
      } else {
        setVinculos([])
      }

      setLoading(false)
    }

    carregarPerfil()
    return () => {
      cancelled = true
    }
  }, [session])

  // usada quando a própria pessoa muda algo no seu perfil
  async function recarregarPerfil() {
    if (!session?.user) return
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
    if (data) setProfile(data)
    await carregarNegocio(session.user.id)
  }

  // o negócio que a conta é dona (114): é por ele que o onboarding sabe onde está
  async function carregarNegocio(uid) {
    const { data } = await supabase.from('salons').select('*').eq('owner_id', uid).order('created_at', { ascending: false }).limit(1).maybeSingle()
    setNegocio(data ?? null)
    return data ?? null
  }

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

  // `extra` vai nos metadados da conta e é lido pelo servidor quando o
  // perfil nasce: codigo_convite (entrar numa agenda), papel_desejado
  // (autonoma | salao), nome_negocio, cidade. Ver 053.
  async function signUp(email, password, fullName, phone, extra = {}) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone, ...extra },
        // o link de confirmação volta pro lugar certo: quem abre negócio cai no onboarding, quem entra numa equipe no convite
        emailRedirectTo: window.location.origin + (extra.papel_desejado ? '/onboarding' : extra.equipe_codigo ? `/equipe/${extra.equipe_codigo}` : '/'),
      },
    })
    // Com "confirmar e-mail" ligado, o Supabase NÃO dá erro para e-mail
    // repetido (para não revelar quem tem conta): devolve um usuário
    // fantasma sem identidades. Sem esta linha o app diria "confira seu
    // e-mail" e nada chegaria.
    if (!error && data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { error: { message: 'User already registered' } }
    }
    return { error }
  }

  async function recarregarVinculos() {
    if (!session?.user) return
    const { data, error } = await supabase.rpc('minhas_agendas')
    if (error) { setErroRede(error.message); return }
    setErroRede('')
    setVinculos(Array.isArray(data) ? data : [])
  }

  // o app voltou do fundo (iPhone corta a rede lá): confere as agendas
  useEffect(() => {
    if (!isSupabaseConfigured) return
    function acordou() {
      if (document.visibilityState === 'visible' && session?.user && profile?.role === 'cliente') recarregarVinculos()
    }
    document.addEventListener('visibilitychange', acordou)
    return () => document.removeEventListener('visibilitychange', acordou)
  }, [session?.user?.id, profile?.role])

  async function signOut() {
    await supabase.auth.signOut()
  }

  // a admin com mais de um salão escolhe em qual está trabalhando
  function trocarSalao(id) {
    const alvo = saloes.find((x) => x.id === id)
    if (!alvo) return
    try { localStorage.setItem('mimo-salao-admin', id) } catch { /* sem armazenamento */ }
    setSalao(alvo)
  }

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    professional,
    salao,
    saloes,
    negocio,
    recarregarNegocio: () => (session?.user ? carregarNegocio(session.user.id) : Promise.resolve(null)),
    trocarSalao,
    vinculos,
    erroRede,
    recarregarVinculos,
    recarregarPerfil,
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
