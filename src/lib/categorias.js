import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Categorias de serviço (082): as da plataforma (salon_id nulo) e as de
// cada salão. Todo mundo lê; quem não tem categoria cai em "Outros".
// Desde a 143 as da plataforma têm slug, descrição e `ativa`: uma inativa
// (Barba) continua valendo para quem já a usa, só não é oferecida.

export function useCategorias() {
  const [cats, setCats] = useState([])
  useEffect(() => {
    let vivo = true
    supabase.from('categorias_de_servico').select('id, salon_id, nome, ordem, slug, descricao, ativa, imagem_url').order('ordem').order('nome')
      .then(({ data }) => { if (vivo) setCats(data ?? []) })
    return () => { vivo = false }
  }, [])
  return cats
}

// as que um salão pode usar: as da plataforma que ele escolheu (124;
// sem escolha, todas as ativas) mais as dele. Uma da plataforma inativa só
// entra se o salão já a tinha escolhido.
export function categoriasDoSalao(cats, salaoId, escolhidas) {
  const marcadas = Array.isArray(escolhidas) && escolhidas.length ? new Set(escolhidas) : null
  return cats.filter((c) => (c.salon_id ? c.salon_id === salaoId : marcadas ? marcadas.has(c.id) : c.ativa !== false))
}

// só os ids escolhidos que existem de verdade (2.96.1): um id de categoria
// que sumiu não conta como "escolhida" nem libera etapa nenhuma. "Outros"
// também não: é só o lugar de quem não tem categoria, nunca aparece na grade
export function escolhidasValidas(cats, escolhidas) {
  if (!Array.isArray(escolhidas) || !escolhidas.length) return []
  const ids = new Set(cats.filter((c) => !c.salon_id && c.slug !== 'outros').map((c) => c.id))
  return escolhidas.filter((id) => ids.has(id))
}
// o salão tem alguma categoria de verdade (da plataforma escolhida, ou sua)?
export function temCategoria(cats, salaoId, escolhidas) {
  return escolhidasValidas(cats, escolhidas).length > 0 || cats.some((c) => c.salon_id && c.salon_id === salaoId)
}

// as da plataforma que dá para escolher hoje (as ativas)
export function categoriasOferecidas(cats) {
  return cats.filter((c) => !c.salon_id && c.ativa !== false)
}

// agrupar, nome, busca sem acento e capa padrão vivem em packages/core (compartilhado com o app)
export { agruparPorCategoria, nomeDaCategoria, bate, capaPadrao } from '../../packages/core/categorias.js'

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
