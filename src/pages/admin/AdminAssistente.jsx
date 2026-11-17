import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Bot, Send, RotateCcw, QrCode, Unplug, Smartphone, Store, PartyPopper, MessageCircle, Check, Clock, Info, CalendarCheck, CalendarClock, CalendarX, HandHelping, Loader2, Sparkles, MessagesSquare } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import ProShell from '../../components/ProShell'
import { useAuth } from '../../context/AuthContext'
import { useDialogo } from '../../context/DialogoContext'
import { supabase } from '../../lib/supabase'
import { chamar } from '../../lib/pagamento'
import { PADRAO, SUGESTOES_DE_NOME, TONS, EMOJIS, TRATAMENTOS, TAMANHOS, PRECOS, ESPERAS, configDe, codigoBonito, primeiroNome, previa } from '../../lib/assistente'
import '../../assistente.css'

// 3.95: a assistente do WhatsApp do salão (migração 235; Edge Function assistente).
// A dona escolhe o jeito dela (nome, tom, emojis, como chama a cliente, tamanho), o que ela pode fazer sozinha, como
// fala de preço, quando responde e em qual número: o da MIMO (já funciona, ela é a Mel da MIMO) ou o do salão
// (conecta pelo código de pareamento; aí valem o nome e o jeito escolhidos). A prévia muda na hora; o "Testar de
// verdade" chama a assistente com a agenda real, sem marcar nada. ?inicio=1: veio do fim da configuração.

