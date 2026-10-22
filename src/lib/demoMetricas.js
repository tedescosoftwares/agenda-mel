// Métricas do guia no modo demonstração (3.11): 90 dias de visitas e
// cliques de mentira, sempre os mesmos (sorteio com semente), e o mesmo
// formato que guia_desempenho() devolve no banco (migrações 156 e 161). O
// que a pessoa clicar nas páginas do demo entra aqui na hora (demoEvento).
import { chaveDoBairro } from './guiaColecoes.js'

const TIPOS = [
  ['visita', 'Visitas', 'visita'], ['whatsapp', 'WhatsApp', 'contato'], ['ligar', 'Ligar', 'contato'],
  ['agendar_mimo', 'Agendar pela MIMO', 'contato'], ['mapa', 'Como chegar', 'contato'], ['instagram', 'Instagram', 'contato'],
  ['site', 'Site', 'contato'], ['email', 'E-mail', 'contato'], ['quero_marcar', 'Quero marcar', 'interesse'], ['sou_dono', 'É o dono', 'interesse'],
  ['criar_agenda', 'Criar agenda', 'interesse'], ['compartilhar', 'Compartilhar', 'outro'], ['corrigir', 'Corrigir dados', 'outro'],
  ['localizacao', 'Localização ativada', 'outro'], ['pedido_enviado', 'Pedido enviado (Quero marcar)', 'outro'],
].map(([tipo, rotulo, grupo]) => ({ tipo, rotulo, grupo }))
const GRUPO = Object.fromEntries(TIPOS.map((t) => [t.tipo, t.grupo]))
const CATS = ['beleza', 'cabelo', 'unhas', 'cilios', 'sobrancelhas', 'estetica', 'maquiagem']

