// O site ao vivo no modo demonstração (3.44): imita site_ao_vivo() (migrações 192 e 193) com visitantes de mentira que
// entram, andam pelas páginas, tocam no WhatsApp, no Como chegar, no Quero marcar... e saem com o relógio (um ciclo de
// 20 minutos), e soma as batidas e os toques de verdade do demo (demoPresenca, chamada por src/lib/presenca.js, e
// demoAcao, chamada por src/lib/eventos.js, quando alguém abre o site no modo demo).
import { GUIA_LUGARES } from './demoGuia'

const CIDADES = {
  itanhaem: { cidade: 'Itanhaém', uf: 'SP', lat: -24.183, lng: -46.789 },
  mongagua: { cidade: 'Mongaguá', uf: 'SP', lat: -24.093, lng: -46.62 },
  peruibe: { cidade: 'Peruíbe', uf: 'SP', lat: -24.32, lng: -47.0 },
  santos: { cidade: 'Santos', uf: 'SP', lat: -23.96, lng: -46.333 },
  saopaulo: { cidade: 'São Paulo', uf: 'SP', lat: -23.554, lng: -46.639 },
  praiagrande: { cidade: 'Praia Grande', uf: 'SP', lat: -24.006, lng: -46.403 },
}
const TITULOS = {
  '/': 'MIMO: agenda online para salão de beleza',
  '/saloes/itanhaem': 'Salões de beleza em Itanhaém',
  '/saloes/itanhaem/unhas': 'Manicure e unhas em Itanhaém',
  '/saloes/itanhaem/studio-lirio': 'Studio Lírio: manicure no Centro de Itanhaém',
  '/saloes/itanhaem/cabelo': 'Cabeleireiros em Itanhaém',
  '/saloes/itanhaem/atelie-cabelo-e-arte': 'Ateliê Cabelo & Arte em Itanhaém',
  '/saloes/mongagua': 'Salões de beleza em Mongaguá',
  '/saloes/regiao/baixada-santista': 'Salões na Baixada Santista',
  '/blog/como-escolher-salao': 'Como escolher um salão de beleza',
  '/sistema-para-salao-de-beleza': 'Sistema para salão de beleza',
  '/planos': 'Planos da MIMO',
}
// os tipos de toque (site_eventos_tipos): rótulo e grupo
const TIPOS = {
  whatsapp: ['WhatsApp', 'contato'], ligar: ['Ligar', 'contato'], agendar_mimo: ['Agendar pela MIMO', 'contato'], mapa: ['Como chegar', 'contato'],
  instagram: ['Instagram', 'contato'], site: ['Site', 'contato'], email: ['E-mail', 'contato'], quero_marcar: ['Quero marcar', 'interesse'],
  pedido_enviado: ['Pedido enviado (Quero marcar)', 'outro'], sou_dono: ['É o dono', 'interesse'], criar_agenda: ['Criar agenda', 'interesse'],
  compartilhar: ['Compartilhar', 'outro'], corrigir: ['Corrigir dados', 'outro'], localizacao: ['Localização ativada', 'outro'],
}
const SALOES = { '/saloes/itanhaem/studio-lirio': 'Studio Lírio', '/saloes/itanhaem/atelie-cabelo-e-arte': 'Ateliê Cabelo & Arte' }
// contato é o que leva a cliente ao salão (o mesmo da migração 193)
const ehContato = (tipo) => TIPOS[tipo]?.[1] === 'contato' || tipo === 'quero_marcar' || tipo === 'pedido_enviado'

