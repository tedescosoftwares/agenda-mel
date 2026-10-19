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
import PaginasCidade from '../../components/plataforma/guia/PaginasCidade'
import Interesses from '../../components/plataforma/guia/Interesses'
import Desempenho from '../../components/plataforma/guia/Desempenho'
import Abordagem from '../../components/plataforma/guia/Abordagem'
import { naoContarAqui } from '../../lib/eventos'
import { ClipboardCheck, Globe2, Upload, MapPinned, Inbox, X, BarChart3, Handshake } from 'lucide-react'
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
const COLUNAS_LUGAR = 'id, cidade, cidade_slug, uf, slug, categoria, nome, bairro, endereco, cep, telefone, whatsapp, instagram, site, horarios, servicos, atributos, place_id, cnpj, validado_receita, selecao, nota, avaliacoes, fontes, origem, fotos, conteudo, rascunho, status, motivo, salon_id, gerado_em, publicado_em, criado_em, atualizado_em'
// 3.23: a lista magra (view guia_lista, migração 171): sem conteudo e rascunho (uns 3 KB a menos por salão; com
// 20 mil salões, 60 MB a menos por abertura). "tem_conteudo" e "tem_rascunho" dizem se existem, e o texto do
// salão é lido quando se abre (carregarTexto). Num banco ainda sem a view, a leitura cheia de antes.
const COLUNAS_LISTA = 'id, cidade, cidade_slug, uf, slug, categoria, nome, bairro, endereco, cep, telefone, whatsapp, instagram, site, horarios, servicos, atributos, place_id, cnpj, validado_receita, selecao, nota, avaliacoes, fontes, origem, fotos, status, motivo, salon_id, gerado_em, publicado_em, criado_em, atualizado_em, tem_conteudo, tem_rascunho, resumo, meta, meta_rascunho'
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

