import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Portal from '../../Portal'
import { Vazio, haQuanto } from '../Pecas'
import { supabase } from '../../../lib/supabase'
import { categoriaDoGuia, semAcento, linkWhatsDoTel, linkInstagram, soDigitosTel } from '../../../lib/guia'
import { urlDoAmbiente } from '../../../lib/ambiente'
import { SITE_GUIA } from '../../../lib/guiaSeo'
import { REGRAS } from '../../../lib/acesso'
import { mensagemParaDono, zapDoDono, formatar, n0 } from '../../../lib/guiaMetricas'
import {
  Send, Phone, AtSign, Footprints, Mail, Search, X, ExternalLink, Copy, Check, LoaderCircle, Keyboard, RotateCcw, ArrowLeft,
  ChevronUp, ChevronDown, AlarmClock, StickyNote, History, Inbox, Handshake, Info, ClipboardCheck, ArrowDownWideNarrow,
} from 'lucide-react'
import '../../../guia-abordagem.css'

// A aba Abordagem do guia (3.12): a fila de trabalho para transformar as
// visitas e os contatos das páginas em clientes da MIMO. Um mini-CRM: com
// quem falar hoje e por quê ("3 pessoas pediram para marcar · 18 tocaram
// no WhatsApp"), mandar a mensagem com os números do período, anotar,
// mudar o status e lembrar de voltar a falar.
//
// A prioridade e os motivos vêm prontos de guia_fila_abordagem() (migração
// 158); cada ação passa por guia_abordagem_registrar(), que guarda o
// histórico e devolve a linha já recalculada. A ordem da lista fica parada
// enquanto se trabalha (para "próximo" ser o próximo de verdade) até
// "Reordenar", trocar de filtro ou de período.

const STATUS = [
  ['a_abordar', 'A abordar', 'cinza'],
  ['abordado', 'Abordado', 'azul'],
  ['respondeu', 'Respondeu', 'roxo'],
  ['negociando', 'Negociando', 'ambar'],
  ['cliente', 'Cliente', 'menta'],
  ['sem_interesse', 'Sem interesse', 'carmim'],
  ['nao_abordar', 'Não abordar', 'pedra'],
]
const ROTULO = Object.fromEntries(STATUS.map(([id, r]) => [id, r]))
const TOM = Object.fromEntries(STATUS.map(([id, , t]) => [id, t]))
const PERIODOS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias']]
const LEMBRAR = [[1, 'Amanhã'], [3, '3 dias'], [7, '1 semana'], [15, '15 dias'], [30, '1 mês']]
const CANAIS = [['ligacao', 'Ligação', Phone], ['instagram', 'Instagram', AtSign], ['presencial', 'Fui lá', Footprints], ['email', 'E-mail', Mail]]
const FEITO = { ligacao: 'ligação registrada', instagram: 'contato pelo Instagram registrado', presencial: 'visita ao salão registrada', email: 'e-mail registrado' }
const ACAO = {
  whatsapp: 'Mandou WhatsApp', ligacao: 'Ligou', instagram: 'Chamou no Instagram', presencial: 'Foi até o salão', email: 'Mandou e-mail',
  nota: 'Anotou', status: 'Mudou o status', lembrete: 'Lembrete',
}
const FORA = {
  cliente: 'Já é cliente da MIMO.',
  remover: 'Pediu para remover a página: não aborde. O pedido está na aba Interesses.',
  sem_interesse: 'Disse que não tem interesse.',
  nao_abordar: 'Marcado para não abordar.',
}
const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

// a última leitura fica guardada: voltar para a aba mostra na hora e atualiza por trás
let memoria = { dias: 30, dados: null, visao: 'fila' }

// ---- datas (o "hoje" vem do banco, no fuso de São Paulo) ----
const somaDias = (dia, n) => new Date(new Date(`${dia}T12:00:00Z`).getTime() + n * 86400e3).toISOString().slice(0, 10)
const entre = (a, b) => Math.round((new Date(`${a}T12:00:00Z`) - new Date(`${b}T12:00:00Z`)) / 86400e3)
const ddmm = (dia) => { const [, m, d] = String(dia).split('-'); return `${d}/${m}` }
function quando(dia, hoje) {
  if (!dia || !hoje) return ''
  const k = entre(dia, hoje)
  if (k === 0) return 'hoje'
  if (k === 1) return 'amanhã'
  if (k === -1) return 'ontem'
  const sem = DIA_SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()]
  return k < 0 ? `${ddmm(dia)} (há ${-k} dias)` : k < 7 ? `${sem}, ${ddmm(dia)}` : ddmm(dia)
}

