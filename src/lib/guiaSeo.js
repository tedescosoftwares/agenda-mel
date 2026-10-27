// O SEO do guia de salões: título, descrição, migalhas e dados estruturados
// (JSON-LD) de cada página. Puro, sem React e sem banco: as páginas do app
// (useSeo) e o gerador de páginas estáticas (scripts/paginas-estaticas.mjs)
// usam o mesmo, então o robô que não roda JavaScript lê exatamente o que a
// pessoa vê.
//
// Nunca entra nota, número de avaliações nem AggregateRating: o guia não
// publica avaliação de terceiros.
import {
  categoriaDoGuia, rotaDoGuia, rotaDaCidade, rotaDaCategoria, rotaDoLugar,
  seoPadraoDoLugar, seoPadraoDaCidade, conteudoSeguro, linkInstagram, horariosEmUmaLinha,
} from './guia.js'
import { dadosDaPagina } from './guiaTexto.js'
import { trilhaDaColecao } from './guiaColecoes.js'
import { fotosDoLugar } from './guia.js'
import { rotaDaRegiao, preposicaoDaRegiao } from '../../packages/core/guiaRegioes.js'

export const SITE_GUIA = 'https://mimo.com.vc'
const ORG_ID = `${SITE_GUIA}/#organization`
const DIAS_SCHEMA = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const migalhas = (itens) => ({
  '@type': 'BreadcrumbList',
  itemListElement: itens.map(([nome, caminho], i) => ({ '@type': 'ListItem', position: i + 1, name: nome, item: SITE_GUIA + caminho })),
})
const faqLd = (faq) => ({
  '@type': 'FAQPage',
  mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.pergunta, acceptedAnswer: { '@type': 'Answer', text: f.resposta } })),
})

// ---- trilhas (as migalhas na tela e no JSON-LD) ------------------------------------
export function trilhaDoLugar(l) {
  const cat = categoriaDoGuia(l.categoria)
  return [
    ['Início', '/'],
    ['Salões', rotaDoGuia()],
    [`Salões em ${l.cidade}`, rotaDaCidade(l.cidade_slug)],
    [`${cat.rotulo} em ${l.cidade}`, rotaDaCategoria(l.cidade_slug, l.categoria)],
    [l.nome, rotaDoLugar(l.cidade_slug, l.slug)],
  ]
}
// regiao (3.37): { slug, nome } da região da cidade, quando se sabe; entra na trilha entre "Salões" e a cidade
export function trilhaDaCidade(cidade, cidadeSlug, categoria = '', regiao = null) {
  const base = [['Início', '/'], ['Salões', rotaDoGuia()], ...(regiao?.slug && regiao?.nome ? [[regiao.nome, rotaDaRegiao(regiao.slug)]] : []), [`Salões em ${cidade}`, rotaDaCidade(cidadeSlug)]]
  if (!categoria) return base
  const cat = categoriaDoGuia(categoria)
  return [...base, [`${cat.rotulo} em ${cidade}`, rotaDaCategoria(cidadeSlug, categoria)]]
}

