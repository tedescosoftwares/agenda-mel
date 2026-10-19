// O guia de salões, cidade a cidade e só o que mudou (3.23, migração 171).
//
// Até a 3.22 o gerador pedia guia_publicadas() de uma vez: o guia inteiro numa resposta (100 MB
// com 20 mil salões) e, no banco, uma busca de vizinhos por salão que crescia com o quadrado da
// cidade. Agora cada cidade vem numa chamada, com um "desde": o banco devolve todos os slugs na
// ordem do site, os salões que mudaram desde a última rodada, as páginas da cidade e a lista de
// cidades, em fatias de até FATIA salões por chamada (172: uma cidade grande inteira numa
// resposta passava dos ~4 s que o Supabase dá a uma consulta pública). O resto vem do cache em
// disco (.cache/guia/<cidade>.json), e os vizinhos são calculados aqui, em memória. Uma rodada
// de hora em hora sem novidade pede alguns KB por cidade.
//
//   carregarGuia({ url, chave, cacheDir, refazer }) -> { lugares, paginas, cidades }
//     lugares  todos os salões no ar, na ordem do site, cada um com "vizinhos" (os 6 mais perto)
//   lerCidade({ buscar, slug, cacheDir })            uma cidade (buscar(slug, desde) é a chamada ao banco)
//   vizinhosDe(l, todos) / mesmaCategoriaDe(l, todos) / cartaoDe(l)   o mesmo cartão de guia_cartao()
//
// Cuidados: o "desde" recua 15 min (uma transação que fechou depois do nosso instante com um
// carimbo anterior não se perde); uma vez por dia a cidade vem inteira (foto de salão na MIMO não
// anda o carimbo do guia); se o banco falha e há cache, a rodada segue com o cache e avisa; slug
// na ordem sem linha no cache manda buscar a cidade inteira de novo.
import fs from 'node:fs'
import path from 'node:path'

export const REFAZER_APOS_MS = 24 * 60 * 60 * 1000
export const SOBRA_MS = 15 * 60 * 1000
export const VERSAO_DO_CACHE = 1
export const FATIA = 200 // salões por chamada (a função aceita até 500)

