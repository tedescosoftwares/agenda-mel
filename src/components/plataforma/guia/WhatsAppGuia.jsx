import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { chamar } from '../../../lib/pagamento'
import { Painel, Vazio, haQuanto, Iniciais } from '../Pecas'
import { MODELOS } from '../../../lib/guiaIa'
import { tel, telCanon, mascararTel, telValido, quando, normal, lerSecao, guardarSecao, useIndice } from '../../../lib/guiaWa'
import { deixarRecado, pegarRecado } from '../../../lib/guiaPontes'
import { Pilula, Chave, Tile, Funil, Nav, Bloco, Indice, BarraSalvar, Chat } from './PecasWa'
import {
  MessageCircle, LoaderCircle, Send, RotateCcw, Save, Bot, Inbox, Check, RefreshCw, TriangleAlert, Smartphone, MessagesSquare, MousePointerClick, X, Unplug,
  ThumbsUp, ThumbsDown, Clock, BellRing, Vote, Users, Shield, Search, Globe, SlidersHorizontal, Circle, Phone, Hourglass, ChevronDown, Sparkles, Zap, Handshake, UserX,
  PhoneMissed, LifeBuoy, Undo2, ShieldCheck,
} from 'lucide-react'

// O WhatsApp do guia (3.48, migração 195): tudo se configura aqui. A conexão do número (outra instância na mesma
// Evolution: criar, parear, webhook), a configuração (ligar, número, botões que passam pela MIMO, a IA e o modelo, a
// orientação da Mel, as mensagens, o limite por dia, a retenção), o simulador (conversar com a Mel sem mandar nada a
// ninguém e ver a mensagem que o salão receberia), os pedidos (com a resposta do salão, atendido, reenviar) e as
// conversas. O site lê só o público (guia_contato_config); o bot roda no whatsapp-webhook; aqui é a Plataforma.
//
// 3.58: a aba reorganizada. Um cabeçalho com o estado da conexão e as ações; os números em cartões, com o funil do
// pedido (enviado → abriu → vai atender); e quatro seções — Pedidos (com filtros, busca e a linha do tempo de cada
// pedido), Conversas, Testar a Mel e Configuração (em blocos, com um índice que acompanha a rolagem e a barra de salvar
// fixa, que diz quando há mudança sem salvar). Os ids de teste (data-teste) são os mesmos de antes.
//
// 3.76 (migração 221): o bloco "Quem quer a MIMO Agenda" — a dona ou a profissional que pergunta da MIMO Agenda no
// número da Mel recebe o link do WhatsApp comercial (ou do site, com ele desligado); os dois textos se editam aqui.
//
// 3.77 (migração 222): o resgate da cliente (o salão não deu sinal em X minutos → a Mel oferece outros salões; os campos
// em "O retorno do salão", com o estado do relógio da VPS), a seção "Sem resposta" (os salões que deixaram clientes sem
// resposta, para a equipe conferir o número) e, no simulador, "e se o salão não responder?".

const faltaMigracao = (e) => e?.code === 'PGRST202' || e?.status === 404 || /could not find the function|schema cache|migração 195/i.test(e?.message ?? '')
const STATUS = {
  pendente: ['Saindo', 'cinza'], enviado: ['Enviado ao salão', 'verde'], falhou: ['Não saiu', 'carmim'], sem_contato: ['Salão sem WhatsApp', 'ambar'],
  fora_do_limite: ['Fora do limite do dia', 'ambar'], salao_saiu: ['Salão pediu para não receber', 'cinza'], salao_respondeu: ['Salão respondeu', 'azul'],
  salao_quer_conhecer: ['Quer conhecer a MIMO 💗', 'rosa'],
  // 3.57: o salão disse, pela enquete ou por texto, se vai atender
  salao_vai_atender: ['Vai atender ✅', 'verde'], salao_nao_atende: ['Não vai atender', 'carmim'],
}
const CONEXAO = {
  open: ['Conectado', 'verde'], connecting: ['Conectando… pareie o celular', 'ambar'], close: ['Desconectado', 'carmim'],
  nao_existe: ['Ainda não conectado', 'cinza'], erro: ['A Evolution não respondeu', 'carmim'], desconhecido: ['Estado desconhecido', 'cinza'],
}
const BOTOES = [['whatsapp', 'WhatsApp', 'o botão WhatsApp do salão'], ['ligar', 'Ligar', 'o botão Ligar (vira WhatsApp)'], ['quero_marcar', 'Quero marcar', 'o botão "Quero marcar aqui" (em vez do formulário)']]
const CAMPOS_CONFIG = ['ligado', 'numero', 'numero_avisos', 'instancia', 'botoes', 'provedor', 'modelo', 'orientacao', 'msg_cliente', 'msg_salao', 'msg_salao_resposta', 'msg_encerramento', 'msg_ocioso', 'msg_dona', 'mostrar_contato_salao', 'exigir_preferencia', 'ocioso_ativo', 'limite_dia', 'limite_respostas', 'pos_envio', 'max_sem_avanco', 'ocioso_horas', 'ocioso_perguntar_min', 'ocioso_encerrar_min', 'retencao_dias',
  // 3.57: o retorno do salão (migração 205)
  'enquete_ativa', 'enquete_pergunta', 'enquete_sim', 'enquete_nao', 'msg_salao_vai_atender', 'msg_salao_nao_atende', 'avisar_cliente_nao', 'msg_cliente_nao_atende', 'aviso_nao_atende', 'msg_aviso_nao_atende', 'aviso_demora_min', 'msg_aviso_demora', 'cutucar_salao_min', 'msg_cutucar_salao',
  // 3.76: quem pergunta da MIMO Agenda (migração 221)
  'sobre_agenda', 'msg_sobre_agenda', 'msg_sobre_agenda_site',
  // 3.77: o resgate da cliente (migração 222)
  'resgate_min', 'resgate_inicio', 'resgate_fim', 'resgate_opcoes', 'msg_resgate']
const VOTO = { sim: 'vou atender', nao: 'não vou conseguir' }
const RESGATE = { demora: 'o salão não deu sinal', sem_contato: 'o salão não tem WhatsApp', falhou: 'o pedido não chegou ao salão', nao: 'o salão disse não' }
const SECOES = [['pedidos', 'Pedidos', Inbox], ['clientes', 'Clientes', Users], ['sem_resposta', 'Sem resposta', PhoneMissed], ['conversas', 'Conversas', MessagesSquare], ['simulador', 'Testar a Mel', Bot], ['config', 'Configuração', SlidersHorizontal]]
const BLOCOS = [['conexao', 'Conexão', Smartphone], ['site', 'No site', Globe], ['mel', 'A Mel', Sparkles], ['pedido', 'O pedido ao salão', Send], ['retorno', 'O retorno do salão', Vote], ['ciclo', 'Ciclo e ocioso', RefreshCw], ['equipe', 'Equipe e dona', Users], ['agenda', 'Quem quer a MIMO Agenda', Handshake], ['dados', 'Limites e privacidade', Shield]]
const PROBLEMAS = ['falhou', 'fora_do_limite', 'sem_contato', 'salao_saiu', 'pendente']
const FILTROS = [
  ['todos', 'Todos', () => true],
  ['aguardando', 'Aguardando o salão', (p) => p.status === 'enviado' && !p.voto],
  ['vao', 'Vão atender', (p) => p.voto === 'sim' || p.status === 'salao_vai_atender'],
  ['nao', 'Não vão atender', (p) => p.voto === 'nao' || p.status === 'salao_nao_atende'],
  ['querem', 'Querem a MIMO', (p) => p.status === 'salao_quer_conhecer'],
  ['resgate', 'Mel ofereceu outro salão', (p) => !!p.resgate_em],
  ['problemas', 'Com problema', (p) => PROBLEMAS.includes(p.status)],
  ['atendidos', 'Atendidos', (p) => !!p.atendido],
]
const CHAVE_SECAO = 'mimo:plat:wa:secao'
const CLIENTES_FILTROS = [
  ['todas', 'Todas', () => true],
  ['atendidas', 'Atendidas', (c) => !!c.atendida],
  ['aguardando', 'Aguardando', (c) => c.aguardando > 0],
  ['sem_dono', 'Sem dono', (c) => c.sem_dono > 0],
  ['recorrentes', 'Pediram mais de uma vez', (c) => c.pedidos > 1],
]

