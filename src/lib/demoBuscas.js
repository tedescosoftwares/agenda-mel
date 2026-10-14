// As buscas do Google no modo demonstração (3.12): 200 dias de Search Console
// de mentira, sempre os mesmos (sorteio com semente), no mesmo formato que
// guia_buscas() devolve no banco (migrações 160 e 162: o site inteiro, por seção). As contas daqui imitam as do
// SQL: período terminando no último dia que "o Google entregou", posição
// média pesada pelas impressões, comparação só com histórico inteiro.
//
// Na URL do demo:
//   ?gsc=desligado  a tela de "ainda não ligado" (o botão "liga" o demo)
//   ?gsc=erro       com dados, mas a última sincronização do relógio falhou
//   ?gsc=vazio      ligado e sincronizando, mas o Google ainda não mostrou o guia em busca nenhuma
import { GUIA_LUGARES } from './demoGuia.js'

const DIAS_DEMO = 200
const ATRASO = 3 // o Google entrega com 2 a 3 dias de atraso

// mulberry32: a mesma semente, os mesmos números
function sorteio(semente) {
  let a = semente >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const iso = (d) => d.toISOString().slice(0, 10)
const somarDias = (dia, n) => iso(new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86400e3))
const hojeSP = () => iso(new Date(Date.now() - 3 * 3600e3))

// a taxa de clique típica de cada posição (só para o demo parecer de verdade)
const ctrDaPosicao = (p) => (p <= 1.5 ? 0.3 : p <= 2.5 ? 0.17 : p <= 3.5 ? 0.11 : p <= 5 ? 0.07 : p <= 7 ? 0.045 : p <= 10 ? 0.025 : p <= 15 ? 0.01 : 0.004)

// [página, busca, impressões por dia (no fim do período), posição de hoje, quanto clica além da curva]
const GERAIS = [
  ['/saloes/itanhaem', 'salão de beleza itanhaém', 9, 7.4, 1],
  ['/saloes/itanhaem', 'salões em itanhaém', 2, 3.2, 1],
  ['/saloes/itanhaem', 'cabeleireiro itanhaém', 5, 11.6, 1],
  ['/saloes/itanhaem', 'salão de beleza perto de mim', 6, 19, 1],
  ['/saloes/itanhaem', 'salão aberto sábado itanhaém', 1.4, 5.1, 1],
  ['/saloes/itanhaem/unhas', 'manicure itanhaém', 7, 6.2, 1],
  ['/saloes/itanhaem/unhas', 'unha em gel itanhaém', 3, 8.7, 1],
  ['/saloes/itanhaem/unhas', 'manicure perto de mim', 5, 13.8, 1],
  ['/saloes/itanhaem/cilios', 'extensão de cílios itanhaém', 2.6, 4.7, 1],
  ['/saloes/itanhaem/cilios', 'lash designer itanhaém', 1.2, 9.4, 1],
  ['/saloes', 'guia de salões de beleza litoral sul', 0.6, 23, 1],
  ['/saloes/itanhaem/bairro/centro', 'salão de beleza centro itanhaém', 2.2, 6.3, 1],
  ['/saloes/itanhaem/horario/domingo', 'salão aberto domingo itanhaém', 1.8, 4.2, 1.2],
  // o resto do site: a página inicial, planos e o blog (seções 'site' e 'blog')
  ['/', 'mimo agenda salão', 4, 2.1, 1.3],
  ['/', 'sistema para salão de beleza', 14, 9.8, 1],
  ['/planos', 'sistema para salão de beleza preço', 3, 7.5, 1],
  ['/sistema-para-salao-de-beleza', 'sistema para salão de beleza', 9, 6.4, 1],
  ['/blog/como-lotar-a-agenda-do-salao', 'como lotar a agenda do salão', 6, 5.2, 1.1],
  ['/blog/como-lotar-a-agenda-do-salao', 'agenda de salão cheia', 2, 8.9, 1],
  ['/blog/whatsapp-para-salao', 'mensagem de confirmação de horário salão', 5, 3.9, 1.2],
]
// os títulos do resto do site (no banco: blog_posts e seo_pages)
const TITULOS = {
  '/': 'Página inicial', '/planos': 'Planos', '/sistema-para-salao-de-beleza': 'Sistema para salão de beleza',
  '/blog/como-lotar-a-agenda-do-salao': 'Como lotar a agenda do salão', '/blog/whatsapp-para-salao': 'WhatsApp para salão: mensagens que funcionam',
}
const secaoDe = (pagina) => (/^\/saloes(\/|$)/.test(pagina) ? 'guia' : /^\/blog(\/|$)/.test(pagina) ? 'blog' : 'site')
// as buscas de cada salão do demo (as que têm nome do salão clicam mais)
const DO_SALAO = {
  'studio-lirio': [['studio lírio itanhaém', 2, 1.3, 1.6], ['manicure centro itanhaém', 3, 5.8, 1], ['pedicure itanhaém', 2, 9.2, 1]],
  'atelie-cabelo-e-arte': [['ateliê cabelo e arte', 1, 1.2, 1.6], ['cabeleireira belas artes itanhaém', 1.2, 4.4, 1], ['coloração cabelo itanhaém', 2.2, 12.6, 1]],
  'olhar-lash-studio': [['olhar lash studio', 1, 1.1, 1.6], ['cílios gaivota itanhaém', 0.8, 3.3, 1], ['extensão de cílios itanhaém', 2.4, 7.8, 1]],
  // aparece no topo para "salão de beleza centro" e quase ninguém clica: vira oportunidade
  'studio-mel': [['studio mel itanhaém', 1.5, 1.4, 1.6], ['salão de beleza centro itanhaém', 4, 2.6, 0.12], ['design de sobrancelha itanhaém', 2, 6.9, 1]],
}