const ehTelefone = (c) => !!c && !String(c).includes('@') && soDigitosTel(c).length >= 10
const ehEmail = (c) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c ?? '').trim())
const juntar = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}`)
const PITCH = [
  'Dá para receber clientes direto numa agenda online: ela escolhe o serviço e o horário, e vocês recebem tudo organizado, com confirmação pelo WhatsApp.',
  `Para autônoma é grátis para sempre; salão com equipe testa ${REGRAS.testeDias} dias, sem cartão. Posso te mostrar como fica?`,
]

// a mensagem: com os números do período quando a página está no ar e teve visita
// (a mesma de Desempenho, mensagemParaDono); para quem pediu contato ("É o seu
// salão?"), uma resposta ao pedido; sem números, só a apresentação
function montarMensagem(it, { dias, para }) {
  const url = it.status_pagina === 'publicado' ? SITE_GUIA + it.pagina : ''
  const cidade = it.cidade || 'beleza'
  if (para === 'dono' && it.dono) {
    const e = it.eventos ?? {}
    const q = n0(it.pendentes?.quero_marcar)
    const partes = [
      url && n0(it.visitas) ? `a página teve ${formatar(it.visitas)} ${n0(it.visitas) === 1 ? 'visita' : 'visitas'} nos últimos ${dias} dias` : '',
      n0(e.whatsapp) ? `${e.whatsapp} ${e.whatsapp === 1 ? 'pessoa tocou' : 'pessoas tocaram'} para chamar vocês no WhatsApp` : '',
      q ? `${q} ${q === 1 ? 'pessoa pediu' : 'pessoas pediram'} para marcar horário pelo app` : '',
    ].filter(Boolean)
    return [
      `Oi${it.dono.nome ? `, ${it.dono.nome}` : ''}! Tudo bem? Aqui é da MIMO. Você pediu contato sobre ${it.nome} no nosso guia de salões de ${cidade}.`,
      partes.length ? `Para você ter uma ideia: ${juntar(partes)}.` : '',
      ...(it.na_mimo ? [] : PITCH),
      url ? `A página: ${url}` : '',
    ].filter(Boolean).join('\n\n')
  }
  if (url && n0(it.visitas) > 0) return mensagemParaDono(it, { dias, url, cidade })
  return [
    `Oi! Tudo bem? Aqui é da MIMO, um guia de salões de ${cidade}.`,
    url ? `${it.nome} já tem uma página no nosso guia, com endereço, horário e serviços.` : '',
    ...PITCH,
    url ? `A página: ${url}` : '',
  ].filter(Boolean).join('\n\n')
}

// as chamadas ao banco nunca rejeitam: o erro volta em texto (no demo, a regra quebrada sobe como exceção)
async function chamar(nome, args) {
  try {
    const { data, error } = await supabase.rpc(nome, args)
    if (error) return { data: null, erro: textoDoErro(error) }
    return { data, erro: '' }
  } catch (e) {
    return { data: null, erro: textoDoErro(e) }
  }
}
function textoDoErro(e) {
  const msg = String(e?.message ?? e ?? '')
  if (/guia_(fila_abordagem|abordagem)/i.test(msg) && /schema cache|does not exist|could not find/i.test(msg)) return 'A fila de abordagem ainda não existe neste banco. Rode a migração 158 (supabase/158_guia_abordagem.sql).'
  return msg || 'Não deu para falar com o banco.'
}

// ---- a lista: filtro, busca e ordem ----
function passaNaVisao(it, visao, hoje) {
  if (visao === 'todos') return true
  if (visao === 'fila') return it.fila === 'principal'
  if (visao === 'lembretes') return it.fila === 'principal' && !!it.proximo_contato && it.proximo_contato <= hoje
  if (visao === 'pedidos') return it.fila === 'principal' && n0(it.pendentes?.sou_dono) + n0(it.pendentes?.quero_marcar) > 0
  return it.status === visao
}
const textoDeBusca = (it) => semAcento(`${it.nome} ${it.bairro ?? ''} ${categoriaDoGuia(it.categoria).curto} ${it.nota ?? ''} ${it.dono?.nome ?? ''}`).toLowerCase()
function ordenarIds(itens, visao, busca, hoje) {
  const termo = semAcento(busca).toLowerCase().trim()
  const lista = itens.filter((it) => passaNaVisao(it, visao, hoje) && (!termo || textoDeBusca(it).includes(termo)))
  const porPrioridade = (a, b) => (a.fila === 'fora') - (b.fila === 'fora') || b.prioridade - a.prioridade
    || (b.nota_google ?? -1) - (a.nota_google ?? -1) || (b.avaliacoes ?? -1) - (a.avaliacoes ?? -1) || a.nome.localeCompare(b.nome, 'pt-BR')
  // nos lembretes, o mais atrasado primeiro
  lista.sort(visao === 'lembretes' ? (a, b) => String(a.proximo_contato).localeCompare(String(b.proximo_contato)) || porPrioridade(a, b) : porPrioridade)
  return lista.map((it) => it.lugar_id)
}
const calor = (it) => (it.fila !== 'principal' ? 'fora' : it.prioridade >= 100 ? 'quente' : it.prioridade >= 30 ? 'morno' : 'frio')
const CALOR = { quente: 'Prioridade alta', morno: 'Prioridade média', frio: 'Prioridade baixa', fora: 'Fora da fila' }

function useMidia(consulta) {
  const [ok, setOk] = useState(() => typeof window !== 'undefined' && window.matchMedia(consulta).matches)
  useEffect(() => {
    const m = window.matchMedia(consulta)
    const mudar = () => setOk(m.matches)
    mudar()
    m.addEventListener('change', mudar)
    return () => m.removeEventListener('change', mudar)
  }, [consulta])
  return ok
}

export default function Abordagem({ g }) {
  const largo = useMidia('(min-width: 1100px)')
  const [dias, setDias] = useState(memoria.dias)
  const [dados, setDados] = useState(memoria.dados)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [visao, setVisao] = useState(memoria.visao)
  const [busca, setBusca] = useState('')
  // a ordem da lista (ids): só muda quando chega uma leitura completa, troca o filtro ou a busca, ou em "Reordenar"
  const [ordem, setOrdem] = useState(() => (memoria.dados ? ordenarIds(memoria.dados.itens ?? [], memoria.visao, '', memoria.dados.hoje) : []))
  const [mexidos, setMexidos] = useState(() => new Set())   // mudaram desde a última ordenação
  const [selId, setSelId] = useState(null)
  const [folha, setFolha] = useState(false)      // celular: o salão aberto por cima da lista
  const [ocupado, setOcupado] = useState(null)   // a ação em andamento ('status', 'nota'...)
  const [mensagemId, setMensagemId] = useState(null) // o salão com a mensagem aberta
  const [historicos, setHistoricos] = useState({})
  const [verAtalhos, setVerAtalhos] = useState(false)
  const [rascunho, setRascunho] = useState(null) // a nota sendo escrita: { id, base, texto }
  const montado = useRef(true)
  const filtroRef = useRef({ visao, busca })
  const ultimaAcao = useRef(null)
  const buscaRef = useRef(null)
  const notaRef = useRef(null)

  useEffect(() => { if (dados) memoria = { ...memoria, dados } }, [dados])
  useEffect(() => { memoria = { ...memoria, dias, visao }; filtroRef.current = { visao, busca } }, [dias, visao, busca])
  useEffect(() => { montado.current = true; return () => { montado.current = false } }, [])

  // ---- ler a fila (trocar de período pede de novo; só a resposta do último pedido vale) ----
  const pedido = useRef(0)
  const aplicar = useCallback((n, r) => {
    if (!montado.current || n !== pedido.current) return
    setCarregando(false)
    if (r.erro) { setErro(r.erro); return }
    const novos = r.data ?? { itens: [] }
    setErro('')
    setDados(novos)
    setOrdem(ordenarIds(novos.itens ?? [], filtroRef.current.visao, filtroRef.current.busca, novos.hoje))
    setMexidos(new Set())
  }, [])
  const ler = useCallback((d) => { const n = ++pedido.current; return chamar('guia_fila_abordagem', { dias: d }).then((r) => aplicar(n, r)) }, [aplicar])
  useEffect(() => { ler(memoria.dias) }, [ler])
  const carregar = (d) => { setDias(d); setCarregando(true); ler(d) }

  const hoje = dados?.hoje ?? new Date().toISOString().slice(0, 10)
  const itens = useMemo(() => dados?.itens ?? [], [dados])
  const porId = useMemo(() => new Map(itens.map((it) => [it.lugar_id, it])), [itens])
  const reordenar = (v = visao, b = busca) => { setOrdem(ordenarIds(itens, v, b, hoje)); setMexidos(new Set()) }
  const lista = useMemo(() => ordem.map((id) => porId.get(id)).filter(Boolean), [ordem, porId])
  // no computador, sempre há um salão aberto ao lado da lista (o primeiro, se nenhum foi escolhido)
  const atual = porId.get(selId) ?? (largo ? lista[0] : null) ?? null
  const indice = atual ? lista.findIndex((it) => it.lugar_id === atual.lugar_id) : -1
  const folhaAberta = !largo && folha && !!atual
  // a nota em edição pertence ao salão (e à nota) de quando começou a ser escrita
  const notaTexto = rascunho && atual && rascunho.id === atual.lugar_id && rascunho.base === (atual.nota ?? null) ? rascunho.texto : (atual?.nota ?? '')
  const setNotaTexto = (texto) => atual && setRascunho({ id: atual.lugar_id, base: atual.nota ?? null, texto })

  // ---- o histórico do salão aberto ----
  // geracao: quantas vezes o histórico de um salão ficou velho (uma ação nova); a leitura
  // que volta de uma geração passada é descartada e a de agora é feita de novo
  const geracao = useRef({})
  const lendo = useRef({})
  const lerHistorico = useCallback(async (id) => {
    for (;;) {
      const gen = geracao.current[id] ?? 0
      if (lendo.current[id] === gen) return
      lendo.current[id] = gen
      const r = await chamar('guia_abordagem_historico', { lugar_: id })
      if (lendo.current[id] === gen) delete lendo.current[id]
      if (!montado.current) return
      if ((geracao.current[id] ?? 0) === gen) { setHistoricos((h) => ({ ...h, [id]: r.erro ? { erro: r.erro } : (r.data ?? []) })); return }
    }
  }, [])
  useEffect(() => { if (atual && !historicos[atual.lugar_id]) lerHistorico(atual.lugar_id) }, [atual, historicos, lerHistorico])

  // ---- contadores e funil (somados dos itens) ----
  const contagem = useMemo(() => {
    const c = { fila: 0, lembretes: 0, pedidos: 0, todos: itens.length }
    for (const [id] of STATUS) c[id] = 0
    for (const it of itens) {
      c[it.status] = (c[it.status] ?? 0) + 1
      if (passaNaVisao(it, 'fila', hoje)) c.fila++
      if (passaNaVisao(it, 'lembretes', hoje)) c.lembretes++
      if (passaNaVisao(it, 'pedidos', hoje)) c.pedidos++
    }
    return c
  }, [itens, hoje])

  // ---- trocar uma linha pela versão nova (sem reordenar a lista) ----
  const trocarItem = useCallback((id, novo) => {
    setDados((d) => {
      if (!d) return d
      const tem = d.itens.some((it) => it.lugar_id === id)
      const lista_ = novo ? (tem ? d.itens.map((it) => (it.lugar_id === id ? novo : it)) : [...d.itens, novo]) : d.itens.filter((it) => it.lugar_id !== id)
      return { ...d, itens: lista_ }
    })
    setMexidos((m) => new Set(m).add(id))
    geracao.current[id] = (geracao.current[id] ?? 0) + 1
    setHistoricos((h) => { if (!(id in h)) return h; const n = { ...h }; delete n[id]; return n })
  }, [])

  const desfazer = useCallback(async (acaoId, nome) => {
    const r = await chamar('guia_abordagem_desfazer', { acao_: acaoId, dias_: dias })
    if (r.erro) { g.avisar({ texto: r.erro, tom: 'erro' }); return }
    trocarItem(r.data?.lugar_id, r.data?.item ?? null)
    if (ultimaAcao.current?.id === acaoId) ultimaAcao.current = null
    g.avisar(`${nome}: desfeito.`)
  }, [dias, g, trocarItem])

  // uma ação no salão: grava, troca a linha e oferece o "Desfazer"
  const registrar = useCallback(async (it, acao, { status = null, texto = null, proximo = null, dados: extra = null } = {}, recado) => {
    setOcupado(acao)
    const r = await chamar('guia_abordagem_registrar', {
      lugar_: it.lugar_id, acao_: acao, status_: status, texto_: texto, proximo_contato_: proximo, dados_: extra, dias_: dias,
    })
    if (montado.current) setOcupado(null)
    if (r.erro) { g.avisar({ texto: r.erro, tom: 'erro' }); return null }
    trocarItem(it.lugar_id, r.data?.item ?? null)
    const novo = r.data?.item
    if (r.data?.acao_id) {
      ultimaAcao.current = { id: r.data.acao_id, nome: it.nome }
      const texto_ = typeof recado === 'function' ? recado(novo) : recado
      g.avisar({ texto: texto_ || `${it.nome}: feito.`, acao: { rotulo: 'Desfazer', onClick: () => desfazer(r.data.acao_id, it.nome) } })
    }
    return r.data
  }, [dias, g, trocarItem, desfazer])

  // ---- as ações do salão aberto ----
  const mudarStatus = (it, s) => {
    if (!it || it.na_mimo || it.status === s) return
    registrar(it, 'status', { status: s }, `${it.nome}: ${ROTULO[s].toLowerCase()}.`)
  }
  const lembrar = (it, dia) => {
    if (!it) return
    registrar(it, 'lembrete', { proximo: dia }, dia ? `${it.nome}: lembrete para ${quando(dia, hoje)}.` : `${it.nome}: sem lembrete.`)
  }
  const contato = (it, canal) => registrar(it, canal, {}, (novo) => `${it.nome}: ${FEITO[canal] ?? canal}${novo && novo.status !== it.status ? ` · ${ROTULO[novo.status].toLowerCase()}` : ''}.`)
  const salvarNota = (it) => {
    if (!it || (notaTexto.trim() || null) === (it.nota ?? null)) return
    // salvo, o rascunho sai: a nota que vale é a do banco (e o desfazer não ressuscita o texto)
    registrar(it, 'nota', { texto: notaTexto }, notaTexto.trim() ? `${it.nome}: nota salva.` : `${it.nome}: nota apagada.`)
      .then((r) => { if (r && montado.current) setRascunho(null) })
  }
  // a mensagem saiu (WhatsApp aberto, ou mandada por outro canal)
  const enviou = (it, { canal, texto, para, lembrar: comLembrete }) => {
    const futuro = it.proximo_contato && it.proximo_contato > hoje
    const proximo = comLembrete && !futuro ? somaDias(hoje, 3) : null
    setMensagemId(null)
    registrar(it, canal, { texto, proximo, dados: { dias, visitas: n0(it.visitas), contatos: n0(it.contatos), para } },
      (novo) => `${it.nome}: ${ROTULO[novo?.status ?? 'abordado'].toLowerCase()}${proximo ? ` · lembrete ${quando(proximo, hoje)}` : ''}.`)
  }

  const selecionar = useCallback((id, abrirFolha = true) => {
    setSelId(id)
    if (!largo && abrirFolha) setFolha(true)
  }, [largo])
  const mensagemDa = useCallback((id) => { setSelId(id); setMensagemId(id) }, [])
  const mover = (passo) => {
    if (!lista.length) return
    const i = indice < 0 ? 0 : Math.min(lista.length - 1, Math.max(0, indice + passo))
    const id = lista[i].lugar_id
    setSelId(id)
    requestAnimationFrame(() => document.querySelector(`[data-lugar="${id}"]`)?.scrollIntoView({ block: 'nearest' }))
  }
  const trocarVisao = (v) => { setVisao(v); reordenar(v, busca); if (!largo) setFolha(false) }
  const buscar = (t) => { setBusca(t); reordenar(visao, t) }
  const abrirPagina = (it) => { if (it?.status_pagina === 'publicado') window.open(urlDoAmbiente('cliente', it.pagina), '_blank', 'noopener') }

  // ---- teclado ----
  const teclas = useRef(null)
  const aoTeclar = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
    if (mensagemId || document.querySelector('.modal-fundo')) return
    const alvo = e.target
    if (alvo?.closest?.('input, textarea, select, [contenteditable="true"]')) {
      if (e.key === 'Escape') alvo.blur()
      return
    }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    const podeAgir = atual && !ocupado
    const acoes = {
      j: () => mover(1), k: () => mover(-1),
      w: () => podeAgir && atual.fora_motivo !== 'remover' && setMensagemId(atual.lugar_id),
      l: () => podeAgir && lembrar(atual, somaDias(hoje, 3)),
      n: () => { if (!atual) return; if (!largo) setFolha(true); requestAnimationFrame(() => notaRef.current?.focus()) },
      v: () => abrirPagina(atual),
      u: () => ultimaAcao.current && desfazer(ultimaAcao.current.id, ultimaAcao.current.nome),
      r: () => reordenar(),
      '/': () => buscaRef.current?.focus(),
      '?': () => setVerAtalhos((v) => !v),
      Escape: () => { setVerAtalhos(false); setFolha(false) },
    }
    STATUS.forEach(([s], i) => { acoes[String(i + 1)] = () => podeAgir && mudarStatus(atual, s) })
    const fn = acoes[k]
    if (!fn) return
    e.preventDefault()
    fn()
  }
  useEffect(() => { teclas.current = aoTeclar })
  useEffect(() => {
    const ouvir = (e) => teclas.current?.(e)
    window.addEventListener('keydown', ouvir)
    return () => window.removeEventListener('keydown', ouvir)
  }, [])

  // ---- telas de espera e de erro ----
  if (erro && !dados) return (
    <div className="pg-vazio-grande">
      <Handshake size={28} />
      <h3>Ainda não dá para abrir a fila</h3>
      <p>{erro}</p>
      <button type="button" className="btn btn-ghost" onClick={() => carregar(dias)}><RotateCcw size={15} /> Tentar de novo</button>
    </div>
  )
  if (!dados) return <div className="pg-carregando"><LoaderCircle className="pg-gira" size={18} /> Montando a fila…</div>

  const visoes = [['fila', 'Fila', ''], ['lembretes', 'Lembretes', contagem.lembretes ? 'ambar' : ''], ['pedidos', 'Com pedido', contagem.pedidos ? 'rosa' : '']]
  const detalhe = atual && (
    <Detalhe
      it={atual} dias={dados.dias} hoje={hoje} ocupado={ocupado} largo={largo}
      historico={historicos[atual.lugar_id]} notaTexto={notaTexto} setNotaTexto={setNotaTexto} notaRef={notaRef}
      posicao={indice >= 0 ? `${indice + 1} de ${lista.length}` : 'fora deste filtro'} podeVoltar={indice > 0} podeIr={indice >= 0 && indice < lista.length - 1}
      onMover={mover} onFechar={() => setFolha(false)} onMensagem={() => setMensagemId(atual.lugar_id)} onStatus={(s) => mudarStatus(atual, s)}
      onLembrar={(d) => lembrar(atual, d)} onContato={(c) => contato(atual, c)} onSalvarNota={() => salvarNota(atual)}
      onInteresses={() => g.irPara('interesses')} onRevisar={() => g.irPara('revisar', { selId: atual.lugar_id })}
    />
  )

  return (
    <div className={'pa' + (carregando ? ' pa-recarregando' : '')}>
      {erro && <div className="alert alert-error">{erro}</div>}

      <div className="pa-barra">
        <div className="pa-seg" role="radiogroup" aria-label="Período dos números">
          {PERIODOS.map(([d, r]) => <button key={d} type="button" role="radio" aria-checked={dias === d} className={dias === d ? 'ativo' : ''} onClick={() => carregar(d)}>{r}</button>)}
        </div>
        <label className="pa-busca">
          <Search size={15} />
          <input ref={buscaRef} value={busca} onChange={(e) => buscar(e.target.value)} placeholder="Buscar salão, bairro, nota" aria-label="Buscar salão" />
          {busca ? <button type="button" aria-label="Limpar busca" onClick={() => buscar('')}><X size={14} /></button> : <kbd>/</kbd>}
        </label>
        {carregando && <LoaderCircle size={15} className="pg-gira pa-girando" aria-label="Atualizando" />}
        <button type="button" className="pa-btn-atalhos" onClick={() => setVerAtalhos((v) => !v)} aria-label="Atalhos de teclado" title="Atalhos de teclado (?)"><Keyboard size={17} /></button>
        {verAtalhos && <Atalhos onFechar={() => setVerAtalhos(false)} />}
      </div>

      <Funil itens={itens} contagem={contagem} />

      <div className="pa-visoes" role="tablist" aria-label="Filtrar a fila">
        {visoes.map(([id, r, tom]) => (
          <button key={id} type="button" role="tab" aria-selected={visao === id} className={'pa-visao ' + tom + (visao === id ? ' ativo' : '')} onClick={() => trocarVisao(id)}>
            {r} <b>{contagem[id]}</b>
          </button>
        ))}
        <span className="pa-visoes-sep" aria-hidden="true" />
        {STATUS.map(([id, r, tom]) => (
          <button key={id} type="button" role="tab" aria-selected={visao === id} className={'pa-visao pa-visao-st' + (visao === id ? ' ativo' : '')} onClick={() => trocarVisao(id)}>
            <i className={'pa-ponto ' + tom} />{r} <b>{contagem[id]}</b>
          </button>
        ))}
        <button type="button" role="tab" aria-selected={visao === 'todos'} className={'pa-visao' + (visao === 'todos' ? ' ativo' : '')} onClick={() => trocarVisao('todos')}>Todos <b>{contagem.todos}</b></button>
      </div>

      <div className={'pa-mesa' + (largo ? '' : ' estreita')}>
        <section className="pa-lista" aria-label="Salões">
          {mexidos.size > 0 && (
            <button type="button" className="pa-reordenar" onClick={() => reordenar()}>
              <ArrowDownWideNarrow size={14} /> {mexidos.size === 1 ? '1 salão mudou' : `${mexidos.size} salões mudaram`} desde a última ordem · <b>Reordenar</b> <kbd>R</kbd>
            </button>
          )}
          {lista.length === 0 ? (
            <div className="pa-vazio">
              <Vazio>{busca ? 'Nenhum salão com essa busca neste filtro.' : visao === 'lembretes' ? 'Nenhum lembrete vencido. Bom trabalho.' : visao === 'pedidos' ? 'Nenhum pedido aberto na fila.' : itens.length ? 'Nenhum salão neste filtro.' : 'Nenhum salão no ar ainda. A fila aparece quando as páginas forem aprovadas na aba Revisar.'}</Vazio>
            </div>
          ) : (
            <ol className="pa-itens">
              {lista.map((it, n) => (
                <Linha key={it.lugar_id} it={it} n={n + 1} hoje={hoje} ativo={atual?.lugar_id === it.lugar_id}
                  saiu={!passaNaVisao(it, visao, hoje)} onSelecionar={selecionar} onMensagem={mensagemDa} />
              ))}
            </ol>
          )}
          <ComoOrdena dias={dados.dias} />
        </section>

        {largo && <aside className="pa-detalhe-col">{detalhe || <div className="pa-sem-selecao"><Handshake size={22} /><p>Escolha um salão da fila.</p></div>}</aside>}
      </div>

      {folhaAberta && detalhe && (
        <Portal>
          <div className="pa-folha-fundo" onClick={() => setFolha(false)} role="presentation">
            <div className="pa-folha" role="dialog" aria-modal="true" aria-label={atual.nome} onClick={(e) => e.stopPropagation()}>{detalhe}</div>
          </div>
        </Portal>
      )}

      {mensagemId && porId.get(mensagemId) && <ModalMensagem it={porId.get(mensagemId)} dias={dados.dias} hoje={hoje} onFechar={() => setMensagemId(null)} onEnviou={(o) => enviou(porId.get(mensagemId), o)} />}
    </div>
  )
}

// ---- o funil: até onde a conversa chegou (a abordar → abordado → respondeu → cliente) ----
function Funil({ itens, contagem }) {
  const noFunil = itens.filter((it) => !it.ja_cliente && !(it.status === 'nao_abordar' && !it.etapa))
  const passos = [
    ['Para abordar', noFunil.length, 'salões do guia (sem quem já era cliente)'],
    ['Abordados', noFunil.filter((it) => it.etapa >= 1).length, 'a MIMO já falou com eles'],
    ['Responderam', noFunil.filter((it) => it.etapa >= 2).length, contagem.negociando ? `${contagem.negociando} negociando agora` : 'sim, não ou talvez'],
    ['Clientes', noFunil.filter((it) => it.etapa >= 4).length, 'viraram clientes da MIMO'],
  ]
  const base = Math.max(1, passos[0][1])
  const jaEram = itens.filter((it) => it.ja_cliente).length
  return (
    <section className="pa-funil" aria-label="Funil da abordagem">
      {passos.map(([rotulo, n, sub], i) => {
        const antes = i ? passos[i - 1][1] : null
        return (
          <div key={rotulo} className={'pa-passo p' + i}>
            {i > 0 && <span className="pa-conv" title={`${rotulo} sobre ${passos[i - 1][0].toLowerCase()}`}>{antes ? `${Math.round((n / antes) * 100)}%` : '–'}</span>}
            <strong>{formatar(n)}</strong>
            <span className="pa-passo-rot">{rotulo}</span>
            <span className="pa-passo-barra"><i style={{ width: `${Math.max(n ? 3 : 0, (n / base) * 100)}%` }} /></span>
            <small>{sub}</small>
          </div>
        )
      })}
      {jaEram > 0 && <p className="pa-funil-nota muted">{jaEram === 1 ? '1 salão já agendava pela MIMO antes de qualquer abordagem e fica fora do funil.' : `${jaEram} salões já agendavam pela MIMO antes de qualquer abordagem e ficam fora do funil.`}</p>}
    </section>
  )
}

// ---- uma linha da fila ----
// memo: trocar o salão aberto não redesenha as outras linhas
const Linha = memo(function Linha({ it, n, hoje, ativo, saiu, onSelecionar, onMensagem }) {
  const c = calor(it)
  const motivos = (it.motivos ?? []).filter((m) => m.peso !== 0 || m.tipo === 'info').slice(0, 4)
  const atrasado = it.proximo_contato && it.proximo_contato <= hoje
  return (
    <li className={`pa-item ${c}${ativo ? ' ativo' : ''}${saiu ? ' saiu' : ''}`} data-lugar={it.lugar_id}>
      <button type="button" className="pa-item-corpo" onClick={() => onSelecionar(it.lugar_id)} aria-current={ativo ? 'true' : undefined}>
        <span className="pa-rank" title={CALOR[c]}>{n}</span>
        <span className="pa-item-meio">
          <span className="pa-item-nome">
            <b>{it.nome}</b>
            <span className={'pa-pilula ' + TOM[it.status]}>{ROTULO[it.status]}</span>
            {it.fora_motivo === 'remover' && <span className="pa-pilula carmim">pediu remoção</span>}
          </span>
          <span className="pa-item-sub">
            {[it.bairro, categoriaDoGuia(it.categoria).curto, it.status_pagina !== 'publicado' ? 'fora do ar' : null].filter(Boolean).join(' · ')}
            {it.nota_google != null && <span className="pa-google" title="Nota no Google: só desempata (nunca vai para o site)">{String(it.nota_google).replace('.', ',')}★</span>}
            {it.proximo_contato && <span className={'pa-quando' + (atrasado ? ' atrasado' : '')}><AlarmClock size={12} /> {quando(it.proximo_contato, hoje)}</span>}
            {saiu && <span className="pa-saiu-tag">saiu deste filtro</span>}
          </span>
          <span className="pa-motivos">
            {motivos.map((m, i) => <span key={i} className={'pa-motivo ' + m.tipo}>{m.texto}</span>)}
          </span>
        </span>
      </button>
      {it.fila === 'principal' && (
        <button type="button" className="pa-item-zap" onClick={() => onMensagem(it.lugar_id)} title="Mandar mensagem (W)" aria-label={`Mandar mensagem para ${it.nome}`}><Send size={15} /></button>
      )}
    </li>
  )
})

// ---- o salão aberto ----
function Detalhe({
  it, dias, hoje, ocupado, largo, historico, notaTexto, setNotaTexto, notaRef, posicao, podeVoltar, podeIr,
  onMover, onFechar, onMensagem, onStatus, onLembrar, onContato, onSalvarNota, onInteresses, onRevisar,
}) {
  const cat = categoriaDoGuia(it.categoria)
  const e = it.eventos ?? {}
  const pedidos = n0(it.pendentes?.quero_marcar) + n0(it.pendentes?.sou_dono)
  const notaMudou = (notaTexto.trim() || null) !== (it.nota ?? null)
  const ig = String(it.instagram ?? '').replace(/^@/, '').trim()
  const fone = it.whatsapp || it.telefone
  const toques = [['whatsapp', 'WhatsApp'], ['ligar', 'Ligar'], ['mapa', 'Rota'], ['instagram', 'Instagram'], ['site', 'Site'], ['agendar_mimo', 'Agendar'], ['email', 'E-mail']]
    .filter(([t]) => n0(e[t]) > 0).map(([t, r]) => `${r} ${n0(e[t])}`)
  return (
    <div className="pa-detalhe">
      <header className="pa-det-topo">
        {!largo && <button type="button" className="pa-voltar" onClick={onFechar}><ArrowLeft size={16} /> Fila</button>}
        <div className="pa-det-nav">
          <span>{posicao}</span>
          <button type="button" onClick={() => onMover(-1)} disabled={!podeVoltar} aria-label="Anterior (K)" title="Anterior (K)"><ChevronUp size={16} /></button>
          <button type="button" onClick={() => onMover(1)} disabled={!podeIr} aria-label="Próximo (J)" title="Próximo (J)"><ChevronDown size={16} /></button>
        </div>
      </header>

      <div className="pa-det-cab">
        <h2>{it.nome}</h2>
        <p className="pa-det-sub">{[it.bairro, cat.curto, it.cidade].filter(Boolean).join(' · ')}{it.status_pagina !== 'publicado' && <span className="pa-pilula pedra">página fora do ar</span>}</p>
        <div className="pa-det-links">
          {it.status_pagina === 'publicado' && <a href={urlDoAmbiente('cliente', it.pagina)} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Ver a página</a>}
          <button type="button" onClick={onRevisar}><ClipboardCheck size={13} /> Abrir na revisão</button>
          {ig && <a href={linkInstagram(ig)} target="_blank" rel="noopener noreferrer"><AtSign size={13} /> {ig}</a>}
          {fone && <span className="pa-fone"><Phone size={13} /> {fone}{!it.tem_zap && ' (fixo)'}</span>}
        </div>
        <div className="pa-motivos pa-det-motivos">
          {(it.motivos ?? []).filter((m) => m.peso !== 0 || m.tipo === 'info').map((m, i) => <span key={i} className={'pa-motivo ' + m.tipo}>{m.texto}</span>)}
        </div>
      </div>

      {it.fora_motivo && <p className={'pa-fora ' + it.fora_motivo}><Info size={14} /> {FORA[it.fora_motivo]}{it.na_mimo && ' Agenda pela MIMO.'}</p>}

      <div className="pa-det-acoes">
        {it.fora_motivo !== 'remover' && (
          <button type="button" className="btn btn-primary pa-btn-msg" onClick={onMensagem} disabled={!!ocupado}><Send size={16} /> Mandar mensagem <kbd>W</kbd></button>
        )}
        <div className="pa-canais" role="group" aria-label="Registrar um contato feito por outro canal">
          <span className="muted">Registrar contato:</span>
          {CANAIS.map(([c, r, Ic]) => <button key={c} type="button" onClick={() => onContato(c)} disabled={!!ocupado}><Ic size={13} /> {r}</button>)}
        </div>
      </div>

      <section className="pa-bloco">
        <h4>Status {ocupado === 'status' && <LoaderCircle size={13} className="pg-gira" />}</h4>
        <div className="pa-status" role="radiogroup" aria-label="Status da abordagem">
          {STATUS.map(([s, r, tom], i) => (
            <button key={s} type="button" role="radio" aria-checked={it.status === s} className={'pa-status-op ' + tom + (it.status === s ? ' ativo' : '')}
              onClick={() => onStatus(s)} disabled={!!ocupado || it.na_mimo}>
              {r}<kbd>{i + 1}</kbd>
            </button>
          ))}
        </div>
        {it.na_mimo && <small className="muted">Este salão agenda pela MIMO, então fica como cliente.</small>}
        {it.atualizado_em && <small className="muted pa-quem">Mexido {haQuanto(it.atualizado_em)}{it.atualizado_por_nome ? ` por ${it.atualizado_por_nome}` : ''}{it.tentativas ? ` · ${it.tentativas} ${it.tentativas === 1 ? 'contato' : 'contatos'} da MIMO` : ''}</small>}
      </section>

      <section className="pa-bloco">
        <h4><AlarmClock size={14} /> Lembrete {ocupado === 'lembrete' && <LoaderCircle size={13} className="pg-gira" />}</h4>
        <p className={'pa-lembrete-atual' + (it.proximo_contato && it.proximo_contato <= hoje ? ' atrasado' : '')}>
          {it.proximo_contato ? <>Voltar a falar <b>{quando(it.proximo_contato, hoje)}</b></> : 'Sem lembrete.'}
          {it.proximo_contato && <button type="button" className="pa-link" onClick={() => onLembrar(null)} disabled={!!ocupado}>Tirar</button>}
        </p>
        <div className="pa-lembrar">
          {LEMBRAR.map(([k, r]) => (
            <button key={k} type="button" onClick={() => onLembrar(somaDias(hoje, k))} disabled={!!ocupado} title={quando(somaDias(hoje, k), hoje)}>{r}{k === 3 && <kbd>L</kbd>}</button>
          ))}
          <label className="pa-data">
            <span className="sr-only">Outra data</span>
            <input type="date" min={hoje} max={somaDias(hoje, 365)} onChange={(ev) => { if (ev.target.value) { onLembrar(ev.target.value); ev.target.value = '' } }} disabled={!!ocupado} />
          </label>
        </div>
      </section>

      <section className="pa-bloco">
        <h4><StickyNote size={14} /> Nota interna {ocupado === 'nota' && <LoaderCircle size={13} className="pg-gira" />}</h4>
        <textarea ref={notaRef} className="pa-nota" rows={3} value={notaTexto} maxLength={2000} placeholder="O que ficou combinado, com quem falou, o melhor horário… (só a Plataforma vê)"
          onChange={(ev) => setNotaTexto(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); onSalvarNota() } }} aria-label="Nota interna" />
        <div className="pa-nota-pe">
          <small className="muted">Ctrl+Enter salva · N vem para cá</small>
          <button type="button" className="btn btn-ghost pa-btn-peq" onClick={onSalvarNota} disabled={!notaMudou || !!ocupado}><Check size={14} /> Salvar nota</button>
        </div>
      </section>

      {(pedidos > 0 || it.pendentes?.remover > 0 || it.pendentes?.corrigir > 0) && (
        <section className="pa-bloco">
          <h4><Inbox size={14} /> Pedidos abertos</h4>
          {it.dono && (
            <div className="pa-dono">
              <span><b>{it.dono.nome || 'Sem nome'}</b> disse que é do salão · <span className="muted">{haQuanto(it.dono.em)}</span></span>
              <span className="pa-dono-contato">{it.dono.contato}</span>
              {it.dono.mensagem && <q>{it.dono.mensagem}</q>}
            </div>
          )}
          <p className="pa-pedidos-linha">
            {[
              n0(it.pendentes?.quero_marcar) ? `${it.pendentes.quero_marcar} "quero marcar"` : '',
              n0(it.pendentes?.sou_dono) > (it.dono ? 1 : 0) ? `${it.pendentes.sou_dono} de dono` : '',
              n0(it.pendentes?.corrigir) ? `${it.pendentes.corrigir} de correção` : '',
              n0(it.pendentes?.remover) ? `${it.pendentes.remover} de remoção` : '',
            ].filter(Boolean).join(' · ')}
            <button type="button" className="pa-link" onClick={onInteresses}>Ver em Interesses</button>
          </p>
        </section>
      )}

      <section className="pa-bloco">
        <h4>Nos últimos {dias} dias</h4>
        <div className="pa-nums">
          <span><b>{formatar(it.visitas)}</b> visitas</span>
          <span><b>{formatar(it.visitantes)}</b> visitantes</span>
          <span><b>{formatar(it.contatos)}</b> contatos</span>
          <span><b>{formatar(n0(it.interesses?.quero_marcar))}</b> "quero marcar"</span>
        </div>
        {toques.length > 0 && <p className="muted pa-toques">{toques.join(' · ')}</p>}
        {it.nota_google != null && <p className="muted pa-google-det">Google: {String(it.nota_google).replace('.', ',')}★{it.avaliacoes ? ` com ${formatar(it.avaliacoes)} avaliações` : ''}. Só desempata a fila; nunca vai para o site.</p>}
      </section>

      <section className="pa-bloco">
        <h4><History size={14} /> Histórico</h4>
        <Historico lista={historico} hoje={hoje} />
      </section>
    </div>
  )
}

function Historico({ lista, hoje }) {
  if (!lista) return <p className="muted pa-hist-vazio"><LoaderCircle size={13} className="pg-gira" /> Carregando…</p>
  if (lista.erro) return <p className="muted pa-hist-vazio">{lista.erro}</p>
  if (!lista.length) return <p className="muted pa-hist-vazio">Nada ainda. O que você fizer aqui fica registrado.</p>
  return (
    <ol className="pa-hist">
      {lista.map((h) => {
        const titulo = h.tipo === 'status' ? `Mudou para ${ROTULO[h.para_status] ?? h.para_status}`
          : h.tipo === 'lembrete' ? (h.proximo_contato ? `Lembrete para ${quando(h.proximo_contato, hoje)}` : 'Tirou o lembrete')
          : ACAO[h.tipo] ?? h.tipo
        return (
          <li key={h.id} className={'pa-hist-item ' + h.tipo}>
            <span className="pa-hist-ponto" />
            <div>
              <p><b>{titulo}</b>{h.tipo !== 'status' && h.para_status && <> · virou <b>{ROTULO[h.para_status]}</b></>}{['whatsapp', 'ligacao', 'instagram', 'presencial', 'email'].includes(h.tipo) && h.proximo_contato && <> · lembrete {quando(h.proximo_contato, hoje)}</>}</p>
              {h.texto && (h.tipo === 'nota' ? <p className="pa-hist-texto">{h.texto}</p> : <details className="pa-hist-msg"><summary>ver a mensagem</summary><p className="pa-hist-texto">{h.texto}</p></details>)}
              <small className="muted" title={new Date(h.em).toLocaleString('pt-BR')}>{haQuanto(h.em)}{h.por_nome ? ` · ${h.por_nome}` : ''}</small>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ---- a mensagem: monta, deixa mudar, abre o WhatsApp e já registra ----
function ModalMensagem({ it, dias, hoje, onFechar, onEnviou }) {
  const temDono = !!it.dono?.contato
  const [para, setPara] = useState(temDono ? 'dono' : 'salao')
  const [texto, setTexto] = useState(() => montarMensagem(it, { dias, para: temDono ? 'dono' : 'salao' }))
  const [copiado, setCopiado] = useState(false)
  const futuro = it.proximo_contato && it.proximo_contato > hoje
  const [comLembrete, setComLembrete] = useState(!futuro)
  const caixa = useRef(null)
  const contatoDono = it.dono?.contato ?? ''
  const zap = para === 'dono' ? (ehTelefone(contatoDono) ? linkWhatsDoTel(contatoDono, texto) : null) : zapDoDono(it, texto)
  const email = para === 'dono' && ehEmail(contatoDono) ? `mailto:${contatoDono.trim()}?subject=${encodeURIComponent(`${it.nome} no guia da MIMO`)}&body=${encodeURIComponent(texto)}` : null

  useEffect(() => {
    const antes = document.activeElement
    caixa.current?.focus()
    caixa.current?.setSelectionRange(0, 0)
    return () => antes?.focus?.()
  }, [])
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape') { e.preventDefault(); onFechar() } }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onFechar])

  function trocarPara(p) { setPara(p); setTexto(montarMensagem(it, { dias, para: p })) }
  async function copiar() {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { /* sem área de transferência */ }
  }
  // fecha depois do clique (o link do WhatsApp abre primeiro) e uma vez só, mesmo com clique duplo
  const saiu = useRef(false)
  const sair = (canal) => {
    if (saiu.current) return
    saiu.current = true
    setTimeout(() => onEnviou({ canal, texto, para, lembrar: comLembrete }), 0)
  }

  return (
    <Portal>
      <div className="modal-fundo plat-modal-fundo pa-modal-fundo" onClick={onFechar} role="presentation">
        <div className="modal-caixa plat-modal pa-modal" role="dialog" aria-modal="true" aria-labelledby="pa-msg-t" onClick={(e) => e.stopPropagation()}>
          <div className="pa-modal-topo">
            <h3 id="pa-msg-t">Mensagem para {it.nome}</h3>
            <button type="button" onClick={onFechar} aria-label="Fechar"><X size={16} /></button>
          </div>
          {temDono && (
            <div className="pa-seg pa-para" role="radiogroup" aria-label="Para quem">
              <button type="button" role="radio" aria-checked={para === 'dono'} className={para === 'dono' ? 'ativo' : ''} onClick={() => trocarPara('dono')}>Quem pediu contato{it.dono.nome ? ` (${it.dono.nome})` : ''}</button>
              <button type="button" role="radio" aria-checked={para === 'salao'} className={para === 'salao' ? 'ativo' : ''} onClick={() => trocarPara('salao')}>WhatsApp do salão</button>
            </div>
          )}
          <p className="muted pa-modal-sub">
            {para === 'dono' ? `Para ${contatoDono}. ` : ''}
            {it.status_pagina === 'publicado' && n0(it.visitas) ? `Com os números dos últimos ${dias} dias. ` : ''}Dá para mudar o texto antes.
          </p>
          <textarea ref={caixa} className="pa-msg-texto" rows={10} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Texto da mensagem" />
          <label className="pa-check">
            <input type="checkbox" checked={comLembrete && !futuro} disabled={futuro} onChange={(e) => setComLembrete(e.target.checked)} />
            <span>{futuro ? `O lembrete de ${quando(it.proximo_contato, hoje)} continua.` : `Lembrar de voltar a falar em 3 dias (${quando(somaDias(hoje, 3), hoje)})`}</span>
          </label>
          <div className="pa-modal-botoes">
            <button type="button" className="btn btn-ghost" onClick={copiar}>{copiado ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar</>}</button>
            {zap && <a className="btn btn-primary" href={zap} target="_blank" rel="noopener noreferrer" onClick={() => sair('whatsapp')}><Send size={15} /> Abrir no WhatsApp</a>}
            {!zap && email && <a className="btn btn-primary" href={email} onClick={() => sair('email')}><Mail size={15} /> Abrir no e-mail</a>}
          </div>
          {!zap && (
            <div className="pa-outro-canal">
              <span className="muted">{para === 'dono' ? 'Sem WhatsApp neste contato.' : 'O salão não divulga WhatsApp.'} Copie, mande e registre por onde foi:</span>
              <div>
                {CANAIS.filter(([c]) => c !== 'presencial').map(([c, r, Ic]) => <button key={c} type="button" onClick={() => sair(c)}><Ic size={13} /> {r}</button>)}
              </div>
            </div>
          )}
          <p className="pa-modal-pe muted">{zap ? 'Ao abrir o WhatsApp' : email ? 'Ao abrir o e-mail' : 'Ao registrar'}, o salão vira "abordado" e entra no histórico. Dá para desfazer no recado de baixo.</p>
        </div>
      </div>
    </Portal>
  )
}

function Atalhos({ onFechar }) {
  const lista = [['J  K', 'próximo e anterior'], ['W', 'mandar mensagem'], ['1 a 7', 'mudar o status'], ['L', 'lembrar em 3 dias'], ['N', 'escrever a nota'], ['V', 'ver a página'], ['U', 'desfazer a última ação'], ['R', 'reordenar a fila'], ['/', 'buscar'], ['Esc', 'sair do campo ou fechar']]
  return (
    <div className="pa-atalhos" role="dialog" aria-label="Atalhos de teclado">
      <div className="pa-atalhos-topo"><b>Atalhos de teclado</b><button type="button" onClick={onFechar} aria-label="Fechar"><X size={14} /></button></div>
      <ul>{lista.map(([k, t]) => <li key={k}><kbd>{k}</kbd><span>{t}</span></li>)}</ul>
    </div>
  )
}

function ComoOrdena({ dias }) {
  return (
    <details className="pa-como">
      <summary><Info size={14} /> Como a fila ordena</summary>
      <ul>
        <li><b>Pedido aberto do dono</b> ("É o seu salão?") vale mais que tudo; cada <b>"quero marcar"</b> aberto vale muito (até cinco contam).</li>
        <li><b>Toques</b> em WhatsApp, Ligar, Rota, Instagram e site nos últimos {dias} dias somam, e as <b>visitas</b> também, um pouco menos.</li>
        <li><b>Lembrete vencido</b> sobe (mais a cada dia de atraso). Quem <b>respondeu</b> ou está <b>negociando</b> sobe: falta o próximo passo.</li>
        <li><b>Lembrete para depois</b> e <b>abordado há até 2 dias</b> sem resposta descem: é hora de esperar. Sem WhatsApp divulgado desce um pouco.</li>
        <li>A <b>nota do Google</b> só desempata (e nunca vai para o site).</li>
        <li>Saem da fila: quem já é <b>cliente</b>, quem está <b>sem interesse</b> ou <b>não abordar</b>, e quem <b>pediu para remover</b> a página. Continuam nos filtros de cada status.</li>
        <li>A ordem fica parada enquanto você trabalha; "Reordenar" (R) aplica as mudanças.</li>
      </ul>
    </details>
  )
}