// [começa (s no ciclo), dura (s), origem, ref, utm, aparelho, sistema, navegador, tela, cidade, fonte, trajeto, toques [tipo, s desde a entrada]]
// (o toque é na página em que a visita está naquele momento)
const MOLDES = [
  [0, 420, 'google', 'www.google.com', null, 'celular', 'Android 14', 'Chrome', '412x915', 'itanhaem', 'ip', ['/saloes/itanhaem/unhas', '/saloes/itanhaem/cabelo', '/saloes/itanhaem/unhas', '/saloes/itanhaem/studio-lirio'], [['whatsapp', 390]]],
  [40, 300, 'instagram', 'l.instagram.com', { source: 'instagram', campaign: 'natal' }, 'celular', 'iOS 18', 'Instagram', '393x852', 'santos', 'ip', ['/saloes/itanhaem', '/saloes/itanhaem/atelie-cabelo-e-arte'], [['instagram', 120]]],
  [90, 600, 'google', 'www.google.com', null, 'celular', 'Android 13', 'Samsung Internet', '384x854', 'itanhaem', 'gps', ['/saloes/itanhaem', '/saloes/itanhaem/unhas', '/saloes/itanhaem/studio-lirio'], [['localizacao', 20], ['mapa', 200], ['ligar', 570]]],
  [150, 240, 'direto', null, null, 'computador', 'Windows', 'Chrome', '1920x1080', 'saopaulo', 'ip', ['/', '/sistema-para-salao-de-beleza', '/planos'], []],
  [220, 500, 'whatsapp', null, null, 'celular', 'Android 12', 'Chrome', '360x800', 'mongagua', 'gps', ['/saloes/mongagua', '/saloes/regiao/baixada-santista'], []],
  [300, 180, 'facebook', 'l.facebook.com', null, 'celular', 'Android 11', 'Facebook', '360x780', 'praiagrande', 'ip', ['/blog/como-escolher-salao', '/saloes/itanhaem'], []],
  [380, 360, 'google', 'www.google.com', null, 'tablet', 'iPadOS', 'Safari', '820x1180', 'peruibe', 'ip', ['/saloes/regiao/baixada-santista', '/saloes/itanhaem', '/saloes/itanhaem/cabelo'], [['compartilhar', 200]]],
  [520, 420, 'bing', 'www.bing.com', null, 'computador', 'macOS', 'Safari', '1440x900', 'saopaulo', 'ip', ['/sistema-para-salao-de-beleza', '/'], []],
  [640, 300, 'google', 'www.google.com', null, 'celular', 'iOS 17', 'Safari', '390x844', 'itanhaem', 'ip', ['/saloes/itanhaem/studio-lirio'], [['quero_marcar', 150], ['pedido_enviado', 240]]],
  [760, 540, 'instagram', 'l.instagram.com', null, 'celular', 'Android 14', 'Instagram', '412x892', 'santos', 'ip', ['/saloes/itanhaem', '/saloes/itanhaem/unhas', '/saloes/itanhaem/studio-lirio'], [['agendar_mimo', 510]]],
  [900, 240, 'outro', 'guiadolitoral.com.br', null, 'computador', 'Windows', 'Edge', '1366x768', 'santos', 'ip', ['/saloes/regiao/baixada-santista'], []],
  [1000, 480, 'google', 'www.google.com', null, 'celular', 'Android 14', 'Chrome', '412x915', 'mongagua', 'ip', ['/saloes/mongagua', '/saloes/itanhaem/atelie-cabelo-e-arte'], [['whatsapp', 100]]],
]
const CICLO = 1200
const PASSO_S = 70 // cada visitante de mentira troca de página a cada ~70 s
const T0 = Math.floor(Date.now() / 1000) - 600 // o demo abre no meio do ciclo, já com gente no site

const iso = (s) => new Date(s * 1000).toISOString()
const REAIS = new Map() // as batidas de verdade do demo (uma visita por aba aberta)
const TOQUES_REAIS = [] // os toques de verdade do demo (tocar no WhatsApp de um salão do demo aparece aqui)

const toque = (tipo, em, pagina, t) => ({ tipo, rotulo: TIPOS[tipo]?.[0] ?? tipo, grupo: TIPOS[tipo]?.[1] ?? 'outro', em: iso(em), pagina, lugar: SALOES[pagina] ?? null, t })

// o desfecho da visita (o mesmo da migração 193)
function desfecho(v, acoes, agora) {
  const terminou = !!v.saiu_em || new Date(v.visto_em).getTime() / 1000 <= agora - 75
  const contatos = acoes.filter((a) => ehContato(a.tipo))
  const ult = contatos.at(-1)
  if (!terminou) return ult ? 'contatou' : 'navegando'
  if (!ult) return 'sem_contato'
  const fim = new Date(v.saiu_em ?? v.visto_em).getTime() / 1000
  return new Date(ult.em).getTime() / 1000 >= fim - 120 ? `saiu_${ult.tipo}` : 'contatou_e_saiu'
}

// um toque de verdade no demo (src/lib/eventos.js): entra na visita de quem está com o site aberto
export function demoAcao(c) {
  const tipo = c?.tipo_
  if (!tipo || tipo === 'visita' || !TIPOS[tipo]) return
  const agora = Math.floor(Date.now() / 1000)
  const pag = String(c?.pagina_ ?? '/').toLowerCase()
  const v = REAIS.get('demo-voce')
  const salao = GUIA_LUGARES.find((l) => `/saloes/${l.cidade_slug}/${l.slug}` === pag)
  TOQUES_REAIS.push({ ...toque(tipo, agora, pag, v ? agora - v.inicio : 0), lugar: salao?.nome ?? SALOES[pag] ?? null })
  if (TOQUES_REAIS.length > 40) TOQUES_REAIS.shift()
}

