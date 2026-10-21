import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho } from '../../components/plataforma/Pecas'
import { supabase, isDemo } from '../../lib/supabase'
import { chamar } from '../../lib/pagamento'
import { useAuth } from '../../context/AuthContext'
import { montarConteudo, contextoDaCidade } from '../../lib/guiaTexto'
import Revisar from '../../components/plataforma/guia/Revisar'
import Publicadas from '../../components/plataforma/guia/Publicadas'
import Importar from '../../components/plataforma/guia/Importar'
import ImportarFotos from '../../components/plataforma/guia/ImportarFotos'
import MiniaturasAntigas from '../../components/plataforma/guia/MiniaturasAntigas'
import PaginasCidade from '../../components/plataforma/guia/PaginasCidade'
import Interesses from '../../components/plataforma/guia/Interesses'
import Desempenho from '../../components/plataforma/guia/Desempenho'
import Abordagem from '../../components/plataforma/guia/Abordagem'
import { naoContarAqui } from '../../lib/eventos'
import { IAS, iaLembrada, lembrarIa, modeloLembrado, lembrarModelo } from '../../lib/guiaIa'
import { lerEmFatias, COLUNAS_LISTA, COLUNAS_LISTA_ANTIGAS, colunaFalta, consultaGlobal, POR_PAGINA } from '../../lib/guiaPlataformaDados'
import { agruparPorRegiao, regiaoDaCidade } from '../../lib/guiaRegioes'
import { slugificar } from '../../lib/guia'
import { ClipboardCheck, Globe2, Upload, MapPinned, Inbox, X, BarChart3, Handshake, MapPin, RefreshCw, LoaderCircle } from 'lucide-react'
import '../../guia-plataforma.css'

// Guia de salões (3.9): uma página pública para cada salão da região, que
// a pessoa da Plataforma aprova, uma por uma. É a tela em que o dono da
// MIMO passa horas, então tudo mora aqui em memória: aprovar, montar,
// editar e descartar mudam a lista na hora, sem recarregar nada, e o lote
// continua rodando enquanto se troca de aba.
//
// O texto (3.10) é montado aqui mesmo, dos dados de cada salão e da
// comparação com os outros da cidade (packages/core/guiaTexto.js): de
// graça e na hora. A IA (função guia-gerar, Groq) fica como opção para
// reescrever um salão. Os dados vêm direto das tabelas (RLS eh_plataforma)
// e das RPCs da 153; no modo demonstração as mesmas chamadas caem no
// src/lib/demo.js.
//
// 3.25 (migração 174): a tela abre só com os totais por cidade e por fase
// (guia_resumo, alguns KB), escolhe uma cidade (a lembrada; senão a que tem
// mais trabalho) e lê a lista magra daquela cidade. Trocar de cidade lê a
// outra (e guarda em memória); "Todas as cidades" é escolha explícita. Os
// salões que os interesses citam vêm à parte, de qualquer cidade. Num banco
// sem a 174, tudo de uma vez, como antes.

const ABAS = [
  ['revisar', 'Revisar', ClipboardCheck],
  ['desempenho', 'Desempenho', BarChart3],
  ['abordagem', 'Abordagem', Handshake],
  ['publicadas', 'Publicadas', Globe2],
  ['importar', 'Importar', Upload],
  ['paginas', 'Páginas da cidade', MapPinned],
  ['interesses', 'Interesses', Inbox],
]

// só o que a tela usa: origem (o CSV cru) e as coordenadas ficam no banco
// 3.34: o modelo escolhido para a IA, quando há um (vazio = o padrão do segredo, e o pedido não leva o campo)
const modeloDoPedido = (m) => (m ? { modelo: m } : {})
const COLUNAS_LUGAR = 'id, cidade, cidade_slug, uf, slug, categoria, nome, bairro, endereco, cep, telefone, whatsapp, instagram, site, horarios, servicos, atributos, place_id, cnpj, validado_receita, selecao, nota, avaliacoes, fontes, origem, fotos, conteudo, rascunho, status, motivo, salon_id, gerado_em, publicado_em, criado_em, atualizado_em'
// 3.23: a lista magra (view guia_lista, migração 171): sem conteudo e rascunho; 3.36: por fatias com chave e só com o que a
// lista mostra (COLUNAS_LISTA em guiaPlataformaDados.js: tem_horario e servicos_n no lugar de horarios e servicos, sem
// atributos nem origem). A linha inteira é lida quando se abre o salão (carregarTexto). Num banco sem a view, a leitura cheia.
const temConteudo = (l) => !!l?.tem_conteudo
const temRascunho = (l) => !!l?.tem_rascunho
const temTexto = (l) => temConteudo(l) || temRascunho(l)
// as flags a partir de uma linha que veio com o texto (a leitura antiga)
const comFlags = (l) => ({ ...l, tem_conteudo: !!l.conteudo, tem_rascunho: !!l.rascunho, texto_carregado: true })

// a fase de um salão na fila de revisão (o filtro "status" da aba Revisar)
//   gerar      ainda sem página (nem montada nem da IA)
//   revisar    texto gerado esperando aprovação (inclui o despublicado, que guarda o texto)
//   nova       no ar, com uma versão nova esperando revisão
//   no_ar      no ar, nada pendente
//   descartado / removido
function faseDe(l) {
  if (l.status === 'removido') return 'removido'
  if (l.status === 'descartado') return 'descartado'
  if (l.status === 'publicado') return temRascunho(l) ? 'nova' : 'no_ar'
  return temTexto(l) ? 'revisar' : 'gerar'
}

// as métricas do guia num período (156); nunca rejeita: o erro vem dentro
async function lerDesempenho(dias, cidade = '') {
  try {
    const { data, error } = await supabase.rpc('guia_desempenho', { dias, cidade_: cidade || '' })
    if (error) {
      const msg = String(error.message ?? error)
      return { dias, cidade, dados: null, erro: /guia_desempenho|site_eventos|function|schema cache/i.test(msg) ? 'As métricas ainda não existem neste banco. Rode a migração 156 (supabase/156_metricas_do_site.sql).' : msg }
    }
    return { dias, cidade, dados: data ?? null, erro: data ? '' : 'O banco não devolveu as métricas.' }
  } catch (e) {
    return { dias, cidade, dados: null, erro: String(e?.message ?? e) }
  }
}

// o Supabase entrega no máximo 1000 linhas por vez; o demo não pagina. filtro: a cidade (3.25)
async function lerTudo(tabela, colunas, ordem, filtro = (q) => q) {
  const todas = []
  for (let de = 0; ; de += 1000) {
    let q = filtro(supabase.from(tabela).select(colunas)).order(ordem).order('id')
    const pagina = typeof q.range === 'function'
    if (pagina) q = q.range(de, de + 999)
    const { data, error } = await q
    if (error) throw error
    todas.push(...(data ?? []))
    if (!pagina || !data || data.length < 1000) break
  }
  return todas
}

// A função guia-gerar responde 200 { ok:false, tentar_em } quando o Groq pede
// calma; o chamar() de pagamento.js transformaria isso em exceção e perderia o
// tempo de espera. E a IA pode levar mais de 15 s (o teto de cada requisição
// do cliente do Supabase, em supabase.js): por isso a chamada vai num fetch
// próprio, com 100 s de prazo, e a resposta chega inteira.
const PRAZO_IA = 100000
// 3.27: qual IA escreve (Gemini ou Groq), escolhida na tela e lembrada no aparelho (src/lib/guiaIa.js); vai em cada pedido
async function chamarGerador(corpo) {
  try {
    if (isDemo) return await chamar('guia-gerar', corpo)
    const { data: { session } = {} } = await supabase.auth.getSession()
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), PRAZO_IA)
    try {
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/guia-gerar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify(corpo),
        signal: ctrl.signal,
      })
      const j = await r.json().catch(() => null)
      if (!r.ok) return { ok: false, erro: j?.erro || `a função respondeu ${r.status}` }
      return j ?? { ok: false, erro: 'a função não respondeu' }
    } finally { clearTimeout(t) }
  } catch (e) {
    return { ok: false, rede: true, erro: e?.name === 'AbortError' ? 'a IA demorou demais' : (e?.message || 'não deu para falar com a função') }
  }
}