// mulberry32: a mesma semente, os mesmos números
function sorteio(semente) {
  let a = semente >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const escolher = (r, pesos) => { let x = r() * pesos.reduce((s, [, p]) => s + p, 0); for (const [v, p] of pesos) { x -= p; if (x <= 0) return v } return pesos[0][0] }

// o dia no fuso de São Paulo, como o banco faz
const diaSP = (d) => new Date(new Date(d).getTime() - 3 * 3600e3).toISOString().slice(0, 10)
// distância em km (haversine), para o salão mais perto de cada ponto
function km(a, b) {
  const R = 6371, rad = (g) => (g * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

let EVENTOS = null
function gerar(lugares) {
  const r = sorteio(20261014)
  const agora = Date.now()
  const noAr = lugares.filter((l) => l.status === 'publicado')
  const paginas = [
    ...noAr.map((l) => ({ pagina: `/saloes/${l.cidade_slug}/${l.slug}`, lugar: l, peso: l.selecao ? 9 : 5 })),
    { pagina: '/saloes/itanhaem', peso: 7 }, { pagina: '/saloes/itanhaem/unhas', peso: 4 }, { pagina: '/saloes/itanhaem/cilios', peso: 2 }, { pagina: '/saloes', peso: 1 },
  ]
  const ev = []
  let n = 0
  for (let d = 89; d >= 0; d--) {
    const crescer = 0.35 + (89 - d) / 89 // as páginas vão ganhando visita com o tempo
    const fimDeSemana = [0, 6].includes(new Date(agora - d * 86400e3).getDay()) ? 1.25 : 1
    const doDia = [] // quem já passou hoje: uma parte volta e abre outra página (3.12: pessoas < visitas, como no site)
    for (const p of paginas) {
      const visitas = Math.floor(r() * p.peso * crescer * fimDeSemana)
      for (let v = 0; v < visitas; v++) {
        const em = new Date(agora - d * 86400e3 - Math.floor(r() * 12 * 3600e3)).toISOString()
        const volta = doDia.length > 0 && r() < 0.25 ? doDia[Math.floor(r() * doDia.length)] : null
        const quem = volta ?? { visitante: `demo${n++}`, aparelho: r() < 0.8 ? 'celular' : 'computador' }
        if (!volta) doDia.push(quem)
        const origem = volta ? 'interno' : escolher(r, [['google', 55], ['direto', 18], ['interno', 15], ['instagram', 8], ['whatsapp', 4]])
        const comum = { em, pagina: p.pagina, lugar_id: p.lugar?.id ?? null, cidade_slug: 'itanhaem', categoria: p.lugar?.categoria ?? (CATS.includes(p.pagina.split('/')[3]) ? p.pagina.split('/')[3] : null), visitante: quem.visitante, origem, aparelho: quem.aparelho }
        ev.push({ ...comum, tipo: 'visita', area: null })
        // 3.13: uma parte de quem chega nas listas ativa a localização; o ponto cai perto de um salão da cidade
        if (!volta && !p.lugar && r() < 0.3) {
          const ref = noAr[Math.floor(r() * noAr.length)]
          if (ref?.latitude != null) ev.push({ ...comum, tipo: 'localizacao', area: null, dados: { lat: ref.latitude + (r() - 0.5) * 0.014, lng: ref.longitude + (r() - 0.5) * 0.014, prec: Math.round(20 + r() * 80) } })
        }
        const l = p.lugar
        if (!l) continue
        // salão sem Instagram e fora da MIMO recebe menos contato no demo: é o caso
        // "muita visita e pouco contato" dos destaques da aba Desempenho (3.12)
        const atrai = l.instagram || l.salon_id ? 1 : 0.25
        const cliques = [
          ['whatsapp', l.whatsapp ? 0.1 : 0], ['ligar', l.telefone ? 0.03 : 0], ['mapa', 0.06], ['instagram', l.instagram ? 0.04 : 0],
          ['site', l.site ? 0.02 : 0], ['agendar_mimo', l.salon_id ? 0.14 : 0], ['quero_marcar', l.salon_id ? 0 : 0.03], ['compartilhar', 0.01],
        ]
        for (const [tipo, chance] of cliques) {
          if (r() < chance * atrai) ev.push({ ...comum, tipo, area: escolher(r, [['heroi', 50], ['fatos', 25], ['barra', 25]]) })
        }
      }
    }
  }
  return ev
}

const eventos = (lugares) => (EVENTOS ??= gerar(lugares))
// apagar em lote (3.18): tira os eventos que passam no teste (dos salões apagados; da cidade que ficou vazia)
export function demoApagarEventos(lugares, teste) {
  const antes = eventos(lugares).length
  EVENTOS = eventos(lugares).filter((e) => !teste(e))
  return antes - EVENTOS.length
}

// o que a pessoa clicou nas páginas do demo (a mesma limpeza do banco, no essencial)
export function demoEvento(corpo, lugares) {
  if (!corpo?.tipo_ || !GRUPO[corpo.tipo_]) return
  const pagina = String(corpo.pagina_ ?? '').toLowerCase().replace(/\/+$/, '') || '/'
  const [, raiz, cidade, item] = pagina.split('/')
  const l = raiz === 'saloes' && item && !CATS.includes(item) ? lugares.find((x) => x.cidade_slug === cidade && x.slug === item) : null
  // como o banco: o mesmo evento na mesma página em 30 minutos conta uma vez
  const meiaHora = Date.now() - 30 * 60e3
  if (eventos(lugares).some((e) => e.visitante === 'demo-voce' && e.pagina === pagina && e.tipo === corpo.tipo_ && new Date(e.em).getTime() > meiaHora)) return
  // o gatilho da 163: o ponto só entra com lat e lng válidos, e só com lat, lng e prec
  let dados = null
  if (corpo.tipo_ === 'localizacao') {
    const lat = Number(corpo.dados_?.lat), lng = Number(corpo.dados_?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return
    dados = { lat, lng, prec: Math.max(0, Math.round(Number(corpo.dados_?.prec) || 0)) }
  }
  eventos(lugares).push({
    em: new Date().toISOString(), tipo: corpo.tipo_, pagina, lugar_id: l?.id ?? null, cidade_slug: raiz === 'saloes' ? cidade ?? null : null,
    categoria: l?.categoria ?? (CATS.includes(item) ? item : null), visitante: 'demo-voce', origem: corpo.origem_ || 'direto',
    aparelho: corpo.aparelho_ ?? null, area: corpo.area_ ?? null, dados,
  })
}

// o mesmo formato de guia_mapa_acessos() (163): um ponto por pessoa e dia, o salão
// no ar mais perto de cada um e a conta por bairro (a mais de 8 km, "fora da cidade")
export function demoMapaAcessos({ dias = 30 } = {}, lugares) {
  const n = Math.max(1, Math.min(Number(dias) || 30, 400))
  const hoje = diaSP(Date.now())
  const de = diaSP(new Date(`${hoje}T15:00:00Z`).getTime() - (n - 1) * 86400e3)
  const noAr = lugares.filter((l) => l.status === 'publicado' && l.latitude != null && l.longitude != null)
  const vistos = new Set()
  const pontos = []
  for (const e of [...eventos(lugares)].sort((a, b) => a.em.localeCompare(b.em))) {
    if (e.tipo !== 'localizacao' || !e.dados || diaSP(e.em) < de) continue
    const chave = `${e.visitante}|${diaSP(e.em)}`
    if (vistos.has(chave)) continue
    vistos.add(chave)
    let perto = null
    for (const l of noAr) {
      const d = km(e.dados, { lat: l.latitude, lng: l.longitude })
      if (!perto || d < perto.km) perto = { lugar_id: l.id, lugar: l.nome, bairro: l.bairro, km: d }
    }
    pontos.push({ em: e.em, lat: e.dados.lat, lng: e.dados.lng, prec: e.dados.prec, pagina: e.pagina, aparelho: e.aparelho, origem: e.origem,
      lugar_id: perto?.lugar_id ?? null, lugar: perto?.lugar ?? null, bairro: perto?.bairro ?? null, km: perto ? Math.round(perto.km * 100) / 100 : null })
  }
  pontos.sort((a, b) => b.em.localeCompare(a.em))
  const porBairro = new Map()
  for (const p of pontos) {
    const chave = p.km == null ? '_sem' : p.km > 8 ? '_fora' : chaveDoBairro(p.bairro, 'itanhaem') || '_sem'
    const antes = porBairro.get(chave)?.bairro
    const nome = chave === '_sem' ? 'Sem salão de referência' : chave === '_fora' ? 'Fora da cidade' : (antes && antes.length <= (p.bairro ?? '').length ? antes : p.bairro)
    porBairro.set(chave, { chave, bairro: nome, n: (porBairro.get(chave)?.n ?? 0) + 1 })
  }
  return {
    dias: n, de, ate: hoje, total: pontos.length, pontos: pontos.slice(0, 5000),
    por_bairro: [...porBairro.values()].sort((a, b) => b.n - a.n || a.bairro.localeCompare(b.bairro, 'pt-BR')),
  }
}

// o mesmo formato de guia_desempenho() (156, com o que a 161 acrescentou)
export function demoDesempenho({ dias = 30, cidade_ = '' } = {}, lugares, interesses) {
  const n = Math.max(1, Math.min(Number(dias) || 30, 400))
  const hoje = diaSP(Date.now())
  const menos = (dia, k) => diaSP(new Date(`${dia}T15:00:00Z`).getTime() - k * 86400e3)
  const de = menos(hoje, n - 1), antes = menos(de, n)
  const cid = String(cidade_ ?? '').trim() || null
  const ev = eventos(lugares).map((e) => ({ ...e, dia: diaSP(e.em), grupo: GRUPO[e.tipo] }))
    .filter((e) => e.dia >= antes && e.dia <= hoje && e.pagina.startsWith('/saloes') && (!cid || e.cidade_slug === cid))
  const agora = ev.filter((e) => e.dia >= de)
  // o período anterior como o banco: a mesma janela, cortada na mesma hora, e só com histórico completo
  const corte = Date.now() - n * 86400e3
  const todos = eventos(lugares)
  const primeiro = todos.reduce((m, e) => (e.em < m ? e.em : m), todos[0]?.em ?? new Date().toISOString())
  const comHistorico = diaSP(primeiro) <= antes
  const velhos = comHistorico ? ev.filter((e) => e.dia < de && new Date(e.em).getTime() < corte) : []
  const contar = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m }, {})
  const unicos = (xs, grupo = 'visita') => new Set(xs.filter((e) => (grupo === 'visita' ? e.tipo === 'visita' : e.grupo === grupo)).map((e) => `${e.dia}|${e.visitante}`)).size
  const ints = interesses.filter((i) => diaSP(i.criado_em) >= de)
  // os pedidos do período anterior, pela mesma regra dos eventos (161)
  const intsAntes = comHistorico ? interesses.filter((i) => diaSP(i.criado_em) >= antes && diaSP(i.criado_em) < de && new Date(i.criado_em).getTime() < corte) : []
  const porLugarInt = (id) => contar(ints.filter((i) => i.lugar_id === id), (i) => i.tipo)
  const porPagina = new Map()
  for (const e of agora) { if (!porPagina.has(e.pagina)) porPagina.set(e.pagina, []); porPagina.get(e.pagina).push(e) }
  const visitasAntes = contar(velhos.filter((e) => e.tipo === 'visita'), (e) => e.pagina)
  const linha = (pagina, lugarId, es) => {
    const l = lugares.find((x) => x.id === lugarId)
    const partes = pagina.split('/')
    return {
      pagina, lugar_id: lugarId, nome: l?.nome ?? null, slug: l?.slug ?? null, bairro: l?.bairro ?? null, status: l?.status ?? null, na_mimo: !!l?.salon_id,
      whatsapp: l?.whatsapp ?? null, telefone: l?.telefone ?? null, cidade_slug: l?.cidade_slug ?? partes[2] ?? null, categoria: l?.categoria ?? (partes[3] || null),
      visitas: es.filter((e) => e.tipo === 'visita').length, visitantes: unicos(es), contatos: es.filter((e) => e.grupo === 'contato').length, contataram: unicos(es, 'contato'),
      eventos: contar(es, (e) => e.tipo), interesses: lugarId ? porLugarInt(lugarId) : {},
      visitas_antes: comHistorico ? visitasAntes[pagina] ?? 0 : null,
    }
  }
  const paginas = [...porPagina].map(([p, es]) => linha(p, es[0].lugar_id, es))
  for (const l of lugares) if (l.status === 'publicado' && (!cid || l.cidade_slug === cid) && !paginas.some((p) => p.lugar_id === l.id)) paginas.push(linha(`/saloes/${l.cidade_slug}/${l.slug}`, l.id, []))
  paginas.sort((a, b) => b.visitas - a.visitas || b.contatos - a.contatos || String(a.nome ?? '~').localeCompare(String(b.nome ?? '~')))
  const serie = []
  for (let k = n - 1; k >= 0; k--) {
    const dia = menos(hoje, k)
    const doDia = agora.filter((e) => e.dia === dia)
    serie.push({
      dia, visitas: doDia.filter((e) => e.tipo === 'visita').length, contatos: doDia.filter((e) => e.grupo === 'contato').length,
      visitantes: unicos(doDia), contataram: unicos(doDia, 'contato'), pedidos: ints.filter((i) => i.tipo === 'quero_marcar' && diaSP(i.criado_em) === dia).length,
    })
  }
  const visitasAgora = agora.filter((e) => e.tipo === 'visita')
  const entradas = visitasAgora.filter((e) => e.origem !== 'interno')
  return {
    dias: n, de, ate: hoje,
    tipos: TIPOS,
    totais: contar(agora, (e) => e.tipo),
    totais_antes: contar(velhos, (e) => e.tipo),
    visitantes: unicos(agora),
    visitantes_antes: unicos(velhos),
    contataram: unicos(agora, 'contato'),
    contataram_antes: unicos(velhos, 'contato'),
    interesses: contar(ints, (i) => i.tipo),
    interesses_antes: contar(intsAntes, (i) => i.tipo),
    por_dia: serie,
    origens: Object.entries(contar(entradas, (e) => e.origem)).map(([origem, visitas]) => ({ origem, visitas })).sort((a, b) => b.visitas - a.visitas),
    aparelhos: contar(visitasAgora, (e) => e.aparelho ?? '?'),
    areas: Object.entries(contar(agora.filter((e) => e.grupo === 'contato' || e.grupo === 'interesse'), (e) => e.area ?? 'outra')).map(([area, contatos]) => ({ area, contatos })).sort((a, b) => b.contatos - a.contatos),
    paginas,
  }
}
