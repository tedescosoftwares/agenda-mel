import { useEffect, useRef, useState } from 'react'
import { Check, Minus, Plus, UsersRound, X } from 'lucide-react'
import Portal from './Portal'
import LinkSuporte from './LinkSuporte'
import { TelaPix } from './AtivarSalao'
import { supabase } from '../lib/supabase'
import { chamar } from '../lib/pagamento'
import { reais } from '../lib/planos'
import '../checkout-mimo.css'

// 4.10 (migração 265): a equipe não fica presa ao que o salão disse no cadastro. Quando a próxima profissional passa
// das agendas liberadas, a tela pergunta quantas vão entrar e mostra a conta (agendas_do_salao):
//   • no teste grátis (ou antes de pagar): só avisa o novo valor da mensalidade e libera (agendas_liberar);
//   • com o plano pago: um Pix do excedente (a diferença da mensalidade × os meses que faltam do período pago),
//     pelo mesmo caminho das respostas extras (função respostas-extras, tipo 'agendas'); pagou, libera.
export default function AgendasExtras({ salaoId, onFechar, onLiberadas }) {
  const [n, setN] = useState(1)
  const [conta, setConta] = useState(null)
  const [modo, setModo] = useState('conta') // conta | pix | pronto
  const [compra, setCompra] = useState(null)
  const [indo, setIndo] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    supabase.rpc('agendas_do_salao', { salao: salaoId, a_mais: n }).then(({ data, error }) => {
      if (!vivo) return
      if (error) setErro(error.message); else setConta(data)
    })
    return () => { vivo = false }
  }, [salaoId, n])

  const paga = Boolean(conta?.paga)
  const meses = Number(conta?.meses ?? 1)
  const porMes = Number(conta?.por_mes_cents ?? 0) / 100
  const agora = Number(conta?.agora_cents ?? 0) / 100

  async function liberar() {
    setIndo(true); setErro('')
    try {
      if (!paga) {
        const { error } = await supabase.rpc('agendas_liberar', { salao: salaoId, a_mais: n })
        if (error) throw new Error(error.message)
        onLiberadas?.(n)
        return
      }
      const r = await chamar('respostas-extras', { tipo: 'agendas', acao: 'pix', salao: salaoId, agendas: n })
      setCompra(r?.compra ?? null)
      setModo(r?.compra?.status === 'pago' ? 'pronto' : 'pix')
    } catch (e) { setErro(e?.message || String(e)) } finally { setIndo(false) }
  }

  async function conferir(manual = true) {
    if (!compra?.id || (manual && indo)) return
    if (manual) { setIndo(true); setErro('') }
    try {
      const r = await chamar('respostas-extras', { tipo: 'agendas', acao: 'conferir', salao: salaoId, compra: compra.id, manual })
      if (r?.compra?.status === 'pago') { setCompra((c) => ({ ...(c ?? {}), ...r.compra })); setModo('pronto') }
      else if (manual) setErro('Ainda não chegou. O Pix costuma cair em segundos; se você já pagou, espere um pouquinho que a tela confere sozinha.')
    } catch (e) { if (manual) setErro(e?.message || String(e)) } finally { if (manual) setIndo(false) }
  }
  const conferirAgora = useRef(null)
  useEffect(() => { conferirAgora.current = conferir })
  useEffect(() => {
    if (modo !== 'pix') return
    const t = setInterval(() => conferirAgora.current?.(false), 5000)
    return () => clearInterval(t)
  }, [modo])

  const quantas = compra?.agendas ?? n
  if (modo !== 'conta') {
    return (
      <Portal><div className="ai-fundo ck-fundo pk-fundo" role="dialog" aria-modal="true" aria-label="Agendas a mais no plano">
        <div className="ck pk-janela">
          <header className="pk-topo">
            <strong>Agendas a mais no plano</strong>
            <button type="button" className="pk-fechar" aria-label="Fechar" onClick={onFechar}><X size={18} /></button>
          </header>
          {modo === 'pix' ? (
            <TelaPix pix={compra} total={Number(compra?.valor_cents ?? 0)} descontoPct={0}
              rotulo={`${quantas} ${quantas === 1 ? 'agenda a mais' : 'agendas a mais'}${Number(compra?.meses ?? 1) > 1 ? ` · ${compra.meses} meses` : ''}`}
              voltarTexto="Voltar" statusTexto="A tela confere sozinha. Pagou, as agendas são liberadas."
              indo={indo} erro={erro} onConferir={() => conferir(true)} onVoltar={() => { setErro(''); setModo('conta') }} />
          ) : (
            <section className="pk-pronto">
              <span className="ok"><Check size={32} /></span>
              <span className="ck-kicker">Pagamento confirmado</span>
              <h2>Pronto! +{quantas} {quantas === 1 ? 'agenda' : 'agendas'}</h2>
              <p>Seu salão agora tem {compra?.liberadas ?? ''} agendas liberadas. É só seguir com o cadastro.</p>
              <button type="button" className="ck-botao ck-botao-pix" onClick={() => onLiberadas?.(quantas)}>Cadastrar profissional</button>
            </section>
          )}
          <LinkSuporte className="agx-suporte">Deu algum problema? Fale com o suporte</LinkSuporte>
        </div>
      </div></Portal>
    )
  }

  return (
    <Portal><div className="modal-fundo" onClick={onFechar}>
      <div className="card modal-caixa agx" role="dialog" aria-modal="true" aria-labelledby="agx-titulo" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">×</button>
        <span className="agx-selo"><UsersRound size={14} /> Sua equipe cresceu</span>
        <h3 id="agx-titulo">Vai cadastrar mais de uma profissional?</h3>
        <p className="muted">{conta ? `Seu plano cobre ${conta.liberadas} profissionais com agenda e você já tem ${conta.ativas}. Diga quantas vão entrar agora.` : 'Conferindo o seu plano…'}</p>

        <div className="agx-contador">
          <button type="button" onClick={() => setN(Math.max(1, n - 1))} aria-label="Diminuir" disabled={n <= 1 || indo}><Minus size={17} /></button>
          <strong>{n}</strong>
          <button type="button" onClick={() => setN(Math.min(50, n + 1))} aria-label="Aumentar" disabled={indo}><Plus size={17} /></button>
          <span>{n === 1 ? 'profissional a mais' : 'profissionais a mais'}</span>
        </div>

        {conta && (
          <div className="agx-conta">
            <div><span>{n} {n === 1 ? 'agenda a mais' : 'agendas a mais'}, por mês</span><b>{reais(porMes)}</b></div>
            {paga && meses > 1 && <div><span>× {meses} meses que faltam do seu plano</span><b>{reais(agora)}</b></div>}
            <div className="agx-total"><span>Sua mensalidade passa de {reais(conta.mensalidade_antes_cents / 100)} para</span><b>{reais(conta.mensalidade_depois_cents / 100)}</b></div>
          </div>
        )}

        {conta && (paga
          ? <p className="agx-nota">Você paga <strong>{reais(agora)}</strong> por Pix agora{meses > 1 ? `, pelos ${meses} meses que faltam do período que você já pagou` : ', referente a este mês'}. Na próxima renovação, o valor já vem junto.</p>
          : <p className="agx-nota">Você ainda não paga nada: <strong>as agendas entram agora</strong> e o valor novo vale a partir da primeira mensalidade.</p>)}

        {erro && <div className="alert alert-error">{erro}</div>}
        <button type="button" className="btn btn-primary btn-block" disabled={indo || !conta} onClick={liberar}>
          {indo ? 'Um instante…' : !conta ? 'Conferindo…' : paga ? `Gerar Pix de ${reais(agora)}` : `Liberar ${n === 1 ? 'a agenda' : `as ${n} agendas`}`}
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={onFechar}>Agora não</button>
        <LinkSuporte className="agx-suporte">Deu algum problema? Fale com o suporte</LinkSuporte>
      </div>
    </div></Portal>
  )
}