// a rede caiu no meio, mas a função pode ter terminado e gravado: confere no banco
async function rascunhoGravadoDepois(tabela, id, desde) {
  const { data } = await supabase.from(tabela).select('rascunho, gerado_em').eq('id', id).maybeSingle()
  return data?.rascunho && data.gerado_em && new Date(data.gerado_em).getTime() >= desde - 5000 ? data.rascunho : null
}

// os salões de uma cidade pela lista magra, por fatias com chave (3.36). aoReceber(lista, fim) a cada fatia. Num banco
// sem a 181, as colunas de antes; sem a 171, a leitura cheia (já com o texto). Devolve { lista, teto }.
// "Todas as cidades" não passa por aqui desde a 3.38: a aba pede página por página ao banco (consultarGlobal)
const semTexto = (ls) => ls.map((l) => ({ ...l, texto_carregado: false }))
async function lerLugares(cidade, aoReceber) {
  const filtro = (q) => q.eq('cidade_slug', cidade)
  const ler = (colunas) => lerEmFatias({ cliente: supabase, tabela: 'guia_lista', colunas, filtro, teto: Infinity, aoReceber: aoReceber && ((ls, fim) => aoReceber(semTexto(ls), fim)) })
  try {
    const r = await ler(COLUNAS_LISTA)
    return { lista: semTexto(r.lista), teto: r.teto }
  } catch (e) {
    if (colunaFalta(e)) { const r = await ler(COLUNAS_LISTA_ANTIGAS); return { lista: semTexto(r.lista), teto: r.teto } }
    if (!/guia_lista/.test(String(e?.message ?? e))) throw e
    return { lista: (await lerTudo('guia_lugares', COLUNAS_LUGAR, 'nome', filtro)).map(comFlags), teto: false }
  }
}
// os totais por cidade e por fase (3.25, migração 174): alguns KB. false num banco sem a 174: aí a tela lê tudo, como antes
async function lerResumo() {
  const { data, error } = await supabase.rpc('guia_resumo')
  if (error) {
    if (/guia_resumo|schema cache|does not exist|could not find/i.test(String(error.message ?? error))) return false
    throw error
  }
  return Array.isArray(data) ? data : false
}
// os salões de uma lista de ids, de qualquer cidade (os que os interesses citam), pela lista magra
async function lerLugaresPorId(ids) {
  const out = []
  for (let i = 0; i < ids.length; i += 100) {
    const parte = ids.slice(i, i + 100)
    let r = await supabase.from('guia_lista').select(COLUNAS_LISTA).in('id', parte)
    if (r.error && colunaFalta(r.error)) r = await supabase.from('guia_lista').select(COLUNAS_LISTA_ANTIGAS).in('id', parte)
    if (!r.error) { out.push(...(r.data ?? []).map((l) => ({ ...l, texto_carregado: false }))); continue }
    r = await supabase.from('guia_lugares').select(COLUNAS_LUGAR).in('id', parte)
    if (!r.error) out.push(...(r.data ?? []).map(comFlags))
  }
  return out
}
// o que a tela precisa para abrir: os totais, as páginas das cidades e os interesses (a lista do guia vem depois, por cidade)
// a imagem de cada categoria (3.33, migração 180): { categoria: url }; um banco sem a tabela não derruba a tela
async function lerImagensDasCategorias() {
  try {
    const { data, error } = await supabase.from('guia_categorias').select('categoria, foto')
    if (error) return {}
    const m = {}
    for (const r of data ?? []) if (r?.categoria && r.foto) m[r.categoria] = r.foto
    return m
  } catch { return {} }
}
// 3.37: as regiões e o vínculo de cada cidade (migração 182); num banco sem as tabelas, null (a tela agrupa pela semente do código)
async function lerRegioesDoGuia() {
  try {
    const [r, v] = await Promise.all([supabase.from('guia_regioes').select('*').order('ordem').order('nome'), supabase.from('guia_cidades_regiao').select('cidade_slug, regiao_slug')])
    if (r.error || v.error) return null
    return { regioes: r.data ?? [], vinculos: Object.fromEntries((v.data ?? []).map((x) => [x.cidade_slug, x.regiao_slug])) }
  } catch { return null }
}
const lerBase = () => Promise.all([
  lerResumo(),
  lerTudo('guia_paginas', '*', 'cidade_slug'),
  lerTudo('guia_interesses', '*', 'criado_em'),
  lerImagensDasCategorias(),
  lerRegioesDoGuia(),
])
const SEM_TABELA_182 = (e) => (/guia_regioes|guia_cidades_regiao/.test(String(e?.message ?? e)) && /exist|schema cache|could not find|relation/i.test(String(e?.message ?? e)) ? 'O banco ainda não tem as regiões. Rode a migração 182 (supabase/182_regioes.sql).' : String(e?.message ?? e))

