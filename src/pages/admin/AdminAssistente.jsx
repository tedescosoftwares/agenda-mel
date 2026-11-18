import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Bot, Unplug, Smartphone, PartyPopper, ShieldCheck, MessageCircle, Check, Clock, Info, CalendarCheck, CalendarClock, CalendarX, HandHelping, Sparkles, MessagesSquare } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import ProShell from '../../components/ProShell'
import { useAuth } from '../../context/AuthContext'
import RegraDeAceite from '../../components/RegraDeAceite'
import { Bolhas, ConectarWhatsapp, ConversaDeTeste } from '../../components/AssistenteWhatsapp'
import { useDialogo } from '../../context/DialogoContext'
import { supabase } from '../../lib/supabase'
import { chamar } from '../../lib/pagamento'
import { PADRAO, SUGESTOES_DE_NOME, TONS, EMOJIS, TRATAMENTOS, TAMANHOS, PRECOS, ESPERAS, configDe, primeiroNome, previa } from '../../lib/assistente'
import '../../assistente.css'

// 3.95: a assistente do WhatsApp do salão (migração 235; Edge Function assistente).
// 3.95.1 (migração 236): a assistente atende no WhatsApp DO SALÃO. O primeiro passo é conectar esse número (código de
// pareamento); sem ele, ela não liga. O número da MIMO é só reserva de envio (o aviso sai por ele quando o do salão
// não consegue mandar). A dona escolhe o jeito dela (nome, tom, emojis, como chama a cliente, tamanho), o que pode
// fazer sozinha, como fala de preço e quando responde. A prévia muda na hora; o "Testar de verdade" chama a
// assistente com a agenda real, sem marcar nada (funciona antes de conectar). ?inicio=1: veio do fim da configuração.

// 3.96.1: as peças de layout da tela (um padrão só): o bloco com cabeçalho, o campo (rótulo à esquerda e controle à
// direita no computador, empilhados no celular) e o seletor de largura fixa (não quebra a linha como os botões soltos)
function Secao({ Icone, titulo, sub, children, className = '', ordem, secaoRef }) {
  return (
    <section ref={secaoRef} className={'card asx-secao ' + className} style={ordem != null ? { order: ordem } : undefined}>
      <header className="asx-cab">
        {Icone && <span className="asx-ico"><Icone size={18} /></span>}
        <div className="asx-cab-txt"><h3>{titulo}</h3>{sub && <p>{sub}</p>}</div>
      </header>
      {children}
    </section>
  )
}

function Campo({ rotulo, dica, children }) {
  return (
    <div className="asx-campo">
      <div className="asx-campo-rot"><strong>{rotulo}</strong>{dica && <small>{dica}</small>}</div>
      <div className="asx-campo-ctl">{children}</div>
    </div>
  )
}

function Segmentos({ lista, valor, onEscolher, rotulo }) {
  return (
    <div className="asx-seg" role="radiogroup" aria-label={rotulo} style={{ '--n': lista.length }}>
      {lista.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={valor === o.id} className={valor === o.id ? 'ativa' : ''} onClick={() => onEscolher(o.id)}>{o.rotulo}</button>
      ))}
    </div>
  )
}

function Chave({ ligado, onMudar, rotulo, texto, desligado }) {
  return (
    <label className={'as-chave' + (desligado ? ' trancada' : '')}>
      <span className="as-chave-texto"><strong>{rotulo}</strong>{texto && <small>{texto}</small>}</span>
      <span className="switch"><input type="checkbox" checked={ligado} disabled={desligado} onChange={(e) => onMudar(e.target.checked)} /><span /></span>
    </label>
  )
}

// depois de conectar pelo "sim" das boas-vindas, a assistente já liga (devolve o estado novo, ou null)
async function ligarSePediu(salao, querLigar, d) {
  if (!querLigar.current || d?.ligada) return null
  querLigar.current = false
  const { data, error } = await supabase.rpc('assistente_salvar', { salao, dados: { ligada: true } })
  return error ? null : data
}

