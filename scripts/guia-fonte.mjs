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
//   carregarGuia({ url, chave, cacheDir, refazer }) -> { lugares, paginas, cidades, categorias_imagens, regioes }
//     lugares  todos os salões no ar, na ordem do site, cada um com "vizinhos" (os 6 mais perto)
//     categorias_imagens  { categoria: url } (3.33, migração 180): a imagem de cada categoria, igual em todas as cidades
//   lerCidade({ buscar, slug, cacheDir })            uma cidade (buscar(slug, desde) é a chamada ao banco)
//   vizinhosDe(l, todos) / mesmaCategoriaDe(l, todos) / cartaoDe(l)   o mesmo cartão de guia_cartao()
//
// Cuidados: o "desde" recua 15 min (uma transação que fechou depois do nosso instante com um
// carimbo anterior não se perde); uma vez por dia a cidade vem inteira (foto de salão na MIMO não
// anda o carimbo do guia); se o banco falha e há cache, a rodada segue com o cache e avisa; slug
// na ordem sem linha no cache manda buscar a cidade inteira de novo.
// 3.40: sem a lista de cidades do banco, as do cache e das regiões (cidadesDeReserva) e os números contados aqui.
// 3.38.2: uma fatia que passa do tempo do banco vai de novo pela metade (até FATIA_MINIMA); uma
// cidade que falha sem cache fica de fora da rodada, com o nome no log (foraDaRodada), em vez de
// derrubar o guia inteiro: as outras cidades saem, e as páginas que ela já tinha no ar ficam.
import fs from 'node:fs'
import path from 'node:path'

export const REFAZER_APOS_MS = 24 * 60 * 60 * 1000
export const SOBRA_MS = 15 * 60 * 1000
export const VERSAO_DO_CACHE = 1
export const FATIA = 200 // salões por chamada (a função aceita até 500)
export const FATIA_MINIMA = 25
export const ehTempoEsgotado = (e) => /statement timeout|canceling statement|57014/i.test(String(e?.message ?? e))

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
const mapa = (m) => (m && typeof m === 'object' && !Array.isArray(m) ? m : null)
const montar = (c) => ({ cidade: c.cidade, cidade_slug: c.cidade_slug, uf: c.uf, lugares: c.ordem.map((s) => c.lugares[s]).filter(Boolean), paginas: Array.isArray(c.paginas) ? c.paginas : [], categorias_imagens: mapa(c.categorias_imagens) })

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
    // a primeira fatia traz as imagens das categorias (180); um banco sem a 180 não manda nada e fica o que o cache tinha
    categorias_imagens: mapa(r?.categorias_imagens) ?? mapa(cache?.categorias_imagens),
  }
  gravarCache(arq, novo)
  return { ...montar(novo), novos: (r?.lugares ?? []).length, inteira: !desde }
}