// a cidade escolhida fica no aparelho
const CIDADE_LEMBRADA = 'mimo-guia-cidade'
const cidadeLembrada = () => { try { return localStorage.getItem(CIDADE_LEMBRADA) } catch { return null } }
const lembrarCidade = (c) => { try { localStorage.setItem(CIDADE_LEMBRADA, c) } catch { /* sem storage */ } }
// a cidade com que a tela abre: a lembrada; senão a com mais trabalho esperando; uma só, ela; sem a 174 (ou sem salão), todas
function cidadeInicial(resumo) {
  if (!Array.isArray(resumo) || !resumo.length) return ''
  if (resumo.length === 1) return resumo[0].cidade_slug
  const lembrada = cidadeLembrada()
  if (lembrada === '' || resumo.some((r) => r.cidade_slug === lembrada)) return lembrada
  return [...resumo].sort((a, b) => (b.revisar + b.nova + b.gerar) - (a.revisar + a.nova + a.gerar) || b.total - a.total)[0].cidade_slug
}
// os totais de uma lista por fase, no formato de guia_resumo()
function contarFases(ls, base = {}) {
  const r = { ...base, total: 0, gerar: 0, revisar: 0, nova: 0, no_ar: 0, descartados: 0, removidos: 0, categorias: {} }
  for (const l of ls) {
    const f = faseDe(l)
    if (f !== 'removido') r.total++
    if (f === 'gerar') r.gerar++
    else if (f === 'revisar') r.revisar++
    else if (f === 'descartado') r.descartados++
    else if (f === 'removido') r.removidos++
    else { r.no_ar++; if (f === 'nova') r.nova++; r.categorias[l.categoria] = (r.categorias[l.categoria] ?? 0) + 1 }
  }
  return r
}
const somarResumo = (linhas) => {
  const r = { total: 0, gerar: 0, revisar: 0, nova: 0, no_ar: 0, descartados: 0, removidos: 0 }
  for (const x of linhas) for (const k of Object.keys(r)) r[k] += Number(x[k] ?? 0)
  return r
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const NADA = Object.freeze([]) // a lista vazia de sempre (a mesma referência: os efeitos não repetem)
const sem = (obj, k) => { if (!(k in obj)) return obj; const n = { ...obj }; delete n[k]; return n }
const agora = () => new Date().toISOString()

// espera os segundos que o provedor pediu, contando para a tela; para se cancelarem
async function contagem(segundos, aoContar, cancelado) {
  for (let s = Math.max(1, Math.ceil(Number(segundos) || 20)); s > 0; s--) {
    if (cancelado?.()) return
    aoContar(s)
    await dormir(1000)
  }
  aoContar(0)
}

// um número do topo, que também é atalho para a fila dele
function Num({ n, rotulo, sub, tom, onClick, carregando }) {
  return (
    <button type="button" className={'pg-kpi ' + (tom ?? '')} onClick={onClick} disabled={carregando}>
      <strong>{carregando ? '–' : n}</strong><span>{rotulo}</span>{sub && <small>{sub}</small>}
    </button>
  )
}

export default function Guia() {
  const { user } = useAuth()
  const [aba, setAba] = useState('revisar')
  const [ia, setIaBruta] = useState(iaLembrada) // 3.27: Gemini ou Groq
  const iaRef = useRef(ia)
  useEffect(() => { iaRef.current = ia }, [ia])
  const setIa = useCallback((v) => { setIaBruta(v); lembrarIa(v) }, [])
  // 3.34: o modelo de cada IA (vazio = o padrão do segredo), lembrado no aparelho; vai no pedido como "modelo"
  const [modelos, setModelosBruto] = useState(() => Object.fromEntries(IAS.map(([id]) => [id, modeloLembrado(id)])))
  const modelosRef = useRef(modelos)
  useEffect(() => { modelosRef.current = modelos }, [modelos])
  const setModelo = useCallback((id, m) => { setModelosBruto((x) => ({ ...x, [id]: m })); lembrarModelo(id, m) }, [])
  // 3.25: os totais por cidade (174), a cidade escolhida e a lista daquela cidade
  const [resumo, setResumo] = useState(null)      // null = lendo; false = banco sem a 174 (tudo de uma vez); [] = por cidade
  const [cidade, setCidade] = useState(null)      // null até saber as cidades; '' = todas; o slug
  const [carga, setCarga] = useState({ cidade: null, lista: null, parcial: false, teto: false }) // a lista lida e de que cidade ela é; parcial: ainda chegando (3.36); chave: a consulta, em "todas" (3.38)
  // 3.38: em "todas as cidades" a lista é uma página de POR_PAGINA pedida pela aba: { aba, pagina, paginas, total, lendo, erro }
  const [consulta, setConsulta] = useState(null)
  const [extras, setExtras] = useState(() => new Map()) // salões fora da lista carregada que a tela cita (os dos interesses)
  const cacheRef = useRef(new Map())              // cidade -> lista, para voltar sem ler de novo
  // 3.38: em "todas" vale só a página pedida pela aba (carga.cidade === ''); a lista de uma cidade que ficou não conta
  const lugares = carga.cidade !== null && carga.cidade === cidade ? carga.lista : cidade === '' ? NADA : null
  const [paginas, setPaginas] = useState(null)
  const [interesses, setInteresses] = useState(null)
  const [imagensCategorias, setImagensCategorias] = useState({}) // 3.33: { categoria: url } (guia_categorias, migração 180)
  const [regioesDb, setRegioesDb] = useState(null) // 3.37: { regioes, vinculos: { cidade_slug: regiao_slug } } ou null (sem a 182)
  const [erro, setErro] = useState('')
  const [gerando, setGerando] = useState({})   // id -> { espera: segundos de limite }
  const [falhas, setFalhas] = useState({})     // id -> mensagem de erro da última geração
  const [lote, setLote] = useState(null)       // o "gerar todos da fila"
  const [aviso, setAviso] = useState(null)     // o recado de baixo ("está no ar · Desfazer")
  // as métricas (3.11): visitas e contatos por página, do período escolhido
  const [desempenho, setDesempenho] = useState({ dias: 30, dados: null, carregando: true, erro: '' })
  // os filtros e a seleção da aba Revisar moram aqui: trocar de aba não perde o lugar na fila
  const [rev, setRev] = useState({ status: null, cidade: '', bairro: '', categoria: '', receita: false, selecao: false, triagem: '', busca: '', ordem: 'selecao', selId: null, pagina: 1 })

  const lugaresRef = useRef(lugares)
  useEffect(() => { lugaresRef.current = lugares }, [lugares])
  const cidadeRef = useRef(cidade)
  useEffect(() => { cidadeRef.current = cidade }, [cidade])
  const resumoRef = useRef(resumo)
  useEffect(() => { resumoRef.current = resumo }, [resumo])
  const cargaRef = useRef(carga)
  useEffect(() => { cargaRef.current = carga }, [carga])
  const extrasRef = useRef(extras)
  useEffect(() => { extrasRef.current = extras }, [extras])
  // um salão pelo id: na lista carregada ou entre os que vieram à parte
  const achar = useCallback((id) => (lugaresRef.current ?? []).find((x) => x.id === id) ?? extrasRef.current.get(id) ?? null, [])
  const gerandoRef = useRef(gerando)
  useEffect(() => { gerandoRef.current = gerando }, [gerando])
  const loteCtl = useRef(null)
  const montado = useRef(true)

  // a base (totais, páginas, interesses): na abertura e ao ler de novo (depois de importar ou do lote)
  const aplicarBase = useCallback(([r, p, i, m, rg]) => {
    if (!montado.current) return
    setResumo(r); setPaginas(p); setInteresses(i); setImagensCategorias(m ?? {}); setRegioesDb(rg ?? null); setErro('')
    // a cidade: a lembrada ou a com mais trabalho; a escolhida some do resumo (apagou a cidade) -> outra
    setCidade((c) => (c === null || (c && Array.isArray(r) && !r.some((x) => x.cidade_slug === c)) ? cidadeInicial(r) : c))
    // os salões que os interesses citam, de qualquer cidade (a lista carregada é de uma só)
    const ids = [...new Set((i ?? []).map((x) => x.lugar_id).filter(Boolean))]
    if (ids.length) lerLugaresPorId(ids).then((ls) => { if (montado.current) setExtras(new Map(ls.map((l) => [l.id, l]))) }).catch(() => {})
  }, [])
  const falhouLeitura = useCallback((e) => {
    if (!montado.current) return
    const msg = String(e?.message ?? e)
    setErro(/guia_(lugares|paginas|interesses)/.test(msg) && /exist|schema cache/i.test(msg) ? 'As tabelas do guia ainda não existem neste banco. Rode a migração 153 (supabase/153_guia_de_saloes.sql).' : msg)
    setResumo((x) => x ?? false); setCidade((c) => c ?? ''); setPaginas((x) => x ?? []); setInteresses((x) => x ?? [])
  }, [])
  // a lista da cidade escolhida: da memória, se já veio; senão do banco (só aquela cidade)
  const pedidoLista = useRef(0)
  useEffect(() => {
    // 3.38: em "todas as cidades" quem pede a lista é a aba, página por página (consultarGlobal)
    if (cidade === null || cidade === '' || (carga.cidade === cidade && carga.lista)) return
    const guardada = cacheRef.current.get(cidade)
    if (guardada) { setCarga({ cidade, lista: guardada }); return }
    const n = ++pedidoLista.current
    const vale = () => montado.current && n === pedidoLista.current && cidadeRef.current === cidade
    // 3.36: cada fatia de mil já aparece na tela; a lista fica "parcial" até a última chegar
    const aoReceber = (lista, fim) => { if (!fim && vale()) setCarga({ cidade, lista, parcial: true, teto: false }) }
    lerLugares(cidade, aoReceber).then(
      ({ lista, teto }) => { if (vale()) setCarga({ cidade, lista, parcial: false, teto }) },
      (e) => { if (vale()) { falhouLeitura(e); setCarga({ cidade, lista: [], parcial: false, teto: false }) } },
    )
  }, [cidade, carga, falhouLeitura])
  useEffect(() => { if (carga.lista && carga.cidade && !carga.parcial) cacheRef.current.set(carga.cidade, carga.lista) }, [carga])
  // 3.38: uma página de "todas as cidades", com os filtros e a ordem da aba. pedido: { aba, filtros, ordem, pagina }.
  // A mesma consulta já na tela (ou a caminho) não vai de novo; forcar relê (o botão "ler de novo")
  const pedidoGlobal = useRef(0)
  const emVooRef = useRef(null)
  const ultimaConsultaRef = useRef(null)
  const consultarGlobal = useCallback(async (pedido, { forcar = false } = {}) => {
    const chave = JSON.stringify(pedido)
    ultimaConsultaRef.current = pedido
    const c = cargaRef.current
    if (!forcar && (emVooRef.current === chave || (c.cidade === '' && c.lista && c.chave === chave))) return
    const n = ++pedidoGlobal.current
    emVooRef.current = chave
    setConsulta((x) => ({ aba: pedido.aba, pagina: pedido.pagina ?? 1, paginas: x?.paginas ?? 1, total: x?.total ?? 0, porPagina: POR_PAGINA, lendo: true, erro: '' }))
    const vale = () => montado.current && n === pedidoGlobal.current && cidadeRef.current === ''
    try {
      const r = await consultaGlobal({ cliente: supabase, colunas: COLUNAS_LISTA, filtros: pedido.filtros, ordem: pedido.ordem, pagina: pedido.pagina })
      if (!vale()) return
      emVooRef.current = null
      setCarga({ cidade: '', lista: semTexto(r.lista), parcial: false, teto: false, chave })
      setConsulta({ aba: pedido.aba, pagina: r.pagina, paginas: r.paginas, total: r.total, porPagina: POR_PAGINA, lendo: false, erro: '' })
    } catch (e) {
      if (!vale()) return
      emVooRef.current = null
      const msg = String(e?.message ?? e)
      const texto = /guia_lista/.test(msg) && /exist|schema cache/i.test(msg) ? 'A lista de todas as cidades por páginas precisa das migrações 171 a 183 (supabase/183_lista_paginada.sql).' : msg
      setErro(texto)
      setCarga({ cidade: '', lista: [], parcial: false, teto: false, chave })
      setConsulta({ aba: pedido.aba, pagina: pedido.pagina ?? 1, paginas: 1, total: 0, porPagina: POR_PAGINA, lendo: false, erro: texto })
    }
  }, [])
  // trocar de cidade (o seletor do topo, a importação, um salão pedido de outra aba)
  const escolherCidade = useCallback((slug) => {
    const s = String(slug ?? '')
    const r = resumoRef.current
    if (s && Array.isArray(r) && !r.some((x) => x.cidade_slug === s)) return
    setCidade(s); lembrarCidade(s)
  }, [])
  // ler de novo do banco: a base e a cidade atual (as outras saem da memória)
  const carregar = useCallback(async () => {
    cacheRef.current.clear()
    const c = cidadeRef.current ?? ''
    try {
      // 3.38: em "todas" a base de novo e a mesma página de novo
      if (c === '') {
        aplicarBase(await lerBase())
        if (ultimaConsultaRef.current) await consultarGlobal(ultimaConsultaRef.current, { forcar: true })
        return
      }
      // lerLugares devolve { lista, teto } (3.36); a carga guarda a lista (passar o objeto quebrava a tela ao ler de novo)
      const [base, r] = await Promise.all([lerBase(), lerLugares(c)])
      aplicarBase(base)
      if (montado.current && cidadeRef.current === c) setCarga({ cidade: c, lista: r.lista, parcial: false, teto: r.teto })
    } catch (e) { falhouLeitura(e) }
  }, [aplicarBase, falhouLeitura, consultarGlobal])

  // quem trabalha na Plataforma não conta como visita no site (dá para desligar na aba Desempenho)
  useEffect(() => { naoContarAqui(true) }, [])

  useEffect(() => {
    montado.current = true
    lerBase().then(aplicarBase, falhouLeitura)
    return () => { montado.current = false; if (loteCtl.current) loteCtl.current.cancelado = true }
  }, [aplicarBase, falhouLeitura])

  // sair da tela no meio do lote para a geração: avisa antes de fechar a aba
  useEffect(() => {
    if (!lote || lote.fim) return
    const segurar = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', segurar)
    return () => window.removeEventListener('beforeunload', segurar)
  }, [lote])

  // outra aba começa do topo (a coluna da Plataforma guarda a rolagem da anterior)
  useEffect(() => { document.querySelector('.plat-principal')?.scrollTo({ top: 0 }) }, [aba])

  // o recado some sozinho
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), aviso.acao ? 7000 : 4000)
    return () => clearTimeout(t)
  }, [aviso])

  const mudarLocal = useCallback((id, mudar) => {
    const aplicar = (l) => {
      const campos = typeof mudar === 'function' ? mudar(l) : mudar
      const n = { ...l, ...campos }
      // as flags acompanham o texto que a tela mexeu (3.23)
      if ('conteudo' in campos) n.tem_conteudo = !!n.conteudo
      if ('rascunho' in campos) n.tem_rascunho = !!n.rascunho
      return n
    }
    setCarga((c) => (c.lista && c.lista.some((l) => l.id === id) ? { ...c, lista: c.lista.map((l) => (l.id === id ? aplicar(l) : l)) } : c))
    setExtras((m) => (m.has(id) ? new Map(m).set(id, aplicar(m.get(id))) : m))
  }, [])

  // o texto de um salão (conteudo e rascunho), lido quando a tela precisa dele: ao escolher na fila,
  // ao editar, ao aprovar. Uma linha por vez; a promessa em andamento é reaproveitada
  const lendoTexto = useRef(new Map())
  const carregarTexto = useCallback((id) => {
    const l = achar(id)
    if (!l) return Promise.resolve(null)
    if (l.texto_carregado) return Promise.resolve(l)
    if (lendoTexto.current.has(id)) return lendoTexto.current.get(id)
    const p = (async () => {
      // 3.36: a lista vem magra (sem horarios, servicos, atributos, origem); ao abrir, a linha inteira, com o texto
      const { data, error } = await supabase.from('guia_lugares').select('*').eq('id', id).maybeSingle()
      if (error) throw error
      const campos = { ...(data ?? {}), conteudo: data?.conteudo ?? null, rascunho: data?.rascunho ?? null, tem_conteudo: !!data?.conteudo, tem_rascunho: !!data?.rascunho, texto_carregado: true }
      mudarLocal(id, campos)
      return { ...l, ...campos }
    })().finally(() => lendoTexto.current.delete(id))
    lendoTexto.current.set(id, p)
    return p
  }, [mudarLocal, achar])

  // grava campos de um salão e espelha na lista (o demo não guarda escrita; a tela sim)
  const salvarLugar = useCallback(async (id, campos) => {
    const { error } = await supabase.from('guia_lugares').update(campos).eq('id', id)
    if (error) return { ok: false, erro: error.message }
    mudarLocal(id, { ...campos, atualizado_em: agora() })
    return { ok: true }
  }, [mudarLocal])

  // gerar (ou gerar de novo) o texto de um salão, esperando o limite do Groq quando ele pedir
  const gerarUm = useCallback(async (id, { instrucao = '', angulo = '', cancelado } = {}) => {
    setFalhas((f) => sem(f, id))
    setGerando((g) => ({ ...g, [id]: { espera: 0 } }))
    const desde = Date.now()
    try {
      for (let tentativa = 0; ; tentativa++) {
        const r = await chamarGerador({ lugar: id, provedor: iaRef.current, ...modeloDoPedido(modelosRef.current[iaRef.current]), ...(instrucao.trim() ? { instrucao: instrucao.trim().slice(0, 400) } : {}), ...(angulo ? { angulo } : {}) })
        if (r?.rede && !isDemo) { const salvo = await rascunhoGravadoDepois('guia_lugares', id, desde).catch(() => null); if (salvo) { r.ok = true; r.rascunho = salvo } }
        if (r?.ok && r.rascunho) {
          mudarLocal(id, (l) => ({
            rascunho: r.rascunho,
            gerado_em: r.rascunho?._meta?.gerado_em ?? agora(),
            status: l.status === 'importado' || l.status === 'descartado' ? 'gerado' : l.status,
          }))
          return { ok: true }
        }
        if (r?.tentar_em && tentativa < 3 && !cancelado?.()) {
          await contagem(r.tentar_em, (s) => setGerando((g) => (g[id] ? { ...g, [id]: { espera: s } } : g)), cancelado)
          if (cancelado?.()) return { ok: false, cancelado: true }
          continue
        }
        const msg = r?.erro || (r?.ok ? 'a função respondeu sem o texto' : 'não deu para gerar')
        setFalhas((f) => ({ ...f, [id]: msg }))
        return { ok: false, erro: msg }
      }
    } finally {
      if (montado.current) setGerando((g) => sem(g, id))
    }
  }, [mudarLocal])

  // montar a página de um salão com os dados dele (sem IA, na hora). ctx: a
  // cidade em números; o lote passa pronto para não recontar a cada salão
  const montarUm = useCallback(async (id, ctxPronto = null) => {
    setFalhas((f) => sem(f, id))
    const l = achar(id)
    if (!l) return { ok: false, erro: 'salão não encontrado' }
    const ctx = ctxPronto ?? contextoDaCidade(lugaresRef.current, l.cidade_slug)
    const rascunho = montarConteudo({ ...l, na_mimo: !!l.salon_id }, ctx)
    const r = await salvarLugar(id, { rascunho, gerado_em: rascunho._meta.gerado_em, ...(l.status === 'importado' ? { status: 'gerado' } : {}) })
    if (!r.ok) setFalhas((f) => ({ ...f, [id]: r.erro }))
    return r
  }, [salvarLugar, achar])

  // o lote ("Montar todas da fila"; com modo 'ia', a IA escreve uma por vez):
  // na ordem da lista; pausa, cancela e, na IA, espera o limite
  const iniciarLote = useCallback(async (ids, modo = 'montar') => {
    if (!ids.length || (loteCtl.current && !loteCtl.current.fim)) return
    const ctl = { pausado: false, cancelado: false, fim: false }
    loteCtl.current = ctl
    setLote({ modo, total: ids.length, feitos: 0, erros: [], atual: null, pausado: false, fim: false })
    const contextos = new Map()
    for (const id of ids) {
      while (ctl.pausado && !ctl.cancelado) await dormir(250)
      if (ctl.cancelado) break
      const l = achar(id)
      // alguém gerou, editou ou descartou enquanto o lote andava: pula
      if (!l || temTexto(l) || l.status === 'removido' || l.status === 'descartado' || gerandoRef.current[id]) {
        setLote((s) => ({ ...s, feitos: s.feitos + 1 }))
        continue
      }
      setLote((s) => ({ ...s, atual: id }))
      if (modo === 'montar' && !contextos.has(l.cidade_slug)) contextos.set(l.cidade_slug, contextoDaCidade(lugaresRef.current, l.cidade_slug))
      const r = modo === 'montar' ? await montarUm(id, contextos.get(l.cidade_slug)) : await gerarUm(id, { cancelado: () => ctl.cancelado })
      if (r.cancelado) break
      setLote((s) => ({ ...s, feitos: s.feitos + 1, erros: r.ok ? s.erros : [...s.erros, id] }))
    }
    ctl.fim = true
    if (montado.current) setLote((s) => ({ ...s, atual: null, fim: true, cancelado: ctl.cancelado }))
  }, [gerarUm, montarUm, achar])
  const pausarLote = useCallback((pausar) => {
    if (!loteCtl.current) return
    loteCtl.current.pausado = pausar
    setLote((s) => (s ? { ...s, pausado: pausar } : s))
  }, [])
  const cancelarLote = useCallback(() => { if (loteCtl.current) { loteCtl.current.cancelado = true; loteCtl.current.pausado = false } }, [])
  const fecharLote = useCallback(() => setLote(null), [])

  // aprovar: a versão em revisão vai para o ar. Guarda o antes para o "Desfazer".
  const aprovar = useCallback(async (id) => {
    // o texto tem de estar na mão: a lista vem sem ele (3.23) e o "Desfazer" devolve o que estava
    await carregarTexto(id).catch(() => null)
    // cópia: no demo a RPC mexe na própria linha em memória
    const achado = achar(id)
    const antes = achado ? { ...achado } : null
    const { data, error } = await supabase.rpc('guia_aprovar', { lugar_: id })
    if (error) return { ok: false, erro: /nada para aprovar/.test(error.message) ? 'Ainda não há texto para aprovar: gere a página primeiro.' : error.message }
    mudarLocal(id, (l) => ({
      conteudo: l.rascunho ?? l.conteudo, rascunho: null, status: 'publicado', motivo: null,
      publicado_em: l.publicado_em ?? data?.publicado_em ?? agora(), atualizado_em: data?.atualizado_em ?? agora(),
    }))
    return { ok: true, antes }
  }, [mudarLocal, carregarTexto, achar])
  const desfazerAprovacao = useCallback(async (antes) => {
    if (!antes) return { ok: false }
    return salvarLugar(antes.id, { conteudo: antes.conteudo, rascunho: antes.rascunho, status: antes.status, publicado_em: antes.publicado_em, motivo: antes.motivo })
  }, [salvarLugar])

  // ---- páginas da cidade e das categorias ----
  const mudarPagina = useCallback((id, campos) => setPaginas((ps) => (ps ?? []).map((p) => (p.id === id ? { ...p, ...campos } : p))), [])
  const gerarPagina = useCallback(async (id, instrucao = '') => {
    setFalhas((f) => sem(f, id))
    setGerando((g) => ({ ...g, [id]: { espera: 0 } }))
    const desde = Date.now()
    try {
      for (let tentativa = 0; ; tentativa++) {
        const r = await chamarGerador({ pagina: id, provedor: iaRef.current, ...modeloDoPedido(modelosRef.current[iaRef.current]), ...(instrucao.trim() ? { instrucao: instrucao.trim().slice(0, 400) } : {}) })
        if (r?.rede && !isDemo) { const salvo = await rascunhoGravadoDepois('guia_paginas', id, desde).catch(() => null); if (salvo) { r.ok = true; r.rascunho = salvo } }
        if (r?.ok && r.rascunho) { mudarPagina(id, { rascunho: r.rascunho, gerado_em: r.rascunho?._meta?.gerado_em ?? agora() }); return { ok: true } }
        if (r?.tentar_em && tentativa < 3) { await contagem(r.tentar_em, (s) => setGerando((g) => (g[id] ? { ...g, [id]: { espera: s } } : g))); continue }
        const msg = r?.erro || 'não deu para gerar'
        setFalhas((f) => ({ ...f, [id]: msg }))
        return { ok: false, erro: msg }
      }
    } finally {
      if (montado.current) setGerando((g) => sem(g, id))
    }
  }, [mudarPagina])
  // "Sugerir com a IA" (3.28): a IA escreve o "Sobre a cidade" a partir do que sabe da cidade e dos bairros do guia.
  // Não grava: a tela mostra, com a lista do que conferir, e a pessoa guarda
  // gravar (3.30): a função grava (origem "ia", com as fontes da pesquisa) e a tela espelha
  const sugerirContexto = useCallback(async (id, { gravar = false } = {}) => {
    const k = `ctx:${id}`
    setFalhas((f) => sem(f, k))
    setGerando((g) => ({ ...g, [k]: { espera: 0 } }))
    try {
      for (let tentativa = 0; ; tentativa++) {
        const r = await chamarGerador({ contexto: id, provedor: iaRef.current, ...modeloDoPedido(modelosRef.current[iaRef.current]), ...(gravar ? { gravar: true } : {}) })
        if (r?.ok && r.contexto) {
          const fontes = Array.isArray(r.fontes) ? r.fontes.filter((f) => f && f.url).map((f) => ({ titulo: String(f.titulo ?? f.url), url: String(f.url) })) : []
          const confira = Array.isArray(r.confira) ? r.confira.map(String) : []
          if (gravar && r.gravado) mudarPagina(id, { contexto: String(r.contexto), contexto_origem: 'ia', contexto_fontes: { confira, fontes, modelo: r.modelo ?? null, provedor: r.provedor ?? null, pesquisou: !!r.pesquisou, em: agora() } })
          return { ok: true, texto: String(r.contexto), confira, fontes, modelo: r.modelo ?? null, pesquisou: !!r.pesquisou, gravado: !!r.gravado }
        }
        if (r?.tentar_em && tentativa < 3) { await contagem(r.tentar_em, (s) => setGerando((g) => (g[k] ? { ...g, [k]: { espera: s } } : g))); continue }
        const msg = r?.erro || 'não deu para sugerir'
        setFalhas((f) => ({ ...f, [k]: msg }))
        return { ok: false, erro: msg }
      }
    } finally {
      if (montado.current) setGerando((g) => sem(g, k))
    }
  }, [mudarPagina])
  // escrever o "Sobre a cidade" de várias cidades de uma vez (3.30): uma por vez, gravando; o que a equipe editou fica de fora
  const [contextos, setContextos] = useState(null) // { total, feitos, atual, erros: [[cidade, erro]], fim }
  const escreverContextos = useCallback(async (paginas) => {
    if (!paginas.length) return
    setContextos({ total: paginas.length, feitos: 0, atual: paginas[0].cidade, erros: [], fim: false })
    for (const p of paginas) {
      if (!montado.current) return
      setContextos((c) => ({ ...c, atual: p.cidade }))
      const r = await sugerirContexto(p.id, { gravar: true })
      setContextos((c) => ({ ...c, feitos: c.feitos + 1, erros: r.ok ? c.erros : [...c.erros, [p.cidade, r.erro]] }))
    }
    setContextos((c) => ({ ...c, atual: null, fim: true }))
  }, [sugerirContexto])
  // 3.32: campos de uma página de cidade (o texto editado vai no rascunho; a foto da cidade na coluna foto, migração 177)
  const salvarPagina = useCallback(async (id, campos) => {
    const { error } = await supabase.from('guia_paginas').update(campos).eq('id', id)
    if (error) return { ok: false, erro: /\bfoto\b/.test(error.message) && /column|schema cache/i.test(error.message) ? 'O banco ainda não tem a foto da cidade. Rode a migração 177 (supabase/177_foto_da_cidade.sql).' : error.message }
    mudarPagina(id, { ...campos, atualizado_em: agora() })
    return { ok: true }
  }, [mudarPagina])
  // 3.37: as regiões em uso, com as cidades de cada uma (as do banco; sem a 182, a semente do código vale para agrupar)
  const listaRegioes = useMemo(() => (regioesDb ? regioesDb.regioes.map((r) => ({ ...r, cidades: Object.entries(regioesDb.vinculos).filter(([, rs]) => rs === r.slug).map(([c]) => c) })) : null), [regioesDb])
  const regiaoDaCidadeDb = useCallback((slug) => regiaoDaCidade(slug, listaRegioes ?? undefined), [listaRegioes])
  // toda cidade precisa de uma região: vincula (ou desvincula, com '') e, no site, a cidade entra na página da região
  const salvarRegiaoDaCidade = useCallback(async (cidadeSlug, regiaoSlug) => {
    const { error } = regiaoSlug
      ? await supabase.from('guia_cidades_regiao').upsert({ cidade_slug: cidadeSlug, regiao_slug: regiaoSlug }, { onConflict: 'cidade_slug' })
      : await supabase.from('guia_cidades_regiao').delete().eq('cidade_slug', cidadeSlug)
    if (error) return { ok: false, erro: SEM_TABELA_182(error) }
    setRegioesDb((x) => { if (!x) return x; const vinculos = { ...x.vinculos }; if (regiaoSlug) vinculos[cidadeSlug] = regiaoSlug; else delete vinculos[cidadeSlug]; return { ...x, vinculos } })
    return { ok: true }
  }, [])
  // a região que não existe se cria aqui (o nome vira o slug do endereço /saloes/regiao/<slug>)
  const criarRegiao = useCallback(async (nome) => {
    const limpo = String(nome ?? '').trim().slice(0, 60)
    const slug = slugificar(limpo)
    if (!slug) return { ok: false, erro: 'dê um nome à região' }
    const existente = (regioesDb?.regioes ?? []).find((r) => r.slug === slug)
    if (existente) return { ok: true, slug, nome: existente.nome, existia: true }
    const linha = { slug, nome: limpo, uf: 'SP', ordem: 100 }
    const { error } = await supabase.from('guia_regioes').upsert(linha, { onConflict: 'slug' })
    if (error) return { ok: false, erro: SEM_TABELA_182(error) }
    setRegioesDb((x) => (x ? { ...x, regioes: [...x.regioes, { ...linha, foto: null, chamada: null, texto: null, atualizado_em: agora() }] } : x))
    return { ok: true, slug, nome: limpo }
  }, [regioesDb])
  // a página da região: foto, chamada, texto
  const salvarRegiao = useCallback(async (slug, campos) => {
    const { error } = await supabase.from('guia_regioes').update(campos).eq('slug', slug)
    if (error) return { ok: false, erro: SEM_TABELA_182(error) }
    setRegioesDb((x) => (x ? { ...x, regioes: x.regioes.map((r) => (r.slug === slug ? { ...r, ...campos, atualizado_em: agora() } : r)) } : x))
    return { ok: true }
  }, [])
  // 3.33: a imagem de uma categoria, igual para todas as cidades (guia_categorias, migração 180); null tira
  const salvarImagemCategoria = useCallback(async (categoria, foto) => {
    const { error } = await supabase.from('guia_categorias').upsert({ categoria, foto: foto || null }, { onConflict: 'categoria' })
    if (error) return { ok: false, erro: /guia_categorias/.test(error.message) && /exist|schema cache|relation/i.test(error.message) ? 'O banco ainda não tem as imagens das categorias. Rode a migração 180 (supabase/180_imagens_das_categorias.sql).' : error.message }
    setImagensCategorias((m) => { const n = { ...m }; if (foto) n[categoria] = foto; else delete n[categoria]; return n })
    return { ok: true }
  }, [])
  // 3.32: o pedido pronto (sistema + pedido) de um salão ou de uma página, para escrever fora; sem IA
  const pedidoParaIa = useCallback(async (tipo, id) => {
    const r = await chamarGerador({ [tipo === 'lugar' ? 'lugar' : 'pagina']: id, prompt: true })
    if (r?.ok && r.sistema) return { ok: true, sistema: String(r.sistema), pedido: String(r.pedido ?? ''), angulo: r.angulo ?? null }
    return { ok: false, erro: r?.erro || 'não deu para montar o pedido' }
  }, [])
  // 3.32.1: o texto colado ou editado passa pela mesma validação da IA (na função, com a checagem do banco); não grava
  const conferirTexto = useCallback(async (tipo, id, conteudo) => {
    const r = await chamarGerador({ [tipo === 'lugar' ? 'lugar' : 'pagina']: id, conferir: conteudo })
    if (r && Array.isArray(r.problemas)) return { ok: !!r.ok, problemas: r.problemas, avisos: Array.isArray(r.avisos) ? r.avisos : [] }
    return { ok: false, erro: r?.erro || 'não deu para conferir', problemas: [], avisos: [] }
  }, [])
  // "Sobre a cidade" (3.22, migração 170): o que a IA sabe da cidade; não aparece no site. Guardar à mão marca "editado"
  // (3.30): a IA não escreve por cima do que a equipe mexeu
  const salvarContexto = useCallback(async (id, contexto) => {
    const texto = String(contexto ?? '').trim().slice(0, 1500) || null
    let { error } = await supabase.from('guia_paginas').update({ contexto: texto, contexto_origem: texto ? 'editado' : null }).eq('id', id)
    if (error && /contexto_origem/.test(error.message)) ({ error } = await supabase.from('guia_paginas').update({ contexto: texto }).eq('id', id))
    if (error) return { ok: false, erro: /contexto/.test(error.message) && /column|schema cache/i.test(error.message) ? 'O banco ainda não tem o campo "Sobre a cidade". Rode a migração 170 (supabase/170_cidade_com_contexto.sql).' : error.message }
    mudarPagina(id, { contexto: texto, contexto_origem: texto ? 'editado' : null })
    return { ok: true }
  }, [mudarPagina])
  const aprovarPagina = useCallback(async (id) => {
    const { data, error } = await supabase.rpc('guia_aprovar_pagina', { pagina_: id })
    if (error) return { ok: false, erro: error.message }
    setPaginas((ps) => (ps ?? []).map((p) => (p.id === id ? { ...p, conteudo: p.rascunho ?? p.conteudo, rascunho: null, status: 'publicado', publicado_em: p.publicado_em ?? data?.publicado_em ?? agora() } : p)))
    return { ok: true }
  }, [])

  // ---- interesses ----
  const salvarInteresse = useCallback(async (id, campos) => {
    const { error } = await supabase.from('guia_interesses').update(campos).eq('id', id)
    if (error) return { ok: false, erro: error.message }
    setInteresses((is) => (is ?? []).map((i) => (i.id === id ? { ...i, ...campos } : i)))
    return { ok: true }
  }, [])

  // ---- importação ----
  // cada arquivo vai em chamadas separadas (o da Receita depois do Google): dentro
  // de uma chamada, o mesmo place_id aparece uma vez só e o segundo seria ignorado
  const importar = useCallback(async (itens, aplicar, aoAndar) => {
    const soma = { total: 0, validos: 0, novos: 0, atualizados: 0, ignorados: 0, problemas: [] }
    for (let de = 0; de < itens.length; de += 300) {
      const fatia = itens.slice(de, de + 300)
      aoAndar?.(de, itens.length)
      const { data, error } = await supabase.rpc('guia_importar', { itens: fatia, aplicar })
      if (error) return { ok: false, erro: error.message, parcial: soma, feitos: de }
      const r = data ?? {}
      for (const k of ['total', 'validos', 'novos', 'atualizados', 'ignorados']) soma[k] += Number(r[k] ?? 0)
      for (const p of r.problemas ?? []) soma.problemas.push({ ...p, posicao: de + Number(p.indice ?? 1) - 1 })
    }
    aoAndar?.(itens.length, itens.length)
    return { ok: true, ...soma }
  }, [])

  const avisar = useCallback((a) => setAviso(typeof a === 'string' ? { texto: a } : a), [])

  // ---- desempenho (156) ----
  // trocou de período duas vezes seguidas: só a resposta do último pedido vale
  const pedidoDesempenho = useRef(0)
  const aplicarDesempenho = useCallback((n, r) => { if (montado.current && n === pedidoDesempenho.current) setDesempenho({ ...r, carregando: false }) }, [])
  // trocar o período: a tela segura os números de antes, esmaecidos, até chegarem os novos
  // cidade (3.18): os números de um município só; vazio é o guia inteiro
  const carregarDesempenho = useCallback((dias = 30, cidade = '') => {
    const n = ++pedidoDesempenho.current
    setDesempenho((d) => ({ ...d, dias, cidade, carregando: true, erro: '' }))
    return lerDesempenho(dias, cidade).then((r) => aplicarDesempenho(n, r))
  }, [aplicarDesempenho])
  // 3.25: o Desempenho abre na cidade escolhida no alto e a acompanha (a aba ainda deixa trocar)
  const diasRef = useRef(30)
  useEffect(() => { diasRef.current = desempenho.dias }, [desempenho.dias])
  useEffect(() => { if (cidade !== null) carregarDesempenho(diasRef.current, cidade) }, [cidade, carregarDesempenho])
  // os números de cada salão, para o painel da revisão
  // (a primeira linha de cada salão, a de mais visitas, é a que vale)
  const desempenhoPorLugar = useMemo(() => {
    const m = new Map()
    for (const p of desempenho.dados?.paginas ?? []) if (p.lugar_id && !m.has(p.lugar_id)) m.set(p.lugar_id, p)
    return m
  }, [desempenho.dados])

  // os totais por cidade, com a cidade carregada contada ao vivo (aprovar, descartar e importar mexem na hora)
  const resumoVivo = useMemo(() => {
    // 3.36: em "todas" a lista é só a fila, e uma lista parcial ainda não conta: valem os totais do banco
    if (!Array.isArray(resumo) || !lugares || cidade === '' || carga.parcial) return resumo
    return resumo.map((r) => (r.cidade_slug === cidade ? contarFases(lugares, r) : r))
  }, [resumo, lugares, cidade, carga.parcial])
  // as cidades do guia, para o seletor e para as abas (nome por slug)
  const cidades = useMemo(() => {
    const base = Array.isArray(resumoVivo)
      ? resumoVivo.map((r) => ({ slug: r.cidade_slug, nome: r.cidade, total: r.total, esperando: r.revisar + r.nova, gerar: r.gerar }))
      : [...new Map((lugares ?? []).map((l) => [l.cidade_slug, l.cidade]))].map(([slug, nome]) => ({ slug, nome, total: 0, esperando: 0, gerar: 0 }))
    return base.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [resumoVivo, lugares])
  const totalGeral = Array.isArray(resumoVivo) ? resumoVivo.reduce((n, r) => n + Number(r.total ?? 0), 0) : 0

  // os números do topo: da lista carregada (inteira para a cidade); antes de ela chegar, dos totais do banco
  const kpis = useMemo(() => {
    const n = lugares && cidade && !carga.parcial ? contarFases(lugares) : Array.isArray(resumo) ? somarResumo(cidade ? resumo.filter((r) => r.cidade_slug === cidade) : resumo) : lugares ? contarFases(lugares) : null
    return {
      pronto: !!n,
      importados: n?.total ?? 0,
      gerar: n?.gerar ?? 0,
      revisao: (n?.revisar ?? 0) + (n?.nova ?? 0),
      soNova: (n?.revisar ?? 0) === 0,
      noAr: n?.no_ar ?? 0,
      descartados: n?.descartados ?? 0,
      interesses: (interesses ?? []).filter((i) => !i.atendido_em).length,
    }
  }, [lugares, resumo, cidade, interesses, carga.parcial])

  // a cidade de um salão que não está na lista carregada (uma linha do banco)
  const cidadeDoLugar = useCallback(async (id) => {
    const l = extrasRef.current.get(id)
    if (l) return l.cidade_slug
    const { data } = await supabase.from('guia_lugares').select('cidade_slug').eq('id', id).maybeSingle()
    return data?.cidade_slug ?? null
  }, [])
  // um clique num número leva à fila certa. filtro.emCidade (3.25): o salão pedido é de outra cidade; a tela troca antes
  const irPara = useCallback((destino, filtro) => {
    setAba(destino)
    if (destino !== 'revisar' || !filtro) return
    const { emCidade, ...f } = filtro
    // indo para um salão certo, os outros filtros saem do caminho para ele aparecer
    const limpo = { busca: '', cidade: '', bairro: '', categoria: '', receita: false, selecao: false, triagem: '' }
    const aplicar = () => setRev((r) => ({ ...r, ...(f.selId ? limpo : {}), ...f, selId: f.selId ?? null, pagina: 1 }))
    // 3.38: em "todas as cidades" a lista é uma página; o salão pedido que não está nela abre na cidade dele
    if (!f.selId || (lugaresRef.current ?? []).some((l) => l.id === f.selId)) { aplicar(); return }
    const ir = (slug) => { if (slug && slug !== cidadeRef.current) escolherCidade(slug); aplicar() }
    if (emCidade) ir(emCidade)
    else cidadeDoLugar(f.selId).then(ir, () => aplicar())
  }, [escolherCidade, cidadeDoLugar])

  const g = {
    lugares: lugares ?? [], paginas: paginas ?? [], interesses: interesses ?? [], carregando: lugares === null, lendo: !!carga.parcial || (cidade === '' && !!consulta?.lendo), listaNoTeto: !!carga.teto, erro,
    cidade: cidade ?? '', cidades, escolherCidade, resumo: resumoVivo, lugarPorId: achar, ia, setIa, modelo: modelos[ia] ?? '', setModelo,
    paginacao: cidade === '' ? consulta : null, consultarGlobal, // 3.38: a página de "todas as cidades" e como pedir outra
    faseDe, temTexto, temRascunho, temConteudo, carregarTexto, gerando, falhas, lote, usuario: user?.id ?? null,
    carregar, salvarLugar, montarUm, gerarUm, iniciarLote, pausarLote, cancelarLote, fecharLote, aprovar, desfazerAprovacao,
    gerarPagina, aprovarPagina, salvarContexto, sugerirContexto, escreverContextos, contextos, salvarPagina, pedidoParaIa, conferirTexto, imagensCategorias, salvarImagemCategoria, salvarInteresse, importar, avisar, irPara,
    regioes: listaRegioes, regiaoDaCidade: regiaoDaCidadeDb, salvarRegiaoDaCidade, criarRegiao, salvarRegiao,
    desempenho, carregarDesempenho, desempenhoPorLugar,
  }

  return (
    <Shell>
      <div className="pg-topo">
        <Cabecalho titulo="Guia de salões" sub="Uma página pública para cada salão da região, montada com os dados dele (de graça). Você aprova." direita={<span />} />
        {Array.isArray(resumo) && cidades.length > 1 && (
          <div className="pg-cidade" data-teste="cidade">
            <label className="pg-cidade-sel">
              <MapPin size={15} aria-hidden="true" />
              <select className="plat-select" value={cidade ?? ''} onChange={(e) => escolherCidade(e.target.value)} aria-label="Cidade do guia">
                {agruparPorRegiao(cidades, (c) => c.slug, listaRegioes ?? undefined).map((gr) => (
                  <optgroup key={gr.regiao.slug} label={gr.regiao.slug === 'outras' ? 'Sem região' : gr.regiao.nome}>
                    {gr.cidades.map((c) => <option key={c.slug} value={c.slug}>{c.nome} · {c.total}{c.esperando ? ` · ${c.esperando} para revisar` : ''}</option>)}
                  </optgroup>
                ))}
                <option value="">Todas as cidades</option>
              </select>
              {lugares === null || carga.parcial || (cidade === '' && consulta?.lendo)
                ? <LoaderCircle size={14} className="pg-gira" aria-label="lendo a cidade" />
                : <button type="button" className="pg-cidade-reler" onClick={carregar} title="Ler de novo do banco" aria-label="Ler de novo do banco"><RefreshCw size={14} /></button>}
            </label>
            <small data-teste="cidade-nota">
              {carga.parcial ? `Lendo… ${(lugares ?? []).length} salões já na tela. ` : ''}
              {cidade ? 'Os números e as abas são desta cidade; só a lista dela é lida.' : `Todas as cidades: a lista vem do banco por páginas de ${POR_PAGINA}, já com os filtros da aba (${totalGeral.toLocaleString('pt-BR')} salões no guia).`}
              {carga.teto ? ' A fila passou do teto: escolha uma cidade para ver o resto.' : ''}
            </small>
          </div>
        )}
        <div className="pg-kpis" aria-label="Números do guia">
          <Num carregando={!kpis.pronto} n={kpis.importados} rotulo="importados" sub={kpis.gerar ? `${kpis.gerar} sem página` : null} onClick={() => irPara('revisar', { status: 'gerar' })} />
          <Num carregando={!kpis.pronto} n={kpis.revisao} rotulo="esperando revisão" tom={kpis.revisao ? 'ambar' : ''} onClick={() => irPara('revisar', { status: kpis.soNova && kpis.revisao ? 'nova' : 'revisar' })} />
          <Num carregando={!kpis.pronto} n={kpis.noAr} rotulo="no ar" tom="menta" onClick={() => irPara('publicadas')} />
          <Num carregando={!kpis.pronto} n={kpis.descartados} rotulo="descartados" onClick={() => irPara('revisar', { status: 'descartado' })} />
          <Num carregando={!kpis.pronto} n={kpis.interesses} rotulo="interesses novos" tom={kpis.interesses ? 'rosa' : ''} onClick={() => irPara('interesses')} />
        </div>
      </div>

      <div className="plat-abas-linha pg-abas" role="tablist">
        {ABAS.map(([id, rotulo, Ic]) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} className={aba === id ? 'ativo' : ''} onClick={() => setAba(id)}>
            <Ic size={15} /> {rotulo}
            {id === 'revisar' && kpis.revisao > 0 && <span className="pg-aba-num">{kpis.revisao}</span>}
            {id === 'revisar' && lote && !lote.fim && <span className="pg-aba-lote" title="Gerando em lote">{lote.feitos}/{lote.total}</span>}
            {id === 'interesses' && kpis.interesses > 0 && <span className="pg-aba-num rosa">{kpis.interesses}</span>}
          </button>
        ))}
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}

      {aba === 'revisar' && <Revisar g={g} rev={rev} setRev={setRev} />}
      {aba === 'desempenho' && <Desempenho g={g} />}
      {aba === 'abordagem' && <Abordagem g={g} />}
      {aba === 'publicadas' && <Publicadas g={g} />}
      {aba === 'importar' && <><Importar g={g} /><ImportarFotos g={g} /><MiniaturasAntigas g={g} /></>}
      {aba === 'paginas' && <PaginasCidade g={g} />}
      {aba === 'interesses' && <Interesses g={g} />}

      {aviso && (
        <div className={'pg-recado ' + (aviso.tom ?? '')} role="status">
          <span>{aviso.texto}</span>
          {aviso.acao && <button type="button" onClick={() => { aviso.acao.onClick(); setAviso(null) }}>{aviso.acao.rotulo}</button>}
          <button type="button" className="pg-recado-x" aria-label="Fechar" onClick={() => setAviso(null)}><X size={15} /></button>
        </div>
      )}
    </Shell>
  )
}