// ---- título e descrição -------------------------------------------------------------
// o texto aprovado manda; sem ele, o padrão montado dos fatos.
// Página com pouco dado (sem horário, quase sem informação) vai ao ar sem
// pedir para indexar: o Google trata página fina como cópia das outras.
export function seoDoLugar(l, conteudo) {
  const c = conteudoSeguro(conteudo) ?? {}
  const padrao = seoPadraoDoLugar(l)
  return {
    titulo: c.seo_title ? (c.seo_title.includes('MIMO') ? c.seo_title : `${c.seo_title} | MIMO`) : padrao.seo_title,
    descricao: c.meta_description || padrao.meta_description,
    caminho: rotaDoLugar(l.cidade_slug, l.slug),
    noindex: dadosDaPagina(l).fina,
  }
}
export function seoDaCidade(cidade, cidadeSlug, categoria = '', pagina = null) {
  const c = conteudoSeguro(pagina) ?? {}
  const padrao = seoPadraoDaCidade(cidade, categoria)
  return {
    titulo: c.seo_title ? (c.seo_title.includes('MIMO') ? c.seo_title : `${c.seo_title} | MIMO`) : padrao.seo_title,
    descricao: c.meta_description || padrao.meta_description,
    h1: padrao.h1,
    caminho: categoria ? rotaDaCategoria(cidadeSlug, categoria) : rotaDaCidade(cidadeSlug),
  }
}
// a página de região (3.37): d é o que dadosDaRegiao() devolve
export const trilhaDaRegiao = (regiao) => [['Início', '/'], ['Salões', rotaDoGuia()], [regiao.nome, rotaDaRegiao(regiao.slug)]]
export function seoDaRegiao(d) {
  const r = d.regiao
  const prep = preposicaoDaRegiao(r.nome)
  const n = d.cidades.length
  const nomes = d.cidades.slice(0, 3).map((c) => c.cidade)
  return {
    titulo: `Salões de beleza ${prep} ${r.nome}: guia por cidade | MIMO`,
    h1: `Salões de beleza ${prep} ${r.nome}`,
    descricao: `Salões de beleza, manicures, cílios, sobrancelha e estética ${n === 1 ? 'da cidade' : `das ${n} cidades`} ${prep.replace('n', 'd')} ${r.nome}${nomes.length ? ` (${nomes.join(', ')}${n > 3 ? ' e mais' : ''})` : ''}: endereço, horário e serviços de cada um.`.slice(0, 158),
    caminho: rotaDaRegiao(r.slug),
  }
}
export function jsonLdDaRegiao(d, faq = []) {
  const { titulo, descricao, caminho } = seoDaRegiao(d)
  const url = SITE_GUIA + caminho
  return {
    '@context': 'https://schema.org',
    '@graph': [
      migalhas(trilhaDaRegiao(d.regiao)),
      { '@type': 'CollectionPage', '@id': url, url, name: titulo, description: descricao, inLanguage: 'pt-BR', publisher: { '@id': ORG_ID }, mainEntity: { '@id': `${url}#cidades` }, ...(d.foto ? { image: d.foto, primaryImageOfPage: d.foto } : {}) },
      { '@type': 'ItemList', '@id': `${url}#cidades`, numberOfItems: d.cidades.length, itemListElement: d.cidades.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE_GUIA + rotaDaCidade(c.cidade_slug), name: `Salões em ${c.cidade}` })) },
      ...(faq.length ? [faqLd(faq)] : []),
    ],
  }
}

export const seoDoIndice = () => ({
  titulo: 'Guia de salões de beleza por cidade | MIMO',
  descricao: 'Salões de beleza, manicures, cílios, sobrancelha e estética por cidade: endereço, horário e serviços de cada um, num guia feito pela MIMO.',
  caminho: rotaDoGuia(),
})

// ---- dados estruturados ----------------------------------------------------------------
// horário no formato do schema.org (24:00 vira 23:59, que é o que o Google aceita)
export function horarioSchema(horarios) {
  if (!Array.isArray(horarios) || !horarios.length) return undefined
  const grupos = new Map()
  for (const h of horarios) for (const [abre, fecha] of h.faixas ?? []) {
    const k = `${abre}-${fecha}`
    if (!grupos.has(k)) grupos.set(k, { '@type': 'OpeningHoursSpecification', dayOfWeek: [], opens: abre, closes: fecha === '24:00' ? '23:59' : fecha })
    grupos.get(k).dayOfWeek.push(DIAS_SCHEMA[h.dia])
  }
  return [...grupos.values()]
}