// o Supabase entrega no máximo 1000 linhas por vez; o demo não pagina
async function lerTudo(tabela, colunas, ordem) {
  const todas = []
  for (let de = 0; ; de += 1000) {
    let q = supabase.from(tabela).select(colunas).order(ordem).order('id')
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

// os salões pela lista magra; num banco sem a 171, a leitura cheia (já com o texto)
async function lerLugares() {
  try {
    return (await lerTudo('guia_lista', COLUNAS_LISTA, 'nome')).map((l) => ({ ...l, texto_carregado: false }))
  } catch (e) {
    if (!/guia_lista/.test(String(e?.message ?? e))) throw e
    return (await lerTudo('guia_lugares', COLUNAS_LUGAR, 'nome')).map(comFlags)
  }
}
// tudo o que a tela usa, de uma vez
const lerGuia = () => Promise.all([
  lerLugares(),
  lerTudo('guia_paginas', '*', 'cidade_slug'),
  lerTudo('guia_interesses', '*', 'criado_em'),
])

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
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
  const [lugares, setLugares] = useState(null)
  const [paginas, setPaginas] = useState(null)
  const [interesses, setInteresses] = useState(null)
  const [erro, setErro] = useState('')
  const [gerando, setGerando] = useState({})   // id -> { espera: segundos de limite }
  const [falhas, setFalhas] = useState({})     // id -> mensagem de erro da última geração
  const [lote, setLote] = useState(null)       // o "gerar todos da fila"
  const [aviso, setAviso] = useState(null)     // o recado de baixo ("está no ar · Desfazer")
  // as métricas (3.11): visitas e contatos por página, do período escolhido
  const [desempenho, setDesempenho] = useState({ dias: 30, dados: null, carregando: true, erro: '' })
  // os filtros e a seleção da aba Revisar moram aqui: trocar de aba não perde o lugar na fila
  const [rev, setRev] = useState({ status: null, cidade: '', bairro: '', categoria: '', receita: false, selecao: false, triagem: '', busca: '', ordem: 'selecao', selId: null })

  const lugaresRef = useRef(lugares)
  useEffect(() => { lugaresRef.current = lugares }, [lugares])
  const gerandoRef = useRef(gerando)
  useEffect(() => { gerandoRef.current = gerando }, [gerando])
  const loteCtl = useRef(null)
  const montado = useRef(true)

  // ler de novo (depois de importar); a primeira leitura é a do efeito abaixo
  const aplicarLeitura = useCallback(([l, p, i]) => {
    if (!montado.current) return
    setLugares(l); setPaginas(p); setInteresses(i); setErro('')
  }, [])
  const falhouLeitura = useCallback((e) => {
    if (!montado.current) return
    const msg = String(e?.message ?? e)
    setErro(/guia_(lugares|paginas|interesses)/.test(msg) && /exist|schema cache/i.test(msg) ? 'As tabelas do guia ainda não existem neste banco. Rode a migração 153 (supabase/153_guia_de_saloes.sql).' : msg)
    setLugares((x) => x ?? []); setPaginas((x) => x ?? []); setInteresses((x) => x ?? [])
  }, [])
  const carregar = useCallback(() => lerGuia().then(aplicarLeitura, falhouLeitura), [aplicarLeitura, falhouLeitura])

  // quem trabalha na Plataforma não conta como visita no site (dá para desligar na aba Desempenho)
  useEffect(() => { naoContarAqui(true) }, [])

  useEffect(() => {
    montado.current = true
    lerGuia().then(aplicarLeitura, falhouLeitura)
    return () => { montado.current = false; if (loteCtl.current) loteCtl.current.cancelado = true }
  }, [aplicarLeitura, falhouLeitura])

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
    setLugares((ls) => (ls ?? []).map((l) => {
      if (l.id !== id) return l
      const campos = typeof mudar === 'function' ? mudar(l) : mudar
      const n = { ...l, ...campos }
      // as flags acompanham o texto que a tela mexeu (3.23)
      if ('conteudo' in campos) n.tem_conteudo = !!n.conteudo
      if ('rascunho' in campos) n.tem_rascunho = !!n.rascunho
      return n
    }))
  }, [])

  // o texto de um salão (conteudo e rascunho), lido quando a tela precisa dele: ao escolher na fila,
  // ao editar, ao aprovar. Uma linha por vez; a promessa em andamento é reaproveitada
  const lendoTexto = useRef(new Map())
  const carregarTexto = useCallback((id) => {
    const l = (lugaresRef.current ?? []).find((x) => x.id === id)
    if (!l) return Promise.resolve(null)
    if (l.texto_carregado) return Promise.resolve(l)
    if (lendoTexto.current.has(id)) return lendoTexto.current.get(id)
    const p = (async () => {
      const { data, error } = await supabase.from('guia_lugares').select('conteudo, rascunho').eq('id', id).maybeSingle()
      if (error) throw error
      const campos = { conteudo: data?.conteudo ?? null, rascunho: data?.rascunho ?? null, texto_carregado: true }
      mudarLocal(id, campos)
      return { ...l, ...campos }
    })().finally(() => lendoTexto.current.delete(id))
    lendoTexto.current.set(id, p)
    return p
  }, [mudarLocal])

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
        const r = await chamarGerador({ lugar: id, ...(instrucao.trim() ? { instrucao: instrucao.trim().slice(0, 400) } : {}), ...(angulo ? { angulo } : {}) })
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
    const l = (lugaresRef.current ?? []).find((x) => x.id === id)
    if (!l) return { ok: false, erro: 'salão não encontrado' }
    const ctx = ctxPronto ?? contextoDaCidade(lugaresRef.current, l.cidade_slug)
    const rascunho = montarConteudo({ ...l, na_mimo: !!l.salon_id }, ctx)
    const r = await salvarLugar(id, { rascunho, gerado_em: rascunho._meta.gerado_em, ...(l.status === 'importado' ? { status: 'gerado' } : {}) })
    if (!r.ok) setFalhas((f) => ({ ...f, [id]: r.erro }))
    return r
  }, [salvarLugar])

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
      const l = (lugaresRef.current ?? []).find((x) => x.id === id)
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
  }, [gerarUm, montarUm])
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
    const achado = (lugaresRef.current ?? []).find((l) => l.id === id)
    const antes = achado ? { ...achado } : null
    const { data, error } = await supabase.rpc('guia_aprovar', { lugar_: id })
    if (error) return { ok: false, erro: /nada para aprovar/.test(error.message) ? 'Ainda não há texto para aprovar: gere a página primeiro.' : error.message }
    mudarLocal(id, (l) => ({
      conteudo: l.rascunho ?? l.conteudo, rascunho: null, status: 'publicado', motivo: null,
      publicado_em: l.publicado_em ?? data?.publicado_em ?? agora(), atualizado_em: data?.atualizado_em ?? agora(),
    }))
    return { ok: true, antes }
  }, [mudarLocal, carregarTexto])
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
        const r = await chamarGerador({ pagina: id, ...(instrucao.trim() ? { instrucao: instrucao.trim().slice(0, 400) } : {}) })
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
  // "Sobre a cidade" (3.22, migração 170): o que a IA sabe da cidade; não aparece no site
  const salvarContexto = useCallback(async (id, contexto) => {
    const texto = String(contexto ?? '').trim().slice(0, 1500) || null
    const { error } = await supabase.from('guia_paginas').update({ contexto: texto }).eq('id', id)
    if (error) return { ok: false, erro: /contexto/.test(error.message) && /column|schema cache/i.test(error.message) ? 'O banco ainda não tem o campo "Sobre a cidade". Rode a migração 170 (supabase/170_cidade_com_contexto.sql).' : error.message }
    mudarPagina(id, { contexto: texto })
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
  useEffect(() => { const n = ++pedidoDesempenho.current; lerDesempenho(30).then((r) => aplicarDesempenho(n, r)) }, [aplicarDesempenho])
  // os números de cada salão, para o painel da revisão
  // (a primeira linha de cada salão, a de mais visitas, é a que vale)
  const desempenhoPorLugar = useMemo(() => {
    const m = new Map()
    for (const p of desempenho.dados?.paginas ?? []) if (p.lugar_id && !m.has(p.lugar_id)) m.set(p.lugar_id, p)
    return m
  }, [desempenho.dados])

  // os números do topo
  const kpis = useMemo(() => {
    const ls = lugares ?? []
    const conta = (f) => ls.reduce((n, l) => n + (f(l) ? 1 : 0), 0)
    return {
      importados: conta((l) => l.status !== 'removido'),
      gerar: conta((l) => faseDe(l) === 'gerar'),
      revisao: conta((l) => faseDe(l) === 'revisar' || faseDe(l) === 'nova'),
      soNova: conta((l) => faseDe(l) === 'revisar') === 0,
      noAr: conta((l) => l.status === 'publicado'),
      descartados: conta((l) => l.status === 'descartado'),
      interesses: (interesses ?? []).filter((i) => !i.atendido_em).length,
    }
  }, [lugares, interesses])

  // um clique num número leva à fila certa
  const irPara = useCallback((destino, filtro) => {
    setAba(destino)
    // indo para um salão certo, os outros filtros saem do caminho para ele aparecer
    const limpo = { busca: '', cidade: '', categoria: '', receita: false, selecao: false, triagem: '' }
    if (destino === 'revisar' && filtro) setRev((r) => ({ ...r, ...(filtro.selId ? limpo : {}), ...filtro, selId: filtro.selId ?? null }))
  }, [])

  const g = {
    lugares: lugares ?? [], paginas: paginas ?? [], interesses: interesses ?? [], carregando: lugares === null, erro,
    faseDe, temTexto, temRascunho, temConteudo, carregarTexto, gerando, falhas, lote, usuario: user?.id ?? null,
    carregar, salvarLugar, montarUm, gerarUm, iniciarLote, pausarLote, cancelarLote, fecharLote, aprovar, desfazerAprovacao,
    gerarPagina, aprovarPagina, salvarContexto, salvarInteresse, importar, avisar, irPara,
    desempenho, carregarDesempenho, desempenhoPorLugar,
  }

  return (
    <Shell>
      <div className="pg-topo">
        <Cabecalho titulo="Guia de salões" sub="Uma página pública para cada salão da região, montada com os dados dele (de graça). Você aprova." direita={<span />} />
        <div className="pg-kpis" aria-label="Números do guia">
          <Num carregando={lugares === null} n={kpis.importados} rotulo="importados" sub={kpis.gerar ? `${kpis.gerar} sem página` : null} onClick={() => irPara('revisar', { status: 'gerar' })} />
          <Num carregando={lugares === null} n={kpis.revisao} rotulo="esperando revisão" tom={kpis.revisao ? 'ambar' : ''} onClick={() => irPara('revisar', { status: kpis.soNova && kpis.revisao ? 'nova' : 'revisar' })} />
          <Num carregando={lugares === null} n={kpis.noAr} rotulo="no ar" tom="menta" onClick={() => irPara('publicadas')} />
          <Num carregando={lugares === null} n={kpis.descartados} rotulo="descartados" onClick={() => irPara('revisar', { status: 'descartado' })} />
          <Num carregando={lugares === null} n={kpis.interesses} rotulo="interesses novos" tom={kpis.interesses ? 'rosa' : ''} onClick={() => irPara('interesses')} />
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
      {aba === 'importar' && <><Importar g={g} /><ImportarFotos g={g} /></>}
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