// o mesmo cartão de guia_cartao() (164): o que as listas e os vizinhos mostram
export const cartaoDe = (l) => ({
  slug: l.slug, nome: l.nome, bairro: l.bairro ?? null, categoria: l.categoria, resumo: l.conteudo?.resumo ?? null,
  servicos: (Array.isArray(l.servicos) ? l.servicos : []).slice(0, 4), selecao: !!l.selecao, na_mimo: !!l.na_mimo,
  latitude: l.latitude ?? null, longitude: l.longitude ?? null, foto: Array.isArray(l.fotos) && l.fotos[0] ? l.fotos[0] : null,
  // 3.69: os pontos (foto + nota do Google, migração 185) vão no cartão: o app ordena "perto de você" por eles
  pontos: typeof l.pontos === 'number' && Number.isFinite(l.pontos) ? l.pontos : null,
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
  let primeira = null, depois = '', lim = Math.max(1, fatia)
  const lugares = []
  for (let n = 0; n < 2000; n++) {
    let r
    try {
      r = await rpc('guia_publicadas', { cidade_: slug, desde_: desde, depois_: depois, limite_: lim, chave_: chave })
    } catch (e) {
      // 3.38.2: a fatia passou do tempo do banco: a mesma fatia de novo, pela metade
      if (ehTempoEsgotado(e) && lim > FATIA_MINIMA) { lim = Math.max(FATIA_MINIMA, Math.floor(lim / 2)); continue }
      throw e
    }
    if (!primeira) primeira = r
    const lote = Array.isArray(r?.lugares) ? r.lugares : []
    lugares.push(...lote)
    if (lote.length < lim || !lote[lote.length - 1]?.slug) break
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
  // 3.37: as regiões com as cidades de cada uma (migração 182); num banco sem a função, a semente do core faz as vezes
  let regioes = []
  try { const r = await rpc('guia_regioes', {}); regioes = Array.isArray(r) ? r : [] } catch (e) { log(`guia-fonte: sem guia_regioes() (${String(e.message).slice(0, 80)}); as regiões vêm da semente do código`) }
  // 3.40: a lista de cidades. Se o banco não a entregar (antes da 188 ela contava a tabela inteira e passava do tempo),
  // a rodada segue com as cidades do cache e das regiões, e os números de cada cidade saem dos próprios salões
  let cidades
  let cidadesDoBanco = true
  try {
    cidades = await rpc('guia_cidades', {})
    if (!Array.isArray(cidades)) throw new Error('guia_cidades não devolveu a lista de cidades')
  } catch (e) {
    const reserva = cidadesDeReserva(cacheDir, regioes)
    if (!reserva.length) throw e
    cidadesDoBanco = false
    cidades = reserva
    log(`guia-fonte: a lista de cidades não veio do banco (${String(e?.message ?? e).slice(0, 120)}); sigo com ${reserva.length} cidade(s) do cache e das regiões, e os números saem dos próprios salões`)
  }
  const lugares = [], paginas = []
  let novos = 0
  const doCache = [], foraDaRodada = [] // 3.38.2: por nome, para o log dizer qual cidade ficou no cache ou de fora
  // as imagens das categorias valem para todas as cidades: a de uma cidade lida do banco nesta rodada; senão, a do cache
  let imagens = null, imagensDoCache = null
  for (const c of cidades) {
    if (!c?.cidade_slug) continue
    let d
    try {
      d = await lerCidade({ buscar: (slug, desde) => buscarCidade(rpc, slug, desde, fatia, chaveGerador), slug: c.cidade_slug, cacheDir, refazer, log })
    } catch (e) {
      // sem cache e sem banco: a cidade fica de fora desta rodada; as outras saem, e as páginas dela no ar ficam
      const motivo = String(e?.message ?? e)
      foraDaRodada.push({ cidade_slug: c.cidade_slug, erro: motivo })
      log(`guia: ${c.cidade_slug} indisponível e sem cache (${motivo.slice(0, 160)}); fica de fora desta rodada, e o que ela já tem no ar fica`)
      continue
    }
    lugares.push(...comVizinhos(d.lugares))
    paginas.push(...d.paginas)
    novos += d.novos ?? 0
    if (d.doCache) { doCache.push(c.cidade_slug); imagensDoCache ??= d.categorias_imagens } else imagens ??= d.categorias_imagens
  }
  // cidade que saiu do guia não deixa cache para trás (só com a lista do banco: a de reserva não é a lista inteira)
  if (cidadesDoBanco) try {
    for (const f of fs.readdirSync(cacheDir)) {
      if (f.endsWith('.json') && !cidades.some((c) => c.cidade_slug === f.slice(0, -5))) fs.rmSync(path.join(cacheDir, f), { force: true })
    }
  } catch { /* ainda sem a pasta */ }
  const fora = new Set(foraDaRodada.map((x) => x.cidade_slug))
  log(`guia-fonte: ${cidades.length} cidade(s), ${lugares.length} salões no ar, ${novos} lido(s) do banco nesta rodada${doCache.length ? `, ${doCache.length} cidade(s) do cache por falha no banco (${doCache.join(', ')})` : ''}${fora.size ? `, ${fora.size} cidade(s) FORA desta rodada (${[...fora].join(', ')})` : ''}`)
  const lista = cidadesDoBanco ? cidades.filter((c) => !fora.has(c?.cidade_slug)) : cidadesDosSaloes(lugares, paginas)
  return { lugares, paginas, cidades: lista, categorias_imagens: imagens ?? imagensDoCache ?? {}, regioes, foraDaRodada, cidadesDoBanco }
}

// 3.40: as cidades de reserva: as que a rodada anterior deixou no cache e as das regiões (uma cidade sem salão no ar
// volta vazia do banco e não entra em nada)
export function cidadesDeReserva(cacheDir, regioes = []) {
  const m = new Map()
  let arquivos = []
  try { arquivos = fs.readdirSync(cacheDir).filter((f) => f.endsWith('.json')) } catch { /* sem cache */ }
  for (const f of arquivos) {
    const c = lerCache(path.join(cacheDir, f))
    const slug = c?.cidade_slug || f.slice(0, -5)
    if (slug) m.set(slug, { cidade: c?.cidade ?? slug, cidade_slug: slug, uf: c?.uf ?? 'SP' })
  }
  for (const r of Array.isArray(regioes) ? regioes : []) {
    for (const s of Array.isArray(r?.cidades) ? r.cidades : []) if (s && !m.has(s)) m.set(s, { cidade: s, cidade_slug: s, uf: r?.uf ?? 'SP' })
  }
  return [...m.values()]
}
// 3.40: o mesmo formato de guia_cidades() (cidade, total, foto, categorias), contado dos salões da rodada
export function cidadesDosSaloes(lugares, paginas = []) {
  const porCidade = new Map()
  for (const l of lugares) {
    if (!l?.cidade_slug) continue
    const c = porCidade.get(l.cidade_slug) ?? { cidade: l.cidade, cidade_slug: l.cidade_slug, uf: l.uf, total: 0, cats: new Map() }
    c.total++
    c.cats.set(l.categoria, (c.cats.get(l.categoria) ?? 0) + 1)
    porCidade.set(l.cidade_slug, c)
  }
  return [...porCidade.values()].map(({ cats, ...c }) => ({
    ...c,
    foto: paginas.find((p) => p?.cidade_slug === c.cidade_slug && (p.categoria ?? '') === '' && p.foto)?.foto ?? null,
    categorias: [...cats].map(([categoria, total]) => ({ categoria, total })).sort((a, b) => b.total - a.total || String(a.categoria).localeCompare(String(b.categoria))),
  })).sort((a, b) => b.total - a.total || a.cidade_slug.localeCompare(b.cidade_slug))
}

// 3.38.2: limpa /saloes e /dados/guia do dist antes de regravar, menos as cidades a manter (as que ficaram fora da
// rodada): a pasta /saloes/<cidade>, o /dados/guia/<cidade>.json e a pasta /dados/guia/<cidade>. O índice, as regiões
// e os arquivos gerais (cidades.json, regioes.json) saem sempre, porque são regravados.
export function limparPastasDoGuia(dist, manter = []) {
  const m = new Set((manter ?? []).filter(Boolean))
  const lista = (dir) => { try { return fs.readdirSync(dir) } catch { return [] } }
  if (!m.size) {
    for (const pasta of ['saloes', 'dados/guia']) fs.rmSync(path.join(dist, pasta), { recursive: true, force: true })
    return { mantidas: [] }
  }
  const saloes = path.join(dist, 'saloes')
  for (const f of lista(saloes)) if (!m.has(f)) fs.rmSync(path.join(saloes, f), { recursive: true, force: true })
  const dados = path.join(dist, 'dados', 'guia')
  for (const f of lista(dados)) {
    const base = f.endsWith('.json') ? f.slice(0, -5) : f
    if (!m.has(base)) fs.rmSync(path.join(dados, f), { recursive: true, force: true })
  }
  return { mantidas: [...m].filter((c) => fs.existsSync(path.join(saloes, c))) }
}
// as URLs do sitemap de antes que são dessas cidades (/saloes/<cidade> e o que está dentro), para ficarem no sitemap novo
export function urlsDoSitemapDasCidades(xml, manter = []) {
  const prefixos = (manter ?? []).filter(Boolean).map((c) => `/saloes/${c}`)
  if (!prefixos.length) return []
  return [...String(xml ?? '').matchAll(/<url><loc>([^<]*)<\/loc>.*?<\/url>/g)]
    .filter(([, loc]) => prefixos.some((p) => loc.endsWith(p) || loc.includes(`${p}/`)))
    .map((x) => `  ${x[0]}`)
}
