import { useEffect, useState } from 'react'
import { X, Banknote, QrCode, CreditCard, Receipt, Smartphone, Calculator, Check, Printer, Plus, Trash2, ChevronLeft, Mail, Sparkles } from 'lucide-react'
import { formatCents } from '../lib/pagamento'

// O caixa (105): a folha que fecha a comanda. Escolhe a forma, digita o
// valor num teclado grande, no dinheiro vê o troco na hora, no cartão
// anota a máquina e as parcelas, divide em quantas partes quiser, e
// fecha. No fim, o cupom vai para o app e o e-mail da cliente (ou para a
// impressora). Uma calculadora vive num botão, para as contas do balcão.
const FORMAS = [
  { k: 'dinheiro', r: 'Dinheiro', Icon: Banknote, dica: 'Diga quanto ela entregou e o troco aparece.' },
  { k: 'pix', r: 'PIX', Icon: QrCode, dica: 'Na chave PIX do salão. Confira o comprovante dela.' },
  { k: 'debito', r: 'Débito', Icon: CreditCard, dica: 'Anote a máquina para bater com o extrato.' },
  { k: 'credito', r: 'Crédito', Icon: CreditCard, dica: 'Parcelas e máquina, se quiser conferir depois.' },
  { k: 'outro', r: 'Outro', Icon: Receipt, dica: 'Vale, cortesia, transferência… descreva.' },
]
const ROTULO = Object.fromEntries(FORMAS.map((f) => [f.k, f.r]))
const NOTAS = [2000, 5000, 10000, 20000]
const reais = (c) => (Number(c ?? 0) / 100).toFixed(2).replace('.', ',')

