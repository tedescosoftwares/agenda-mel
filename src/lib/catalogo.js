import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { indexar } from './catalogoBusca'
import { capaPadrao } from './categorias'

// O catálogo carregado uma vez por sessão (2.91): ~500 linhas da view
// catalogo_visivel e as categorias da plataforma, indexados em memória.
// A busca roda em cima disto, sem ir ao banco a cada tecla.
let cache = null
let emVoo = null

export async function carregarCatalogo({ forcar = false } = {}) {
  if (cache && !forcar) return cache
  if (emVoo) return emVoo
  emVoo = (async () => {
    try {
      const [{ data: itens, error }, { data: cats }] = await Promise.all([
        supabase.from('catalogo_visivel').select('*').order('nivel').order('ordem'),
        supabase.from('categorias_de_servico').select('id, nome, slug, descricao, aliases, ordem, ativa, imagem_url').is('salon_id', null).order('ordem'),
      ])
      if (error) console.warn('[catalogo] não carregou:', error.message)
      cache = indexar(itens ?? [], (cats ?? []).filter((c) => c.ativa !== false))
      return cache
    } finally { emVoo = null }
  })()
  return emVoo
}

export function esquecerCatalogo() { cache = null }

export function useCatalogo() {
  const [indice, setIndice] = useState(cache)
  useEffect(() => { let vivo = true; carregarCatalogo().then((i) => { if (vivo) setIndice(i) }); return () => { vivo = false } }, [])
  return indice
}

// a imagem da categoria no cadastro: a convenção /imagens/catalogo/<slug>.webp
// (a MIMO fornece depois); sem arquivo o <img> falha e o cartão cai no
// gradiente da marca. imagem_url da categoria (087) vem antes, se houver.
export function imagemDaCategoria(cat) {
  if (!cat) return capaPadrao('')
  return cat.imagem_url || (cat.slug ? `/imagens/catalogo/${cat.slug}.webp` : capaPadrao(cat.nome))
}
export { capaPadrao }