export default function WhatsAppGuia({ g }) {
  const [dias, setDias] = useState(7)
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [form, setForm] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState(null)
  const [conexao, setConexao] = useState(null)
  const [ocupado, setOcupado] = useState('')
  const [pareamento, setPareamento] = useState(null)
  const [conversa, setConversa] = useState(null)
  // 3.59: a Abordagem pode mandar abrir esta aba com uma busca (o nome do salão)
  const [recado] = useState(() => pegarRecado('whatsapp'))
  const [secao, setSecaoBruto] = useState(() => (recado?.busca ? 'pedidos' : lerSecao(CHAVE_SECAO, SECOES, 'pedidos')))
  const [filtro, setFiltro] = useState('todos')
  const [busca, setBusca] = useState(recado?.busca ?? '')
  const [blocoAtivo, setBlocoAtivo] = useState('conexao')
  const indice = useIndice()
  // 3.76: o WhatsApp comercial está ligado? (decide qual dos dois textos da MIMO Agenda vai)
  const [comercial, setComercial] = useState(null)
  // 3.59: as clientes que pediram (lidas quando a seção abre; de novo quando o período muda)
  const [cli, setCli] = useState(null) // { dias, lista }
  const [filtroCli, setFiltroCli] = useState('todas')
  const [buscaCli, setBuscaCli] = useState('')

  const setSecao = (s) => { setSecaoBruto(s); guardarSecao(CHAVE_SECAO, s) }
  const ler = useCallback(async () => {
    const { data, error } = await supabase.rpc('guia_whats_painel', { dias_: dias })
    if (error) { setErro(faltaMigracao(error) ? 'sem_195' : error.message || 'não deu para ler'); return }
    setErro(''); setDados(data); setForm((f) => f ?? data?.config ?? null)
  }, [dias])
  useEffect(() => { const t = setTimeout(ler, 0); return () => clearTimeout(t) }, [ler])
  const lerEstado = useCallback(async () => {
    try { setConexao(await chamar('guia-whats', { acao: 'estado' })) } catch (e) { setConexao({ estado: 'erro', erro: e.message }) }
  }, [])
  useEffect(() => { const t = setTimeout(lerEstado, 0); return () => clearTimeout(t) }, [lerEstado])
  useEffect(() => {
    if (conexao?.estado !== 'connecting') return
    const t = setInterval(lerEstado, 5000)
    return () => clearInterval(t)
  }, [conexao?.estado, lerEstado])
  // o índice da configuração acompanha a rolagem
  useEffect(() => { if (secao === 'config') return indice.observar(setBlocoAtivo) }, [secao, form, indice])
  useEffect(() => {
    if (secao !== 'config' || comercial) return
    let vivo = true
    supabase.rpc('comercial_publico').then(({ data, error }) => { if (vivo) setComercial(error || !data?.ligado ? { ligado: false } : { ligado: true, numero: data.numero, nome: data.nome }) })
    return () => { vivo = false }
  }, [secao, comercial])
  useEffect(() => {
    if (secao !== 'clientes' || cli?.dias === dias) return
    let vivo = true
    supabase.rpc('guia_whats_clientes', { dias_: dias }).then(({ data, error }) => { if (vivo) setCli({ dias, lista: error ? [] : (data ?? []) }) })
    return () => { vivo = false }
  }, [secao, cli, dias])

  const campo = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const sujo = useMemo(() => !!(form && dados?.config) && CAMPOS_CONFIG.some((k) => JSON.stringify(form[k] ?? null) !== JSON.stringify(dados.config[k] ?? null)), [form, dados])
  const salvar = async () => {
    if (!form) return
    setSalvando(true); setAviso(null)
    const c = Object.fromEntries(CAMPOS_CONFIG.map((k) => [k, form[k]]))
    const { data, error } = await supabase.rpc('guia_whats_salvar', { c })
    setSalvando(false)
    if (error) { setAviso({ tipo: 'erro', texto: error.message }); return } // o que foi digitado fica, para corrigir o campo
    setForm(data); setDados((d) => (d ? { ...d, config: data } : d)); setAviso({ tipo: 'ok', texto: 'Configuração salva.' })
    lerEstado()
  }
  const descartar = () => { setForm(dados?.config ?? form); setAviso(null) }
  const agir = async (acao, extra = {}) => {
    setOcupado(acao); setAviso(null)
    try {
      const r = await chamar('guia-whats', { acao, ...extra })
      if (acao === 'conectar') setPareamento(r)
      if (acao === 'desconectar') setPareamento(null)
      await lerEstado()
      if (acao === 'reenviar') { setAviso({ tipo: 'ok', texto: 'Pedido reenviado ao salão.' }); await ler() }
      return r
    } catch (e) { setAviso({ tipo: 'erro', texto: e.message }) } finally { setOcupado('') }
  }
  const atendido = async (id, v) => {
    setDados((d) => ({ ...d, pedidos: d.pedidos.map((p) => (p.id === id ? { ...p, atendido: v } : p)) }))
    await supabase.rpc('guia_whats_lead_atendido', { id_: id, atendido_: v })
  }
  const abrirConversa = async (id) => {
    const { data } = await supabase.rpc('guia_whats_conversa', { id_: id })
    if (data) setConversa(data)
  }
  const irParaAbordagem = (nome) => { deixarRecado('abordagem', { busca: nome }); g?.irPara?.('abordagem') }

  if (erro === 'sem_195') return <Vazio>O WhatsApp do guia precisa da migração 195: rode o bat B e depois o bat 9 (as funções).</Vazio>
  if (!dados || !form) return <div className="pg-carregando">{erro ? erro : <><LoaderCircle className="pg-gira" size={18} /> Abrindo o WhatsApp do guia…</>}</div>
  const t = dados.totais ?? {}
  const con = conexao ?? { estado: 'desconhecido' }
  const falta = con.segredos ? Object.entries({ evolution: 'EVOLUTION_URL e EVOLUTION_API_KEY', webhook: 'EVOLUTION_WEBHOOK_TOKEN', [form.provedor === 'claude' ? 'claude' : 'groq']: form.provedor === 'claude' ? 'ANTHROPIC_API_KEY' : 'GROQ_API_KEY' }).filter(([k]) => con.segredos[k] === false).map(([, v]) => v) : []
  const modelos = MODELOS[form.provedor] ?? []
  const pedidos = dados.pedidos ?? []
  const filtrados = pedidos.filter(FILTROS.find(([id]) => id === filtro)?.[2] ?? (() => true)).filter((p) => {
    const q = normal(busca).trim()
    return !q || normal(`${p.cliente_nome} ${p.salao_nome} ${p.cidade} ${p.servico} ${p.cliente_tel}`).includes(q)
  })
  const contagem = Object.fromEntries(FILTROS.map(([id, , fn]) => [id, pedidos.filter(fn).length]))
  const clientes = cli?.dias === dias ? cli.lista : null
  const clientesLista = (clientes ?? []).filter(CLIENTES_FILTROS.find(([id]) => id === filtroCli)?.[2] ?? (() => true)).filter((c) => {
    const q = normal(buscaCli).trim()
    return !q || normal(`${c.nome} ${c.telefone} ${c.servico} ${(c.saloes ?? []).map((x) => x.nome).join(' ')}`).includes(q)
  })
  const contagemCli = Object.fromEntries(CLIENTES_FILTROS.map(([id, , fn]) => [id, (clientes ?? []).filter(fn).length]))

  return (
    <div className="pg-wa pg-wa-v2" data-teste="whatsapp-guia">
      {erro && <div className="alert alert-error">{erro}</div>}
      {aviso && <div className={'alert ' + (aviso.tipo === 'erro' ? 'alert-error' : 'alert-ok')} data-teste="wa-aviso">{aviso.texto}</div>}

      {/* o cabeçalho: o estado da conexão, o número e as ações */}
      <header className="pg-wa-hero">
        <div className="pg-wa-estado" data-teste="wa-estado">
          <span className={'pg-wa-luz ' + (CONEXAO[con.estado]?.[1] ?? 'cinza')} aria-hidden="true" />
          <div>
            <b>{CONEXAO[con.estado]?.[0] ?? con.estado}</b>
            <small>{form.numero ? `${tel(form.numero)} · instância ${form.instancia}` : 'sem número ainda'}{con.erro ? ` · ${con.erro}` : ''}</small>
            {falta.length > 0 && <small className="pg-wa-falta"><TriangleAlert size={13} /> Falta nos segredos do Supabase: {falta.join(', ')}</small>}
          </div>
        </div>
        <div className="pg-wa-hero-acoes">
          <span className={'pg-wa-pilula grande ' + (dados.config?.ligado ? 'verde' : 'cinza')} title="Se os botões dos salões fora da MIMO abrem a conversa com a Mel (muda em Configuração → No site)">{dados.config?.ligado ? 'Ligado no site' : 'Desligado no site'}</span>
          <button type="button" className="btn btn-primary" onClick={() => agir('conectar')} disabled={!!ocupado || !telValido(form.numero) || form.numero !== dados.config?.numero} title={form.numero !== dados.config?.numero ? 'Salve a configuração antes de conectar' : ''} data-teste="wa-conectar">{ocupado === 'conectar' ? <LoaderCircle className="pg-gira" size={15} /> : <Smartphone size={15} />} {con.estado === 'open' ? 'Reconectar' : 'Conectar'}</button>
          {con.estado === 'open' && <button type="button" className="btn btn-ghost" onClick={() => agir('desconectar')} disabled={!!ocupado}><Unplug size={15} /> Desconectar</button>}
          <button type="button" className="plat-link" onClick={lerEstado}><RefreshCw size={14} /> Conferir</button>
          <label className="pg-wa-dias">Período <select className="plat-select" value={dias} onChange={(e) => setDias(Number(e.target.value))}><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option></select></label>
        </div>
      </header>
      {pareamento && con.estado !== 'open' && (
        <div className="pg-wa-pareamento" data-teste="wa-pareamento">
          {pareamento.pairingCode && <p>No celular do chip: WhatsApp → Aparelhos conectados → Conectar aparelho → <b>Conectar com número de telefone</b> e digite <code>{pareamento.pairingCode}</code> (vale por ~1 minuto; se vencer, Conectar de novo).</p>}
          {pareamento.qr && <img src={pareamento.qr} alt="QR code para parear o WhatsApp" width={220} height={220} />}
          {!pareamento.pairingCode && !pareamento.qr && <p>{pareamento.erro || 'A Evolution não devolveu código nem QR. Abra o Manager da Evolution, instância do guia, QR code.'}</p>}
          {pareamento.webhook && pareamento.webhook !== 'ok' && <p className="muted"><TriangleAlert size={13} /> {pareamento.webhook}</p>}
        </div>
      )}

      {/* os números do período e o funil do pedido */}
      <section className="pg-wa-numeros">
        <div className="pg-wa-kpis">
          <Tile Icon={MessagesSquare} cor="azul" n={t.conversas} rotulo="conversas" />
          <Tile Icon={Send} cor="rosa" n={t.enviados} rotulo="pedidos enviados" />
          <Tile Icon={MousePointerClick} cor="roxo" n={t.abriram} rotulo="abriram o pedido" />
          <Tile Icon={ThumbsUp} cor="menta" n={t.vao_atender} rotulo="vão atender" teste="wa-kpi-vao" />
          <Tile Icon={ThumbsDown} cor="carmim" n={t.nao_atendem} rotulo="não vão atender" teste="wa-kpi-nao" />
          <Tile Icon={MessageCircle} cor="azul" n={t.responderam} rotulo="salões responderam" />
          <Tile Icon={Sparkles} cor="rosa" n={t.querem} rotulo="querem conhecer a MIMO" />
          <Tile Icon={LifeBuoy} cor="menta" n={t.recuperados} rotulo="recuperadas: escolheram outro salão" teste="wa-kpi-recuperadas" />
          <Tile Icon={Zap} cor="ambar" n={t.enviados_hoje} extra={<small>/{form.limite_dia}</small>} rotulo="enviados hoje" barra={form.limite_dia ? Math.min(100, Math.round(((t.enviados_hoje ?? 0) / form.limite_dia) * 100)) : 0} />
        </div>
        <Funil titulo="O funil do pedido" sub={`últimos ${dias} dias`} teste="wa-funil" linhas={[['Enviados ao salão', t.enviados ?? 0], ['Abriram o link', t.abriram ?? 0], ['Disseram que vão atender', t.vao_atender ?? 0]]} />
      </section>

      {/* as seções */}
      <Nav secoes={SECOES} secao={secao} onTrocar={setSecao} sujo={sujo} prefixo="wa" rotulo="Seções do WhatsApp do guia"
        contagens={{ pedidos: pedidos.length, conversas: (dados.conversas ?? []).length, clientes: clientes?.length ?? 0 }} />

      {secao === 'pedidos' && (
        <section className="pg-wa-secao">
          <div className="pg-wa-ferramentas">
            <div className="pg-chips pg-wa-filtros" data-teste="wa-filtros">
              {FILTROS.map(([id, rotulo]) => <button key={id} type="button" className={'plat-chip' + (filtro === id ? ' ativo' : '')} onClick={() => setFiltro(id)} aria-pressed={filtro === id}>{rotulo}{contagem[id] > 0 && <span>{contagem[id]}</span>}</button>)}
            </div>
            <label className="pg-wa-busca"><Search size={14} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Cliente, salão, serviço ou telefone…" aria-label="Buscar pedidos" data-teste="wa-busca" />{busca && <button type="button" onClick={() => setBusca('')} aria-label="Limpar"><X size={13} /></button>}</label>
          </div>
          {pedidos.length === 0 ? <Vazio>Nenhum pedido no período. Quando uma cliente confirmar um pedido com a Mel, ele aparece aqui.</Vazio>
            : filtrados.length === 0 ? <Vazio>Nenhum pedido com esse filtro.</Vazio> : (
              <ul className="pg-wa-peds" data-teste="wa-pedidos">
                {filtrados.map((p) => <Pedido key={p.id} p={p} ocupado={ocupado} onAtendido={atendido} onReenviar={() => agir('reenviar', { lead: p.id })} onConversa={abrirConversa} onAbordagem={() => irParaAbordagem(p.salao_nome)} />)}
              </ul>
            )}
        </section>
      )}

      {secao === 'clientes' && (
        <section className="pg-wa-secao">
          <p className="muted pg-wa-secao-sub">As clientes que pediram horário pela Mel no período, por telefone: quantos pedidos, em quais salões, se alguém disse que vai atender e o que ficou sem dono. Quando o salão não responde (ou diz não), a Mel oferece outros salões e a cliente escolhe; o pedido só vai com o “sim” dela.</p>
          <div className="pg-wa-ferramentas">
            <div className="pg-chips pg-wa-filtros" data-teste="wa-cli-filtros">
              {CLIENTES_FILTROS.map(([id, rotulo]) => <button key={id} type="button" className={'plat-chip' + (filtroCli === id ? ' ativo' : '')} onClick={() => setFiltroCli(id)} aria-pressed={filtroCli === id}>{rotulo}{contagemCli[id] > 0 && <span>{contagemCli[id]}</span>}</button>)}
            </div>
            <label className="pg-wa-busca"><Search size={14} /><input value={buscaCli} onChange={(e) => setBuscaCli(e.target.value)} placeholder="Nome, telefone, serviço ou salão…" aria-label="Buscar clientes" data-teste="wa-cli-busca" />{buscaCli && <button type="button" onClick={() => setBuscaCli('')} aria-label="Limpar"><X size={13} /></button>}</label>
          </div>
          {clientes === null ? <div className="pg-carregando"><LoaderCircle className="pg-gira" size={16} /> Lendo as clientes…</div>
            : clientes.length === 0 ? <Vazio>Nenhuma cliente no período.</Vazio>
              : clientesLista.length === 0 ? <Vazio>Nenhuma cliente com esse filtro.</Vazio> : (
                <ul className="pg-wa-peds pg-wa-clis" data-teste="wa-clientes">
                  {clientesLista.map((c) => (
                    <li key={c.chave} className={'pg-wa-ped ' + (c.atendida ? 'ok' : c.sem_dono > 0 ? 'nao' : c.aguardando > 0 ? 'falha' : 'neutro')} data-teste="wa-cliente">
                      <div className="pg-wa-ped-cab">
                        <Iniciais nome={c.nome || '?'} />
                        <div className="pg-wa-ped-quem">
                          <b>{c.nome || 'sem nome'}</b>
                          <span className="muted">{tel(c.telefone)}{c.servico ? ` · ${c.servico}` : ''}</span>
                        </div>
                        <div className="pg-wa-ped-dir">
                          {c.atendida ? <Pilula par={['Vai ser atendida ✅', 'verde']} /> : c.sem_dono > 0 ? <Pilula par={['Sem dono', 'carmim']} /> : c.aguardando > 0 ? <Pilula par={['Aguardando o salão', 'ambar']} /> : <Pilula par={['Pediu', 'cinza']} />}
                          <small className="muted" title={quando(c.ultimo)}>{haQuanto(c.ultimo)}</small>
                        </div>
                      </div>
                      <p className="pg-wa-ped-pedido"><b>{c.pedidos}</b> {c.pedidos === 1 ? 'pedido' : 'pedidos'} em <b>{c.saloes_n}</b> {c.saloes_n === 1 ? 'salão' : 'salões'}: {(c.saloes ?? []).map((x) => x.nome).join(', ')}</p>
                      <ol className="pg-wa-passos">
                        <li className={'pg-wa-passo ' + (c.abriram ? 'ok' : 'espera')}><span className="pg-wa-passo-ic"><MousePointerClick size={12} /></span><span className="pg-wa-passo-txt">{c.abriram ? 'Algum salão abriu o link' : 'Nenhum salão abriu o link'}</span></li>
                        <li className={'pg-wa-passo ' + (c.atendida ? 'ok' : c.recusados > 0 ? 'nao' : 'espera')}><span className="pg-wa-passo-ic">{c.atendida ? <ThumbsUp size={12} /> : c.recusados > 0 ? <ThumbsDown size={12} /> : <Circle size={12} />}</span><span className="pg-wa-passo-txt">{c.atendida ? 'Um salão disse que vai atender' : c.recusados > 0 ? `${c.recusados} ${c.recusados === 1 ? 'salão disse' : 'salões disseram'} que não` : 'Ninguém respondeu ainda'}</span></li>
                        {c.sem_dono > 0 && <li className="pg-wa-passo nao"><span className="pg-wa-passo-ic"><UserX size={12} /></span><span className="pg-wa-passo-txt">{c.sem_dono} {c.sem_dono === 1 ? 'pedido ficou' : 'pedidos ficaram'} sem dono</span></li>}
                      </ol>
                      <div className="pg-wa-ped-acoes">
                        <a className="plat-link" href={`https://wa.me/${String(c.telefone).replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} /> Falar com a cliente</a>
                        {c.sem_dono > 0 && <span className="muted">Sem dono: ofereça outro salão (um da MIMO ali perto, se tiver) — na mão.</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
        </section>
      )}

      {secao === 'sem_resposta' && <SemResposta dias={dias} onAbordagem={irParaAbordagem} />}

      {secao === 'conversas' && (
        <section className="pg-wa-secao">
          <p className="muted pg-wa-secao-sub">As últimas conversas no número do guia (as de teste não entram). Toque para ler.</p>
          {(dados.conversas ?? []).length === 0 ? <Vazio>Nenhuma conversa no período.</Vazio> : (
            <ul className="pg-wa-convs" data-teste="wa-conversas">
              {dados.conversas.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => abrirConversa(c.id)}>
                    <Iniciais nome={c.salao || 'Sem salão'} cor={{ conversando: 'azul', confirmando: 'ambar', enviado: 'menta', encerrada: 'cinza' }[c.estado]} />
                    <span className="pg-wa-conv-meio">
                      <span className="pg-wa-conv-topo"><b>{c.salao || 'sem salão'}</b>{c.cidade && <span className="muted"> · {c.cidade}</span>} <Pilula par={{ conversando: ['Conversando', 'azul'], confirmando: ['Confirmando', 'ambar'], enviado: ['Pedido enviado', 'verde'], encerrada: ['Encerrada', 'cinza'] }[c.estado]} /></span>
                      <span className="pg-wa-conv-ultima">{tel(c.telefone)} · {c.n} {c.n === 1 ? 'mensagem' : 'mensagens'}{c.ultima ? ` · “${String(c.ultima).slice(0, 110)}”` : ''}</span>
                    </span>
                    <small className="muted">{haQuanto(c.atualizada_em)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {secao === 'simulador' && (
        <section className="pg-wa-secao pg-wa-secao-sim">
          <Simulador g={g} cfg={dados.config} />
          <aside className="pg-wa-sim-dicas">
            <h4><Bot size={16} /> O que dá para testar aqui</h4>
            <ul>
              <li><b>A conversa da cliente</b>, do botão do salão até o "sim": a Mel chama a IA de verdade, com a configuração salva.</li>
              <li><b>A mensagem que o salão receberia</b> e a enquete "vai atender?" que vai logo atrás — sem enviar nada.</li>
              <li><b>Cada voto do salão:</b> o que ele, a cliente e a equipe receberiam no "sim" e no "não" (no “não”, já com os salões sugeridos).</li>
              <li><b>E se o salão não responder:</b> a mensagem que a cliente recebe com os salões sugeridos — e dá para seguir respondendo o número, como ela faria.</li>
              <li><b>A dona testando</b> o próprio salão: o reconhecimento, o exemplo e o aviso à equipe.</li>
              <li><b>Quem pergunta da MIMO Agenda</b> (“quanto custa o sistema?”, “sou dona de um salão”): a Mel responde com o link do comercial, e a conversa segue.</li>
            </ul>
            <p className="muted">O envio de verdade ao salão, o "sem contato" e o relógio só se testam no WhatsApp.</p>
          </aside>
        </section>
      )}

      {secao === 'config' && (
        <section className="pg-wa-secao pg-wa-config">
          <Indice blocos={BLOCOS} ativo={blocoAtivo} onIr={(id) => indice.irPara(id, setBlocoAtivo)} rotulo="Blocos da configuração" />
          <div className="pg-wa-blocos pg-wa-form">
            <Bloco id="conexao" aoMontar={indice.registrar} Icon={Smartphone} titulo="Conexão do número" sub="Um chip só para o guia, na mesma Evolution dos salões. Conectar (no topo) cria a instância, aponta o webhook e mostra o código de pareamento.">
              <div className="pg-wa-grade2">
                <label>Número do WhatsApp do guia<input value={mascararTel(form.numero)} onChange={(e) => campo('numero', telCanon(e.target.value))} placeholder="(13) 99999-0000" inputMode="tel" maxLength={16} data-teste="wa-numero" />
                  {form.numero ? (!telValido(form.numero)
                    ? <small className="pg-wa-tel-dica erro"><TriangleAlert size={12} /> Faltam dígitos: DDD e número, como (13) 99999-0000.</small>
                    : form.numero !== dados.config?.numero
                      ? <small className="pg-wa-tel-dica salvar"><Save size={12} /> Número válido. Salve a configuração para liberar o Conectar.</small>
                      : <small className="pg-wa-tel-dica ok"><Check size={12} /> Número salvo. Pode conectar.</small>) : null}
                </label>
                <label>Instância na Evolution<input value={form.instancia ?? ''} onChange={(e) => campo('instancia', e.target.value)} placeholder="mimo-guia" /></label>
              </div>
            </Bloco>

            <Bloco id="site" aoMontar={indice.registrar} Icon={Globe} titulo="No site" sub="O que os botões da página de um salão fora da MIMO fazem.">
              <Chave checked={form.ligado} onChange={(v) => campo('ligado', v)} teste="wa-ligado"><b>Ligado</b> <span className="muted">(os botões abaixo abrem a conversa com a Mel no número do guia)</span></Chave>
              <fieldset className="pg-wa-botoes">
                <legend>Quais botões da página do salão passam pela MIMO</legend>
                {BOTOES.map(([k, rotulo, dica]) => <label key={k}><input type="checkbox" checked={(form.botoes ?? []).includes(k)} onChange={(e) => campo('botoes', e.target.checked ? [...new Set([...(form.botoes ?? []), k])] : (form.botoes ?? []).filter((b) => b !== k))} /> <b>{rotulo}</b> <span className="muted">{dica}</span></label>)}
              </fieldset>
              <label>Mensagem que o botão do site já deixa escrita <span className="muted">(o código do salão vai no fim, sozinho)</span>
                <input value={form.msg_cliente ?? ''} onChange={(e) => campo('msg_cliente', e.target.value)} maxLength={500} /></label>
            </Bloco>

            <Bloco id="mel" aoMontar={indice.registrar} Icon={Sparkles} titulo="A Mel" sub="Quem atende a cliente: a IA, o modelo e a orientação.">
              <div className="pg-wa-grade3">
                <label>IA que atende<select className="plat-select" value={form.provedor} onChange={(e) => { campo('provedor', e.target.value); campo('modelo', null) }}><option value="groq">Groq (grátis)</option><option value="claude">Claude</option></select></label>
                <label>Modelo<select className="plat-select" value={form.modelo ?? ''} onChange={(e) => campo('modelo', e.target.value || null)}><option value="">o padrão ({form.provedor === 'claude' ? 'Haiku 5.5' : 'GPT-OSS 120B'})</option>{modelos.map((m) => <option key={m.id} value={m.id}>{m.nome} · {m.nota}</option>)}</select></label>
                <label>Respostas por número por dia <span className="muted">(depois disso, avisa e silencia)</span><input type="number" min={1} max={500} value={form.limite_respostas ?? 30} onChange={(e) => campo('limite_respostas', Number(e.target.value))} data-teste="wa-limite-respostas" /></label>
              </div>
              <label>Orientação da Mel <span className="muted">({'{salao}'} vira o nome do salão; os fatos do salão e o que já foi anotado vão junto, sozinhos)</span>
                <textarea rows={8} value={form.orientacao ?? ''} onChange={(e) => campo('orientacao', e.target.value)} maxLength={6000} /></label>
            </Bloco>

            <Bloco id="pedido" aoMontar={indice.registrar} Icon={Send} titulo="O pedido ao salão" sub="O que o salão recebe quando a cliente diz “sim”, e a resposta quando ele escreve de volta.">
              <label>Mensagem que o salão recebe <span className="muted">({'{cliente}'}, {'{servico}'}, {'{preferencia}'}, {'{observacao}'}, {'{contato}'}, {'{link}'}, {'{salao}'}; a linha de um campo vazio some)</span>
                <textarea rows={9} value={form.msg_salao ?? ''} onChange={(e) => campo('msg_salao', e.target.value)} maxLength={3000} data-teste="wa-msg-salao" /></label>
              <label>Resposta quando o salão responde ao pedido <span className="muted">(uma vez só; QUERO e SAIR são reconhecidos sempre)</span>
                <textarea rows={3} value={form.msg_salao_resposta ?? ''} onChange={(e) => campo('msg_salao_resposta', e.target.value)} maxLength={1500} /></label>
              <div className="pg-wa-grade2">
                <label>Limite de pedidos por dia<input type="number" min={1} max={1000} value={form.limite_dia ?? 40} onChange={(e) => campo('limite_dia', Number(e.target.value))} /></label>
                <Chave checked={form.mostrar_contato_salao} onChange={(v) => campo('mostrar_contato_salao', v)}>A cliente recebe o contato do salão no fim</Chave>
              </div>
            </Bloco>

            <Bloco id="retorno" aoMontar={indice.registrar} Icon={Vote} titulo="O retorno do salão" sub="Ele diz se vai atender; a Mel reage e a equipe acompanha." teste="wa-retorno">
              <Chave checked={form.enquete_ativa !== false} onChange={(v) => campo('enquete_ativa', v)} teste="wa-enquete-ativa"><b>Mandar a enquete “vai atender?” logo depois do pedido</b> <span className="muted">(enquete do WhatsApp: o único botão que aparece em todo aparelho pela Evolution. O primeiro voto vale; trocar depois só fica anotado aqui. Um “não vou conseguir” ou “vou atender” claro, por texto, também conta.)</span></Chave>
              <div className="pg-wa-grade3">
                <label>Pergunta da enquete <span className="muted">({'{cliente}'}, {'{salao}'}, {'{servico}'})</span><input value={form.enquete_pergunta ?? ''} onChange={(e) => campo('enquete_pergunta', e.target.value)} maxLength={200} disabled={form.enquete_ativa === false} data-teste="wa-enquete-pergunta" /></label>
                <label>Opção “sim”<input value={form.enquete_sim ?? ''} onChange={(e) => campo('enquete_sim', e.target.value)} maxLength={60} disabled={form.enquete_ativa === false} data-teste="wa-enquete-sim" /></label>
                <label>Opção “não”<input value={form.enquete_nao ?? ''} onChange={(e) => campo('enquete_nao', e.target.value)} maxLength={60} disabled={form.enquete_ativa === false} data-teste="wa-enquete-nao" /></label>
              </div>
              <div className="pg-wa-grade2">
                <label>Resposta ao salão no “sim” <span className="muted">({'{cliente}'}, {'{salao}'}, {'{servico}'}, {'{preferencia}'}, {'{link}'})</span>
                  <textarea rows={3} value={form.msg_salao_vai_atender ?? ''} onChange={(e) => campo('msg_salao_vai_atender', e.target.value)} maxLength={1500} data-teste="wa-msg-vai-atender" /></label>
                <label>Resposta ao salão no “não” <span className="muted">(os mesmos campos)</span>
                  <textarea rows={3} value={form.msg_salao_nao_atende ?? ''} onChange={(e) => campo('msg_salao_nao_atende', e.target.value)} maxLength={1500} data-teste="wa-msg-nao-atende" /></label>
              </div>
              <div className="pg-wa-sub">
                <Chave checked={form.avisar_cliente_nao !== false} onChange={(v) => campo('avisar_cliente_nao', v)} teste="wa-avisar-cliente-nao"><b>No “não”, avisar a cliente e oferecer outro salão</b> <span className="muted">(a conversa dela reabre sem salão; nome, serviço e preferência ficam anotados)</span></Chave>
                <label>Mensagem para a cliente <span className="muted">({'{nome}'} = o primeiro nome, {'{salao}'}, {'{servico}'})</span>
                  <textarea rows={2} value={form.msg_cliente_nao_atende ?? ''} onChange={(e) => campo('msg_cliente_nao_atende', e.target.value)} maxLength={1500} disabled={form.avisar_cliente_nao === false} data-teste="wa-msg-cliente-nao" /></label>
                <Chave checked={form.aviso_nao_atende !== false} onChange={(v) => campo('aviso_nao_atende', v)} teste="wa-aviso-nao-atende"><b>No “não”, avisar a equipe</b> <span className="muted">(no WhatsApp da equipe para avisos, em Equipe e dona)</span></Chave>
                <label>Aviso à equipe no “não” <span className="muted">({'{salao}'}, {'{cidade}'}, {'{cliente}'}, {'{contato}'}, {'{servico}'}, {'{preferencia}'})</span>
                  <textarea rows={3} value={form.msg_aviso_nao_atende ?? ''} onChange={(e) => campo('msg_aviso_nao_atende', e.target.value)} maxLength={1500} disabled={form.aviso_nao_atende === false} data-teste="wa-msg-aviso-nao" /></label>
              </div>
              <div className="pg-wa-sub">
                <div className="pg-wa-grade2">
                  <label>Avisar a equipe se o salão não der sinal em (min) <span className="muted">(0 = desligado; “sinal” = abrir o link, votar ou responder)</span><input type="number" min={0} max={10080} value={form.aviso_demora_min ?? 0} onChange={(e) => campo('aviso_demora_min', Number(e.target.value))} data-teste="wa-demora-min" /></label>
                  <label>Cutucar o próprio salão em (min) <span className="muted">(0 = desligado; uma vez só por pedido)</span><input type="number" min={0} max={10080} value={form.cutucar_salao_min ?? 0} onChange={(e) => campo('cutucar_salao_min', Number(e.target.value))} data-teste="wa-cutucar-min" /></label>
                </div>
                <div className="pg-wa-grade2">
                  <label>Aviso à equipe da demora <span className="muted">({'{tempo}'} e os mesmos campos)</span>
                    <textarea rows={3} value={form.msg_aviso_demora ?? ''} onChange={(e) => campo('msg_aviso_demora', e.target.value)} maxLength={1500} disabled={!(form.aviso_demora_min > 0)} data-teste="wa-msg-demora" /></label>
                  <label>Mensagem que cutuca o salão <span className="muted">({'{cliente}'}, {'{servico}'}, {'{link}'}, {'{salao}'})</span>
                    <textarea rows={3} value={form.msg_cutucar_salao ?? ''} onChange={(e) => campo('msg_cutucar_salao', e.target.value)} maxLength={1500} disabled={!(form.cutucar_salao_min > 0)} data-teste="wa-msg-cutucar" /></label>
                </div>
                <p className="muted pg-wa-nota"><Clock size={12} /> Os dois tempos usam o mesmo relógio (cron) do ocioso ativo na VPS: sem ele no ar, deixe em 0. A enquete e as respostas não dependem do relógio.</p>
              </div>
              <div className="pg-wa-sub" data-teste="wa-resgate">
                <p className="pg-wa-sub-titulo"><LifeBuoy size={14} /> <b>Recuperar a cliente</b> <span className="muted">— o salão não deu sinal (ou o pedido nem chegou): a Mel escreve para a cliente com outros salões perto, e ela escolhe pelo número. O pedido só vai com o “sim” dela.</span></p>
                <div className="pg-wa-grade3">
                  <label>Oferecer outros salões depois de (min) <span className="muted">(0 = desligado)</span><input type="number" min={0} max={1440} value={form.resgate_min ?? 30} onChange={(e) => campo('resgate_min', Number(e.target.value))} data-teste="wa-resgate-min" /></label>
                  <label>Só entre <span className="muted">(de madrugada ela espera a manhã)</span>
                    <span className="pg-wa-janela"><input type="time" value={String(form.resgate_inicio ?? '08:00').slice(0, 5)} onChange={(e) => campo('resgate_inicio', e.target.value)} disabled={!(form.resgate_min > 0)} data-teste="wa-resgate-inicio" /> e <input type="time" value={String(form.resgate_fim ?? '21:00').slice(0, 5)} onChange={(e) => campo('resgate_fim', e.target.value)} disabled={!(form.resgate_min > 0)} data-teste="wa-resgate-fim" /></span></label>
                  <label>Quantos salões sugerir<select className="plat-select" value={form.resgate_opcoes ?? 3} onChange={(e) => campo('resgate_opcoes', Number(e.target.value))} disabled={!(form.resgate_min > 0)} data-teste="wa-resgate-opcoes">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                </div>
                <label>Mensagem para a cliente <span className="muted">({'{nome}'} = o primeiro nome, {'{salao}'} = o que não respondeu, {'{opcoes}'} = a lista numerada com a pergunta — obrigatória)</span>
                  <textarea rows={4} value={form.msg_resgate ?? ''} onChange={(e) => campo('msg_resgate', e.target.value)} maxLength={1500} disabled={!(form.resgate_min > 0)} data-teste="wa-msg-resgate" /></label>
                <p className="muted pg-wa-nota"><Sparkles size={12} /> Os salões sugeridos: a mesma cidade, com o serviço pedido (ou a mesma categoria), os mais perto (até 20 km) e, entre eles, primeiro os que agendam pela MIMO e os que costumam responder. Ficam fora o próprio salão, os que ela já tentou, quem não tem WhatsApp e quem recebeu 3 pedidos sem dar sinal. Se o primeiro salão responder depois: a cliente que já escolheu outro segue com ele (o salão recebe um obrigado); a que ainda não escolheu fica sabendo que ele vai chamar. O “não” do salão também já sugere os salões ({'{opcoes}'} na mensagem do “não”).</p>
                <Relogio em={dados.config?.relogio_em} />
              </div>
            </Bloco>

            <Bloco id="ciclo" aoMontar={indice.registrar} Icon={RefreshCw} titulo="O ciclo da conversa" sub="Como a Mel conduz e quando encerra — você define." teste="wa-ciclo">
              <Chave checked={form.exigir_preferencia} onChange={(v) => campo('exigir_preferencia', v)} teste="wa-exigir-preferencia">Só enviar ao salão com a preferência de dia e horário <span className="muted">(desligado, basta nome e serviço; a preferência vira um extra)</span></Chave>
              <div className="pg-wa-grade3">
                <label>Dúvidas que a Mel responde depois de enviar <span className="muted">(depois, se despede e silencia)</span><input type="number" min={0} max={20} value={form.pos_envio ?? 3} onChange={(e) => campo('pos_envio', Number(e.target.value))} data-teste="wa-pos-envio" /></label>
                <label>Mensagens sem avançar antes de encerrar <span className="muted">(a conversa que não anda)</span><input type="number" min={2} max={50} value={form.max_sem_avanco ?? 6} onChange={(e) => campo('max_sem_avanco', Number(e.target.value))} data-teste="wa-max-sem-avanco" /></label>
                <label>Esquecer a conversa parada depois de (horas) <span className="muted">(rede de segurança: a cliente recomeça do zero)</span><input type="number" min={1} max={168} value={form.ocioso_horas ?? 24} onChange={(e) => campo('ocioso_horas', Number(e.target.value))} data-teste="wa-ocioso-horas" /></label>
              </div>
              <label>Mensagem ao encerrar a conversa <span className="muted">(quando a conversa não avança; a cliente pode voltar quando quiser)</span>
                <textarea rows={2} value={form.msg_encerramento ?? ''} onChange={(e) => campo('msg_encerramento', e.target.value)} maxLength={1000} data-teste="wa-msg-encerramento" /></label>
              <div className="pg-wa-sub" data-teste="wa-ocioso">
                <Chave checked={form.ocioso_ativo} onChange={(v) => campo('ocioso_ativo', v)} teste="wa-ocioso-ativo"><b>Encerrar sozinha as conversas paradas</b> <span className="muted">(precisa do relógio na VPS; veja a nota abaixo)</span></Chave>
                <div className="pg-wa-grade2">
                  <label>Parada há (min), a Mel pergunta se pode encerrar <input type="number" min={5} max={10080} value={form.ocioso_perguntar_min ?? 60} onChange={(e) => campo('ocioso_perguntar_min', Number(e.target.value))} disabled={!form.ocioso_ativo} data-teste="wa-ocioso-perguntar" /></label>
                  <label>Sem resposta por mais (min), encerra e fecha <input type="number" min={5} max={10080} value={form.ocioso_encerrar_min ?? 120} onChange={(e) => campo('ocioso_encerrar_min', Number(e.target.value))} disabled={!form.ocioso_ativo} data-teste="wa-ocioso-encerrar" /></label>
                </div>
                <label>Mensagem “posso encerrar?” <span className="muted">(a Mel manda quando a conversa fica parada; se a cliente responder, a conversa continua)</span>
                  <textarea rows={2} value={form.msg_ocioso ?? ''} onChange={(e) => campo('msg_ocioso', e.target.value)} maxLength={1000} disabled={!form.ocioso_ativo} data-teste="wa-msg-ocioso" /></label>
                <p className="muted pg-wa-nota"><Clock size={12} /> A Mel só fala quando chega mensagem; para ela cutucar sozinha, um relógio (cron) na VPS precisa chamar o webhook de tempos em tempos. Enquanto esse cron não estiver no ar, deixe isto desligado — o fluxo “sem avançar” acima continua valendo.</p>
              </div>
            </Bloco>

            <Bloco id="equipe" aoMontar={indice.registrar} Icon={Users} titulo="Equipe e a dona" sub="Para onde vão os avisos internos, e o que a Mel diz quando reconhece a própria dona testando.">
              <label>WhatsApp da equipe para avisos <span className="muted">(salão sem WhatsApp, a dona testando, o salão que não vai atender ou que demora. Vazio = sem aviso, só na lista de pedidos.)</span>
                <input value={mascararTel(form.numero_avisos)} onChange={(e) => campo('numero_avisos', telCanon(e.target.value))} placeholder="(13) 99999-0000" inputMode="tel" maxLength={16} data-teste="wa-numero-avisos" /></label>
              <label>Mensagem para a própria dona testando <span className="muted">(quando quem escreve está no número cadastrado do salão: a Mel reconhece e apresenta a MIMO Agenda. {'{salao}'} vira o nome; {'{exemplo}'} vira o exemplo de como um pedido chegaria.)</span>
                <textarea rows={6} value={form.msg_dona ?? ''} onChange={(e) => campo('msg_dona', e.target.value)} maxLength={4000} data-teste="wa-msg-dona" /></label>
            </Bloco>

            <Bloco id="agenda" aoMontar={indice.registrar} Icon={Handshake} titulo="Quem quer a MIMO Agenda" sub="O número da Mel é das clientes. A dona ou a profissional que pergunta da MIMO Agenda recebe o link do WhatsApp comercial." teste="wa-bloco-agenda">
              {dados.config && !('msg_sobre_agenda' in dados.config) && <p className="pg-wa-erro"><TriangleAlert size={13} /> Falta a migração 221 no banco (bat, opção B): até lá a Mel não encaminha e estes campos não são salvos.</p>}
              <Chave checked={form.sobre_agenda !== false} onChange={(v) => campo('sobre_agenda', v)} teste="wa-sobre-agenda"><b>Encaminhar para o comercial quem pergunta da MIMO Agenda</b> <span className="muted">(a conversa não fecha: se era uma cliente, ela segue marcando)</span></Chave>
              <p className="muted pg-wa-nota" data-teste="wa-comercial-estado"><Handshake size={12} /> {!comercial ? 'Conferindo o WhatsApp comercial…' : comercial.ligado
                ? <>O WhatsApp comercial está <b>ligado</b> ({comercial.nome || 'a assistente'}, {tel(comercial.numero)}): vai o primeiro texto, com o link dele.</>
                : <>O WhatsApp comercial está <b>desligado</b> (aba Comercial): vai o segundo texto, com o site.</>}</p>
              <label>Com o comercial ligado <span className="muted">({'{nome}'} vira o nome da assistente; {'{link}'}, o WhatsApp comercial, já com a frase “Vim pela Mel”; {'{marcar}'}, a volta para quem era cliente. O {'{link}'} é obrigatório.)</span>
                <textarea rows={5} value={form.msg_sobre_agenda ?? ''} onChange={(e) => campo('msg_sobre_agenda', e.target.value)} maxLength={2000} disabled={form.sobre_agenda === false} data-teste="wa-msg-sobre-agenda" /></label>
              <label>Com o comercial desligado <span className="muted">({'{link}'} vira mimo.com.vc; {'{marcar}'} como acima)</span>
                <textarea rows={4} value={form.msg_sobre_agenda_site ?? ''} onChange={(e) => campo('msg_sobre_agenda_site', e.target.value)} maxLength={2000} disabled={form.sobre_agenda === false} data-teste="wa-msg-sobre-agenda-site" /></label>
              <p className="muted pg-wa-nota"><Sparkles size={12} /> A Mel percebe pelas frases que não deixam dúvida (“como funciona a MIMO Agenda”, “quanto custa o sistema”, “sou dona de um salão”, “quero colocar meu salão no guia”) e, no meio da conversa de um salão, pela IA. Da segunda vez em diante ela manda só o link. A própria dona, escrevendo do número cadastrado do salão, continua recebendo a mensagem da dona (bloco acima). Com o comercial e este encaminhamento ligados, as frases de entrada do agente de onboarding também vêm para cá (o agente volta a atender quando um dos dois desliga). A equipe não é avisada: o comercial cuida.</p>
            </Bloco>

            <Bloco id="dados" aoMontar={indice.registrar} Icon={Shield} titulo="Limites e privacidade" sub="Por quanto tempo as conversas e os pedidos ficam guardados.">
              <div className="pg-wa-grade2">
                <label>Guardar conversas e pedidos por (dias)<input type="number" min={7} max={730} value={form.retencao_dias ?? 90} onChange={(e) => campo('retencao_dias', Number(e.target.value))} /></label>
              </div>
              <p className="muted pg-wa-nota"><Shield size={12} /> A política de privacidade (3.10) diz 90 dias de guarda e que a Mel se apresenta como MIMO: se mudar a retenção para mais, mude a política. Nada vai ao salão sem o "sim" da cliente depois do resumo; "apagar meus dados" apaga tudo dela; SAIR tira o salão.</p>
            </Bloco>
          </div>
          <BarraSalvar sujo={sujo} salvando={salvando} atualizadoEm={dados.config?.atualizado_em} onSalvar={salvar} onDescartar={descartar} teste="wa-salvar" />
        </section>
      )}

      {conversa && (
        <div className="pg-wa-fundo" onClick={() => setConversa(null)} role="presentation">
          <div className="pg-wa-caixa" role="dialog" aria-modal="true" aria-label="Conversa" onClick={(e) => e.stopPropagation()} data-teste="wa-conversa-aberta">
            <header><b>{conversa.salao || 'sem salão'}</b><span className="muted">{tel(conversa.telefone)}{conversa.cidade ? ` · ${conversa.cidade}` : ''}</span><button type="button" className="plat-link" onClick={() => setConversa(null)} aria-label="Fechar"><X size={18} /></button></header>
            <Chat mensagens={conversa.mensagens} teste="wa-chat" />
            {conversa.dados && Object.keys(conversa.dados).length > 0 && <p className="muted pg-wa-anotado">Anotado: {Object.entries(conversa.dados).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// um pedido: quem, para qual salão, o que pediu, e a linha do tempo (enviado → abriu o link → o retorno do salão)
function Pedido({ p, ocupado, onAtendido, onReenviar, onConversa, onAbordagem }) {
  const [abrir, setAbrir] = useState(false)
  const msgs = p.salao_mensagens?.length > 0 ? p.salao_mensagens : p.resposta_salao ? [{ texto: p.resposta_salao }] : []
  const tom = p.voto === 'sim' || p.status === 'salao_vai_atender' ? 'ok' : p.voto === 'nao' || p.status === 'salao_nao_atende' ? 'nao' : p.status === 'salao_quer_conhecer' ? 'quer' : PROBLEMAS.includes(p.status) ? 'falha' : 'neutro'
  const passos = [
    { k: 'envio', Icon: Send, tom: p.enviado_em ? 'ok' : PROBLEMAS.includes(p.status) ? 'falha' : 'espera', rotulo: p.enviado_em ? 'Enviado ao salão' : STATUS[p.status]?.[0] ?? 'Não enviado', quando: p.enviado_em },
    { k: 'abriu', Icon: MousePointerClick, tom: p.clicou_em ? 'ok' : 'espera', rotulo: p.clicou_em ? `Abriu a conversa com a cliente${p.cliques > 1 ? ` · ${p.cliques}×` : ''}` : 'Ainda não abriu o link', quando: p.clicou_em, teste: p.clicou_em ? 'wa-abriu' : undefined },
  ]
  if (p.voto) {
    passos.push({ k: 'voto', Icon: p.voto === 'sim' ? ThumbsUp : ThumbsDown, tom: p.voto === 'sim' ? 'ok' : 'nao', rotulo: p.voto === 'sim' ? 'Vai atender' : 'Não vai atender', quando: p.votou_em, teste: 'wa-voto',
      detalhe: ` · ${p.voto_origem === 'texto' ? 'por texto' : 'pela enquete'}`, mudou: p.voto_atual && p.voto_atual !== p.voto ? ` · depois mudou para “${VOTO[p.voto_atual]}” · ${haQuanto(p.voto_mudou_em)} (só anotado)` : '' })
  } else if (p.com_enquete && p.status === 'enviado') {
    passos.push({ k: 'voto', Icon: Vote, tom: 'espera', rotulo: 'Enquete enviada · sem voto ainda', teste: 'wa-sem-voto' })
  } else if (p.salao_respondeu_em) {
    passos.push({ k: 'voto', Icon: MessagesSquare, tom: 'ok', rotulo: 'Salão respondeu', quando: p.salao_respondeu_em })
  } else if (p.enviado_em) {
    passos.push({ k: 'voto', Icon: Circle, tom: 'espera', rotulo: 'Sem resposta do salão' })
  }
  return (
    <li className={'pg-wa-ped ' + tom + (p.atendido ? ' atendido' : '')} data-teste="wa-pedido">
      <div className="pg-wa-ped-cab">
        <Iniciais nome={p.cliente_nome || '?'} />
        <div className="pg-wa-ped-quem">
          <b>{p.cliente_nome || 'sem nome'}</b>
          <span className="muted">{tel(p.cliente_tel)} · pediu no <b>{p.salao_nome}</b>{p.cidade ? `, ${p.cidade}` : ''}</span>
        </div>
        <div className="pg-wa-ped-dir"><Pilula par={STATUS[p.status]} /><small className="muted" title={quando(p.criado_em)}>{haQuanto(p.criado_em)}</small></div>
      </div>
      <p className="pg-wa-ped-pedido">{[p.servico, p.preferencia].filter(Boolean).join(' · ') || 'sem detalhes'}{p.observacao ? <span className="muted"> · {p.observacao}</span> : null}</p>
      <ol className="pg-wa-passos">
        {passos.map((x) => (
          <li key={x.k} className={'pg-wa-passo ' + x.tom} data-teste={x.teste}>
            <span className="pg-wa-passo-ic"><x.Icon size={12} /></span>
            <span className="pg-wa-passo-txt">{x.rotulo}{x.quando ? ` · ${haQuanto(x.quando)}` : ''}{x.detalhe ?? ''}{x.mudou ? <small>{x.mudou}</small> : null}</span>
          </li>
        ))}
      </ol>
      {(p.erro || p.aviso_demora_em || p.cutucado_em || p.resgate_em || p.resgate_de) && (
        <div className="pg-wa-ped-extras">
          {p.resgate_em && <span className="pg-wa-espera" data-teste="wa-resgatado" title={(p.resgate_opcoes ?? []).map((o, i) => `${i + 1}) ${o.nome}`).join('\n') || 'sem salões para sugerir: pediu outro pelo nome'}><LifeBuoy size={13} /> Mel ofereceu {p.resgate_opcoes?.length ? `${p.resgate_opcoes.length} ${p.resgate_opcoes.length === 1 ? 'salão' : 'salões'}` : 'outro salão'} à cliente ({RESGATE[p.resgate_motivo] ?? 'sem sinal'}) · {haQuanto(p.resgate_em)}</span>}
          {p.resgate_de && <span className="pg-wa-espera ok" data-teste="wa-recuperada"><LifeBuoy size={13} /> Cliente recuperada: veio de um salão que não respondeu</span>}
          {p.erro && <span className="pg-wa-erro"><TriangleAlert size={13} /> {p.erro}</span>}
          {p.aviso_demora_em && <span className="pg-wa-espera" data-teste="wa-demora"><Hourglass size={13} /> Equipe avisada da demora · {haQuanto(p.aviso_demora_em)}</span>}
          {p.cutucado_em && <span className="pg-wa-espera" data-teste="wa-cutucado"><BellRing size={13} /> Salão cutucado · {haQuanto(p.cutucado_em)}</span>}
        </div>
      )}
      {msgs.length > 0 && (
        <div className={'pg-wa-thread' + (abrir ? ' aberta' : '')} data-teste="wa-thread">
          <button type="button" onClick={() => setAbrir((a) => !a)} aria-expanded={abrir}><MessagesSquare size={13} /> O salão escreveu{msgs.length > 1 ? ` (${msgs.length})` : ''}{p.salao_respondeu_em ? ` · ${haQuanto(p.salao_respondeu_em)}` : ''} <ChevronDown size={13} className="pg-wa-thread-seta" /></button>
          {(abrir ? msgs : msgs.slice(-1)).map((m, i) => <span key={i} className="pg-wa-thread-msg">{m.texto}{m.em ? <small>{quando(m.em)}</small> : null}</span>)}
        </div>
      )}
      <div className="pg-wa-ped-acoes">
        <label className={'pg-wa-chip-check' + (p.atendido ? ' marcado' : '')}><input type="checkbox" checked={!!p.atendido} onChange={(e) => onAtendido(p.id, e.target.checked)} /> <Check size={12} /> Atendido pela equipe</label>
        {['falhou', 'fora_do_limite', 'pendente'].includes(p.status) && p.salao_tel && <button type="button" className="plat-link" onClick={onReenviar} disabled={!!ocupado}><Send size={13} /> Reenviar ao salão</button>}
        {p.salao_tel && <a className="plat-link" href={`https://wa.me/${p.salao_tel}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} /> Falar com o salão</a>}
        {p.salao_tel && !/^55[1-9][0-9]9/.test(p.salao_tel) && <a className="plat-link" href={`tel:+${p.salao_tel}`}><Phone size={13} /> Ligar ({tel(p.salao_tel)})</a>}
        <a className="plat-link" href={`https://wa.me/${String(p.cliente_tel).replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} /> Falar com a cliente</a>
        {p.conversa_id && <button type="button" className="plat-link" onClick={() => onConversa(p.conversa_id)}><Bot size={13} /> Ver a conversa</button>}
        {p.lugar_id && <button type="button" className="plat-link" onClick={onAbordagem} title="Abrir este salão na fila de abordagem"><Handshake size={13} /> Ver na Abordagem</button>}
      </div>
    </li>
  )
}

// 3.77: o relógio da VPS (cutucar-ociosas.sh, a cada 5 min) é quem dispara os avisos, as cutucadas e o resgate
const minutosDesde = (em) => (em ? Math.round((Date.now() - new Date(em).getTime()) / 60000) : null)
function Relogio({ em }) {
  const min = minutosDesde(em)
  const ok = min !== null && min <= 15
  return (
    <p className={'pg-wa-nota pg-wa-relogio ' + (ok ? 'ok' : 'falta')} data-teste="wa-relogio">
      <Clock size={12} /> {min === null
        ? <>O relógio da VPS ainda não passou por aqui. O bat 2 liga o relógio sozinho (cutucar-ociosas.sh, a cada 5 min); sem ele, nada disto dispara.</>
        : ok ? <>O relógio da VPS está rodando: passou {min < 1 ? 'agora há pouco' : `há ${min} min`}.</>
          : <>O relógio da VPS não passa há {haQuanto(em)}: confira na VPS com <code>crontab -l | grep cutucar</code> e <code>tail cutucar.log</code>.</>}
    </p>
  )
}

// 3.77: os salões que deixaram clientes sem resposta (ou que o pedido nem alcançou): a equipe confere o número e anota
function SemResposta({ dias, onAbordagem }) {
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [busca, setBusca] = useState('')
  const ler = useCallback(async () => {
    const { data, error } = await supabase.rpc('guia_whats_sem_resposta', { dias_: Math.max(dias, 30) })
    if (error) { setErro(faltaMigracao(error) ? 'Falta a migração 222 no banco (bat, opção B).' : error.message || 'não deu para ler'); setLista([]); return }
    setErro(''); setLista(data ?? [])
  }, [dias])
  useEffect(() => { const t = setTimeout(ler, 0); return () => clearTimeout(t) }, [ler])
  const conferir = async (l, desfazer = false) => {
    const nota = desfazer ? null : window.prompt(`O que você achou ao conferir o número de ${l.nome}? (ex.: atende por este número, número errado, não atendeu)`, l.conferido_nota ?? '')
    if (!desfazer && nota === null) return
    setOcupado(l.lugar_id)
    const { error } = await supabase.rpc('guia_whats_conferir', { lugar_: l.lugar_id, nota_: nota, desfazer_: desfazer })
    setOcupado('')
    if (error) { setErro(error.message); return }
    ler()
  }
  const q = normal(busca).trim()
  const vistos = (lista ?? []).filter((l) => !q || normal(`${l.nome} ${l.cidade} ${l.bairro} ${l.numero}`).includes(q))
  return (
    <section className="pg-wa-secao" data-teste="wa-sem-resposta">
      <p className="muted pg-wa-secao-sub">Os salões que deixaram clientes sem resposta nos últimos {Math.max(dias, 30)} dias: o pedido foi há mais de 2 horas e ele não abriu o link, não votou nem escreveu — ou o pedido nem chegou (sem WhatsApp, o envio falhou). Vale conferir se o número atende; e o número de clientes perdidas é o argumento na abordagem.</p>
      <div className="pg-wa-ferramentas">
        <label className="pg-wa-busca"><Search size={14} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar salão, cidade, bairro ou número" /></label>
      </div>
      {erro && <p className="pg-wa-erro"><TriangleAlert size={13} /> {erro}</p>}
      {lista === null ? <Vazio>Carregando…</Vazio> : vistos.length === 0 ? <Vazio>Nenhum salão deixou cliente sem resposta no período. 💗</Vazio> : (
        <ul className="pg-wa-peds pg-wa-sr-lista">
          {vistos.map((l) => (
            <li key={l.lugar_id} className={'pg-wa-ped pg-wa-sr ' + (l.conferido_em ? 'neutro' : 'falha')} data-teste="wa-sem-resposta-item">
              <div className="pg-wa-ped-cab">
                <Iniciais nome={l.nome} />
                <div className="pg-wa-ped-quem">
                  <b>{l.nome}</b>
                  <span className="muted">{[l.bairro, l.cidade].filter(Boolean).join(' · ')}{l.numero ? ` · ${tel(l.numero)}` : ' · sem celular no cadastro'}{l.invalido ? ' · número marcado sem WhatsApp' : ''}</span>
                </div>
                <div className="pg-wa-ped-dir"><small className="muted">último pedido {haQuanto(l.ultimo)}</small></div>
              </div>
              <p className="pg-wa-sr-numeros">
                <b>{l.sem_resposta + l.nao_chegou}</b> {l.sem_resposta + l.nao_chegou === 1 ? 'cliente ficou' : 'clientes ficaram'} sem resposta
                {l.nao_chegou > 0 && <span className="muted"> ({l.nao_chegou} nem {l.nao_chegou === 1 ? 'chegou' : 'chegaram'} ao salão)</span>}
                <span className="muted"> · {l.pedidos} {l.pedidos === 1 ? 'pedido' : 'pedidos'} no período{l.responderam > 0 ? ` · respondeu ${l.responderam}` : ''}{l.ofereceu_outro > 0 ? ` · a Mel ofereceu outro salão ${l.ofereceu_outro}×` : ''}</span>
              </p>
              {l.conferido_em && <p className="pg-wa-sr-conferido"><ShieldCheck size={13} /> Conferido {haQuanto(l.conferido_em)}{l.conferido_nota ? `: ${l.conferido_nota}` : ''}</p>}
              <div className="pg-wa-ped-acoes">
                {l.numero && <a className="plat-link" href={`https://wa.me/${l.numero}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} /> Testar no WhatsApp</a>}
                {(l.telefone || l.numero) && <a className="plat-link" href={`tel:+${String(l.numero || l.telefone).replace(/\D/g, '').replace(/^(?!55)/, '55')}`}><Phone size={13} /> Ligar</a>}
                <button type="button" className="plat-link" onClick={() => conferir(l)} disabled={ocupado === l.lugar_id} data-teste="wa-conferir"><ShieldCheck size={13} /> {l.conferido_em ? 'Conferir de novo' : 'Marcar como conferido'}</button>
                {l.conferido_em && <button type="button" className="plat-link" onClick={() => conferir(l, true)} disabled={ocupado === l.lugar_id}><Undo2 size={13} /> Desfazer</button>}
                <a className="plat-link" href={`/saloes/${l.cidade_slug}/${l.slug}`} target="_blank" rel="noopener noreferrer"><Globe size={13} /> A página</a>
                <button type="button" className="plat-link" onClick={() => onAbordagem(l.nome)}><Handshake size={13} /> Ver na Abordagem</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// conversar com a Mel como uma cliente, sem mandar nada a ninguém: a primeira mensagem é a que o botão do site deixa
// escrita (com o código do salão escolhido); no "sim", a mensagem que o salão receberia aparece em vez de sair
function Simulador({ g, cfg }) {
  const lista = Array.isArray(g?.lista) ? g.lista.filter((l) => l.status === 'publicado' && !l.salon_id) : []
  const [caminho, setCaminho] = useState(() => (lista[0] ? `${lista[0].cidade_slug}/${lista[0].slug}` : ''))
  const [mensagens, setMensagens] = useState([])
  const [texto, setTexto] = useState('')
  const [previa, setPrevia] = useState(null)
  const [previaAviso, setPreviaAviso] = useState(null)
  const [previaEnquete, setPreviaEnquete] = useState(null) // 3.57: a enquete que iria junto do pedido
  const [voto, setVoto] = useState(null) // 3.57: o que o salão, a cliente e a equipe receberiam num voto simulado
  const [dona, setDona] = useState(false)
  const [encaminhou, setEncaminhou] = useState(false) // 3.76: a última resposta foi o link do comercial
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const lugarDoCaminho = () => {
    const [cidade_slug, slug] = caminho.trim().toLowerCase().split('/')
    const l = lista.find((x) => x.cidade_slug === cidade_slug && x.slug === slug)
    return { nome: l?.nome ?? slug ?? '', cidade_slug, slug }
  }
  const mandar = async (corpo) => {
    setOcupado(true); setErro('')
    try {
      const r = await chamar('guia-whats', { acao: 'simular', ...corpo })
      setMensagens((m) => [...m, { q: 'cliente', t: r.texto }, ...(r.responder ? [{ q: 'mel', t: r.responder }] : [])])
      if (r.previaSalao) setPrevia(r.previaSalao)
      if (r.previaAviso) setPreviaAviso(r.previaAviso)
      if (r.previaEnquete) setPreviaEnquete(r.previaEnquete)
      setEncaminhou(r.acao === 'sobre_agenda')
      if (r.acao === 'erro_ia') setErro(r.erro || 'a IA não respondeu')
    } catch (e) { setErro(e.message) } finally { setOcupado(false) }
  }
  const limparPrevias = () => { setPrevia(null); setPreviaAviso(null); setPreviaEnquete(null); setVoto(null); setEncaminhou(false) }
  const comecar = () => { const l = lugarDoCaminho(); if (!l.cidade_slug || !l.slug) { setErro('informe cidade/slug, como itanhaem/studio-lirio'); return } setMensagens([]); limparPrevias(); mandar({ lugar: l, comoDona: dona }) }
  const enviar = (e) => { e.preventDefault(); const t = texto.trim(); if (!t) return; setTexto(''); mandar({ texto: t, comoDona: dona }) }
  const reiniciar = async () => { setMensagens([]); limparPrevias(); setErro(''); try { await chamar('guia-whats', { acao: 'reiniciar' }) } catch { /* sem conversa */ } }
  // 3.77: "e se o salão não responder?": a mensagem do resgate entra na conversa, que reabre com as opções (nada sai)
  const simularResgate = async () => {
    setOcupado(true); setErro('')
    try {
      const r = await chamar('guia-whats', { acao: 'simular_resgate' })
      if (r.responder) { setMensagens((m) => [...m, { q: 'mel', t: r.responder }]); limparPrevias(); setEncaminhou(false) }
      else setErro('não há conversa de teste com salão para simular')
    } catch (e) { setErro(e.message) } finally { setOcupado(false) }
  }
  // 3.57: "o salão votou": só prévias — não existe pedido de verdade na conversa de teste, nada é enviado
  const simularVoto = async (v) => {
    setOcupado(true); setErro('')
    try { setVoto({ v, ...(await chamar('guia-whats', { acao: 'simular_voto', voto: v })) }) } catch (e) { setErro(e.message) } finally { setOcupado(false) }
  }
  return (
    <Painel Icon={Bot} titulo="Testar a Mel" sub="Converse como se fosse uma cliente que tocou no botão de um salão. Nada é enviado a ninguém; no “sim”, você vê a mensagem que o salão receberia." className="pg-wa-sim" direita={mensagens.length > 0 && <button type="button" className="plat-link" onClick={reiniciar}><RotateCcw size={14} /> Recomeçar</button>}>
      {mensagens.length === 0 ? (
        <div className="pg-wa-sim-inicio">
          <label>Salão (cidade/slug, como no endereço da página)<input list="pg-wa-saloes" value={caminho} onChange={(e) => setCaminho(e.target.value)} placeholder="itanhaem/studio-lirio" data-teste="wa-sim-salao" />
            <datalist id="pg-wa-saloes">{lista.slice(0, 200).map((l) => <option key={l.id} value={`${l.cidade_slug}/${l.slug}`}>{l.nome}</option>)}</datalist></label>
          {lista.length === 0 && <p className="muted">A lista vem da cidade escolhida na aba Guia (só salões publicados). Sem ela, escreva cidade/slug como está no endereço da página do salão.</p>}
          <Chave checked={dona} onChange={setDona} teste="wa-sim-dona">Testar como a <b>dona</b> deste salão <span className="muted">(simula quem escreve do número cadastrado: a Mel reconhece e apresenta a MIMO Agenda)</span></Chave>
          <button type="button" className="btn btn-primary" onClick={comecar} disabled={ocupado} data-teste="wa-sim-comecar">{ocupado ? <LoaderCircle className="pg-gira" size={15} /> : <MessageCircle size={15} />} {dona ? 'Escrever como a dona' : 'Tocar no botão do salão'}</button>
          <p className="muted">A IA: {cfg?.provedor === 'claude' ? 'Claude' : 'Groq'}{cfg?.modelo ? ` · ${cfg.modelo}` : ''}. Cada mensagem chama a IA de verdade.</p>
        </div>
      ) : (
        <>
          <Chat mensagens={mensagens} teste="wa-chat" fim={ocupado && <div className="pg-wa-msg mel digitando"><LoaderCircle className="pg-gira" size={14} /> a Mel está escrevendo…</div>} />
          {erro && <p className="pg-wa-erro"><TriangleAlert size={13} /> {erro}</p>}
          {encaminhou && <p className="muted pg-wa-nota" data-teste="wa-sim-comercial"><Handshake size={12} /> Esta resposta foi o encaminhamento para o comercial (quem pergunta da MIMO Agenda). A conversa segue: dá para continuar como cliente.</p>}
          {previaAviso ? (
            <div className="pg-wa-previa" data-teste="wa-previa-aviso">
              <b><Check size={14} /> A equipe receberia este aviso (dona testando — não foi enviado):</b>
              <pre>{previaAviso}</pre>
            </div>
          ) : previa ? (
            <>
              <div className="pg-wa-previa" data-teste="wa-previa">
                <b><Check size={14} /> O salão receberia esta mensagem (não foi enviada):</b>
                <pre>{previa}</pre>
                {previaEnquete && (
                  <div className="pg-wa-enquete" data-teste="wa-previa-enquete">
                    <b><Vote size={14} /> …e logo atrás, a enquete:</b>
                    <p>{previaEnquete.pergunta}</p>
                    {previaEnquete.opcoes.map((o) => <span key={o}>○ {o}</span>)}
                  </div>
                )}
              </div>
              {voto ? (
                <div className={'pg-wa-previa pg-wa-voto-previa ' + voto.v} data-teste="wa-previa-voto">
                  <b>{voto.v === 'sim' ? <ThumbsUp size={14} /> : <ThumbsDown size={14} />} Se o salão votasse “{voto.v === 'sim' ? 'sim' : 'não'}” (nada foi enviado):</b>
                  <small>A Mel responde ao salão:</small><pre>{voto.responder}</pre>
                  {voto.previaCliente && <><small>A cliente recebe:</small><pre>{voto.previaCliente}</pre></>}
                  {voto.previaAviso && <><small>A equipe recebe:</small><pre>{voto.previaAviso}</pre></>}
                  {voto.v === 'nao' && !voto.previaCliente && <small>A cliente não é avisada (desligado na configuração).</small>}
                  <button type="button" className="plat-link" onClick={() => setVoto(null)}>Simular outro voto</button>
                </div>
              ) : (
                <div className="pg-wa-sim-voto" data-teste="wa-sim-voto">
                  <span className="muted">E se o salão respondesse?</span>
                  <button type="button" className="btn btn-ghost" onClick={() => simularVoto('sim')} disabled={ocupado} data-teste="wa-sim-voto-sim"><ThumbsUp size={14} /> Sim, vou atender</button>
                  <button type="button" className="btn btn-ghost" onClick={() => simularVoto('nao')} disabled={ocupado} data-teste="wa-sim-voto-nao"><ThumbsDown size={14} /> Não vou conseguir</button>
                  <button type="button" className="btn btn-ghost" onClick={simularResgate} disabled={ocupado} data-teste="wa-sim-resgate"><LifeBuoy size={14} /> E se não responder?</button>
                </div>
              )}
            </>
          ) : (
            <form className="pg-wa-sim-form" onSubmit={enviar}>
              <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva como a cliente…" disabled={ocupado} data-teste="wa-sim-texto" />
              <button type="submit" className="btn btn-primary" disabled={ocupado || !texto.trim()} aria-label="Enviar" data-teste="wa-sim-enviar"><Send size={15} /></button>
            </form>
          )}
        </>
      )}
    </Painel>
  )
}
