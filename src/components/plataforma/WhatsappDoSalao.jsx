import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Search, ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { chamar } from '../../lib/pagamento'
import { Pilula, Vazio } from './Pecas'
import InstanciaWhatsapp from './InstanciaWhatsapp'
import DiagnosticoWhatsapp from './DiagnosticoWhatsapp'
import { situacaoDe, haQuanto, dia } from '../../lib/instanciaWhats'

// 4.12: a aba WhatsApp do salão na Plataforma, em três partes que não se misturam:
//   Conversas    tudo o que passou pelo WhatsApp DESTE salão, por número (o que chegou e o que saiu, em ordem)
//   Conexão      a instância na Evolution ao vivo e o que o banco anotou
//   Diagnóstico  a conferência técnica do envio (canal, regras, relógio)
// No topo, sempre: qual número está conectado e se está no ar.

const TIPOS = { agente: 'assistente', lembrete: 'lembrete', confirmacao: 'confirmação', novo_agendamento: 'novo horário', cancelamento: 'cancelamento', remarcacao: 'remarcação', teste: 'teste' }
const tipoDe = (t) => TIPOS[t] ?? String(t ?? '').replace(/_/g, ' ')
const STATUS = { na_fila: 'na fila', enviando: 'enviando', enviado: 'enviada', entregue: 'entregue', lido: 'lida', falhou: 'não saiu', cancelado: 'cancelada' }
const fone = (t) => {
  const d = String(t ?? '').replace(/\D/g, '')
  if (d.startsWith('55') && d.length === 13) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`
  if (d.startsWith('55') && d.length === 12) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`
  return t ? `+${d}` : ''
}
const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const diaDe = (iso) => {
  const d = new Date(iso), hoje = new Date(), ontem = new Date(Date.now() - 864e5)
  if (d.toDateString() === hoje.toDateString()) return 'Hoje'
  if (d.toDateString() === ontem.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

export default function WhatsappDoSalao({ salaoId }) {
  const [parte, setParte] = useState('conversas')
  const [inst, setInst] = useState(null)
  const [erroInst, setErroInst] = useState('')
  const [consultando, setConsultando] = useState(true)
  const [versao, setVersao] = useState(0)
  const [resumo, setResumo] = useState(null)

  useEffect(() => {
    if (!salaoId) return
    let vivo = true
    chamar('assistente', { acao: 'instancia', salao: salaoId })
      .then((r) => { if (vivo) { setInst(r); setErroInst('') } })
      .catch((e) => { if (vivo) setErroInst(e.message || 'Não deu para consultar o servidor do WhatsApp.') })
      .finally(() => { if (vivo) setConsultando(false) })
    supabase.rpc('plataforma_whats_resumo', { salao: salaoId }).then(({ data }) => { if (vivo) setResumo(data ?? null) })
    return () => { vivo = false }
  }, [salaoId, versao])
  const conferir = () => { setConsultando(true); setVersao((v) => v + 1) }

  const sit = inst ? situacaoDe(inst.situacao) : null
  const proprio = inst?.canal?.numero_proprio
  const numero = (proprio ? inst?.instancia?.numero : null) ?? inst?.canal?.numero_exibicao ?? null
  const desde = proprio ? dia(inst?.canal?.conectado_em) : null

  return (
    <div className="wsal">
      <div className={'wsal-topo' + (sit ? ' wsal-' + sit.tom : '')}>
        <div className="wsal-topo-num">
          <small>Número conectado neste salão</small>
          <strong>{!inst ? (erroInst ? 'não deu para consultar' : 'consultando…') : numero || 'nenhum'}</strong>
          {inst && <span>{proprio ? `número do próprio salão${desde ? ` · conectado desde ${desde}` : ''}` : inst.canal?.canal === 'evolution' ? 'número da MIMO (o salão não conectou o dele)' : 'o salão não envia sozinho'}</span>}
        </div>
        <div className="wsal-topo-sit">
          {sit && <Pilula tom={sit.tom}>{sit.rotulo}</Pilula>}
          <button className="btn-mini btn-mini-neutro" onClick={conferir} disabled={consultando}><RefreshCw size={13} /> {consultando ? 'consultando…' : 'consultar de novo'}</button>
        </div>
        {sit && sit.tom !== 'menta' && <p className="wsal-topo-frase">{sit.frase}</p>}
        {erroInst && <p className="wsal-topo-frase">{erroInst}</p>}
      </div>

      {resumo && (
        <ul className="wsal-nums">
          <li><strong>{resumo.conversas_30d}</strong><span>conversas em 30 dias</span></li>
          <li><strong>{resumo.chegaram_30d}</strong><span>mensagens que chegaram</span></li>
          <li><strong>{resumo.sairam_30d}</strong><span>mensagens que saíram</span></li>
          <li className={resumo.falharam_30d > 0 ? 'ruim' : ''}><strong>{resumo.falharam_30d}</strong><span>não saíram</span></li>
          <li><strong>{resumo.na_fila}</strong><span>na fila agora</span></li>
        </ul>
      )}

      <div className="plat-chips wsal-partes" role="tablist">
        {[['conversas', 'Conversas'], ['conexao', 'Conexão'], ['diagnostico', 'Diagnóstico']].map(([k, r]) => (
          <button key={k} role="tab" aria-selected={parte === k} className={'plat-chip' + (parte === k ? ' ativo' : '')} onClick={() => setParte(k)}>{r}</button>
        ))}
      </div>

      {parte === 'conversas' && <Conversas salaoId={salaoId} versao={versao} />}
      {parte === 'conexao' && (inst ? <InstanciaWhatsapp salaoId={salaoId} d={inst} onConferir={conferir} /> : <Vazio>{erroInst || 'Consultando o servidor do WhatsApp…'}</Vazio>)}
      {parte === 'diagnostico' && <DiagnosticoWhatsapp salaoId={salaoId} />}
    </div>
  )
}

function Conversas({ salaoId, versao }) {
  const [lista, setLista] = useState(null)
  const [busca, setBusca] = useState('')
  const [soFalhas, setSoFalhas] = useState(false)
  const [tel, setTel] = useState(null)
  const [msgs, setMsgs] = useState(null)
  const [temMais, setTemMais] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    const t = setTimeout(() => {
      supabase.rpc('plataforma_whats_conversas', { salao: salaoId, busca: busca.trim() || null, so_falhas: soFalhas, quantas: 80 }).then(({ data, error }) => {
        if (!vivo) return
        if (error) setErro(error.message + (/does not exist|schema cache/i.test(error.message) ? ' (a migração 267 já rodou?)' : ''))
        else setErro('')
        setLista(data ?? [])
      })
    }, busca ? 300 : 0)
    return () => { vivo = false; clearTimeout(t) }
  }, [salaoId, busca, soFalhas, versao])

  const LOTE = 80
  useEffect(() => {
    if (!tel) return
    let vivo = true
    supabase.rpc('plataforma_whats_mensagens', { salao: salaoId, tel, antes: null, quantas: LOTE }).then(({ data }) => {
      if (!vivo) return
      setMsgs([...(data ?? [])].reverse()); setTemMais((data ?? []).length === LOTE)
    })
    return () => { vivo = false }
  }, [salaoId, tel, versao])
  async function maisAntigas() {
    const { data } = await supabase.rpc('plataforma_whats_mensagens', { salao: salaoId, tel, antes: msgs[0]?.quando ?? null, quantas: LOTE })
    setMsgs([...[...(data ?? [])].reverse(), ...msgs]); setTemMais((data ?? []).length === LOTE)
  }
  const abrir = (t) => { if (t !== tel) { setMsgs(null); setTel(t) } }
  // a conversa abre no fim (o mais recente), como no WhatsApp; carregar as antigas não mexe na rolagem
  const fim = useRef(null), abriu = useRef(null)
  useEffect(() => {
    if (msgs && abriu.current !== tel && fim.current) { fim.current.scrollTop = fim.current.scrollHeight; abriu.current = tel }
  }, [msgs, tel])

  const atual = (lista ?? []).find((c) => c.telefone === tel)

  return (
    <div className={'wsal-conv' + (tel ? ' aberta' : '')}>
      <aside className="wsal-lista">
        <div className="wsal-busca"><Search size={14} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou número" aria-label="Buscar conversa" /></div>
        <label className="wsal-so"><input type="checkbox" checked={soFalhas} onChange={(e) => setSoFalhas(e.target.checked)} /> só com mensagem que não saiu</label>
        {erro && <p className="erro">{erro}</p>}
        {lista == null ? <Vazio>Carregando…</Vazio> : lista.length === 0 ? <Vazio>{busca || soFalhas ? 'Nenhuma conversa com esse filtro.' : 'Nada passou pelo WhatsApp deste salão ainda.'}</Vazio> : (
          <ul>
            {lista.map((c) => (
              <li key={c.telefone}>
                <button className={c.telefone === tel ? 'ativa' : ''} onClick={() => abrir(c.telefone)}>
                  <span className="wsal-quem"><strong>{c.nome || fone(c.telefone)}</strong><time>{haQuanto(c.ultima)}</time></span>
                  {c.nome && <span className="wsal-fone">{fone(c.telefone)}</span>}
                  <span className="wsal-previa">{c.ultimo_lado === 'saiu' ? 'Salão: ' : ''}{c.ultimo_texto || '(sem texto)'}</span>
                  <span className="wsal-conta">{c.chegaram} chegaram · {c.sairam} saíram{c.falharam > 0 ? <b> · {c.falharam} não {c.falharam === 1 ? 'saiu' : 'saíram'}</b> : null}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="wsal-fio">
        {!tel ? <p className="wsal-fio-vazio muted">Escolha uma conversa para ver tudo o que chegou e saiu naquele número.</p> : (
          <>
            <header>
              <button className="wsal-voltar" onClick={() => setTel(null)} aria-label="Voltar para as conversas"><ArrowLeft size={16} /></button>
              <div><strong>{atual?.nome || fone(tel)}</strong><span className="muted">{atual?.nome ? fone(tel) : 'sem cadastro com esse número'}</span></div>
              <a className="btn-mini btn-mini-neutro" href={`https://wa.me/${String(tel).replace(/\D/g, '')}`} target="_blank" rel="noreferrer">abrir no WhatsApp</a>
            </header>
            <div className="wsal-baloes" ref={fim}>
              {msgs == null ? <Vazio>Carregando…</Vazio> : (
                <>
                  {temMais && <button className="plat-link wsal-mais" onClick={maisAntigas}>ver mensagens mais antigas</button>}
                  {msgs.map((m, i) => {
                    const d = diaDe(m.quando)
                    const novoDia = i === 0 || diaDe(msgs[i - 1].quando) !== d
                    return (
                      <div key={m.id} className="wsal-linha">
                        {novoDia && <div className="wsal-dia"><span>{d}</span></div>}
                        <div className={'wsal-balao ' + m.lado + (m.status === 'falhou' ? ' falhou' : '')}>
                          {m.lado === 'saiu' && <small className="wsal-tipo">{tipoDe(m.tipo)}</small>}
                          <p>{m.texto || '(sem texto)'}</p>
                          <small className="wsal-pe">
                            {hora(m.quando)}
                            {m.lado === 'saiu' ? ` · ${STATUS[m.status] ?? m.status}` : m.via ? ` · lida ${m.via === 'ia' ? 'pela IA' : m.via === 'bot' ? 'pela assistente' : 'pelas regras'}${m.entendeu ? `: ${m.entendeu}` : ''}` : ''}
                          </small>
                          {m.status === 'falhou' && m.erro && <small className="wsal-erro">{String(m.erro).slice(0, 160)}</small>}
                        </div>
                      </div>
                    )
                  })}
                  {msgs.length === 0 && <Vazio>Sem mensagens.</Vazio>}
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
