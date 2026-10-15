// Artigos de cidade (3.14): um artigo do blog que fala de uma cidade do guia
// ganha, no fim, a caixa "Salões em <Cidade>" (a página da cidade e as
// categorias que ela tem) e aparece em "Leia também" na página da cidade.
// Nada de campo novo para preencher: a cidade é reconhecida pelo slug ou pelo
// título do artigo, sem acento e por palavra inteira ("Santos" não casa com
// "Todos os Santos" só porque a palavra existe? casa, sim: é o preço de não
// ter campo; o artigo de uma cidade do guia quase sempre a tem no título).
// Só cidades publicadas no guia contam.
import { semAcento } from './guia.js'

const palavras = (s) => ' ' + semAcento(String(s ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' '

// a cidade do guia de que o artigo fala, ou null. cidades: [{ cidade, cidade_slug, ... }]
export function cidadeDoArtigo(artigo, cidades) {
  if (!artigo || !Array.isArray(cidades) || !cidades.length) return null
  const slug = palavras(artigo.slug)
  const titulo = palavras(artigo.title ?? artigo.titulo)
  let achada = null
  for (const c of cidades) {
    const cs = String(c?.cidade_slug ?? '').toLowerCase()
    if (!cs) continue
    const nome = ' ' + cs.replace(/-/g, ' ') + ' '
    if (slug.includes(nome) || titulo.includes(nome)) {
      // "são vicente" ganha de "vicente"; a mais longa é a mais específica
      if (!achada || cs.length > String(achada.cidade_slug).length) achada = c
    }
  }
  return achada
}

// os artigos que falam desta cidade, na ordem em que vieram (os mais novos primeiro)
export function artigosDaCidade(artigos, cidadeSlug, cidades) {
  const cs = String(cidadeSlug ?? '').toLowerCase()
  const lista = Array.isArray(cidades) && cidades.length ? cidades : [{ cidade_slug: cs }]
  return (Array.isArray(artigos) ? artigos : []).filter((a) => a?.slug && cidadeDoArtigo(a, lista)?.cidade_slug === cs)
}
