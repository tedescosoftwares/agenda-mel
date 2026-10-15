// As páginas de coleção do guia (3.12): mais portas de entrada pelo Google,
// feitas só dos dados, sem IA, como as páginas dos salões.
//   /saloes/itanhaem/bairro/centro              os salões de um bairro
//   /saloes/itanhaem/horario/domingo            os que abrem no domingo
//   /saloes/itanhaem/horario/cedo | noite | sabado-o-dia-todo
//   /saloes/itanhaem/horario/domingo/unhas      a mesma ideia numa categoria
//
// Aqui mora a regra de quais coleções existem e o texto de cada uma
// (título, descrição, chamada, introdução com números verdadeiros e
// comparações com a cidade, perguntas frequentes). O site (React) e o
// gerador de HTML estático (scripts/guia-estatico.mjs) usam a mesma função,
// então o robô lê o mesmo texto que a pessoa vê.
//
// Contra página fina e repetida:
//   - bairro e horário só existem com pelo menos MINIMO_COLECAO salões no ar;
//     horário numa categoria, com MINIMO_COLECAO_CATEGORIA (e só se a página
//     do horário na cidade existir);
//   - coleção que pega mais de TETO_COLECAO da cidade (ou da categoria) não
//     existe: seria a página da cidade com outro título;
//   - "sábado o dia todo" não tem versão por categoria (é o normal de quase
//     todo salão) e a categoria "beleza" não tem versão por horário (o
//     título ficaria igual ao da cidade).
// Nada de nota nem avaliação: só endereço, bairro, horário, serviços e o que
// o próprio lugar divulga. Quem divulga "24 horas" fica fora das contas de
// horário (é dado que vale confirmar, como diz a página do salão).
//
// A chave do bairro (chaveDoBairro) tem a mesma regra de guia_bairro_slug()
// no banco (supabase/157_paginas_por_bairro_e_horario.sql): mexeu numa,
// mexa na outra.
import { categoriaDoGuia, slugificar, hora, faixaTexto, rotaDoGuia, rotaDaCidade } from './guia.js'
import { fatosDoHorario, contextoDaCidade } from './guiaTexto.js'

export const MINIMO_COLECAO = 3
export const MINIMO_COLECAO_CATEGORIA = 5
export const TETO_COLECAO = 0.7
export const TIPOS_DE_COLECAO = ['bairro', 'horario']

// ---- sorteio estável (o mesmo de guiaTexto.js) ------------------------------------------
function hash(s) {
  let h = 0x811c9dc5
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
function sorteio(semente) {
  let a = hash(semente) || 1
  const prox = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const um = (xs) => xs[Math.floor(prox() * xs.length)]
  const embaralhar = (xs) => { const c = [...xs]; for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(prox() * (i + 1));[c[i], c[j]] = [c[j], c[i]] } return c }
  return { um, embaralhar }
}

