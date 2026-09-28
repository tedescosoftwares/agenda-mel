import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, BookOpen, PauseCircle, Check, CalendarClock, Wrench, Heart, CreditCard, Smartphone, Receipt } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import FormasDePagar, { QrPix } from '../../components/FormasDePagar'
import { useAuth } from '../../context/AuthContext'
import { useDialogo } from '../../context/DialogoContext'
import { supabase } from '../../lib/supabase'
import { reais, PLANOS, precoPara } from '../../lib/planos'
import { LINHA_DO_TESTE, REGRAS, dataCurta } from '../../lib/acesso'
import { METODOS, assinatura, rotuloDoMetodo, autorizado, comDesconto } from '../../lib/assinatura'

// Plano e assinatura (126 + 128): em que pé o acesso está, quanto custa,
// como pagar (vincular, trocar, cancelar), o Pix pendente e o histórico.
export default function AdminAssinatura() {
  const { salao, acesso, recarregarAcesso } = useAuth()
  const { confirmar } = useDialogo()
  const [cobrancas, setCobrancas] = useState([])
  const [modal, setModal] = useState(null)
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)
  const carregar = useCallback(async () => {
    if (!salao?.id) return
    const { data } = await supabase.from('cobrancas_mimo').select('id, tipo, periodo_inicio, periodo_fim, total_cents, desconto_cents, metodo, status, vencimento, pago_em, copia_cola, link_url').eq('salon_id', salao.id).order('criado_em', { ascending: false }).limit(24)
    setCobrancas(data ?? [])
  }, [salao?.id])
  useEffect(() => { carregar() }, [carregar, acesso?.fase, acesso?.pendente?.status])

  const autonoma = salao?.tipo === 'autonoma'
  const m = acesso?.mensalidade
  const n = Number(m?.agendas ?? salao?.equipe_prevista ?? 1)
  const plano = m ? { nome: m.plano === 'promais' ? PLANOS.promais.nome : PLANOS.pro.nome, plano: m.plano, total: m.valor_cents / 100, extras: Math.max(0, n - (m.plano === 'promais' ? PLANOS.promais.inclusas : PLANOS.pro.inclusas)), valorExtra: m.plano === 'promais' ? PLANOS.promais.extra : PLANOS.pro.extra, base: m.plano === 'promais' ? PLANOS.promais.base : PLANOS.pro.base } : precoPara(n)
  const fase = acesso?.fase
  const vinculado = ['cartao', 'pix_automatico'].includes(acesso?.metodo) && !acesso?.cancelada
  const pend = acesso?.pendente
  const situacao = autonoma ? { Icone: Heart, tom: 'calmo', titulo: 'Sua agenda é grátis', texto: 'Autônoma não paga mensalidade. Se um dia virar salão com equipe, o plano MIMO Pro entra aí.' }
    : fase === 'configurando' ? { Icone: Wrench, tom: 'calmo', titulo: 'Ainda montando o salão', texto: `Nada está sendo cobrado. Seus ${REGRAS.testeDias} dias grátis começam quando você ativar o link e o QR Code em Configurar.` }
    : fase === 'teste' ? { Icone: Sparkles, tom: 'calmo', titulo: `Teste grátis: ${acesso.dias <= 1 ? 'acaba hoje' : `faltam ${acesso.dias} dias`}`, texto: vinculado ? `Tudo liberado. No dia ${dataCurta(acesso.cobrar_em ?? acesso.ate)} cobramos ${reais((m?.total_cents ?? 0) / 100)} ${acesso.metodo === 'cartao' ? `no cartão final ${acesso.cartao_final}` : 'por Pix Automático'} e nada para.` : `Tudo liberado até ${dataCurta(acesso.ate)}, sem cartão. Depois disso o link para de receber agendamento novo até você assinar.` }
    : fase === 'ativa' ? { Icone: Check, tom: 'calmo', titulo: acesso.cancelada ? 'Assinatura cancelada' : 'Assinatura em dia', texto: acesso.sem_prazo ? 'Sem prazo pra vencer. Qualquer coisa, fale com a gente.' : acesso.cancelada ? `Você usa até ${dataCurta(acesso.ate)}. Depois disso o link para de receber agendamento novo. Vincule uma forma de pagar pra continuar.` : vinculado ? `Válida até ${dataCurta(acesso.ate)}. A próxima cobrança, ${reais((m?.total_cents ?? 0) / 100)}, sai nesse dia.` : `Válida até ${dataCurta(acesso.ate)}. Uns dias antes a gente manda o Pix do mês seguinte.` }
    : fase === 'leitura' ? { Icone: BookOpen, tom: 'alerta', titulo: 'Modo leitura', texto: `${acesso.teste ? 'O teste grátis acabou' : 'A assinatura venceu'} em ${dataCurta(acesso.ate)}. Os horários marcados continuam valendo, mas o link não recebe agendamento novo. ${pend?.status === 'falhou' ? 'A cobrança não passou: troque a forma de pagamento ou pague por Pix.' : `Pague até ${dataCurta(acesso.tolerancia_ate)} pra não pausar o painel.`}` }
    : fase === 'bloqueado' ? { Icone: PauseCircle, tom: 'alerta', titulo: 'Painel pausado', texto: 'Passou o prazo pra assinar. Nada foi apagado: pagou, voltou tudo na hora.' }
    : null

  const pagarAgora = fase && ['teste', 'leitura', 'bloqueado', 'configurando'].includes(fase) || acesso?.cancelada
  async function cancelar() {
    const ok = await confirmar({ titulo: 'Cancelar a assinatura?', texto: fase === 'teste' ? 'Tiramos a forma de pagamento e nada será cobrado. O teste continua até o fim, e depois o link para de receber agendamento novo.' : `Você usa até ${dataCurta(acesso?.ate)} e nada mais é cobrado. Depois disso o link para de receber agendamento novo. Clientes e histórico ficam guardados.`, ok: 'Cancelar assinatura', perigo: true })
    if (!ok) return
    setIndo(true); setErro('')
    try { await assinatura('cancelar', salao.id); await recarregarAcesso?.() } catch (e) { setErro(e.message) } finally { setIndo(false) }
  }
  async function descartarPix() {
    const ok = await confirmar({ titulo: 'Cancelar este Pix?', texto: 'O QR Code deixa de valer e nada é cobrado. Você pode gerar outro ou escolher outra forma de pagamento quando quiser.', ok: 'Cancelar o Pix', perigo: true })
    if (!ok) return
    setIndo(true); setErro('')
    try { await assinatura('descartar_pix', salao.id); await recarregarAcesso?.(); await carregar() } catch (e) { setErro(e.message) } finally { setIndo(false) }
  }
  async function conferir() { setIndo(true); setErro(''); try { await assinatura('conferir', salao.id); await recarregarAcesso?.(); await carregar() } catch (e) { setErro(e.message) } finally { setIndo(false) } }
  const ST = { a_criar: 'gerando', aguardando: 'aguardando', pago: 'pago', falhou: 'não passou', cancelado: 'cancelado', expirado: 'venceu' }

  return (
    <AdminShell>
      <div className="page-head"><div><h2>Plano e assinatura</h2><p className="muted">Quanto custa, quando cobra, e como funciona o teste grátis.</p></div></div>
      {erro && <div className="alert alert-error">{erro}</div>}

      {situacao && (
        <div className={`card assin-situacao ${situacao.tom}`}>
          <span className="assin-icone"><situacao.Icone size={20} /></span>
          <div><strong>{situacao.titulo}</strong><span className="muted">{situacao.texto}</span></div>
          {!autonoma && fase === 'configurando' && <Link className="btn btn-primary" to="/admin/configurar?etapa=ativacao">Ir pra ativação</Link>}
        </div>
      )}

      {/* o Pix pendente */}
      {!autonoma && pend?.metodo === 'pix' && pend.status === 'aguardando' && pend.copia_cola && (
        <div className="card assin-pendente">
          <div className="assin-pendente-topo"><Smartphone size={16} /><strong>Pix de {reais(pend.total_cents / 100)}</strong><span className="muted">vence {dataCurta(pend.vencimento)} · vale até {dataCurta(pend.periodo_fim)}</span></div>
          <QrPix payload={pend.copia_cola} />
          <p className="muted assin-nota">Pagou? Toque em "Já paguei". Mudou de ideia? Dá pra trocar a forma de pagamento ou cancelar este Pix: nada foi cobrado.</p>
          <div className="assin-acoes">
            <button type="button" className="btn btn-primary" onClick={conferir} disabled={indo}>{indo ? 'Conferindo…' : 'Já paguei'}</button>
            <button type="button" className="btn btn-ghost btn-mini" onClick={() => setModal({ modo: 'escolher' })} disabled={indo}>Trocar forma de pagamento</button>
            <button type="button" className="btn btn-ghost btn-mini" onClick={descartarPix} disabled={indo}>Cancelar este Pix</button>
            {acesso?.sandbox !== false && <button type="button" className="btn btn-ghost btn-mini" onClick={async () => { setIndo(true); try { await assinatura('simular', salao.id); await recarregarAcesso?.(); await carregar() } catch (e) { setErro(e.message) } finally { setIndo(false) } }}>Simular pagamento (sandbox)</button>}
          </div>
        </div>
      )}

      {/* como pagar */}
      {!autonoma && fase && fase !== 'gratis' && (
        <div className="card assin-metodo">
          <h3 className="secao-titulo"><CreditCard size={16} /> Como você paga</h3>
          {acesso?.metodo && !acesso.cancelada ? (
            <div className="assin-metodo-atual">
              <span className="assin-icone">{acesso.metodo === 'cartao' ? <CreditCard size={18} /> : <Smartphone size={18} />}</span>
              <div>
                <strong>{rotuloDoMetodo(acesso)}</strong>
                <span className="muted">{acesso.metodo === 'pix_automatico' ? (autorizado(acesso) ? `${REGRAS.descontoPixAutomaticoPct}% de desconto enquanto pagar por aqui.` : 'Falta autorizar no app do seu banco. Toque em "Autorizar" pra ver o QR de novo.') : METODOS[acesso.metodo].explica}</span>
              </div>
              <div className="assin-metodo-acoes">
                {acesso.metodo === 'pix_automatico' && !autorizado(acesso) && <button type="button" className="btn btn-primary btn-mini" onClick={() => setModal({ modo: 'pix_automatico' })}>Autorizar</button>}
                <button type="button" className="btn btn-ghost btn-mini" onClick={() => setModal({ modo: 'escolher' })}>Trocar</button>
              </div>
            </div>
          ) : (
            <p className="muted">Nenhuma forma de pagamento vinculada. {fase === 'teste' ? 'Deixe uma pronta e o teste vira assinatura sem pausa; nada é cobrado antes do fim do teste.' : 'Escolha como pagar pra continuar recebendo agendamentos.'}</p>
          )}
          {!(acesso?.metodo && !acesso.cancelada) && (
          <div className="assin-opcoes">
            <button type="button" className="assin-opcao" onClick={() => setModal({ modo: 'pix_automatico' })}>
              <Smartphone size={16} /><span><b>Pix Automático</b><em>{reais(comDesconto(m?.valor_cents ?? 4990, REGRAS.descontoPixAutomaticoPct) / 100)}/mês · {REGRAS.descontoPixAutomaticoPct}% off</em><small>{METODOS.pix_automatico.explica}</small></span>
            </button>
            <button type="button" className="assin-opcao" onClick={() => setModal({ modo: 'cartao', cobrarAgora: pagarAgora && !vinculado })}>
              <CreditCard size={16} /><span><b>Cartão</b><em>{reais((m?.valor_cents ?? 4990) / 100)}/mês</em><small>{pagarAgora && !vinculado ? 'Paga o primeiro mês agora e segue automático.' : METODOS.cartao.explica}</small></span>
            </button>
            {pagarAgora && (
              <button type="button" className="assin-opcao" onClick={() => setModal({ modo: 'pix_avista', cobrarAgora: true })}>
                <Receipt size={16} /><span><b>Pix à vista</b><em>{reais((m?.valor_cents ?? 4990) / 100)} agora{acesso?.bonus_usado ? '' : ` · ${REGRAS.periodoDias + REGRAS.bonusDias} dias`}</em><small>{METODOS.pix.explica}</small></span>
              </button>
            )}
          </div>
          )}
          {(acesso?.metodo || fase === 'ativa') && !acesso?.cancelada && !acesso?.sem_prazo && (
            <button type="button" className="btn btn-ghost btn-mini assin-cancelar" onClick={cancelar} disabled={indo}>Cancelar assinatura</button>
          )}
        </div>
      )}

      {!autonoma && (
        <div className="card assin-plano">
          <div className="assin-plano-topo">
            <div>
              <small className="assin-rotulo">Seu plano</small>
              <strong className="assin-nome">{plano.nome}</strong>
              <span className="muted">{n} {n === 1 ? 'agenda ativa' : 'agendas ativas'} · {plano.extras === 0 ? 'dentro das inclusas' : `${plano.extras} ${plano.extras === 1 ? 'extra' : 'extras'} de ${reais(plano.valorExtra)}`}</span>
            </div>
            <b className="assin-preco">{m?.desconto_cents ? <><s>{reais(m.valor_cents / 100)}</s> {reais(m.total_cents / 100)}</> : reais(plano.total)}<small> /mês</small></b>
          </div>
          <ul className="assin-lista">
            <li><Check size={13} /> {reais(plano.base)} com {plano.plano === 'promais' ? PLANOS.promais.inclusas : PLANOS.pro.inclusas} agendas inclusas; cada agenda a mais, {reais(plano.valorExtra)}</li>
            <li><Check size={13} /> Pix Automático tem {REGRAS.descontoPixAutomaticoPct}% de desconto no total do mês</li>
            <li><Check size={13} /> O valor acompanha as agendas ativas: tirou uma profissional, o plano cai junto</li>
            <li><Check size={13} /> Sem fidelidade, sem multa: cancela quando quiser e usa até o fim do período pago</li>
            <li><Check size={13} /> Clientes, histórico e cadastro ficam guardados mesmo com o painel pausado</li>
          </ul>
          <div className="assin-planos">
            <div className={'assin-opcao-plano' + (plano.plano === 'pro' ? ' ativa' : '')}><strong>MIMO Pro</strong><span>até {PLANOS.pro.ate} agendas</span><em>{reais(PLANOS.pro.base)} com {PLANOS.pro.inclusas} inclusas · {reais(PLANOS.pro.extra)} por extra</em></div>
            <div className={'assin-opcao-plano' + (plano.plano === 'promais' ? ' ativa' : '')}><strong>MIMO Pro+</strong><span>{PLANOS.pro.ate + 1} agendas ou mais</span><em>{reais(PLANOS.promais.base)} com {PLANOS.promais.inclusas} inclusas · {reais(PLANOS.promais.extra)} por extra</em></div>
          </div>
          <p className="muted assin-nota">Exemplo: com {PLANOS.pro.ate} agendas o MIMO Pro fica em {reais(precoPara(PLANOS.pro.ate).total)}; a partir da {PLANOS.pro.ate + 1}ª agenda o Pro+ passa a valer mais a pena.</p>
        </div>
      )}

      {!autonoma && cobrancas.length > 0 && (
        <div className="card">
          <h3 className="secao-titulo"><Receipt size={16} /> Cobranças</h3>
          <ul className="assin-cobrancas">
            {cobrancas.map((c) => (
              <li key={c.id} className={c.status}>
                <div><strong>{reais(c.total_cents / 100)}</strong><span className="muted">{dataCurta(c.periodo_inicio)} a {dataCurta(c.periodo_fim)} · {METODOS[c.metodo]?.curto ?? c.metodo}{c.desconto_cents > 0 ? ` · ${reais(c.desconto_cents / 100)} de desconto` : ''}</span></div>
                <span className={'assin-st ' + c.status}>{ST[c.status] ?? c.status}{c.status === 'pago' && c.pago_em ? ` ${dataCurta(c.pago_em)}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!autonoma && (
        <div className="card">
          <h3 className="secao-titulo"><CalendarClock size={16} /> Como funciona o teste grátis</h3>
          <ol className="ativar-linha">
            {LINHA_DO_TESTE.map((e) => (
              <li key={e.quando}><span className="ativar-quando">{e.quando}</span><div><strong>{e.titulo}</strong><small className="muted">{e.texto}</small></div></li>
            ))}
          </ol>
          <p className="muted assin-nota">Pagou à vista? O primeiro período tem {REGRAS.periodoDias} + {REGRAS.bonusDias} dias de bônus. Quem conclui o cadastro e fica {REGRAS.prazoAtivacaoDias} dias sem ativar tem o teste começando sozinho, com aviso.</p>
        </div>
      )}

      {modal && <FormasDePagar salao={salao.id} modo={modal.modo} cobrarAgora={Boolean(modal.cobrarAgora)} valores={m} acesso={acesso} permitirAvista={Boolean(pagarAgora)} onFechar={() => { setModal(null); recarregarAcesso?.(); carregar() }} onFeito={() => { recarregarAcesso?.(); carregar() }} />}
    </AdminShell>
  )
}
