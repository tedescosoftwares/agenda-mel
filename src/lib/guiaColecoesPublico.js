import { supabase } from './supabase'

// Os dados das páginas de coleção do guia (3.12): os salões no ar de uma
// cidade, com bairro, categoria, horário, serviços e atributos, pela
// função guia_colecoes() do banco (157), que nunca entrega nota. Quais
// coleções existem e o texto de cada uma saem de guiaColecoes.js.
//
// A página da cidade pede junto (para os links "Por bairro" e "Por
// horário"); quem toca num desses links já encontra tudo aqui. Cache em
// memória de alguns minutos, como guiaPublico.js; erro nunca fica guardado.

const VALIDADE = 5 * 60 * 1000
const cache = new Map()

// { cidade, cidade_slug, uf, lugares: [...] } | null (cidade sem salão no ar)
export function carregarColecoes(cidade) {
  const c = String(cidade ?? '').trim().toLowerCase().replace(/\/+$/, '')
  const guardado = cache.get(c)
  if (guardado && Date.now() - guardado.em < VALIDADE) return guardado.promessa
  const promessa = (async () => {
    if (!supabase) return null
    const { data, error } = await supabase.rpc('guia_colecoes', { cidade_: c })
    if (error) throw error
    return data && Array.isArray(data.lugares) ? data : null
  })().catch((e) => { cache.delete(c); throw e })
  cache.set(c, { em: Date.now(), promessa })
  return promessa
}