// ---- texto ----------------------------------------------------------------------------------
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')
const juntarE = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}`)
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const minutos = (h) => { const [H, M] = String(h).split(':').map(Number); return H * 60 + M }
const hm = (m) => { const x = ((m % 1440) + 1440) % 1440; return hora(`${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`) }
// "até as 21h" | "até a meia-noite"
const ateAs = (m) => (m >= 1440 ? 'até a meia-noite' : `até as ${hm(m)}`)
function cortarSeco(t, max) {
  let x = String(t ?? '').replace(/\s+/g, ' ').trim()
  if (x.length <= max) return x
  x = x.slice(0, max + 1)
  return x.slice(0, x.lastIndexOf(' ') > 0 ? x.lastIndexOf(' ') : max).replace(/[,;:\s–-]+$/, '')
}
const primeiraQueCabe = (opcoes, max) => opcoes.find((o) => o && o.length <= max) ?? cortarSeco(opcoes.at(-1), max)
const noBairro = (b) => (/^centro$/i.test(b) ? 'no Centro' : `no bairro ${b}`)
const naRua = (r) => (/^(largo|lgo\.?|beco|parque|p[aá]tio)\b/i.test(r) ? `no ${r}` : `na ${r}`)
const ORDINAL = ['', 'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto']
// "3 salões", "a 1 manicure" não: um, uma
const numero = (n, g = 'o') => (n === 1 ? (g === 'a' ? 'uma' : 'um') : String(n))

// como cada categoria se conta no texto ("5 cabeleireiros, 3 manicures") e o gênero
const NOMES = {
  beleza: ['salão de beleza', 'salões de beleza', 'o'],
  cabelo: ['cabeleireiro', 'cabeleireiros', 'o'],
  unhas: ['manicure', 'manicures', 'a'],
  cilios: ['estúdio de cílios', 'estúdios de cílios', 'o'],
  sobrancelhas: ['estúdio de sobrancelha', 'estúdios de sobrancelha', 'o'],
  estetica: ['espaço de estética', 'espaços de estética', 'o'],
  maquiagem: ['maquiadora', 'maquiadoras', 'a'],
}
const nomeDa = (cat) => NOMES[cat] ?? NOMES.beleza
const contarCategoria = (cat, n) => `${numero(n, nomeDa(cat)[2])} ${n === 1 ? nomeDa(cat)[0] : nomeDa(cat)[1]}`

// ---- bairro ---------------------------------------------------------------------------------
// O bairro do Google vem sujo: "Sl 18 - Centro", "Lj 03 - Jardim MOSTEIRO",
// "Gaivota - Praia", "Nova Itanhaém - Interior", "umuarama". A chave junta
// o que é o mesmo bairro: tira loja/sala/casa, o "Praia"/"Interior" do fim
// e o "Jardim"/"Balneário" do começo. A URL usa a chave; o nome que aparece
// é o jeito mais comum de escrever entre os salões daquele bairro.
const COMPLEMENTO = /^(lj|loja|sl|sala|cs|casa|salao|portao|interfone|sobreloja|box|bloco|bl|ap|apto|lote|lt|qd|quadra|km|andar|fundos|terreo|galeria|anexo)(-?[0-9]|-[a-z0-9]{1,2}$|-n-|$)|^[0-9]/
const PEDACOS = /\s+[-–]\s+/
const ehComplemento = (s) => !s || s === 'praia' || s === 'interior' || COMPLEMENTO.test(s)
export function chaveDoBairro(bairro, cidadeSlug = '') {
  let ultimo = ''
  for (const pedaco of String(bairro ?? '').split(PEDACOS)) {
    const s = slugificar(pedaco)
    if (!ehComplemento(s)) ultimo = s
  }
  const k = ultimo.replace(/^(jardim|jd|balneario|conj-hab)-/, '')
  return k && k !== cidadeSlug ? k : ''
}
// o bairro como dá para mostrar num cartão: sem loja e sala, com "Praia"/"Interior" ("Gaivota - Praia")
export function bairroLimpo(bairro) {
  const pedacos = String(bairro ?? '').trim().split(PEDACOS).map((p) => p.trim()).filter((p) => p && !COMPLEMENTO.test(slugificar(p)))
  const t = pedacos.join(' - ')
  if (!t) return ''
  return t === t.toLowerCase() || t === t.toUpperCase() ? t.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, e, c) => e + c.toUpperCase()) : t
}
// o nome do bairro (sem "Praia"/"Interior"), para o título da página
function nomeDoBairro(bairro) {
  const pedacos = bairroLimpo(bairro).split(PEDACOS).filter((p) => !/^(praia|interior)$/i.test(p))
  return pedacos.at(-1) ?? ''
}
// chave -> nome mais comum, para quem só tem o caminho (a aba Desempenho, por exemplo)
export function nomesDosBairros(lugares, cidadeSlug = '') {
  const contagem = new Map()
  for (const l of lugares ?? []) {
    const k = chaveDoBairro(l?.bairro, cidadeSlug || l?.cidade_slug || '')
    if (!k) continue
    const nomes = contagem.get(k) ?? new Map()
    const n = nomeDoBairro(l.bairro)
    nomes.set(n, (nomes.get(n) ?? 0) + 1)
    contagem.set(k, nomes)
  }
  return new Map([...contagem].map(([k, nomes]) => [k, [...nomes].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0]]))
}
const nomeDoSlug = (s) => String(s ?? '').split('-').map((p) => (['de', 'da', 'do', 'das', 'dos', 'e'].includes(p) ? p : cap(p))).join(' ')

// a rua, para "só na Av. Rui Barbosa ficam 7" ('Av. Rui Barbosa, 12' e 'Avenida Rui Barbosa' são a mesma)
const ABREV = { r: 'rua', av: 'avenida', al: 'alameda', tv: 'travessa', estr: 'estrada', pca: 'praca', rod: 'rodovia', lgo: 'largo' }
function ruaDe(endereco) {
  const nome = String(endereco ?? '').split(',')[0].trim()
  if (!nome || /\d/.test(nome)) return null
  const [primeira, ...resto] = slugificar(nome).split('-')
  return { chave: [ABREV[primeira] ?? primeira, ...resto].join('-'), nome }
}

// ---- horário --------------------------------------------------------------------------------
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const ORDEM = [1, 2, 3, 4, 5, 6, 0]
const fimDa = (faixa) => minutos(faixa[1])
// "19:00–02:00": passa da meia-noite (no salão, quase sempre é horário cadastrado errado)
const viraANoite = (h) => h.some((x) => (x.faixas ?? []).some(([a, b]) => minutos(b) <= minutos(a)))
const cacheDoPerfil = new WeakMap()
// o horário de um salão pronto para as coleções; null sem horário, com "24 horas" ou
// com expediente que passa da meia-noite (dado que vale confirmar, fica fora das contas)
export function perfilDoHorario(l) {
  const h = l?.horarios
  if (!Array.isArray(h) || !h.length) return null
  if (cacheDoPerfil.has(h)) return cacheDoPerfil.get(h)
  const f = fatosDoHorario(h)
  let p = null
  if (f && !f.vinteQuatro && !viraANoite(h)) {
    const por = new Map(h.map((x) => [x.dia, x.faixas ?? []]))
    const abre = (d) => minutos(por.get(d)[0][0])
    const fecha = (d) => fimDa(por.get(d).at(-1))
    // abrir à 0h não é abrir cedo (é o resto da noite anterior)
    const diasCedo = f.abertos.filter((d) => abre(d) >= 300 && abre(d) <= 480)
    const diasNoite = f.abertos.filter((d) => fecha(d) >= 1200)
    const sab = f.sabado
    // o jeito de cada um: a hora em que abre e a hora em que fecha na maior parte dos dias
    const moda = (xs) => contar(xs, (x) => String(x))[0]?.[0]
    p = {
      abreTipico: Number(moda(f.abertos.map(abre))),
      fechaTipico: Number(moda(f.abertos.map(fecha))),
      abertos: f.abertos,
      domingo: f.domingo,
      sabado: sab,
      // sábado o dia todo: até as 9h na porta, até as 18h ou mais, sem fechar para o almoço
      sabadoTodo: !!(sab && sab.length === 1 && minutos(sab[0][0]) <= 540 && fimDa(sab[0]) >= 1080),
      diasCedo,
      diasNoite,
      abreMaisCedo: diasCedo.length ? Math.min(...diasCedo.map(abre)) : Math.min(...f.abertos.map(abre)),
      fechaMaisTarde: Math.max(...f.abertos.map(fecha)),
    }
  }
  cacheDoPerfil.set(h, p)
  return p
}
// 'seg a sex' | 'ter, qui e sáb' | '' (todos os dias abertos do lugar)
function diasCurtos(lista, abertos) {
  if (!lista.length || lista.length === abertos.length) return ''
  const ord = [...lista].sort((a, b) => ORDEM.indexOf(a) - ORDEM.indexOf(b))
  const seguidos = ord.every((d, i) => i === 0 || ORDEM.indexOf(d) === ORDEM.indexOf(ord[i - 1]) + 1)
  if (seguidos && ord.length >= 3) return `${DIAS_CURTOS[ord[0]]} a ${DIAS_CURTOS[ord.at(-1)]}`
  return juntarE(ord.map((d) => DIAS_CURTOS[d]))
}

// os quatro horários do guia: o valor vai na URL
// frase: "salões abertos no domingo" (g = o | a); um: "manicure aberta no domingo";
// criterio / criterioUm: o que entra, no plural e no singular ("abrem aos domingos")
const HORARIOS = {
  domingo: {
    rotulo: 'Abertos no domingo', frase: (g) => `abert${g}s no domingo`, um: (g) => `abert${g} no domingo`,
    criterio: 'abrem aos domingos', criterioUm: 'abre aos domingos', curto: 'abrem aos domingos', teste: (p) => !!p.domingo,
    linha: (p) => `Domingo, ${faixaTexto(p.domingo)}`, quando: 'no domingo',
  },
  cedo: {
    rotulo: 'Abrem cedo', frase: () => 'que abrem cedo', um: () => 'que abre cedo',
    criterio: 'abrem às 8h ou antes em pelo menos um dia da semana', criterioUm: 'abre às 8h ou antes em pelo menos um dia da semana',
    curto: 'abrem às 8h ou antes', teste: (p) => p.diasCedo.length > 0,
    linha: (p) => { const d = diasCurtos(p.diasCedo, p.abertos); return `Abre às ${hm(p.abreMaisCedo)}${d ? ` (${d})` : ''}` }, quando: 'antes do trabalho',
  },
  noite: {
    rotulo: 'Abertos à noite', frase: (g) => `abert${g}s à noite`, um: (g) => `abert${g} à noite`,
    criterio: 'atendem até as 20h ou mais em pelo menos um dia da semana', criterioUm: 'atende até as 20h ou mais em pelo menos um dia da semana',
    curto: 'atendem até as 20h ou mais', teste: (p) => p.diasNoite.length > 0,
    linha: (p) => { const d = diasCurtos(p.diasNoite, p.abertos); return `${cap(ateAs(p.fechaMaisTarde))}${d ? ` (${d})` : ''}` }, quando: 'depois do trabalho',
  },
  'sabado-o-dia-todo': {
    rotulo: 'Sábado o dia todo', frase: (g) => `abert${g}s no sábado o dia todo`, um: (g) => `abert${g} no sábado o dia todo`,
    criterio: 'abrem no sábado até as 9h e ficam até as 18h ou mais, sem fechar para o almoço', criterioUm: 'abre no sábado até as 9h e fica até as 18h ou mais, sem fechar para o almoço',
    curto: 'abrem no sábado o dia todo', teste: (p) => p.sabadoTodo,
    linha: (p) => `Sábado, ${faixaTexto(p.sabado)}`, quando: 'no sábado, de manhã ou de tarde,'
  },
}
const CHAVE_DO_RESUMO = { domingo: 'domingo', cedo: 'cedo', noite: 'noite', 'sabado-o-dia-todo': 'sabadoTodo' }
export const HORARIOS_DO_GUIA = Object.keys(HORARIOS)
const HORARIOS_POR_CATEGORIA = ['domingo', 'cedo', 'noite']
export const rotuloDoHorario = (valor) => HORARIOS[valor]?.rotulo ?? ''

// ---- caminhos -------------------------------------------------------------------------------
export function rotaDaColecao(cidadeSlug, tipo, valor, categoria = '') {
  return `/saloes/${cidadeSlug}/${tipo}/${valor}${categoria ? `/${categoria}` : ''}`
}
// '/saloes/itanhaem/horario/domingo/unhas' -> { cidade, tipo, valor, categoria } | null
export function lerCaminhoDeColecao(caminho) {
  const p = String(caminho ?? '').split(/[?#]/)[0].replace(/\/+$/, '').split('/').filter(Boolean)
  if (p[0] !== 'saloes' || p.length < 4 || p.length > 5 || !p[1]) return null
  if (p[2] === 'bairro' && p.length === 4 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(p[3])) return { cidade: p[1], tipo: 'bairro', valor: p[3], categoria: '' }
  if (p[2] !== 'horario' || !HORARIOS[p[3]]) return null
  if (p.length === 5 && !(HORARIOS_POR_CATEGORIA.includes(p[3]) && NOMES[p[4]] && p[4] !== 'beleza')) return null
  return { cidade: p[1], tipo: 'horario', valor: p[3], categoria: p[4] ?? '' }
}
// o nome de uma página de coleção pelo caminho (a aba Desempenho da Plataforma usa):
// nomes.cidade('itanhaem') -> 'Itanhaém'; nomes.bairro('centro', 'itanhaem') -> 'Centro'
export function rotuloDaColecao(caminho, nomes = {}) {
  const c = lerCaminhoDeColecao(caminho)
  if (!c) return null
  const cidade = (nomes.cidade ?? ((s) => s))(c.cidade)
  if (c.tipo === 'bairro') return `Salões ${noBairro(nomes.bairro?.(c.valor, c.cidade) || nomeDoSlug(c.valor))}, ${cidade}`
  const h = HORARIOS[c.valor]
  if (!c.categoria) return `Salões ${h.frase('o')} em ${cidade}`
  const [, varios, g] = nomeDa(c.categoria)
  return `${cap(varios)} ${h.frase(g)} em ${cidade}`
}

// ---- quais coleções existem ------------------------------------------------------------------
// a ordem do guia (3.17): MIMO e Seleção primeiro e, depois, a ordem em que o banco mandou a lista
// (guia_colecoes e guia_publicadas já vêm por pontos, nota e foto, migração 166; a nota não vem para
// o site, então aqui só se respeita a posição). Lista de banco antigo (alfabética) continua alfabética.
const POSICAO = new WeakMap()
const ordemPadrao = (a, b) => (a.na_mimo ? 0 : 1) - (b.na_mimo ? 0 : 1) || (b.selecao ? 1 : 0) - (a.selecao ? 1 : 0)
  || (POSICAO.get(a) ?? 0) - (POSICAO.get(b) ?? 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR')
// o que entra: os salões no ar de uma cidade (guia_colecoes() ou guia_publicadas())
function daCidade(lugares, cidadeSlug) {
  const lista = (Array.isArray(lugares) ? lugares : []).filter((l) => l?.slug && l?.nome && l?.cidade_slug !== undefined)
  lista.forEach((l, i) => { if (typeof l === 'object' && !POSICAO.has(l)) POSICAO.set(l, i) })
  const cs = cidadeSlug || lista[0]?.cidade_slug
  return lista.filter((l) => l.cidade_slug === cs && l.categoria !== 'barbearia')
}

function colecao(base, tipo, valor, categoria, nome, lugares) {
  return { tipo, valor, categoria, nome, cidade: base.cidade, cidade_slug: base.cidade_slug, uf: base.uf, caminho: rotaDaColecao(base.cidade_slug, tipo, valor, categoria), total: lugares.length, lugares }
}

// [{ tipo, valor, categoria, nome, caminho, total, lugares }]: os bairros (do maior para o
// menor), os horários da cidade e os horários de cada categoria. Só o que passa do mínimo.
const cacheDasColecoes = new WeakMap()
export function colecoesDaCidade(lugares, cidadeSlug = '') {
  if (!Array.isArray(lugares)) return []
  const guardado = cacheDasColecoes.get(lugares)?.get(cidadeSlug)
  if (guardado) return guardado
  const r = calcularColecoes(lugares, cidadeSlug)
  if (!cacheDasColecoes.has(lugares)) cacheDasColecoes.set(lugares, new Map())
  cacheDasColecoes.get(lugares).set(cidadeSlug, r)
  return r
}
function calcularColecoes(lugares, cidadeSlug) {
  const todos = daCidade(lugares, cidadeSlug)
  if (!todos.length) return []
  const base = { cidade: todos[0].cidade, cidade_slug: todos[0].cidade_slug, uf: todos[0].uf }
  const out = []
  // os bairros
  const grupos = new Map()
  for (const l of todos) {
    const k = chaveDoBairro(l.bairro, base.cidade_slug)
    if (k) grupos.set(k, [...(grupos.get(k) ?? []), l])
  }
  const nomes = nomesDosBairros(todos, base.cidade_slug)
  const bairros = [...grupos].filter(([, ls]) => ls.length >= MINIMO_COLECAO && ls.length <= TETO_COLECAO * todos.length)
    .map(([k, ls]) => colecao(base, 'bairro', k, '', nomes.get(k), [...ls].sort(ordemPadrao)))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'))
  out.push(...bairros)
  // os horários: na cidade e, para os que fazem sentido, em cada categoria
  const comHorario = todos.filter((l) => perfilDoHorario(l))
  const doHorario = new Map()
  for (const valor of HORARIOS_DO_GUIA) {
    const ls = comHorario.filter((l) => HORARIOS[valor].teste(perfilDoHorario(l)))
    if (ls.length < MINIMO_COLECAO || ls.length > TETO_COLECAO * comHorario.length) continue
    doHorario.set(valor, ls)
    out.push(colecao(base, 'horario', valor, '', HORARIOS[valor].rotulo, ordenarPorHorario(ls, valor)))
  }
  const categorias = [...new Set(todos.map((l) => l.categoria))].filter((c) => NOMES[c] && c !== 'beleza')
    .sort((a, b) => todos.filter((l) => l.categoria === b).length - todos.filter((l) => l.categoria === a).length)
  for (const valor of HORARIOS_POR_CATEGORIA) {
    const pai = doHorario.get(valor)
    if (!pai) continue
    for (const cat of categorias) {
      const daCat = comHorario.filter((l) => l.categoria === cat)
      const ls = pai.filter((l) => l.categoria === cat)
      if (ls.length < MINIMO_COLECAO_CATEGORIA || ls.length > TETO_COLECAO * daCat.length || ls.length === pai.length) continue
      out.push(colecao(base, 'horario', valor, cat, `${cap(nomeDa(cat)[1])} ${HORARIOS[valor].frase(nomeDa(cat)[2])}`, ordenarPorHorario(ls, valor)))
    }
  }
  return out
}
// cedo: quem abre antes primeiro; noite: quem fecha mais tarde primeiro; o resto, a ordem do guia
function ordenarPorHorario(ls, valor) {
  const p = perfilDoHorario
  if (valor === 'cedo') return [...ls].sort((a, b) => p(a).abreMaisCedo - p(b).abreMaisCedo || ordemPadrao(a, b))
  if (valor === 'noite') return [...ls].sort((a, b) => p(b).fechaMaisTarde - p(a).fechaMaisTarde || ordemPadrao(a, b))
  return [...ls].sort(ordemPadrao)
}

// a coleção de uma URL, ou null (não existe ou não passa do mínimo)
export function acharColecao(lugares, tipo, valor, categoria = '', cidadeSlug = '') {
  const v = String(valor ?? '').toLowerCase(), cat = String(categoria ?? '').toLowerCase()
  return colecoesDaCidade(lugares, cidadeSlug).find((c) => c.tipo === tipo && c.valor === v && c.categoria === cat) ?? null
}

// o link "Mais salões no <bairro>" da página de um salão: pela contagem que o
// banco manda (guia_pagina: bairro_total) ou pela lista inteira da cidade (HTML estático)
export function linkDoBairro(lugar, lugaresDaCidade = null) {
  const k = chaveDoBairro(lugar?.bairro, lugar?.cidade_slug)
  if (!k) return null
  let total = null
  let nome = nomeDoBairro(lugar.bairro)
  if (Array.isArray(lugaresDaCidade)) {
    const col = colecoesDaCidade(lugaresDaCidade, lugar.cidade_slug).find((c) => c.tipo === 'bairro' && c.valor === k)
    if (!col) return null
    total = col.total
    nome = col.nome
  } else {
    if (lugar.bairro_slug && lugar.bairro_slug !== k) return null
    total = Number(lugar.bairro_total) || 0
    // o mínimo e o teto, como em colecoesDaCidade (bairro que é quase a cidade inteira não tem página)
    const daCidade = Number(lugar.cidade_total) || 0
    if (total < MINIMO_COLECAO || (daCidade && total > TETO_COLECAO * daCidade)) return null
  }
  return { caminho: rotaDaColecao(lugar.cidade_slug, 'bairro', k), nome, total, rotulo: `Mais salões ${noBairro(nome)}` }
}

// ---- os números de um grupo ------------------------------------------------------------------
function horasDo(lugares) {
  const com = lugares.filter((l) => perfilDoHorario(l))
  const so = (fn) => com.filter((l) => fn(perfilDoHorario(l)))
  return {
    com,
    aConfirmar: lugares.filter((l) => !perfilDoHorario(l) && fatosDoHorario(l.horarios)).length,
    domingo: so((p) => !!p.domingo),
    sabado: so((p) => !!p.sabado),
    sabadoTodo: so((p) => p.sabadoTodo),
    cedo: so((p) => p.diasCedo.length > 0),
    noite: so((p) => p.diasNoite.length > 0),
  }
}
function contar(lista, chave) {
  const m = new Map()
  for (const x of lista) { const k = chave(x); if (k) m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'pt-BR'))
}
const mixDeCategorias = (lugares, max = 4) => {
  const c = contar(lugares, (l) => l.categoria)
  if (c.length === max + 1) max++
  const mostrar = c.slice(0, max).map(([cat, n]) => contarCategoria(cat, n))
  const resto = c.slice(max).reduce((s, [, n]) => s + n, 0)
  return juntarE(resto ? [...mostrar, `${resto} de outras categorias`] : mostrar)
}
function servicosMaisComuns(lugares, max = 3) {
  return contar(lugares.flatMap((l) => [...new Set(l.servicos ?? [])]), (s) => s).filter(([, n]) => n >= 2).slice(0, max)
}
function atributosDo(lugares) {
  const tem = (l, campo, chaves) => (Array.isArray(l.atributos?.[campo]) ? l.atributos[campo] : []).some((k) => chaves.includes(k))
  return {
    cartao: lugares.filter((l) => tem(l, 'pagamento', ['credito', 'debito', 'aproximacao'])).length,
    acessivel: lugares.filter((l) => tem(l, 'acessibilidade', ['entrada'])).length,
    estacionamento: lugares.filter((l) => tem(l, 'estacionamento', ['local_gratis', 'local_pago', 'garagem_gratis', 'garagem_pago', 'manobrista'])).length,
  }
}
// "Studio A, Studio B e Studio C" (até três nomes; mais que isso, só o número)
const nomesDe = (ls, max = 3) => (ls.length <= max ? juntarE(ls.map((l) => l.nome)) : null)
// a moda de uma lista de textos ("9h às 18h")
const maisComum = (xs) => contar(xs, (x) => x)[0] ?? null
// "Centro (8), seguido de Belas Artes (3) e Gaivota (2)." | empate: "Oásis e Jardim Umuarama, com 5 cada; depois vem Belas Artes (2)."
function quemLidera(contagem, nomes) {
  const nome = (k) => nomes.get(k) ?? nomeDoSlug(k)
  const topo = contagem.filter(([, n]) => n === contagem[0][1])
  const resto = []
  for (let i = topo.length; i < topo.length + 2 && i < contagem.length; i++) {
    if (contagem[i][1] < 2 || contagem[i + 1]?.[1] === contagem[i][1]) break
    resto.push(contagem[i])
  }
  if (topo.length === 1) return `${nome(topo[0][0])} (${topo[0][1]})${resto.length ? `, seguido de ${juntarE(resto.map(([k, n]) => `${nome(k)} (${n})`))}` : ''}.`
  return `${juntarE([...topo.slice(0, 4).map(([k]) => nome(k)), ...(topo.length > 4 ? ['outros'] : [])])}, com ${topo[0][1]} cada${resto.length && topo.length <= 4 ? `; depois vem ${nome(resto[0][0])} (${resto[0][1]})` : ''}.`
}

// ---- o texto de uma coleção ------------------------------------------------------------------
// col: o que colecoesDaCidade() devolve; lugares: todos os salões no ar da cidade (para comparar).
// Devolve o texto da página e os cartões prontos (com a linha de horário nas páginas de horário).
export function montarColecao(col, lugares) {
  const todos = daCidade(lugares, col.cidade_slug)
  const todas = colecoesDaCidade(lugares, col.cidade_slug)
  const s = sorteio(col.caminho)
  const texto = col.tipo === 'bairro' ? textoDoBairro(col, todos, todas, s) : textoDoHorario(col, todos, todas, s)
  const h = HORARIOS[col.valor]
  const cartoes = col.lugares.map((l) => {
    const p = perfilDoHorario(l)
    return {
      slug: l.slug, nome: l.nome, categoria: l.categoria, servicos: (l.servicos ?? []).slice(0, 4), selecao: !!l.selecao, na_mimo: !!l.na_mimo,
      bairro: bairroLimpo(l.bairro) || null,
      latitude: l.latitude ?? null, longitude: l.longitude ?? null, // a distância é calculada no aparelho (3.13)
      // na página de horário, a linha do cartão é o horário que interessa; no bairro, o resumo do salão
      resumo: col.tipo === 'horario' && h && p ? h.linha(p) : (l.resumo ?? l.conteudo?.resumo ?? null),
    }
  })
  const atualizado = todos.map((l) => (l.atualizado_em ? String(l.atualizado_em).slice(0, 10) : '')).filter(Boolean).sort().at(-1)
  return { ...col, ...texto, cartoes, relacionadas: relacionadas(col, todas), atualizado }
}

// os links de "mais no guia": outros bairros, os horários, as categorias do mesmo horário
function relacionadas(col, todas) {
  const link = (c) => ({ caminho: c.caminho, rotulo: c.tipo === 'bairro' ? c.nome : c.categoria ? cap(nomeDa(c.categoria)[1]) : c.nome, total: c.total, tipo: c.tipo, categoria: c.categoria })
  return {
    bairros: todas.filter((c) => c.tipo === 'bairro' && c.caminho !== col.caminho).slice(0, 12).map(link),
    horarios: todas.filter((c) => c.tipo === 'horario' && !c.categoria && c.caminho !== col.caminho).map(link),
    categorias: todas.filter((c) => c.tipo === 'horario' && c.categoria && c.valor === col.valor && c.caminho !== col.caminho).map(link),
  }
}

function textoDoBairro(col, todos, todas, s) {
  const { nome, lugares, cidade } = col
  // a cidade em números (o mesmo contexto que a página de cada salão usa)
  const ctx = contextoDaCidade(todos, col.cidade_slug)
  const n = lugares.length, N = ctx.total
  const onde = noBairro(nome)
  // a posição do bairro na cidade (sem chutar em empate)
  const porBairro = contar(todos, (l) => chaveDoBairro(l.bairro, col.cidade_slug))
  const maiores = porBairro.filter(([, k]) => k > n)
  const empate = porBairro.some(([k, x]) => x === n && k !== col.valor)
  const nomes = nomesDosBairros(todos, col.cidade_slug)
  const pos = maiores.length + 1
  const ranking = empate ? '' : pos === 1 ? ', o bairro com mais endereços de beleza da cidade'
    : pos <= 3 ? `, o ${ORDINAL[pos]} bairro com mais endereços, atrás ${juntarE(maiores.map(([k]) => `${/^centro$/i.test(nomes.get(k)) ? 'do' : 'de'} ${nomes.get(k)}`))}` : ''
  const parte = pct(n, N)

  // 1º parágrafo: quantos, de que tipo, onde
  const cats = contar(lugares, (l) => l.categoria)
  const [catTop, nTop] = cats[0]
  const p1 = [s.um([
    `Dos ${N} salões e estúdios de beleza de ${cidade} no guia da MIMO, ${n} ficam ${onde}${ranking || (parte >= 5 ? ` (${parte}% da cidade)` : '')}.`,
    `${cap(onde)} estão ${n} dos ${N} endereços de beleza de ${cidade} reunidos no guia${ranking || (parte >= 5 ? `, ${parte}% do total` : '')}.`,
  ])]
  const semTop = lugares.filter((l) => l.categoria !== catTop)
  if (cats.length === 1) p1.push(`Todos são ${nomeDa(catTop)[1]}.`)
  else if (nTop / n > 0.5) p1.push(s.um([`Mais da metade são ${nomeDa(catTop)[1]} (${nTop}); os outros: ${mixDeCategorias(semTop, 3)}.`, `${cap(nomeDa(catTop)[1])} são a maioria, ${nTop} de ${n}; ${semTop.length === 1 ? 'completa' : 'completam'} a lista ${mixDeCategorias(semTop, 3)}.`]))
  else p1.push(s.um([`São ${mixDeCategorias(lugares)}.`, `Na conta por categoria: ${mixDeCategorias(lugares)}.`]))
  // a categoria que pesa mais aqui do que na cidade (só com número que não é acaso)
  const forte = cats.map(([c, k]) => ({ c, k, aqui: pct(k, n), cidade: pct(ctx.categorias[c] ?? 0, N) }))
    .find((x) => x.k >= 3 && x.aqui >= x.cidade * 1.6 && x.aqui - x.cidade >= 12)
  if (forte) p1.push(s.um([
    `${cap(nomeDa(forte.c)[1])} pesam mais aqui do que na cidade: ${forte.aqui}% dos endereços do bairro, contra ${forte.cidade}% em ${cidade}.`,
    `Em ${cidade} inteira, ${nomeDa(forte.c)[1]} são ${forte.cidade}% dos endereços; ${onde}, ${forte.aqui}%.`,
  ]))
  const ruas = contar(lugares, (l) => ruaDe(l.endereco)?.chave)
  if (ruas[0] && ruas[0][1] >= 3 && ruas[0][1] >= n * 0.25) {
    const nomeRua = maisComum(lugares.map((l) => ruaDe(l.endereco)).filter((r) => r?.chave === ruas[0][0]).map((r) => r.nome))[0]
    p1.push(s.um([`Só ${naRua(nomeRua)} ficam ${ruas[0][1]} deles.`, `${cap(naRua(nomeRua))} se concentram ${ruas[0][1]}.`]))
  }

  // 2º: o horário, comparado com a cidade
  const h = horasDo(lugares), hc = horasDo(todos)
  const p2 = []
  const aConf = h.aConfirmar ? ` (sem contar ${h.aConfirmar === 1 ? 'um que diz' : `${h.aConfirmar} que dizem`} atender 24 horas ou depois da meia-noite, o que vale confirmar)` : ''
  if (!h.com.length) p2.push(s.um([`Nenhum deles divulga o horário de atendimento: vale chamar antes de ir.`, `O horário de atendimento não aparece nos dados públicos desses lugares; chame antes de ir.`]))
  else if (h.com.length === 1) {
    // um só com horário: a frase é sobre ele (nada de "Dos 1 que divulgam…, 0 abrem")
    const fds = h.sabado.length ? `abre no sábado${h.domingo.length ? ' e no domingo' : ', mas não no domingo'}` : h.domingo.length ? 'abre no domingo, mas não no sábado' : 'não abre no sábado nem no domingo'
    const fatos = [fds, h.cedo.length && 'começa às 8h ou antes', h.noite.length && 'vai até as 20h ou mais'].filter(Boolean)
    p2.push(`${n === 1 ? 'Pelo horário que divulga' : `Só um deles divulga o horário${aConf}`}: ${h.com[0].nome} ${juntarE(fatos)}.`)
  } else {
    const base = h.com.length === n ? 'Pelo horário que divulgam,' : `Dos ${h.com.length} que divulgam o horário${aConf},`
    const partes = []
    if (!h.sabado.length && !h.domingo.length) partes.push('nenhum abre no sábado nem no domingo')
    else {
      partes.push(!h.sabado.length ? 'nenhum abre no sábado' : h.sabado.length === h.com.length ? 'todos abrem no sábado' : `${numero(h.sabado.length)} ${h.sabado.length === 1 ? 'abre' : 'abrem'} no sábado`)
      if (h.domingo.length) partes.push(`${numero(h.domingo.length)} ${h.domingo.length === 1 ? 'abre' : 'abrem'} ${h.sabado.length ? 'também ' : ''}no domingo${h.domingo.length <= 2 ? ` (${nomesDe(h.domingo)})` : ''}`)
      else partes.push('nenhum abre no domingo')
    }
    if (h.cedo.length) partes.push(`${numero(h.cedo.length)} ${h.cedo.length === 1 ? 'começa' : 'começam'} às 8h ou antes`)
    if (h.noite.length) partes.push(`${numero(h.noite.length)} ${h.noite.length === 1 ? 'vai' : 'vão'} até as 20h ou mais`)
    p2.push(`${base} ${juntarE(partes)}.`)
    // comparação: só quando a diferença é grande e o número não é um acaso
    const comparar = [
      ['domingo', 'abrem no domingo'], ['noite', 'ficam abertos até as 20h'], ['cedo', 'abrem às 8h ou antes'],
    ].map(([k, frase]) => ({ frase, aqui: pct(h[k].length, h.com.length), cidade: pct(hc[k].length, hc.com.length), n: h[k].length }))
      .find((c) => c.n >= 2 && h.com.length >= 4 && c.aqui >= c.cidade * 1.5 && c.aqui - c.cidade >= 10)
    if (comparar) p2.push(s.um([
      `É uma proporção maior que a da cidade: ${onde}, ${comparar.aqui}% ${comparar.frase}; em ${cidade} inteira, ${comparar.cidade}%.`,
      `Na cidade toda, só ${comparar.cidade}% dos salões com horário divulgado ${comparar.frase}; ${onde}, são ${comparar.aqui}%.`,
    ]))
    else if (!h.domingo.length && hc.domingo.length >= MINIMO_COLECAO) p2.push(s.um([`Para o domingo, a saída é outro bairro: em ${cidade}, ${hc.domingo.length} salões abrem nesse dia.`, `Quem precisa de domingo encontra ${hc.domingo.length} opções em outros bairros de ${cidade}.`]))
  }

  // 3º: serviços, pagamento e acessibilidade, MIMO
  const p3 = []
  const sv = servicosMaisComuns(lugares)
  if (sv.length >= 2) p3.push(s.um([
    `Entre os serviços que os próprios lugares divulgam, os que mais aparecem ${onde} são ${juntarE(sv.map(([x, k]) => `${x.toLowerCase()} (${k})`))}.`,
    `Pelo que cada lugar divulga, os serviços mais comuns aqui são ${juntarE(sv.map(([x, k]) => `${x.toLowerCase()} (${k})`))}.`,
  ]))
  const at = atributosDo(lugares)
  const ats = [
    at.cartao ? `${numero(at.cartao)} ${at.cartao === 1 ? 'informa' : 'informam'} aceitar cartão` : '',
    at.acessivel ? `${numero(at.acessivel)} ${at.acessivel === 1 ? 'tem' : 'têm'} entrada acessível para cadeira de rodas` : '',
    at.estacionamento ? `${numero(at.estacionamento)} ${at.estacionamento === 1 ? 'tem' : 'têm'} estacionamento próprio` : '',
  ].filter(Boolean)
  if (ats.length) p3.push(`${s.um(['Pelas informações públicas,', 'Segundo o que divulgam,'])} ${juntarE(ats)}.`)
  const naMimo = lugares.filter((l) => l.na_mimo)
  if (naMimo.length) p3.push(`${naMimo.length === 1 ? `${naMimo[0].nome} já agenda` : `${naMimo.length} já agendam`} pela MIMO: dá para escolher o serviço e o horário online.`)
  p3.push(s.um(['Horários e serviços mudam: confirme com o lugar antes de ir.', 'Antes de sair, vale confirmar horário e serviço direto com o lugar.']))

  // perguntas
  const faq = [{ pergunta: `Quantos salões de beleza há ${onde}, em ${cidade}?`, resposta: `No guia da MIMO, ${n}: ${mixDeCategorias(lugares, 7)}. ${s.um(['A lista desta página mostra todos, com endereço, horário e serviços.', 'Cada um tem a própria página, com endereço, horário, serviços e como falar com o lugar.'])}` }]
  const outras = []
  if (h.com.length) {
    outras.push(h.domingo.length
      ? { pergunta: `Tem salão aberto no domingo ${onde}?`, resposta: h.domingo.length === 1 ? `Sim. Pelo horário divulgado, ${h.domingo[0].nome} abre aos domingos: ${faixaTexto(perfilDoHorario(h.domingo[0]).domingo)}.` : `Sim. Pelo horário divulgado, ${h.domingo.length} abrem aos domingos${nomesDe(h.domingo) ? `: ${nomesDe(h.domingo)}` : ''}. Confira o horário de domingo na página de cada um.` }
      : { pergunta: `Tem salão aberto no domingo ${onde}?`, resposta: `Pelo horário divulgado, nenhum dos ${h.com.length} com horário abre aos domingos.${hc.domingo.length ? ` Em ${cidade}, ${plural(hc.domingo.length, 'salão abre', 'salões abrem')} nesse dia.` : ''}` })
    const cedo = Math.min(...h.com.map((l) => perfilDoHorario(l).abreMaisCedo))
    const quemCedo = h.com.filter((l) => perfilDoHorario(l).abreMaisCedo === cedo)
    outras.push({ pergunta: `Qual salão ${onde} abre mais cedo?`, resposta: `Pelo horário divulgado, ${nomesDe(quemCedo) ? `${nomesDe(quemCedo)}, às ${hm(cedo)}` : `${quemCedo.length} lugares abrem às ${hm(cedo)}`}. O horário de cada dia está na página de cada salão.` })
    const tarde = Math.max(...h.com.map((l) => perfilDoHorario(l).fechaMaisTarde))
    const quemTarde = h.com.filter((l) => perfilDoHorario(l).fechaMaisTarde === tarde)
    outras.push({ pergunta: `Qual salão ${onde} fica aberto até mais tarde?`, resposta: `Pelo horário divulgado, ${nomesDe(quemTarde) ? `${nomesDe(quemTarde)}, ${ateAs(tarde)}` : `${quemTarde.length} lugares, ${ateAs(tarde)}`}. Em alguns, o horário mais longo vale só para alguns dias da semana.` })
  }
  if (at.cartao) outras.push({ pergunta: `Os salões ${onde} aceitam cartão?`, resposta: `${at.cartao === n ? 'Todos informam' : `${cap(numero(at.cartao))} dos ${n} ${at.cartao === 1 ? 'informa' : 'informam'}`} aceitar cartão, pelas informações públicas.${at.cartao < n ? ' Os outros não divulgam a forma de pagamento: vale perguntar ao marcar.' : ''}` })
  outras.push(naMimo.length
    ? { pergunta: `Dá para marcar horário online ${onde}?`, resposta: `Sim: ${nomesDe(naMimo) ?? `${naMimo.length} lugares`} ${naMimo.length === 1 ? 'agenda' : 'agendam'} pela MIMO, com o serviço, o dia e o horário escolhidos pelo site ou pelo app.` }
    : { pergunta: `Dá para marcar horário online ${onde}?`, resposta: s.um([`Ainda não: nenhum dos salões ${onde} agenda pela MIMO por enquanto. Na página de cada um, toque em "Quero marcar aqui pelo app" e a gente avisa o salão.`, `Pela MIMO, ainda não: por enquanto, o contato é pelos canais de cada lugar. Se quiser marcar pelo app, toque em "Quero marcar aqui pelo app" na página do salão e a gente avisa ele.`]) })
  faq.push(...s.embaralhar(outras).slice(0, 4))

  // títulos
  const h1 = /^centro$/i.test(nome) ? `Salões de beleza no Centro de ${cidade}` : `Salões de beleza ${onde}, em ${cidade}`
  const seo_title = primeiraQueCabe([
    /^centro$/i.test(nome) ? `Salões de beleza no Centro de ${cidade}` : `Salões de beleza ${onde}, ${cidade}`,
    `Salões ${onde}, ${cidade}`, `Salões em ${nome}, ${cidade}`,
  ], 60)
  const fato = h.domingo.length ? `${cap(numero(h.domingo.length))} ${h.domingo.length === 1 ? 'abre' : 'abrem'} aos domingos.` : h.noite.length ? `${cap(numero(h.noite.length))} ${h.noite.length === 1 ? 'atende' : 'atendem'} até as 20h ou mais.` : ''
  const meta_description = primeiraQueCabe([
    `${n} salões de beleza ${onde}, em ${cidade}: endereço, horário e serviços de cada um. ${fato}`.trim(),
    `${n} salões de beleza ${onde}, em ${cidade}: endereço, horário e serviços de cada um.`,
    `Salões de beleza ${onde}, em ${cidade}: endereço, horário e serviços.`,
  ], 155)
  const chamada = s.um([
    `Os ${n} endereços de beleza ${onde} que estão no guia, com o horário e os serviços de cada um.`,
    `${cap(juntarE(cats.slice(0, 3).map(([c]) => nomeDa(c)[1])))} ${onde}: onde fica, quando abre e o que faz cada um.`,
  ])
  return {
    h1, destaque: /^centro$/i.test(nome) ? 'Centro' : nome, migalha: nome, seo_title, meta_description, chamada,
    intro: [p1, p2, p3].map((p) => p.join(' ')).filter(Boolean), faq,
    numeros: [
      { valor: n, rotulo: n === 1 ? 'lugar no bairro' : 'lugares no bairro' },
      ...(cats.length > 1 ? [{ valor: cats.length, rotulo: 'categorias' }] : []),
      ...(parte >= 3 ? [{ valor: `${parte}%`, rotulo: 'dos salões da cidade' }] : []),
    ],
  }
}

function textoDoHorario(col, todos, todas, s) {
  const { valor, categoria, lugares, cidade } = col
  const def = HORARIOS[valor]
  const n = lugares.length
  const daCat = categoria ? todos.filter((l) => l.categoria === categoria) : todos
  const escopo = horasDo(daCat), naCidade = horasDo(todos)
  const comH = escopo.com.length
  const parte = pct(n, comH)
  // como se fala de quem está na lista: "salões" ou "manicures", com o gênero certo
  const [um, varios, g] = categoria ? nomeDa(categoria) : ['salão', 'salões', 'o']
  const os = g === 'a' ? 'as' : 'os', dos = g === 'a' ? 'das' : 'dos', deles = g === 'a' ? 'delas' : 'deles', estes = g === 'a' ? 'Estas' : 'Estes'
  const verbo = (k, sing, plur) => (k === 1 ? sing : plur)
  const ps = lugares.map((l) => [l, perfilDoHorario(l)])
  const doBairro = contar(lugares, (l) => chaveDoBairro(l.bairro, col.cidade_slug))
  const nomesB = nomesDosBairros(todos, col.cidade_slug)

  // 1º parágrafo: quão comum é na cidade, com a conta
  const p1 = []
  if (valor === 'domingo') {
    p1.push(parte < 25
      ? s.um([
        `Domingo é dia de folga para quase tod${g} ${um} de ${cidade}: ${dos} ${comH} ${varios} com horário divulgado no guia, só ${n} abrem nesse dia (${parte}%).`,
        `Pouca gente atende no domingo em ${cidade}: só ${n} ${dos} ${comH} ${varios} com horário divulgado no guia (${parte}%).`,
      ])
      : `${cap(numero(n, g))} ${dos} ${comH} ${varios} de ${cidade} com horário divulgado no guia ${verbo(n, 'abre', 'abrem')} aos domingos (${parte}%).`)
  } else if (valor === 'cedo') {
    const moda = maisComum(escopo.com.map((l) => hm(perfilDoHorario(l).abreTipico)))
    p1.push(s.um([
      `${moda ? `O mais comum em ${cidade} é abrir às ${moda[0]}. ` : ''}${estes} ${n} ${varios} começam às 8h ou antes em pelo menos um dia da semana: ${parte}% ${dos} ${comH} com horário divulgado no guia.`,
      `Abrir às 8h ou antes não é o comum: ${dos} ${comH} ${varios} de ${cidade} com horário divulgado no guia, ${n} fazem isso em pelo menos um dia (${parte}%).`,
    ]))
  } else if (valor === 'noite') {
    const moda = maisComum(escopo.com.map((l) => hm(perfilDoHorario(l).fechaTipico)))
    p1.push(s.um([
      `${moda ? `Em ${cidade}, o mais comum é fechar às ${moda[0]}. ` : ''}${estes} ${n} ${varios} atendem até as 20h ou mais em pelo menos um dia da semana: ${parte}% ${dos} ${comH} com horário divulgado no guia.`,
      `Fechar às 20h ou mais tarde é coisa de ${parte}% ${dos} ${comH} ${varios} de ${cidade} com horário divulgado no guia: são ${os} ${n} desta página.`,
    ]))
  } else {
    p1.push(s.um([
      `No sábado, ${escopo.sabado.length} dos ${comH} salões de ${cidade} com horário divulgado abrem, mas nem todos ficam o dia todo. Estes ${n} abrem até as 9h e vão até as 18h ou mais, sem fechar para o almoço (${parte}%).`,
      `Quase todo salão de ${cidade} abre no sábado (${escopo.sabado.length} dos ${comH} com horário divulgado), mas muitos fecham mais cedo ou param para o almoço. Estes ${n} atendem das 9h ou antes até as 18h ou mais, direto.`,
    ]))
  }
  if (categoria) {
    const k = naCidade[CHAVE_DO_RESUMO[valor]].length
    p1.push(s.um([
      `Contando todas as categorias, são ${k} dos ${naCidade.com.length} salões da cidade com horário divulgado (${pct(k, naCidade.com.length)}%).`,
      `Na cidade inteira, de todas as categorias, ${k} dos ${naCidade.com.length} com horário divulgado ${def.curto}.`,
    ]))
  }

  // 2º: o detalhe do horário
  const p2 = []
  if (valor === 'domingo') {
    const moda = maisComum(ps.map(([, p]) => faixaTexto(p.domingo)))
    const fechamCedo = ps.filter(([, p]) => fimDa(p.domingo.at(-1)) <= 14 * 60).length
    const vaoLonge = ps.filter(([, p]) => fimDa(p.domingo.at(-1)) >= 18 * 60).length
    const inicio = moda && moda[1] >= 2 ? `O horário de domingo mais comum entre ${g === 'a' ? 'elas' : 'eles'} é das ${moda[0]} (${moda[1]})` : 'O horário de domingo muda bastante de um lugar para outro'
    const partes = []
    if (fechamCedo) partes.push(`${numero(fechamCedo, g)} ${verbo(fechamCedo, 'fecha', 'fecham')} até as 14h`)
    if (vaoLonge) partes.push(`${numero(vaoLonge, g)} ${verbo(vaoLonge, 'fica', 'ficam')} até as 18h ou mais`)
    p2.push(`${inicio}${partes.length ? `${moda && moda[1] >= 2 ? ';' : ':'} ${juntarE(partes)}` : ''}.`, fechamCedo > vaoLonge ? 'Domingo costuma ter meio período: confira antes de ir.' : s.um(['Vale olhar o horário de cada um antes de sair de casa.', 'O horário de domingo nem sempre é o mesmo da semana: confira o de cada um.']))
  } else if (valor === 'cedo') {
    const cedo = Math.min(...ps.map(([, p]) => p.abreMaisCedo))
    const primeiros = ps.filter(([, p]) => p.abreMaisCedo === cedo).map(([l]) => l)
    const antes8 = ps.filter(([, p]) => p.abreMaisCedo < 480).length
    const todoDia = ps.filter(([, p]) => p.diasCedo.length === p.abertos.length).length
    const contaAntes = antes8 && antes8 < n && antes8 > primeiros.length
    p2.push(`${contaAntes ? `${cap(numero(antes8, g))} ${verbo(antes8, 'abre', 'abrem')} antes das 8h; ` : ''}${contaAntes ? 'o' : 'O'} mais cedo ${primeiros.length === 1 ? `é ${primeiros[0].nome}, que abre` : `são ${nomesDe(primeiros) ?? `${primeiros.length} lugares`}, que abrem`} às ${hm(cedo)}.`)
    p2.push(todoDia === n ? `Tod${g}s abrem cedo em todos os dias de atendimento.`
      : todoDia === 0 ? `Nenhum abre cedo todos os dias: o horário mais cedo vale só para alguns dias, e o cartão de cada um mostra quais.`
        : `${cap(numero(todoDia, g))} ${verbo(todoDia, 'abre', 'abrem')} cedo em todos os dias de atendimento; ${os} outr${g}s, só em alguns. O cartão de cada um mostra quando.`)
  } else if (valor === 'noite') {
    const tarde = Math.max(...ps.map(([, p]) => p.fechaMaisTarde))
    const ultimos = ps.filter(([, p]) => p.fechaMaisTarde === tarde).map(([l]) => l)
    const ate21 = ps.filter(([, p]) => p.fechaMaisTarde >= 21 * 60).length
    const sab = ps.filter(([, p]) => p.sabado).length
    const contaTarde = ate21 && ate21 < n && ate21 > ultimos.length
    p2.push(`${contaTarde ? `${cap(numero(ate21, g))} ${verbo(ate21, 'vai', 'vão')} até as 21h ou mais; q` : 'Q'}uem fica até mais tarde ${ultimos.length === 1 ? `é ${ultimos[0].nome}` : `são ${nomesDe(ultimos) ?? `${ultimos.length} lugares`}`}, ${ateAs(tarde)}.`)
    p2.push(s.um([
      sab === n ? `Tod${g}s também abrem no sábado.` : sab ? `${cap(numero(sab, g))} ${deles} também ${verbo(sab, 'abre', 'abrem')} no sábado.` : `Nenhum ${deles} abre no sábado.`,
      'Bom para quem só consegue depois do trabalho: o cartão de cada um mostra em que dias o horário vai até mais tarde.',
    ]))
  } else {
    const faixas = contar(ps.map(([, p]) => faixaTexto(p.sabado)), (x) => x)
    const ate20 = ps.filter(([, p]) => fimDa(p.sabado[0]) >= 20 * 60).length
    p2.push(`${faixas[1] && faixas[1][1] >= 2 ? `Os horários de sábado mais comuns são das ${faixas[0][0]} (${faixas[0][1]}) e das ${faixas[1][0]} (${faixas[1][1]})` : `O horário de sábado mais comum é das ${faixas[0][0]} (${faixas[0][1]})`}${ate20 ? `; ${numero(ate20)} ${verbo(ate20, 'vai', 'vão')} até as 20h ou mais` : ''}.`)
  }

  // 3º: onde ficam e o que fazem
  const p3 = []
  if (doBairro.length) {
    const [kTop, nTop] = doBairro[0]
    const nomeTop = nomesB.get(kTop)
    const outrosB = doBairro.length - 1
    const empate = doBairro[1] && doBairro[1][1] === nTop
    p3.push(nTop >= 2 && outrosB && !empate
      ? s.um([
        `${/^centro$/i.test(nomeTop) ? 'O Centro concentra' : `O bairro ${nomeTop} concentra`} ${nTop} ${deles}; ${n - nTop === 1 ? `${g === 'a' ? 'a' : 'o'} outr${g} fica` : `${os} outr${g}s ficam`} ${outrosB === 1 ? noBairro(nomesB.get(doBairro[1][0])) : `em ${outrosB} bairros`}.`,
        `Ficam em ${plural(doBairro.length, 'bairro', 'bairros')}, com mais ${noBairro(nomeTop)} (${nTop}).`,
      ])
      : `Ficam espalhad${g}s por ${plural(doBairro.length, 'bairro', 'bairros')} da cidade.`)
  }
  if (!categoria) {
    if (contar(lugares, (l) => l.categoria).length > 1) p3.push(s.um([`Na conta por categoria: ${mixDeCategorias(lugares)}.`, `São ${mixDeCategorias(lugares)}.`]))
  } else {
    const sv = servicosMaisComuns(lugares).filter(([x]) => x !== SERVICO_DA_CATEGORIA[categoria])
    if (sv.length) p3.push(`Além do serviço principal, ${sv.length === 1 ? 'o que mais aparece' : 'os que mais aparecem'} entre ${g === 'a' ? 'elas' : 'eles'} ${sv.length === 1 ? 'é' : 'são'} ${juntarE(sv.map(([x, k]) => `${x.toLowerCase()} (${k})`))}.`)
  }
  p3.push(`Entram aqui ${os} que, pelo horário que divulgam, ${def.criterio}${escopo.aConfirmar ? '; quem diz atender 24 horas ou depois da meia-noite fica de fora, porque é dado que vale confirmar' : ''}. ${s.um(['Em feriado e na temporada de verão o horário costuma mudar: confirme antes de ir.', 'Horário muda em feriado e na temporada; vale confirmar com o lugar antes de sair.'])}`)

  // perguntas: a primeira é sempre a conta; as outras saem dos dados e se revezam
  const titulo = `${cap(varios)} ${def.frase(g)}`
  const faq = [{
    pergunta: `Quant${os} ${varios} ${{ domingo: 'abrem no domingo', cedo: 'abrem cedo', noite: `ficam abert${g}s à noite`, 'sabado-o-dia-todo': 'abrem no sábado o dia todo' }[valor]} em ${cidade}?`,
    resposta: `No guia da MIMO, ${n} ${dos} ${comH} com horário divulgado: ${os} que ${def.criterio}. A lista desta página mostra tod${g}s, com endereço e horário.`,
  }]
  const outras = []
  if (valor === 'domingo') {
    const ate = ps.map(([, p]) => fimDa(p.domingo.at(-1)))
    const cedoK = ate.filter((m) => m <= 14 * 60).length, tardeK = ate.filter((m) => m >= 18 * 60).length
    const partes = [cedoK ? `${numero(cedoK, g)} ${verbo(cedoK, 'fecha', 'fecham')} até as 14h` : '', tardeK ? `${numero(tardeK, g)} ${verbo(tardeK, 'fica', 'ficam')} até as 18h ou mais` : ''].filter(Boolean)
    outras.push({ pergunta: `Até que horas ${os} ${varios} abrem no domingo em ${cidade}?`, resposta: `${partes.length === 2 ? `Varia: ${juntarE(partes)}. ` : partes.length ? `${cap(partes[0])}. ` : ''}O horário de domingo que vai mais longe é ${ateAs(Math.max(...ate))}, pelo que os lugares divulgam.` })
    outras.push({ pergunta: 'Precisa marcar horário no domingo?', resposta: s.um(['É o mais seguro: como poucos lugares abrem, a agenda de domingo costuma encher. Chame antes pelos canais de cada um.', `Vale marcar: com tão pouc${g}s ${varios} abert${g}s, o domingo lota rápido. Fale antes com o lugar pelo canal que ele divulga.`]) })
  } else if (valor === 'cedo') {
    const cedo = Math.min(...ps.map(([, p]) => p.abreMaisCedo))
    const primeiros = ps.filter(([, p]) => p.abreMaisCedo === cedo).map(([l]) => l)
    outras.push({ pergunta: `Qual ${um} abre mais cedo em ${cidade}?`, resposta: `Pelo horário divulgado, ${nomesDe(primeiros) ?? `${primeiros.length} lugares`}, às ${hm(cedo)}. Em alguns, o horário mais cedo vale só para certos dias: confira na página de cada um.` })
    outras.push({ pergunta: 'Vale marcar o primeiro horário do dia?', resposta: s.um(['Para quem trabalha, sim: dá para sair do salão antes do expediente. Como é um horário disputado, marque com antecedência.', 'É o horário de quem precisa resolver antes do trabalho, por isso costuma ser o primeiro a acabar na agenda. Marque com alguns dias de folga.']) })
  } else if (valor === 'noite') {
    const tarde = Math.max(...ps.map(([, p]) => p.fechaMaisTarde))
    const ultimos = ps.filter(([, p]) => p.fechaMaisTarde === tarde).map(([l]) => l)
    outras.push({ pergunta: `Qual ${um} fica abert${g} até mais tarde em ${cidade}?`, resposta: `Pelo horário divulgado, ${nomesDe(ultimos) ?? `${ultimos.length} lugares`}, ${ateAs(tarde)}. O horário estendido pode valer só para alguns dias da semana.` })
    outras.push({ pergunta: 'Dá para chegar no último horário?', resposta: s.um(['O horário divulgado é o de fechar a porta: o último atendimento costuma começar antes, conforme o serviço. Pergunte ao marcar.', 'Depende do serviço: um serviço longo precisa começar bem antes de a porta fechar. Ao marcar, diga o que vai fazer e pergunte qual é o último horário.']) })
  } else {
    outras.push({ pergunta: 'Os salões abrem no sábado o dia todo também no verão?', resposta: 'Na temporada, muitos salões do litoral mudam o horário, para mais ou para menos. O horário daqui é o divulgado pelos lugares: confirme antes de ir.' })
  }
  if (doBairro.length > 1 && doBairro[0][1] >= 2) {
    outras.push({ pergunta: `Em que bairro há mais ${varios} ${def.frase(g)} em ${cidade}?`, resposta: `${quemLidera(doBairro, nomesB)}${doBairro.length > 3 ? ` Ao todo, são ${doBairro.length} bairros.` : ''}` })
  }
  if (!categoria && HORARIOS_POR_CATEGORIA.includes(valor)) {
    const k = lugares.filter((l) => l.categoria === 'unhas').length
    const temPagina = todas.some((c) => c.tipo === 'horario' && c.valor === valor && c.categoria === 'unhas')
    outras.push({
      pergunta: `Tem manicure ${def.um('a')} em ${cidade}?`,
      resposta: k
        ? `Sim: ${plural(k, 'manicure desta lista', 'manicures desta lista')} ${k === 1 ? def.criterioUm : def.criterio}.${temPagina ? ' Elas têm uma página só delas no guia.' : ''}`
        : 'Nesta lista não há manicure. Alguns salões de beleza também fazem unhas: veja os serviços de cada um.',
    })
  }
  outras.push({ pergunta: 'O horário vale para feriados?', resposta: s.um(['Nem sempre. O horário daqui é o que os estabelecimentos divulgam; em feriados e na temporada de verão ele costuma mudar. Confirme com o lugar antes de ir.', `Não dá para garantir: feriado e temporada mudam o horário de muit${g}s ${varios}. O que aparece aqui é o horário que cada lugar divulga, então confirme antes de sair.`]) })
  faq.push(...s.embaralhar(outras).slice(0, 4))

  const h1 = `${titulo} em ${cidade}`
  const seo_title = primeiraQueCabe([`${titulo} em ${cidade}`, `${titulo}, ${cidade}`, titulo], 60)
  const fato = valor === 'domingo' && parte < 25 ? `Só ${parte}% ${dos} ${varios} da cidade abrem nesse dia.` : `São ${parte}% ${dos} ${varios} com horário divulgado.`
  const meta_description = primeiraQueCabe([
    `${n} ${varios} ${def.frase(g)} em ${cidade}: horário, endereço e serviços de cada um. ${fato}`,
    `${n} ${varios} ${def.frase(g)} em ${cidade}: horário, endereço e serviços de cada um.`,
    `${titulo} em ${cidade}: horário e endereço.`,
  ], 155)
  const chamada = s.um([
    `${cap(numero(n, g))} ${varios} de ${cidade} que ${def.curto}, com o horário de cada um.`,
    `Onde ir ${def.quando} em ${cidade}: ${n} ${varios}, com endereço e horário.`,
  ])
  return {
    h1, destaque: def.frase(g).replace(/^que /, ''), migalha: categoria ? cap(varios) : def.rotulo, seo_title, meta_description, chamada,
    intro: [p1, p2, p3].map((p) => p.join(' ')).filter(Boolean), faq,
    numeros: [
      { valor: n, rotulo: n === 1 ? um : varios },
      { valor: `${parte}%`, rotulo: `${dos} com horário divulgado` },
      ...(doBairro.length > 1 ? [{ valor: doBairro.length, rotulo: 'bairros' }] : []),
    ],
  }
}
// o serviço que já é a própria categoria não conta como "além do principal"
const SERVICO_DA_CATEGORIA = { cabelo: 'Cabelo', unhas: 'Manicure', cilios: 'Cílios', sobrancelhas: 'Sobrancelha', estetica: 'Estética', maquiagem: 'Maquiagem' }

// ---- para a página da cidade: os links "Por bairro" e "Por horário" ----------------------------
// { bairros: [{ caminho, rotulo, total }], horarios: [...], categorias: { unhas: [...] } }
export function linksDeColecoes(lugares, cidadeSlug = '') {
  const todas = colecoesDaCidade(lugares, cidadeSlug)
  const link = (c) => ({ caminho: c.caminho, rotulo: c.tipo === 'bairro' ? c.nome : c.categoria ? HORARIOS[c.valor].rotulo : c.nome, total: c.total, valor: c.valor, categoria: c.categoria })
  const categorias = {}
  for (const c of todas.filter((x) => x.tipo === 'horario' && x.categoria)) (categorias[c.categoria] ??= []).push(link(c))
  return {
    bairros: todas.filter((c) => c.tipo === 'bairro').map(link),
    horarios: todas.filter((c) => c.tipo === 'horario' && !c.categoria).map(link),
    categorias,
  }
}

// a trilha (migalhas) de uma coleção, para a tela e para o JSON-LD
export function trilhaDaColecao(m) {
  const base = [['Início', '/'], ['Salões', rotaDoGuia()], [`Salões em ${m.cidade}`, rotaDaCidade(m.cidade_slug)]]
  if (m.tipo === 'horario' && m.categoria) {
    return [...base, [HORARIOS[m.valor].rotulo, rotaDaColecao(m.cidade_slug, 'horario', m.valor)], [m.migalha || categoriaDoGuia(m.categoria).rotulo, m.caminho]]
  }
  return [...base, [m.migalha || m.nome, m.caminho]]
}
