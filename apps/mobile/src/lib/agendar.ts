import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// O fluxo de marcar (serviços → data → hora → confirmar), com as mesmas
// regras da web (src/pages/cliente/Agendar.jsx). O que já foi escolhido
// viaja nos parâmetros da rota (prof, servico, data, hora, remarcar, extra):
// o voltar do celular volta UM passo, e um aviso pode abrir no passo certo.
//
// O mesmo fluxo serve para REMARCAR: chega com remarcar=<id do agendamento>,
// pula o passo do serviço e, no fim, abre um pedido de troca.
export type Escolhas = { prof: string; servico: string; data: string; hora: string; remarcar: string; extra: string }

export function useEscolhas(): Escolhas {
  const q = useLocalSearchParams<Partial<Record<keyof Escolhas, string>>>()
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''))
  return { prof: um(q.prof), servico: um(q.servico), data: um(q.data), hora: um(q.hora), remarcar: um(q.remarcar), extra: um(q.extra) }
}

// só o que tem valor entra nos parâmetros
export function paramsDe(obj: Partial<Escolhas>): Record<string, string> {
  const r: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) if (v) r[k] = v
  return r
}

// outras partes da visita, com outras profissionais do salão: servico_prof_hora
export type Extra = { servico: string; prof: string; hora: string }
export function lerExtras(extra: string): Extra[] {
  return (extra || '')
    .split(',')
    .filter(Boolean)
    .map((x) => {
      const [servico, prof, hora] = x.split('_')
      return servico && prof && hora ? { servico, prof, hora } : null
    })
    .filter((x): x is Extra => Boolean(x))
}
export const escreverExtras = (lista: Extra[]) => lista.map((x) => `${x.servico}_${x.prof}_${x.hora}`).join(',')

export function somarMin(hora: string, min: number): string {
  const [h, m] = hora.split(':').map(Number)
  const tot = (h ?? 0) * 60 + (m ?? 0) + Number(min || 0)
  return `${String(Math.floor(tot / 60) % 24).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`
}
export function diffMin(a: string, b: string): number {
  const [h1, m1] = a.split(':').map(Number)
  const [h2, m2] = b.split(':').map(Number)
  return (h2 ?? 0) * 60 + (m2 ?? 0) - ((h1 ?? 0) * 60 + (m1 ?? 0))
}

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
// "ter, 13/10"
export function curta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number)
  const dt = new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1)
  return `${DIAS_CURTOS[dt.getDay()]}, ${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`
}
export const capitalizar = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t)

export type Servico = {
  id: string
  name: string
  description: string | null
  price: number
  duration_minutes: number
  active: boolean
  images: string[] | null
  is_combo: boolean
  categoria_id: string | null
  a_partir?: boolean | null
}
export type Profissional = { id: string; name: string; photo_url: string | null; slug: string | null; salon_id: string | null }
// vários serviços viram um só para o resto do fluxo: nome junto, duração e preço somados
export type ServicoJunto = Servico & { ids: string[]; lista: Servico[] }

export function juntar(ids: string[], lista: Servico[] | null): ServicoJunto | null {
  if (!lista?.length) return null
  const ordenada = ids.map((id) => lista.find((x) => x.id === id)).filter((x): x is Servico => Boolean(x))
  if (ordenada.length === 0) return null
  if (ordenada.length === 1) return { ...ordenada[0]!, ids, lista: ordenada }
  return {
    ...ordenada[0]!,
    ids,
    lista: ordenada,
    name: ordenada.map((x) => x.name).join(' + '),
    price: ordenada.reduce((a, x) => a + Number(x.price ?? 0), 0),
    duration_minutes: ordenada.reduce((a, x) => a + Number(x.duration_minutes ?? 0), 0),
    is_combo: ordenada.some((x) => x.is_combo),
  }
}

// a profissional e o(s) serviço(s) a partir dos ids, com o preço e a duração
// dela quando o salão configurou diferente (119)
export function useContexto(profId: string, servicoParam: string) {
  const [prof, setProf] = useState<Profissional | null>(null)
  const [servico, setServico] = useState<ServicoJunto | null>(null)
  const [carregado, setCarregado] = useState(false)
  const chave = (servicoParam || '').split(',').filter(Boolean).join(',')
  useEffect(() => {
    let vivo = true
    const ids = chave.split(',').filter(Boolean)
    ;(async () => {
      const [p, s] = await Promise.all([
        profId ? supabase.from('professionals').select('id, name, photo_url, slug, salon_id').eq('id', profId).maybeSingle() : Promise.resolve({ data: null }),
        ids.length ? supabase.from('services').select('*').in('id', ids) : Promise.resolve({ data: null }),
      ])
      if (!vivo) return
      setProf((p.data as Profissional | null) ?? null)
      let lista = (s.data as Servico[] | null) ?? null
      if (profId && ids.length && lista?.length) {
        const { data: pr } = await supabase.from('professional_services').select('service_id, preco_cents, duracao_minutos').eq('professional_id', profId).in('service_id', ids)
        if (!vivo) return
        const ov = (pr ?? []) as { service_id: string; preco_cents: number | null; duracao_minutos: number | null }[]
        lista = lista.map((x) => {
          const o = ov.find((y) => y.service_id === x.id)
          return o ? { ...x, price: o.preco_cents != null ? o.preco_cents / 100 : x.price, duration_minutes: o.duracao_minutos ?? x.duration_minutes } : x
        })
      }
      setServico(juntar(ids, lista))
      setCarregado(true)
    })()
    return () => {
      vivo = false
    }
  }, [profId, chave])
  return { prof, servico, carregado }
}

export type Origem = { id: string; date: string; start_time: string; end_time: string | null; status: string; service_id: string | null; professional_id: string | null }
// o agendamento que está sendo trocado, quando é remarcação
export function useOrigem(id: string): Origem | null {
  const [origem, setOrigem] = useState<Origem | null>(null)
  useEffect(() => {
    if (!id) return
    let vivo = true
    supabase
      .from('appointments')
      .select('id, date, start_time, end_time, status, service_id, professional_id')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (vivo) setOrigem((data as Origem | null) ?? null)
      })
    return () => {
      vivo = false
    }
  }, [id])
  return origem
}

export type Categoria = { id: string; salon_id: string | null; nome: string; ordem: number; slug: string | null; ativa: boolean | null }
export function useCategorias(): Categoria[] {
  const [cats, setCats] = useState<Categoria[]>([])
  useEffect(() => {
    let vivo = true
    supabase
      .from('categorias_de_servico')
      .select('id, salon_id, nome, ordem, slug, ativa')
      .order('ordem')
      .order('nome')
      .then(({ data }) => {
        if (vivo) setCats((data ?? []) as Categoria[])
      })
    return () => {
      vivo = false
    }
  }, [])
  return cats
}
