import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Gauge, Plus, X, Check, Zap, ShieldCheck, TriangleAlert, LoaderCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { chamar } from '../lib/pagamento'
import { reais } from '../lib/planos'
import { TelaPix, PixIcone } from './AtivarSalao'
import '../checkout-mimo.css'

// 3.99 (migração 248): na aba Assistente, quanto ela já respondeu hoje (as do plano), o saldo extra comprado por Pix,
// quando ela fica quieta sozinha e com quem ela está quieta agora (com "Voltar a responder"). A compra abre uma janela
// com os pacotes, o mesmo Pix da assinatura (função respostas-extras) e o "Pronto!". O saldo não vence e só é usado
// depois das respostas do dia.

const milhar = (n) => Number(n ?? 0).toLocaleString('pt-BR')
const telefone = (t) => {
  const n = String(t ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`
  return t ?? ''
}
const iniciais = (nome) => String(nome ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
const MOTIVO = {
  chamou_equipe: ['chamou a equipe', ''],
  equipe_respondeu: ['a equipe respondeu', 'eq'],
  fora_do_assunto: ['fora do assunto', 'fa'],
  ofensiva: ['ofensiva', 'of'],
}
function ate(iso) {
  const d = new Date(iso)
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const hoje = new Date()
  const amanha = new Date(); amanha.setDate(hoje.getDate() + 1)
  if (d.toDateString() === hoje.toDateString()) return hora
  if (d.toDateString() === amanha.toDateString()) return `amanhã ${hora}`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hora
}
// R$ 0,040 por resposta (três casas: com duas, todas virariam R$ 0,03 ou 0,04)
const cada = (p) => 'R$ ' + (p.valor_cents / 100 / p.respostas).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const dia = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '')

export default function LimitesDaAssistente({ salaoId, ordem }) {
  const [lim, setLim] = useState(null)
  const [erro, setErro] = useState('')
  const [some, setSome] = useState(false)
  const [voltando, setVoltando] = useState(null)
  const [comprando, setComprando] = useState(false)

  async function carregar() {
    const { data, error } = await supabase.rpc('assistente_limites', { salao: salaoId })
    if (error) {
      if (/function|does not exist|schema cache/i.test(error.message)) setErro('Os limites ainda não estão no banco (falta a atualização 248).')
      else setSome(true)   // quem não manda no salão não vê
      return
    }
    setErro(''); setLim(data)
  }
  useEffect(() => { if (salaoId) carregar() }, [salaoId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function voltar(tel) {
    setVoltando(tel)
    const { data, error } = await supabase.rpc('assistente_voltar_a_responder', { salao: salaoId, tel })
    setVoltando(null)
    if (error) { setErro(error.message); return }
    setLim(data)
  }

  if (some) return null
  const usadas = Number(lim?.usadas ?? 0)
  const teto = Number(lim?.teto ?? 200)
  const extras = Number(lim?.extras ?? 0)
  const pct = teto > 0 ? Math.min(100, Math.round((usadas / teto) * 100)) : 0
  const acabou = usadas >= teto
  const pausas = lim?.pausas ?? []
  const ultima = lim?.compras?.[0]

  return (
    <section className="card asx-secao" style={ordem != null ? { order: ordem } : undefined}>
      <header className="asx-cab">
        <span className="asx-ico"><Gauge size={18} /></span>
        <div className="asx-cab-txt"><h3>Limites e pausas</h3><p>Quanto ela já respondeu hoje e com quem ela está quieta agora.</p></div>
      </header>
      {erro && <div className="alert alert-error">{erro}</div>}
      {!lim ? (!erro && <p className="muted">Carregando…</p>) : (
        <>
          <div className={'lp-uso' + (acabou && extras <= 0 ? ' acabou' : '')}>
            <div className="lp-uso-topo"><strong>Respostas hoje (incluídas no plano)</strong><b>{milhar(Math.min(usadas, teto))} <small>de {milhar(teto)}</small></b></div>
            <div className="lp-barra" role="progressbar" aria-valuemin={0} aria-valuemax={teto} aria-valuenow={Math.min(usadas, teto)} aria-label="Respostas de hoje"><i style={{ width: `${pct}%` }} /></div>
            <small>
              {acabou && extras <= 0
                ? `As ${milhar(teto)} de hoje acabaram: ela para até a meia-noite e as mensagens ficam para a equipe responder pelo celular. Com respostas extras, ela volta na hora.`
                : acabou
                  ? `As ${milhar(teto)} de hoje acabaram; ela segue pelo saldo extra. Zera à meia-noite.`
                  : `Zera à meia-noite. Quando as ${milhar(teto)} do dia acabam, ela segue pelo saldo extra; sem saldo, para até amanhã e as mensagens ficam para a equipe.`}
            </small>
            <div className="lp-saldo">
              <div>
                <strong>{extras > 0 ? `Saldo extra: ${milhar(extras)} ${extras === 1 ? 'resposta' : 'respostas'}` : 'Saldo extra: nenhum'}</strong>
                <small>{extras > 0 ? 'Não vence. Só é usado quando as do dia acabam.' : `Um pacote deixa ela seguir depois das ${milhar(teto)} do dia. Não vence.`}{ultima ? ` Última compra: +${milhar(ultima.respostas)} em ${dia(ultima.pago_em)}.` : ''}</small>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => setComprando(true)}><Plus size={16} /> Comprar mais respostas</button>
            </div>
          </div>

          <div className="lp-regras">
            <h4 className="lp-h4">Quando ela fica quieta sozinha</h4>
            <ul>
              <li><span className="lp-tempo">2 h</span>chamou alguém da equipe, ou a equipe respondeu pelo celular</li>
              <li><span className="lp-tempo">6 h</span>a pessoa insistiu em assunto que não é do salão</li>
              <li><span className="lp-tempo">24 h</span>mensagem ofensiva, assédio ou golpe</li>
              <li><span className="lp-tempo">5 min</span>mais de 15 respostas seguidas para o mesmo número (robô conversando com robô)</li>
            </ul>
          </div>

          <div className="lp-pausas">
            <h4 className="lp-h4">Em pausa agora {pausas.length > 0 && <span className="lp-n">{pausas.length}</span>}</h4>
            {pausas.length === 0 ? <p className="lp-vazio">Nenhum número em pausa agora: ela está respondendo todo mundo.</p> : pausas.map((p) => {
              const [motivo, cls] = MOTIVO[p.tipo] ?? MOTIVO.chamou_equipe
              return (
                <div key={p.telefone} className="lp-pausa">
                  <span className={'lp-av' + (p.nome ? '' : ' cinza')}>{p.nome ? iniciais(p.nome) : '?'}</span>
                  <div className="lp-quem"><strong>{p.nome || 'Sem cadastro'}</strong><small>{telefone(p.telefone)} <span className={'lp-motivo ' + cls}>{motivo}</span></small></div>
                  <span className="lp-ate">até {ate(p.ate)}</span>
                  <button type="button" className="lp-volta" onClick={() => voltar(p.telefone)} disabled={voltando === p.telefone}>
                    {voltando === p.telefone ? 'Voltando…' : 'Voltar a responder'}
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
      {comprando && lim && (
        <CompraDeRespostas
          salaoId={salaoId}
          lim={lim}
          onFechar={() => { setComprando(false); carregar() }}
        />
      )}
    </section>
  )
}

// a janela da compra: os pacotes, o Pix e o "Pronto!"
function CompraDeRespostas({ salaoId, lim, onFechar }) {
  const pacotes = lim?.pacotes?.length ? lim.pacotes : [{ respostas: 500, valor_cents: 1990 }, { respostas: 1000, valor_cents: 3490, destaque: 'mais escolhido' }, { respostas: 2000, valor_cents: 5990, destaque: 'melhor preço' }]
  const [escolhido, setEscolhido] = useState(() => (pacotes.find((p) => p.destaque === 'mais escolhido') ?? pacotes[0]).respostas)
  const [modo, setModo] = useState('pacotes')   // pacotes | pix | pronto
  const [compra, setCompra] = useState(null)
  const [indo, setIndo] = useState(false)
  const [erro, setErro] = useState('')
  const conferirAgora = useRef(null)
  const pacote = pacotes.find((p) => p.respostas === escolhido) ?? pacotes[0]
  const usadas = Number(lim?.usadas ?? 0)
  const teto = Number(lim?.teto ?? 200)

  // fecha no Esc; enquanto a janela está aberta, a página de trás não rola
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape') onFechar() }
    document.addEventListener('keydown', tecla)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', tecla); document.body.style.overflow = antes }
  }, [onFechar])

  // com o Pix aberto, a tela confere sozinha a cada 5 s (o aviso do Asaas também credita, sem a tela)
  useEffect(() => {
    if (modo !== 'pix') return
    const t = setInterval(() => conferirAgora.current?.(false), 5000)
    return () => clearInterval(t)
  }, [modo])

  async function pagar() {
    setIndo(true); setErro('')
    try {
      const r = await chamar('respostas-extras', { acao: 'pix', salao: salaoId, respostas: pacote.respostas })
      setCompra(r?.compra ?? null)
      setModo(r?.compra?.status === 'pago' ? 'pronto' : 'pix')
    } catch (e) {
      setErro(e?.message || String(e))
    } finally {
      setIndo(false)
    }
  }

  async function conferir(manual = true) {
    if (!compra?.id || (manual && indo)) return
    if (manual) { setIndo(true); setErro('') }
    try {
      const r = await chamar('respostas-extras', { acao: 'conferir', salao: salaoId, compra: compra.id, manual })
      if (r?.compra?.status === 'pago') { setCompra((c) => ({ ...(c ?? {}), ...r.compra })); setModo('pronto') }
      else if (manual) setErro('Ainda não chegou. O Pix costuma cair em segundos; se você já pagou, espere um pouquinho que a tela confere sozinha.')
    } catch (e) {
      if (manual) setErro(e?.message || String(e))
    } finally {
      if (manual) setIndo(false)
    }
  }
  useEffect(() => { conferirAgora.current = conferir })

  return createPortal(
    <div className="ai-fundo ck-fundo pk-fundo" role="dialog" aria-modal="true" aria-label="Respostas extras da assistente" onClick={(e) => { if (e.target === e.currentTarget) onFechar() }}>
      <div className="ck pk-janela">
        <header className="pk-topo">
          <strong>Respostas extras da assistente</strong>
          <button type="button" className="pk-fechar" aria-label="Fechar" onClick={onFechar}><X size={18} /></button>
        </header>

        {modo === 'pacotes' && (
          <section className="ck-opcao ck-pagar">
            <span className="ck-fita"><Zap size={13} /> Entra na hora · não vence</span>
            <h2>Mais respostas para a sua assistente</h2>
            <div className="pk-uso"><TriangleAlert size={16} /><span>Hoje ela já usou <b>{milhar(Math.min(usadas, teto))} das {milhar(teto)}</b> incluídas. O saldo extra só é usado depois delas.</span></div>
            <div className="pk-lista" role="radiogroup" aria-label="Escolha o pacote">
              {pacotes.map((p) => (
                <button key={p.respostas} type="button" role="radio" aria-checked={p.respostas === escolhido} className={'pk-op' + (p.respostas === escolhido ? ' ativo' : '')} onClick={() => setEscolhido(p.respostas)} disabled={indo}>
                  {p.destaque && <span className={'pk-tag' + (p.destaque === 'melhor preço' ? ' verde' : '')}>{p.destaque.toUpperCase()}</span>}
                  <i className="pk-marca" />
                  <span className="pk-op-txt"><b>{milhar(p.respostas)} respostas</b><small>{cada(p)} cada</small></span>
                  <strong>{reais(p.valor_cents / 100)}</strong>
                </button>
              ))}
            </div>
            <ul className="ck-lista">
              <li><Check size={14} /> Entra no saldo assim que o Pix cair</li>
              <li><Check size={14} /> Não vence: ela usa quando precisar</li>
              <li><Check size={14} /> Pagamento único, sem renovação</li>
            </ul>
            {erro && <div className="ai-erro ck-erro">{erro}</div>}
            <button type="button" className="ck-botao ck-botao-pix" onClick={pagar} disabled={indo}>
              {indo ? <LoaderCircle className="ai-gira" size={18} /> : <PixIcone />} {indo ? 'Gerando o Pix…' : `Pagar ${reais(pacote.valor_cents / 100)} com Pix`}
            </button>
            <small className="ck-nota"><ShieldCheck size={12} /> Processado pelo Asaas.</small>
          </section>
        )}

        {modo === 'pix' && (
          <TelaPix
            pix={compra}
            total={Number(compra?.valor_cents ?? pacote.valor_cents)}
            descontoPct={0}
            rotulo={`${milhar(compra?.respostas ?? pacote.respostas)} respostas extras`}
            voltarTexto="Voltar aos pacotes"
            statusTexto="A tela confere sozinha. Pagou, o saldo entra."
            indo={indo}
            erro={erro}
            onConferir={() => conferir(true)}
            onVoltar={() => { setErro(''); setModo('pacotes') }}
          />
        )}

        {modo === 'pronto' && (
          <section className="pk-pronto">
            <span className="ok"><Check size={32} /></span>
            <span className="ck-kicker">Pagamento confirmado</span>
            <h2>Pronto! +{milhar(compra?.respostas)} respostas</h2>
            <div className="saldo"><small>Saldo extra agora</small><b>{milhar(compra?.extras)} respostas</b><small>Não vence · usado depois das {milhar(teto)} do dia</small></div>
            <p>A assistente segue respondendo normalmente. A compra fica registrada em Limites e pausas.</p>
            <button type="button" className="ck-botao ck-botao-pix" onClick={onFechar}>Voltar ao painel</button>
          </section>
        )}
      </div>
    </div>,
    document.body,
  )
}
