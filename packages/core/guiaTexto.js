// A página de um salão do guia montada sem IA (3.10): de graça, na hora e
// sem inventar nada. Cada página sai diferente das outras porque é feita
// dos fatos daquele lugar (rua, bairro, horário, serviços, pagamento,
// acessibilidade) e da comparação com os outros salões da cidade ("abre
// aos domingos, coisa que só 9 dos 280 fazem"). O que é da categoria
// (dicas e perguntas sobre unhas, cílios...) vem de textos escritos à mão,
// e o sorteio pelo slug escolhe quais entram: a mesma página sai sempre
// igual, e páginas vizinhas saem diferentes.
//
// Sai no mesmo formato do texto da IA (conteudoSeguro), então a página
// pública, a revisão e o HTML estático não mudam. A IA continua como
// opção ("Reescrever com IA"), nunca obrigatória.
import { categoriaDoGuia, semAcento, slugificar, hora, faixaTexto, horariosEmUmaLinha, atributosEmTexto } from './guia.js'
// o bairro do Google vem sujo ('Sl 9 - Centro', 'Gaivota - Praia'); o texto usa o limpo (157)
import { bairroLimpo } from './guiaColecoes.js'

export const VERSAO_MONTADOR = 1

// ---- sorteio estável ---------------------------------------------------------------------
// FNV-1a + mulberry32: a mesma semente dá sempre a mesma sequência
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
  return { um, embaralhar, alguns: (xs, n) => embaralhar(xs).slice(0, n) }
}

// ---- texto ----------------------------------------------------------------------------------
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')
const juntarE = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}`)
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`
const minutos = (h) => { const [H, M] = String(h).split(':').map(Number); return H * 60 + M }
function cortar(t, max) {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  const corte = s.slice(0, max + 1)
  const fim = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('; '))
  if (fim > max * 0.6) return corte.slice(0, fim + 1).trim()
  return `${corte.slice(0, corte.lastIndexOf(' ')).replace(/[,;:\s]+$/, '')}…`
}
// corta por palavra, sem reticências e sem conectivo pendurado no fim ("... Capilar e")
function cortarSeco(t, max) {
  let x = String(t ?? '').replace(/\s+/g, ' ').trim()
  if (x.length <= max) return x
  x = x.slice(0, max + 1)
  x = x.slice(0, x.lastIndexOf(' ') > 0 ? x.lastIndexOf(' ') : max)
  return x.replace(/(\s+(e|de|da|do|das|dos|em|com|para|a|o|\||-|–|&))+$/i, '').replace(/[,;:\s|–-]+$/, '')
}
const primeiraQueCabe = (opcoes, max) => opcoes.find((o) => o && o.length <= max) ?? cortarSeco(opcoes.at(-1), max)

// o que o lugar é, sem artigo antes do nome (o nome pode ser de pessoa: "Ana Lash")
const O_QUE = {
  beleza: 'salão de beleza', cabelo: 'salão de cabeleireiro', unhas: 'espaço de manicure e unhas', cilios: 'estúdio de cílios',
  sobrancelhas: 'estúdio de sobrancelhas', estetica: 'espaço de estética', maquiagem: 'espaço de maquiagem',
}
const UM = { beleza: 'um', cabelo: 'um', unhas: 'um', cilios: 'um', sobrancelhas: 'um', estetica: 'um', maquiagem: 'um' }
const noBairro = (b) => (!b ? '' : /^centro$/i.test(b) ? 'no Centro' : `no bairro ${b}`)
const naRua = (e) => (!e ? '' : /^(largo|lgo\.?|beco|parque|p[aá]tio)\b/i.test(e) ? `no ${e}` : `na ${e}`)
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const ORDEM = [1, 2, 3, 4, 5, 6, 0]

// ---- o horário em fatos -------------------------------------------------------------------
export function fatosDoHorario(horarios) {
  if (!Array.isArray(horarios) || !horarios.length) return null
  const por = new Map(horarios.map((h) => [h.dia, h.faixas ?? []]))
  const abertos = ORDEM.filter((d) => por.get(d)?.length)
  if (!abertos.length) return null
  const aberturas = abertos.map((d) => minutos(por.get(d)[0][0]))
  const fechamentos = abertos.map((d) => minutos(por.get(d).at(-1)[1]))
  const comPausa = abertos.filter((d) => por.get(d).length > 1 && minutos(por.get(d)[0][1]) >= 660 && minutos(por.get(d)[1][0]) <= 900)
  // dias seguidos ("de terça a sábado")
  const seguidos = abertos.length > 1 && abertos.every((d, i) => i === 0 || ORDEM.indexOf(d) === ORDEM.indexOf(abertos[i - 1]) + 1)
  return {
    abertos,
    dias: abertos.length,
    sabado: por.get(6)?.length ? por.get(6) : null,
    domingo: por.get(0)?.length ? por.get(0) : null,
    segunda: !!por.get(1)?.length,
    abreCedo: Math.min(...aberturas),
    fechaTarde: Math.max(...fechamentos),
    diasQueAbremCedo: abertos.filter((_, i) => aberturas[i] === Math.min(...aberturas)),
    diasSoATarde: abertos.filter((_, i) => aberturas[i] >= 12 * 60),
    aberturaATarde: Math.min(...aberturas.filter((m) => m >= 12 * 60), 24 * 60),
    diasQueFechamTarde: abertos.filter((_, i) => fechamentos[i] === Math.max(...fechamentos)),
    pausa: comPausa.length ? { dias: comPausa, de: por.get(comPausa[0])[0][1], ate: por.get(comPausa[0])[1][0] } : null,
    intervalo: seguidos ? `de ${DIAS[abertos[0]]} a ${DIAS[abertos.at(-1)]}` : null,
    vinteQuatro: horarios.some((h) => (h.faixas ?? []).some(([a, b]) => a === '00:00' && b === '24:00')),
  }
}
// 'às segundas e aos sábados' | 'em todos os dias de atendimento' | 'em cinco dias da semana'
const NUMERAIS = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete']
const nosDias = (d) => (d === 0 ? 'aos domingos' : d === 6 ? 'aos sábados' : `às ${DIAS[d]}s`)
function quaisDias(lista, f) {
  if (lista.length === f.dias) return f.dias === 7 ? 'todos os dias' : 'em todos os dias de atendimento'
  if (lista.length <= 2) return juntarE(lista.map(nosDias))
  const seguidos = lista.every((d, i) => i === 0 || ORDEM.indexOf(d) === ORDEM.indexOf(lista[i - 1]) + 1)
  if (seguidos) return `de ${DIAS[lista[0]]} a ${DIAS[lista.at(-1)]}`
  if (lista.length === 3) return juntarE(lista.map(nosDias))
  return `em ${NUMERAIS[lista.length]} dias da semana`
}
const hm = (m) => hora(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)

