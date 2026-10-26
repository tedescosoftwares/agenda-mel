// As contas e os textos do painel de desempenho do guia (3.11), sem tela:
// a aba Desempenho e o painel do salão na revisão usam o mesmo. Os números
// vêm de guia_desempenho() (migrações 156 e 161) ou do demo, no mesmo formato.
import { categoriaDoGuia, linkWhatsDoTel, ehCelular, fotosDoLugar } from './guia'
import { rotuloDaColecao } from './guiaColecoes'
import { REGRAS } from './acesso'

export const ROTULO_ORIGEM = {
  google: 'Google', bing: 'Bing', direto: 'Direto (link ou digitado)', interno: 'De outra página do site',
  instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', tiktok: 'TikTok', youtube: 'YouTube', outro: 'Outros sites',
  app: 'App MIMO', // 3.73: a cliente pelo app (migração 217)
}
export const ROTULO_AREA = {
  heroi: 'Topo da página', fatos: 'Quadro de informações', barra: 'Barra de baixo (celular)',
  dono: 'Seção para o dono', aviso: 'Aviso do rodapé', outra: 'Outra parte',
}

export const n0 = (v) => Number(v) || 0
export const formatar = (v) => n0(v).toLocaleString('pt-BR')
// contato / visita, em %, com uma casa quando é pequeno
export function taxa(contatos, visitas) {
  if (!n0(visitas)) return null
  const t = (n0(contatos) / n0(visitas)) * 100
  return t < 10 ? Math.round(t * 10) / 10 : Math.round(t)
}
export const taxaTexto = (t) => (t == null ? '–' : `${String(t).replace('.', ',')}%`)
// quantos visitantes tentaram algum contato (pessoas, não toques: quem toca em
// WhatsApp e em Como chegar conta uma vez). Nunca passa de 100%.
export const taxaDeContato = (contataram, visitantes) => taxa(Math.min(n0(contataram), n0(visitantes)), visitantes)

// os tipos de um grupo, na ordem do banco
export const tiposDo = (dados, grupo) => (dados?.tipos ?? []).filter((t) => t.grupo === grupo)
export const somaDo = (dados, grupo, totais = dados?.totais) => tiposDo(dados, grupo).reduce((s, t) => s + n0(totais?.[t.tipo]), 0)

// o nome de uma linha da tabela: o salão, ou "Salões em itanhaem", "Unhas em itanhaem"
// nomeDoBairro(chave): o nome com acento ('Vila São Paulo'), de nomesDosBairros (guiaColecoes)
export function nomeDaPagina(p, nomeDaCidade = (s) => s, nomeDoBairro) {
  if (p.nome) return p.nome
  // as páginas por bairro e por horário (157): 'Salões no Centro, Itanhaém'
  const colecao = rotuloDaColecao(p.pagina, { cidade: nomeDaCidade, bairro: nomeDoBairro })
  if (colecao) return colecao
  const [, , cidade, cat] = String(p.pagina ?? '').split('/')
  if (!cidade) return 'Índice do guia'
  return cat ? `${categoriaDoGuia(cat).rotulo} em ${nomeDaCidade(cidade)}` : `Salões em ${nomeDaCidade(cidade)}`
}

// a frase que pede as fotos (3.16.1): entra na mensagem quando a página está no ar e sem foto.
// A pessoa responde com as fotos pelo próprio WhatsApp e a equipe coloca (Editar → Fotos ou Fotos em lote).
export const PEDIDO_DE_FOTOS = 'A página ainda está sem foto. Se puder, me manda umas fotos do salão por aqui (a fachada, o ambiente, trabalhos de vocês) que a gente coloca na página.'
// a página do salão está sem foto? Pelo salão da Plataforma (guia_lugares.fotos). Quem já está na
// MIMO usa as fotos da própria página dele, então não pede.
export const paginaSemFoto = (lugar) => !!lugar && !lugar.salon_id && fotosDoLugar(lugar).length === 0

// a mensagem para o dono do salão, com os números do período (só o que é verdade e não é zero).
// Salão que já agenda pela MIMO recebe o relatório, sem oferta. semFotos: pede as fotos.
// 3.59: o que passou pela Mel, em contagens (nunca os nomes das clientes: o salão já os recebeu no pedido)
export function pelaMel(m) {
  const n = n0(m?.pedidos)
  if (!n) return ''
  const vai = n0(m?.vai)
  return `E tem mais: nesse período, ${n === 1 ? '1 cliente pediu' : `${n} clientes pediram`} horário com vocês pela MIMO, pelo nosso WhatsApp${vai ? ` — e vocês já disseram que vão atender ${vai === 1 ? '1' : vai}` : ''}. Imagina isso caindo direto na sua agenda, com confirmação automática.`
}

