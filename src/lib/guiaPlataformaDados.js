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
export async function consultaGlobal({ cliente, colunas = COLUNAS_LISTA, filtros = {}, ordem = '', pagina = 1, porPagina = POR_PAGINA }) {
  const f = filtros
  const montar = (cols, ordens, semBusca) => {
    let q = cliente.from('guia_lista').select(cols, { count: 'exact' })
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
  let cols = colunas
  let ordens = ordemGlobal(ordem, { publicadas: !!f.publicadas })
  let semBusca = false
  let r = await montar(cols, ordens, semBusca)
  for (let tentativa = 0; r.error && tentativa < 3; tentativa++) {
    const msg = String(r.error.message ?? r.error)
    if (SEM_BUSCA_183.test(msg) && !semBusca) semBusca = true
    else if (PRECISAM_DA_183.test(msg) && ordens !== ORDENS.nome) ordens = ORDENS.nome
    else if (colunaFalta(r.error) && cols !== COLUNAS_LISTA_ANTIGAS) cols = COLUNAS_LISTA_ANTIGAS
    else break
    r = await montar(cols, ordens, semBusca)
  }
  if (r.error) throw Object.assign(new Error(String(r.error.message ?? r.error)), { code: r.error.code, details: r.error.details })
  const lista = Array.isArray(r.data) ? r.data : []
  const total = Number.isFinite(Number(r.count)) && r.count !== null ? Number(r.count) : lista.length
  return { lista, total, pagina: Math.max(1, pagina), paginas: Math.max(1, Math.ceil(total / porPagina)) }
}