// 'Av. Rui Barbosa, 308' e 'Avenida Rui Barbosa, 12' são a mesma rua
const ABREV = { r: 'rua', av: 'avenida', al: 'alameda', tv: 'travessa', estr: 'estrada', pca: 'praca', rod: 'rodovia', lgo: 'largo' }
function chaveDaRua(endereco) {
  const nome = String(endereco ?? '').split(',')[0].trim()
  if (!nome || /\d/.test(nome)) return ''
  const [primeira, ...resto] = slugificar(nome).split('-')
  return [ABREV[primeira] ?? primeira, ...resto].join('-')
}
const nomeDaRua = (endereco) => String(endereco ?? '').split(',')[0].trim()

// ---- a cidade em números (para comparar) ----------------------------------------------------
// lugares: todos os da cidade que não foram descartados (a Plataforma tem a lista inteira)
export function contextoDaCidade(lugares, cidadeSlug) {
  const da = (lugares ?? []).filter((l) => l && l.cidade_slug === cidadeSlug && !['descartado', 'removido'].includes(l.status))
  const comHorario = da.map((l) => fatosDoHorario(l.horarios)).filter(Boolean)
  const bairros = new Map()
  for (const l of da) {
    const b = slugificar(bairroLimpo(l.bairro) || l.bairro || '')
    if (!b) continue
    const x = bairros.get(b) ?? { total: 0, cat: {} }
    x.total++
    x.cat[l.categoria] = (x.cat[l.categoria] ?? 0) + 1
    bairros.set(b, x)
  }
  const ruas = new Map()
  for (const l of da) { const r = chaveDaRua(l.endereco); if (r) ruas.set(r, (ruas.get(r) ?? 0) + 1) }
  const cat = {}
  for (const l of da) cat[l.categoria] = (cat[l.categoria] ?? 0) + 1
  return {
    cidadeSlug,
    total: da.length,
    categorias: cat,
    bairros,
    ruas,
    comHorario: comHorario.length,
    domingo: comHorario.filter((f) => f.domingo).length,
    sabado: comHorario.filter((f) => f.sabado).length,
    semSegunda: comHorario.filter((f) => !f.segunda).length,
    abremAte: (m) => comHorario.filter((f) => f.abreCedo <= m).length,
    fechamDepois: (m) => comHorario.filter((f) => f.fechaTarde >= m).length,
  }
}

// ---- quanto dado a página tem -------------------------------------------------------------
// Página com pouco dado é página fina: o Google tende a ignorar (ou a achar
// cópia das outras). Ela pode ir ao ar, mas sem pedir para indexar.
export function dadosDaPagina(l) {
  const itens = [
    ['endereço', !!l?.endereco],
    ['bairro', !!l?.bairro],
    ['horário', Array.isArray(l?.horarios) && l.horarios.length > 0, 2],
    ['contato', !!(l?.telefone || l?.whatsapp || l?.instagram || l?.site)],
    ['serviços', (l?.servicos?.length ?? 0) > 0],
    ['pagamento, acessibilidade ou estacionamento', atributosEmTexto(l?.atributos).length > 0],
  ]
  const pontos = itens.reduce((s, [, tem, peso = 1]) => s + (tem ? peso : 0), 0)
  const max = itens.reduce((s, [, , peso = 1]) => s + peso, 0)
  const faltam = itens.filter(([, tem]) => !tem).map(([n]) => n)
  return { pontos, max, faltam, fina: pontos < 4 || !(Array.isArray(l?.horarios) && l.horarios.length) }
}