export function mensagemParaDono(p, { dias, url, cidade, semFotos = false }) {
  const e = p.eventos ?? {}
  const partes = [
    [n0(e.agendar_mimo), 'tocaram em "Agendar pela MIMO"', 'tocou em "Agendar pela MIMO"'],
    [n0(e.whatsapp), 'tocaram para chamar vocês no WhatsApp', 'tocou para chamar vocês no WhatsApp'],
    [n0(e.ligar), 'tocaram para ligar', 'tocou para ligar'],
    [n0(e.mapa), 'pediram a rota até o salão', 'pediu a rota até o salão'],
    [n0(e.instagram), 'abriram o Instagram de vocês', 'abriu o Instagram de vocês'],
    [n0(p.interesses?.quero_marcar), 'pediram para marcar horário pelo app', 'pediu para marcar horário pelo app'],
  ].filter(([v]) => v > 0).map(([v, varios, um]) => `${v} ${v === 1 ? `pessoa ${um}` : `pessoas ${varios}`}`)
  const lista = partes.length <= 1 ? partes.join('') : `${partes.slice(0, -1).join(', ')} e ${partes.at(-1)}`
  const numeros = `A página de ${p.nome} no nosso guia teve ${formatar(p.visitas)} ${n0(p.visitas) === 1 ? 'visita' : 'visitas'} nos últimos ${dias} dias${lista ? `, e ${lista}` : ''}.`
  const pedido = semFotos && url ? PEDIDO_DE_FOTOS : ''
  if (p.na_mimo) return [`Oi! Tudo bem? Aqui é da MIMO, com o resumo do guia de salões de ${cidade || 'beleza'}.`, numeros, pelaMel(p.mel), pedido, url ? `A página: ${url}` : ''].filter(Boolean).join('\n\n')
  return [
    `Oi! Tudo bem? Aqui é da MIMO, um guia de salões de ${cidade || 'beleza'}.`,
    numeros,
    pelaMel(p.mel),
    pedido,
    'Dá para receber essas clientes direto numa agenda online: ela escolhe o serviço e o horário, e vocês recebem tudo organizado, com confirmação pelo WhatsApp.',
    `Para autônoma é grátis para sempre; salão com equipe testa ${REGRAS.testeDias} dias, sem cartão. Posso te mostrar como fica?`,
    url ? `A página: ${url}` : '',
  ].filter(Boolean).join('\n\n')
}

// o WhatsApp do salão com a mensagem pronta (WhatsApp divulgado, ou o telefone se for celular)
export function zapDoDono(p, texto) {
  const numero = p.whatsapp || (ehCelular(p.telefone) ? p.telefone : null)
  return numero ? linkWhatsDoTel(numero, texto) : null
}

// ---- 3.12: a aba Desempenho de cara nova (frase do topo, tendências, destaques) ----

const plural = (v, um, varios) => `${formatar(v)} ${n0(v) === 1 ? um : varios}`

// só compara quando o banco mandou o período anterior (vazio = sem histórico inteiro ainda)
export const temComparacao = (dados) => Object.keys(dados?.totais_antes ?? {}).length > 0

// um número contra o do período anterior. null = não há com o que comparar.
// Antes zero não vira "+100%": vira { antes: 0, pct: null }, e a tela diz "antes, nenhum".
export function variacao(agora, antes) {
  if (antes == null) return null
  const a = n0(antes), b = n0(agora)
  if (!a) return { antes: 0, pct: null, dir: b > 0 ? 'sobe' : 'igual' }
  const pct = Math.round(((b - a) / a) * 100) || 0 // sem -0 (199 contra 200)
  return { antes: a, pct, dir: pct > 0 ? 'sobe' : pct < 0 ? 'desce' : 'igual' }
}

// as pessoas que tentaram contato nunca passam das que visitaram (a mesma regra de taxaDeContato)
export const contataramDe = (contataram, visitantes) => Math.min(n0(contataram), n0(visitantes))

