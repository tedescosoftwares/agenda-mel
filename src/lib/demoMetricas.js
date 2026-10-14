// Métricas do guia no modo demonstração (3.11): 90 dias de visitas e
// cliques de mentira, sempre os mesmos (sorteio com semente), e o mesmo
// formato que guia_desempenho() devolve no banco (migração 156). O que a
// pessoa clicar nas páginas do demo entra aqui na hora (demoEvento).

const TIPOS = [
  ['visita', 'Visitas', 'visita'], ['whatsapp', 'WhatsApp', 'contato'], ['ligar', 'Ligar', 'contato'],
  ['agendar_mimo', 'Agendar pela MIMO', 'contato'], ['mapa', 'Como chegar', 'contato'], ['instagram', 'Instagram', 'contato'],
  ['site', 'Site', 'contato'], ['email', 'E-mail', 'contato'], ['quero_marcar', 'Quero marcar', 'interesse'], ['sou_dono', 'É o dono', 'interesse'],
  ['criar_agenda', 'Criar agenda', 'interesse'], ['compartilhar', 'Compartilhar', 'outro'], ['corrigir', 'Corrigir dados', 'outro'],
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
    for (const p of paginas) {
      const visitas = Math.floor(r() * p.peso * crescer * fimDeSemana)
      for (let v = 0; v < visitas; v++) {
        const em = new Date(agora - d * 86400e3 - Math.floor(r() * 12 * 3600e3)).toISOString()
        const visitante = `demo${n++}`
        const origem = escolher(r, [['google', 55], ['direto', 18], ['interno', 15], ['instagram', 8], ['whatsapp', 4]])
        const aparelho = r() < 0.8 ? 'celular' : 'computador'
        const comum = { em, pagina: p.pagina, lugar_id: p.lugar?.id ?? null, cidade_slug: 'itanhaem', categoria: p.lugar?.categoria ?? (CATS.includes(p.pagina.split('/')[3]) ? p.pagina.split('/')[3] : null), visitante, origem, aparelho }
        ev.push({ ...comum, tipo: 'visita', area: null })
        const l = p.lugar
        if (!l) continue
        const cliques = [
          ['whatsapp', l.whatsapp ? 0.1 : 0], ['ligar', l.telefone ? 0.03 : 0], ['mapa', 0.06], ['instagram', l.instagram ? 0.04 : 0],
          ['site', l.site ? 0.02 : 0], ['agendar_mimo', l.salon_id ? 0.14 : 0], ['quero_marcar', l.salon_id ? 0 : 0.03], ['compartilhar', 0.01],
        ]
        for (const [tipo, chance] of cliques) {
          if (r() < chance) ev.push({ ...comum, tipo, area: escolher(r, [['heroi', 50], ['fatos', 25], ['barra', 25]]) })
        }
      }
    }
  }
  return ev
}

const eventos = (lugares) => (EVENTOS ??= gerar(lugares))

// o que a pessoa clicou nas páginas do demo (a mesma limpeza do banco, no essencial)
export function demoEvento(corpo, lugares) {
  if (!corpo?.tipo_ || !GRUPO[corpo.tipo_]) return
  const pagina = String(corpo.pagina_ ?? '').toLowerCase().replace(/\/+$/, '') || '/'
  const [, raiz, cidade, item] = pagina.split('/')
  const l = raiz === 'saloes' && item && !CATS.includes(item) ? lugares.find((x) => x.cidade_slug === cidade && x.slug === item) : null
  // como o banco: o mesmo evento na mesma página em 30 minutos conta uma vez
  const meiaHora = Date.now() - 30 * 60e3
  if (eventos(lugares).some((e) => e.visitante === 'demo-voce' && e.pagina === pagina && e.tipo === corpo.tipo_ && new Date(e.em).getTime() > meiaHora)) return
  eventos(lugares).push({
    em: new Date().toISOString(), tipo: corpo.tipo_, pagina, lugar_id: l?.id ?? null, cidade_slug: raiz === 'saloes' ? cidade ?? null : null,
    categoria: l?.categoria ?? (CATS.includes(item) ? item : null), visitante: 'demo-voce', origem: corpo.origem_ || 'direto',
    aparelho: corpo.aparelho_ ?? null, area: corpo.area_ ?? null,
  })
}