// ---- o que é da categoria (escrito à mão; nada sobre o lugar) -----------------------------
// dicas: ângulos com 5 itens (a página leva 4); requer: só entra se o lugar divulga o serviço
const DICAS = {
  beleza: [
    { id: 'primeira-visita', titulo: 'Primeira vez num salão novo', itens: [
      'Conte o que você já fez no cabelo e nas unhas nos últimos meses, principalmente química e coloração.',
      'Avise sobre alergia a produtos, esmaltes ou cosméticos antes de começar.',
      'Leve fotos do resultado que você quer e também do que você não quer.',
      'Pergunte quanto tempo o serviço leva e reserve uma folga na agenda do dia.',
      'Confirme o valor antes de começar, principalmente em serviços que dependem do comprimento do cabelo.',
    ] },
    { id: 'varios-servicos', titulo: 'Vários serviços numa ida só', itens: [
      'Ao marcar, peça os horários em sequência e diga a ordem que você prefere.',
      'Cabelo costuma vir antes das unhas: assim o esmalte não estraga na lavagem e na escova.',
      'Sobrancelha e depilação do rosto ficam melhores alguns dias antes de uma maquiagem de festa.',
      'Pergunte se dá para fazer dois serviços ao mesmo tempo, com profissionais diferentes.',
      'Para um dia longo de salão, leve um lanche e o carregador do celular.',
    ] },
    { id: 'datas-cheias', titulo: 'Datas cheias e antecedência', itens: [
      'Sábados, vésperas de feriado e dezembro costumam lotar: marque com antecedência.',
      'Para casamento ou formatura, faça um teste do penteado ou da maquiagem antes do dia.',
      'Química e coloração ficam melhores uma ou duas semanas antes da data, não na véspera.',
      'Se precisar desmarcar, avise o quanto antes: o horário fica livre para outra pessoa.',
      'Em cidade de praia, o verão e as férias também enchem a agenda dos salões.',
    ] },
  ],
  cabelo: [
    { id: 'corte', titulo: 'Para acertar no corte', itens: [
      'Leve fotos do corte que você quer e de um que você não quer.',
      'Vá com o cabelo do jeito que você usa no dia a dia, para quem corta ver o caimento.',
      'Conte quanto tempo você tem para arrumar o cabelo de manhã.',
      'Fale do seu histórico de química: progressiva, coloração e descoloração mudam o fio.',
      'Se quiser tirar pouco, mostre com os dedos o comprimento antes do primeiro corte.',
    ] },
    { id: 'quimica', titulo: 'Cor e química com segurança', itens: [
      'Peça um teste de mecha antes de mudar muito a cor ou de alisar.',
      'Tintura pode dar alergia: avise se já teve reação e pergunte sobre o teste de sensibilidade.',
      'Dê um intervalo entre uma química e outra; pergunte ao profissional quanto tempo esperar.',
      'Nos primeiros dias depois da coloração, prefira xampu para cabelo colorido e água morna.',
      'Confirme com o salão quais técnicas ele faz antes de marcar.',
    ] },
    { id: 'manutencao', titulo: 'Entre uma visita e outra', itens: [
      'Aparar as pontas de tempos em tempos ajuda o cabelo a crescer com menos pontas duplas.',
      'Retoque de raiz costuma ser feito a cada quatro a oito semanas, conforme o crescimento e a cor.',
      'Use protetor térmico antes de secador, escova e chapinha.',
      'Sol, cloro e água do mar ressecam os fios: enxágue com água doce depois da praia ou da piscina.',
      'Hidratação em casa entre as idas ao salão ajuda o resultado a durar.',
    ] },
  ],
  unhas: [
    { id: 'durar', titulo: 'Para o esmalte durar mais', itens: [
      'Nas primeiras horas, evite água quente e não use as unhas como ferramenta.',
      'Use luvas para lavar louça e fazer faxina: detergente e produto de limpeza soltam o esmalte.',
      'Óleo de cutícula todo dia deixa a unha e a pele em volta mais bonitas.',
      'Areia, sal e cloro desgastam o esmalte: depois da praia ou da piscina, lave e seque bem as mãos.',
      'Uma camada de extrabrilho no meio da semana ajuda a segurar o esmalte comum.',
    ] },
    { id: 'gel-fibra', titulo: 'Gel, fibra ou esmalte comum', itens: [
      'O esmalte comum dura menos, mas é fácil de trocar em casa.',
      'A esmaltação em gel seca na cabine de luz e costuma durar mais que o esmalte comum.',
      'Alongamento em gel ou fibra de vidro aumenta o comprimento e pede manutenção periódica.',
      'Não arranque o gel em casa: a remoção malfeita afina e enfraquece a unha.',
      'Confirme com o lugar quais técnicas ele faz e de quanto em quanto tempo é a manutenção.',
    ] },
    { id: 'higiene', titulo: 'Higiene e unha saudável', itens: [
      'Repare se os alicates saem de embalagem esterilizada, aberta na sua frente.',
      'Lixa e palito costumam ser de uso individual; se preferir, leve o seu kit.',
      'Avise se tiver alergia a esmalte, acetona ou ao material do gel.',
      'Mancha, unha descolando ou dor não são caso para esmalte: procure um médico ou podólogo.',
      'Se preferir, peça para tirar só o necessário da cutícula: tirar demais pode machucar.',
    ] },
  ],
  cilios: [
    { id: 'antes', titulo: 'Como chegar para a aplicação', itens: [
      'Vá sem maquiagem nos olhos e sem rímel.',
      'Quem usa lente de contato pode ter que tirar durante a aplicação: leve o estojo.',
      'Avise se tem alergia, olhos sensíveis ou alguma irritação nos olhos.',
      'Reserve tempo: a aplicação é demorada e os olhos ficam fechados o tempo todo.',
      'Leve uma foto do efeito que você quer e diga se prefere algo mais natural.',
    ] },
    { id: 'depois', titulo: 'Os cuidados depois', itens: [
      'Nas primeiras horas, evite molhar os cílios e fique longe de vapor e sauna.',
      'Não esfregue os olhos e evite dormir com o rosto apertado no travesseiro.',
      'Penteie os fios de leve, com uma escovinha limpa.',
      'Use demaquilante sem óleo perto dos olhos.',
      'Nunca puxe os fios: a remoção deve ser feita por quem aplica.',
    ] },
    { id: 'manutencao', titulo: 'Manutenção e remoção', itens: [
      'Os fios naturais caem e nascem o tempo todo, e a extensão cai junto com eles.',
      'Por isso a manutenção costuma ser feita a cada duas a quatro semanas.',
      'Se coçar, arder ou inchar, procure quem aplicou e, se continuar, um médico.',
      'Para tirar a extensão, volte ao estúdio: a remoção é feita com produto próprio.',
      'Uma pausa entre uma aplicação e outra ajuda os fios naturais a descansar.',
    ] },
  ],
  sobrancelhas: [
    { id: 'design', titulo: 'Como é o design', itens: [
      'Um bom design começa pelo desenho, antes de tirar qualquer fio.',
      'O formato deve acompanhar o seu rosto e os seus fios, não uma moda.',
      'Diga se você quer a sobrancelha mais natural ou mais marcada.',
      'Pinça, linha e cera chegam a resultados parecidos; a técnica muda o conforto e o tempo.',
      'Se a sua pele for sensível, pergunte qual técnica irrita menos.',
    ] },
    { id: 'crescer', titulo: 'Para deixar a sobrancelha crescer', itens: [
      'Pare de tirar fios em casa enquanto a sobrancelha cresce.',
      'Volte no intervalo que a designer indicar, para o desenho acompanhar o crescimento.',
      'Henna e coloração disfarçam as falhas enquanto os fios crescem.',
      'Tenha paciência: os fios levam algumas semanas para preencher o desenho.',
      'Conte se usa ácidos ou faz tratamento de pele antes de qualquer procedimento.',
    ] },
    { id: 'eventos', titulo: 'Para fotos e eventos', itens: [
      'Não faça o design na véspera: a pele pode ficar vermelha por algumas horas.',
      'De três a cinco dias antes do evento costuma ser um bom momento.',
      'Se for usar henna, faça um teste de sensibilidade antes.',
      'Combine o design com a maquiagem e os cílios que você vai usar.',
      'Evite esfoliação e ácidos na região logo depois do design.',
    ] },
  ],
  estetica: [
    { id: 'primeira-sessao', titulo: 'Como é a primeira sessão', itens: [
      'Espere uma conversa sobre a sua pele, a sua saúde e o que você quer melhorar.',
      'Avise sobre gestação, alergias, remédios e uso de ácidos na pele.',
      'Pergunte quem vai fazer o procedimento e qual a formação da profissional.',
      'Alguns tratamentos pedem mais de uma sessão; pergunte quantas antes de começar.',
      'Desconfie de promessa de resultado garantido.',
    ] },
    { id: 'depilacao', titulo: 'Depilação sem susto', requer: ['Depilação'], itens: [
      'Os pelos precisam de um tamanho mínimo para a cera pegar bem; pergunte qual ao marcar.',
      'No dia, vá com a pele limpa e sem creme ou óleo.',
      'Depois, evite sol, piscina e roupa apertada por algumas horas.',
      'Esfoliar a pele alguns dias depois ajuda a diminuir os pelos encravados.',
      'Se a pele for sensível, avise antes de começar.',
    ] },
    { id: 'sol', titulo: 'Pele, sol e verão', itens: [
      'Use protetor solar todo dia, inclusive depois de procedimentos no rosto.',
      'Alguns procedimentos pedem distância do sol por alguns dias; pergunte antes de marcar.',
      'Tratamentos mais agressivos costumam combinar mais com os meses de menos sol.',
      'Hidrate a pele depois da praia e da piscina.',
      'Mancha nova ou pinta que mudou é caso para dermatologista.',
    ] },
  ],
  maquiagem: [
    { id: 'evento', titulo: 'Para casamento e formatura', itens: [
      'Reserve com antecedência: datas de casamento e formatura lotam rápido.',
      'Se possível, faça uma prova antes do grande dia.',
      'Leve fotos de maquiagens de que você gosta e da roupa que vai usar.',
      'Combine o horário contando o tempo do cabelo e do deslocamento.',
      'Pergunte se a maquiadora atende no local do evento ou só no estúdio.',
    ] },
    { id: 'pele', titulo: 'Como preparar a pele', itens: [
      'Chegue com a pele limpa e hidratada.',
      'Não faça limpeza de pele nem procedimento novo na véspera.',
      'Faça a sobrancelha alguns dias antes, não no mesmo dia.',
      'Avise sobre alergia a cosméticos.',
      'Beba água e durma bem: a pele agradece no dia.',
    ] },
    { id: 'durar', titulo: 'Para a maquiagem durar', itens: [
      'No calor e na umidade do litoral, peça produtos de longa duração.',
      'Leve na bolsa papel absorvente, pó e o batom que foi usado.',
      'Evite passar a mão no rosto durante a festa.',
      'Para foto com flash, avise a maquiadora: alguns produtos refletem a luz.',
      'No fim do dia, um demaquilante adequado evita irritação.',
    ] },
  ],
}

