import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { X, CreditCard, Copy, Check, ShieldCheck, Smartphone, RefreshCw, Receipt } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { isDemo } from '../lib/supabase'
import { reais } from '../lib/planos'
import { REGRAS, dataCurta } from '../lib/acesso'
import { METODOS, assinatura, mascaraCartao, mascaraValidade, cartaoValido, autorizado } from '../lib/assinatura'

// O modal de pagar a MIMO (128). `modo`:
//   'escolher'        a lista das três formas, pra trocar
//   'cartao'          vincula o cartão (cobrarAgora: paga o primeiro mês já)
//   'pix_automatico'  abre o primeiro mês (30 + 7 de bônus, 10% off): o QR paga esse mês e
//                     autoriza os próximos no banco (jornada 3 da Asaas)
//   'pix_avista'      abre o Pix do primeiro mês e mostra o copia e cola
// `valores` = mensalidade_do_salao; `acesso` = acesso_do_salao. Ao terminar,
// chama onFeito(acesso novo).
export default function FormasDePagar({ salao, modo: modoInicial, cobrarAgora: cobrarInicial = false, valores, acesso, onFechar, onFeito, permitirAvista = true }) {
  const { recarregarAcesso } = useAuth()
  const [modo, setModo] = useState(modoInicial)
  const [cobrarAgora, setCobrarAgora] = useState(cobrarInicial)
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)
  const [resultado, setResultado] = useState(null)   // o que a função devolveu
  const total = Number(valores?.total_cents ?? 0)
  const cheio = Number(valores?.valor_cents ?? total)
  const comDescontoPix = Math.floor((cheio * (100 - REGRAS.descontoPixAutomaticoPct)) / 100 / 10) * 10
  const bonus = acesso?.bonus_usado ? 0 : REGRAS.bonusDias
  const cobrarEm = acesso?.cobrar_em ?? acesso?.ate
  async function terminar(r) { setResultado(r); await recarregarAcesso?.(); }
  async function rodar(fn) { setIndo(true); setErro(''); try { await fn() } catch (e) { setErro(e.message) } finally { setIndo(false) } }
  const fechar = () => { onFechar?.() }
  const concluir = (r) => { onFeito?.(r?.acesso ?? null); onFechar?.() }

  return (
    <div className="modal-fundo" onClick={fechar}>
      <div className="modal-caixa fp-caixa" role="dialog" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-fechar" onClick={fechar} aria-label="Fechar"><X size={18} /></button>

        {modo === 'escolher' && (
          <div className="fp-form">
            <span className="fp-selo"><CreditCard size={12} /> Forma de pagamento</span>
            <h3>Como você prefere pagar?</h3>
            <p className="muted fp-explica">{acesso?.metodo && !acesso.cancelada ? `Hoje: ${acesso.metodo === 'cartao' ? `cartão final ${acesso.cartao_final}` : acesso.metodo === 'pix_automatico' ? 'Pix Automático' : 'Pix à vista'}. Escolha outra e a anterior deixa de valer.` : 'Escolha uma. Dá pra trocar quando quiser.'}</p>
            <div className="fp-escolhas">
              <button type="button" className="assin-opcao" onClick={() => { setCobrarAgora(true); setModo('pix_automatico') }}>
                <Smartphone size={16} /><span><b>Pix Automático</b><em>{reais(comDescontoPix / 100)} agora{bonus ? ` · ${REGRAS.periodoDias + bonus} dias` : ''} · {REGRAS.descontoPixAutomaticoPct}% off todo mês</em><small>Paga o primeiro mês pelo QR e autoriza os próximos no banco; depois cai sozinho.</small></span>
              </button>
              <button type="button" className="assin-opcao" onClick={() => { setCobrarAgora(permitirAvista && acesso?.fase !== 'ativa'); setModo('cartao') }}>
                <CreditCard size={16} /><span><b>Cartão de crédito</b><em>{reais(cheio / 100)}/mês</em><small>Cobrado todo mês no cartão. O número não fica guardado na MIMO.</small></span>
              </button>
              {permitirAvista && (
                <button type="button" className="assin-opcao" onClick={() => { setCobrarAgora(true); setModo('pix_avista') }}>
                  <Receipt size={16} /><span><b>Pix à vista</b><em>{reais(cheio / 100)} agora{bonus ? ` · ${REGRAS.periodoDias + bonus} dias` : ''}</em><small>Paga pelo QR Code hoje. Todo mês a gente manda o Pix do mês seguinte.</small></span>
                </button>
              )}
            </div>
          </div>
        )}

        {modo === 'cartao' && !resultado && (
          <Cartao salao={salao} cobrarAgora={cobrarAgora} total={total} bonus={bonus} cobrarEm={cobrarEm} indo={indo} erro={erro}
            onEnviar={(cartao, titular) => rodar(async () => terminar(await assinatura('cartao', salao, { cartao, titular, cobrar_agora: cobrarAgora })))} />
        )}
        {modo === 'cartao' && resultado && (
          <Pronto titulo={cobrarAgora ? 'Pago e ativo' : 'Cartão vinculado'} onOk={() => concluir(resultado)}>
            {cobrarAgora
              ? <>Cobramos {reais(total / 100)} no cartão final {resultado.cartao?.final}. Seu salão está ativo até {dataCurta(resultado.acesso?.ate)}: 30 dias{bonus ? ` + ${bonus} de bônus` : ''}.</>
              : <>Cartão final {resultado.cartao?.final} guardado. Nada foi cobrado hoje: no dia {dataCurta(cobrarEm)} cobramos {reais(total / 100)} e nada para. Pra não cobrar, cancele antes em Plano e assinatura.</>}
          </Pronto>
        )}

        {modo === 'pix_automatico' && (
          <PixAutomatico salao={salao} total={comDescontoPix} cheio={cheio} bonus={bonus} indo={indo} erro={erro} resultado={resultado} acesso={acesso}
            onCriar={() => rodar(async () => terminar(await assinatura('pix_automatico', salao)))}
            onConferir={(como) => rodar(async () => { const r = await assinatura(como === 'simular' ? 'simular' : 'conferir', salao); setResultado((x) => ({ ...(x ?? {}), acesso: r.acesso, pago: r.acesso?.fase === 'ativa' && r.acesso?.metodo === 'pix_automatico' && !r.acesso?.pendente, autorizacao: { ...(x?.autorizacao ?? {}), status: r.acesso?.autorizacao_status } })); await recarregarAcesso?.() })}
            onOk={() => concluir(resultado)} />
        )}

        {modo === 'pix_avista' && (
          <PixAvista salao={salao} total={total} bonus={bonus} indo={indo} erro={erro} resultado={resultado}
            onCriar={() => rodar(async () => terminar(await assinatura('pix_avista', salao)))}
            onConferir={() => rodar(async () => { const r = await assinatura('conferir', salao); setResultado((x) => ({ ...(x ?? {}), acesso: r.acesso, pago: r.acesso?.fase === 'ativa' && !r.acesso?.pendente })); await recarregarAcesso?.() })}
            onSimular={() => rodar(async () => { const r = await assinatura('simular', salao); setResultado((x) => ({ ...(x ?? {}), acesso: r.acesso, pago: true })); await recarregarAcesso?.() })}
            onOk={() => concluir(resultado)} />
        )}
      </div>
    </div>
  )
}

