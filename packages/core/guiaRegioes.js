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
const POR_CIDADE = new Map(REGIOES.flatMap((r) => r.cidades.map((c) => [c, r])))
// a região de uma cidade (pelo slug), ou null
export const regiaoDaCidade = (cidadeSlug) => POR_CIDADE.get(String(cidadeSlug ?? '')) ?? null
// as cidades agrupadas na ordem das regiões, cada grupo na ordem em que vieram; "Outras cidades" por último, só se houver
export function agruparPorRegiao(cidades, slugDe = (c) => c.slug) {
  const grupos = REGIOES.map((r) => ({ regiao: r, cidades: [] }))
  const outras = { regiao: OUTRAS, cidades: [] }
  for (const c of Array.isArray(cidades) ? cidades : []) {
    const r = regiaoDaCidade(slugDe(c))
    ;(r ? grupos.find((g) => g.regiao.slug === r.slug) : outras).cidades.push(c)
  }
  return [...grupos.filter((g) => g.cidades.length), ...(outras.cidades.length ? [outras] : [])]
}