// perguntas sobre o serviço (nunca sobre horário, endereço ou preço: essas saem dos dados)
const PERGUNTAS = {
  beleza: [
    ['Preciso marcar horário ou posso ir direto?', 'Depende do salão e do serviço. Serviços longos, como química, coloração e unhas em gel, quase sempre pedem horário marcado. Na dúvida, chame antes pelos canais do lugar.'],
    ['Quanto tempo leva uma ida ao salão?', 'Varia com o serviço: escova e manicure costumam levar perto de uma hora; coloração, mechas e alongamento de unhas podem passar de duas. Pergunte ao marcar para planejar o dia.'],
    ['O que contar no primeiro atendimento?', 'Fotos do resultado que você quer ajudam muito. Se tiver alergia a algum produto ou tiver feito química recentemente, conte antes de começar.'],
    ['Dá para fazer cabelo e unhas no mesmo dia?', 'Em salões que fazem os dois, sim. Peça os horários em sequência; em geral o cabelo vem primeiro, para a lavagem não estragar o esmalte.'],
    ['Como saber se um salão é bom?', 'Observe a higiene do espaço e dos materiais, se a profissional conversa antes de começar e se explica o que vai fazer. Fotos de trabalhos recentes, nas redes do salão, também ajudam.'],
  ],
  cabelo: [
    ['De quanto em quanto tempo devo cortar o cabelo?', 'Depende do corte e do objetivo. Cortes curtos perdem a forma mais rápido; quem quer deixar crescer costuma só aparar as pontas de tempos em tempos. Vale combinar com quem corta.'],
    ['Preciso lavar o cabelo antes de ir ao cabeleireiro?', 'Em geral, não. Para corte, muitos profissionais preferem ver o cabelo como você usa no dia a dia. Para coloração, há quem recomende não lavar no mesmo dia; pergunte ao marcar.'],
    ['Coloração estraga o cabelo?', 'Toda química mexe com o fio, mas os cuidados certos reduzem o dano: teste de mecha, intervalo entre químicas e hidratação em casa. Converse com o profissional sobre o estado do seu cabelo antes.'],
    ['Quanto tempo dura uma escova progressiva?', 'Costuma durar alguns meses, e o efeito vai saindo com as lavagens e o crescimento da raiz. Varia com o produto, o tipo de fio e os cuidados em casa; confirme com o salão quais produtos ele usa.'],
    ['O que fazer para a cor do cabelo durar mais?', 'Use xampu para cabelo colorido, lave com água morna ou fria, proteja os fios do sol e do cloro e, quando der, evite lavar todos os dias.'],
  ],
  unhas: [
    ['Quanto tempo dura uma esmaltação em gel?', 'Em geral, mais que o esmalte comum: muita gente faz a manutenção a cada duas ou três semanas. A duração muda com o crescimento da unha e o uso das mãos no dia a dia.'],
    ['Esmaltação em gel estraga a unha?', 'O que mais estraga é a remoção malfeita, arrancando o gel. Feita e removida do jeito certo, por quem aplicou, a unha sofre bem menos. Uma pausa de vez em quando também ajuda.'],
    ['Quanto tempo leva uma manicure?', 'Uma manicure com esmalte comum costuma levar perto de uma hora. Gel, alongamento e decoração levam mais. Pergunte ao marcar.'],
    ['Posso levar meu próprio esmalte e alicate?', 'Muitos lugares aceitam, e algumas clientes preferem levar o próprio kit. Vale perguntar ao marcar.'],
    ['Unha em gel ou fibra de vidro: qual escolher?', 'As duas alongam e reforçam a unha; a diferença está na técnica e no acabamento. A profissional pode indicar a melhor para o seu tipo de unha e a sua rotina. Confirme com o lugar qual ele faz.'],
  ],
  cilios: [
    ['Quanto tempo dura a extensão de cílios?', 'Os fios acompanham o ciclo dos cílios naturais, que caem e nascem o tempo todo. Por isso a manutenção costuma ser feita a cada duas a quatro semanas, conforme o seu ciclo e os cuidados em casa.'],
    ['Extensão de cílios estraga os cílios naturais?', 'Bem aplicada, com fios de peso adequado e sem cola na pele, não costuma estragar. O que mais prejudica é puxar os fios ou remover em casa.'],
    ['Posso molhar os cílios depois da aplicação?', 'Nas primeiras horas, o comum é evitar água e vapor. Depois, dá para lavar normalmente, com cuidado e sem esfregar. Siga a orientação de quem aplicou.'],
    ['Qual a diferença entre lash lifting e extensão?', 'O lash lifting curva e realça os seus próprios fios, sem colocar fios novos. A extensão aplica fios sintéticos sobre os naturais, aumentando volume e comprimento. Confirme com o estúdio qual técnica ele faz.'],
    ['Quanto tempo leva a aplicação de cílios?', 'Uma aplicação completa costuma levar de uma a duas horas ou mais, conforme a técnica e o volume. A manutenção é mais rápida.'],
  ],
  sobrancelhas: [
    ['De quanto em quanto tempo devo fazer a sobrancelha?', 'Muita gente refaz a cada duas a quatro semanas, mas varia com o crescimento dos fios. A designer pode indicar o melhor intervalo para você.'],
    ['Quanto tempo dura a henna na sobrancelha?', 'Na pele, a henna costuma durar alguns dias; nos fios, um pouco mais. A duração muda com o tipo de pele, a oleosidade e os produtos que você usa no rosto.'],
    ['Henna na sobrancelha pode dar alergia?', 'Pode, em algumas pessoas. Por isso vale fazer um teste de sensibilidade antes da primeira aplicação e avisar se já teve reação.'],
    ['Posso fazer a sobrancelha no dia de uma festa?', 'Melhor alguns dias antes: a região pode ficar vermelha ou sensível por algumas horas depois de tirar os fios.'],
    ['Design com pinça ou com linha: qual a diferença?', 'As duas técnicas tiram os fios pela raiz; a linha tira vários de uma vez e a pinça, um por um. O resultado depende mais do desenho que da técnica. Confirme com o lugar quais ele faz.'],
  ],
  estetica: [
    ['Quantas sessões um tratamento estético pede?', 'Depende do procedimento e do objetivo. A profissional costuma indicar o número de sessões na avaliação; desconfie de promessa de resultado numa sessão só.'],
    ['Posso fazer procedimento estético grávida?', 'Muitos procedimentos não são indicados na gestação. Avise sempre antes de qualquer sessão e, na dúvida, converse com o seu médico.'],
    ['Posso tomar sol depois de uma limpeza de pele?', 'O comum é evitar o sol nos dias seguintes e usar protetor solar. Siga a orientação de quem fez o procedimento.'],
    ['Qual o tamanho certo do pelo para depilar com cera?', 'Os pelos precisam de um comprimento mínimo para a cera conseguir puxá-los. Pergunte ao marcar qual tamanho o lugar recomenda.'],
    ['Como escolher um espaço de estética?', 'Pergunte quem faz cada procedimento e qual a formação, observe a higiene e o material descartável e desconfie de resultado garantido.'],
  ],
  maquiagem: [
    ['Com quanto tempo de antecedência devo reservar a maquiagem?', 'Para casamentos e formaturas, quanto antes melhor, porque as datas mais procuradas lotam. Para uma festa comum, alguns dias costumam bastar.'],
    ['Vale a pena fazer prova de maquiagem?', 'Para casamento e datas importantes, sim: a prova ajuda a acertar o estilo, testar os produtos na sua pele e evitar surpresa no dia.'],
    ['Quanto tempo leva uma maquiagem profissional?', 'Em geral, de quarenta minutos a uma hora e meia, conforme o estilo. Combine o horário contando o tempo do cabelo e do deslocamento.'],
    ['A maquiagem aguenta o calor?', 'Com a pele bem preparada e produtos de longa duração, aguenta bem mais. Leve itens para retoque e avise a maquiadora se o evento for ao ar livre ou na praia.'],
    ['Preciso ir de pele limpa para a maquiagem?', 'Sim, de preferência limpa e hidratada, sem maquiagem. Avise sobre alergias e sobre procedimentos recentes no rosto.'],
  ],
}