// a frase do topo, em pedaços: texto puro ou { forte } (a tela põe em negrito).
// "Nos últimos 30 dias, 702 pessoas viram as páginas do guia e 131 tentaram
// falar com os salões, 59% a mais que nos 30 dias anteriores."
export function fraseDoPeriodo(dados) {
  const dias = n0(dados?.dias)
  const pessoas = n0(dados?.visitantes)
  const contato = contataramDe(dados?.contataram, pessoas)
  const quando = dias === 1 ? 'Hoje' : `Nos últimos ${dias} dias`
  if (!pessoas) return [`${quando}, ninguém abriu as páginas do guia ainda.`]
  const partes = [`${quando}, `, { forte: plural(pessoas, 'pessoa', 'pessoas') }, pessoas === 1 ? ' viu as páginas do guia' : ' viram as páginas do guia']
  if (!contato) return [...partes, ', mas ninguém tentou falar com os salões ainda.']
  partes.push(' e ', { forte: formatar(contato) }, contato === 1 ? ' tentou falar com os salões' : ' tentaram falar com os salões')
  const v = temComparacao(dados) ? variacao(contato, contataramDe(dados.contataram_antes, dados.visitantes_antes)) : null
  const anteriores = dias === 1 ? 'ontem' : `nos ${dias} dias anteriores`
  if (v?.pct > 0) partes.push(', ', { forte: `${formatar(v.pct)}% a mais` }, ` que ${anteriores}`)
  else if (v?.pct < 0) partes.push(', ', { forte: `${formatar(-v.pct)}% a menos` }, ` que ${anteriores}`)
  else if (v?.pct === 0) {
    // menos de 0,5% de diferença arredonda para 0%: "o mesmo número" só quando é o mesmo
    const dif = contato - v.antes
    partes.push(dif ? `, quase o mesmo número que ${anteriores} (${formatar(Math.abs(dif))} a ${dif > 0 ? 'mais' : 'menos'})` : `, o mesmo número que ${anteriores}`)
  }
  else if (v) partes.push(` (${anteriores}, ninguém tinha tentado)`)
  return [...partes, '.']
}
export const textoDaFrase = (partes) => partes.map((p) => (typeof p === 'string' ? p : p.forte)).join('')

const ORIGEM_POR = {
  google: 'pelo Google', bing: 'pelo Bing', direto: 'por link direto ou digitando o endereço', instagram: 'pelo Instagram',
  facebook: 'pelo Facebook', whatsapp: 'por link no WhatsApp', tiktok: 'pelo TikTok', youtube: 'pelo YouTube', outro: 'por outros sites', app: 'pelo app da MIMO',
}
// a segunda linha do topo: de onde veio mais gente e quanto foi pelo celular
export function detalheDoPeriodo(dados) {
  const visitas = n0(dados?.totais?.visita)
  if (visitas < 5) return ''
  const origens = dados?.origens ?? []
  const entradas = origens.reduce((s, o) => s + n0(o.visitas), 0)
  const top = origens[0]
  const ap = dados?.aparelhos ?? {}
  const conhecidos = n0(ap.celular) + n0(ap.computador)
  const partes = []
  if (top && entradas) partes.push(`mais gente chegou ${ORIGEM_POR[top.origem] ?? `por ${top.origem}`} (${taxaTexto(taxa(top.visitas, entradas))} das entradas)`)
  if (conhecidos) partes.push(`${taxaTexto(taxa(ap.celular, conhecidos))} das visitas foram pelo celular`)
  if (!partes.length) return ''
  const t = partes.join(' e ')
  return t[0].toUpperCase() + t.slice(1) + '.'
}

// "de cada 100 pessoas, 18": a mesma taxa dita de um jeito que se lê de primeira
export function deCada100(parte, total) {
  if (!n0(total)) return null
  const x = (n0(parte) / n0(total)) * 100
  return x > 0 && x < 0.5 ? 'menos de 1' : formatar(Math.round(x))
}

// a série por dia em grupos (as tendências dos números do topo): até 31 dias, um ponto
// por dia; mais que isso, grupos do mesmo tamanho contados do fim (o grupo incompleto do
// começo sai, para não parecer uma queda que não houve)
export function agruparDias(porDia, dias = (porDia ?? []).length) {
  const xs = Array.isArray(porDia) ? porDia : []
  const tamanho = dias > 31 ? Math.ceil(dias / 15) : 1
  if (tamanho === 1) return xs.map((p) => ({ ...p, ate: p.dia }))
  const grupos = []
  for (let fim = xs.length; fim - tamanho >= 0; fim -= tamanho) {
    const parte = xs.slice(fim - tamanho, fim)
    const soma = {}
    for (const p of parte) for (const [k, v] of Object.entries(p)) if (k !== 'dia') soma[k] = (soma[k] ?? 0) + n0(v)
    grupos.unshift({ ...soma, dia: parte[0].dia, ate: parte.at(-1).dia })
  }
  return grupos
}

// dá para montar a mensagem para o dono? (no ar, com visita, e não pediu para sair)
export const podeMandarMensagem = (p) => !!(p?.lugar_id && p.status === 'publicado' && n0(p.visitas) > 0 && !n0(p.interesses?.remover))

