import { supabase } from './supabase'
import { doServidor } from './guiaPublico'
import { linksDeColecoes } from './guiaColecoes'
import { horasDe } from './guiaPanorama'
import { GUIA_CATEGORIAS } from './guia'

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
    // 3.23: primeiro o JSON que o gerador deixou no servidor; a função do banco é a reserva
    const pronto = await doServidor(`/dados/guia/${c}/colecoes.json`)
    if (pronto && Array.isArray(pronto.lugares)) return pronto
    if (!supabase) return null
    const { data, error } = await supabase.rpc('guia_colecoes', { cidade_: c })
    if (error) throw error
    return data && Array.isArray(data.lugares) ? data : null
  })().catch((e) => { cache.delete(c); throw e })
  cache.set(c, { em: Date.now(), promessa })
  return promessa
}

// 3.24: o que a página da cidade precisa das coleções, em alguns KB: os links de bairro e horário e as
// contagens de horário por categoria (o panorama). Primeiro o resumo.json do gerador; sem ele, a lista
// completa de cima e a conta aqui mesmo
const cacheResumo = new Map()
export function carregarResumo(cidade) {
  const c = String(cidade ?? '').trim().toLowerCase().replace(/\/+$/, '')
  const guardado = cacheResumo.get(c)
  if (guardado && Date.now() - guardado.em < VALIDADE) return guardado.promessa
  const promessa = (async () => {
    const pronto = await doServidor(`/dados/guia/${c}/resumo.json`)
    if (pronto && pronto.links && pronto.horas) return pronto
    const d = await carregarColecoes(c)
    if (!d) return null
    const horas = { '': horasDe(d.lugares) }
    for (const k of GUIA_CATEGORIAS) horas[k.slug] = horasDe(d.lugares.filter((l) => l.categoria === k.slug))
    return { links: linksDeColecoes(d.lugares, c), horas }
  })().catch((e) => { cacheResumo.delete(c); throw e })
  cacheResumo.set(c, { em: Date.now(), promessa })
  return promessa
}