// ---- as frases que saem dos fatos ---------------------------------------------------------
function frasesDoHorario(f, ctx, s) {
  if (!f) return []
  const out = []
  const n = ctx?.comHorario ?? 0
  const temCidade = n >= 10
  if (f.vinteQuatro) out.push('O horário divulgado é de atendimento 24 horas, o que vale confirmar antes de ir de madrugada.')
  // dias
  if (f.dias === 7) out.push(s.um(['Abre todos os dias da semana, inclusive aos domingos.', 'Atende os sete dias da semana, domingo incluído.']))
  else if (f.intervalo) out.push(s.um([`Atende ${f.intervalo}.`, `O atendimento vai ${f.intervalo}.`, `A semana de atendimento vai ${f.intervalo}.`, `Funciona ${f.intervalo}.`]))
  else out.push(`Atende ${plural(f.dias, 'dia', 'dias')} por semana: ${juntarE(f.abertos.map((d) => DIAS[d]))}.`)
  // domingo (raro) e sábado
  if (f.domingo) {
    const raro = temCidade && ctx.domingo / n < 0.25
    if (raro) out.push(s.um([
      `O domingo (${faixaTexto(f.domingo)}) é o diferencial: dos ${n} endereços de beleza com horário divulgado que a MIMO mapeou na cidade, só ${ctx.domingo} abrem nesse dia.`,
      `Abre aos domingos, ${faixaTexto(f.domingo)}, coisa rara na cidade: só ${ctx.domingo} dos ${n} salões com horário divulgado no levantamento da MIMO fazem isso.`,
    ]))
    else if (f.dias < 7) out.push(`Abre também aos domingos, ${faixaTexto(f.domingo)}.`)
  }
  if (f.sabado) {
    const ate = minutos(f.sabado.at(-1)[1])
    out.push(ate >= 17 * 60
      ? s.um([`No sábado, o atendimento segue o dia todo: ${faixaTexto(f.sabado)}.`, `Sábado tem horário cheio, das ${faixaTexto(f.sabado)}.`, `O sábado não é meio período: vai das ${faixaTexto(f.sabado)}.`])
      : s.um([`No sábado, abre das ${faixaTexto(f.sabado)}.`, `Aos sábados, o horário é mais curto: ${faixaTexto(f.sabado)}.`, `O sábado vai das ${faixaTexto(f.sabado)}.`]))
  } else if (temCidade) {
    out.push(s.um(['Não abre aos sábados, pelo horário divulgado.', `Sábado não está no horário divulgado, ao contrário de ${ctx.sabado} dos ${n} salões da cidade.`]))
  }
  // cedo, tarde e almoço, comparando com a cidade (a ordem também varia)
  const extras = []
  const cedo = quaisDias(f.diasQueAbremCedo, f)
  const tarde = quaisDias(f.diasQueFechamTarde, f)
  if (f.abreCedo <= 8 * 60 && temCidade) {
    const tao = ctx.abremAte(f.abreCedo)
    extras.push(tao / n < 0.35
      ? s.um([
        `Começa cedo, às ${hm(f.abreCedo)} ${cedo}: só ${tao} dos ${n} salões com horário divulgado na cidade abrem a essa hora ou antes.`,
        `Abre às ${hm(f.abreCedo)} ${cedo}, antes da maior parte dos salões da cidade (só ${tao} de ${n} abrem tão cedo).`,
        `Para quem precisa resolver antes do trabalho, abre às ${hm(f.abreCedo)} ${cedo}, horário de só ${tao} dos ${n} salões mapeados com horário.`,
      ])
      : s.um([`${cap(cedo)}, abre às ${hm(f.abreCedo)}, bom para quem quer resolver antes do trabalho.`, `A porta abre às ${hm(f.abreCedo)} ${cedo}.`]))
  }
  if (f.fechaTarde >= 19 * 60 + 30 && !f.vinteQuatro) {
    const quantos = temCidade ? ctx.fechamDepois(f.fechaTarde) : null
    extras.push(quantos != null && quantos / n < 0.3
      ? s.um([
        `Fica aberto até as ${hm(f.fechaTarde)} ${tarde}, mais tarde que a maioria: ${quantos} dos ${n} salões com horário divulgado atendem até essa hora.`,
        `${cap(tarde)}, vai até as ${hm(f.fechaTarde)}; na cidade, só ${quantos} de ${n} salões com horário divulgado atendem tão tarde.`,
      ])
      : s.um([`${cap(tarde)}, atende até as ${hm(f.fechaTarde)}, o que ajuda quem sai tarde do trabalho.`, `O horário vai até as ${hm(f.fechaTarde)} ${tarde}.`]))
  }
  if (f.diasSoATarde.length >= 2) extras.push(s.um([
    `${cap(quaisDias(f.diasSoATarde, f))}, o atendimento é só à tarde: abre a partir das ${hm(f.aberturaATarde)}.`,
    `Quem pensa em ir de manhã precisa olhar o dia: ${quaisDias(f.diasSoATarde, f)}, só abre a partir das ${hm(f.aberturaATarde)}.`,
  ]))
  if (f.pausa) extras.push(s.um([
    `Faz pausa para o almoço, das ${hora(f.pausa.de)} às ${hora(f.pausa.ate)}${f.pausa.dias.length < f.dias ? ' em alguns dias' : ''}: vale contar com isso ao marcar.`,
    `Entre ${hora(f.pausa.de)} e ${hora(f.pausa.ate)}${f.pausa.dias.length < f.dias ? ', em alguns dias,' : ''} a porta fecha para o almoço.`,
  ]))
  if (!f.segunda && f.dias >= 4 && f.dias < 7 && temCidade && ctx.semSegunda / n > 0.3) extras.push(s.um(['Fecha às segundas, como boa parte dos salões da cidade.', `Segunda é dia de folga, como em ${ctx.semSegunda} dos ${n} salões com horário divulgado na cidade.`]))
  return [...out, ...s.embaralhar(extras)]
}