const arquivoDe = (dir, slug) => path.join(dir, `${slug}.json`)
function lerCache(arq) {
  try {
    const c = JSON.parse(fs.readFileSync(arq, 'utf8'))
    return c && c.versao === VERSAO_DO_CACHE && c.lugares && typeof c.lugares === 'object' && Array.isArray(c.ordem) ? c : null
  } catch { return null }
}
function gravarCache(arq, c) {
  fs.mkdirSync(path.dirname(arq), { recursive: true })
  const tmp = `${arq}.${globalThis.process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(c))
  fs.renameSync(tmp, arq)
}
const montar = (c) => ({ cidade: c.cidade, cidade_slug: c.cidade_slug, uf: c.uf, lugares: c.ordem.map((s) => c.lugares[s]).filter(Boolean), paginas: Array.isArray(c.paginas) ? c.paginas : [] })

export async function lerCidade({ buscar, slug, cacheDir, refazer = false, agora = Date.now(), log = () => {} }) {
  const arq = arquivoDe(cacheDir, slug)
  const cache = lerCache(arq)
  const velho = !cache || !cache.agora || !Number.isFinite(Date.parse(cache.agora)) || agora - Date.parse(cache.agora) > REFAZER_APOS_MS
  const inteira = refazer || velho
  let desde = inteira ? null : new Date(Date.parse(cache.agora) - SOBRA_MS).toISOString()
  let r
  try { r = await buscar(slug, desde) } catch (e) {
    if (cache) { log(`guia: ${slug} indisponível (${e.message}); fica o cache de ${cache.agora}`); return { ...montar(cache), doCache: true, novos: 0 } }
    throw e
  }
  let lugares = desde ? { ...cache.lugares } : {}
  const aplicar = (resp) => { for (const l of resp?.lugares ?? []) if (l?.slug) lugares[l.slug] = l }
  aplicar(r)
  let ordem = (r?.slugs ?? []).map((s) => s?.slug).filter(Boolean)
  if (desde && ordem.some((s) => !lugares[s])) {
    log(`guia: ${slug}: cache incompleto, buscando a cidade inteira`)
    r = await buscar(slug, null); desde = null; lugares = {}; aplicar(r)
    ordem = (r?.slugs ?? []).map((s) => s?.slug).filter(Boolean)
  }
  const vivos = new Set(ordem)
  for (const k of Object.keys(lugares)) if (!vivos.has(k)) delete lugares[k]
  const novo = {
    versao: VERSAO_DO_CACHE, cidade: r?.cidade ?? cache?.cidade ?? slug, cidade_slug: slug, uf: r?.uf ?? cache?.uf ?? 'SP',
    agora: r?.agora ?? new Date(agora).toISOString(), ordem, lugares, paginas: Array.isArray(r?.paginas) ? r.paginas : [],
  }
  gravarCache(arq, novo)
  return { ...montar(novo), novos: (r?.lugares ?? []).length, inteira: !desde }
}

// o mesmo cartão de guia_cartao() (164): o que as listas e os vizinhos mostram
export const cartaoDe = (l) => ({
  slug: l.slug, nome: l.nome, bairro: l.bairro ?? null, categoria: l.categoria, resumo: l.conteudo?.resumo ?? null,
  servicos: (Array.isArray(l.servicos) ? l.servicos : []).slice(0, 4), selecao: !!l.selecao, na_mimo: !!l.na_mimo,
  latitude: l.latitude ?? null, longitude: l.longitude ?? null, foto: Array.isArray(l.fotos) && l.fotos[0] ? l.fotos[0] : null,
})
// os n menores sem ordenar a lista inteira (cada salão olha a cidade toda: 4 mil x 4 mil cabe assim)
function menores(itens, n, chave, desempate) {
  const top = []
  for (const x of itens) {
    const k = chave(x)
    if (top.length === n && (k > top[n - 1].k || (k === top[n - 1].k && desempate(x, top[n - 1].x) >= 0))) continue
    let i = top.length
    while (i > 0 && (top[i - 1].k > k || (top[i - 1].k === k && desempate(top[i - 1].x, x) > 0))) i--
    top.splice(i, 0, { k, x })
    if (top.length > n) top.pop()
  }
  return top.map((t) => t.x)
}
const porNome = (a, b) => String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR')
// a mesma distância de guia_vizinhos() (153): pelas coordenadas quando as duas têm; senão o mesmo bairro vale 0
export function vizinhosDe(l, todos, quantos = 6) {
  const temGeo = l.latitude != null && l.longitude != null
  const cosLat = temGeo ? Math.cos((Number(l.latitude) * Math.PI) / 180) : 0
  const d = (o) => {
    if (temGeo && o.latitude != null && o.longitude != null) return (Number(o.latitude) - Number(l.latitude)) ** 2 + ((Number(o.longitude) - Number(l.longitude)) * cosLat) ** 2
    return (o.bairro ?? null) === (l.bairro ?? null) ? 0 : 1e9
  }
  return menores(todos.filter((o) => o.slug !== l.slug), quantos, d, porNome).map(cartaoDe)
}
// os 8 da mesma categoria, na ordem do site (o que guia_pagina() devolve em mesma_categoria)
export const mesmaCategoriaDe = (l, todos, quantos = 8) => todos.filter((o) => o.categoria === l.categoria && o.slug !== l.slug).slice(0, quantos).map(cartaoDe)
export const comVizinhos = (lugares) => lugares.map((l) => ({ ...l, vizinhos: vizinhosDe(l, lugares) }))

// a cidade em fatias (172): a primeira traz os slugs e as páginas; as outras só os salões, a partir do último slug
export async function buscarCidade(rpc, slug, desde, fatia = FATIA, chave = '') {
  let primeira = null, depois = ''
  const lugares = []
  for (let n = 0; n < 1000; n++) {
    const r = await rpc('guia_publicadas', { cidade_: slug, desde_: desde, depois_: depois, limite_: fatia, chave_: chave })
    if (!primeira) primeira = r
    const lote = Array.isArray(r?.lugares) ? r.lugares : []
    lugares.push(...lote)
    if (lote.length < fatia || !lote[lote.length - 1]?.slug) break
    depois = lote[lote.length - 1].slug
  }
  return { ...primeira, lugares }
}

// chaveGerador: a chave que guia_publicadas exige desde a 173 (GUIA_CHAVE_GERADOR no .env da Evolution)
export async function carregarGuia({ url, chave, cacheDir, refazer = false, log = console.log, fetchFn = globalThis.fetch, fatia = FATIA, chaveGerador = '' }) {
  const rpc = async (nome, corpo) => {
    const r = await fetchFn(`${url}/rest/v1/rpc/${nome}`, { method: 'POST', headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
    if (!r.ok) {
      // o motivo vai no erro: "57014 statement timeout" diz muito mais que um 500
      const corpoErro = typeof r.text === 'function' ? await r.text().catch(() => '') : ''
      throw new Error(`${r.status} em rpc/${nome}${corpoErro ? `: ${corpoErro.slice(0, 160)}` : ''}`)
    }
    return r.json()
  }
  if (!chaveGerador) log('guia-fonte: sem GUIA_CHAVE_GERADOR no .env; a função do guia recusa sem a chave (173). Leia: select valor from public.guia_segredos where nome = \'gerador\'')
  const cidades = await rpc('guia_cidades', {})
  if (!Array.isArray(cidades)) throw new Error('guia_cidades não devolveu a lista de cidades')
  const lugares = [], paginas = []
  let novos = 0, doCache = 0
  for (const c of cidades) {
    if (!c?.cidade_slug) continue
    const d = await lerCidade({ buscar: (slug, desde) => buscarCidade(rpc, slug, desde, fatia, chaveGerador), slug: c.cidade_slug, cacheDir, refazer, log })
    lugares.push(...comVizinhos(d.lugares))
    paginas.push(...d.paginas)
    novos += d.novos ?? 0
    if (d.doCache) doCache++
  }
  // cidade que saiu do guia não deixa cache para trás
  try {
    for (const f of fs.readdirSync(cacheDir)) {
      if (f.endsWith('.json') && !cidades.some((c) => c.cidade_slug === f.slice(0, -5))) fs.rmSync(path.join(cacheDir, f), { force: true })
    }
  } catch { /* ainda sem a pasta */ }
  log(`guia-fonte: ${cidades.length} cidade(s), ${lugares.length} salões no ar, ${novos} lido(s) do banco nesta rodada${doCache ? `, ${doCache} cidade(s) do cache por falha no banco` : ''}`)
  return { lugares, paginas, cidades }
}
