// O panorama da cidade (3.22): o que a lista da página mostra, em frases e em perguntas, montado
// na hora a partir dos próprios dados. Diferente do texto da IA, aqui os números são exatos,
// porque saem da lista que a página exibe: no site, da RPC; no HTML estático, da regeneração
// (que acontece a cada mudança publicada). Assim a página de cada cidade tem um trecho que só
// serve para ela e que não envelhece: bairros com mais lugares, categorias, quem abre no
// domingo e à noite, quem já agenda pela MIMO e os serviços mais divulgados.
//
//   panoramaDaCidade({ cidade, categoria, lugares, completos })
//     lugares    a lista da página (os cartões: bairro, categoria, servicos, selecao, na_mimo)
//     completos  a lista inteira da cidade COM horários, quando houver (as coleções trazem; o
//                HTML estático tem tudo). Sem ela, o panorama não fala de horário.
//   -> { paragrafos: string[], faq: [{ pergunta, resposta }], numeros }
import { GUIA_CATEGORIAS, categoriaDoGuia, semAcento } from './guia.js'
import { perfilDoHorario } from './guiaColecoes.js'

const num = (n) => Number(n).toLocaleString('pt-BR')
const juntarE = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}`)
const contar = (valores) => {
  const m = new Map()
  for (const v of valores) if (v) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'pt-BR'))
}
const plural = (n, um, varios) => (n === 1 ? um : varios)

// como chamar o que a página lista: "lugares" na cidade, a categoria no plural na categoria
function nomesDe(categoria) {
  if (!categoria) return { um: 'salão', varios: 'lugares', fem: false, quantos: 'Quantos salões de beleza' }
  const c = categoriaDoGuia(categoria)
  const fem = c.artigo === 'As'
  return { um: c.singular, varios: c.plural, fem, quantos: `${fem ? 'Quantas' : 'Quantos'} ${c.plural}` }
}

export function panoramaDaCidade({ cidade, categoria = '', lugares = [], completos = null }) {
  const n = Array.isArray(lugares) ? lugares.length : 0
  if (!cidade || n < 3) return { paragrafos: [], faq: [], numeros: null }
  const k = nomesDe(categoria)
  const cat = categoria ? categoriaDoGuia(categoria) : null
  const bairros = contar(lugares.map((l) => l.bairro))
  const B = bairros.length
  const top = bairros.slice(0, 3)
  const cats = categoria ? [] : contar(lugares.map((l) => l.categoria)).filter(([slug]) => GUIA_CATEGORIAS.some((c) => c.slug === slug))
  const mimo = lugares.filter((l) => l.na_mimo).length
  const selecao = lugares.filter((l) => l.selecao).length
  const servicos = contar(lugares.flatMap((l) => (Array.isArray(l.servicos) ? l.servicos : []))).slice(0, 4).map(([s]) => String(s).toLowerCase())
  // horários só com a lista completa (os cartões da cidade não trazem horário)
  const fonte = Array.isArray(completos) ? completos.filter((l) => !categoria || l.categoria === categoria) : null
  const comHorario = fonte ? fonte.filter((l) => Array.isArray(l.horarios) && l.horarios.length) : []
  const perfis = comHorario.map(perfilDoHorario).filter(Boolean)
  const horas = fonte && comHorario.length
    ? { informam: comHorario.length, domingo: perfis.filter((p) => p.domingo).length, cedo: perfis.filter((p) => p.diasCedo.length).length, noite: perfis.filter((p) => p.diasNoite.length).length }
    : null

  const paragrafos = []
  // 1. onde estão
  const cabeca = cat ? `${cat.artigo} ${num(n)} ${k.varios} de ${cidade} no guia` : `Os ${num(n)} lugares do guia em ${cidade}`
  const comConta = (xs) => juntarE(xs.map(([b, q]) => `${b} (${num(q)})`))
  if (B > 3) {
    const pct = Math.round((top.reduce((s, [, q]) => s + q, 0) / n) * 100)
    paragrafos.push(`${cabeca} estão em ${num(B)} bairros. ${comConta(top)} concentram ${pct}% da lista.`)
  } else if (B === 3) paragrafos.push(`${cabeca} estão em três bairros: ${comConta(top)}.`)
  else if (B === 2) paragrafos.push(`${cabeca} estão em dois bairros: ${comConta(top)}.`)
  else if (B === 1) paragrafos.push(`${cabeca} ficam todos no bairro ${top[0][0]}.`)
  // 2. as categorias (só na página da cidade)
  if (cats.length >= 2) {
    const nome = ([slug, q]) => { const c = categoriaDoGuia(slug); return `${c.artigo.toLowerCase()} ${c.plural} (${num(q)})` }
    if (cats.length === 2) paragrafos.push(`São ${nome(cats[0])} e ${nome(cats[1])}.`)
    else paragrafos.push(`${cats[0][1] > n / 2 ? 'A maior parte' : 'O grupo maior'} é de ${categoriaDoGuia(cats[0][0]).plural} (${num(cats[0][1])}); depois vêm ${juntarE(cats.slice(1, 3).map(nome))}${cats.length > 3 ? `, e ainda ${juntarE(cats.slice(3).map(([s]) => categoriaDoGuia(s).plural))}` : ''}.`)
  }
  // 3. os horários
  if (horas) {
    const partes = []
    if (horas.domingo) partes.push(`${num(horas.domingo)} ${plural(horas.domingo, 'abre', 'abrem')} aos domingos`)
    if (horas.noite) partes.push(`${num(horas.noite)} ${plural(horas.noite, 'atende', 'atendem')} até as 20h ou mais em pelo menos um dia`)
    if (horas.cedo) partes.push(`${num(horas.cedo)} ${plural(horas.cedo, 'abre', 'abrem')} às 8h ou antes`)
    let p = partes.length ? `Pelos horários divulgados, ${juntarE(partes)}.` : 'Pelos horários divulgados, nenhum abre aos domingos nem atende depois das 20h.'
    const sem = n - horas.informam
    if (sem > 0) p += ` ${num(sem)} não ${plural(sem, 'informa', 'informam')} horário.`
    paragrafos.push(p)
  }
  // 4. MIMO, Seleção e serviços
  const partes = []
  if (mimo) partes.push(`${num(mimo)} já ${plural(mimo, 'agenda', 'agendam')} pela MIMO`)
  if (selecao) partes.push(`${num(selecao)} ${plural(selecao, 'leva', 'levam')} o selo Seleção MIMO`)
  let p4 = partes.length ? `${juntarE(partes)}.` : ''
  if (servicos.length >= 2) p4 += `${p4 ? ' ' : ''}Entre os serviços mais divulgados estão ${juntarE(servicos)}.`
  if (p4) paragrafos.push(p4)

  // as perguntas que a gente consegue responder com os dados (e que a cliente procura no Google)
  const faq = []
  faq.push({
    pergunta: `${k.quantos} tem em ${cidade}?`,
    resposta: `Neste guia, ${num(n)} ${cat ? k.varios : 'lugares'}${B ? ` em ${num(B)} ${plural(B, 'bairro', 'bairros')}` : ''}${cats.length > 1 ? `, entre ${juntarE(cats.map(([s]) => categoriaDoGuia(s).plural))}` : ''}. A lista cresce conforme novos lugares são publicados.`,
  })
  if (B >= 2) faq.push({
    pergunta: `Quais bairros de ${cidade} têm mais ${cat ? k.varios : 'salões'}?`,
    resposta: `Pelos dados do guia, ${comConta(top)}.${B > 3 ? ` Ao todo, ${num(B)} bairros têm pelo menos um.` : ''} Na lista, filtre pelo bairro para ver só os de lá.`,
  })
  if (horas) {
    let r
    if (horas.domingo) r = `Sim. ${num(horas.domingo)} ${plural(horas.domingo, 'informa', 'informam')} atendimento aos domingos${horas.noite ? ` e ${num(horas.noite)} ${plural(horas.noite, 'atende', 'atendem')} até as 20h ou mais em pelo menos um dia` : ''}.`
    else if (horas.noite) r = `No domingo, não: nenhum informa atendimento. À noite, sim: ${num(horas.noite)} ${plural(horas.noite, 'atende', 'atendem')} até as 20h ou mais em pelo menos um dia.`
    else r = `Pelos horários divulgados, nenhum dos ${num(horas.informam)} que informam horário abre aos domingos ou atende depois das 20h.`
    faq.push({ pergunta: `Tem ${k.um} ${k.fem ? 'aberta' : 'aberto'} no domingo ou à noite em ${cidade}?`, resposta: `${r} Confira o horário no cartão de cada um antes de ir.` })
  }
  if (mimo) faq.push({
    pergunta: `Dá para marcar online em ${cidade}?`,
    resposta: `${num(mimo)} ${mimo === 1 ? `${k.um} de ${cidade} já agenda` : `${cat ? k.varios : 'lugares'} de ${cidade} já agendam`} pela MIMO: na própria página do salão, você escolhe o serviço, o dia e o horário. Nos outros, o contato é pelos canais do próprio salão.`,
  })
  return { paragrafos, faq, numeros: { n, bairros: B, categorias: cats.length, mimo, selecao, horas } }
}

// a FAQ da IA e a dos dados juntas, sem repetir assunto (a mesma regra de faqDaPagina, dos salões)
const TEMAS_DOS_DADOS = new Set(['domingo', 'domingos', 'noite', 'bairro', 'bairros', 'quantos', 'quantas', 'online', 'mimo'])
export function juntarFaq(daIa, dosDados) {
  const palavras = (q) => semAcento(String(q ?? '')).toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter((w) => w.length > 3)
  const chave = (q) => palavras(q).sort().join(' ')
  const dados = Array.isArray(dosDados) ? dosDados : []
  const vistas = new Set(dados.map((f) => chave(f.pergunta)))
  // o assunto que os dados já respondem (abre no domingo? quais bairros? quantos?) a IA não repete
  const temas = new Set(dados.flatMap((f) => palavras(f.pergunta).filter((w) => TEMAS_DOS_DADOS.has(w))))
  const ia = (Array.isArray(daIa) ? daIa : []).filter((f) => f?.pergunta && f?.resposta && !vistas.has(chave(f.pergunta)) && !palavras(f.pergunta).some((w) => temas.has(w)))
  return [...ia, ...dados]
}

// o título do bloco na página
export const tituloDoPanorama = (cidade, categoria = '') => (categoria ? `${categoriaDoGuia(categoria).rotulo} em ${cidade}: os números` : `${cidade} em números`)