function Pronto({ titulo, children, onOk }) {
  return (
    <div className="fp-pronto">
      <span className="fp-pronto-icone"><Check size={22} /></span>
      <h3>{titulo}</h3>
      <p className="muted">{children}</p>
      <button type="button" className="btn btn-primary btn-block" onClick={onOk}>Continuar</button>
    </div>
  )
}

function Cartao({ cobrarAgora, total, bonus, cobrarEm, indo, erro, onEnviar }) {
  const [c, setC] = useState({ nome: '', numero: '', validade: '', cvv: '', cep: '', numeroEnd: '' })
  const set = (k) => (e) => setC((x) => ({ ...x, [k]: e.target.value }))
  const [mes, ano] = c.validade.split('/')
  const ok = c.nome.trim().length > 3 && cartaoValido(c.numero) && mes >= '01' && mes <= '12' && (ano ?? '').length === 2 && c.cvv.replace(/\D/g, '').length >= 3
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ok) onEnviar({ nome: c.nome.trim(), numero: c.numero, mes, ano, cvv: c.cvv }, { cep: c.cep, numero: c.numeroEnd }) }} className="fp-form">
      <span className="fp-selo"><CreditCard size={12} /> Cartão de crédito</span>
      <h3>{cobrarAgora ? `Pagar ${reais(total / 100)} agora` : 'Vincular o cartão'}</h3>
      <p className="muted fp-explica">
        {cobrarAgora
          ? <>Cobramos hoje e seu salão fica ativo por 30 dias{bonus ? <> <strong>+ {bonus} de bônus</strong></> : null}. Depois, todo mês no mesmo cartão.</>
          : <>Nada é cobrado hoje. <strong>No dia {dataCurta(cobrarEm)} cobramos {reais(total / 100)}</strong> e seu salão segue sem pausa. Cancela antes, não paga nada.</>}
      </p>
      <label>Nome como está no cartão<input value={c.nome} onChange={set('nome')} autoComplete="cc-name" required /></label>
      <label>Número<input value={c.numero} onChange={(e) => setC((x) => ({ ...x, numero: mascaraCartao(e.target.value) }))} inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" required /></label>
      <div className="form-row">
        <label>Validade<input value={c.validade} onChange={(e) => setC((x) => ({ ...x, validade: mascaraValidade(e.target.value) }))} inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA" required /></label>
        <label>CVV<input value={c.cvv} onChange={set('cvv')} inputMode="numeric" autoComplete="cc-csc" maxLength={4} placeholder="123" required /></label>
      </div>
      <div className="form-row">
        <label>CEP da fatura<input value={c.cep} onChange={set('cep')} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" /></label>
        <label>Número<input value={c.numeroEnd} onChange={set('numeroEnd')} inputMode="numeric" placeholder="120" /></label>
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}
      <button type="submit" className="btn btn-primary btn-block" disabled={!ok || indo}>{indo ? 'Enviando…' : cobrarAgora ? `Pagar ${reais(total / 100)}` : 'Vincular cartão'}</button>
      <p className="muted fp-garantia"><ShieldCheck size={13} /> O número vai direto pro Asaas e não fica guardado na MIMO: só os 4 últimos dígitos.</p>
    </form>
  )
}

