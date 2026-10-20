// As regiões do guia (3.36): a Baixada Santista, o Litoral Norte, o Vale do Ribeira com o litoral sul e o Vale do Paraíba
// com a Serra da Mantiqueira. Servem para agrupar as cidades na Plataforma (o seletor de cidade e as páginas da cidade)
// e, no site, para as páginas de região acima das de cidade. Cidade fora da lista cai em "Outras cidades".
export const REGIOES = [
  { slug: 'baixada-santista', nome: 'Baixada Santista', uf: 'SP', cidades: ['bertioga', 'cubatao', 'guaruja', 'itanhaem', 'mongagua', 'peruibe', 'praia-grande', 'santos', 'sao-vicente'] },
  { slug: 'litoral-norte', nome: 'Litoral Norte', uf: 'SP', cidades: ['caraguatatuba', 'ilhabela', 'sao-sebastiao', 'ubatuba'] },
  { slug: 'vale-do-ribeira', nome: 'Vale do Ribeira e litoral sul', uf: 'SP', cidades: ['cananeia', 'iguape', 'ilha-comprida', 'itariri', 'miracatu', 'pedro-de-toledo', 'juquia', 'registro', 'pariquera-acu', 'jacupiranga', 'cajati', 'eldorado', 'sete-barras'] },
  { slug: 'vale-do-paraiba', nome: 'Vale do Paraíba e Serra da Mantiqueira', uf: 'SP', cidades: ['aparecida', 'cacapava', 'cachoeira-paulista', 'campos-do-jordao', 'canas', 'cruzeiro', 'guaratingueta', 'igarata', 'jacarei', 'jambeiro', 'lorena', 'monteiro-lobato', 'paraibuna', 'pindamonhangaba', 'piquete', 'potim', 'roseira', 'santa-branca', 'santo-antonio-do-pinhal', 'sao-bento-do-sapucai', 'sao-jose-dos-campos', 'sao-luiz-do-paraitinga', 'taubate', 'tremembe'] },
]
export const OUTRAS = { slug: 'outras', nome: 'Outras cidades', uf: '', cidades: [] }
export const rotaDaRegiao = (slug) => `/saloes/regiao/${slug}`
// "na Baixada Santista", "no Litoral Norte": a preposição pelo começo do nome
export const preposicaoDaRegiao = (nome) => (/^(baixada|serra|regi[aã]o|costa|ilha|zona|grande|alta|chapada)\b/i.test(String(nome ?? '')) ? 'na' : 'no')
// a lista de regiões em uso: a do banco (guia_regioes(), com "cidades" em cada uma), ou a semente daqui
const mapaDe = (regioes) => new Map((Array.isArray(regioes) ? regioes : REGIOES).flatMap((r) => (Array.isArray(r.cidades) ? r.cidades : []).map((c) => [c, r])))
// a região de uma cidade (pelo slug), ou null
export const regiaoDaCidade = (cidadeSlug, regioes = REGIOES) => mapaDe(regioes).get(String(cidadeSlug ?? '')) ?? null
// as cidades agrupadas na ordem das regiões, cada grupo na ordem em que vieram; "Outras cidades" por último, só se houver
export function agruparPorRegiao(cidades, slugDe = (c) => c.slug, regioes = REGIOES) {
  const lista = Array.isArray(regioes) ? regioes : REGIOES
  const por = mapaDe(lista)
  const grupos = lista.map((r) => ({ regiao: r, cidades: [] }))
  const outras = { regiao: OUTRAS, cidades: [] }
  for (const c of Array.isArray(cidades) ? cidades : []) {
    const r = por.get(String(slugDe(c) ?? ''))
    ;(r ? grupos.find((g) => g.regiao.slug === r.slug) : outras).cidades.push(c)
  }
  return [...grupos.filter((g) => g.cidades.length), ...(outras.cidades.length ? [outras] : [])]
}
// a página de região (3.37): as cidades dela que estão no guia (da lista de guia_cidades()), os totais e as categorias somadas
export function dadosDaRegiao(regiao, cidades) {
  const slugs = new Set(Array.isArray(regiao?.cidades) ? regiao.cidades : [])
  const minhas = (Array.isArray(cidades) ? cidades : []).filter((c) => slugs.has(c.cidade_slug)).sort((a, b) => Number(b.total ?? 0) - Number(a.total ?? 0) || String(a.cidade).localeCompare(String(b.cidade), 'pt-BR'))
  const porCategoria = new Map()
  for (const c of minhas) for (const k of Array.isArray(c.categorias) ? c.categorias : []) if (k?.categoria) porCategoria.set(k.categoria, (porCategoria.get(k.categoria) ?? 0) + Number(k.total ?? 0))
  return {
    regiao, cidades: minhas, total: minhas.reduce((n, c) => n + Number(c.total ?? 0), 0),
    categorias: [...porCategoria.entries()].map(([categoria, total]) => ({ categoria, total })).sort((a, b) => b.total - a.total),
    foto: regiao?.foto || minhas.find((c) => c.foto)?.foto || null,
  }
}
// as perguntas da página de região, respondidas com os números (como o panorama das cidades)
export function faqDaRegiao(d, rotuloDe = (slug) => slug) {
  const nome = d?.regiao?.nome ?? ''
  const prep = preposicaoDaRegiao(nome)
  const num = (n) => Number(n).toLocaleString('pt-BR')
  const juntarE = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}`)
  if (!nome || !d.cidades.length) return []
  const faq = [{
    pergunta: `Quantas cidades ${prep.replace('n', 'd')} ${nome} estão no guia?`,
    resposta: `${num(d.cidades.length)} ${d.cidades.length === 1 ? 'cidade' : 'cidades'}, com ${num(d.total)} ${d.total === 1 ? 'lugar' : 'lugares'} no guia: ${juntarE(d.cidades.map((c) => `${c.cidade} (${num(c.total)})`))}. A lista cresce conforme novos lugares são publicados.`,
  }]
  if (d.cidades.length > 1) faq.push({
    pergunta: `Qual cidade ${prep.replace('n', 'd')} ${nome} tem mais salões no guia?`,
    resposta: `${d.cidades[0].cidade}, com ${num(d.cidades[0].total)}. Depois ${juntarE(d.cidades.slice(1, 4).map((c) => `${c.cidade} (${num(c.total)})`))}. Cada cidade tem a própria página, com os salões por bairro e por categoria.`,
  })
  if (d.categorias.length > 1) faq.push({
    pergunta: `Que tipos de salão o guia tem ${prep} ${nome}?`,
    resposta: `${juntarE(d.categorias.map((k) => `${rotuloDe(k.categoria).toLowerCase()} (${num(k.total)})`))}. Dentro de cada cidade, cada categoria tem a própria página.`,
  })
  return faq
}