// o mesmo formato de guia_desempenho() (156)
export function demoDesempenho({ dias = 30, cidade_ = '' } = {}, lugares, interesses) {
  const n = Math.max(1, Math.min(Number(dias) || 30, 400))
  const hoje = diaSP(Date.now())
  const menos = (dia, k) => diaSP(new Date(`${dia}T15:00:00Z`).getTime() - k * 86400e3)
  const de = menos(hoje, n - 1), antes = menos(de, n)
  const cid = String(cidade_ ?? '').trim() || null
  const ev = eventos(lugares).map((e) => ({ ...e, dia: diaSP(e.em), grupo: GRUPO[e.tipo] }))
    .filter((e) => e.dia >= antes && e.dia <= hoje && e.pagina.startsWith('/saloes') && (!cid || e.cidade_slug === cid))
  const agora = ev.filter((e) => e.dia >= de), velhos = ev.filter((e) => e.dia < de)
  const contar = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m }, {})
  const unicos = (xs) => new Set(xs.filter((e) => e.tipo === 'visita').map((e) => `${e.dia}|${e.visitante}`)).size
  const ints = interesses.filter((i) => diaSP(i.criado_em) >= de)
  const porLugarInt = (id) => contar(ints.filter((i) => i.lugar_id === id), (i) => i.tipo)
  const porPagina = new Map()
  for (const e of agora) { if (!porPagina.has(e.pagina)) porPagina.set(e.pagina, []); porPagina.get(e.pagina).push(e) }
  const linha = (pagina, lugarId, es) => {
    const l = lugares.find((x) => x.id === lugarId)
    const partes = pagina.split('/')
    return {
      pagina, lugar_id: lugarId, nome: l?.nome ?? null, slug: l?.slug ?? null, bairro: l?.bairro ?? null, status: l?.status ?? null,
      whatsapp: l?.whatsapp ?? null, telefone: l?.telefone ?? null, cidade_slug: l?.cidade_slug ?? partes[2] ?? null, categoria: l?.categoria ?? (partes[3] || null),
      visitas: es.filter((e) => e.tipo === 'visita').length, visitantes: unicos(es), contatos: es.filter((e) => e.grupo === 'contato').length,
      eventos: contar(es, (e) => e.tipo), interesses: lugarId ? porLugarInt(lugarId) : {},
    }
  }
  const paginas = [...porPagina].map(([p, es]) => linha(p, es[0].lugar_id, es))
  for (const l of lugares) if (l.status === 'publicado' && (!cid || l.cidade_slug === cid) && !paginas.some((p) => p.lugar_id === l.id)) paginas.push(linha(`/saloes/${l.cidade_slug}/${l.slug}`, l.id, []))
  paginas.sort((a, b) => b.visitas - a.visitas || b.contatos - a.contatos || String(a.nome ?? '~').localeCompare(String(b.nome ?? '~')))
  const serie = []
  for (let k = n - 1; k >= 0; k--) {
    const dia = menos(hoje, k)
    const doDia = agora.filter((e) => e.dia === dia)
    serie.push({ dia, visitas: doDia.filter((e) => e.tipo === 'visita').length, contatos: doDia.filter((e) => e.grupo === 'contato').length })
  }
  const visitasAgora = agora.filter((e) => e.tipo === 'visita')
  return {
    dias: n, de, ate: hoje,
    tipos: TIPOS,
    totais: contar(agora, (e) => e.tipo),
    totais_antes: contar(velhos, (e) => e.tipo),
    visitantes: unicos(agora),
    visitantes_antes: unicos(velhos),
    interesses: contar(ints, (i) => i.tipo),
    por_dia: serie,
    origens: Object.entries(contar(visitasAgora, (e) => e.origem)).map(([origem, visitas]) => ({ origem, visitas })).sort((a, b) => b.visitas - a.visitas),
    aparelhos: contar(visitasAgora, (e) => e.aparelho ?? '?'),
    areas: Object.entries(contar(agora.filter((e) => e.grupo === 'contato' || e.grupo === 'interesse'), (e) => e.area ?? 'outra')).map(([area, contatos]) => ({ area, contatos })).sort((a, b) => b.contatos - a.contatos),
    paginas,
  }
}