let LINHAS = null
let ligado = true
let comErro = false
let vazio = false
let execucao = null
let primeiraVez = true

function lerModo() {
  if (!primeiraVez) return
  primeiraVez = false
  let modo = ''
  try { modo = new URLSearchParams(window.location.search).get('gsc') ?? '' } catch { /* sem janela */ }
  ligado = modo !== 'desligado'
  comErro = modo === 'erro'
  vazio = modo === 'vazio'
}

function gerar() {
  const r = sorteio(20261014)
  const ultimo = somarDias(hojeSP(), -ATRASO)
  const noAr = GUIA_LUGARES.filter((l) => l.status === 'publicado')
  const pares = [...GERAIS]
  for (const l of noAr) {
    const pagina = `/saloes/${l.cidade_slug}/${l.slug}`
    for (const [q, imp, pos, fator] of DO_SALAO[l.slug] ?? [[l.nome.toLowerCase(), 1, 1.5, 1.6]]) pares.push([pagina, q, imp, pos, fator])
  }
  const linhas = []
  for (let d = DIAS_DEMO - 1; d >= 0; d--) {
    const dia = somarDias(ultimo, -d)
    const crescer = 0.25 + 0.75 * ((DIAS_DEMO - 1 - d) / (DIAS_DEMO - 1)) // o guia vai aparecendo mais com o tempo
    const semana = [5, 6].includes(new Date(`${dia}T12:00:00Z`).getUTCDay()) ? 1.2 : 1 // sexta e sábado buscam mais
    for (const [pagina, consulta, imp, pos, fator] of pares) {
      // a posição melhora com o tempo (estava umas 3 posições pior no começo)
      const posDia = Math.max(1, pos + (d / DIAS_DEMO) * 3 + (r() - 0.5) * 1.6)
      const total = Math.round(imp * crescer * semana * (0.5 + r()))
      if (!total) continue
      const cel = Math.round(total * (0.7 + r() * 0.12))
      const tab = r() < 0.04 ? 1 : 0
      for (const [aparelho, n] of [['celular', cel], ['computador', Math.max(0, total - cel - tab)], ['tablet', tab]]) {
        if (!n) continue
        const chance = Math.min(0.9, ctrDaPosicao(posDia) * fator)
        let cliques = 0
        for (let k = 0; k < n; k++) if (r() < chance) cliques++
        linhas.push({ dia, pagina, consulta, aparelho, cliques, impressoes: n, posicao: Math.round((posDia + (aparelho === 'computador' ? 0.6 : 0)) * 10) / 10 })
      }
    }
  }
  return linhas
}
const linhasDemo = () => (LINHAS ??= gerar())

