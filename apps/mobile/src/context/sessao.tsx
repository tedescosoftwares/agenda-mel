import type { Session, User } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'

// A sessão do app: a mesma conta do site, guardada no aparelho. As telas
// nativas usam o que está aqui; a ponte (web.tsx) empresta a sessão para a web.
export type Perfil = {
  id: string
  full_name: string | null
  phone: string | null
  avatar_url: string | null
  role: string | null
}

type Valor = {
  sessao: Session | null
  usuario: User | null
  perfil: Perfil | null
  carregando: boolean
  entrar: (email: string, senha: string) => Promise<string | null>
  sair: () => Promise<void>
  recarregarPerfil: () => Promise<void>
}

const Contexto = createContext<Valor | null>(null)

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null)
  // o perfil carregado fica amarrado ao uid: trocou de conta, some sozinho
  const [carregado, setCarregado] = useState<{ uid: string; perfil: Perfil | null } | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let vivo = true
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!vivo) return
        setSessao(data.session)
        setCarregando(false)
      })
      .catch(() => {
        if (vivo) setCarregando(false)
      })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_evento, s) => {
      if (vivo) setSessao(s)
    })
    return () => {
      vivo = false
      subscription.unsubscribe()
    }
  }, [])

  const uid = sessao?.user.id ?? null
  const perfil = carregado && carregado.uid === uid ? carregado.perfil : null

  useEffect(() => {
    if (!uid) return
    let vivo = true
    buscarPerfil(uid).then((p) => {
      if (vivo) setCarregado({ uid, perfil: p })
    })
    return () => {
      vivo = false
    }
  }, [uid])

  const recarregarPerfil = useCallback(async () => {
    if (!uid) return
    const p = await buscarPerfil(uid)
    setCarregado({ uid, perfil: p })
  }, [uid])

  const entrar = useCallback(async (email: string, senha: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha })
    return error ? traduzir(error.message) : null
  }, [])

  const sair = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const valor = useMemo<Valor>(
    () => ({ sessao, usuario: sessao?.user ?? null, perfil, carregando, entrar, sair, recarregarPerfil }),
    [sessao, perfil, carregando, entrar, sair, recarregarPerfil],
  )
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useSessao(): Valor {
  const v = useContext(Contexto)
  if (!v) throw new Error('useSessao precisa estar dentro de SessaoProvider')
  return v
}

async function buscarPerfil(uid: string): Promise<Perfil | null> {
  const { data } = await supabase.from('profiles').select('id, full_name, phone, avatar_url, role').eq('id', uid).maybeSingle()
  return (data as Perfil | null) ?? null
}

function traduzir(m: string): string {
  if (/invalid login credentials/i.test(m)) return 'E-mail ou senha não conferem.'
  if (/email not confirmed/i.test(m)) return 'Confirma seu e-mail antes de entrar (olha a caixa de entrada).'
  if (/rate limit|too many/i.test(m)) return 'Muitas tentativas. Espera um minuto e tenta de novo.'
  if (/network|fetch|failed/i.test(m)) return 'Sem conexão agora. Tenta de novo.'
  return m
}