export function demoPresenca(c) {
  const agora = Math.floor(Date.now() / 1000)
  const chave = 'demo-voce'
  const v = REAIS.get(chave)
  const pag = String(c?.pagina_ ?? '/').toLowerCase()
  if (!v) {
    REAIS.set(chave, { id: 999001, inicio: agora, visto: agora, saiu: null, pagina: pag, titulo: c?.titulo_ ?? null, entrada: pag, trajeto: [{ p: pag, t: 0 }],
      origem: c?.origem_ ?? 'direto', ref: c?.ref_ ?? null, utm: c?.utm_ ?? null, dispositivo: c?.dispositivo_ ?? null, sistema: c?.sistema_ ?? null,
      navegador: c?.navegador_ ?? null, tela: c?.tela_ ?? null, idioma: c?.idioma_ ?? null, ...CIDADES.itanhaem, local_fonte: 'ip' })
    return
  }
  if (pag !== v.pagina && v.trajeto.length < 40) v.trajeto.push({ p: pag, t: agora - v.inicio })
  Object.assign(v, { visto: agora, saiu: c?.sair_ ? agora : null, pagina: pag, titulo: c?.titulo_ || v.titulo })
}

// os visitantes de mentira num instante (s): quem está no meio da visita, em que página, desde quando
// janela (s): até onde no passado os visitantes de mentira existem (o período escolhido no painel, 3.49)
function deMentira(agora, janela = 1800) {
  const out = []
  const t = ((agora - T0) % CICLO + CICLO) % CICLO
  const voltaIni = agora - t
  const ciclos = Math.ceil(janela / CICLO) + 1
  MOLDES.forEach((m, i) => {
    const [comeca, dura, origem, ref, utm, dispositivo, sistema, navegador, tela, cid, fonte, rota, toques] = m
    for (let k = 0; k <= ciclos; k++) {
      const volta = voltaIni - k * CICLO
      const inicio = volta + comeca
      const fim = inicio + dura
      if (agora < inicio || agora > fim + janela) continue
      const vivo = Math.min(agora, fim)
      const passos = Math.min(rota.length, 1 + Math.floor((vivo - inicio) / PASSO_S))
      const trajeto = rota.slice(0, passos).map((p, k) => ({ p, t: k * PASSO_S }))
      const pagina = trajeto.at(-1).p
      const c = CIDADES[cid]
      const acoes = toques.filter(([, ts]) => inicio + ts <= vivo).map(([tipo, ts]) => toque(tipo, inicio + ts, rota[Math.min(rota.length - 1, Math.floor(ts / PASSO_S))], ts))
      out.push({ acoes,
        id: 1000 + i * 100 + k, inicio_em: iso(inicio), visto_em: iso(agora <= fim ? agora - (agora - inicio) % 25 : fim),
        saiu_em: agora > fim ? iso(fim) : null, pagina, titulo: TITULOS[pagina] ?? null, entrada: rota[0], paginas: passos, trajeto,
        origem, ref, utm, dispositivo, sistema, navegador, tela, idioma: 'pt-BR', cidade: c.cidade, uf: c.uf, bairro: null, local_fonte: fonte,
        lat: fonte === 'gps' ? +(c.lat + 0.004 * (i % 3)).toFixed(3) : c.lat, lng: fonte === 'gps' ? +(c.lng - 0.003 * (i % 2)).toFixed(3) : c.lng,
      })
    }
  })
  for (const v of REAIS.values()) {
    out.push({ acoes: TOQUES_REAIS.filter((a) => new Date(a.em).getTime() / 1000 >= v.inicio - 60), id: v.id, inicio_em: iso(v.inicio), visto_em: iso(v.visto), saiu_em: v.saiu ? iso(v.saiu) : null, pagina: v.pagina, titulo: v.titulo, entrada: v.entrada,
      paginas: v.trajeto.length, trajeto: v.trajeto, origem: v.origem, ref: v.ref, utm: v.utm, dispositivo: v.dispositivo, sistema: v.sistema, navegador: v.navegador,
      tela: v.tela, idioma: v.idioma, cidade: v.cidade, uf: v.uf, bairro: null, local_fonte: v.local_fonte, lat: v.lat, lng: v.lng })
  }
  for (const v of out) {
    v.contatos = v.acoes.filter((a) => ehContato(a.tipo)).length
    v.desfecho = desfecho(v, v.acoes, agora)
  }
  return out
}

