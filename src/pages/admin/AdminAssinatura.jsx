import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Check, Receipt, RefreshCw, ShieldCheck, Smartphone, Sparkles, Wrench } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import { QrPix } from '../../components/FormasDePagar'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { reais, PLANOS, precoPara } from '../../lib/planos'
import { REGRAS, dataCurta } from '../../lib/acesso'
import { assinatura, mascaraCartao, mascaraValidade, cartaoValido } from '../../lib/assinatura'

// 2.81: pagamento manual. Nada é recorrente.
// 3.94: planos mensal, semestral (10% OFF) e anual (15% OFF). Uma cobrança aberta por vez: a próxima mensalidade
// aparece sozinha uns dias antes do fim do período, vencendo no último dia (o "dia X" da contratação); se não for
// paga até 3 dias depois, é cancelada (no Asaas também). No teste, "pagar agora e já ativar": o salão fica ativo na
// hora e o plano começa quando o teste acabaria. Trocar de plano cancela o Pix anterior.
export default function AdminAssinatura() {
  const { salao, acesso, recarregarAcesso } = useAuth()
  const [cobrancas, setCobrancas] = useState([])
  const [planos, setPlanos] = useState(null)
  const [escolhido, setEscolhido] = useState(null)   // meses do plano escolhido (null = ainda não mexeu)
  const [modal, setModal] = useState(null) // pix | cartao | analise
  const [pix, setPix] = useState(null)
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)

  const carregar = useCallback(async () => {
    if (!salao?.id) return
    const [lista, pl] = await Promise.all([
      supabase
        .from('cobrancas_mimo')
        .select('id, tipo, periodo_inicio, periodo_fim, total_cents, desconto_cents, metodo, status, vencimento, pago_em, copia_cola, link_url, meses, cancelar_em, inicio_no_pagamento')
        .eq('salon_id', salao.id)
        .order('criado_em', { ascending: false })
        .limit(24),
      supabase.rpc('planos_do_salao', { salao: salao.id }),
    ])
    setCobrancas(lista.data ?? [])
    setPlanos(pl.data?.planos ?? null)
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
  const ST = { a_criar: 'gerando', aguardando: 'aguardando', pago: 'pago', falhou: 'não passou', cancelado: 'cancelado', expirado: 'cancelado' }
  const NOME = { 1: 'Mensal', 6: 'Semestral', 12: 'Anual' }

  // a cobrança aberta (uma por vez) e o plano que aparece marcado
  const aberta = cobrancas.find((c) => c.status === 'aguardando' || c.status === 'a_criar') ?? null
  const meses = escolhido ?? aberta?.meses ?? 1
  const lista = planos ?? [1, 6, 12].map((x) => ({ meses: x, nome: NOME[x], desconto_pct: x === 12 ? 15 : x === 6 ? 10 : 0, total_cents: Math.floor((valorCents * x * (100 - (x === 12 ? 15 : x === 6 ? 10 : 0))) / 100), sem_desconto_cents: valorCents * x }))
  const atual = lista.find((p) => p.meses === meses) ?? lista[0]
  const abertaDesteplano = aberta && aberta.meses === meses && aberta.total_cents === atual?.total_cents

  // quando o plano novo começa (o "dia X")
  const noTeste = fase === 'teste'
  const comecaEm = (fase === 'teste' && !acesso?.aguardando_configuracao && acesso?.ate) || (fase === 'ativa' && !acesso?.sem_prazo && acesso?.ate) || null
  const chamada = noTeste ? 'Pagar agora e já ativar' : fase === 'ativa' ? 'Próxima mensalidade' : 'Renovar agora'
  const explica = noTeste
    ? (comecaEm ? `O salão fica ativo na hora e seus dias grátis continuam: o plano começa em ${dataCurta(comecaEm)}, quando o teste acabaria.` : 'O salão fica ativo na hora e o plano começa no dia do pagamento.')
    : fase === 'ativa'
      ? (comecaEm ? `O Pix vence em ${dataCurta(comecaEm)}, o último dia do seu período. Pagando antes, nada se perde: o novo período começa nesse dia.` : 'Seu acesso não tem prazo.')
      : 'O Pix vale 3 dias e o período começa no dia do pagamento.'

  async function rodar(fn) {
    setIndo(true); setErro('')
    try { return await fn() }
    catch (e) { setErro(e?.message || String(e)); return null }
    finally { setIndo(false) }
  }

  // abre o Pix do plano escolhido: se já existe (mesmo plano), é o mesmo; outro plano cancela o anterior
  async function abrirPix() {
    await rodar(async () => {
      const r = await assinatura('renovar_pix', salao.id, { meses })
      setPix(r?.cobranca ?? null)
      setModal('pix')
      await recarregarAcesso?.()
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
          ? { titulo: 'Mensalidade em dia', texto: acesso.sem_prazo ? 'Acesso sem prazo.' : `Seu período vai até ${dataCurta(acesso.ate)}. Nada é debitado sozinho.` }
          : fase === 'leitura'
            ? { titulo: 'Período encerrado', texto: `O salão está em modo leitura até ${dataCurta(acesso.tolerancia_ate)}. Pague o Pix para voltar a receber agendamentos.` }
            : fase === 'bloqueado'
              ? { titulo: 'Painel pausado', texto: 'Nada foi apagado. Pague uma mensalidade e tudo volta.' }
              : null

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <h2>Plano e mensalidade</h2>
          <p className="muted">Sem fidelidade e sem débito automático. Mensal, semestral ou anual, por Pix.</p>
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

      {!autonoma && aberta && (
        <div className="card assin-aberta">
          <span className="assin-aberta-icone"><Smartphone size={18} /></span>
          <div className="assin-aberta-texto">
            <small className="assin-rotulo">Pix em aberto · {NOME[aberta.meses] ?? 'Mensal'}</small>
            <strong>{reais(aberta.total_cents / 100)}<span> · vence {dataCurta(aberta.vencimento)}</span></strong>
            <span className="muted">{aberta.cancelar_em ? `Se não for pago até ${dataCurta(aberta.cancelar_em)}, ele é cancelado (sem multa) e você gera outro quando quiser.` : 'Assim que o Asaas confirmar, o período é liberado.'}</span>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => { setEscolhido(aberta.meses); abrirPixDe(aberta.meses) }} disabled={indo}>Ver o Pix</button>
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
            <b className="assin-preco">{reais(valorCents / 100)}<small> / mês</small></b>
          </div>

          {fase !== 'configurando' && (
            <>
              <h3 className="assin-chamada">{chamada}</h3>
              <p className="muted assin-explica">{explica}</p>
              <div className="assin-planos" role="radiogroup" aria-label="Escolha o plano">
                {lista.map((p) => (
                  <button key={p.meses} type="button" role="radio" aria-checked={p.meses === meses}
                    className={'assin-plano-op' + (p.meses === meses ? ' ativo' : '')} onClick={() => setEscolhido(p.meses)}>
                    {p.desconto_pct > 0 && <span className="assin-plano-selo">{p.desconto_pct}% OFF</span>}
                    <span className="assin-plano-nome">{p.nome}</span>
                    <strong>{reais(p.total_cents / 100)}</strong>
                    <small>{p.meses === 1 ? 'por mês' : `${reais(Math.floor(p.total_cents / p.meses) / 100)}/mês · ${p.meses} meses`}</small>
                    {p.desconto_pct > 0 && <em>economiza {reais((p.sem_desconto_cents - p.total_cents) / 100)}</em>}
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-primary btn-block assin-pagar" onClick={abrirPix} disabled={indo || !atual}>
                <Smartphone size={16} /> {indo ? 'Gerando o Pix…' : abertaDesteplano ? `Ver o Pix de ${reais(atual.total_cents / 100)}` : `Pagar ${reais((atual?.total_cents ?? 0) / 100)} com Pix`}
              </button>
              {aberta && !abertaDesteplano && <p className="muted assin-nota">Gerar o Pix deste plano cancela o Pix em aberto ({NOME[aberta.meses] ?? 'Mensal'}).</p>}
            </>
          )}

          <ul className="assin-lista">
            <li><Check size={13} /> Pagamento por Pix, pelo Asaas</li>
            <li><Check size={13} /> Sem cartão e sem débito automático</li>
            <li><Check size={13} /> Uma cobrança por vez, vencendo no fim do seu período</li>
            <li><Check size={13} /> Aviso antes do período acabar</li>
            <li><Check size={13} /> Sem fidelidade e sem multa</li>
          </ul>
        </div>
      )}

      {!autonoma && cobrancas.length > 0 && (
        <div className="card">
          <h3 className="secao-titulo"><Receipt size={16} /> Pagamentos</h3>
          <ul className="assin-cobrancas">
            {cobrancas.map((c) => (
              <li key={c.id} className={c.status}>
                <div>
                  <strong>{reais(c.total_cents / 100)}{c.meses > 1 ? ` · ${NOME[c.meses]}` : ''}</strong>
                  <span className="muted">{c.inicio_no_pagamento && c.status !== 'pago' ? 'começa no dia do pagamento' : `${dataCurta(c.periodo_inicio)} a ${dataCurta(c.periodo_fim)}`} · {c.metodo === 'cartao' ? 'cartão' : 'Pix'}{c.desconto_cents > 0 ? ` · ${reais(c.desconto_cents / 100)} de desconto` : ''}{['aguardando', 'a_criar'].includes(c.status) ? ` · vence ${dataCurta(c.vencimento)}` : ''}</span>
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
          <p className="muted">A MIMO nunca debita sozinha. Uns dias antes do fim do seu período, o Pix da próxima mensalidade aparece aqui, vencendo no último dia, e você recebe um aviso. Se ele não for pago até 3 dias depois, é cancelado, sem multa, e você gera outro quando quiser. Só existe um Pix em aberto por vez.</p>
          <p className="muted">O desconto de {REGRAS.descontoInicialPct}% é da primeira mensalidade, para quem paga na ativação. Os planos semestral (10%) e anual (15%) valem sempre.</p>
        </div>
      )}

      {modal === 'pix' && (
        <ModalManual titulo={`Pix · ${NOME[pix?.meses ?? meses] ?? 'Mensal'}`} onVoltar={() => setModal(null)}>
          <p className="muted">Pague {reais(Number(pix?.total_cents ?? atual?.total_cents ?? valorCents) / 100)}{pix?.vencimento ? ` até ${dataCurta(pix.vencimento)}` : ''}. Assim que o Asaas confirmar, o período é liberado.</p>
          {pix?.copia_cola ? <QrPix payload={pix.copia_cola} imagem={pix.imagem} /> : <p className="muted">Gerando o Pix…</p>}
          {erro && <div className="alert alert-error">{erro}</div>}
          <button type="button" className="btn btn-primary btn-block" onClick={conferir} disabled={indo || !pix?.copia_cola}><RefreshCw size={14} /> {indo ? 'Conferindo…' : 'Já paguei, conferir'}</button>
          <p className="muted fp-garantia"><ShieldCheck size={13} /> Pagamento único. Nenhum débito automático é criado.{pix?.cancelar_em ? ` Não pago até ${dataCurta(pix.cancelar_em)}, é cancelado.` : ''}</p>
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

  // o "Ver o Pix" do cartão do topo: o plano da cobrança aberta (não o marcado embaixo)
  function abrirPixDe(mesesDela) {
    rodar(async () => {
      const r = await assinatura('renovar_pix', salao.id, { meses: mesesDela })
      setPix(r?.cobranca ?? null)
      setModal('pix')
      await carregar()
    })
  }
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
