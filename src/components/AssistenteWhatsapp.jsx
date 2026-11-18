import { useEffect, useRef, useState } from 'react'
import { Loader2, QrCode, RotateCcw, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { chamar } from '../lib/pagamento'
import { codigoBonito } from '../lib/assistente'

// 3.97: as peças da assistente do WhatsApp usadas em dois lugares: a área WhatsApp do salão (AdminAssistente) e a
// etapa WhatsApp da configuração inicial (EtapaWhatsapp). Antes viviam dentro da tela da assistente.
//   Bolhas            a conversa no visual do WhatsApp (prévia e teste)
//   ConectarWhatsapp  o número, o código de pareamento (com "Gerar outro código"), o QR e a espera pelo celular
//   ConversaDeTeste   escrever como cliente e ver a assistente responder com a agenda real, sem gravar nada

export function Bolhas({ mensagens, nome, digitando }) {
  return (
    <div className="as-conversa">
      {mensagens.map((m, i) => m.quem === 'aviso' ? <div key={i} className="as-bolha-aviso">{m.texto}</div> : (
        <div key={i} className={'as-bolha ' + (m.quem === 'cliente' ? 'dela' : 'nossa')}>
          {m.quem !== 'cliente' && i > 0 && mensagens[i - 1]?.quem === 'cliente' && <span className="as-bolha-quem">{nome}</span>}
          {m.texto}
        </div>
      ))}
      {digitando && <div className="as-bolha nossa as-digitando" aria-label="digitando"><i /><i /><i /></div>}
    </div>
  )
}

// onConectou(dados, { jaEstava }): o celular conectou (dados = assistente_do_salao); onComecou: limpar avisos da tela
export function ConectarWhatsapp({ salaoId, onConectou, onComecou, dica = true }) {
  const [numero, setNumero] = useState('')
  const [con, setCon] = useState({ fase: 'livre' })   // livre · gerando · codigo · erro
  const [verQr, setVerQr] = useState(false)
  const avisar = useRef(onConectou)
  useEffect(() => { avisar.current = onConectou }, [onConectou])

  // enquanto o código está na tela, pergunta a cada 4 s se o celular já conectou (até 3 min)
  useEffect(() => {
    if (con.fase !== 'codigo') return
    let vivo = true
    const desde = Date.now()
    const t = setInterval(async () => {
      if (Date.now() - desde > 180_000) { clearInterval(t); if (vivo) setCon({ fase: 'erro', erro: 'O código expirou. Gere outro e digite no celular em até 2 minutos.', jaGerou: true }); return }
      try {
        const e = await chamar('assistente', { acao: 'estado', salao: salaoId })
        if (vivo && e?.estado === 'open') {
          clearInterval(t)
          const { data } = await supabase.rpc('assistente_do_salao', { salao: salaoId })
          if (!vivo) return
          setCon({ fase: 'livre' })
          await avisar.current?.(data, { jaEstava: false })
        }
      } catch { /* tenta de novo no próximo */ }
    }, 4000)
    return () => { vivo = false; clearInterval(t) }
  }, [con.fase, salaoId])

  // novo (3.96.2): "Gerar outro código" recomeça a conexão do zero (o código anterior deixa de valer)
  async function gerarCodigo(novo = false) {
    onComecou?.(); setCon({ fase: 'gerando' }); setVerQr(false)
    try {
      const r = await chamar('assistente', { acao: 'conectar', salao: salaoId, numero, novo })
      if (r?.estado === 'open') {
        const { data } = await supabase.rpc('assistente_do_salao', { salao: salaoId })
        setCon({ fase: 'livre' })
        await avisar.current?.(data, { jaEstava: true })
        return
      }
      setCon({ fase: 'codigo', codigo: r?.pairingCode ?? null, qr: r?.qr ?? null, numero: r?.numero ?? numero })
    } catch (e) {
      setCon({ fase: 'erro', erro: e.message || 'Não deu para gerar o código agora.', jaGerou: novo })
    }
  }

  if (con.fase !== 'codigo') {
    return (
      <div className="asx-conectar">
        <label className="asx-rot-campo">
          <span>WhatsApp do salão, com DDD</span>
          <input className="asx-input" inputMode="tel" autoComplete="tel" placeholder="(13) 99999-9999" value={numero} onChange={(e) => setNumero(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary asx-btn" disabled={con.fase === 'gerando' || numero.replace(/\D/g, '').length < 10} onClick={() => gerarCodigo(Boolean(con.jaGerou))}>
          {con.fase === 'gerando' ? <><Loader2 size={16} className="as-gira" /> Gerando…</> : con.jaGerou ? <><RotateCcw size={16} /> Gerar outro código</> : 'Gerar código'}
        </button>
        {con.fase === 'erro' && <p className="as-erro-linha">{con.erro}</p>}
        {dica && <small className="asx-dica">Use o número que as clientes já conhecem (de preferência WhatsApp Business). Enquanto não conectar, nenhuma mensagem sai pelo WhatsApp: os avisos continuam no app.</small>}
      </div>
    )
  }
  return (
    <div className="as-codigo">
      <p className="as-codigo-tit">No celular do salão ({con.numero}), abra o WhatsApp e digite:</p>
      {con.codigo ? <div className="as-codigo-num" aria-label="código de pareamento">{codigoBonito(con.codigo)}</div> : <p className="muted">O código não veio. Use o QR code abaixo.</p>}
      <ol className="as-passos">
        <li>WhatsApp › <b>⋮</b> (ou <b>Configurações</b>) › <b>Aparelhos conectados</b></li>
        <li>Toque em <b>Conectar um aparelho</b></li>
        <li>Escolha <b>Conectar com número de telefone</b> e digite o código</li>
      </ol>
      <p className="as-esperando"><Loader2 size={16} className="as-gira" /> Esperando o celular conectar…</p>
      <p className="asx-nao-chegou">O código não funcionou ou o celular pediu outro? Gere um novo: o anterior deixa de valer.</p>
      <div className="asx-botoes">
        <button type="button" className="btn btn-ghost" onClick={() => gerarCodigo(true)}><RotateCcw size={16} /> Gerar outro código</button>
        {con.qr && <button type="button" className="btn btn-ghost" onClick={() => setVerQr((v) => !v)}><QrCode size={16} /> {verQr ? 'Esconder o QR code' : 'Ler um QR code'}</button>}
        <button type="button" className="btn btn-ghost" onClick={() => setCon({ fase: 'livre' })}>Cancelar</button>
      </div>
      {con.qr && verQr && <img className="as-qr" src={con.qr} alt="QR code para conectar o WhatsApp" />}
    </div>
  )
}

// rascunho: { assistente, recado, cliente_nome } (o jeito dela ainda não salvo); sugestoes: frases prontas para tocar
export function ConversaDeTeste({ salaoId, nome, rascunho, sugestoes = [] }) {
  const [teste, setTeste] = useState([])
  const [escrito, setEscrito] = useState('')
  const [testando, setTestando] = useState(false)
  const [erroTeste, setErroTeste] = useState('')
  const fimDoTeste = useRef(null)
  useEffect(() => { if (teste.length || testando) fimDoTeste.current?.scrollIntoView({ block: 'nearest' }) }, [teste, testando])

  async function enviar(texto) {
    const t = String(texto ?? '').trim()
    if (!t || testando) return
    const conversa = [...teste.filter((m) => m.quem !== 'aviso'), { quem: 'cliente', texto: t }]
    setTeste((c) => [...c, { quem: 'cliente', texto: t }]); setEscrito(''); setTestando(true); setErroTeste('')
    try {
      const r = await chamar('assistente', { acao: 'testar', salao: salaoId, mensagens: conversa, rascunho })
      setTeste((c) => [...c, { quem: 'assistente', texto: r.resposta, acoes: r.acoes }, ...(r.acoes?.marcou || r.acoes?.remarcou || r.acoes?.cancelou ? [{ quem: 'aviso', texto: 'Teste: nada foi gravado na agenda.' }] : [])])
    } catch (er) {
      setErroTeste(er.message || 'Não deu para testar agora.')
    }
    setTestando(false)
  }

  return (
    <>
      {(teste.length > 0 || testando) && <Bolhas mensagens={teste} nome={nome} digitando={testando} />}
      <div ref={fimDoTeste} />
      {erroTeste && <p className="as-erro-linha">{erroTeste}</p>}
      {teste.length === 0 && sugestoes.length > 0 && (
        <div className="asx-sugestoes">{sugestoes.map((s) => <button key={s} type="button" onClick={() => enviar(s)} disabled={testando}>{s}</button>)}</div>
      )}
      <form className="as-teste-form" onSubmit={(e) => { e.preventDefault(); enviar(escrito) }}>
        <input value={escrito} maxLength={500} onChange={(e) => setEscrito(e.target.value)} placeholder={teste.length ? 'Responda…' : 'Oi! Tem horário amanhã?'} aria-label="Mensagem de teste" />
        <button type="submit" className="btn btn-primary as-enviar" disabled={!escrito.trim() || testando} aria-label="Enviar"><Send size={16} /></button>
      </form>
      {teste.length > 0 && <button type="button" className="as-link-botao as-recomecar" onClick={() => { setTeste([]); setErroTeste('') }}><RotateCcw size={14} /> Recomeçar a conversa</button>}
    </>
  )
}