function fraseDoBairro(l, ctx, cat, s) {
  const out = []
  const r = chaveDaRua(l.endereco)
  const naMesmaRua = r ? (ctx?.ruas?.get(r) ?? 1) - 1 : 0
  if (naMesmaRua >= 2) out.push(s.um([
    `Só ${naRua(nomeDaRua(l.endereco))}, a MIMO mapeou outros ${naMesmaRua} endereços de beleza.`,
    `${cap(naRua(nomeDaRua(l.endereco)))} há outros ${naMesmaRua} endereços de beleza no levantamento da MIMO.`,
  ]))
  const b = ctx?.bairros?.get(slugificar(l.bairro || ''))
  if (b && b.total >= 3) {
    const mesma = (b.cat[l.categoria] ?? 1) - 1
    const outros = b.total - 1
    const deles = mesma > 1 ? `, ${mesma} deles de ${cat.plural}` : mesma === 1 ? ', um deles do mesmo ramo' : ''
    const qtd = plural(outros, 'endereço de beleza', 'endereços de beleza')
    out.push(out.length
      ? s.um([`No bairro ${l.bairro} inteiro, são outros ${qtd}${deles}.`, `Somando o bairro ${l.bairro}, são outros ${qtd}${deles}.`])
      : s.um([
        `No levantamento da MIMO, o bairro ${l.bairro} tem outros ${qtd}${deles}.`,
        `${cap(noBairro(l.bairro))}, a MIMO mapeou outros ${qtd}${deles}.`,
      ]))
  }
  return out.join(' ') || null
}