// ---- as contas de guia_buscas(), em JS -------------------------------------------------
const r4 = (v) => Math.round(v * 10000) / 10000
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)
function somar(linhas) {
  let c = 0, i = 0, p = 0
  for (const l of linhas) { c += l.cliques; i += l.impressoes; p += l.posicao * l.impressoes }
  return { cliques: c, impressoes: i, ctr: i ? r4(c / i) : 0, posicao: i ? r1(p / i) : null }
}
function agrupar(linhas, chave) {
  const m = new Map()
  for (const l of linhas) {
    const k = chave(l)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(l)
  }
  return m
}
const ordem = (a, b) => b.cliques - a.cliques || b.impressoes - a.impressoes

function nomeDa(pagina) {
  if (secaoDe(pagina) !== 'guia') return { lugar_id: null, nome: TITULOS[pagina] ?? null, categoria: null, bairro: null, status: null, cidade: null }
  const [, , cidade, slug, resto] = pagina.split('/')
  const l = !resto && slug ? GUIA_LUGARES.find((x) => x.cidade_slug === cidade && x.slug === slug) : null
  const daCidade = GUIA_LUGARES.find((x) => x.cidade_slug === cidade)
  return { lugar_id: l?.id ?? null, nome: l?.nome ?? null, categoria: l?.categoria ?? null, bairro: l?.bairro ?? null, status: l?.status ?? null, cidade: daCidade?.cidade ?? null }
}

