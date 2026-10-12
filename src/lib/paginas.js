// As páginas públicas, com a regra da casa (3.3): o código é a reserva e o
// modelo; o banco manda. Cada página SEO tem uma linha em seo_pages, e a
// coluna `conteudo` (jsonb, editada na Plataforma > SEO e Conteúdo) guarda o
// miolo inteiro: herói, rotina, módulos, FAQ, "veja também", guias, chamada.
// Quando `conteudo` está vazio, vale o que está em src/conteudo/paginasSeo.js.
// Página criada na Plataforma (rota que o código não conhece) abre no site na
// hora e entra no sitemap no próximo publicar. Este módulo não tem React nem
// Supabase: o build (scripts/paginas-estaticas.mjs) também o usa.

export const HUB = '/sistema-para-salao-de-beleza'
export const HUB_AUTONOMA = '/app-para-profissional-de-beleza'

export const FOTOS = [['lifestyle', 'Bancada com o app (lifestyle)'], ['cliente', 'Cliente marcando no celular'], ['profissional', 'Profissional no salão'], ['equipe', 'Dona e equipe no tablet'], ['agenda-celular', 'Agenda no celular'], ['salao', 'Recepção do salão'], ['painel', 'Painel do salão no computador']]
export const MOCKS = [['desktop', 'Agenda do salão (computador)'], ['celular', 'App no celular'], ['profissional', 'App da profissional'], ['retorno', 'Retorno de clientes'], ['espera', 'Lista de espera'], ['whats', 'Confirmação no WhatsApp'], ['pagamento', 'Sinal por Pix'], ['qr', 'QR Code do salão']]
export const TIPOS = [['principal', 'Principal (hub)'], ['profissao', 'Por profissão (autônoma)'], ['problema', 'Por problema (uma dor, uma solução)'], ['comparativo', 'Comparativo']]
export const ICONES = ['CalendarDays', 'Users', 'Heart', 'MessageCircle', 'Clock', 'Wallet', 'UserRound', 'PauseCircle', 'CalendarPlus', 'Scissors', 'QrCode', 'RotateCcw', 'Bell', 'Hand', 'Eye', 'Flower2', 'Receipt', 'LayoutGrid', 'Star']

const texto = (v) => (v == null ? '' : String(v))
export const linhas = (v) => (Array.isArray(v) ? v.map(texto).map((s) => s.trim()).filter(Boolean) : typeof v === 'string' ? v.split('\n').map((s) => s.trim()).filter(Boolean) : [])
export const pares = (v) => (Array.isArray(v) ? v.map((p) => (Array.isArray(p) ? [texto(p[0]).trim(), texto(p[1]).trim()] : p && typeof p === 'object' ? [texto(p.a ?? p.pergunta ?? p.rota).trim(), texto(p.b ?? p.resposta ?? p.rotulo).trim()] : null)).filter((p) => p && (p[0] || p[1])) : [])
const cheio = (lista) => (Array.isArray(lista) && lista.length ? lista : undefined)

// o que toda página precisa ter para a tela não quebrar, venha do código ou do banco
export function normalizarPagina(p) {
  if (!p || typeof p !== 'object') return null
  const n = { ...p }
  n.rota = texto(p.rota)
  n.tipo = TIPOS.some(([t]) => t === p.tipo) ? p.tipo : 'problema'
  n.kicker = texto(p.kicker).trim() || 'MIMO'
  n.h1 = linhas(p.h1); if (!n.h1.length) n.h1 = [n.kicker]
  n.sub = texto(p.sub)
  n.provas = linhas(p.provas)
  n.foto = texto(p.foto) || 'lifestyle'
  n.alt = texto(p.alt)
  n.bilhete = texto(p.bilhete)
  n.mock = texto(p.mock)
  n.mockTitulo = texto(p.mockTitulo)
  n.mockTexto = texto(p.mockTexto)
  n.rotina = cheio((p.rotina || []).filter((c) => c && (c.titulo || c.cena)).map((c) => ({ titulo: texto(c.titulo), cena: texto(c.cena), resolve: texto(c.resolve), ancora: texto(c.ancora) })))
  n.modulos = cheio((p.modulos || []).filter((m) => m && (m.titulo || m.texto)).map((m, i) => ({ id: texto(m.id).trim() || `modulo-${i + 1}`, kicker: texto(m.kicker), titulo: texto(m.titulo), texto: texto(m.texto), itens: linhas(m.itens), mock: texto(m.mock), foto: texto(m.foto), alt: texto(m.alt), links: pares(m.links).filter((l) => l[0]) })))
  n.sinonimos = p.sinonimos && (p.sinonimos.titulo || p.sinonimos.texto) ? { titulo: texto(p.sinonimos.titulo), texto: texto(p.sinonimos.texto) } : undefined
  n.planos = !!p.planos
  n.blocos = cheio((p.blocos || []).filter((b) => b && (b.titulo || b.texto)).map((b) => ({ titulo: texto(b.titulo), texto: texto(b.texto), itens: linhas(b.itens) })))
  n.funcoes = cheio((p.funcoes || []).map((f) => (Array.isArray(f) ? { icone: texto(f[0]), titulo: texto(f[1]), texto: texto(f[2]) } : f && typeof f === 'object' ? { icone: texto(f.icone), titulo: texto(f.titulo), texto: texto(f.texto) } : null)).filter((f) => f && f.titulo))
  n.faixa = p.faixa && (p.faixa.titulo || p.faixa.texto) ? { titulo: texto(p.faixa.titulo), texto: texto(p.faixa.texto), foto: texto(p.faixa.foto) || 'cliente', bilhete: texto(p.faixa.bilhete) } : undefined
  n.faqTitulo = texto(p.faqTitulo)
  n.faq = pares(p.faq)
  n.relacionadas = linhas(p.relacionadas).filter((r) => r !== n.rota)
  n.artigos = linhas(p.artigos)
  n.cta = { rotulo: texto(p.cta?.rotulo).trim() || (n.tipo === 'profissao' ? 'Criar agenda grátis' : 'Começar agora'), tipo: p.cta?.tipo === 'salao' || p.cta?.tipo === 'autonoma' ? p.cta.tipo : null }
  n.pai = 'pai' in p && p.pai !== undefined ? (p.pai || null) : n.rota === HUB || n.rota === HUB_AUTONOMA ? null : n.tipo === 'profissao' ? HUB_AUTONOMA : HUB
  if (n.pai === n.rota) n.pai = null
  n.rodape = texto(p.rodape).trim()
  n.rodapeMostrar = p.rodapeMostrar !== false
  n.ordem = Number.isFinite(Number(p.ordem)) && p.ordem !== '' && p.ordem != null ? Number(p.ordem) : 100
  n.atualizado_em = texto(p.atualizado_em).slice(0, 10)
  n.seo_title = texto(p.seo_title)
  n.meta_description = texto(p.meta_description)
  return n
}