function fraseDosAtributos(l, s) {
  const a = atributosEmTexto(l.atributos)
  if (!a.length) return null
  const partes = []
  const pag = a.find((x) => x.campo === 'pagamento')
  if (pag) partes.push(pag.texto === 'só dinheiro' ? 'recebe só em dinheiro' : `aceita ${pag.texto}`)
  const ace = a.find((x) => x.campo === 'acessibilidade')
  if (ace) partes.push(`tem ${ace.texto}`)
  const est = a.find((x) => x.campo === 'estacionamento')
  if (est) partes.push(`o estacionamento é ${est.texto}`)
  if (l.atributos?.criancas === true) partes.push('é um lugar indicado para ir com crianças')
  if (!partes.length) return null
  return `${s.um(['Pelas informações públicas do estabelecimento,', 'Segundo as informações públicas do lugar,', 'Pelo que o lugar divulga,'])} ${juntarE(partes)}.`
}

function fraseDoContato(l, s) {
  const canais = []
  if (l.whatsapp) canais.push('WhatsApp')
  else if (l.telefone) canais.push('telefone')
  if (l.instagram) canais.push(`Instagram (@${String(l.instagram).replace(/^@/, '')})`)
  else if (l.site) canais.push('site próprio')
  if (!canais.length) return null
  return s.um([
    `Para tirar dúvidas e marcar, o contato divulgado é por ${juntarE(canais)}.`,
    `O contato que o lugar divulga é por ${juntarE(canais)}.`,
    `Dá para falar com o lugar por ${juntarE(canais)}, ${canais.length > 1 ? 'os canais que ele divulga' : 'o canal que ele divulga'}.`,
  ])
}

// o serviço que já é a própria categoria não vale uma frase ("cabeleireiro... divulga cabelo")
const SERVICO_DA_CATEGORIA = { cabelo: 'Cabelo', unhas: 'Manicure', cilios: 'Cílios', sobrancelhas: 'Sobrancelha', estetica: 'Estética', maquiagem: 'Maquiagem' }
function fraseDosServicos(l, cat, s) {
  const sv = (l.servicos ?? []).filter((x) => x !== SERVICO_DA_CATEGORIA[cat.slug]).map((x) => x.toLowerCase())
  const todos = (l.servicos ?? []).map((x) => x.toLowerCase())
  if (todos.length >= 2) return s.um([
    `Pelo que o próprio lugar divulga, o atendimento inclui ${juntarE(todos.slice(0, 6))}.`,
    `Os serviços que ele divulga: ${juntarE(todos.slice(0, 6))}.`,
    `Além de ${todos[0]}, o lugar divulga ${juntarE(todos.slice(1, 6))}.`,
  ])
  if (sv.length === 1) return `O serviço que o lugar mais divulga é ${sv[0]}.`
  return null
}

