import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Categorias de serviço (082): as da plataforma (salon_id nulo) e as de
// cada salão. Todo mundo lê; quem não tem categoria cai em "Outros".

export function useCategorias() {
  const [cats, setCats] = useState([])
  useEffect(() => {
    let vivo = true
    supabase.from('categorias_de_servico').select('id, salon_id, nome, ordem').order('ordem').order('nome')
      .then(({ data }) => { if (vivo) setCats(data ?? []) })
    return () => { vivo = false }
  }, [])
  return cats
}

// as que um salão pode usar: as da plataforma mais as dele
export function categoriasDoSalao(cats, salaoId) {
  return cats.filter((c) => !c.salon_id || c.salon_id === salaoId)
}

// [{ id, nome, ordem, itens }] na ordem das categorias; "Outros" por último
export function agruparPorCategoria(servicos, cats) {
  const porId = new Map(cats.map((c) => [c.id, c]))
  const grupos = new Map()
  for (const s of servicos ?? []) {
    const c = s?.categoria_id ? porId.get(s.categoria_id) : null
    const chave = c ? c.id : ''
    if (!grupos.has(chave)) grupos.set(chave, { id: chave, nome: c ? c.nome : 'Outros', ordem: c ? c.ordem : 999, itens: [] })
    grupos.get(chave).itens.push(s)
  }
  return [...grupos.values()].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome))
}

export function nomeDaCategoria(cats, id) {
  return cats.find((c) => c.id === id)?.nome ?? 'Outros'
}

// filtro de texto simples, sem acento e sem caixa
export function bate(texto, busca) {
  const n = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return !busca || n(texto).includes(n(busca))
}