export default function FecharComanda({ total, sinal = 0, itens = [], cliente, temConta, ocupado, erro, resultado, onCancelar, onConfirmar, onImprimir, onNova }) {
  const [pagamentos, setPagamentos] = useState([])
  const [forma, setForma] = useState(null)          // a forma sendo preenchida
  const [valor, setValor] = useState('')            // centavos digitados, como string
  const [recebido, setRecebido] = useState('')
  const [detalhe, setDetalhe] = useState('')
  const [parcelas, setParcelas] = useState(1)
  const [enviarCupom, setEnviarCupom] = useState(true)
  const [calc, setCalc] = useState(null)             // null | expressão
  const [recebidoFoco, setRecebidoFoco] = useState(false)   // no dinheiro, o teclado escreve o entregue
  const pago = pagamentos.reduce((s, p) => s + p.valor_cents, 0)
  const restante = Math.max(0, total - sinal - pago)
  const valorC = Number(valor || 0), recebidoC = Number(recebido || 0)
  const troco = forma === 'dinheiro' && recebidoC > valorC ? recebidoC - valorC : 0
  const pct = total > 0 ? Math.min(100, Math.round(((sinal + pago) / total) * 100)) : 0

  useEffect(() => { if (forma) { setValor(String(restante)); setRecebido(''); setDetalhe(''); setParcelas(1); setRecebidoFoco(forma === 'dinheiro') } }, [forma]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') { if (calc !== null) setCalc(null); else if (forma) setForma(null); else if (!resultado) onCancelar?.() } }
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k)
  }, [calc, forma, resultado, onCancelar])

  function tecla(t, alvo = 'valor') {
    const set = alvo === 'valor' ? setValor : setRecebido
    set((v) => {
      if (t === 'apaga') return v.slice(0, -1)
      if (t === 'limpa') return ''
      const n = (v + t).replace(/^0+(?=\d)/, '')
      return n.length > 9 ? v : n
    })
  }
  function adicionar() {
    if (!forma || valorC <= 0) return
    if (forma === 'dinheiro' && recebidoC > 0 && recebidoC < valorC) return
    setPagamentos((l) => [...l, { forma, valor_cents: valorC, recebido_cents: forma === 'dinheiro' && recebidoC > 0 ? recebidoC : null, troco_cents: troco, detalhe: detalhe.trim() || null, parcelas: forma === 'credito' ? parcelas : null }])
    setForma(null)
  }
  const tirar = (k) => setPagamentos((l) => l.filter((_, i) => i !== k))
  const podeFechar = total > 0 && restante === 0 && !ocupado
  const trocoTotal = pagamentos.reduce((s, p) => s + (p.troco_cents ?? 0), 0)

  // a calculadora: só os símbolos das teclas, avaliada à mão
  function calcular(expr) {
    try {
      const tokens = expr.replace(/,/g, '.').match(/(\d+\.?\d*|[+×÷-])/g) ?? []
      const out = [], ops = []; const prec = { '+': 1, '-': 1, '×': 2, '÷': 2 }
      const aplica = () => { const b = out.pop(), a = out.pop(), o = ops.pop(); out.push(o === '+' ? a + b : o === '-' ? a - b : o === '×' ? a * b : b === 0 ? NaN : a / b) }
      for (const t of tokens) { if (prec[t]) { while (ops.length && prec[ops[ops.length - 1]] >= prec[t]) aplica(); ops.push(t) } else out.push(Number(t)) }
      while (ops.length) aplica()
      const r = out[0]; return Number.isFinite(r) ? Math.round(r * 100) / 100 : null
    } catch { return null }
  }
  const calcResultado = calc !== null ? calcular(calc) : null

  if (resultado) {
    return (
      <div className="modal-fundo fc-fundo">
        <div className="modal-caixa fc-caixa fc-sucesso" onClick={(e) => e.stopPropagation()}>
          <span className="fc-check"><Check size={34} strokeWidth={3} /></span>
          <h3>Comanda fechada</h3>
          <p className="fc-sucesso-total">{formatCents(total)}</p>
          {trocoTotal > 0 && <p className="fc-troco-aviso"><Banknote size={16} /> Troco para ela: <strong>{formatCents(trocoTotal)}</strong></p>}
          <p className="muted">{resultado.cupom ? 'O comprovante foi para o app dela e para o e-mail.' : temConta ? 'Fechada sem enviar o comprovante.' : 'Cliente sem conta no MIMO: imprima o cupom se ela quiser.'}</p>
          <div className="fc-acoes">
            <button type="button" className="btn btn-ghost" onClick={onImprimir}><Printer size={16} /> Imprimir cupom</button>
            <button type="button" className="btn btn-primary" onClick={onNova} autoFocus><Sparkles size={16} /> Próxima comanda</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-fundo fc-fundo" onClick={() => !ocupado && onCancelar?.()}>
      <div className="modal-caixa fc-caixa" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-fechar" onClick={onCancelar} aria-label="Fechar" disabled={ocupado}><X size={18} /></button>
        <div className="fc-topo">
          <span className="muted">Fechar comanda{cliente ? ` · ${cliente}` : ''}</span>
          <strong className="fc-total">{formatCents(total)}</strong>
          <span className="muted fc-itens">{itens.map((i) => `${i.nome}${(i.qtd ?? 1) > 1 ? ` x${i.qtd}` : ''}`).join(' · ')}</span>
          <div className="fc-barra"><span style={{ width: pct + '%' }} /></div>
          <div className="fc-barra-legenda">
            {sinal > 0 && <span className="fc-pill app"><Smartphone size={12} /> sinal pelo app {formatCents(sinal)}</span>}
            {pagamentos.map((p, k) => <span key={k} className="fc-pill">{ROTULO[p.forma]}{p.parcelas > 1 ? ` ${p.parcelas}x` : ''} {formatCents(p.valor_cents)}<button type="button" onClick={() => tirar(k)} aria-label="Tirar"><Trash2 size={11} /></button></span>)}
            <span className={'fc-pill ' + (restante === 0 ? 'ok' : 'falta')}>{restante === 0 ? <><Check size={12} /> pagamento fechado</> : `falta ${formatCents(restante)}`}</span>
          </div>
        </div>

        {erro && <div className="alert alert-error">{erro}</div>}

        {calc !== null ? (
          <div className="fc-etapa fc-calc">
            <div className="fc-calc-visor"><span className="muted">{calc || '0'}</span><strong>{calcResultado != null ? formatCents(Math.round(calcResultado * 100)) : '—'}</strong></div>
            <div className="fc-teclado">
              {['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '-', '0', ',', 'C', '+'].map((t) => (
                <button key={t} type="button" className={'fc-tecla' + (/[÷×+\-]/.test(t) ? ' op' : t === 'C' ? ' apaga' : '')} onClick={() => setCalc((c) => (t === 'C' ? '' : c + t))}>{t}</button>
              ))}
            </div>
            <div className="fc-acoes">
              <button type="button" className="btn btn-ghost" onClick={() => setCalc(null)}><ChevronLeft size={16} /> Voltar</button>
              {forma && calcResultado != null && <button type="button" className="btn btn-primary" onClick={() => { setValor(String(Math.round(calcResultado * 100))); setCalc(null) }}>Usar como valor</button>}
            </div>
          </div>
        ) : !forma ? (
          <div className="fc-etapa">
            {restante > 0 ? (
              <>
                <p className="fc-pergunta">Como ela paga {pagamentos.length || sinal ? 'o resto' : ''}?</p>
                <div className="fc-formas">
                  {FORMAS.map((f) => (
                    <button key={f.k} type="button" className="fc-forma" onClick={() => setForma(f.k)}>
                      <span className="fc-forma-icone"><f.Icon size={20} /></span>
                      <strong>{f.r}</strong>
                      <small className="muted">{f.dica}</small>
                    </button>
                  ))}
                </div>
                <p className="muted fc-dica">Pode dividir: parte no dinheiro, parte no cartão. Cada parte entra separada no caixa.</p>
              </>
            ) : (
              <div className="fc-resumo">
                <p className="fc-pergunta">Tudo certo. Fechar?</p>
                {temConta ? (
                  <label className="fc-toggle">
                    <input type="checkbox" checked={enviarCupom} onChange={(e) => setEnviarCupom(e.target.checked)} />
                    <span><strong><Mail size={14} /> Enviar o comprovante</strong><small className="muted">Um aviso no app dela com o cupom, e o cupom completo por e-mail.</small></span>
                  </label>
                ) : <p className="muted fc-dica">Cliente sem conta no MIMO: dá para imprimir o cupom logo depois.</p>}
                {trocoTotal > 0 && <p className="fc-troco-aviso"><Banknote size={16} /> Separe o troco: <strong>{formatCents(trocoTotal)}</strong></p>}
              </div>
            )}
            <div className="fc-acoes">
              <button type="button" className="btn btn-ghost" onClick={() => setCalc('')}><Calculator size={16} /> Calculadora</button>
              <button type="button" className="btn btn-primary fc-fechar" disabled={!podeFechar} onClick={() => onConfirmar?.(pagamentos, { enviarCupom: temConta && enviarCupom })}>{ocupado ? 'Fechando…' : `Fechar comanda · ${formatCents(total)}`}</button>
            </div>
          </div>
        ) : (
          <div className="fc-etapa fc-valor">
            <div className="fc-valor-topo">
              <button type="button" className="fc-voltar" onClick={() => setForma(null)} aria-label="Voltar"><ChevronLeft size={18} /></button>
              <strong>{ROTULO[forma]}</strong>
              <button type="button" className="btn-mini btn-mini-neutro" onClick={() => setValor(String(restante))}>valor exato</button>
              <button type="button" className="btn-mini btn-mini-neutro" onClick={() => setCalc('')}><Calculator size={12} /></button>
            </div>
            <div className="fc-visor"><span className="muted">{forma === 'dinheiro' ? 'Valor cobrado' : 'Valor'}</span><strong>R$ {reais(valorC)}</strong></div>
            {forma === 'dinheiro' && (
              <div className="fc-dinheiro">
                <span className="muted">Quanto ela entregou?</span>
                <div className="fc-notas">
                  <button type="button" className={'chip' + (recebidoC === valorC && valorC > 0 ? ' active' : '')} onClick={() => setRecebido(String(valorC))}>exato</button>
                  {NOTAS.filter((n) => n >= valorC).map((n) => <button key={n} type="button" className={'chip' + (recebidoC === n ? ' active' : '')} onClick={() => setRecebido(String(n))}>R$ {n / 100}</button>)}
                </div>
                <div className={'fc-troco' + (troco > 0 ? ' tem' : '')}>{recebidoC > 0 && recebidoC < valorC ? <span className="fc-troco-erro">Entregue menor que o cobrado</span> : troco > 0 ? <><span>Troco</span><strong>{formatCents(troco)}</strong></> : <span className="muted">{recebidoC > 0 ? 'Sem troco' : 'Sem informar, fica sem troco'}</span>}</div>
              </div>
            )}
            {(forma === 'credito' || forma === 'debito') && (
              <div className="fc-cartao">
                {forma === 'credito' && <div className="fc-notas">{[1, 2, 3, 4, 5, 6].map((n) => <button key={n} type="button" className={'chip' + (parcelas === n ? ' active' : '')} onClick={() => setParcelas(n)}>{n}x</button>)}</div>}
                <input value={detalhe} onChange={(e) => setDetalhe(e.target.value)} placeholder="Máquina (Stone, PagBank, Rede…) · opcional" />
              </div>
            )}
            {(forma === 'pix' || forma === 'outro') && <input value={detalhe} onChange={(e) => setDetalhe(e.target.value)} placeholder={forma === 'pix' ? 'Observação (opcional)' : 'Descreva (vale, cortesia, transferência…)'} />}
            <div className="fc-teclado">
              {['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', 'apaga'].map((t) => (
                <button key={t} type="button" className={'fc-tecla' + (t === 'apaga' ? ' apaga' : '')} onClick={() => tecla(t, forma === 'dinheiro' && recebidoFoco ? 'recebido' : 'valor')}>{t === 'apaga' ? '⌫' : t}</button>
              ))}
            </div>
            {forma === 'dinheiro' && <p className="muted fc-dica">O teclado muda o {recebidoFoco ? 'valor entregue' : 'valor cobrado'}. <button type="button" className="link-ver" onClick={() => setRecebidoFoco((v) => !v)}>Mudar o {recebidoFoco ? 'cobrado' : 'entregue'}</button></p>}
            <div className="fc-acoes">
              <button type="button" className="btn btn-ghost" onClick={() => setForma(null)}>Cancelar</button>
              <button type="button" className="btn btn-primary" disabled={valorC <= 0 || (forma === 'dinheiro' && recebidoC > 0 && recebidoC < valorC)} onClick={adicionar}><Plus size={16} /> Adicionar {formatCents(valorC)}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