function PixAutomatico({ total, cheio, bonus, indo, erro, resultado, acesso, onCriar, onConferir, onOk }) {
  const aut = resultado?.autorizacao ?? (acesso?.autorizacao_qr && acesso?.metodo === 'pix_automatico' ? { copiaCola: acesso.autorizacao_qr, imagem: acesso.autorizacao_imagem, status: acesso.autorizacao_status } : null)
  const valor = Number(resultado?.cobranca?.total_cents ?? acesso?.pendente?.total_cents ?? total)
  const ok = autorizado({ autorizacao_status: aut?.status }) || resultado?.pago
  const criou = useRef(false)
  useEffect(() => { if (!aut && !criou.current) { criou.current = true; onCriar() } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (ok) {
    return (
      <Pronto titulo="Pago e ativo, com Pix Automático" onOk={onOk}>
        Recebemos {reais(valor / 100)}. Seu salão está ativo até {dataCurta(resultado?.acesso?.ate ?? acesso?.ate)}: 30 dias{bonus ? ` + ${bonus} de bônus` : ''}. Os próximos meses caem sozinhos no seu banco, com {REGRAS.descontoPixAutomaticoPct}% de desconto, e a gente avisa antes de cada um.
      </Pronto>
    )
  }
  return (
    <div className="fp-form">
      <span className="fp-selo"><Smartphone size={12} /> Pix Automático · {REGRAS.descontoPixAutomaticoPct}% de desconto</span>
      <h3>Pagar {reais(valor / 100)} e autorizar os próximos</h3>
      <p className="muted fp-explica">Este QR paga o primeiro mês <strong>{reais(valor / 100)}</strong> <s>{reais(cheio / 100)}</s> e, no mesmo passo, autoriza os próximos no app do seu banco. Seu salão fica ativo por 30 dias{bonus ? <> <strong>+ {bonus} de bônus</strong></> : null}; depois, o débito cai sozinho todo mês.</p>
      {!aut && !erro && <p className="muted">Gerando o QR Code…</p>}
      {aut && <QrPix payload={aut.copiaCola} imagem={aut.imagem} />}
      {aut && (
        <ol className="fp-passos">
          <li>Abra o app do seu banco e leia o QR (ou cole o código em Pix › Pagar).</li>
          <li>Confira o valor de hoje e a autorização mensal, e confirme.</li>
          <li>Volte aqui e toque em "Já paguei".</li>
        </ol>
      )}
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="fp-acoes">
        {aut && <button type="button" className="btn btn-primary btn-block" onClick={onConferir} disabled={indo}><RefreshCw size={14} /> {indo ? 'Conferindo…' : 'Já paguei'}</button>}
        {aut && (isDemo || acesso?.sandbox !== false) && <button type="button" className="btn btn-ghost btn-mini" onClick={() => onConferir('simular')} disabled={indo}>Simular pagamento (sandbox)</button>}
        {!aut && erro && <button type="button" className="btn btn-primary btn-block" onClick={onCriar} disabled={indo}>Tentar de novo</button>}
        {aut && <button type="button" className="btn btn-ghost btn-block" onClick={onOk}>Pago depois</button>}
      </div>
      {aut && <p className="muted fp-garantia">O QR vale por 3 dias e fica em Plano e assinatura. Enquanto isso o teste continua normal. Nada é cobrado sem você confirmar no banco.</p>}
    </div>
  )
}

function PixAvista({ total, bonus, indo, erro, resultado, onCriar, onConferir, onSimular, onOk }) {
  const cob = resultado?.cobranca
  const criou = useRef(false)
  useEffect(() => { if (!cob && !criou.current) { criou.current = true; onCriar() } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (resultado?.pago) {
    return <Pronto titulo="Pago e ativo" onOk={onOk}>Recebemos {reais(total / 100)}. Seu salão está ativo até {dataCurta(resultado.acesso?.ate)}: 30 dias{bonus ? ` + ${bonus} de bônus` : ''}. Todo mês a gente manda o Pix do mês seguinte.</Pronto>
  }
  return (
    <div className="fp-form">
      <span className="fp-selo"><Smartphone size={12} /> Pix à vista</span>
      <h3>Pagar {reais(total / 100)} agora</h3>
      <p className="muted fp-explica">Paga hoje e seu salão fica ativo por 30 dias{bonus ? <> <strong>+ {bonus} de bônus</strong></> : null}. Sem recorrência: todo mês a gente manda o Pix do mês seguinte.</p>
      {!cob && !erro && <p className="muted">Gerando o Pix…</p>}
      {cob?.copia_cola && <QrPix payload={cob.copia_cola} imagem={cob.imagem} />}
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="fp-acoes">
        {cob && <button type="button" className="btn btn-primary btn-block" onClick={onConferir} disabled={indo}><RefreshCw size={14} /> {indo ? 'Conferindo…' : 'Já paguei'}</button>}
        {cob && (cob.sandbox || isDemo) && <button type="button" className="btn btn-ghost btn-mini" onClick={onSimular} disabled={indo}>Simular pagamento (sandbox)</button>}
        {!cob && erro && <button type="button" className="btn btn-primary btn-block" onClick={onCriar} disabled={indo}>Tentar de novo</button>}
        {cob && <button type="button" className="btn btn-ghost btn-block" onClick={onOk}>Pago depois</button>}
      </div>
      {cob && <p className="muted fp-garantia">O Pix fica em Plano e assinatura até cair. Enquanto isso o teste continua normal.</p>}
    </div>
  )
}

export function QrPix({ payload, imagem }) {
  const ref = useRef(null)
  const [copiado, setCopiado] = useState(false)
  useEffect(() => { if (ref.current && payload && !imagem) QRCode.toCanvas(ref.current, payload, { width: 180, margin: 1, color: { dark: '#1f2026', light: '#ffffff' } }).catch(() => {}) }, [payload, imagem])
  function copiar() { navigator.clipboard?.writeText(payload); setCopiado(true); setTimeout(() => setCopiado(false), 2000) }
  if (!payload) return null
  return (
    <div className="fp-qr">
      {imagem ? <img src={`data:image/png;base64,${imagem}`} alt="QR Code" width={180} height={180} /> : <canvas ref={ref} width={180} height={180} />}
      <div className="fp-copia">
        <input readOnly value={payload} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-ghost btn-mini" onClick={copiar}>{copiado ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar</>}</button>
      </div>
    </div>
  )
}
