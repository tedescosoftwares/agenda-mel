// As cidades do guia no Google no modo demonstração (4.5): imita site_cidades() (migração 260) com números inventados.
// Cidades de verdade, datas e contagens de mentira: umas no ar há meses (aparecem desde o começo dos dados), umas no ar
// há semanas (começaram a aparecer alguns dias depois), as mais novas ainda esperando o Google.

const DIA = 86400e3
const hojeBr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const somar = (iso, n) => new Date(new Date(iso + 'T12:00:00Z').getTime() + n * DIA).toISOString().slice(0, 10)
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / DIA)

const R = {
  baixada: { slug: 'baixada-santista', nome: 'Baixada Santista' },
  vale: { slug: 'vale-do-paraiba', nome: 'Vale do Paraíba e Serra da Mantiqueira' },
  abc: { slug: 'abc-paulista', nome: 'ABC Paulista' },
  alto: { slug: 'alto-tiete', nome: 'Alto Tietê' },
}
// [nome, slug, região, salões, há quantos dias foi ao ar, dias até aparecer no Google (null: ainda não), dias até a 1ª visita pelo Google, força]
const CIDADES = [
  ['Santos', 'santos', R.baixada, 2298, 150, 2, 6, 9],
  ['Praia Grande', 'praia-grande', R.baixada, 2271, 150, 3, 8, 7],
  ['São Vicente', 'sao-vicente', R.baixada, 1453, 148, 3, 9, 5],
  ['Guarujá', 'guaruja', R.baixada, 1530, 140, 4, 10, 5],
  ['São José dos Campos', 'sao-jose-dos-campos', R.vale, 4153, 64, 9, 15, 8],
  ['Taubaté', 'taubate', R.vale, 1657, 60, 11, 19, 5],
  ['Jacareí', 'jacarei', R.vale, 1305, 58, 12, 23, 4],
  ['Santo André', 'santo-andre', R.abc, 3140, 13, 4, 8, 6],
  ['São Bernardo do Campo', 'sao-bernardo-do-campo', R.abc, 1950, 12, 5, 10, 5],
  ['Mauá', 'maua', R.abc, 1452, 14, 6, null, 3],
  ['Diadema', 'diadema', R.abc, 1210, 11, 8, null, 2],
  ['Rio Grande da Serra', 'rio-grande-da-serra', R.abc, 96, 10, null, null, 1],
  ['Mogi das Cruzes', 'mogi-das-cruzes', R.alto, 2093, 3, null, null, 4],
  ['Suzano', 'suzano', R.alto, 1648, 3, null, null, 3],
  ['Itaquaquecetuba', 'itaquaquecetuba', R.alto, 1533, 2, null, null, 3],
  ['Salesópolis', 'salesopolis', R.alto, 30, 2, null, null, 1],
]
const ATRASO_GSC = 3 // o Search Console chega com uns dias de atraso
const INICIO_GSC = 100 // há quantos dias começaram os dados do Search Console

// um sorteio que sempre dá o mesmo número para a mesma cidade e o mesmo dia
const sorte = (a, b) => { const x = Math.sin(a * 9301 + b * 49297) * 233280; return x - Math.floor(x) }

export function demoCidades({ dias_ } = {}) {
  const dias = Math.max(1, Math.min(Number(dias_) || 30, 180))
  const hoje = hojeBr()
  const de = somar(hoje, -(dias - 1))
  const gscPrimeiro = somar(hoje, -INICIO_GSC)
  const gscUltimo = somar(hoje, -ATRASO_GSC)
  const cidades = CIDADES.map(([cidade, slug, regiao, noAr, haDias, ateAparecer, ateVisita, forca], ci) => {
    const noArDesde = somar(hoje, -haDias)
    const aparecerReal = ateAparecer == null ? null : somar(noArDesde, ateAparecer)
    // o Search Console só mostra o que já chegou (atraso) e só desde que começou a guardar
    const primeiraAparicao = aparecerReal && aparecerReal <= gscUltimo ? (aparecerReal < gscPrimeiro ? gscPrimeiro : aparecerReal) : null
    const primeiraVisita = ateVisita == null ? null : somar(noArDesde, ateVisita)
    const ap = [], cl = [], go = [], vi = []
    for (let i = 0; i < dias; i++) {
      const dia = somar(de, i)
      const s = sorte(ci + 1, i + 1)
      const noArJa = dia >= noArDesde
      const apareceJa = primeiraAparicao && dia >= primeiraAparicao && dia <= gscUltimo
      const idade = primeiraAparicao ? Math.max(0, diasEntre(primeiraAparicao, dia)) : 0
      const a = apareceJa ? Math.round(forca * (6 + Math.min(idade, 60) * 1.6) * (0.6 + s * 0.8)) : 0
      ap.push(a)
      cl.push(apareceJa ? Math.round(a * (0.015 + s * 0.03)) : 0)
      const g = primeiraVisita && dia >= primeiraVisita ? Math.round(forca * (0.4 + Math.min(diasEntre(primeiraVisita, dia), 60) * 0.06) * (0.5 + s)) : 0
      go.push(g)
      vi.push(noArJa ? g + Math.round(forca * (0.8 + s * 2)) : 0)
    }
    const soma = (xs) => xs.reduce((t, x) => t + x, 0)
    const primeiroClique = (() => { for (let i = 0; i < dias; i++) if (cl[i] > 0) return somar(de, i); return primeiraAparicao && cl.some(Boolean) ? primeiraAparicao : null })()
    return {
      cidade_slug: slug, cidade, uf: 'SP', regiao,
      no_ar: noAr, no_ar_desde: noArDesde, ultimo_publicado: somar(hoje, -Math.min(haDias, (ci % 4) + 1)),
      primeira_aparicao: primeiraAparicao, primeiro_clique: primeiraAparicao ? (primeiroClique ?? somar(primeiraAparicao, 2)) : null,
      primeira_visita_google: primeiraVisita,
      aparicoes: soma(ap), cliques: soma(cl), visitas_google: soma(go), visitas: soma(vi),
      serie: { ap, cl, go, vi },
    }
  })
  return { dias, de, ate: hoje, gsc: { primeiro_dia: gscPrimeiro, ultimo_dia: gscUltimo }, cidades }
}