// o que falta na página de um salão e costuma tirar contato (pelos dados do próprio salão)
export function faltasDoSalao(l) {
  if (!l) return []
  const f = []
  if (!l.whatsapp && !ehCelular(l.telefone)) f.push('sem WhatsApp')
  if (!l.telefone && !l.whatsapp) f.push('sem telefone')
  if (!l.instagram) f.push('sem Instagram')
  if (!l.horarios?.length) f.push('sem horário')
  if (!l.servicos?.length) f.push('sem serviços')
  return f
}

// os limites dos destaques (para um destaque não aparecer por acaso, com dois ou três números)
export const DESTAQUE = { altaMinVisitas: 5, altaMinGanho: 3, altaMinPct: 25, poucoMinPessoas: 10 }

// os quatro destaques da aba: quem mais recebeu contato, quem cresceu, quem tem muita visita
// e pouco contato (sinal de dado faltando) e os salões no ar sem nenhuma visita.
// lugares: os salões da Plataforma (o que falta em cada um e a data em que entrou no ar).
export function destaquesDoPeriodo(dados, lugares = [], agora = Date.now()) {
  const porId = new Map(lugares.map((l) => [l.id, l]))
  // uma linha por salão: se o endereço mudou, vale a de mais visitas (a primeira)
  const vistos = new Set()
  const saloes = (dados?.paginas ?? []).filter((p) => p.lugar_id && !vistos.has(p.lugar_id) && vistos.add(p.lugar_id))
  const taxaGeral = taxaDeContato(dados?.contataram, dados?.visitantes)

  const maisProcurados = saloes.filter((p) => n0(p.contataram) > 0)
    .sort((a, b) => n0(b.contataram) - n0(a.contataram) || n0(b.visitantes) - n0(a.visitantes))
    .slice(0, 3)
    .map((p) => ({ p, pessoas: contataramDe(p.contataram, p.visitantes), tx: taxaDeContato(p.contataram, p.visitantes) }))

  // em alta: só com o período anterior inteiro e com as visitas de antes por página (161)
  const temAntesPorPagina = saloes.some((p) => p.visitas_antes != null)
  const emAlta = !temComparacao(dados) || !temAntesPorPagina ? null : saloes
    .filter((p) => {
      const v = n0(p.visitas), a = n0(p.visitas_antes)
      return p.visitas_antes != null && v >= DESTAQUE.altaMinVisitas && v - a >= DESTAQUE.altaMinGanho && (!a || ((v - a) / a) * 100 >= DESTAQUE.altaMinPct)
    })
    .sort((a, b) => (n0(b.visitas) - n0(b.visitas_antes)) - (n0(a.visitas) - n0(a.visitas_antes)) || n0(b.visitas) - n0(a.visitas))
    .slice(0, 3)
    .map((p) => ({ p, v: variacao(p.visitas, p.visitas_antes) }))

  // muita visita e pouco contato: no ar, gente bastante e menos da metade da taxa geral
  const poucoContato = taxaGeral == null ? [] : saloes
    .filter((p) => p.status === 'publicado' && n0(p.visitantes) >= DESTAQUE.poucoMinPessoas && (taxaDeContato(p.contataram, p.visitantes) ?? 0) < taxaGeral / 2)
    .sort((a, b) => n0(b.visitantes) - n0(a.visitantes))
    .slice(0, 3)
    .map((p) => ({ p, tx: taxaDeContato(p.contataram, p.visitantes), faltas: faltasDoSalao(porId.get(p.lugar_id)) }))

  // no ar sem nenhuma visita: os que estão no ar há mais tempo primeiro (os mais preocupantes)
  const semVisita = saloes.filter((p) => p.status === 'publicado' && !n0(p.visitas))
    .map((p) => {
      // 3.39: a linha traz publicado_em (187); a lista carregada na tela é a reserva (em todas as cidades ela é só uma página)
      const desde = p.publicado_em ?? porId.get(p.lugar_id)?.publicado_em
      return { p, diasNoAr: desde ? Math.max(0, Math.floor((agora - new Date(desde).getTime()) / 86400e3)) : null }
    })
    .sort((a, b) => (b.diasNoAr ?? -1) - (a.diasNoAr ?? -1) || String(a.p.nome).localeCompare(String(b.p.nome), 'pt-BR'))

  // 3.39: em todas as cidades a lista traz só os 300 sem visita há mais tempo no ar; o total vem do banco (187)
  const semVisitaTotal = Number.isFinite(Number(dados?.sem_visita_total)) && dados?.sem_visita_total != null ? Number(dados.sem_visita_total) : semVisita.length
  return { taxaGeral, maisProcurados, emAlta, emAltaSem161: temComparacao(dados) && saloes.length > 0 && !temAntesPorPagina, poucoContato, semVisita, semVisitaTotal }
}
