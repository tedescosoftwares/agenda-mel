import type { Session, User } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { ligarAvisos, desligarAvisos } from '@/lib/avisos'
import { VARIANTE } from '@/lib/config'
import { guardarContaErrada } from '@/lib/contaErrada'
import { lerConvite, limparConvite } from '@/lib/convite'

// A sessão do app: a mesma conta do site, guardada no aparelho. Todas as
// telas usam o que está aqui.
export type Perfil = {
  id: string
  full_name: string | null
  phone: string | null
  avatar_url: string | null
  role: string | null
  nascimento: string | null
  accepts_reminders: boolean | null
  aceita_email: boolean | null
  aceitou_termos_em: string | null
}

type Valor = {
  sessao: Session | null
  usuario: User | null
  perfil: Perfil | null
  // o perfil deste uid já foi buscado (mesmo que não exista): a trava do Google espera por isto
  perfilPronto: boolean
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
  const perfilPronto = Boolean(carregado && carregado.uid === uid)

  useEffect(() => {
    if (!uid) return
    let vivo = true
    buscarPerfil(uid).then(async (p) => {
      if (!vivo) return
      // o app é só da cliente (3.65): conta de salão ou profissional sai na hora, e a tela
      // de entrar explica (lib/contaErrada.ts). O perfil nem chega a ser guardado: as abas
      // não aparecem (o _layout espera perfilPronto).
      if (VARIANTE === 'cliente' && p?.role && p.role !== 'cliente') {
        await guardarContaErrada(p.role)
        await desligarAvisos().catch(() => {})
        await supabase.auth.signOut()
        return
      }
      setCarregado({ uid, perfil: p })
      // entrou por um link /v/<código> antes de entrar na conta? entra na agenda agora
      // (quem se cadastrou já entrou pelo servidor; aqui é quem já tinha conta, ou quem
      // entrou pelo Google — 3.60 — e tem o código guardado)
      if (p?.role === 'cliente') {
        const convite = await lerConvite()
        if (!convite) return
        const { error } = await supabase.rpc('vincular', { codigo: convite, jeito: 'link' })
        if (!error) await limparConvite()
      }
    })
    return () => {
      vivo = false
    }
  }, [uid])

  // com sessão, o aparelho passa a receber os avisos (token do Expo Push no banco)
  useEffect(() => {
    if (uid) ligarAvisos().catch(() => {})
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
    await desligarAvisos()
    await supabase.auth.signOut()
  }, [])

  const valor = useMemo<Valor>(
    () => ({ sessao, usuario: sessao?.user ?? null, perfil, perfilPronto, carregando, entrar, sair, recarregarPerfil }),
    [sessao, perfil, perfilPronto, carregando, entrar, sair, recarregarPerfil],
  )
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useSessao(): Valor {
  const v = useContext(Contexto)
  if (!v) throw new Error('useSessao precisa estar dentro de SessaoProvider')
  return v
}

async function buscarPerfil(uid: string): Promise<Perfil | null> {
  const { data } = await supabase.from('profiles').select('id, full_name, phone, avatar_url, role, nascimento, accepts_reminders, aceita_email, aceitou_termos_em').eq('id', uid).maybeSingle()
  return (data as Perfil | null) ?? null
}

function traduzir(m: string): string {
  const texto = /invalid login credentials/i.test(m)
    ? 'E-mail ou senha não conferem.'
    : /email not confirmed/i.test(m)
      ? 'Confirma seu e-mail antes de entrar (olha a caixa de entrada).'
      : /rate limit|too many/i.test(m)
        ? 'Muitas tentativas. Espera um minuto e tenta de novo.'
        : /network|fetch|failed/i.test(m)
          ? 'Sem conexão com o Supabase. Confere a internet do celular e o .env do app.'
          : m
  // em desenvolvimento o erro original ajuda a achar a causa
  return __DEV__ && texto !== m ? `${texto} (${m})` : texto
}