export function demoBuscas(args = {}) {
  lerModo()
  const ndias = Math.max(1, Math.min(Number(args.dias) || 30, 480))
  const secao = ['guia', 'blog', 'site', 'tudo'].includes(args.secao) ? args.secao : 'guia'
  const limiar = Math.max(5, Math.ceil(ndias / 3))
  const tudo = ligado && !vazio ? linhasDemo() : []
  const todas = secao === 'tudo' ? tudo : tudo.filter((l) => secaoDe(l.pagina) === secao)
  const primeiro = tudo.length ? tudo[0].dia : null
  const ultimo = tudo.length ? tudo[tudo.length - 1].dia : null
  const ate = ultimo ?? somarDias(hojeSP(), -ATRASO)
  const de = somarDias(ate, -(ndias - 1))
  const antes = somarDias(de, -ndias)
  const agora = todas.filter((l) => l.dia >= de && l.dia <= ate)
  const secoes = {}
  for (const l of tudo) {
    if (l.dia < de || l.dia > ate) continue
    const k = secaoDe(l.pagina)
    secoes[k] = { cliques: (secoes[k]?.cliques ?? 0) + l.cliques, impressoes: (secoes[k]?.impressoes ?? 0) + l.impressoes }
  }
  const anteriores = primeiro && primeiro <= antes ? todas.filter((l) => l.dia >= antes && l.dia < de) : null
  const totais = (ls) => ({ ...somar(ls), consultas: new Set(ls.map((l) => l.consulta)).size, paginas: new Set(ls.map((l) => l.pagina)).size })

  const porDia = agrupar(agora, (l) => l.dia)
  const pq = [...agrupar(agora, (l) => `${l.pagina}|${l.consulta}`).values()].map((ls) => ({ pagina: ls[0].pagina, consulta: ls[0].consulta, ...somar(ls) }))
  const consultas = [...agrupar(agora, (l) => l.consulta).entries()]
    .map(([consulta, ls]) => ({ consulta, ...somar(ls), paginas: new Set(ls.map((l) => l.pagina)).size }))
    .sort((a, b) => ordem(a, b) || a.consulta.localeCompare(b.consulta)).slice(0, 100)
  const paginas = [...agrupar(agora, (l) => l.pagina).entries()]
    .map(([pagina, ls]) => ({
      pagina, ...nomeDa(pagina), ...somar(ls), n_consultas: new Set(ls.map((l) => l.consulta)).size,
      consultas: pq.filter((q) => q.pagina === pagina).sort((a, b) => ordem(a, b) || a.consulta.localeCompare(b.consulta)).slice(0, 10)
        .map(({ consulta, cliques, impressoes, ctr, posicao }) => ({ consulta, cliques, impressoes, ctr, posicao })),
    }))
    .sort((a, b) => ordem(a, b) || a.pagina.localeCompare(b.pagina)).slice(0, 200)
  const oportunidades = pq
    .filter((q) => q.impressoes >= limiar && ((q.posicao >= 4 && q.posicao <= 15) || (q.posicao < 4 && q.ctr < 0.05)))
    .map((q) => ({ ...q, motivo: q.posicao < 4 ? 'pouco_clique' : 'subir', nome: nomeDa(q.pagina).nome, cidade: nomeDa(q.pagina).cidade }))
    .sort((a, b) => b.impressoes - a.impressoes || a.posicao - b.posicao || a.consulta.localeCompare(b.consulta)).slice(0, 30)

  const dias = []
  for (let d = de; d <= ate; d = somarDias(d, 1)) {
    const s = somar(porDia.get(d) ?? [])
    dias.push({ dia: d, cliques: s.cliques, impressoes: s.impressoes, posicao: s.posicao })
  }
  const ultimaExec = execucao ?? (!ligado ? null : vazio
    ? { em: new Date(Date.now() - 5 * 3600e3).toISOString(), origem: 'relogio', ok: true, de: somarDias(ate, -7), ate: hojeSP(), linhas: 0, parcial: false, erro: null }
    : comErro
    ? { em: new Date(Date.now() - 7 * 3600e3).toISOString(), origem: 'relogio', ok: false, de: null, ate: null, linhas: 0, parcial: false, erro: 'a conta de serviço (buscas@mimo-demo.iam.gserviceaccount.com) ainda não tem acesso a esta propriedade: no Search Console, Configurações → Usuários e permissões → Adicionar usuário, com esse e-mail' }
    : { em: new Date(Date.now() - 5 * 3600e3).toISOString(), origem: 'relogio', ok: true, de: somarDias(ate, -7), ate: hojeSP(), linhas: 412, parcial: false, erro: null })

  return {
    dias: ndias, secao, de, ate, tem_dados: !!ultimo, secoes, primeiro_dia: primeiro, ultimo_dia: ultimo, limiar,
    atualizado_em: ultimo ? new Date(Date.now() - (comErro ? 31 : 5) * 3600e3).toISOString() : null,
    execucao: ultimaExec,
    ultima_ok: ultimaExec?.ok ? ultimaExec.em : ultimo ? new Date(Date.now() - 31 * 3600e3).toISOString() : null,
    totais: totais(agora),
    totais_antes: anteriores ? totais(anteriores) : null,
    por_dia: dias,
    aparelhos: [...agrupar(agora, (l) => l.aparelho).entries()].map(([aparelho, ls]) => ({ aparelho, cliques: somar(ls).cliques, impressoes: somar(ls).impressoes })).sort((a, b) => b.impressoes - a.impressoes),
    consultas, paginas, oportunidades,
  }
}

// a função gsc-sincronizar no demo: espera um pouco e "traz" os dias que faltam;
// desligado, "liga" (como se o dono tivesse acabado de gravar os segredos)
export async function demoGscSincronizar() {
  lerModo()
  await new Promise((ok) => setTimeout(ok, 900))
  const primeira = !ligado
  ligado = true
  comErro = false
  const ultimo = somarDias(hojeSP(), -ATRASO)
  const dias = primeira ? 480 : 8
  const linhas = vazio ? 0 : primeira ? linhasDemo().length : linhasDemo().filter((l) => l.dia > somarDias(ultimo, -dias)).length
  const de = somarDias(hojeSP(), -(dias - 1))
  execucao = { em: new Date().toISOString(), origem: 'plataforma', ok: true, de, ate: hojeSP(), linhas, parcial: false, erro: null }
  return { ok: true, de, ate: hojeSP(), dias, linhas, janelas: Math.ceil(dias / 30), pedidos: Math.ceil(dias / 30), descartadas: 0, parcial: false }
}

export const BUSCAS_RPC = {
  guia_buscas: (a) => demoBuscas(a ?? {}),
}