// pagamento e comodidades no vocabulário do schema.org
const PAGAMENTO_SCHEMA = { credito: 'Cartão de crédito', debito: 'Cartão de débito', aproximacao: 'Pagamento por aproximação', so_dinheiro: 'Dinheiro' }
const COMODIDADE_SCHEMA = {
  acessibilidade: { entrada: 'Entrada acessível para cadeira de rodas', estacionamento: 'Vaga acessível', banheiro: 'Banheiro acessível', assentos: 'Assentos acessíveis' },
  estacionamento: { rua_gratis: 'Estacionamento grátis na rua', rua_pago: 'Estacionamento pago na rua', local_gratis: 'Estacionamento próprio grátis', local_pago: 'Estacionamento próprio pago', garagem_gratis: 'Garagem grátis', garagem_pago: 'Garagem paga', manobrista: 'Manobrista' },
}
function comodidades(a) {
  if (!a || typeof a !== 'object') return []
  const out = []
  for (const campo of ['acessibilidade', 'estacionamento']) for (const k of Array.isArray(a[campo]) ? a[campo] : []) if (COMODIDADE_SCHEMA[campo][k]) out.push(COMODIDADE_SCHEMA[campo][k])
  if (a.criancas === true) out.push('Bom para crianças')
  if (a.banheiro === true) out.push('Banheiro para clientes')
  return out.map((name) => ({ '@type': 'LocationFeatureSpecification', name, value: true }))
}

// a página de um salão: migalhas, o negócio (o tipo certo do schema.org), a página e as perguntas
export function jsonLdDoLugar(l, conteudo, faq = []) {
  const cat = categoriaDoGuia(l.categoria)
  const { titulo, descricao, caminho } = seoDoLugar(l, conteudo)
  const url = SITE_GUIA + caminho
  const sameAs = [linkInstagram(l.instagram), l.site].filter(Boolean)
  const fotos = fotosDoLugar(l) // 3.14: as fotos entram no negócio e na página
  const negocio = {
    '@type': cat.schema,
    '@id': `${url}#negocio`,
    name: l.nome,
    url,
    description: descricao,
    address: {
      '@type': 'PostalAddress',
      ...(l.endereco ? { streetAddress: l.endereco } : {}),
      addressLocality: l.cidade,
      addressRegion: l.uf || 'SP',
      ...(l.cep ? { postalCode: l.cep } : {}),
      addressCountry: 'BR',
    },
    ...(l.latitude != null && l.longitude != null ? { geo: { '@type': 'GeoCoordinates', latitude: Number(l.latitude), longitude: Number(l.longitude) } } : {}),
    ...(l.telefone ? { telephone: l.telefone } : {}),
    ...(horarioSchema(l.horarios) ? { openingHoursSpecification: horarioSchema(l.horarios) } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(fotos.length ? { image: fotos } : {}),
    ...(l.servicos?.length ? { knowsAbout: l.servicos } : {}),
    ...(Array.isArray(l.atributos?.pagamento) && l.atributos.pagamento.length ? { paymentAccepted: l.atributos.pagamento.map((k) => PAGAMENTO_SCHEMA[k]).filter(Boolean).join(', ') } : {}),
    ...(comodidades(l.atributos).length ? { amenityFeature: comodidades(l.atributos) } : {}),
    areaServed: { '@type': 'City', name: l.cidade },
  }
  return {
    '@context': 'https://schema.org',
    '@graph': [
      migalhas(trilhaDoLugar(l)),
      negocio,
      { '@type': 'WebPage', '@id': url, url, name: titulo, description: descricao, inLanguage: 'pt-BR', about: { '@id': `${url}#negocio` }, publisher: { '@id': ORG_ID }, ...(fotos.length ? { primaryImageOfPage: fotos[0] } : {}), ...(l.atualizado_em ? { dateModified: String(l.atualizado_em).slice(0, 10) } : {}) },
      ...(faq.length ? [faqLd(faq)] : []),
    ],
  }
}

// a página da cidade ou da categoria: migalhas, a coleção e a lista dos salões (em ordem)
export function jsonLdDaCidade(dados, faq = []) {
  const { titulo, descricao, caminho } = seoDaCidade(dados.cidade, dados.cidade_slug, dados.categoria, dados.pagina)
  const url = SITE_GUIA + caminho
  // 3.75: o salão de página fina (noindex) não entra na lista estruturada
  const lugares = (Array.isArray(dados.lugares) ? dados.lugares : []).filter((x) => !x?.fina)
  return {
    '@context': 'https://schema.org',
    '@graph': [
      migalhas(trilhaDaCidade(dados.cidade, dados.cidade_slug, dados.categoria, dados.regiao ?? null)),
      { '@type': 'CollectionPage', '@id': url, url, name: titulo, description: descricao, inLanguage: 'pt-BR', publisher: { '@id': ORG_ID }, mainEntity: { '@id': `${url}#lista` }, ...(dados.foto ? { image: dados.foto, primaryImageOfPage: dados.foto } : {}) },
      {
        '@type': 'ItemList',
        '@id': `${url}#lista`,
        // cidade grande (3.20): a lista estruturada para nos mesmos 96 (cidade) e 240 (categoria) da lista estática
        numberOfItems: Math.min(lugares.length, dados.categoria ? 240 : 96),
        itemListElement: lugares.slice(0, dados.categoria ? 240 : 96).map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE_GUIA + rotaDoLugar(dados.cidade_slug, x.slug), name: x.nome })),
      },
      ...(faq.length ? [faqLd(faq)] : []),
    ],
  }
}

