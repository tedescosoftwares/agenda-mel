import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Megaphone, Sparkles, Link2, Smartphone, Plus, Send, LoaderCircle, Pause, Play, ArrowLeft, Search, ImageUp, Eye, MousePointerClick, MessageCircle, Check, X, TriangleAlert, Users, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { Vazio, haQuanto } from '../Pecas'
import { Pilula, Chave } from './PecasWa'
import { tel } from '../../../lib/guiaWa'
import { carregarConfig, instagramDe } from '../../../lib/config'
import { enviarImagemDoDisparo } from '../../../lib/guiaFotos'
import { disparo, rpcDisparo, montarMensagem, linkDoEnvio, proximaEspera, VARIAVEIS, MAX_MENSAGEM, ESTADO_NUMERO, marcasDoEnvio, contasDoDisparo, pct } from '../../../lib/disparo'

// O disparo (4.4, migração 254): uma mensagem da equipe para quem já conversou com a Mel. Monta (os números por onde
// sai, quem recebe, a mensagem com a IA, o link com a prévia, o teste) e acompanha (cada pessoa: entregue, viu, clicou,
// respondeu). O envio é um por um, pela função disparo, enquanto esta aba está aberta: fechou, para; o Continuar
// volta de onde parou. O desenho é o aprovado nas pranchas do disparo.