const contar = (lista, chave, rotulo = chave) => {
  const m = new Map()
  for (const x of lista) { const k = x[chave] ?? 'outro'; m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m].map(([k, n]) => ({ [rotulo]: k, n })).sort((a, b) => b.n - a.n)
}

export function demoAoVivo({ horas_ } = {}) {
  const horas = Math.max(1, Math.min(Number(horas_) || 1, 24))
  const janela = horas * 3600
  const agora = Math.floor(Date.now() / 1000)
  const todos = deMentira(agora, janela)
  const ms = (x) => new Date(x).getTime() / 1000
  const periodo = todos.filter((v) => ms(v.visto_em) > agora - janela)
  const trinta = periodo.filter((v) => ms(v.visto_em) > agora - 1800)
  const ativos = trinta.filter((v) => ms(v.visto_em) > agora - 75 && !v.saiu_em).sort((a, b) => b.visto_em.localeCompare(a.visto_em))
  const recentes = periodo.filter((v) => !ativos.includes(v)).sort((a, b) => b.visto_em.localeCompare(a.visto_em))
  const minutos = []
  for (let k = 29; k >= 0; k--) {
    const m = Math.floor(agora / 60) * 60 - k * 60
    minutos.push({ m: iso(m), n: trinta.filter((v) => ms(v.inicio_em) < m + 60 && ms(v.visto_em) >= m).length + (k > 20 ? 1 : 0) })
  }
  const porCidade = (lista) => {
    const m = new Map()
    for (const v of lista) if (v.cidade) { const k = `${v.cidade}|${v.uf}`; const x = m.get(k) ?? { cidade: v.cidade, uf: v.uf, n: 0, gps: 0 }; x.n++; if (v.local_fonte === 'gps') x.gps++; m.set(k, x) }
    return [...m.values()].sort((a, b) => b.n - a.n)
  }
  const paginas = new Map()
  for (const v of ativos) { const x = paginas.get(v.pagina) ?? { pagina: v.pagina, titulo: v.titulo, n: 0 }; x.n++; paginas.set(v.pagina, x) }
  const hora = new Date().getHours()
  // as últimas ações: as dos visitantes de mentira e os toques de verdade, com o aparelho e a cidade da visita
  const toquesDe = (lista) => lista.flatMap((v) => v.acoes.filter((a) => a.tipo !== 'localizacao')
    .map((a) => ({ ...a, dispositivo: v.dispositivo, cidade: v.cidade, uf: v.uf, local_fonte: v.local_fonte, visita: v.id })))
  // (como no banco, o toque de verdade sem visita registrada também entra, sem aparelho)
  const soltos = REAIS.size ? [] : TOQUES_REAIS.map((a) => ({ ...a, dispositivo: null, cidade: null, uf: null, local_fonte: null, visita: null }))
  const acoesRecentes = [...toquesDe(todos), ...soltos].filter((a) => ms(a.em) > agora - janela).sort((a, b) => b.em.localeCompare(a.em)).slice(0, 100)
  const terminadas = todos.filter((v) => v.desfecho !== 'contatou' && v.desfecho !== 'navegando')
  const somaDesfechos = { saiu_whatsapp: 21, saiu_ligar: 6, saiu_mapa: 9, saiu_pedido_enviado: 4, saiu_agendar_mimo: 3, saiu_instagram: 7, saiu_quero_marcar: 2, contatou_e_saiu: 18, sem_contato: 96 }
  for (const v of terminadas) somaDesfechos[v.desfecho] = (somaDesfechos[v.desfecho] ?? 0) + 1
  const somaAcoes = { whatsapp: 34, mapa: 15, instagram: 12, ligar: 8, quero_marcar: 7, pedido_enviado: 5, agendar_mimo: 4, site: 3, compartilhar: 3, localizacao: 11 }
  for (const a of toquesDe(todos)) somaAcoes[a.tipo] = (somaAcoes[a.tipo] ?? 0) + 1
  const ultimaSemContato = new Map()
  for (const v of terminadas) if (v.desfecho === 'sem_contato') ultimaSemContato.set(v.pagina, (ultimaSemContato.get(v.pagina) ?? 0) + 1)
  return {
    agora: iso(agora),
    no_site: ativos.length,
    ultimos_30: trinta.length,
    horas, no_periodo: periodo.length,
    minutos,
    ativos,
    recentes: recentes.slice(0, 500),
    paginas_agora: [...paginas.values()].sort((a, b) => b.n - a.n),
    origens: contar(periodo, 'origem'),
    dispositivos: contar(periodo, 'dispositivo'),
    cidades: porCidade(periodo),
    acoes_recentes: acoesRecentes,
    acoes: contar(acoesRecentes, 'tipo').map((x) => ({ ...x, rotulo: TIPOS[x.tipo]?.[0] ?? x.tipo })),
    hoje: {
      visitas: 180 + trinta.length, paginas: 612 + trinta.reduce((s, v) => s + v.paginas, 0), tempo_medio_s: 154,
      por_hora: Array.from({ length: 24 }, (_, h) => ({ h, n: h > hora ? 0 : Math.round(4 + 10 * Math.sin((h / 24) * Math.PI) ** 2 + (h % 5)) })),
      origens: [{ origem: 'google', n: 96 }, { origem: 'instagram', n: 41 }, { origem: 'direto', n: 22 }, { origem: 'whatsapp', n: 14 }, { origem: 'facebook', n: 7 }],
      dispositivos: [{ dispositivo: 'celular', n: 151 }, { dispositivo: 'computador', n: 24 }, { dispositivo: 'tablet', n: 5 }],
      navegadores: [{ navegador: 'Chrome', n: 88 }, { navegador: 'Safari', n: 37 }, { navegador: 'Instagram', n: 29 }, { navegador: 'Samsung Internet', n: 18 }, { navegador: 'Facebook', n: 8 }],
      cidades: [{ cidade: 'Itanhaém', uf: 'SP', n: 71 }, { cidade: 'São Paulo', uf: 'SP', n: 38 }, { cidade: 'Santos', uf: 'SP', n: 29 }, { cidade: 'Mongaguá', uf: 'SP', n: 18 }, { cidade: 'Peruíbe', uf: 'SP', n: 9 }],
      entradas: [{ pagina: '/saloes/itanhaem/unhas', n: 44 }, { pagina: '/saloes/itanhaem', n: 39 }, { pagina: '/saloes/itanhaem/studio-lirio', n: 21 }, { pagina: '/', n: 17 }],
      acoes: Object.entries(somaAcoes).map(([tipo, n]) => ({ tipo, rotulo: TIPOS[tipo]?.[0] ?? tipo, grupo: TIPOS[tipo]?.[1] ?? 'outro', n })).sort((a, b) => b.n - a.n),
      saloes: [{ lugar: 'Studio Lírio', n: 31, whatsapp: 17, pedidos: 3 }, { lugar: 'Ateliê Cabelo & Arte', n: 19, whatsapp: 11, pedidos: 1 }, { lugar: 'Espaço Bela Praia', n: 9, whatsapp: 4, pedidos: 0 }, { lugar: 'Unhas da Rô', n: 6, whatsapp: 6, pedidos: 1 }],
      com_contato: 70 + terminadas.filter((v) => v.contatos > 0).length + todos.filter((v) => v.desfecho === 'contatou').length,
      terminadas: Object.values(somaDesfechos).reduce((s, n) => s + n, 0),
      desfechos: Object.entries(somaDesfechos).map(([d, n]) => ({ desfecho: d, n })).sort((a, b) => b.n - a.n),
      saidas_sem_contato: [['/saloes/itanhaem', 31], ['/', 22], ['/saloes/itanhaem/unhas', 14], ['/blog/como-escolher-salao', 9], ['/saloes/regiao/baixada-santista', 7]]
        .map(([pagina, n]) => ({ pagina, titulo: TITULOS[pagina] ?? null, n: n + (ultimaSemContato.get(pagina) ?? 0) })).sort((a, b) => b.n - a.n),
    },
    geo: { carregado_em: new Date(Date.now() - 3 * 86400e3).toISOString(), versao: '2026-10', faixas: 412515 },
  }
}

// 3.49: "de onde eu pareço estar?" (migração 196): no demo, Itanhaém pela conexão; com um ponto, a cidade do demo mais perto
function minhaCidade({ lat_, lng_ } = {}) {
  const lat = Number(lat_), lng = Number(lng_)
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat_ != null) {
    const c = Object.values(CIDADES).map((x) => ({ ...x, d: (x.lat - lat) ** 2 + (x.lng - lng) ** 2 })).sort((a, b) => a.d - b.d)[0]
    return { cidade: c.cidade, uf: c.uf, lat: +lat.toFixed(3), lng: +lng.toFixed(3), fonte: 'gps' }
  }
  return { ...CIDADES.itanhaem, fonte: 'ip' }
}
export const AO_VIVO_RPC = {
  site_ao_vivo: (a) => demoAoVivo(a ?? {}),
  site_presenca: (a) => { demoPresenca(a); return null },
  site_minha_cidade: (a) => minhaCidade(a ?? {}),
}