// ---- as coleções (3.12): bairro e horário --------------------------------------------------
// m: o que montarColecao() devolve (packages/core/guiaColecoes.js). Coleção que existe já passou do
// mínimo de salões, então sempre pede para indexar.
export function seoDaColecao(m) {
  return {
    titulo: m.seo_title.includes('MIMO') ? m.seo_title : `${m.seo_title} | MIMO`,
    descricao: m.meta_description,
    h1: m.h1,
    caminho: m.caminho,
    noindex: !!m.noindex, // 3.75: o horário pequeno numa categoria vai ao ar sem indexar
  }
}
// a coleção: migalhas, a página, a lista dos salões (em ordem) e as perguntas. Sem nota.
export function jsonLdDaColecao(m) {
  const { titulo, descricao, caminho } = seoDaColecao(m)
  const url = SITE_GUIA + caminho
  // 3.75: o salão de página fina (noindex) não entra na lista estruturada
  const cartoes = (Array.isArray(m.cartoes) ? m.cartoes : []).filter((x) => !x?.fina)
  return {
    '@context': 'https://schema.org',
    '@graph': [
      migalhas(trilhaDaColecao(m)),
      {
        '@type': 'CollectionPage', '@id': url, url, name: titulo, description: descricao, inLanguage: 'pt-BR', publisher: { '@id': ORG_ID }, mainEntity: { '@id': `${url}#lista` },
        ...(m.tipo === 'bairro' ? { about: { '@type': 'Place', name: `${m.nome}, ${m.cidade}`, containedInPlace: { '@type': 'City', name: m.cidade } } } : {}),
        ...(m.atualizado ? { dateModified: m.atualizado } : {}),
      },
      {
        '@type': 'ItemList',
        '@id': `${url}#lista`,
        numberOfItems: cartoes.length,
        itemListElement: cartoes.map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE_GUIA + rotaDoLugar(m.cidade_slug, x.slug), name: x.nome })),
      },
      ...(m.faq?.length ? [faqLd(m.faq)] : []),
    ],
  }
}

export function jsonLdDoIndice(cidades) {
  const { titulo, descricao, caminho } = seoDoIndice()
  const url = SITE_GUIA + caminho
  return {
    '@context': 'https://schema.org',
    '@graph': [
      migalhas([['Início', '/'], ['Salões', caminho]]),
      { '@type': 'CollectionPage', '@id': url, url, name: titulo, description: descricao, inLanguage: 'pt-BR', publisher: { '@id': ORG_ID } },
      { '@type': 'ItemList', itemListElement: (cidades ?? []).map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE_GUIA + rotaDaCidade(c.cidade_slug), name: `Salões em ${c.cidade}` })) },
    ],
  }
}

// a linha de horário que vai na descrição de um cartão e a trilha das coleções (reexportadas por conveniência)
export { horariosEmUmaLinha, trilhaDaColecao }