const RASCUNHO = 'mimo-disparo-rascunho'
const TEL_TESTE = 'mimo-disparo-teste-tel'
const PERIODOS = [[30, '30 dias'], [60, '60 dias'], [90, '90 dias'], [365, '1 ano'], [0, 'Tudo']]
const RITMOS = [[20, '~20 s'], [40, '~40 s'], [60, '~1 min'], [120, '~2 min']]
const POR_PAGINA = 50
const TOKEN_EXEMPLO = 'a1b2c3d4e5'
const lerLocal = (k, padrao) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : padrao } catch { return padrao } }
const gravarLocal = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)) } catch { /* sem storage */ } }
const minutos = (s) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1).replace('.', ',')} h`)
const nomeDaPessoa = (p) => p.nome || null
const dataCurta = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '')
const quandoFoi = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
const PADRAO_INSTA = { titulo: 'Siga a MIMO no Instagram 💗', texto: 'Ajude o guia de salões a crescer e veja primeiro os salões mais bem avaliados da sua cidade.', imagem: '/og-instagram.jpg' }

export default function DisparoGuia({ irParaConexao }) {
  const [estado, setEstado] = useState(null)
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState(null) // o disparo que está sendo acompanhado
  const carregar = useCallback(async () => {
    try { setErro(''); setEstado(await disparo('estado')) } catch (e) { setErro(e.message) }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  if (erro && !estado) return <section className="pg-wa-secao"><p className="pg-nota pg-dp-erro"><TriangleAlert size={14} /> {erro}</p></section>
  if (!estado) return <section className="pg-wa-secao"><p className="pg-nota"><LoaderCircle size={14} className="pg-gira" /> Carregando o disparo…</p></section>
  const andamento = (estado.disparos ?? []).find((d) => d.status === 'enviando' || d.status === 'pausado')
  return (
    <section className="pg-wa-secao pg-dp" data-teste="dp">
      {aberto
        ? <Acompanhar id={aberto} numeros={estado.numeros} onVoltar={() => { setAberto(null); carregar() }} />
        : <>
          <p className="pg-dp-intro">Uma mensagem sua para quem já conversou com a Mel. Você escreve (ou pede para a IA), escolhe quem recebe e dispara: sai uma de cada vez, no ritmo escolhido, com o nome e a cidade de cada pessoa no lugar certo.</p>
          {andamento && (
            <button type="button" className="pg-dp-aviso" onClick={() => setAberto(andamento.id)} data-teste="dp-andamento">
              <Megaphone size={16} /> <b>{andamento.nome}</b> está {andamento.status === 'pausado' ? 'pausado' : 'saindo'}: {andamento.enviados} de {andamento.total} enviadas. <span>Abrir</span>
            </button>
          )}
          <Montar estado={estado} recarregar={carregar} irParaConexao={irParaConexao} onDisparado={(id) => setAberto(id)} />
        </>}
      <Anteriores disparos={estado.disparos ?? []} numeros={estado.numeros} onAbrir={setAberto} />
    </section>
  )
}

// ---- os números ----------------------------------------------------------------------------------------------------
function Numeros({ numeros, marcados, onMarcar, alternar, onAlternar, recarregar, irParaConexao, ritmo }) {
  const [conectando, setConectando] = useState(null) // { instancia?, rotulo, numero, trocar } no formulário
  const [pareamento, setPareamento] = useState(null)
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')
  const chips = numeros.filter((n) => n.tipo === 'chip')
  async function conectar() {
    setOcupado('conectar'); setErro('')
    try {
      const r = await disparo('conectar', conectando)
      setPareamento(r)
      if (r.estado === 'open') { setConectando(null); setPareamento(null); recarregar() }
    } catch (e) { setErro(e.message) } finally { setOcupado('') }
  }
  async function agir(acao, n) {
    if (acao === 'remover' && !window.confirm(`Tirar o ${n.rotulo} do disparo? O WhatsApp dele é desconectado daqui.`)) return
    setOcupado(acao + n.instancia); setErro('')
    try { await disparo(acao, { instancia: n.instancia }); recarregar() } catch (e) { setErro(e.message) } finally { setOcupado('') }
  }
  const ativos = numeros.filter((n) => marcados.includes(n.instancia))
  return (
    <div className="pg-dp-card" data-teste="dp-numeros">
      <h3>Sai pelos números</h3>
      <p className="pg-dp-sub">Marque um ou mais. A pessoa recebe de um deles, e a resposta dela chega nesse mesmo número.</p>
      <div className="pg-dp-numeros">
        {numeros.map((n) => {
          const ok = n.estado === 'open'
          const on = marcados.includes(n.instancia)
          return (
            <div key={n.instancia} className={'pg-dp-num' + (on ? ' on' : '') + (ok ? '' : ' fora')} data-teste={`dp-num-${n.instancia}`}>
              <label className="pg-dp-num-topo">
                <input type="checkbox" checked={on} disabled={!ok} onChange={() => onMarcar(n.instancia)} />
                <b>{n.rotulo}</b>
                <Pilula par={ESTADO_NUMERO[n.estado] ?? ESTADO_NUMERO.desconhecido} />
              </label>
              <span className="pg-dp-num-det">{n.numero ? tel(n.numero) : 'sem número'} · {n.instancia}</span>
              <span className="pg-dp-num-det">hoje: {n.hoje} {n.hoje === 1 ? 'disparo' : 'disparos'} · {n.tipo === 'guia' ? 'respostas: a Mel atende' : 'respostas: ficam no celular do chip'}</span>
              <span className="pg-dp-num-acoes">
                {n.tipo === 'guia'
                  ? (!ok && <button type="button" className="plat-link" onClick={irParaConexao}>Conectar em Configuração › Conexão</button>)
                  : <>
                    <button type="button" className="plat-link" onClick={() => { setPareamento(null); setConectando({ instancia: n.instancia, rotulo: n.rotulo, numero: '', trocar: ok }) }}>{ok ? 'Trocar número' : 'Conectar'}</button>
                    {ok && <button type="button" className="plat-link" disabled={!!ocupado} onClick={() => agir('desconectar', n)}>Desconectar</button>}
                    <button type="button" className="plat-link perigo" disabled={!!ocupado} onClick={() => agir('remover', n)}>Remover</button>
                  </>}
              </span>
            </div>
          )
        })}
        <button type="button" className="pg-dp-num novo" onClick={() => { setPareamento(null); setConectando({ rotulo: `Chip ${chips.length + 2}`, numero: '' }) }} data-teste="dp-num-novo">
          <Plus size={16} /> Conectar outro número<small>QR ou código, como na Conexão</small>
        </button>
      </div>
      {conectando && (
        <div className="pg-dp-conectar" data-teste="dp-conectar">
          <b>{conectando.instancia ? (conectando.trocar ? `Trocar o número do ${conectando.rotulo}` : `Conectar o ${conectando.rotulo}`) : 'Conectar outro número'}</b>
          <div className="pg-dp-linha">
            <label>Nome<input className="plat-input" value={conectando.rotulo} maxLength={40} onChange={(e) => setConectando({ ...conectando, rotulo: e.target.value })} /></label>
            <label>Número do chip (com DDD)<input className="plat-input" value={conectando.numero} inputMode="tel" placeholder="(11) 98888-0000" onChange={(e) => setConectando({ ...conectando, numero: e.target.value })} /></label>
            <button type="button" className="btn btn-primary" disabled={ocupado === 'conectar'} onClick={conectar}>{ocupado === 'conectar' ? <LoaderCircle size={15} className="pg-gira" /> : <Smartphone size={15} />} {pareamento ? 'Gerar de novo' : 'Conectar'}</button>
            <button type="button" className="plat-link" onClick={() => { setConectando(null); setPareamento(null) }}>Cancelar</button>
          </div>
          {pareamento && (
            <div className="pg-dp-pareia">
              {pareamento.pairingCode && <p>No celular do chip: WhatsApp → Aparelhos conectados → Conectar aparelho → <b>Conectar com número de telefone</b> e digite <code>{pareamento.pairingCode}</code> (vale por ~1 minuto).</p>}
              {pareamento.qr && <img src={pareamento.qr} alt="QR code para parear o chip" width={200} height={200} />}
              {!pareamento.pairingCode && !pareamento.qr && <p>{pareamento.erro || 'A Evolution não devolveu código nem QR: tente Gerar de novo.'}</p>}
              {pareamento.webhook && pareamento.webhook !== 'ok' && <p className="pg-dp-erro"><TriangleAlert size={13} /> {pareamento.webhook}</p>}
              <button type="button" className="btn btn-ghost" onClick={() => { setConectando(null); setPareamento(null); recarregar() }}><Check size={15} /> Já pareei</button>
            </div>
          )}
        </div>
      )}
      {erro && <p className="pg-dp-erro"><TriangleAlert size={13} /> {erro}</p>}
      <div className="pg-dp-alterna">
        <Chave checked={alternar} onChange={onAlternar} teste="dp-alternar"><b>Alternar entre os marcados</b> a cada mensagem <small>· cada número manda no máximo 1 a cada {RITMOS.find(([s]) => s === ritmo)?.[1] ?? `~${ritmo} s`}{alternar && ativos.length > 1 ? `, então com ${ativos.length} sai uma a cada ${minutos(ritmo / ativos.length)} no total` : ''}</small></Chave>
      </div>
    </div>
  )
}

// ---- montar --------------------------------------------------------------------------------------------------------
function Montar({ estado, recarregar, irParaConexao, onDisparado }) {
  const r0 = useMemo(() => lerLocal(RASCUNHO, {}), [])
  const conectados = estado.numeros.filter((n) => n.estado === 'open').map((n) => n.instancia)
  const [marcadosNum, setMarcadosNum] = useState(() => (r0.numeros ?? conectados).filter((i) => conectados.includes(i)))
  const [alternar, setAlternar] = useState(r0.alternar ?? true)
  const [ritmo, setRitmo] = useState(r0.ritmo ?? 40)
  const [nome, setNome] = useState(r0.nome ?? 'Convite do Instagram')
  const [texto, setTexto] = useState(r0.texto ?? '')
  const [pedidoIa, setPedidoIa] = useState(r0.pedidoIa ?? 'convite carinhoso e curto para seguir o Instagram da MIMO')
  const [destinoTipo, setDestinoTipo] = useState(r0.destinoTipo ?? 'instagram')
  const [destinoOutro, setDestinoOutro] = useState(r0.destinoOutro ?? '')
  const [previa, setPrevia] = useState(r0.previa ?? PADRAO_INSTA)
  const [rascunhoId, setRascunhoId] = useState(r0.id ?? null)
  const [insta, setInsta] = useState(null)
  const [ia, setIa] = useState('') // '', 'indo', ou o erro
  const [subindo, setSubindo] = useState(false)
  const [telTeste, setTelTeste] = useState(() => lerLocal(TEL_TESTE, ''))
  const [teste, setTeste] = useState(null) // { indo } | { ok } | { erro }
  const [confirmar, setConfirmar] = useState(false)
  const [indo, setIndo] = useState(false)
  const [erro, setErro] = useState('')
  const caixa = useRef(null)

  useEffect(() => { carregarConfig().then((c) => setInsta(instagramDe(c))).catch(() => setInsta(null)) }, [])
  useEffect(() => { gravarLocal(RASCUNHO, { id: rascunhoId, numeros: marcadosNum, alternar, ritmo, nome, texto, pedidoIa, destinoTipo, destinoOutro, previa }) }, [rascunhoId, marcadosNum, alternar, ritmo, nome, texto, pedidoIa, destinoTipo, destinoOutro, previa])

  const destino = destinoTipo === 'instagram' ? (insta?.handle ? `https://www.instagram.com/${insta.handle}/` : null) : destinoTipo === 'outro' ? (destinoOutro.trim() || null) : null
  const imagemPrevia = previa.imagem || null
  const imagemAbsoluta = previa.imagem?.startsWith('/') ? `https://mimo.com.vc${previa.imagem}` : previa.imagem

  // ---- a lista
  const [dias, setDias] = useState(90)
  const [lista, setLista] = useState(null)
  const [busca, setBusca] = useState('')
  const [cidade, setCidade] = useState('')
  const [comPedido, setComPedido] = useState(true)
  const [soConversou, setSoConversou] = useState(true)
  const [esconderJa, setEsconderJa] = useState(false)
  const [marcadas, setMarcadas] = useState(() => new Set())
  const [mostrar, setMostrar] = useState(POR_PAGINA)
  const [nomes, setNomes] = useState('')
  const carregarLista = useCallback(async () => {
    setLista(null)
    try { setLista(await rpcDisparo('disparo_pessoas', { dias_: dias || null })) } catch (e) { setLista({ erro: e.message, pessoas: [], fora: {} }) }
  }, [dias])
  useEffect(() => { carregarLista() }, [carregarLista])
  const pessoas = useMemo(() => lista?.pessoas ?? [], [lista])
  const cidades = useMemo(() => [...new Set(pessoas.map((p) => p.cidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [pessoas])
  const filtradas = useMemo(() => {
    const b = busca.trim().toLocaleLowerCase('pt-BR'); const bd = b.replace(/\D/g, '')
    return pessoas.filter((p) => (p.pedido ? comPedido : soConversou)
      && (!cidade || p.cidade === cidade) && (!esconderJa || !p.disparos)
      && (!b || `${p.nome ?? ''} ${p.nome_whats ?? ''} ${p.cidade ?? ''} ${p.salao ?? ''}`.toLocaleLowerCase('pt-BR').includes(b) || (bd.length >= 3 && String(p.telefone).replace(/\D/g, '').includes(bd))))
  }, [pessoas, busca, cidade, comPedido, soConversou, esconderJa])
  const nPedido = pessoas.filter((p) => p.pedido).length
  const marcadasLista = pessoas.filter((p) => marcadas.has(p.chave))
  const todasFiltradas = filtradas.length > 0 && filtradas.every((p) => marcadas.has(p.chave))
  const algumaFiltrada = filtradas.some((p) => marcadas.has(p.chave))
  const alternarTodas = () => setMarcadas((m) => { const n = new Set(m); if (todasFiltradas) filtradas.forEach((p) => n.delete(p.chave)); else filtradas.forEach((p) => n.add(p.chave)); return n })
  const alternarUma = (k) => setMarcadas((m) => { const n = new Set(m); if (n.has(k)) n.delete(k); else n.add(k); return n })

  // ---- a prévia de uma pessoa
  const [vez, setVez] = useState(0)
  const amostra = marcadasLista.length ? marcadasLista : filtradas
  const pessoaPrevia = amostra.length ? amostra[Math.min(vez, amostra.length - 1)] : { nome: 'Ana Paula', cidade: 'Santos', salao: 'Studio Lírio' }
  const textoPrevia = montarMensagem(texto, pessoaPrevia, destino ? linkDoEnvio(TOKEN_EXEMPLO) : null)

  function porVariavel(v) {
    const el = caixa.current
    if (!el) { setTexto((t) => t + v); return }
    const a = el.selectionStart ?? texto.length, b = el.selectionEnd ?? texto.length
    const novo = texto.slice(0, a) + v + texto.slice(b)
    setTexto(novo)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + v.length, a + v.length) })
  }
  async function escrever() {
    setIa('indo')
    try {
      const r = await disparo('escrever', { pedido: pedidoIa, atual: texto || undefined })
      setTexto(r.texto)
      if (r.titulo || r.descricao) setPrevia((p) => ({ ...p, titulo: r.titulo || p.titulo, texto: r.descricao || p.texto }))
      setIa('')
    } catch (e) { setIa(e.message) }
  }
  async function trocarImagem(file) {
    if (!file) return
    setSubindo(true)
    try { const { url } = await enviarImagemDoDisparo(file); setPrevia((p) => ({ ...p, imagem: url })) } catch (e) { setErro(e.message) } finally { setSubindo(false) }
  }
  // salva o rascunho no banco (para o teste e para disparar)
  async function salvar() {
    const id = await rpcDisparo('disparo_salvar', { d: { id: rascunhoId, nome, mensagem: texto, destino, previa_titulo: destino ? previa.titulo : null, previa_texto: destino ? previa.texto : null, previa_imagem: destino ? imagemAbsoluta : null, numeros: marcadosNum, alternar, ritmo_s: ritmo } })
    setRascunhoId(id)
    return id
  }
  async function mandarTeste() {
    setTeste({ indo: true }); gravarLocal(TEL_TESTE, telTeste)
    try {
      if (!marcadosNum.length) throw new Error('marque por qual número sai')
      const id = await salvar()
      const r = await disparo('teste', { disparo: id, telefone: telTeste, nome: pessoaPrevia.nome || pessoaPrevia.nome_whats || '', cidade: pessoaPrevia.cidade || '', salao: pessoaPrevia.salao || '' })
      setTeste(r.ok === false ? { erro: r.erro } : { ok: true })
    } catch (e) { setTeste({ erro: e.message }) }
  }
  async function disparar() {
    setIndo(true); setErro('')
    try {
      const id = await salvar()
      await rpcDisparo('disparo_comecar', { id_: id, chaves_: marcadasLista.map((p) => p.chave) })
      gravarLocal(RASCUNHO, null)
      onDisparado(id)
    } catch (e) { setErro(e.message); setIndo(false); setConfirmar(false) }
  }

  const ativos = marcadosNum.filter((i) => conectados.includes(i))
  const porNumero = alternar ? Math.max(1, ativos.length) : 1
  const duracao = marcadasLista.length * (ritmo / porNumero)
  const prontoParaDisparar = marcadasLista.length > 0 && ativos.length > 0 && texto.trim().length >= 5 && (destinoTipo !== 'outro' || /^https:\/\/\S{3,}$/.test(destinoOutro.trim()))
  const motivoNao = !ativos.length ? 'marque por qual número sai' : !marcadasLista.length ? 'marque quem recebe' : texto.trim().length < 5 ? 'escreva a mensagem' : destinoTipo === 'outro' && !/^https:\/\//.test(destinoOutro.trim()) ? 'o link precisa começar com https://' : ''

  return (
    <>
      <Numeros numeros={estado.numeros} marcados={marcadosNum} onMarcar={(i) => setMarcadosNum((m) => (m.includes(i) ? m.filter((x) => x !== i) : [...m, i]))}
        alternar={alternar} onAlternar={setAlternar} recarregar={recarregar} irParaConexao={irParaConexao} ritmo={ritmo} />

      <div className="pg-dp-grade">
        {/* para quem */}
        <div className="pg-dp-card" data-teste="dp-lista">
          <h3>Para quem {marcadas.size > 0 && <span className="pg-dp-conta">{marcadasLista.length} {marcadasLista.length === 1 ? 'marcada' : 'marcadas'}</span>}</h3>
          <p className="pg-dp-sub">Todo mundo que conversou com a Mel no período (o banco guarda as conversas por 90 dias) e quem mandou pedido antes disso.</p>
          <div className="pg-dp-filtros">
            <label className="pg-wa-busca"><Search size={14} /><input value={busca} onChange={(e) => { setBusca(e.target.value); setMostrar(POR_PAGINA) }} placeholder="Nome, cidade ou número" aria-label="Buscar pessoas" /></label>
            <select className="plat-select" value={dias} onChange={(e) => { setDias(Number(e.target.value)); setMostrar(POR_PAGINA) }} aria-label="Período">{PERIODOS.map(([d, r]) => <option key={d} value={d}>{d ? `Últimos ${r}` : r}</option>)}</select>
            <select className="plat-select" value={cidade} onChange={(e) => setCidade(e.target.value)} aria-label="Cidade"><option value="">Todas as cidades</option>{cidades.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <button type="button" className={'plat-chip' + (comPedido ? ' ativo' : '')} aria-pressed={comPedido} onClick={() => setComPedido(!comPedido)}>Mandou pedido · {nPedido}</button>
            <button type="button" className={'plat-chip' + (soConversou ? ' ativo' : '')} aria-pressed={soConversou} onClick={() => setSoConversou(!soConversou)}>Só conversou · {pessoas.length - nPedido}</button>
            <button type="button" className={'plat-chip' + (esconderJa ? ' ativo' : '')} aria-pressed={esconderJa} onClick={() => setEsconderJa(!esconderJa)}>Esconder quem já recebeu disparo</button>
          </div>
          {lista && !lista.erro && (
            <p className="pg-dp-fora">Fora da lista sempre: {lista.fora?.salao ?? 0} {lista.fora?.salao === 1 ? 'número de salão ou de dona de salão' : 'números de salão e de donas de salão'}, {lista.fora?.teste ?? 0} de teste e {lista.fora?.nossos ?? 0} da própria MIMO. <button type="button" className="plat-link" disabled={nomes === 'indo'} onClick={async () => { setNomes('indo'); try { const r = await disparo('nomes'); setNomes(`${r.gravados} ${r.gravados === 1 ? 'nome atualizado' : 'nomes atualizados'} do WhatsApp`); carregarLista() } catch (e) { setNomes(e.message) } }}>{nomes === 'indo' ? 'Puxando…' : 'Puxar os nomes do WhatsApp'}</button>{nomes && nomes !== 'indo' && <em> {nomes}</em>}</p>
          )}
          {!lista ? <p className="pg-nota"><LoaderCircle size={14} className="pg-gira" /> Carregando…</p>
            : lista.erro ? <p className="pg-dp-erro"><TriangleAlert size={13} /> {lista.erro}</p>
              : !pessoas.length ? <Vazio>Ninguém conversou com a Mel nesse período.</Vazio>
                : (
                  <>
                    <table className="pg-dp-tabela">
                      <thead><tr>
                        <th><input type="checkbox" checked={todasFiltradas} ref={(el) => { if (el) el.indeterminate = !todasFiltradas && algumaFiltrada }} onChange={alternarTodas} aria-label={`Marcar as ${filtradas.length} da lista`} /></th>
                        <th>Pessoa</th><th>Cidade e salão</th><th /><th>Última conversa</th>
                      </tr></thead>
                      <tbody>
                        {filtradas.slice(0, mostrar).map((p) => (
                          <tr key={p.chave} className={marcadas.has(p.chave) ? 'marcada' : ''} onClick={(e) => { if (e.target.tagName !== 'INPUT') alternarUma(p.chave) }}>
                            <td><input type="checkbox" checked={marcadas.has(p.chave)} onChange={() => alternarUma(p.chave)} aria-label={`Marcar ${nomeDaPessoa(p) ?? p.telefone}`} /></td>
                            <td className="pg-dp-pessoa"><b className={nomeDaPessoa(p) ? '' : 'sem'}>{nomeDaPessoa(p) ?? 'sem nome'}</b><small>{tel(p.telefone)}{p.nome_whats && p.nome_whats !== p.nome ? <> · <em>no WhatsApp: {p.nome_whats}</em></> : null}</small></td>
                            <td className="pg-dp-onde">{p.cidade || '—'}<small>{p.salao || 'não chegou a escolher salão'}</small></td>
                            <td><span className={'pg-dp-tag ' + (p.pedido ? 'ped' : 'conv')}>{p.pedido ? 'mandou pedido' : 'só conversou'}</span>{p.ultimo_disparo && <span className="pg-dp-tag ja">disparo em {dataCurta(p.ultimo_disparo)}</span>}</td>
                            <td className="pg-dp-quando">{p.ultimo ? haQuanto(p.ultimo) : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="pg-dp-mais">Mostrando {Math.min(mostrar, filtradas.length)} de {filtradas.length}{filtradas.length > mostrar && <> · <button type="button" className="plat-link" onClick={() => setMostrar((m) => m + POR_PAGINA * 4)}>ver mais</button></>}</p>
                  </>
                )}
        </div>

        {/* a mensagem */}
        <div className="pg-dp-card" data-teste="dp-mensagem">
          <h3>A mensagem</h3>
          <p className="pg-dp-sub">Escreva ou peça para a IA. O que está entre chaves muda para cada pessoa.</p>
          <label className="pg-dp-campo">Nome do disparo <small>(só para você achar depois)</small><input className="plat-input" value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} /></label>
          <div className="pg-dp-ia">
            <input className="plat-input" value={pedidoIa} maxLength={600} onChange={(e) => setPedidoIa(e.target.value)} aria-label="O que a IA deve escrever" placeholder="Ex.: convite carinhoso e curto para seguir o Instagram" />
            <button type="button" className="btn btn-primary" disabled={ia === 'indo' || !pedidoIa.trim()} onClick={escrever} data-teste="dp-ia">{ia === 'indo' ? <LoaderCircle size={15} className="pg-gira" /> : <Sparkles size={15} />} {texto ? 'Reescrever com a IA' : 'Escrever com a IA'}</button>
          </div>
          {ia && ia !== 'indo' && <p className="pg-dp-erro"><TriangleAlert size={13} /> {ia}</p>}

          <div className="pg-dp-link">
            <h4><Link2 size={15} /> O link</h4>
            <div className="pg-dp-link-lin">
              <label>Leva para</label>
              <select className="plat-select" value={destinoTipo} onChange={(e) => { const v = e.target.value; setDestinoTipo(v); if (v === 'instagram') setPrevia(PADRAO_INSTA) }}>
                <option value="instagram">{insta?.handle ? `Instagram da MIMO (@${insta.handle})` : 'Instagram da MIMO (sem @ configurado)'}</option>
                <option value="outro">Outro endereço</option>
                <option value="nenhum">Sem link</option>
              </select>
              {destinoTipo === 'outro' && <><label>Endereço</label><input className="plat-input" value={destinoOutro} onChange={(e) => setDestinoOutro(e.target.value)} placeholder="https://…" inputMode="url" /></>}
              {destinoTipo !== 'nenhum' && <>
                <label>Prévia</label>
                <div className="pg-dp-previa-link">
                  <label className="pg-dp-img">
                    {imagemPrevia ? <img src={imagemPrevia} alt="" /> : <span>sem imagem</span>}
                    <input type="file" accept="image/*" onChange={(e) => trocarImagem(e.target.files?.[0])} hidden />
                    <small>{subindo ? <><LoaderCircle size={12} className="pg-gira" /> subindo…</> : <><ImageUp size={12} /> trocar imagem</>}</small>
                  </label>
                  <div>
                    <input className="plat-input" value={previa.titulo ?? ''} maxLength={120} onChange={(e) => setPrevia({ ...previa, titulo: e.target.value })} aria-label="Título da prévia" />
                    <textarea className="plat-input" rows={2} value={previa.texto ?? ''} maxLength={300} onChange={(e) => setPrevia({ ...previa, texto: e.target.value })} aria-label="Texto da prévia" />
                  </div>
                </div>
              </>}
            </div>
            {destinoTipo !== 'nenhum' && <p className="pg-dp-nota">Cada pessoa recebe um link curto só dela (mimo.com.vc/c/…): é assim que dá para saber quem clicou. Quem abre passa pelo nosso site e vai para o destino.</p>}
          </div>

          <textarea ref={caixa} className="plat-input pg-dp-texto" rows={8} value={texto} maxLength={MAX_MENSAGEM} onChange={(e) => setTexto(e.target.value)} placeholder="Oi, {nome}! Aqui é a Mel, da MIMO 💗 …" data-teste="dp-texto" />
          <div className="pg-dp-vars">Pôr no texto: {VARIAVEIS.map((v) => <button key={v} type="button" onClick={() => porVariavel(v)}>{v}</button>)}<span>{texto.length} caracteres</span></div>

          <div className="pg-dp-whats" data-teste="dp-previa">
            <div className="pg-dp-whats-topo">
              <button type="button" onClick={() => setVez((v) => Math.max(0, v - 1))} disabled={vez <= 0} aria-label="Anterior"><ChevronLeft size={15} /></button>
              <span>Como chega para <b>{nomeDaPessoa(pessoaPrevia) ?? pessoaPrevia.nome_whats ?? 'sem nome'}</b>{pessoaPrevia.cidade ? ` · ${pessoaPrevia.cidade}` : ''}{amostra.length ? ` · ${Math.min(vez, amostra.length - 1) + 1} de ${amostra.length}` : ' · exemplo'}</span>
              <button type="button" onClick={() => setVez((v) => Math.min(amostra.length - 1, v + 1))} disabled={vez >= amostra.length - 1} aria-label="Próxima"><ChevronRight size={15} /></button>
            </div>
            <div className="pg-dp-bolha">
              {destino && (previa.titulo || imagemPrevia) && (
                <div className="pg-dp-cartao">{imagemPrevia && <img src={imagemPrevia} alt="" />}<div><b>{previa.titulo}</b><span>{previa.texto}</span><em>mimo.com.vc</em></div></div>
              )}
              {textoPrevia ? <p>{textoPrevia}</p> : <p className="vazio">A mensagem aparece aqui.</p>}
            </div>
          </div>
          <p className="pg-dp-nota">Sem nome, vira "Oi!"; sem cidade, "sua cidade"; sem salão, "o salão".</p>
          <div className="pg-dp-teste">
            <input className="plat-input" value={telTeste} onChange={(e) => setTelTeste(e.target.value)} placeholder="(13) 9____-____ (o seu)" inputMode="tel" aria-label="Seu número para o teste" />
            <button type="button" className="btn btn-ghost" disabled={teste?.indo || !telTeste.trim() || texto.trim().length < 5} onClick={mandarTeste} data-teste="dp-teste">{teste?.indo ? <LoaderCircle size={15} className="pg-gira" /> : <Send size={15} />} Mandar um teste</button>
          </div>
          {teste?.ok && <p className="pg-dp-ok"><Check size={13} /> Teste enviado: confira no seu WhatsApp (a prévia do link pode levar alguns segundos).</p>}
          {teste?.erro && <p className="pg-dp-erro"><TriangleAlert size={13} /> {teste.erro}</p>}
        </div>
      </div>

      <div className="pg-dp-barra" data-teste="dp-barra">
        <span className="pg-dp-quantas">{marcadasLista.length} {marcadasLista.length === 1 ? 'marcada' : 'marcadas'}</span>
        <span className="pg-dp-ritmo">{ativos.length ? `${ativos.length > 1 && alternar ? `por ${ativos.length} números, alternando` : `pelo ${estado.numeros.find((n) => n.instancia === ativos[0])?.rotulo ?? 'número'}`} · cada número manda 1 a cada ${RITMOS.find(([s]) => s === ritmo)?.[1] ?? ritmo + ' s'} (varia)${marcadasLista.length ? ` · termina em uns ${minutos(duracao)}` : ''} · deixe esta aba aberta` : 'marque por qual número sai'}</span>
        <span className="pg-dp-dir">
          <select className="plat-select" value={ritmo} onChange={(e) => setRitmo(Number(e.target.value))} aria-label="Ritmo por número">{RITMOS.map(([s, r]) => <option key={s} value={s}>Ritmo por número: {r}</option>)}</select>
          {confirmar
            ? <><button type="button" className="plat-link" onClick={() => setConfirmar(false)}>Cancelar</button><button type="button" className="btn btn-primary" disabled={indo} onClick={disparar} data-teste="dp-confirmar">{indo ? <LoaderCircle size={15} className="pg-gira" /> : <Megaphone size={15} />} Confirmar: disparar para {marcadasLista.length}</button></>
            : <button type="button" className="btn btn-primary" disabled={!prontoParaDisparar} title={motivoNao} onClick={() => setConfirmar(true)} data-teste="dp-disparar"><Megaphone size={15} /> Disparar para {marcadasLista.length}</button>}
        </span>
      </div>
      {erro && <p className="pg-dp-erro"><TriangleAlert size={13} /> {erro}</p>}
    </>
  )
}

// ---- acompanhar (e enviar, enquanto a aba está aberta) ---------------------------------------------------------------
const FILTROS_ENVIO = [['todas', 'Todas'], ['clicaram', 'Clicaram'], ['viram', 'Viram e não clicaram'], ['nao_viram', 'Não viram'], ['responderam', 'Responderam'], ['falharam', 'Não saíram']]
const filtrarEnvio = (f, e) => f === 'todas' || (f === 'clicaram' && e.clicou_em) || (f === 'viram' && e.lida_em && !e.clicou_em) || (f === 'nao_viram' && e.status === 'enviado' && !e.lida_em)
  || (f === 'responderam' && e.respondeu_em) || (f === 'falharam' && e.status === 'falhou')

function Acompanhar({ id, numeros, onVoltar }) {
  const [d, setD] = useState(null)
  const [erro, setErro] = useState('')
  const [proxima, setProxima] = useState(null) // segundos até a próxima
  const [filtro, setFiltro] = useState('todas')
  const [verTexto, setVerTexto] = useState(false)
  const [mostrar, setMostrar] = useState(POR_PAGINA)
  const [trocando, setTrocando] = useState(null) // os números escolhidos para continuar
  const rodando = useRef(false)
  const vivo = useRef(true)
  const rotulo = (i) => numeros.find((n) => n.instancia === i)?.rotulo ?? i

  const carregar = useCallback(async () => {
    try { const r = await rpcDisparo('disparo_detalhe', { id_: id }); if (vivo.current) setD(r) } catch (e) { if (vivo.current) setErro(e.message) }
  }, [id])
  useEffect(() => { vivo.current = true; carregar(); return () => { vivo.current = false } }, [carregar])

  const status = d?.disparo?.status
  // o laço do envio: uma de cada vez, só com a aba aberta e o disparo "enviando"
  useEffect(() => {
    if (status !== 'enviando' || rodando.current) return
    rodando.current = true
    let cancelado = false
    const esperar = (s) => new Promise((ok) => {
      let falta = s
      setProxima(falta)
      const t = setInterval(() => { falta -= 1; if (cancelado || !vivo.current) { clearInterval(t); ok(); return } setProxima(Math.max(0, falta)); if (falta <= 0) { clearInterval(t); ok() } }, 1000)
    })
    ;(async () => {
      while (!cancelado && vivo.current) {
        let r
        try { r = await disparo('enviar', { disparo: id }) } catch (e) { setErro(e.message); await esperar(20); continue }
        if (r.fim || r.parado) { await carregar(); break }
        if (r.pausado) { setErro(`Pausado: ${r.erro}. Troque ou reconecte o número e continue.`); await carregar(); break }
        await carregar()
        if (r.espera_s) { await esperar(r.espera_s + 1); continue }
        const ativos = (d?.disparo?.alternar ? d?.disparo?.numeros?.length : 1) || 1
        await esperar(proximaEspera(d?.disparo?.ritmo_s ?? 40, ativos))
      }
      setProxima(null)
      rodando.current = false
    })()
    return () => { cancelado = true; rodando.current = false }
  }, [status, id, carregar, d?.disparo?.alternar, d?.disparo?.numeros?.length, d?.disparo?.ritmo_s])

  if (erro && !d) return <p className="pg-dp-erro"><TriangleAlert size={13} /> {erro}</p>
  if (!d) return <p className="pg-nota"><LoaderCircle size={14} className="pg-gira" /> Carregando o disparo…</p>
  const dp = d.disparo
  const envios = d.envios ?? []
  const c = contasDoDisparo(envios)
  const feitas = c.enviados + c.falhas
  const lista = envios.filter((e) => filtrarEnvio(filtro, e))

  async function pausar(p) {
    setErro('')
    try { await rpcDisparo('disparo_pausar', { id_: id, pausar_: p }); await carregar() } catch (e) { setErro(e.message) }
  }
  async function continuarCom() {
    try { await rpcDisparo('disparo_salvar', { d: { id, numeros: trocando } }); setTrocando(null); await pausar(false) } catch (e) { setErro(e.message) }
  }

  return (
    <div className="pg-dp-card" data-teste="dp-acompanhar">
      <button type="button" className="plat-link pg-dp-voltar" onClick={onVoltar}><ArrowLeft size={14} /> Novo disparo</button>
      <h3>{dp.nome} · {quandoFoi(dp.iniciado_em || dp.criado_em)} <span className="pg-dp-conta">{status === 'concluido' ? 'terminou' : status === 'pausado' ? 'pausado' : `enviando ${feitas} de ${c.total}`}</span></h3>
      <p className="pg-dp-sub">{dp.alternar && dp.numeros.length > 1 ? `por ${dp.numeros.map(rotulo).join(' e ')}, alternando` : `pelo ${rotulo(dp.numeros[0])}`} · {dp.destino ? `link: ${/instagram\.com/.test(dp.destino) ? 'Instagram da MIMO' : dp.destino}` : 'sem link'} · <button type="button" className="plat-link" onClick={() => setVerTexto(!verTexto)}>{verTexto ? 'esconder a mensagem' : 'ver a mensagem'}</button></p>
      {verTexto && <pre className="pg-dp-msg">{dp.mensagem}</pre>}

      {status !== 'concluido' && (
        <div className="pg-dp-anda">
          <div><b>{status === 'pausado' ? `Pausado: ${feitas} de ${c.total}` : `Enviando: ${feitas} de ${c.total}`}</b><br /><small>{status === 'pausado' ? (dp.motivo_pausa ? `motivo: ${dp.motivo_pausa}` : 'continue quando quiser') : proxima != null ? `próxima em ${proxima} s · deixe esta aba aberta` : 'mandando…'}</small></div>
          <div className="pg-dp-trilho"><i style={{ width: `${pct(feitas, c.total)}%` }} /></div>
          {status === 'pausado'
            ? <span className="pg-dp-anda-acoes">
              <button type="button" className="btn btn-ghost" onClick={() => setTrocando(trocando ? null : dp.numeros.filter((i) => numeros.some((n) => n.instancia === i && n.estado === 'open')))}><RefreshCw size={14} /> Trocar números</button>
              <button type="button" className="btn btn-primary" onClick={() => pausar(false)} data-teste="dp-continuar"><Play size={14} /> Continuar</button>
            </span>
            : <button type="button" className="btn btn-ghost" onClick={() => pausar(true)} data-teste="dp-pausar"><Pause size={14} /> Pausar</button>}
        </div>
      )}
      {trocando && (
        <div className="pg-dp-trocar">
          {numeros.map((n) => <label key={n.instancia}><input type="checkbox" disabled={n.estado !== 'open'} checked={trocando.includes(n.instancia)} onChange={() => setTrocando((t) => (t.includes(n.instancia) ? t.filter((x) => x !== n.instancia) : [...t, n.instancia]))} /> {n.rotulo} <Pilula par={ESTADO_NUMERO[n.estado] ?? ESTADO_NUMERO.desconhecido} /></label>)}
          <button type="button" className="btn btn-primary" disabled={!trocando.length} onClick={continuarCom}><Play size={14} /> Continuar com estes</button>
        </div>
      )}
      {erro && <p className="pg-dp-erro"><TriangleAlert size={13} /> {erro}</p>}

      <div className="pg-dp-kpis">
        <div className="pg-dp-kpi"><b>{c.entregues}</b><span>entregues</span><small>de {c.enviados} enviadas{c.falhas ? ` · ${c.falhas} não ${c.falhas === 1 ? 'saiu' : 'saíram'}` : ''}</small></div>
        <div className="pg-dp-kpi azul"><Eye size={15} /><b>{c.lidas}</b><span>viram</span><small>{pct(c.lidas, c.entregues)}% · só conta quem deixa a confirmação de leitura ligada</small></div>
        <div className="pg-dp-kpi rosa"><MousePointerClick size={15} /><b>{c.clicaram}</b><span>clicaram no link</span><small>{pct(c.clicaram, c.entregues)}% das entregues</small></div>
        <div className="pg-dp-kpi verde"><MessageCircle size={15} /><b>{c.responderam}</b><span>responderam</span><small>a resposta chega no número que mandou</small></div>
        <div className="pg-dp-kpi roxo"><Users size={15} /><b>{Object.values(c.porNumero).join(' · ') || 0}</b><span>{Object.keys(c.porNumero).map(rotulo).join(' · ') || 'por número'}</span><small>quantas saíram por cada um</small></div>
      </div>

      <div className="pg-dp-filtros">{FILTROS_ENVIO.map(([f, r]) => <button key={f} type="button" className={'plat-chip' + (filtro === f ? ' ativo' : '')} aria-pressed={filtro === f} onClick={() => { setFiltro(f); setMostrar(POR_PAGINA) }}>{r}{f !== 'todas' ? ` · ${envios.filter((e) => filtrarEnvio(f, e)).length}` : ''}</button>)}</div>
      {!lista.length ? <Vazio>Ninguém nesse filtro.</Vazio> : (
        <table className="pg-dp-tabela" data-teste="dp-envios">
          <thead><tr><th>Pessoa</th><th>Cidade e salão</th><th>O que aconteceu</th><th>Saiu</th></tr></thead>
          <tbody>
            {lista.slice(0, mostrar).map((e) => (
              <tr key={e.id}>
                <td className="pg-dp-pessoa"><b className={e.nome ? '' : 'sem'}>{e.nome || 'sem nome'}</b><small>{e.telefone ? tel(e.telefone) : 'apagado (prazo da privacidade)'}</small></td>
                <td className="pg-dp-onde">{e.cidade || '—'}<small>{e.salao || ''}</small></td>
                <td><span className="pg-dp-marcas">{marcasDoEnvio(e).map((m) => <span key={m.tipo} className={'pg-dp-m ' + m.tipo}>{m.tipo === 'erro' ? <X size={11} /> : m.tipo === 'viu' ? <Eye size={11} /> : m.tipo === 'cli' ? <MousePointerClick size={11} /> : m.tipo === 'resp' ? <MessageCircle size={11} /> : m.tipo === 'ent' ? <Check size={11} /> : null}{m.texto}</span>)}</span></td>
                <td className="pg-dp-quando">{e.instancia && e.status !== 'fila' ? `pelo ${rotulo(e.instancia)}` : ''}<br />{e.enviado_em && e.status !== 'fila' ? quandoFoi(e.enviado_em) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {lista.length > mostrar && <p className="pg-dp-mais">Mostrando {mostrar} de {lista.length} · <button type="button" className="plat-link" onClick={() => setMostrar((m) => m + POR_PAGINA * 4)}>ver mais</button></p>}
    </div>
  )
}

// ---- os anteriores -------------------------------------------------------------------------------------------------
function Anteriores({ disparos, numeros, onAbrir }) {
  const lista = disparos.filter((d) => d.status !== 'rascunho' && d.total > 0)
  if (!lista.length) return null
  const rotulo = (i) => numeros.find((n) => n.instancia === i)?.rotulo ?? i
  return (
    <div className="pg-dp-card" data-teste="dp-anteriores">
      <h3>Disparos</h3>
      <table className="pg-dp-tabela pg-dp-hist">
        <thead><tr><th>Disparo</th><th>Números</th><th>Enviadas</th><th>Viram</th><th>Clicaram</th><th>Responderam</th><th /></tr></thead>
        <tbody>
          {lista.map((d) => (
            <tr key={d.id} onClick={() => onAbrir(d.id)}>
              <td><b>{d.nome}</b><small>{quandoFoi(d.iniciado_em || d.criado_em)}{d.status !== 'concluido' ? ` · ${d.status === 'pausado' ? 'pausado' : 'saindo'}` : ''}</small></td>
              <td>{d.numeros.map(rotulo).join(' + ')}</td>
              <td>{d.enviados} de {d.total}</td>
              <td>{d.lidas} ({pct(d.lidas, d.entregues)}%)</td>
              <td>{d.clicaram} ({pct(d.clicaram, d.entregues)}%)</td>
              <td>{d.responderam}</td>
              <td><button type="button" className="plat-link">Abrir</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
