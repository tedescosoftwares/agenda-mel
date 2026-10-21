// O site ao vivo no modo demonstração (3.44): imita site_ao_vivo() (migração 192) com visitantes de mentira que entram,
// andam pelas páginas e saem com o relógio (um ciclo de 20 minutos), e soma as batidas de verdade do demo
// (demoPresenca, chamada por src/lib/presenca.js quando alguém abre o site no modo demo).

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
// [começa (s no ciclo), dura (s), origem, ref, utm, aparelho, sistema, navegador, tela, cidade, fonte, trajeto]
const MOLDES = [
  [0, 420, 'google', 'www.google.com', null, 'celular', 'Android 14', 'Chrome', '412x915', 'itanhaem', 'ip', ['/saloes/itanhaem/unhas', '/saloes/itanhaem/studio-lirio', '/saloes/itanhaem/unhas', '/saloes/itanhaem/cabelo']],
  [40, 300, 'instagram', 'l.instagram.com', { source: 'instagram', campaign: 'natal' }, 'celular', 'iOS 18', 'Instagram', '393x852', 'santos', 'ip', ['/saloes/itanhaem', '/saloes/itanhaem/atelie-cabelo-e-arte']],
  [90, 600, 'google', 'www.google.com', null, 'celular', 'Android 13', 'Samsung Internet', '384x854', 'itanhaem', 'gps', ['/saloes/itanhaem', '/saloes/itanhaem/unhas', '/saloes/itanhaem/studio-lirio']],
  [150, 240, 'direto', null, null, 'computador', 'Windows', 'Chrome', '1920x1080', 'saopaulo', 'ip', ['/', '/sistema-para-salao-de-beleza', '/planos']],
  [220, 500, 'whatsapp', null, null, 'celular', 'Android 12', 'Chrome', '360x800', 'mongagua', 'gps', ['/saloes/mongagua', '/saloes/regiao/baixada-santista']],
  [300, 180, 'facebook', 'l.facebook.com', null, 'celular', 'Android 11', 'Facebook', '360x780', 'praiagrande', 'ip', ['/blog/como-escolher-salao', '/saloes/itanhaem']],
  [380, 360, 'google', 'www.google.com', null, 'tablet', 'iPadOS', 'Safari', '820x1180', 'peruibe', 'ip', ['/saloes/regiao/baixada-santista', '/saloes/itanhaem', '/saloes/itanhaem/cabelo']],
  [520, 420, 'bing', 'www.bing.com', null, 'computador', 'macOS', 'Safari', '1440x900', 'saopaulo', 'ip', ['/sistema-para-salao-de-beleza', '/']],
  [640, 300, 'google', 'www.google.com', null, 'celular', 'iOS 17', 'Safari', '390x844', 'itanhaem', 'ip', ['/saloes/itanhaem/studio-lirio']],
  [760, 540, 'instagram', 'l.instagram.com', null, 'celular', 'Android 14', 'Instagram', '412x892', 'santos', 'ip', ['/saloes/itanhaem', '/saloes/itanhaem/unhas', '/saloes/itanhaem/studio-lirio']],
  [900, 240, 'outro', 'guiadolitoral.com.br', null, 'computador', 'Windows', 'Edge', '1366x768', 'santos', 'ip', ['/saloes/regiao/baixada-santista']],
  [1000, 480, 'google', 'www.google.com', null, 'celular', 'Android 14', 'Chrome', '412x915', 'mongagua', 'ip', ['/saloes/mongagua', '/saloes/itanhaem/unhas']],
]
const CICLO = 1200
const PASSO_S = 70 // cada visitante de mentira troca de página a cada ~70 s
const T0 = Math.floor(Date.now() / 1000) - 600 // o demo abre no meio do ciclo, já com gente no site

