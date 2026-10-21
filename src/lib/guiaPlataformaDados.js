import { semAcento } from './guia.js'
// A leitura da lista do guia na Plataforma (3.36), para um guia de 20 mil salões.
//
// Antes, a lista vinha por OFFSET (range) em páginas de mil, e cada página fazia o banco reordenar a cidade inteira
// de novo, com as colunas pesadas (horarios, servicos, atributos, origem): Santos, com mais de 2 mil, demorava, e
// "Todas as cidades" estourava o tempo. Agora:
//   - fatias com chave: where id > último order by id limit 1000. Cada fatia custa o mesmo, do começo ao fim; a
//     tela recebe cada fatia assim que chega (aoReceber) e já mostra os primeiros mil enquanto o resto vem
//   - só o que a lista mostra: tem_horario e servicos_n (migração 181) em vez de horarios e servicos; sem atributos
//     nem origem. A linha inteira (com o texto) é lida quando se abre o salão (carregarTexto)
//   - "Todas as cidades" (3.38): por páginas de POR_PAGINA no servidor, com os filtros da aba (fase, cidade, bairro,
//     categoria, Receita, Seleção, triagem, busca) e a ordem no próprio banco (consultaGlobal); o total exato vem junto
export const FATIA = 1000
export const TETO_TODAS = 5000
export const COLUNAS_LISTA = 'id, cidade, cidade_slug, uf, slug, categoria, nome, bairro, endereco, cep, telefone, whatsapp, instagram, site, tem_horario, servicos_n, place_id, cnpj, validado_receita, selecao, nota, avaliacoes, fontes, fotos, status, motivo, salon_id, gerado_em, publicado_em, criado_em, atualizado_em, tem_conteudo, tem_rascunho, resumo, meta, meta_rascunho'
// a view antes da 181 (sem as flags): as colunas de sempre, ainda sem atributos e origem
export const COLUNAS_LISTA_ANTIGAS = 'id, cidade, cidade_slug, uf, slug, categoria, nome, bairro, endereco, cep, telefone, whatsapp, instagram, site, horarios, servicos, place_id, cnpj, validado_receita, selecao, nota, avaliacoes, fontes, fotos, status, motivo, salon_id, gerado_em, publicado_em, criado_em, atualizado_em, tem_conteudo, tem_rascunho, resumo, meta, meta_rascunho'
// o banco ainda sem a 181: "column guia_lista.tem_horario does not exist"
export const colunaFalta = (erro) => /tem_horario|servicos_n/.test(String(erro?.message ?? erro)) && /column|does not exist|schema cache|could not find/i.test(String(erro?.message ?? erro))
// o filtro de "Todas as cidades": só a fila. Na view: status fora de publicado/descartado/removido, ou com versão nova
export const soAFila = (q) => q.or('status.not.in.(publicado,descartado,removido),tem_rascunho.eq.true')
export const soAFilaNaTabela = (q) => q.or('status.not.in.(publicado,descartado,removido),rascunho.not.is.null')

// lê uma tabela ou view por fatias com chave (id). aoReceber(listaAteAgora, terminou) a cada fatia.
// Devolve { lista, teto }: teto = parou no teto com mais por ler
export async function lerEmFatias({ cliente, tabela, colunas, filtro = (q) => q, fatia = FATIA, teto = Infinity, aoReceber }) {
  const todas = []
  let depois = null
  for (;;) {
    let q = filtro(cliente.from(tabela).select(colunas)).order('id')
    if (depois) q = q.gt('id', depois)
    const { data, error } = await q.limit(fatia)
    if (error) throw error
    const lote = Array.isArray(data) ? data : []
    todas.push(...lote)
    const ultimo = lote[lote.length - 1]
    const cheia = lote.length >= fatia && !!ultimo?.id
    const noTeto = todas.length >= teto
    const fim = !cheia || noTeto
    aoReceber?.(todas, fim)
    if (fim) return { lista: todas, teto: cheia && noTeto }
    depois = ultimo.id
  }
}

// as flags da lista valem para a linha magra e para a linha inteira (depois de carregarTexto)
export const temHorario = (l) => (l?.tem_horario != null ? !!l.tem_horario : Array.isArray(l?.horarios) && l.horarios.length > 0)
export const nServicos = (l) => (l?.servicos_n != null ? Number(l.servicos_n) : Array.isArray(l?.servicos) ? l.servicos.length : 0)

