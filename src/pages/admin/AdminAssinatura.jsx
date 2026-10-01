import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Check, CreditCard, Receipt, RefreshCw, ShieldCheck, Smartphone, Sparkles, Wrench } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import { QrPix } from '../../components/FormasDePagar'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { reais, PLANOS, precoPara } from '../../lib/planos'
import { REGRAS, dataCurta } from '../../lib/acesso'
import { assinatura, mascaraCartao, mascaraValidade, cartaoValido } from '../../lib/assinatura'

// 2.81: pagamento manual. Nada é recorrente.
// Primeira escolha acontece na ativação; depois, esta tela serve para acompanhar
// o período e renovar 30 dias por Pix ou cartão avulso.
export default function AdminAssinatura() {
  const { salao, acesso, recarregarAcesso } = useAuth()
  const [cobrancas, setCobrancas] = useState([])
  const [modal, setModal] = useState(null) // pix | cartao | analise
  const [pix, setPix] = useState(null)
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)

  const carregar = useCallback(async () => {
    if (!salao?.id) return
    const { data } = await supabase
      .from('cobrancas_mimo')
      .select('id, tipo, periodo_inicio, periodo_fim, total_cents, desconto_cents, metodo, status, vencimento, pago_em, copia_cola, link_url')
      .eq('salon_id', salao.id)
      .order('criado_em', { ascending: false })
      .limit(24)
    setCobrancas(data ?? [])
    const pend = (data ?? []).find((x) => x.status === 'aguardando')
    if (pend?.metodo === 'pix' && pend.copia_cola) setPix(pend)
  }, [salao?.id])

  useEffect(() => { carregar() }, [carregar, acesso?.fase, acesso?.pendente?.status])

  const autonoma = salao?.tipo === 'autonoma'
  const m = acesso?.mensalidade
  const n = Number(m?.agendas ?? salao?.equipe_prevista ?? 1)
  const plano = m
    ? {
        nome: m.plano === 'promais' ? PLANOS.promais.nome : PLANOS.pro.nome,
        plano: m.plano,
        total: m.valor_cents / 100,
        extras: Math.max(0, n - (m.plano === 'promais' ? PLANOS.promais.inclusas : PLANOS.pro.inclusas)),
        valorExtra: m.plano === 'promais' ? PLANOS.promais.extra : PLANOS.pro.extra,
        base: m.plano === 'promais' ? PLANOS.promais.base : PLANOS.pro.base,
      }
    : precoPara(n)

  const fase = acesso?.fase
  const valorCents = Number(m?.valor_cents ?? Math.round(plano.total * 100) ?? 0)
  const ST = { a_criar: 'gerando', aguardando: 'aguardando', pago: 'pago', falhou: 'não passou', cancelado: 'cancelado', expirado: 'venceu' }

  async function rodar(fn) {
    setIndo(true); setErro('')
    try { return await fn() }
    catch (e) { setErro(e?.message || String(e)); return null }
    finally { setIndo(false) }
  }

  async function abrirPix() {
    await rodar(async () => {
      const r = await assinatura('renovar_pix', salao.id)
      setPix(r?.cobranca ?? null)
      setModal('pix')
      await carregar()
    })
  }

  async function pagarCartao(cartao, titular) {
    await rodar(async () => {
      const r = await assinatura('renovar_cartao', salao.id, { cartao, titular })
      if (r?.acesso?.fase === 'ativa') {
        setModal(null)
        await recarregarAcesso?.()
        await carregar()
      } else {
        setModal('analise')
      }
    })
  }

  async function conferir() {
    await rodar(async () => {
      const r = await assinatura('conferir', salao.id)
      await recarregarAcesso?.()
      await carregar()
      if (r?.acesso?.fase === 'ativa' && !r?.acesso?.pendente) setModal(null)
    })
  }

  const situacao = autonoma
    ? { titulo: 'Sua agenda é grátis', texto: 'Autônoma não paga mensalidade na MIMO.' }
    : fase === 'configurando'
      ? { titulo: 'Falta ativar o salão', texto: 'Termine serviços e equipe e escolha como começar. Nada está sendo cobrado.' }
      : fase === 'teste'
        ? (acesso.aguardando_configuracao
          ? { titulo: `Teste grátis: ${acesso.dias} dias, ainda sem contar`, texto: 'O relógio começa quando a agenda estiver pronta (serviços e profissionais). Não existe cartão vinculado nem cobrança automática.' }
          : { titulo: `Teste grátis: ${acesso.dias <= 1 ? 'acaba hoje' : `faltam ${acesso.dias} dias`}`, texto: `Tudo liberado até ${dataCurta(acesso.ate)}. Não existe cartão vinculado nem cobrança automática.` })
        : fase === 'ativa'
          ? { titulo: 'Mensalidade em dia', texto: acesso.sem_prazo ? 'Acesso sem prazo.' : `Seu período vai até ${dataCurta(acesso.ate)}. Não haverá renovação automática.` }
          : fase === 'leitura'
            ? { titulo: 'Período encerrado', texto: `O salão está em modo leitura até ${dataCurta(acesso.tolerancia_ate)}. Renove por Pix ou cartão para voltar a receber agendamentos.` }
            : fase === 'bloqueado'
              ? { titulo: 'Painel pausado', texto: 'Nada foi apagado. Renove uma mensalidade e tudo volta.' }
              : null

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <h2>Plano e mensalidade</h2>
          <p className="muted">Sem fidelidade e sem cobrança automática. Você decide quando renovar.</p>
        </div>
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}

      {situacao && (
        <div className="card assin-situacao calmo">
          <span className="assin-icone">{fase === 'configurando' ? <Wrench size={20} /> : fase === 'teste' ? <Sparkles size={20} /> : <Check size={20} />}</span>
          <div><strong>{situacao.titulo}</strong><span className="muted">{situacao.texto}</span></div>
          {!autonoma && fase === 'configurando' && <Link className="btn btn-primary" to="/admin/configurar">Continuar configuração</Link>}
        </div>
      )}

      {!autonoma && (
        <div className="card assin-plano">
          <div className="assin-plano-topo">
            <div>
              <small className="assin-rotulo">Seu plano hoje</small>
              <strong className="assin-nome">{plano.nome}</strong>
              <span className="muted">{n} {n === 1 ? 'agenda ativa' : 'agendas ativas'} · o preço acompanha a equipe ativa</span>
            </div>
            <b className="assin-preco">{reais(valorCents / 100)}<small> / 30 dias</small></b>
          </div>

          <ul className="assin-lista">
            <li><Check size={13} /> Pagamento avulso, sem recorrência</li>
            <li><Check size={13} /> Pix ou cartão de crédito</li>
            <li><Check size={13} /> Cartão não fica vinculado à MIMO</li>
            <li><Check size={13} /> Você recebe aviso antes do período acabar</li>
            <li><Check size={13} /> Sem fidelidade e sem multa</li>
          </ul>

          {fase !== 'configurando' && (
            <div className="assin-opcoes">
              <button type="button" className="assin-opcao" onClick={abrirPix} disabled={indo}>
                <Smartphone size={16} /><span><b>Renovar por Pix</b><em>{reais(valorCents / 100)} · 30 dias</em><small>QR Code na hora</small></span>
              </button>
              <button type="button" className="assin-opcao" onClick={() => setModal('cartao')} disabled={indo}>
                <CreditCard size={16} /><span><b>Renovar no cartão</b><em>{reais(valorCents / 100)} · 30 dias</em><small>Cobrança única, sem salvar o cartão</small></span>
              </button>
            </div>
          )}

          <p className="muted assin-nota">O desconto de {REGRAS.descontoInicialPct}% é exclusivo da primeira escolha, para quem paga na ativação e abre mão dos {REGRAS.testeDias} dias grátis.</p>
        </div>
      )}

      {!autonoma && cobrancas.length > 0 && (
        <div className="card">
          <h3 className="secao-titulo"><Receipt size={16} /> Pagamentos</h3>
          <ul className="assin-cobrancas">
            {cobrancas.map((c) => (
              <li key={c.id} className={c.status}>
                <div>
                  <strong>{reais(c.total_cents / 100)}</strong>
                  <span className="muted">{dataCurta(c.periodo_inicio)} a {dataCurta(c.periodo_fim)} · {c.metodo === 'cartao' ? 'cartão' : 'Pix'}{c.desconto_cents > 0 ? ` · ${reais(c.desconto_cents / 100)} de desconto` : ''}</span>
                </div>
                <span className={'assin-st ' + c.status}>{ST[c.status] ?? c.status}{c.status === 'pago' && c.pago_em ? ` ${dataCurta(c.pago_em)}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!autonoma && (
        <div className="card">
          <h3 className="secao-titulo"><CalendarClock size={16} /> Como funciona</h3>
          <p className="muted">A MIMO nunca renova sozinha nesta versão. Perto do vencimento, você recebe um aviso e escolhe Pix ou cartão para comprar os próximos 30 dias.</p>
        </div>
      )}

      {modal === 'pix' && (
        <ModalManual titulo="Renovar por Pix" onVoltar={() => setModal(null)}>
          <p className="muted">Pague {reais(Number(pix?.total_cents ?? valorCents) / 100)}. Assim que o Asaas confirmar, o novo período é liberado.</p>
          {pix?.copia_cola ? <QrPix payload={pix.copia_cola} imagem={pix.imagem} /> : <p className="muted">Gerando o Pix…</p>}
          {erro && <div className="alert alert-error">{erro}</div>}
          <button type="button" className="btn btn-primary btn-block" onClick={conferir} disabled={indo || !pix?.copia_cola}><RefreshCw size={14} /> {indo ? 'Conferindo…' : 'Já paguei, conferir'}</button>
          <p className="muted fp-garantia"><ShieldCheck size={13} /> Pagamento único. Nenhum débito automático é criado.</p>
        </ModalManual>
      )}

      {modal === 'cartao' && (
        <ModalManual titulo="Renovar no cartão" onVoltar={() => setModal(null)}>
          <CartaoManual total={valorCents} indo={indo} erro={erro} onEnviar={pagarCartao} />
        </ModalManual>
      )}

      {modal === 'analise' && (
        <ModalManual titulo="Confirmando o cartão" onVoltar={() => setModal(null)}>
          <p className="muted">O pagamento foi enviado ao Asaas e está sendo confirmado. Nenhuma recorrência foi criada.</p>
          {erro && <div className="alert alert-error">{erro}</div>}
          <button type="button" className="btn btn-primary btn-block" onClick={conferir} disabled={indo}>{indo ? 'Conferindo…' : 'Conferir agora'}</button>
        </ModalManual>
      )}
    </AdminShell>
  )
}

function ModalManual({ titulo, onVoltar, children }) {
  return (
    <div className="modal-fundo" onClick={onVoltar}>
      <div className="modal-caixa fp-caixa" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="fp-form">
          <span className="fp-selo"><ShieldCheck size={12} /> Pagamento manual</span>
          <h3>{titulo}</h3>
          {children}
          <button type="button" className="btn btn-ghost btn-block" onClick={onVoltar}>Voltar</button>
        </div>
      </div>
    </div>
  )
}

function CartaoManual({ total, indo, erro, onEnviar }) {
  const [c, setC] = useState({ nome: '', numero: '', validade: '', cvv: '', cep: '', numeroEnd: '' })
  const [mes, ano] = c.validade.split('/')
  const ok = useMemo(() => (
    c.nome.trim().length > 3 &&
    cartaoValido(c.numero) &&
    mes >= '01' && mes <= '12' &&
    (ano ?? '').length === 2 &&
    c.cvv.replace(/\D/g, '').length >= 3 &&
    c.cep.replace(/\D/g, '').length === 8 &&
    c.numeroEnd.trim().length > 0
  ), [c, mes, ano])
  const set = (k) => (e) => setC((x) => ({ ...x, [k]: e.target.value }))

  return (
    <form onSubmit={(e) => {
      e.preventDefault()
      if (!ok) return
      onEnviar(
        { nome: c.nome.trim(), numero: c.numero, mes, ano, cvv: c.cvv },
        { cep: c.cep, numero: c.numeroEnd },
      )
    }} className="fp-form">
      <p className="muted">Cobrança única de <strong>{reais(Number(total || 0) / 100)}</strong>. O cartão não fica vinculado.</p>
      <label>Nome como está no cartão<input value={c.nome} onChange={set('nome')} autoComplete="cc-name" required /></label>
      <label>Número<input value={c.numero} onChange={(e) => setC((x) => ({ ...x, numero: mascaraCartao(e.target.value) }))} inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" required /></label>
      <div className="form-row">
        <label>Validade<input value={c.validade} onChange={(e) => setC((x) => ({ ...x, validade: mascaraValidade(e.target.value) }))} inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA" required /></label>
        <label>CVV<input value={c.cvv} onChange={set('cvv')} inputMode="numeric" autoComplete="cc-csc" maxLength={4} placeholder="123" required /></label>
      </div>
      <div className="form-row">
        <label>CEP da fatura<input value={c.cep} onChange={set('cep')} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" required /></label>
        <label>Número<input value={c.numeroEnd} onChange={set('numeroEnd')} inputMode="numeric" placeholder="120" required /></label>
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}
      <button type="submit" className="btn btn-primary btn-block" disabled={!ok || indo}>{indo ? 'Processando…' : `Pagar ${reais(Number(total || 0) / 100)}`}</button>
      <p className="muted fp-garantia"><ShieldCheck size={13} /> Dados enviados ao Asaas somente para esta cobrança.</p>
    </form>
  )
}