function Opcoes({ lista, valor, onEscolher, rotulo }) {
  return (
    <div className="as-opcoes" role="radiogroup" aria-label={rotulo}>
      {lista.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={valor === o.id} className={'as-opcao' + (valor === o.id ? ' ativa' : '')} onClick={() => onEscolher(o.id)}>
          {o.rotulo}
        </button>
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

function Bolhas({ mensagens, nome, digitando }) {
  return (
    <div className="as-conversa">
      {mensagens.map((m, i) => (
        <div key={i} className={'as-bolha ' + (m.quem === 'cliente' ? 'dela' : 'nossa')}>
          {m.quem !== 'cliente' && i > 0 && mensagens[i - 1]?.quem === 'cliente' && <span className="as-bolha-quem">{nome}</span>}
          {m.texto}
        </div>
      ))}
      {digitando && <div className="as-bolha nossa as-digitando" aria-label="digitando"><i /><i /><i /></div>}
    </div>
  )
}

export default function AdminAssistente({ para = 'admin' }) {
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

  // o número do salão
  const [numero, setNumero] = useState('')
  const [con, setCon] = useState({ fase: 'livre' })   // livre · gerando · codigo · erro
  const [verQr, setVerQr] = useState(false)
  const [conferido, setConferido] = useState(null)    // estado da Evolution, quando o salão já tem número próprio

  // o teste de verdade
  const [teste, setTeste] = useState([])
  const [escrito, setEscrito] = useState('')
  const [testando, setTestando] = useState(false)
  const [erroTeste, setErroTeste] = useState('')
  const fimDoTeste = useRef(null)

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

  // enquanto o código está na tela, pergunta a cada 4 s se o celular já conectou (até 3 min)
  useEffect(() => {
    if (con.fase !== 'codigo') return
    let vivo = true
    const desde = Date.now()
    const t = setInterval(async () => {
      if (Date.now() - desde > 180_000) { clearInterval(t); if (vivo) setCon({ fase: 'erro', erro: 'O código expirou. Gere outro e digite no celular em até 2 minutos.' }); return }
      try {
        const e = await chamar('assistente', { acao: 'estado', salao: salaoId })
        if (vivo && e?.estado === 'open') {
          clearInterval(t)
          const { data } = await supabase.rpc('assistente_do_salao', { salao: salaoId })
          if (!vivo) return
          setDados(data); setConferido('open'); setCon({ fase: 'livre' }); setOk('Número conectado! A partir de agora a assistente atende por ele.')
        }
      } catch { /* tenta de novo no próximo */ }
    }, 4000)
    return () => { vivo = false; clearInterval(t) }
  }, [con.fase, salaoId])

  useEffect(() => { fimDoTeste.current?.scrollIntoView({ block: 'nearest' }) }, [teste, testando])

  const sujo = salvo != null && JSON.stringify({ c: cfg, r: recado }) !== salvo
  const proprio = Boolean(dados?.canal?.numero_proprio)
  const ligada = Boolean(dados?.ligada)
  const nomeSalao = dados?.salao ?? base?.name ?? 'seu salão'
  const mudar = (k, v) => setCfg((c) => ({ ...c, [k]: v }))
  // a prévia mostra sempre o jeito escolhido (o do número do salão); no da casa, um aviso diz que lá ela é a Mel da MIMO
  const conversaPrevia = useMemo(() => previa(cfg, { salao: nomeSalao, proprio: true, autonoma, cliente: 'Ana' }), [cfg, nomeSalao, autonoma])
  const nomeEscolhido = cfg.nome?.trim() || 'Mel'
  const nomeQueAparece = proprio ? nomeEscolhido : 'Mel'

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
    setOk(v ? 'Assistente ligada. Ela já responde as mensagens que chegarem.' : 'Assistente desligada. As mensagens ficam para a equipe.')
  }

  async function gerarCodigo() {
    setErro(''); setOk(''); setCon({ fase: 'gerando' }); setVerQr(false)
    try {
      const r = await chamar('assistente', { acao: 'conectar', salao: salaoId, numero })
      if (r?.estado === 'open') {
        const { data } = await supabase.rpc('assistente_do_salao', { salao: salaoId })
        setDados(data); setConferido('open'); setCon({ fase: 'livre' }); setOk('Esse número já estava conectado. Tudo certo!')
        return
      }
      setCon({ fase: 'codigo', codigo: r?.pairingCode ?? null, qr: r?.qr ?? null, numero: r?.numero ?? numero })
    } catch (e) {
      setCon({ fase: 'erro', erro: e.message || 'Não deu para gerar o código agora.' })
    }
  }
  async function desconectar() {
    const sim = await confirmar({ titulo: 'Desconectar o número do salão?', texto: 'A assistente volta a atender pelo número da MIMO, como a Mel. O WhatsApp do seu celular continua funcionando normalmente.', ok: 'Desconectar', cancelar: 'Cancelar' })
    if (!sim) return
    setErro(''); setOk('')
    try {
      await chamar('assistente', { acao: 'desconectar', salao: salaoId })
      const { data } = await supabase.rpc('assistente_do_salao', { salao: salaoId })
      setDados(data); setConferido(null); setOk('Desconectado. A assistente voltou para o número da MIMO.')
    } catch (e) { setErro(e.message) }
  }

  async function enviarTeste(e) {
    e?.preventDefault()
    const t = escrito.trim()
    if (!t || testando) return
    const conversa = [...teste, { quem: 'cliente', texto: t }]
    setTeste(conversa); setEscrito(''); setTestando(true); setErroTeste('')
    try {
      const { quando: _q, espera_min: _e, ...jeito } = cfg
      const r = await chamar('assistente', { acao: 'testar', salao: salaoId, mensagens: conversa, rascunho: { assistente: jeito, recado, cliente_nome: primeiroNome(profile?.full_name) } })
      setTeste((c) => [...c, { quem: 'assistente', texto: r.resposta, acoes: r.acoes }])
    } catch (er) {
      setErroTeste(er.message || 'Não deu para testar agora.')
    }
    setTestando(false)
  }

  // a profissional da equipe não tem negócio próprio: a assistente é do salão (a dona configura)
  if (!salaoId) return <Shell><p className="muted">{para === 'pro' ? 'A assistente do WhatsApp é configurada por quem administra o salão.' : 'Carregando…'}</p></Shell>

  const voltar = para === 'admin' ? '/admin' : '/pro/agenda'
  const horario = dados?.horario

  return (
    <Shell amplo>
      <div className="page-head">
        <div>
          <h2>Assistente do WhatsApp</h2>
          <p className="muted">Ela responde as suas clientes no WhatsApp com os dados da sua agenda: serviços, preços e horários livres. Marca, remarca e cancela quando você deixar.</p>
        </div>
      </div>

      {inicio && dados && !dados.ligada && (
        <section className="card as-boas-vindas">
          <span className="as-boas-icone"><PartyPopper size={22} /></span>
          <div className="as-boas-texto">
            <h3>Agenda configurada! Quer atender pelo WhatsApp também?</h3>
            <ol className="as-como">
              <li><MessageCircle size={16} /><span><b>A cliente escreve</b> no WhatsApp perguntando de horário, preço ou serviço.</span></li>
              <li><Sparkles size={16} /><span><b>A assistente responde em segundos</b>, olhando a sua agenda de verdade.</span></li>
              <li><CalendarCheck size={16} /><span><b>Marca com o sim da cliente</b> e chama você quando precisar de gente.</span></li>
            </ol>
            <div className="as-boas-botoes">
              <button type="button" className="btn btn-primary" onClick={() => { setInicio(false); if (!ligada) ligarDesligar(true) }}><Check size={16} /> Sim, quero ligar</button>
              <button type="button" className="btn btn-ghost" onClick={() => navigate(voltar)}>Agora não</button>
            </div>
            <small className="muted">Dá para mudar tudo depois em Ajustes › Assistente do WhatsApp.</small>
          </div>
        </section>
      )}

      {erro && <div className="alert alert-error">{erro}</div>}
      {ok && <div className="alert alert-success as-ok" role="status"><Check size={16} /> {ok}</div>}

      {!dados ? (!erro && <p className="muted">Carregando…</p>) : (
        <div className="as-grade">
          <div className="as-principal">
            {/* ligada / desligada */}
            <section className={'card as-status' + (ligada ? ' ligada' : '')}>
              <span className="as-status-icone"><Bot size={22} /></span>
              <div className="as-status-texto">
                <strong>{ligada ? `${nomeQueAparece} está atendendo` : 'Assistente desligada'}</strong>
                <span className="muted">
                  {ligada
                    ? (proprio ? `No número do salão${dados.canal?.numero ? ` (${dados.canal.numero})` : ''}.` : `No número da MIMO${dados.canal?.numero ? ` (${dados.canal.numero})` : ''}, em nome ${autonoma ? 'da' : 'do'} ${nomeSalao}.`)
                    : 'As mensagens das clientes ficam para a equipe responder.'}
                </span>
                {ligada && dados.agente_global === false && <span className="as-aviso"><Info size={14} /> As respostas automáticas estão pausadas pela MIMO neste momento.</span>}
              </div>
              <span className="switch as-status-chave"><input type="checkbox" aria-label="Ligar a assistente" checked={ligada} disabled={salvando} onChange={(e) => ligarDesligar(e.target.checked)} /><span /></span>
            </section>

            {/* o número */}
            <section className="card as-secao">
              <h3><Smartphone size={18} /> Em qual número ela atende</h3>
              <div className="as-numeros">
                <div className={'as-numero' + (!proprio ? ' atual' : '')}>
                  <span className="as-numero-icone"><MessageCircle size={18} /></span>
                  <div>
                    <strong>Número da MIMO {!proprio && <em className="as-selo">em uso</em>}</strong>
                    <small>Já funciona hoje, sem fazer nada. As clientes falam com a Mel, da MIMO, em nome {autonoma ? 'da' : 'do'} {nomeSalao}.</small>
                  </div>
                </div>
                <div className={'as-numero' + (proprio ? ' atual' : '')}>
                  <span className="as-numero-icone"><Store size={18} /></span>
                  <div>
                    <strong>Número do salão {proprio && <em className="as-selo">em uso</em>}</strong>
                    <small>As clientes falam com a <b>sua</b> assistente, no <b>seu</b> número, com o nome e o jeito que você escolher. Você continua vendo e respondendo tudo pelo celular; quando você responde, ela fica quieta com aquela cliente por 2 horas.</small>
                  </div>
                </div>
              </div>

              {proprio ? (
                <div className="as-conectado">
                  <span className={'as-ponto' + (conferido && conferido !== 'open' ? ' ruim' : '')} />
                  <div>
                    <strong>{dados.canal?.numero ?? 'Número do salão'} conectado</strong>
                    <small className="muted">
                      {conferido && conferido !== 'open'
                        ? 'O celular desconectou. Gere um código novo abaixo para conectar de novo.'
                        : dados.canal?.conectado_em ? `Desde ${new Date(dados.canal.conectado_em).toLocaleDateString('pt-BR')}. Mantenha o celular com internet.` : 'Mantenha o celular com internet.'}
                    </small>
                  </div>
                  <button type="button" className="btn btn-ghost as-desconectar" onClick={desconectar}><Unplug size={16} /> Desconectar</button>
                </div>
              ) : null}

              {(!proprio || (conferido && conferido !== 'open')) && (
                <div className="as-conectar">
                  {con.fase !== 'codigo' ? (
                    <>
                      <label className="as-campo">
                        <span>WhatsApp do salão (com DDD)</span>
                        <input inputMode="tel" autoComplete="tel" placeholder="(13) 99999-9999" value={numero} onChange={(e) => setNumero(e.target.value)} />
                      </label>
                      <button type="button" className="btn btn-primary" disabled={con.fase === 'gerando' || numero.replace(/\D/g, '').length < 10} onClick={gerarCodigo}>
                        {con.fase === 'gerando' ? <><Loader2 size={16} className="as-gira" /> Gerando…</> : 'Gerar código para conectar'}
                      </button>
                      {con.fase === 'erro' && <p className="as-erro-linha">{con.erro}</p>}
                      <small className="muted as-dica">Use o número que as clientes já conhecem (de preferência WhatsApp Business). O WhatsApp continua funcionando no celular como sempre.</small>
                    </>
                  ) : (
                    <div className="as-codigo">
                      <p className="as-codigo-tit">No celular do salão ({con.numero}), abra o WhatsApp e digite este código:</p>
                      {con.codigo ? <div className="as-codigo-num" aria-label="código de pareamento">{codigoBonito(con.codigo)}</div> : <p className="muted">O código não veio. Use o QR code abaixo.</p>}
                      <ol className="as-passos">
                        <li>WhatsApp › <b>⋮</b> (ou <b>Configurações</b>) › <b>Aparelhos conectados</b></li>
                        <li>Toque em <b>Conectar um aparelho</b></li>
                        <li>Escolha <b>Conectar com número de telefone</b> e digite o código</li>
                      </ol>
                      <p className="as-esperando"><Loader2 size={16} className="as-gira" /> Esperando o celular conectar…</p>
                      {con.qr && (
                        <>
                          <button type="button" className="btn btn-ghost" onClick={() => setVerQr((v) => !v)}><QrCode size={16} /> {verQr ? 'Esconder o QR code' : 'Prefere ler um QR code?'}</button>
                          {verQr && <img className="as-qr" src={con.qr} alt="QR code para conectar o WhatsApp" />}
                        </>
                      )}
                      <button type="button" className="btn btn-ghost" onClick={() => setCon({ fase: 'livre' })}>Cancelar</button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* o jeito dela */}
            <section className="card as-secao">
              <h3><Sparkles size={18} /> O jeito dela</h3>
              {!proprio && <p className="as-nota"><Info size={15} /> No número da MIMO ela se apresenta como Mel, da MIMO, no jeito padrão. O nome e o jeito que você escolher aqui valem quando ela atende no número do salão.</p>}
              <label className="as-campo">
                <span>Nome da assistente</span>
                <input maxLength={30} placeholder="Mel" value={cfg.nome} onChange={(e) => mudar('nome', e.target.value)} />
              </label>
              <div className="as-sugestoes">
                {SUGESTOES_DE_NOME.map((n) => <button key={n} type="button" className={'as-opcao' + ((cfg.nome?.trim() || 'Mel') === n ? ' ativa' : '')} onClick={() => mudar('nome', n)}>{n}</button>)}
              </div>
              <small className="muted">Não precisa trocar: se deixar em branco, ela é a Mel.</small>

              <div className="as-rotulo">Tom</div>
              <div className="as-tons" role="radiogroup" aria-label="Tom">
                {TONS.map((t) => (
                  <button key={t.id} type="button" role="radio" aria-checked={cfg.tom === t.id} className={'as-tom' + (cfg.tom === t.id ? ' ativa' : '')} onClick={() => mudar('tom', t.id)}>
                    <strong>{t.rotulo}</strong><small>{t.texto}</small>
                  </button>
                ))}
              </div>

              <div className="as-linha2">
                <div><div className="as-rotulo">Emojis</div><Opcoes rotulo="Emojis" lista={EMOJIS} valor={cfg.emojis} onEscolher={(v) => mudar('emojis', v)} /></div>
                <div><div className="as-rotulo">Como chama a cliente</div><Opcoes rotulo="Como chama a cliente" lista={TRATAMENTOS} valor={cfg.tratamento} onEscolher={(v) => mudar('tratamento', v)} /></div>
                <div><div className="as-rotulo">Respostas</div><Opcoes rotulo="Tamanho das respostas" lista={TAMANHOS} valor={cfg.tamanho} onEscolher={(v) => mudar('tamanho', v)} /></div>
              </div>

              <label className="as-campo">
                <span>Saudação <em>(opcional)</em></span>
                <input maxLength={300} placeholder={`Oi! Aqui é a ${cfg.nome?.trim() || 'Mel'}, do ${nomeSalao}. Como posso te ajudar?`} value={cfg.saudacao ?? ''} onChange={(e) => mudar('saudacao', e.target.value)} />
              </label>
            </section>

            {/* o que ela pode fazer */}
            <section className="card as-secao">
              <h3><CalendarClock size={18} /> O que ela pode fazer sozinha</h3>
              <Chave ligado={cfg.pode_marcar} onMudar={(v) => mudar('pode_marcar', v)} rotulo="Marcar horário" texto="Sempre repete o resumo e espera o sim da cliente." />
              <Chave ligado={cfg.pode_remarcar} onMudar={(v) => mudar('pode_remarcar', v)} rotulo="Remarcar" texto="Pede a troca; a profissional pode precisar aceitar." />
              <Chave ligado={cfg.pode_cancelar} onMudar={(v) => mudar('pode_cancelar', v)} rotulo="Cancelar" texto="Só horário da própria cliente, com o sim dela." />
              <small className="muted as-dica">O que estiver desligado, ela não faz: chama alguém da equipe.</small>
              <div className="as-rotulo">Preço</div>
              <Opcoes rotulo="Preço" lista={PRECOS} valor={cfg.preco} onEscolher={(v) => mudar('preco', v)} />
            </section>

            {/* quando ela responde */}
            <section className={'card as-secao' + (!proprio ? ' as-secao-off' : '')}>
              <h3><Clock size={18} /> Quando ela responde</h3>
              {!proprio && <p className="as-nota"><Info size={15} /> No número da MIMO ela responde sempre, na hora (a equipe não vê essas conversas). Isto vale no número do salão.</p>}
              <div className="as-quando" role="radiogroup" aria-label="Quando ela responde">
                {[
                  { id: 'sempre', t: 'Sempre, na hora', s: 'A cliente nunca fica esperando.' },
                  { id: 'fora_do_horario', t: 'Só fora do horário do salão', s: 'No horário, quem responde é a equipe.' },
                  { id: 'sem_resposta', t: 'Se a equipe não responder', s: 'No horário do salão, espera a equipe; fora dele, responde na hora.' },
                ].map((q) => (
                  <button key={q.id} type="button" role="radio" aria-checked={cfg.quando === q.id} disabled={!proprio} className={'as-quando-op' + (cfg.quando === q.id ? ' ativa' : '')} onClick={() => mudar('quando', q.id)}>
                    <span className="as-radio" /><span><strong>{q.t}</strong><small>{q.s}</small></span>
                  </button>
                ))}
              </div>
              {cfg.quando === 'sem_resposta' && proprio && (
                <div className="as-espera">
                  <span>Esperar a equipe por</span>
                  <div className="as-opcoes">
                    {ESPERAS.map((m) => <button key={m} type="button" className={'as-opcao' + (cfg.espera_min === m ? ' ativa' : '')} onClick={() => mudar('espera_min', m)}>{m} min</button>)}
                  </div>
                </div>
              )}
              <small className="muted as-dica">
                Horário do salão: {horario || 'ainda não definido'}. <Link to={para === 'admin' ? '/admin/horarios' : '/pro/horarios'}>Mudar o horário</Link>
              </small>
            </section>

            {/* recado */}
            <section className="card as-secao">
              <h3><MessagesSquare size={18} /> O que ela precisa saber da casa</h3>
              <textarea className="as-recado" rows={5} maxLength={1200} value={recado} onChange={(e) => setRecado(e.target.value)}
                placeholder="Ex.: Atraso de mais de 15 minutos perde o horário. Cancelamento com 24 h de antecedência. Temos estacionamento na rua de trás. Aceitamos Pix e cartão." />
              <small className="muted">{recado.length}/1200 · Ela usa isto para responder; não inventa o que não está aqui nem na agenda.</small>
            </section>
          </div>

          <aside className="as-lado">
            <section className="card as-previa">
              <div className="as-previa-topo">
                <span className="as-avatar">{nomeEscolhido.slice(0, 1).toUpperCase()}</span>
                <div><strong>{nomeEscolhido}</strong><small>assistente {autonoma ? 'da' : 'do'} {nomeSalao}</small></div>
                <em className="as-selo">prévia</em>
              </div>
              <Bolhas mensagens={conversaPrevia} nome={nomeEscolhido} />
              {!proprio && <small className="muted as-dica">Assim ela fala no número do salão. No número da MIMO, ela se apresenta como Mel, da MIMO.</small>}
            </section>

            <section className="card as-teste">
              <h3><Bot size={18} /> Testar de verdade</h3>
              <p className="muted as-teste-sub">Escreva como se fosse uma cliente. Ela consulta a sua agenda de verdade, com o jeito escolhido aqui (mesmo sem salvar), mas não marca nada nem chama ninguém.</p>
              {teste.length > 0 && <Bolhas mensagens={teste} nome={cfg.nome?.trim() || 'Mel'} digitando={testando} />}
              {teste.length === 0 && testando && <Bolhas mensagens={[]} digitando />}
              <div ref={fimDoTeste} />
              {erroTeste && <p className="as-erro-linha">{erroTeste}</p>}
              <form className="as-teste-form" onSubmit={enviarTeste}>
                <input value={escrito} maxLength={500} onChange={(e) => setEscrito(e.target.value)} placeholder={teste.length ? 'Responda…' : 'Oi! Tem horário amanhã?'} aria-label="Mensagem de teste" />
                <button type="submit" className="btn btn-primary as-enviar" disabled={!escrito.trim() || testando} aria-label="Enviar"><Send size={16} /></button>
              </form>
              {teste.length > 0 && <button type="button" className="btn btn-ghost as-recomecar" onClick={() => { setTeste([]); setErroTeste('') }}><RotateCcw size={14} /> Recomeçar</button>}
            </section>

            {numeros && (
              <section className="card as-numeros-card">
                <h3>Últimos {numeros.dias ?? 30} dias</h3>
                <div className="as-kpis">
                  <div><MessageCircle size={16} /><strong>{numeros.conversas ?? 0}</strong><small>conversas</small></div>
                  <div><CalendarCheck size={16} /><strong>{numeros.marcou ?? 0}</strong><small>horários marcados</small></div>
                  <div><CalendarClock size={16} /><strong>{numeros.remarcou ?? 0}</strong><small>remarcados</small></div>
                  <div><CalendarX size={16} /><strong>{numeros.cancelou ?? 0}</strong><small>cancelados</small></div>
                  <div><HandHelping size={16} /><strong>{numeros.chamou ?? 0}</strong><small>chamou a equipe</small></div>
                </div>
                {para === 'admin' && <Link to="/admin/whatsapp" className="as-link">Ver as mensagens e o diagnóstico do WhatsApp</Link>}
              </section>
            )}
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
    </Shell>
  )
}
