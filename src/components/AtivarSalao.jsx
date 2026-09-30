import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CreditCard, Gift, LoaderCircle, Rocket, ShieldCheck, Smartphone, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { reais } from '../lib/planos'
import { REGRAS, dataCurta } from '../lib/acesso'
import { assinatura, mascaraCartao, mascaraValidade, cartaoValido } from '../lib/assinatura'
import { QrPix } from './FormasDePagar'

// 2.81: a decisão final é uma tela própria, sem navegação e sem "X".
// O salão só sai daqui escolhendo:
//   • 7 dias grátis, sem cartão; OU
//   • primeira mensalidade agora, Pix/cartão avulso, 20% OFF.
// Não há recorrência nem cartão guardado nesta versão.
export default function AtivarSalao({ s, onAtivado, onErro }) {
  const { recarregarAcesso, recarregarPerfil } = useAuth()
  const autonoma = s?.tipo === 'autonoma'
  const [estado, setEstado] = useState(null)
  const [modo, setModo] = useState('escolha') // escolha | pix | cartao | analise | sucesso
  const [sucesso, setSucesso] = useState(null)
  const [indo, setIndo] = useState(false)
  const [erro, setErro] = useState('')
  const [pix, setPix] = useState(null)
  const poll = useRef(null)

  const cheio = Number(estado?.valor_cents ?? estado?.mensalidade?.valor_cents ?? 0)
  const oferta = Number(estado?.oferta_cents ?? Math.floor(cheio * 0.8))
  const descontoPct = Number(estado?.desconto_pct ?? REGRAS.descontoInicialPct ?? 20)
  const agendas = Number(estado?.mensalidade?.agendas ?? s?.equipe_prevista ?? 1)
  const economia = Math.max(0, cheio - oferta)

  async function carregar() {
    if (!s?.id || autonoma) return null
    const { data, error } = await supabase.rpc('ativacao_inicial_estado', { salao: s.id })
    if (error) throw new Error(error.message)
    setEstado(data ?? null)
    if (data?.cobranca?.status === 'pago') setModo('sucesso')
    else if (data?.cobranca?.metodo === 'pix' && data?.cobranca?.copia_cola) {
      setPix(data.cobranca)
      setModo('pix')
    } else if (data?.cobranca?.metodo === 'cartao' && ['a_criar', 'aguardando'].includes(data?.cobranca?.status)) {
      setModo('analise')
    }
    return data
  }

  useEffect(() => {
    if (!autonoma) carregar().catch((e) => setErro(e.message))
  }, [s?.id, autonoma]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (modo !== 'pix' && modo !== 'analise') return
    clearInterval(poll.current)
    poll.current = setInterval(() => conferir(false), 5000)
    return () => clearInterval(poll.current)
  }, [modo]) // eslint-disable-line react-hooks/exhaustive-deps

  async function rodar(fn) {
    setIndo(true); setErro('')
    try { return await fn() }
    catch (e) { const msg = e?.message || String(e); setErro(msg); onErro?.(msg); return null }
    finally { setIndo(false) }
  }

  async function atualizarContexto() {
    await Promise.all([recarregarAcesso?.(), recarregarPerfil?.()])
  }

  async function liberarAutonoma() {
    await rodar(async () => {
      const { data, error } = await supabase.rpc('salao_ativar', { salao: s.id })
      if (error) throw new Error(error.message)
      await atualizarContexto()
      setSucesso(data)
      setModo('sucesso')
    })
  }

  async function cancelarPagamentoPendente() {
    if (!estado?.cobranca || estado.cobranca.status === 'pago') return
    await assinatura('inicio_cancelar', s.id)
    setPix(null)
    const novo = await carregar()
    setEstado(novo)
  }

  async function comecarTeste() {
    await rodar(async () => {
      if (estado?.cobranca && estado.cobranca.status !== 'pago') await cancelarPagamentoPendente()
      const { data, error } = await supabase.rpc('ativacao_inicial_teste', { salao: s.id })
      if (error) throw new Error(error.message)
      await atualizarContexto()
      setSucesso(data)
      setModo('sucesso')
    })
  }

  async function abrirPix() {
    await rodar(async () => {
      if (estado?.cobranca && estado.cobranca.metodo !== 'pix' && estado.cobranca.status !== 'pago') await cancelarPagamentoPendente()
      const r = await assinatura('inicio_pix', s.id)
      setPix(r?.cobranca ?? null)
      setEstado((x) => ({ ...(x ?? {}), cobranca: r?.cobranca ?? x?.cobranca }))
      setModo('pix')
    })
  }

  async function pagarCartao(cartao, titular) {
    await rodar(async () => {
      if (estado?.cobranca && estado.cobranca.metodo !== 'cartao' && estado.cobranca.status !== 'pago') await cancelarPagamentoPendente()
      const r = await assinatura('inicio_cartao', s.id, { cartao, titular })
      if (r?.acesso?.fase === 'ativa') {
        await atualizarContexto()
        setSucesso(r.acesso)
        setModo('sucesso')
      } else {
        setModo('analise')
      }
    })
  }

  async function conferir(manual = true) {
    if (indo) return
    if (manual) setIndo(true)
    try {
      const r = await assinatura('inicio_conferir', s.id)
      setEstado(r?.estado ?? estado)
      if (r?.estado?.cobranca?.copia_cola) setPix(r.estado.cobranca)
      if (r?.acesso?.fase === 'ativa') {
        clearInterval(poll.current)
        await atualizarContexto()
        setSucesso(r.acesso)
        setModo('sucesso')
      }
    } catch (e) {
      if (manual) setErro(e?.message || String(e))
    } finally {
      if (manual) setIndo(false)
    }
  }

  async function trocarOpcao() {
    await rodar(async () => {
      await cancelarPagamentoPendente()
      setModo('escolha')
      setErro('')
    })
  }

  function entrar() {
    onAtivado?.(sucesso)
  }

  if (autonoma) {
    return (
      <div className="ai-fundo">
        <div className="ai-shell ai-shell-mini">
          <span className="ai-icone"><Sparkles size={26} /></span>
          <span className="ai-kicker">Tudo preparado</span>
          <h1>Sua agenda está pronta para ganhar a rua.</h1>
          <p>Seu link e o QR Code serão liberados agora. A agenda autônoma da MIMO é grátis, sem prazo e sem cartão.</p>
          {erro && <div className="ai-erro">{erro}</div>}
          <button type="button" className="btn btn-primary ai-botao-grande" onClick={liberarAutonoma} disabled={indo}>
            {indo ? 'Liberando…' : 'Liberar minha agenda'} <Rocket size={17} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ai-fundo" role="dialog" aria-modal="true" aria-label="Ativação do salão">
      <div className="ai-shell">
        <header className="ai-topo">
          <img src="/mimo-logo.svg" alt="MIMO" />
          <span><ShieldCheck size={14} /> Sua configuração está salva</span>
        </header>

        {modo !== 'sucesso' && (
          <div className="ai-corpo ai-escolha-corpo">
            <div className="ai-hero ai-hero-escolha">
              <span className="ai-icone"><Sparkles size={25} /></span>
              <span className="ai-kicker">Tudo pronto para começar</span>
              <h1>{s?.name || 'Seu salão'} está pronto para entrar no ar.</h1>
              <p>Você escolhe como começar. Sem cobrança automática e sem cartão obrigatório no teste.</p>
            </div>

            <div className="ai-resumo">
              <span><b>{agendas}</b> {agendas === 1 ? 'agenda' : 'agendas'}</span>
              <i />
              <span>mensalidade atual <strong>{cheio ? reais(cheio / 100) : 'calculando…'}</strong></span>
            </div>

            <div className="ai-escolhas ai-escolhas-premium">
              <section className="ai-opcao ai-teste ai-opcao-nova">
                <div className="ai-opcao-cabeca">
                  <span className="ai-opcao-selo"><Sparkles size={13} /> Quero conhecer primeiro</span>
                  <span className="ai-opcao-tag-neutra">sem compromisso</span>
                </div>

                <div className="ai-opcao-principal">
                  <span className="ai-opcao-supra">Teste completo</span>
                  <h2>{REGRAS.testeDias} dias grátis</h2>
                  <p>Conheça a MIMO funcionando de verdade antes de decidir se quer continuar.</p>
                </div>

                <ul className="ai-beneficios">
                  <li><Check size={14} /> Link e QR liberados</li>
                  <li><Check size={14} /> Painel completo</li>
                  <li><Check size={14} /> Sem cartão e sem Pix</li>
                </ul>

                <div className="ai-opcao-acao">
                  <button type="button" className="btn ai-cta ai-cta-teste" onClick={comecarTeste} disabled={indo}>
                    <Sparkles size={16} /> {indo ? 'Ativando…' : `Começar ${REGRAS.testeDias} dias grátis`}
                  </button>
                  <small>Ao escolher o teste, a oferta de {descontoPct}% da primeira mensalidade deixa de ficar disponível.</small>
                </div>
              </section>

              <section className="ai-opcao ai-pagar ai-opcao-nova ai-opcao-destaque">
                <div className="ai-opcao-cabeca">
                  <span className="ai-opcao-selo destaque"><Gift size={13} /> Oferta de boas-vindas</span>
                  <span className="ai-opcao-tag-oferta">{descontoPct}% OFF hoje</span>
                </div>

                <div className="ai-opcao-principal ai-opcao-principal-pago">
                  <span className="ai-opcao-supra">Primeiros 30 dias</span>
                  <div className="ai-preco-novo">
                    <s>{cheio ? reais(cheio / 100) : '...'}</s>
                    <strong>{oferta ? reais(oferta / 100) : '...'}</strong>
                    {economia > 0 && <span>economize {reais(economia / 100)}</span>}
                  </div>
                  <h2>Começar pagando agora</h2>
                  <p>Ative 30 dias imediatamente e aproveite o desconto da primeira mensalidade.</p>
                </div>

                <div className="ai-beneficios ai-beneficios-pago">
                  <span><Check size={13} /> 30 dias liberados</span>
                  <span><Check size={13} /> Sem recorrência</span>
                  <span><Check size={13} /> Pix ou cartão</span>
                </div>

                <div className="ai-opcao-acao">
                  <div className="ai-pagar-botoes ai-pagar-botoes-novos">
                    <button type="button" className="ai-cta-pagamento" onClick={abrirPix} disabled={indo || !oferta}>
                      <Smartphone size={18} /><span><strong>Pagar com Pix</strong><small>QR Code na hora</small></span>
                    </button>
                    <button type="button" className="ai-cta-pagamento ai-cta-cartao" onClick={() => setModo('cartao')} disabled={indo || !oferta}>
                      <CreditCard size={18} /><span><strong>Pagar com cartão</strong><small>Pagamento único</small></span>
                    </button>
                  </div>
                  <small><ShieldCheck size={12} /> Pagamento único. Nenhuma renovação automática é criada.</small>
                </div>
              </section>
            </div>

            {erro && modo === 'escolha' && <div className="ai-erro">{erro}</div>}
            <p className="ai-rodape">Depois da escolha, seu salão entra no ar e você segue para o painel.</p>
          </div>
        )}

        {modo === 'pix' && (
          <div className="ai-modal-fundo" role="dialog" aria-modal="true" aria-label="Pagamento por Pix">
            <div className="ai-modal-card ai-modal-pix">
              <div className="ai-modal-topo">
                <span className="ai-modal-icone"><Smartphone size={20} /></span>
                <div>
                  <span className="ai-kicker">Primeira mensalidade · {descontoPct}% OFF</span>
                  <h2>Finalize pelo Pix</h2>
                </div>
              </div>

              <div className="ai-pix-resumo">
                <div>
                  <span>Valor do pagamento</span>
                  <strong>{reais(Number(pix?.total_cents ?? oferta) / 100)}</strong>
                </div>
                <span className="ai-pix-status"><ShieldCheck size={14} /> cobrança única</span>
              </div>

              <p className="ai-modal-texto">Escaneie o QR Code ou copie o código Pix. Assim que o Asaas confirmar o pagamento, seus 30 dias são liberados.</p>

              <div className="ai-pix-box ai-pix-modal">
                <span className="ai-pix-selo"><Smartphone size={14} /> Pix copia e cola</span>
                {pix?.copia_cola ? <QrPix payload={pix.copia_cola} imagem={pix.imagem} /> : <p><LoaderCircle className="ai-gira" size={18} /> Gerando seu Pix…</p>}
              </div>

              <div className="ai-pix-passos">
                <span><b>1</b><small>Abra o app do banco</small></span>
                <span><b>2</b><small>Escaneie ou copie o Pix</small></span>
                <span><b>3</b><small>Confirme e volte aqui</small></span>
              </div>

              {erro && <div className="ai-erro">{erro}</div>}

              <div className="ai-modal-acoes">
                <button type="button" className="btn btn-primary ai-botao-grande" onClick={() => conferir(true)} disabled={indo || !pix?.copia_cola}>
                  {indo ? 'Conferindo…' : 'Já paguei, conferir'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={trocarOpcao} disabled={indo}>Voltar às opções</button>
              </div>

              <div className="ai-checkout-seguranca">
                <ShieldCheck size={14} />
                <span><strong>Pagamento protegido</strong><small>Processado via Asaas. Sem débito automático e sem renovação recorrente.</small></span>
              </div>
            </div>
          </div>
        )}

        {modo === 'cartao' && (
          <div className="ai-modal-fundo" role="dialog" aria-modal="true" aria-label="Pagamento com cartão">
            <CartaoInicial
              total={oferta}
              desconto={descontoPct}
              indo={indo}
              erro={erro}
              onEnviar={pagarCartao}
              onVoltar={() => { setErro(''); setModo('escolha') }}
            />
          </div>
        )}

        {modo === 'analise' && (
          <div className="ai-modal-fundo" role="dialog" aria-modal="true" aria-label="Confirmação do pagamento">
            <div className="ai-modal-card ai-modal-analise">
              <span className="ai-modal-loader"><LoaderCircle className="ai-gira" size={24} /></span>
              <span className="ai-kicker">Pagamento enviado</span>
              <h2>Estamos confirmando seu cartão</h2>
              <p>Algumas transações levam alguns instantes. A MIMO continua conferindo automaticamente.</p>
              {erro && <div className="ai-erro">{erro}</div>}
              <div className="ai-modal-acoes">
                <button type="button" className="btn btn-primary ai-botao-grande" onClick={() => conferir(true)} disabled={indo}>{indo ? 'Conferindo…' : 'Conferir agora'}</button>
                <button type="button" className="btn btn-ghost" onClick={trocarOpcao} disabled={indo}>Tentar outra forma</button>
              </div>
            </div>
          </div>
        )}

        {modo === 'sucesso' && (
          <div className="ai-corpo ai-sucesso">
            <span className="ai-sucesso-check"><Check size={30} /></span>
            <span className="ai-kicker">{sucesso?.fase === 'teste' ? 'Teste iniciado' : 'Pagamento confirmado'}</span>
            <h1>Agora sim. Seu salão está no ar. 🎉</h1>
            <p>
              {sucesso?.fase === 'teste'
                ? `Seus ${REGRAS.testeDias} dias grátis começaram agora. Você pode usar tudo até ${dataCurta(sucesso?.ate)}.`
                : `Sua primeira mensalidade está paga e a MIMO está liberada até ${dataCurta(sucesso?.ate)}.`}
            </p>
            <div className="ai-sucesso-itens">
              <span><Check size={14} /> Link do salão liberado</span>
              <span><Check size={14} /> QR Code pronto</span>
              <span><Check size={14} /> Clientes podem agendar</span>
            </div>
            <button type="button" className="btn btn-primary ai-botao-grande" onClick={entrar}>Entrar no meu painel <Rocket size={17} /></button>
          </div>
        )}
      </div>
    </div>
  )
}

function CartaoInicial({ total, desconto, indo, erro, onEnviar, onVoltar }) {
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
    <form
      className="ai-modal-card ai-modal-cartao"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ok) return
        onEnviar(
          { nome: c.nome.trim(), numero: c.numero, mes, ano, cvv: c.cvv },
          { cep: c.cep, numero: c.numeroEnd },
        )
      }}
    >
      <div className="ai-modal-topo">
        <span className="ai-modal-icone"><CreditCard size={20} /></span>
        <div>
          <span className="ai-kicker">Primeira mensalidade · {desconto}% OFF</span>
          <h2>Pagar {reais(Number(total || 0) / 100)} no cartão</h2>
        </div>
      </div>
      <p className="ai-modal-texto">Cobrança única. O cartão não fica vinculado e não existe renovação automática.</p>

      <div className="ai-cartao-preview">
        <div className="ai-cartao-preview-topo">
          <span>MIMO</span>
          <CreditCard size={22} />
        </div>
        <div className="ai-cartao-chip" aria-hidden="true"><i /><i /><i /></div>
        <strong className="ai-cartao-numero">
          {c.numero ? mascaraCartao(c.numero).padEnd(19, '•') : '•••• •••• •••• ••••'}
        </strong>
        <div className="ai-cartao-preview-rodape">
          <span><small>Titular</small><b>{c.nome.trim() || 'NOME NO CARTÃO'}</b></span>
          <span><small>Validade</small><b>{c.validade || 'MM/AA'}</b></span>
        </div>
      </div>

      <div className="ai-cartao-selos">
        <span><ShieldCheck size={13} /> Ambiente protegido</span>
        <span><Check size={13} /> Cobrança única</span>
        <span><Check size={13} /> Cartão não armazenado</span>
      </div>

      <div className="ai-cartao-secao">
        <span className="ai-cartao-secao-titulo">Dados do cartão</span>
        <div className="ai-cartao-grade">
          <label className="ai-campo inteiro">Nome como está no cartão
            <input value={c.nome} onChange={set('nome')} autoComplete="cc-name" required />
          </label>
          <label className="ai-campo inteiro">Número do cartão
            <input value={c.numero} onChange={(e) => setC((x) => ({ ...x, numero: mascaraCartao(e.target.value) }))} inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" required />
          </label>
          <label className="ai-campo">Validade
            <input value={c.validade} onChange={(e) => setC((x) => ({ ...x, validade: mascaraValidade(e.target.value) }))} inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA" required />
          </label>
          <label className="ai-campo">CVV
            <input value={c.cvv} onChange={set('cvv')} inputMode="numeric" autoComplete="cc-csc" maxLength={4} placeholder="123" required />
          </label>
        </div>
      </div>

      <div className="ai-cartao-secao">
        <span className="ai-cartao-secao-titulo">Endereço da cobrança</span>
        <div className="ai-cartao-grade ai-cartao-grade-endereco">
          <label className="ai-campo">CEP da fatura
            <input value={c.cep} onChange={set('cep')} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" required />
          </label>
          <label className="ai-campo">Número
            <input value={c.numeroEnd} onChange={set('numeroEnd')} inputMode="numeric" placeholder="120" required />
          </label>
        </div>
      </div>

      {erro && <div className="ai-erro">{erro}</div>}
      <button type="submit" className="btn btn-primary ai-botao-grande ai-cartao-pagar" disabled={!ok || indo}>
        <ShieldCheck size={16} /> {indo ? 'Processando…' : `Pagar ${reais(Number(total || 0) / 100)} com segurança`}
      </button>
      <button type="button" className="btn btn-ghost" onClick={onVoltar} disabled={indo}>Voltar às opções</button>
      <div className="ai-checkout-seguranca">
        <ShieldCheck size={14} />
        <span><strong>Seus dados ficam protegidos</strong><small>A MIMO não armazena número nem CVV. Os dados desta cobrança são enviados ao Asaas.</small></span>
      </div>
    </form>
  )
}