// a página que vale: o código por baixo, a linha do banco por cima
// (metas sempre; o miolo só quando `conteudo` foi salvo na Plataforma)
export function mesclarPagina(codigo, linha) {
  const conteudo = linha?.conteudo && typeof linha.conteudo === 'object' && !Array.isArray(linha.conteudo) ? linha.conteudo : null
  let base = conteudo ? { ...(codigo || {}), ...conteudo, rota: linha.route || codigo?.rota } : codigo ? { ...codigo } : null
  if (!base) return null
  if (linha) {
    base.seo_title = linha.seo_title || base.seo_title
    base.meta_description = linha.meta_description || base.meta_description
    if (linha.og_image_url) base.og_image_url = linha.og_image_url
    if (linha.canonical_url) base.canonical_url = linha.canonical_url
    base.noindex = linha.robots_index === false
    base.doBanco = !!conteudo
    if (linha.updated_at && conteudo) base.atualizado_em = String(linha.updated_at).slice(0, 10)
  }
  return normalizarPagina(base)
}

// o miolo das páginas institucionais, da home e do blog: o do código, com o do banco por cima
export function mesclarConteudo(codigo, linha) {
  const c = linha?.conteudo && typeof linha.conteudo === 'object' && !Array.isArray(linha.conteudo) ? linha.conteudo : {}
  const r = { ...(codigo || {}) }
  for (const [k, v] of Object.entries(c)) if (v !== null && v !== undefined && !(typeof v === 'string' && !v.trim()) && !(Array.isArray(v) && !v.length)) r[k] = v
  return r
}

export const rotuloRodape = (p) => p.rodape || p.kicker

// o ponto de partida de uma página nova criada na Plataforma
export function modeloDePagina(rota = '') {
  return normalizarPagina({
    rota, tipo: 'problema', kicker: 'Nome curto da página', h1: ['Um título que diz', 'o que a página resolve.'],
    sub: 'Um parágrafo com as palavras da dona do salão: a dor de hoje e como a MIMO entra nela.',
    provas: ['Uma prova curta', 'Outra prova', 'Mais uma'],
    foto: 'lifestyle', alt: 'descreva a foto para quem não vê', bilhete: 'um bilhete curto',
    mockTitulo: 'O produto, de perto.', mockTexto: 'Uma frase sobre o que a pessoa vê quando abre a MIMO.',
    rotina: [{ titulo: 'A cena de hoje', cena: 'O que acontece no salão sem a MIMO.', resolve: 'O que muda com a MIMO.', ancora: 'modulo-1' }],
    modulos: [{ id: 'modulo-1', kicker: 'Módulo', titulo: 'O que este módulo faz.', texto: 'Explique em um parágrafo, com exemplos do dia a dia.', itens: ['Um item', 'Outro item', 'Mais um'], mock: 'celular', foto: '', alt: '', links: [] }],
    faq: [['Uma pergunta que a cliente faz?', 'A resposta, curta e direta.']],
    relacionadas: [HUB, '/agenda-para-salao-de-beleza', '/agendamento-online'], artigos: [],
    cta: { rotulo: 'Começar agora', tipo: null }, rodapeMostrar: true, ordem: 500,
    atualizado_em: new Date().toISOString().slice(0, 10),
  })
}
