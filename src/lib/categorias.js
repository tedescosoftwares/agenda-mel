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

// capa padrão quando ninguém subiu imagem: um gradiente da marca que
// muda com o nome, para cada categoria ter a sua cara
const TONS = [['#FF2D7A', '#AA4CFF'], ['#AA4CFF', '#FF7BAA'], ['#FF7BAA', '#FF2D7A'], ['#1F2026', '#AA4CFF'], ['#FF9A6C', '#FF2D7A'], ['#6C4CFF', '#FF7BAA']]
export function capaPadrao(nome) {
  let h = 0
  for (const ch of String(nome ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const [a, b] = TONS[h % TONS.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="1200" height="400" fill="url(#g)"/><circle cx="1040" cy="60" r="150" fill="rgba(255,255,255,0.16)"/><circle cx="160" cy="380" r="200" fill="rgba(255,255,255,0.10)"/></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

// as capas de um salão: a dele, senão a padrão da plataforma (087)
export function useCapas(salaoId) {
  const [capas, setCapas] = useState({})
  useEffect(() => {
    if (!salaoId) { setCapas({}); return }
    let vivo = true
    supabase.rpc('capas_do_salao', { salao: salaoId }).then(({ data }) => { if (vivo) setCapas(Object.fromEntries((data ?? []).map((c) => [c.categoria_id, c.imagem_url]))) })
    return () => { vivo = false }
  }, [salaoId])
  return capas
}
