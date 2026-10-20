import { supabase } from './supabase'

// Os dados das páginas públicas do guia de salões (3.9). O público nunca lê
// as tabelas: tudo passa pelas funções guia_* do banco (153), que só
// entregam o que pode ir para a página.
//
// Cache em memória por chave: ir da cidade para um salão e voltar não
// pede tudo de novo. Vale por alguns minutos (a Plataforma pode aprovar
// uma página nesse meio tempo) e erro nunca fica guardado, para a
// próxima tentativa ir ao banco de verdade.

const VALIDADE = 5 * 60 * 1000
const cache = new Map()

function lembrar(chave, buscar) {
  const guardado = cache.get(chave)
  if (guardado && Date.now() - guardado.em < VALIDADE) return guardado.promessa
  const promessa = buscar().catch((e) => { cache.delete(chave); throw e })
  cache.set(chave, { em: Date.now(), promessa })
  return promessa
}

async function rpc(nome, args) {
  if (!supabase) return null
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw error
  return data ?? null
}

// 3.23: o gerador deixa os mesmos dados em JSON no servidor (/dados/guia/..., Caddy, gzip): de
// graça e sem passar pelo Supabase. Só cai na função do banco quando não há arquivo: no
// desenvolvimento, numa cidade recém-publicada antes da regeneração da hora, ou se o servidor
// devolver outra coisa (o Caddy responde o index.html para caminho que não existe).
export async function doServidor(caminho) {
  if (typeof fetch !== 'function' || typeof window === 'undefined' || window.location?.search?.includes('demo=')) return undefined
  try {
    const r = await fetch(caminho, { cache: 'no-cache', headers: { Accept: 'application/json' } })
    if (!r.ok || !/json/i.test(r.headers.get('content-type') ?? '')) return undefined
    const j = await r.json()
    return j && typeof j === 'object' ? j : undefined
  } catch { return undefined }
}

// os parâmetros da URL chegam como a pessoa digitou ("Itanhaem", "ro-coiffeur/")
const limpar = (v) => String(v ?? '').trim().toLowerCase().replace(/\/+$/, '')

// { lugar, vizinhos, mesma_categoria } | null (página não existe ou não está no ar)
export function carregarPagina(cidade, slug) {
  const c = limpar(cidade), s = limpar(slug)
  return lembrar(`pagina:${c}/${s}`, async () => (await doServidor(`/dados/guia/${c}/${s}.json`)) ?? rpc('guia_pagina', { cidade_: c, slug_: s }))
}

// a cidade (categoria vazia) ou uma categoria: { cidade, pagina, total, categorias, bairros, lugares } | null
export function carregarCidade(cidade, categoria = '') {
  const c = limpar(cidade), cat = limpar(categoria)
  return lembrar(`cidade:${c}/${cat}`, async () => (await doServidor(`/dados/guia/${c}${cat ? `/${cat}` : ''}.json`)) ?? rpc('guia_cidade', { cidade_: c, categoria_: cat }))
}

// 3.25: a lista da cidade (ou da categoria) vem por partes. O JSON da cidade traz a primeira parte e os totais
// em "lista" ({ total, partes, por_parte }); as outras partes ficam em /dados/guia/<cidade>/lista/<categoria|todos>-<n>.json
// e a lista inteira (busca, bairro, distância) em /dados/guia/<cidade>/lista/<categoria|todos>.json. Sem os arquivos
// (desenvolvimento, demo), a função do banco já mandou tudo de uma vez e a página nem chama estes dois.
// [cartões] | null (o arquivo não está lá)
export function carregarParte(cidade, categoria, n) {
  const c = limpar(cidade), cat = limpar(categoria) || 'todos'
  return lembrar(`parte:${c}/${cat}/${n}`, async () => {
    const d = await doServidor(`/dados/guia/${c}/lista/${cat}-${Number(n)}.json`)
    return Array.isArray(d?.lugares) ? d.lugares : null
  })
}
export function carregarListaInteira(cidade, categoria = '') {
  const c = limpar(cidade), cat = limpar(categoria)
  return lembrar(`lista:${c}/${cat}`, async () => {
    const d = await doServidor(`/dados/guia/${c}/lista/${cat || 'todos'}.json`)
    if (Array.isArray(d?.lugares)) return d.lugares
    // a reserva: a função do banco (desde a 173 só para quem está logado)
    const r = await rpc('guia_cidade', { cidade_: c, categoria_: cat })
    return Array.isArray(r?.lugares) ? r.lugares : null
  })
}

// [{ cidade, cidade_slug, uf, total }]
export function carregarCidades() {
  return lembrar('cidades', async () => {
    const r = (await doServidor('/dados/guia/cidades.json')) ?? (await rpc('guia_cidades', {}))
    return Array.isArray(r) ? r : []
  })
}

// 3.37: as regiões com as cidades de cada uma (o gerador deixa regioes.json; sem ele, guia_regioes())
export function carregarRegioes() {
  return lembrar('regioes', async () => {
    const r = (await doServidor('/dados/guia/regioes.json')) ?? (await rpc('guia_regioes', {}))
    return Array.isArray(r) ? r : []
  })
}

// "quero marcar aqui", "é meu salão", "corrigir", "remover".
// Devolve sempre { ok, repetido?, motivo? }: a tela só mostra o resultado.
export async function registrarInteresse(lugarId, tipo, { nome = '', contato = '', mensagem = '' } = {}) {
  if (!supabase) return { ok: false, motivo: 'sem conexão com a MIMO agora' }
  try {
    const { data, error } = await supabase.rpc('guia_registrar_interesse', {
      lugar_: lugarId,
      tipo_: tipo,
      nome_: String(nome ?? '').trim() || null,
      contato_: String(contato ?? '').trim() || null,
      mensagem_: String(mensagem ?? '').trim() || null,
    })
    if (error) return { ok: false, motivo: 'não deu para enviar agora; tente de novo em instantes' }
    // no demo a função pode não existir e voltar vazia: conta como enviado
    if (data == null) return { ok: true }
    return { ok: !!data.ok, repetido: !!data.repetido, motivo: data.motivo || null }
  } catch {
    return { ok: false, motivo: 'sem internet agora; confira a conexão e tente de novo' }
  }
}
