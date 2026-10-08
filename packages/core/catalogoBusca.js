// O catálogo de serviços no app (2.91): índice, busca e sugestões, tudo
// puro (sem Supabase) para rodar igual no app, no demo e num teste em node.
//
// Os itens vêm da view catalogo_visivel: só o que está ativo com todos os
// ancestrais ativos, cada um com `caminho` (da categoria até ele) e
// `caminho_slugs`. As categorias vêm de categorias_de_servico (plataforma,
// ativas). Aqui a gente monta:
//
//   indexar(itens, categorias) → { itens, porId, filhos(id), categorias, servicosDe(categoriaId) … }
//   buscar(indice, texto)      → [{ item, pontos }] com o caminho completo (aliases NÃO são únicos:
//                                "gel" devolve esmaltação em gel, soft gel, banho de gel, e é isso mesmo)
//   sugestoes(indice, { categoriasEscolhidas, categoriaId, limite })
//                              → serviços com prioridade_sugestao > 0, sem a tag habilitacao, 6 a 8
//
// Pontuação (a spec): nome começa com a busca 100 · alias igual 90 · nome
// contém 70 · alias contém 60 · tag igual 40 · família/categoria contém 20.

export function normalizar(t) {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

const ORDEM_TIPO = { servico: 0, tecnica: 1, familia: 2 }

export function indexar(itens, categorias) {
  const porId = new Map()
  const filhos = new Map()
  const lista = [...(itens ?? [])].sort((a, b) => a.nivel - b.nivel || a.ordem - b.ordem || a.nome.localeCompare(b.nome))
  for (const it of lista) {
    const n = {
      ...it,
      aliases: it.aliases ?? [], tags: it.tags ?? [], caminho: it.caminho ?? [], caminho_slugs: it.caminho_slugs ?? [],
      _nome: normalizar(it.nome), _aliases: (it.aliases ?? []).map(normalizar), _tags: (it.tags ?? []).map(normalizar),
    }
    porId.set(n.id, n)
    if (!filhos.has(n.pai_id ?? null)) filhos.set(n.pai_id ?? null, [])
    filhos.get(n.pai_id ?? null).push(n)
  }
  // só categorias que têm catálogo (Outros e Barba ficam de fora da grade)
  const comItens = new Set(lista.map((i) => i.categoria_id))
  const cats = [...(categorias ?? [])].filter((c) => comItens.has(c.id) && c.ativa !== false).sort((a, b) => a.ordem - b.ordem)
    .map((c) => ({ ...c, aliases: c.aliases ?? [], _nome: normalizar(c.nome), _aliases: (c.aliases ?? []).map(normalizar) }))
  const porCategoria = new Map(cats.map((c) => [c.id, c]))
  for (const n of porId.values()) n._ancestrais = [porCategoria.get(n.categoria_id)?._nome ?? '', ...n.caminho.slice(1, -1).map(normalizar)].filter(Boolean)
  return {
    itens: lista.map((i) => porId.get(i.id)),
    porId,
    categorias: cats,
    categoria: (id) => porCategoria.get(id) ?? null,
    filhos: (id) => filhos.get(id ?? null) ?? [],
    familiasDe: (categoriaId) => (filhos.get(null) ?? []).filter((f) => f.categoria_id === categoriaId),
    servicosDe: (categoriaId) => lista.filter((i) => i.tipo === 'servico' && i.categoria_id === categoriaId).map((i) => porId.get(i.id)),
    total: lista.length,
  }
}

// ancestrais de um item (família → … → ele), pela cadeia de pais
export function cadeia(indice, id) {
  const out = []
  let atual = indice.porId.get(id)
  while (atual) { out.unshift(atual); atual = atual.pai_id ? indice.porId.get(atual.pai_id) : null }
  return out
}

// duração sugerida: a da técnica, senão a do serviço (herda)
export function duracaoDe(indice, item) {
  if (!item) return null
  if (item.duracao_sugerida) return item.duracao_sugerida
  const pai = item.pai_id ? indice.porId.get(item.pai_id) : null
  return pai?.duracao_sugerida ?? null
}

// o nome que vai pré-preenchido: "Progressiva" ou "Progressiva — Orgânica"
export function nomeSugerido(servico, tecnica) {
  return tecnica ? `${servico.nome} — ${tecnica.nome}` : servico.nome
}

function pontuar(n, q) {
  let p = 0
  if (n._nome.startsWith(q)) p = Math.max(p, 100)
  if (n._aliases.includes(q)) p = Math.max(p, 90)
  if (n._nome.includes(q)) p = Math.max(p, 70)
  if (n._aliases.some((a) => a.includes(q))) p = Math.max(p, 60)
  if (n._tags.includes(q)) p = Math.max(p, 40)
  if (n._ancestrais.some((a) => a.includes(q))) p = Math.max(p, 20)
  return p
}

// busca: a frase inteira; se nada bater, cada palavra tem de bater em algum
// campo (o menor dos pontos vale). Devolve [{ item, pontos }] ordenado.
export function buscar(indice, texto, { limite = 24 } = {}) {
  const q = normalizar(texto)
  if (q.length < 2) return []
  let achados = indice.itens.map((n) => ({ item: n, pontos: pontuar(n, q) })).filter((r) => r.pontos > 0)
  if (!achados.length && q.includes(' ')) {
    const palavras = q.split(' ').filter((w) => w.length >= 2)
    achados = indice.itens.map((n) => ({ item: n, pontos: Math.min(...palavras.map((w) => pontuar(n, w))) })).filter((r) => r.pontos > 0)
  }
  achados.sort((a, b) => b.pontos - a.pontos || ORDEM_TIPO[a.item.tipo] - ORDEM_TIPO[b.item.tipo]
    || b.item.prioridade_sugestao - a.item.prioridade_sugestao || a.item.caminho.join('/').localeCompare(b.item.caminho.join('/')))
  return achados.slice(0, limite)
}

// "Sugestões para você": serviços com prioridade, sem habilitacao, das
// categorias que o salão escolheu (ou de uma categoria), 6 a 8
export function sugestoes(indice, { categoriasEscolhidas = [], categoriaId = null, limite = 8 } = {}) {
  const escolhidas = categoriaId ? new Set([categoriaId]) : (categoriasEscolhidas?.length ? new Set(categoriasEscolhidas) : null)
  const base = indice.itens.filter((i) => i.tipo === 'servico' && i.prioridade_sugestao > 0 && !i.tags.includes('habilitacao') && (!escolhidas || escolhidas.has(i.categoria_id)))
  if (escolhidas && !categoriaId) {
    // várias categorias: intercala para nenhuma dominar (a 1ª de cada, depois a 2ª…)
    const porCat = new Map()
    for (const s of base.sort((a, b) => b.prioridade_sugestao - a.prioridade_sugestao || a.ordem - b.ordem)) { if (!porCat.has(s.categoria_id)) porCat.set(s.categoria_id, []); porCat.get(s.categoria_id).push(s) }
    const filas = [...porCat.keys()].sort((a, b) => (indice.categoria(a)?.ordem ?? 0) - (indice.categoria(b)?.ordem ?? 0)).map((k) => porCat.get(k))
    const out = []
    for (let rodada = 0; out.length < limite && filas.some((f) => f.length > rodada); rodada++) for (const f of filas) if (f[rodada] && out.length < limite) out.push(f[rodada])
    return out
  }
  return base.sort((a, b) => b.prioridade_sugestao - a.prioridade_sugestao || a.ordem - b.ordem).slice(0, limite)
}

// contagem de serviços por família (para o cartão da família)
export function quantosServicos(indice, familiaId) {
  return indice.filhos(familiaId).filter((i) => i.tipo === 'servico').length
}

// A árvore do JSON (supabase/catalogo/catalogo_v1.json) no formato das
// linhas da view catalogo_visivel: serve ao demo e aos testes, sem banco.
// `categorias` é [{ id, slug, nome }] da plataforma, para resolver o id.
export function arvoreParaLinhas(arvore, categorias) {
  const porSlug = new Map((categorias ?? []).map((c) => [c.slug, c]))
  const linhas = []
  for (const cat of arvore?.categorias ?? []) {
    const c = porSlug.get(cat.slug)
    if (!c || c.ativa === false) continue
    for (const fam of cat.familias ?? []) {
      if (fam.ativa === false) continue
      const fid = `ci-${cat.slug}-${fam.slug}`
      linhas.push({ id: fid, tipo: 'familia', categoria_id: c.id, pai_id: null, nome: fam.nome, slug: fam.slug, ativa: true, descricao: fam.descricao ?? null, aliases: fam.aliases ?? [], tags: [], duracao_sugerida: null, imagem_url: null, ordem: fam.ordem ?? 0, prioridade_sugestao: 0, familia_id: fid, servico_id: null, nivel: 1, caminho_slugs: [cat.slug, fam.slug], caminho: [c.nome, fam.nome] })
      for (const sv of fam.servicos ?? []) {
        if (sv.ativa === false) continue
        const sid = `${fid}-${sv.slug}`
        linhas.push({ id: sid, tipo: 'servico', categoria_id: c.id, pai_id: fid, nome: sv.nome, slug: sv.slug, ativa: true, descricao: sv.descricao ?? null, aliases: sv.aliases ?? [], tags: sv.tags ?? [], duracao_sugerida: sv.duracao_sugerida ?? null, imagem_url: null, ordem: sv.ordem ?? 0, prioridade_sugestao: sv.prioridade_sugestao ?? 0, familia_id: fid, servico_id: sid, nivel: 2, caminho_slugs: [cat.slug, fam.slug, sv.slug], caminho: [c.nome, fam.nome, sv.nome] })
        for (const tc of sv.tecnicas ?? []) {
          if (tc.ativa === false) continue
          linhas.push({ id: `${sid}-${tc.slug}`, tipo: 'tecnica', categoria_id: c.id, pai_id: sid, nome: tc.nome, slug: tc.slug, ativa: true, descricao: null, aliases: tc.aliases ?? [], tags: [], duracao_sugerida: tc.duracao_sugerida ?? null, imagem_url: null, ordem: tc.ordem ?? 0, prioridade_sugestao: 0, familia_id: fid, servico_id: sid, nivel: 3, caminho_slugs: [cat.slug, fam.slug, sv.slug, tc.slug], caminho: [c.nome, fam.nome, sv.nome, tc.nome] })
        }
      }
    }
  }
  return linhas
}
