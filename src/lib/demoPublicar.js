// "Publicar agora" no modo demonstração (3.41): imita as funções da migração 189
// (site_pendencias, site_pedir_publicacao, site_publicacao_status) sobre o que
// está na memória do demo. A última publicação de mentira foi há dois dias, então
// o demo já abre com pendências; aprovar, editar ou tirar do ar na tela soma na
// hora. O pedido anda sozinho: uns 2 s na fila, uns 4 s publicando e no ar
// (window.__demoPublicacaoFalha = 1 faz a próxima falhar, para o teste).
// 3.42 (190): as fotos novas em linha própria (fotos_em) e a hora em que o
// servidor conferiu (window.__demoServidorParado = 1 simula o cron desligado).
import { GUIA_LUGARES, GUIA_PAGINAS, GUIA_CATEGORIAS_IMAGENS, GUIA_REGIOES, GUIA_CIDADES_REGIAO } from './demoGuia'

const NA_FILA_MS = 2000
const naFila = () => Number(globalThis.__demoFilaMs) || NA_FILA_MS // o teste segura o pedido na fila (window.__demoFilaMs)
const PUBLICANDO_MS = 4000
const iso = (ms) => new Date(ms).toISOString()
const PUBLICACOES = [{ id: 41, origem: 'automatico', status: 'feito', pedido_em: null, inicio_em: iso(Date.now() - 50 * 3600e3), fim_em: iso(Date.now() - 50 * 3600e3 + 95e3), urls: 48, versao: 'demo-41', resumo: null }]

const depois = (data, desde) => !!data && new Date(data).getTime() > new Date(desde).getTime()
const ultimaFeita = () => PUBLICACOES.filter((p) => p.status === 'feito').sort((a, b) => b.inicio_em.localeCompare(a.inicio_em))[0] ?? null
// o cron do minuto: conferiu há 20 s (ou nunca, no teste do servidor parado)
const servidor = () => ({ servidor_conferiu_em: globalThis.__demoServidorParado ? null : iso(Date.now() - 20e3), servidor_ocupado: false })
const urlsNoAr = () => 40 + GUIA_LUGARES.filter((l) => l.status === 'publicado' && l.conteudo).length

// o pedido anda com o relógio (como o VPS que confere a cada minuto, só que mais rápido)
function andar(p) {
  if (p.status !== 'pedido' && p.status !== 'rodando') return p
  if (globalThis.__demoServidorParado && p.status === 'pedido') return p
  const passou = Date.now() - new Date(p.pedido_em).getTime()
  if (p.status === 'pedido' && passou >= naFila()) { p.status = 'rodando'; p.inicio_em = iso(new Date(p.pedido_em).getTime() + naFila()) }
  if (p.status === 'rodando' && passou >= naFila() + PUBLICANDO_MS) {
    p.fim_em = iso(Date.now())
    if (globalThis.__demoPublicacaoFalha) { globalThis.__demoPublicacaoFalha = 0; p.status = 'falhou'; p.resumo = 'a regeneração falhou: guia de salões indisponível (demo)' }
    else { p.status = 'feito'; p.urls = urlsNoAr(); p.resumo = `paginas-estaticas: ${p.urls} URLs no sitemap (demo)` }
  }
  return p
}

function pendencias(conteudo) {
  PUBLICACOES.forEach(andar)
  const ult = ultimaFeita()
  const aberto = PUBLICACOES.find((p) => p.status === 'pedido' || p.status === 'rodando') ?? null
  const desde = ult?.inicio_em
  const tipo = (l) => (l.status === 'publicado' && l.conteudo ? (depois(l.publicado_em, desde) ? 'entraram' : depois(l.fotos_em, desde) ? 'fotos' : 'mudaram') : l.publicado_em ? 'sairam' : null)
  const t = desde ? GUIA_LUGARES.filter((l) => depois(l.atualizado_em, desde)).map((l) => ({ ...l, tipo: tipo(l) })).filter((l) => l.tipo) : []
  const conta = (k) => t.filter((l) => l.tipo === k).length
  const exemplos = (k) => t.filter((l) => l.tipo === k).sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em)).slice(0, 5).map((l) => l.nome)
  const porCidade = new Map()
  for (const l of t) {
    const c = porCidade.get(l.cidade) ?? { cidade: l.cidade, entraram: 0, fotos: 0, mudaram: 0, sairam: 0, n: 0 }
    c[l.tipo]++; c.n++
    porCidade.set(l.cidade, c)
  }
  const n = (lista, campo = 'atualizado_em', filtro = () => true) => (desde ? lista.filter((x) => depois(x[campo], desde) && filtro(x)).length : 0)
  const r = {
    saloes: { entraram: conta('entraram'), fotos: conta('fotos'), mudaram: conta('mudaram'), sairam: conta('sairam') },
    por_cidade: [...porCidade.values()].sort((a, b) => b.n - a.n || a.cidade.localeCompare(b.cidade)).slice(0, 12).map(({ n: _n, ...c }) => c),
    exemplos: { entraram: exemplos('entraram'), fotos: exemplos('fotos'), mudaram: exemplos('mudaram'), sairam: exemplos('sairam') },
    paginas: n(GUIA_PAGINAS, 'atualizado_em', (p) => (p.status === 'publicado' && p.conteudo) || p.foto),
    categorias: n(GUIA_CATEGORIAS_IMAGENS),
    regioes: n(GUIA_REGIOES) + n(GUIA_CIDADES_REGIAO),
    artigos: n(conteudo?.blog_posts ?? [], 'updated_at', (b) => b.status === 'published'),
    seo: n(conteudo?.seo_pages ?? [], 'updated_at', (s) => s.status === 'published'),
  }
  const total = r.saloes.entraram + r.saloes.fotos + r.saloes.mudaram + r.saloes.sairam + r.paginas + r.categorias + r.regioes + r.artigos + r.seo
  return {
    sem_registro: !desde, pendente: !ult || total > 0, versao_atual: `demo-${total}`, ...servidor(),
    ultima: ult && { id: ult.id, origem: ult.origem, inicio_em: ult.inicio_em, fim_em: ult.fim_em, urls: ult.urls },
    em_andamento: aberto && { id: aberto.id, status: aberto.status, pedido_em: aberto.pedido_em, inicio_em: aberto.inicio_em },
    ...r,
  }
}

export const publicarRpc = (lerConteudo) => ({
  site_pendencias: () => pendencias(lerConteudo()),
  site_pedir_publicacao: () => {
    PUBLICACOES.forEach(andar)
    const aberto = PUBLICACOES.find((p) => p.status === 'pedido' || p.status === 'rodando')
    if (aberto) return { id: aberto.id, status: aberto.status, ja_havia: true }
    const id = Math.max(...PUBLICACOES.map((p) => p.id)) + 1
    PUBLICACOES.push({ id, origem: 'plataforma', status: 'pedido', pedido_em: iso(Date.now()), inicio_em: null, fim_em: null, urls: null, versao: null, resumo: null })
    return { id, status: 'pedido', ja_havia: false }
  },
  site_publicacao_status: (a) => {
    const p = PUBLICACOES.find((x) => x.id === Number(a?.id_))
    if (!p) return null
    andar(p)
    return { id: p.id, status: p.status, origem: p.origem, pedido_em: p.pedido_em, inicio_em: p.inicio_em, fim_em: p.fim_em, urls: p.urls, resumo: p.resumo, agora: iso(Date.now()), ...servidor() }
  },
})
