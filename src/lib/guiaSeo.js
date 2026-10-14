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
export function trilhaDaCidade(cidade, cidadeSlug, categoria = '') {
  const base = [['Início', '/'], ['Salões', rotaDoGuia()], [`Salões em ${cidade}`, rotaDaCidade(cidadeSlug)]]
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
    ...(l.telefone ? { telephone: l.telefone } : {}),
    ...(horarioSchema(l.horarios) ? { openingHoursSpecification: horarioSchema(l.horarios) } : {}),
    ...(sameAs.length ? { sameAs } : {}),
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
      { '@type': 'WebPage', '@id': url, url, name: titulo, description: descricao, inLanguage: 'pt-BR', about: { '@id': `${url}#negocio` }, publisher: { '@id': ORG_ID }, ...(l.atualizado_em ? { dateModified: String(l.atualizado_em).slice(0, 10) } : {}) },
      ...(faq.length ? [faqLd(faq)] : []),
    ],
  }
}

// a página da cidade ou da categoria: migalhas, a coleção e a lista dos salões (em ordem)
export function jsonLdDaCidade(dados, faq = []) {
  const { titulo, descricao, caminho } = seoDaCidade(dados.cidade, dados.cidade_slug, dados.categoria, dados.pagina)
  const url = SITE_GUIA + caminho
  const lugares = Array.isArray(dados.lugares) ? dados.lugares : []
  return {
    '@context': 'https://schema.org',
    '@graph': [
      migalhas(trilhaDaCidade(dados.cidade, dados.cidade_slug, dados.categoria)),
      { '@type': 'CollectionPage', '@id': url, url, name: titulo, description: descricao, inLanguage: 'pt-BR', publisher: { '@id': ORG_ID }, mainEntity: { '@id': `${url}#lista` } },
      {
        '@type': 'ItemList',
        '@id': `${url}#lista`,
        numberOfItems: lugares.length,
        itemListElement: lugares.map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE_GUIA + rotaDoLugar(dados.cidade_slug, x.slug), name: x.nome })),
      },
      ...(faq.length ? [faqLd(faq)] : []),
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

// a linha de horário que vai na descrição de um cartão (reexportada por conveniência)
export { horariosEmUmaLinha }