const iso = (s) => new Date(s * 1000).toISOString()
const REAIS = new Map() // as batidas de verdade do demo (uma visita por aba aberta)

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
function deMentira(agora) {
  const out = []
  const t = ((agora - T0) % CICLO + CICLO) % CICLO
  const voltaIni = agora - t
  MOLDES.forEach((m, i) => {
    const [comeca, dura, origem, ref, utm, dispositivo, sistema, navegador, tela, cid, fonte, rota] = m
    for (const volta of [voltaIni, voltaIni - CICLO]) {
      const inicio = volta + comeca
      const fim = inicio + dura
      if (agora < inicio || agora > fim + 600) continue
      const vivo = Math.min(agora, fim)
      const passos = Math.min(rota.length, 1 + Math.floor((vivo - inicio) / PASSO_S))
      const trajeto = rota.slice(0, passos).map((p, k) => ({ p, t: k * PASSO_S }))
      const pagina = trajeto.at(-1).p
      const c = CIDADES[cid]
      out.push({
        id: 1000 + i * 10 + (volta === voltaIni ? 0 : 1), inicio_em: iso(inicio), visto_em: iso(agora <= fim ? agora - (agora - inicio) % 25 : fim),
        saiu_em: agora > fim ? iso(fim) : null, pagina, titulo: TITULOS[pagina] ?? null, entrada: rota[0], paginas: passos, trajeto,
        origem, ref, utm, dispositivo, sistema, navegador, tela, idioma: 'pt-BR', cidade: c.cidade, uf: c.uf, bairro: null, local_fonte: fonte,
        lat: fonte === 'gps' ? +(c.lat + 0.004 * (i % 3)).toFixed(3) : c.lat, lng: fonte === 'gps' ? +(c.lng - 0.003 * (i % 2)).toFixed(3) : c.lng,
      })
    }
  })
  for (const v of REAIS.values()) {
    out.push({ id: v.id, inicio_em: iso(v.inicio), visto_em: iso(v.visto), saiu_em: v.saiu ? iso(v.saiu) : null, pagina: v.pagina, titulo: v.titulo, entrada: v.entrada,
      paginas: v.trajeto.length, trajeto: v.trajeto, origem: v.origem, ref: v.ref, utm: v.utm, dispositivo: v.dispositivo, sistema: v.sistema, navegador: v.navegador,
      tela: v.tela, idioma: v.idioma, cidade: v.cidade, uf: v.uf, bairro: null, local_fonte: v.local_fonte, lat: v.lat, lng: v.lng })
  }
  return out
}

const contar = (lista, chave, rotulo = chave) => {
  const m = new Map()
  for (const x of lista) { const k = x[chave] ?? 'outro'; m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m].map(([k, n]) => ({ [rotulo]: k, n })).sort((a, b) => b.n - a.n)
}

export function demoAoVivo() {
  const agora = Math.floor(Date.now() / 1000)
  const todos = deMentira(agora)
  const ms = (x) => new Date(x).getTime() / 1000
  const trinta = todos.filter((v) => ms(v.visto_em) > agora - 1800)
  const ativos = trinta.filter((v) => ms(v.visto_em) > agora - 75 && !v.saiu_em).sort((a, b) => b.visto_em.localeCompare(a.visto_em))
  const recentes = trinta.filter((v) => !ativos.includes(v) && ms(v.visto_em) > agora - 600).sort((a, b) => b.visto_em.localeCompare(a.visto_em))
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
  return {
    agora: iso(agora),
    no_site: ativos.length,
    ultimos_30: trinta.length,
    minutos,
    ativos,
    recentes: recentes.slice(0, 30),
    paginas_agora: [...paginas.values()].sort((a, b) => b.n - a.n),
    origens: contar(trinta, 'origem'),
    dispositivos: contar(trinta, 'dispositivo'),
    cidades: porCidade(trinta),
    hoje: {
      visitas: 180 + trinta.length, paginas: 612 + trinta.reduce((s, v) => s + v.paginas, 0), tempo_medio_s: 154,
      por_hora: Array.from({ length: 24 }, (_, h) => ({ h, n: h > hora ? 0 : Math.round(4 + 10 * Math.sin((h / 24) * Math.PI) ** 2 + (h % 5)) })),
      origens: [{ origem: 'google', n: 96 }, { origem: 'instagram', n: 41 }, { origem: 'direto', n: 22 }, { origem: 'whatsapp', n: 14 }, { origem: 'facebook', n: 7 }],
      dispositivos: [{ dispositivo: 'celular', n: 151 }, { dispositivo: 'computador', n: 24 }, { dispositivo: 'tablet', n: 5 }],
      navegadores: [{ navegador: 'Chrome', n: 88 }, { navegador: 'Safari', n: 37 }, { navegador: 'Instagram', n: 29 }, { navegador: 'Samsung Internet', n: 18 }, { navegador: 'Facebook', n: 8 }],
      cidades: [{ cidade: 'Itanhaém', uf: 'SP', n: 71 }, { cidade: 'São Paulo', uf: 'SP', n: 38 }, { cidade: 'Santos', uf: 'SP', n: 29 }, { cidade: 'Mongaguá', uf: 'SP', n: 18 }, { cidade: 'Peruíbe', uf: 'SP', n: 9 }],
      entradas: [{ pagina: '/saloes/itanhaem/unhas', n: 44 }, { pagina: '/saloes/itanhaem', n: 39 }, { pagina: '/saloes/itanhaem/studio-lirio', n: 21 }, { pagina: '/', n: 17 }],
    },
    geo: { carregado_em: new Date(Date.now() - 3 * 86400e3).toISOString(), versao: '2026-10', faixas: 412515 },
  }
}

export const AO_VIVO_RPC = {
  site_ao_vivo: () => demoAoVivo(),
  site_presenca: (a) => { demoPresenca(a); return null },
}