// ---- "Todas as cidades" por páginas (3.38) ----------------------------------------------------------------------
// A aba (Revisar ou Publicadas) pede uma página de POR_PAGINA salões com os seus filtros, e o banco filtra, ordena e
// conta (count exato). Nada de trazer o guia inteiro: uma página por vez, a próxima quando a pessoa pedir.
export const POR_PAGINA = 500
// a fase da fila (o filtro "status" da aba Revisar) em condições do banco; o mesmo que faseDe() na Plataforma
function porFase(q, fase) {
  const naFila = (x) => x.neq('status', 'publicado').neq('status', 'descartado').neq('status', 'removido')
  switch (fase) {
    case 'gerar': return naFila(q).eq('tem_conteudo', false).eq('tem_rascunho', false)
    case 'revisar': return naFila(q).or('tem_conteudo.eq.true,tem_rascunho.eq.true')
    case 'nova': return q.eq('status', 'publicado').eq('tem_rascunho', true)
    case 'no_ar': return q.eq('status', 'publicado')
    case 'descartado': return q.eq('status', 'descartado')
    case 'removido': return q.eq('status', 'removido')
    default: return q.neq('status', 'removido')
  }
}
// a triagem pela nota do Google e pelas fotos (as mesmas regras de TRIAGENS na aba Revisar)
function porTriagem(q, triagem) {
  switch (triagem) {
    case 'otima': return q.gte('nota', 4.8).gte('avaliacoes', 30)
    case 'boa': return q.gte('nota', 4.5).gte('avaliacoes', 10)
    case 'poucas': return q.not('nota', 'is', null).lt('avaliacoes', 10)
    case 'baixa': return q.not('nota', 'is', null).lt('nota', 4.5).gte('avaliacoes', 10)
    case 'sem': return q.is('nota', null)
    case 'sem_foto': return q.eq('fotos', '{}')
    case 'com_foto': return q.neq('fotos', '{}')
    default: return q
  }
}
// a busca por nome ou bairro no banco (ilike); o que é sintaxe do PostgREST sai do texto. Com a 183, a coluna busca
// (nome e bairro em minúsculas e sem acento): "salao" acha "Salão"; sem ela, nome e bairro como foram digitados
export const termoDeBusca = (t) => String(t ?? '').replace(/[%_*,()"'\\]/g, ' ').replace(/\s+/g, ' ').trim()
export const termoSemAcento = (t) => semAcento(termoDeBusca(t)).toLowerCase()
const SEM_BUSCA_183 = /\bbusca\b/
// as ordens das abas em colunas do banco: [coluna, crescente?]. O id entra no fim (desempate estável entre páginas)
const ORDENS = {
  selecao: [['selecao', false], ['avaliacoes', false], ['nome', true]],
  nome: [['nome', true], ['cidade_slug', true]],
  bairro: [['cidade_slug', true], ['bairro', true], ['nome', true]],
  recentes: [['gerado_em', false], ['atualizado_em', false], ['nome', true]],
  avaliacoes: [['avaliacoes', false], ['nota', false], ['nome', true]],
  nota: [['nota', false], ['avaliacoes', false], ['nome', true]],
  // pelas fotos da página e a ordem que o site usa (pontos e fotos_n: migração 183)
  fotos: [['fotos_n', false], ['selecao', false], ['avaliacoes', false], ['nome', true]],
  sem_foto: [['fotos_n', true], ['selecao', false], ['avaliacoes', false], ['nome', true]],
  site: [['salon_id', true], ['selecao', false], ['pontos', false], ['avaliacoes', false], ['nome', true]],
  publicadas: [['publicado_em', false], ['nome', true]],
}
const PRECISAM_DA_183 = /pontos|fotos_n/
export function ordemGlobal(ordem, { publicadas = false } = {}) {
  if (publicadas && (!ordem || ordem === 'recentes')) return ORDENS.publicadas
  return ORDENS[ordem] ?? (publicadas ? ORDENS.publicadas : ORDENS.selecao)
}
// monta e executa a consulta de uma página de "todas as cidades".
//   filtros: { status, cidade, bairro, categoria, receita, selecao, triagem, busca, publicadas }
// Devolve { lista, total, pagina, paginas }. Num banco sem a 183 (sem pontos e fotos_n), a ordem cai para A a Z; sem a 181,
// as colunas de antes. Sem a view (171), o erro sobe com o nome dela, e a tela explica.
// 3.43: em duas idas. A primeira pede só os ids da página, com a contagem: o banco filtra e ordena sem abrir o texto de
// cada salão (o resumo e os dados da IA moram dentro de conteudo, o campo grande). Pedir as colunas da lista já na
// ordenação abria o texto dos 20 mil para entregar 500 e passava do tempo limite ("canceling statement due to statement
// timeout"). A segunda pede as colunas só desses ids, em pedaços de IDS_POR_VEZ (o endereço do pedido tem limite de
// tamanho), e a lista sai na ordem da primeira.
export const IDS_POR_VEZ = 100
export async function consultaGlobal({ cliente, colunas = COLUNAS_LISTA, filtros = {}, ordem = '', pagina = 1, porPagina = POR_PAGINA }) {
  const f = filtros
  const montar = (ordens, semBusca) => {
    let q = cliente.from('guia_lista').select('id', { count: 'exact' })
    q = f.publicadas ? q.eq('status', 'publicado') : porFase(q, f.status)
    if (f.cidade) q = q.eq('cidade_slug', f.cidade)
    if (f.bairro) q = q.eq('bairro', f.bairro)
    if (f.categoria) q = q.eq('categoria', f.categoria)
    if (f.receita) q = q.eq('validado_receita', true)
    if (f.selecao) q = q.eq('selecao', true)
    if (f.triagem) q = porTriagem(q, f.triagem)
    const t = termoDeBusca(f.busca)
    if (t) q = semBusca ? q.or(`nome.ilike.*${t}*,bairro.ilike.*${t}*`) : q.ilike('busca', `*${termoSemAcento(t)}*`)
    for (const [col, asc] of ordens) q = q.order(col, { ascending: asc, nullsFirst: false })
    q = q.order('id', { ascending: true })
    const de = (Math.max(1, pagina) - 1) * porPagina
    return q.range(de, de + porPagina - 1)
  }
  const falhou = (e) => Object.assign(new Error(String(e.message ?? e)), { code: e.code, details: e.details })
  // 1. os ids da página e o total
  let ordens = ordemGlobal(ordem, { publicadas: !!f.publicadas })
  let semBusca = false
  let r = await montar(ordens, semBusca)
  for (let tentativa = 0; r.error && tentativa < 2; tentativa++) {
    const msg = String(r.error.message ?? r.error)
    if (SEM_BUSCA_183.test(msg) && !semBusca) semBusca = true
    else if (PRECISAM_DA_183.test(msg) && ordens !== ORDENS.nome) ordens = ORDENS.nome
    else break
    r = await montar(ordens, semBusca)
  }
  if (r.error) throw falhou(r.error)
  const ids = (Array.isArray(r.data) ? r.data : []).map((x) => x.id).filter(Boolean)
  const total = Number.isFinite(Number(r.count)) && r.count !== null ? Number(r.count) : ids.length
  // 2. as colunas só desses ids
  const lerLinhas = async (cols) => {
    const partes = []
    for (let i = 0; i < ids.length; i += IDS_POR_VEZ) partes.push(ids.slice(i, i + IDS_POR_VEZ))
    const rs = await Promise.all(partes.map((parte) => cliente.from('guia_lista').select(cols).in('id', parte)))
    return { erro: rs.find((x) => x.error)?.error ?? null, linhas: rs.flatMap((x) => (Array.isArray(x.data) ? x.data : [])) }
  }
  let cols = colunas
  let l = ids.length ? await lerLinhas(cols) : { erro: null, linhas: [] }
  if (l.erro && colunaFalta(l.erro) && cols !== COLUNAS_LISTA_ANTIGAS) { cols = COLUNAS_LISTA_ANTIGAS; l = await lerLinhas(cols) }
  if (l.erro) throw falhou(l.erro)
  const porId = new Map(l.linhas.map((x) => [x.id, x]))
  const lista = ids.map((id) => porId.get(id)).filter(Boolean)
  return { lista, total, pagina: Math.max(1, pagina), paginas: Math.max(1, Math.ceil(total / porPagina)) }
}

// ---- um lote grande, em partes (3.38.1) --------------------------------------------------------------------------
// guia_lote com milhares de ids num comando só passava do tempo limite do banco ("canceling statement due to statement
// timeout"). Aqui o lote vai em partes de LOTE_POR_VEZ, uma de cada vez: chamar(ids) devolve o resultado da função
// ({ n, eventos, buscas, interesses, paginas }) e os números são somados; aoAvancar(feitos, total, soma) a cada parte.
// Uma parte que passa do tempo vai de novo pela metade (até LOTE_MINIMO). Outro erro sobe com erro.feitos (quantos ids
// já foram, para a tela continuar de onde parou) e erro.soma (o que já foi somado nesta tentativa).
export const LOTE_POR_VEZ = 200
export const LOTE_MINIMO = 25
export const ehTempoEsgotado = (e) => /statement timeout|canceling statement|57014/i.test(String(e?.message ?? e))
export async function loteEmPartes(ids, chamar, { porVez = LOTE_POR_VEZ, desde = 0, aoAvancar } = {}) {
  const soma = { n: 0, eventos: 0, buscas: 0, interesses: 0, paginas: 0 }
  let feitos = Math.min(Math.max(0, desde | 0), ids.length)
  let tamanho = Math.max(1, porVez | 0)
  while (feitos < ids.length) {
    const parte = ids.slice(feitos, feitos + tamanho)
    let r
    try {
      r = await chamar(parte)
    } catch (e) {
      if (ehTempoEsgotado(e) && tamanho > LOTE_MINIMO) { tamanho = Math.max(LOTE_MINIMO, Math.floor(tamanho / 2)); continue }
      const erro = e instanceof Error ? e : new Error(String(e?.message ?? e))
      erro.feitos = feitos; erro.soma = soma
      throw erro
    }
    for (const k of Object.keys(soma)) soma[k] += Number(r?.[k] ?? 0)
    feitos += parte.length
    aoAvancar?.(feitos, ids.length, soma)
  }
  return { ...soma, feitos }
}