// ---- a página -------------------------------------------------------------------------------
export function montarConteudo(lugar, ctx = null, agora = new Date()) {
  const l = { ...lugar, bairro: bairroLimpo(lugar.bairro) || lugar.bairro }
  const cat = categoriaDoGuia(l.categoria)
  const s = sorteio(`${l.cidade_slug}/${l.slug}`)
  const oQue = O_QUE[cat.slug] ?? O_QUE.beleza
  const um = UM[cat.slug] ?? 'um'
  const ondeCurto = l.bairro ? noBairro(l.bairro) : `em ${l.cidade}`
  const f = fatosDoHorario(l.horarios)
  const dados = dadosDaPagina(l)
  const rua = naRua(l.endereco)

  // 1º parágrafo: o que é e onde fica (quatro jeitos de começar)
  const local = [rua, l.bairro ? noBairro(l.bairro) : ''].filter(Boolean).join(', ')
  const aberturas = [
    `${l.nome} atende como ${oQue} ${local ? `${local}, ` : ''}em ${l.cidade}${l.uf ? ` (${l.uf})` : ''}.`,
    `${local ? `${cap(local)}, em ${l.cidade}, ` : `Em ${l.cidade}, `}fica ${l.nome}, ${um} ${oQue}.`,
    `Quem procura ${cat.busca} em ${l.cidade} encontra ${l.nome} ${local || `na cidade`}.`,
    `${l.nome}: ${um} ${oQue} ${l.bairro ? noBairro(l.bairro) : ''}${l.bairro ? ', ' : ''}em ${l.cidade}${rua ? `, ${rua}` : ''}.`,
  ]
  const p1 = [s.um(aberturas), fraseDosServicos(l, cat, s), l.atributos?.tipo_google && !semAcento(l.atributos.tipo_google).includes(semAcento(cat.singular))
    ? `No Google, o lugar aparece na categoria ${l.atributos.tipo_google.toLowerCase()}.` : null].filter(Boolean)

  // 2º: o horário, comparado com a cidade
  const p2 = frasesDoHorario(f, ctx, s)

  // 3º: o bairro, pagamento e acessibilidade, contato
  const p3 = [...s.embaralhar([fraseDoBairro(l, ctx, cat, s), fraseDosAtributos(l, s)]), l.na_mimo
    ? `${l.nome} agenda pela MIMO: dá para escolher o serviço, o dia e o horário online.`
    : fraseDoContato(l, s),
  s.um(['Serviços, preços e horários mudam: confirme direto com o lugar antes de ir.', 'Antes de ir, vale confirmar serviços, preços e horário direto com o lugar.', 'Como serviços e horários mudam, confirme com o lugar antes de sair de casa.'])].filter(Boolean)

  const sobre = [p1, p2, p3].map((p) => p.join(' ')).filter((p) => p.length > 0)
  // com pouco dado, dois parágrafos curtos leem melhor que três
  if (sobre.length === 3 && sobre[1].length < 90) sobre.splice(0, 2, `${sobre[0]} ${sobre[1]}`)

  // destaques: o que distingue este lugar, nunca elogio
  const candidatos = []
  if (f?.dias === 7) candidatos.push([3, { titulo: 'Abre todos os dias', texto: `Inclusive aos domingos: ${faixaTexto(f.domingo)}.` }])
  if (f?.domingo && f.dias < 7) candidatos.push([3, { titulo: 'Abre aos domingos', texto: cortar(`Domingo, ${faixaTexto(f.domingo)}. ${ctx?.comHorario >= 10 ? `Só ${ctx.domingo} dos ${ctx.comHorario} salões com horário divulgado na cidade abrem nesse dia.` : ''}`, 170) }])
  if (f && f.abreCedo <= 8 * 60) candidatos.push([2, { titulo: 'Começa cedo', texto: `${cap(quaisDias(f.diasQueAbremCedo, f))}, abre às ${hm(f.abreCedo)}.` }])
  if (f && f.fechaTarde >= 19 * 60 + 30 && !f.vinteQuatro) candidatos.push([2, { titulo: 'Atende até mais tarde', texto: `${cap(quaisDias(f.diasQueFechamTarde, f))}, vai até as ${hm(f.fechaTarde)}.` }])
  if (f?.sabado && !f.domingo) candidatos.push([1, { titulo: 'Abre aos sábados', texto: `Sábado, ${faixaTexto(f.sabado)}.` }])
  if ((l.servicos?.length ?? 0) >= 3) candidatos.push([2, { titulo: 'Vários serviços', texto: cortar(`${cap(juntarE(l.servicos.slice(0, 5).map((x) => x.toLowerCase())))} no mesmo endereço, pelo que o lugar divulga.`, 170) }])
  const at = atributosEmTexto(l.atributos)
  const ace = at.find((x) => x.campo === 'acessibilidade')
  if (ace) candidatos.push([2, { titulo: 'Acessibilidade', texto: cortar(`${cap(ace.texto)}, segundo as informações públicas do lugar.`, 170) }])
  const pag = at.find((x) => x.campo === 'pagamento')
  if (pag) candidatos.push([1, { titulo: 'Formas de pagamento', texto: cortar(pag.texto === 'só dinheiro' ? 'Recebe só em dinheiro, pelo que o lugar divulga.' : `${cap(pag.texto)}, pelo que o lugar divulga.`, 170) }])
  const est = at.find((x) => x.campo === 'estacionamento')
  if (est) candidatos.push([1, { titulo: 'Estacionamento', texto: `${cap(est.texto)}, pelo que o lugar divulga.` }])
  if (l.bairro && l.endereco) candidatos.push([0, { titulo: noBairro(l.bairro).replace(/^no /, 'No '), texto: cortar(`${l.endereco}, ${l.bairro}, ${l.cidade}${l.cep ? `, CEP ${l.cep}` : ''}.`, 170) }])
  const destaques = s.embaralhar(candidatos).sort((a, b) => b[0] - a[0]).slice(0, 4).map(([, d]) => d)

  // dicas: um ângulo da categoria, 4 dos 5 itens
  const angulos = (DICAS[cat.slug] ?? DICAS.beleza).filter((a) => !a.requer || a.requer.some((r) => (l.servicos ?? []).includes(r)))
  const angulo = s.um(angulos)
  const itens = s.alguns(angulo.itens.map((t, i) => [i, t]), 4).sort((a, b) => a[0] - b[0]).map(([, t]) => t)

  // perguntas da categoria: 3 das 5 (as de horário, endereço e marcação saem dos dados)
  const faq = s.alguns(PERGUNTAS[cat.slug] ?? PERGUNTAS.beleza, 3).map(([pergunta, resposta]) => ({ pergunta, resposta }))

  // título e descrição para o Google
  const bairroOuCidade = l.bairro ? `${noBairro(l.bairro)}, ${l.cidade}` : `em ${l.cidade}`
  const seo_title = primeiraQueCabe(s.embaralhar([
    `${l.nome}: ${cat.busca} ${bairroOuCidade}`,
    `${l.nome} | ${cap(cat.busca)} em ${l.cidade}`,
    `${l.nome}, ${cat.busca} em ${l.cidade}`,
  ]).concat([`${l.nome}: ${cat.busca} em ${l.cidade}`, `${l.nome} em ${l.cidade}`, l.nome]), 60)
  const fatoCurto = f?.dias === 7 ? 'Abre todos os dias.' : f?.domingo ? 'Abre aos domingos.' : f?.intervalo ? `Atende ${f.intervalo}.` : f?.sabado ? 'Abre aos sábados.' : ''
  const extras = [pag ? 'formas de pagamento' : '', l.servicos?.length ? 'serviços' : ''].filter(Boolean)
  const comeco = `${l.nome}, ${oQue} ${ondeCurto}${l.bairro ? `, ${l.cidade}` : ''}.`
  const meta_description = primeiraQueCabe([
    `${comeco} ${fatoCurto} ${juntarE(['Endereço', 'horário', ...extras, 'como marcar'])}.`,
    `${comeco} ${fatoCurto} Endereço, horário e como marcar.`,
    `${comeco} Endereço, horário e como marcar.`,
    `${comeco} ${fatoCurto}`,
    comeco,
  ].map((t) => t.replace(/\s+/g, ' ').trim()), 155)
  const chamada = primeiraQueCabe([
    `${cap(oQue)} ${ondeCurto}${l.bairro ? `, em ${l.cidade}` : ''}. ${fatoCurto}`.trim(),
    `${cap(oQue)} ${ondeCurto}${l.bairro ? `, em ${l.cidade}` : ''}.`,
  ], 140)
  const linha = horariosEmUmaLinha(l.horarios)
  const resumo = primeiraQueCabe([
    `${cap(oQue)} ${[rua, l.bairro ? noBairro(l.bairro) : ''].filter(Boolean).join(', ')}.${linha ? ` ${linha}.` : ''}`,
    `${cap(oQue)} ${ondeCurto}.${linha ? ` ${linha}.` : ''}`,
    `${cap(oQue)} ${ondeCurto}.`,
  ], 170)

  return {
    seo_title, meta_description, chamada, resumo, sobre, destaques,
    dicas: { titulo: angulo.titulo, itens },
    faq,
    _meta: { modelo: 'montado', versao: VERSAO_MONTADOR, angulo: angulo.id, gerado_em: agora.toISOString(), fina: dados.fina, dados: `${dados.pontos}/${dados.max}` },
  }
}