// embutido (3.96): dentro da área WhatsApp do salão (aba Assistente), sem casca nem título; os atalhos trocam de aba
export default function AdminAssistente({ para = 'admin', embutido = false, onAbrirPedidos, onAbrirMensagens }) {
  const { salao, negocio, profile } = useAuth()
  const { confirmar } = useDialogo()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const base = para === 'admin' ? (salao ?? negocio) : (negocio ?? salao)
  const salaoId = base?.id
  const autonoma = base?.tipo === 'autonoma'
  const Shell = para === 'admin' ? AdminShell : ProShell

  const [dados, setDados] = useState(null)
  const [cfg, setCfg] = useState(PADRAO)
  const [recado, setRecado] = useState('')
  const [salvo, setSalvo] = useState(null)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [ok, setOk] = useState('')
  const [numeros, setNumeros] = useState(null)
  const [inicio, setInicio] = useState(params.get('inicio') === '1')
  const querLigar = useRef(false)    // veio do "sim" das boas-vindas: ao conectar, já liga
  const refNumero = useRef(null)

  // o número do salão (3.97: o código e a espera ficam em ConectarWhatsapp)
  const [conferido, setConferido] = useState(null)    // estado da Evolution, quando o salão já tem número próprio

  // o que veio do banco vira a tela inteira (ao abrir e ao salvar); conectar, desconectar e ligar só trocam o canal
  // (setDados), para não perder o que a dona mudou e ainda não salvou
  function aplicar(d) {
    setDados(d)
    const c = configDe(d?.config)
    setCfg(c)
    setRecado(d?.recado ?? '')
    setSalvo(JSON.stringify({ c, r: d?.recado ?? '' }))
  }

  useEffect(() => {
    if (!salaoId) return
    let vivo = true
    ;(async () => {
      const { data, error } = await supabase.rpc('assistente_do_salao', { salao: salaoId })
      if (!vivo) return
      if (error) { setErro(/function|does not exist|schema cache/i.test(error.message) ? 'A assistente ainda não está no banco (falta a atualização 235).' : error.message); return }
      aplicar(data)
      const n = await supabase.rpc('assistente_numeros', { salao: salaoId, dias: 30 })
      if (vivo && !n.error) setNumeros(n.data)
      if (data?.canal?.numero_proprio) {
        try { const e = await chamar('assistente', { acao: 'estado', salao: salaoId }); if (vivo) setConferido(e?.estado ?? null) } catch { /* fica sem conferir */ }
      }
    })()
    return () => { vivo = false }
  }, [salaoId])

  const sujo = salvo != null && JSON.stringify({ c: cfg, r: recado }) !== salvo
  const proprio = Boolean(dados?.canal?.numero_proprio)
  const ligada = Boolean(dados?.ligada)
  const ativa = ligada && proprio
  const desconectou = proprio && conferido && conferido !== 'open'
  const nomeSalao = dados?.salao ?? base?.name ?? 'seu salão'
  const mudar = (k, v) => setCfg((c) => ({ ...c, [k]: v }))
  const conversaPrevia = useMemo(() => previa(cfg, { salao: nomeSalao, proprio: true, autonoma, cliente: 'Ana' }), [cfg, nomeSalao, autonoma])
  const nomeEscolhido = cfg.nome?.trim() || 'Mel'
  const rascunho = useMemo(() => {
    const { quando: _q, espera_min: _e, ...jeito } = cfg
    return { assistente: jeito, recado, cliente_nome: primeiroNome(profile?.full_name) }
  }, [cfg, recado, profile?.full_name])

  // o celular conectou (pelo código ou porque o número já estava conectado); se veio do "sim" das boas-vindas, já liga
  async function aoConectar(data, { jaEstava }) {
    const ligou = await ligarSePediu(salaoId, querLigar, data)
    setDados(ligou ?? data); setConferido('open')
    setOk(jaEstava
      ? (ligou ? 'Esse número já estava conectado. Assistente ligada!' : 'Esse número já estava conectado. Tudo certo!')
      : (ligou ? 'WhatsApp conectado e assistente ligada! Ela já responde as clientes por ele.' : 'WhatsApp do salão conectado! Agora é só ligar a assistente.'))
  }

  async function salvar(extra = {}) {
    setSalvando(true); setErro(''); setOk('')
    const { data, error } = await supabase.rpc('assistente_salvar', { salao: salaoId, dados: { ...cfg, saudacao: cfg.saudacao ?? '', recado, ...extra } })
    setSalvando(false)
    if (error) { setErro(error.message); return false }
    aplicar(data)
    return true
  }
  async function ligarDesligar(v) {
    setSalvando(true); setErro('')
    const { data, error } = await supabase.rpc('assistente_salvar', { salao: salaoId, dados: { ligada: v } })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setDados(data)
    setOk(v ? 'Assistente ligada. Ela já responde as mensagens que chegarem.' : 'Assistente desligada: nenhuma resposta automática. As mensagens ficam para a equipe.')
  }

  async function desconectar() {
    const sim = await confirmar({ titulo: 'Desconectar o WhatsApp do salão?', texto: 'A assistente para de atender e os lembretes deixam de sair pelo WhatsApp (os avisos continuam no app). O WhatsApp do seu celular continua funcionando normalmente.', ok: 'Desconectar', cancelar: 'Cancelar' })
    if (!sim) return
    setErro(''); setOk('')
    try {
      await chamar('assistente', { acao: 'desconectar', salao: salaoId })
      const { data } = await supabase.rpc('assistente_do_salao', { salao: salaoId })
      setDados(data); setConferido(null); setOk('Desconectado. A assistente parou de atender.')
    } catch (e) { setErro(e.message) }
  }

  // a profissional da equipe não tem negócio próprio: a assistente é do salão (a dona configura)
  if (!salaoId) {
    const aviso = <p className="muted">{para === 'pro' ? 'A assistente do WhatsApp é configurada por quem administra o salão.' : 'Carregando…'}</p>
    return embutido ? aviso : <Shell>{aviso}</Shell>
  }

  const voltar = para === 'admin' ? '/admin' : '/pro/agenda'
  const horario = dados?.horario

  const precisaConectar = !proprio || desconectou
  const desde = dados?.canal?.conectado_em ? new Date(dados.canal.conectado_em).toLocaleDateString('pt-BR') : null

  // o WhatsApp do salão a conectar (sem ele, ela não liga) ou a reconectar (o celular desconectou)
  const secaoNumero = dados && precisaConectar && (
    <Secao ordem={1} secaoRef={refNumero} className="asx-destaque" Icone={Smartphone}
      titulo={desconectou ? 'Reconecte o WhatsApp do salão' : 'Primeiro passo: conecte o WhatsApp do salão'}
      sub={desconectou ? `${dados.canal?.numero ?? 'O número'} desconectou. Gere um código novo e digite no celular.` : 'A assistente atende no WhatsApp do seu salão. Você continua vendo e respondendo tudo pelo celular.'}>
      <ConectarWhatsapp salaoId={salaoId} onConectou={aoConectar} onComecou={() => { setErro(''); setOk('') }} />
    </Secao>
  )

  const kpis = numeros && [
    ['conversas', MessageCircle, numeros.conversas],
    ['marcados', CalendarCheck, numeros.marcou],
    ['remarcados', CalendarClock, numeros.remarcou],
    ['cancelados', CalendarX, numeros.cancelou],
    ['chamou a equipe', HandHelping, numeros.chamou],
    ['encerradas', ShieldCheck, numeros.encerrou],
  ]
  const textoAceite = dados?.aceite?.modo === 'automatico'
    ? 'O horário que ela marca entra confirmado na hora, e ela diz isso à cliente.'
    : dados?.aceite?.modo === 'casa'
      ? `O horário que ela marca vira um pedido: a casa confirma em até ${dados.aceite.minutos < 60 ? `${dados.aceite.minutos} min` : `${dados.aceite.minutos / 60} h`}. Ela diz à cliente que o pedido foi anotado.`
      : 'Vale o que cada profissional configurou. Quando falta confirmar, ela diz à cliente que o pedido foi anotado.'

  const corpo = (
    <>
      {inicio && dados && !ativa && (
        <section className="card as-boas-vindas">
          <span className="as-boas-icone"><PartyPopper size={22} /></span>
          <div className="as-boas-texto">
            <h3>Agenda configurada! Quer atender pelo WhatsApp também?</h3>
            <ol className="as-como">
              <li><MessageCircle size={16} /><span><b>A cliente escreve</b> no WhatsApp perguntando de horário, preço ou serviço.</span></li>
              <li><Sparkles size={16} /><span><b>A assistente responde em segundos</b>, olhando a sua agenda de verdade.</span></li>
              <li><CalendarCheck size={16} /><span><b>Marca com o sim da cliente</b> e chama você quando precisar de gente.</span></li>
            </ol>
            <p className="as-texto">Para começar, é só conectar o WhatsApp do salão. Leva um minuto.</p>
            <div className="as-boas-botoes">
              <button type="button" className="btn btn-primary" onClick={() => {
                setInicio(false)
                if (proprio) { if (!ligada) ligarDesligar(true); return }
                querLigar.current = true
                setTimeout(() => { refNumero.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); refNumero.current?.querySelector('input')?.focus() }, 50)
              }}><Check size={16} /> {proprio ? 'Sim, quero ligar' : 'Sim, conectar o WhatsApp'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => navigate(voltar)}>Agora não</button>
            </div>
            <small className="muted">Dá para mudar tudo depois, aqui no WhatsApp.</small>
          </div>
        </section>
      )}

      {erro && <div className="alert alert-error">{erro}</div>}
      {ok && <div className="alert alert-success as-ok" role="status"><Check size={16} /> {ok}</div>}

      {!dados ? (!erro && <p className="muted">Carregando…</p>) : (
        <div className="as-grade">
          <div className="as-principal">
            {secaoNumero}

            {/* ligada / desligada, e o número quando está tudo certo */}
            <section className={'card asx-status' + (ativa ? ' ligada' : '')} style={{ order: 2 }}>
              <div className="asx-status-linha">
                <span className="asx-status-ico"><Bot size={22} /></span>
                <div className="asx-status-txt">
                  <strong>{ativa ? `${nomeEscolhido} está atendendo` : 'Assistente desligada'}</strong>
                  <span>
                    {!proprio
                      ? 'Conecte o WhatsApp do salão para ligar.'
                      : ativa
                        ? 'Ela responde as clientes sozinha, com a sua agenda.'
                        : 'Nada é respondido sozinho: as mensagens ficam para a equipe. Só valem o 1 ou 2 do lembrete e o SAIR.'}
                  </span>
                  {ativa && dados.agente_global === false && <span className="as-aviso"><Info size={14} /> As respostas automáticas estão pausadas pela MIMO neste momento.</span>}
                </div>
                <label className={'switch as-status-chave' + (!proprio ? ' trancada' : '')}>
                  <input type="checkbox" aria-label="Ligar a assistente" checked={ativa} disabled={salvando || !proprio} onChange={(e) => ligarDesligar(e.target.checked)} />
                  <span />
                </label>
              </div>
              {proprio && !desconectou && (
                <div className="asx-numero-linha">
                  <span className="as-ponto" />
                  <span className="asx-numero-txt"><strong>{dados.canal?.numero ?? 'WhatsApp do salão'}</strong> <span>conectado{desde ? ` desde ${desde}` : ''}</span></span>
                  <button type="button" className="as-link-botao asx-desconectar" onClick={desconectar}><Unplug size={14} /> Desconectar</button>
                </div>
              )}
            </section>

            {kpis && (
              <section className="card asx-kpis-card" style={{ order: 4 }}>
                <div className="asx-kpis-topo">
                  <h3>Últimos {numeros.dias ?? 30} dias</h3>
                  {onAbrirMensagens && <button type="button" className="as-link-botao" onClick={onAbrirMensagens}>Ver mensagens</button>}
                </div>
                <div className="asx-kpis">
                  {kpis.map(([rot, Icone, n]) => <div key={rot}><Icone size={15} /><strong>{n ?? 0}</strong><small>{rot}</small></div>)}
                </div>
              </section>
            )}

            <Secao ordem={5} Icone={Sparkles} titulo="O jeito dela" sub="Como ela se apresenta e conversa com as suas clientes.">
              <Campo rotulo="Nome" dica="Se deixar em branco, ela é a Mel.">
                <input className="asx-input" maxLength={30} placeholder="Mel" value={cfg.nome} onChange={(e) => mudar('nome', e.target.value)} aria-label="Nome da assistente" />
                <div className="asx-chips">
                  {SUGESTOES_DE_NOME.map((n) => <button key={n} type="button" className={'asx-chip' + (nomeEscolhido === n ? ' ativa' : '')} onClick={() => mudar('nome', n)}>{n}</button>)}
                </div>
              </Campo>
              <Campo rotulo="Tom">
                <div className="as-tons" role="radiogroup" aria-label="Tom">
                  {TONS.map((t) => (
                    <button key={t.id} type="button" role="radio" aria-checked={cfg.tom === t.id} className={'as-tom' + (cfg.tom === t.id ? ' ativa' : '')} onClick={() => mudar('tom', t.id)}>
                      <span className="as-radio" /><span><strong>{t.rotulo}</strong><small>{t.texto}</small></span>
                    </button>
                  ))}
                </div>
              </Campo>
              <Campo rotulo="Emojis"><Segmentos rotulo="Emojis" lista={EMOJIS} valor={cfg.emojis} onEscolher={(v) => mudar('emojis', v)} /></Campo>
              <Campo rotulo="Como chama a cliente"><Segmentos rotulo="Como chama a cliente" lista={TRATAMENTOS} valor={cfg.tratamento} onEscolher={(v) => mudar('tratamento', v)} /></Campo>
              <Campo rotulo="Respostas"><Segmentos rotulo="Tamanho das respostas" lista={TAMANHOS} valor={cfg.tamanho} onEscolher={(v) => mudar('tamanho', v)} /></Campo>
              <Campo rotulo="Saudação" dica="Opcional. Ela usa na primeira mensagem.">
                <input className="asx-input" maxLength={300} placeholder={`Oi! Aqui é a ${nomeEscolhido}, do ${nomeSalao}. Como posso te ajudar?`} value={cfg.saudacao ?? ''} onChange={(e) => mudar('saudacao', e.target.value)} aria-label="Saudação" />
              </Campo>
            </Secao>

            <Secao ordem={7} Icone={CalendarClock} titulo="O que ela pode fazer sozinha" sub="O que estiver desligado, ela não faz: chama alguém da equipe.">
              <div className="asx-chaves">
                <Chave ligado={cfg.pode_marcar} onMudar={(v) => mudar('pode_marcar', v)} rotulo="Marcar horário" texto="Sempre repete o resumo e espera o sim da cliente." />
                {cfg.pode_marcar && para === 'admin' && dados.aceite?.modo && onAbrirPedidos && (
                  <p className="as-nota asx-nota-dentro">
                    <Info size={15} />
                    <span>{textoAceite} <button type="button" className="as-link-botao" onClick={onAbrirPedidos}>Mudar em Pedidos</button></span>
                  </p>
                )}
                {cfg.pode_marcar && para === 'admin' && dados.aceite?.modo && !onAbrirPedidos && (
                  <div className="as-aceite-bloco">
                    <RegraDeAceite salaoId={salaoId} inicial={dados.aceite} pergunta={null} onMudou={(a) => setDados((d) => ({ ...d, aceite: a }))} />
                  </div>
                )}
                {cfg.pode_marcar && para !== 'admin' && (
                  <p className="as-nota asx-nota-dentro">
                    <Info size={15} />
                    <span>Se você pede para confirmar cada horário, ela avisa a cliente que ainda falta confirmar. <Link to="/pro/pedidos">Mudar em Pedidos</Link>.</span>
                  </p>
                )}
                <Chave ligado={cfg.pode_remarcar} onMudar={(v) => mudar('pode_remarcar', v)} rotulo="Remarcar" texto="Pede a troca; a profissional pode precisar aceitar." />
                <Chave ligado={cfg.pode_cancelar} onMudar={(v) => mudar('pode_cancelar', v)} rotulo="Cancelar" texto="Só horário da própria cliente, com o sim dela." />
              </div>
              <Campo rotulo="Preço" dica="Como ela fala dos valores."><Segmentos rotulo="Preço" lista={PRECOS} valor={cfg.preco} onEscolher={(v) => mudar('preco', v)} /></Campo>
              <p className="as-nota as-encerra">
                <ShieldCheck size={15} />
                <span>Ela só conversa sobre o salão. Fora do assunto, avisa com gentileza; se a pessoa insistir, encerra e fica 6 horas sem responder aquele número. Ofensa, assédio ou golpe: encerra na hora e fica 24 horas em silêncio.</span>
              </p>
            </Secao>

            <Secao ordem={8} Icone={Clock} titulo="Quando ela responde" sub={<>Horário do salão: {horario || 'ainda não definido'}. <Link to={para === 'admin' ? '/admin/horarios' : '/pro/horarios'}>Mudar</Link></>}>
              <div className="as-quando" role="radiogroup" aria-label="Quando ela responde">
                {[
                  { id: 'sempre', t: 'Sempre, na hora', s: 'A cliente nunca fica esperando.' },
                  { id: 'fora_do_horario', t: 'Só fora do horário do salão', s: 'No horário, quem responde é a equipe.' },
                  { id: 'sem_resposta', t: 'Se a equipe não responder', s: 'No horário, espera a equipe; fora dele, responde na hora.' },
                ].map((q) => (
                  <button key={q.id} type="button" role="radio" aria-checked={cfg.quando === q.id} className={'as-quando-op' + (cfg.quando === q.id ? ' ativa' : '')} onClick={() => mudar('quando', q.id)}>
                    <span className="as-radio" /><span><strong>{q.t}</strong><small>{q.s}</small></span>
                  </button>
                ))}
              </div>
              {cfg.quando === 'sem_resposta' && (
                <Campo rotulo="Esperar a equipe por">
                  <Segmentos rotulo="Esperar a equipe por" lista={ESPERAS.map((m) => ({ id: m, rotulo: `${m} min` }))} valor={cfg.espera_min} onEscolher={(v) => mudar('espera_min', v)} />
                </Campo>
              )}
            </Secao>

            <Secao ordem={9} Icone={MessagesSquare} titulo="O que ela precisa saber da casa" sub="Regras, pagamento, estacionamento. Ela usa isto para responder e não inventa o resto.">
              <textarea className="as-recado" rows={4} maxLength={1200} value={recado} onChange={(e) => setRecado(e.target.value)} aria-label="O que ela precisa saber da casa"
                placeholder="Ex.: Atraso de mais de 15 minutos perde o horário. Cancelamento com 24 h de antecedência. Temos estacionamento na rua de trás. Aceitamos Pix e cartão." />
              <small className="asx-contador">{recado.length}/1200</small>
            </Secao>
          </div>

          <aside className="as-lado">
            <section className="card as-previa" style={{ order: 6 }}>
              <div className="as-previa-topo">
                <span className="as-avatar">{nomeEscolhido.slice(0, 1).toUpperCase()}</span>
                <div><strong>{nomeEscolhido}</strong><small>assistente {autonoma ? 'da' : 'do'} {nomeSalao}</small></div>
                <em className="as-selo">prévia</em>
              </div>
              <Bolhas mensagens={conversaPrevia} nome={nomeEscolhido} />
              <small className="asx-dica">Muda na hora, a cada escolha. Para conversar com ela de verdade, use o teste.</small>
            </section>

            <section className="card as-teste" style={{ order: 10 }}>
              <header className="asx-cab">
                <span className="asx-ico"><Bot size={18} /></span>
                <div className="asx-cab-txt"><h3>Testar de verdade</h3><p>Escreva como uma cliente. Ela usa a sua agenda real, mas não marca nada.</p></div>
              </header>
              <ConversaDeTeste salaoId={salaoId} nome={nomeEscolhido} rascunho={rascunho} />
            </section>
          </aside>
        </div>
      )}

      {sujo && (
        <div className="as-salvar" role="region" aria-label="Salvar alterações">
          <span>Alterações não salvas</span>
          <div>
            <button type="button" className="btn btn-ghost" disabled={salvando} onClick={() => { const s = JSON.parse(salvo); setCfg(s.c); setRecado(s.r) }}>Desfazer</button>
            <button type="button" className="btn btn-primary" disabled={salvando} onClick={async () => { if (await salvar()) setOk('Pronto, salvo. A assistente já fala assim.') }}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </div>
      )}
    </>
  )
  if (embutido) return corpo
  return (
    <Shell amplo>
      <div className="page-head">
        <div>
          <h2>Assistente do WhatsApp</h2>
          <p className="muted">Ela responde as suas clientes no WhatsApp com os dados da sua agenda: serviços, preços e horários livres. Marca, remarca e cancela quando você deixar.</p>
        </div>
      </div>
      {corpo}
    </Shell>
  )
}
