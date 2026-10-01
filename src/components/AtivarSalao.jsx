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

        {modo === 'escolha' && (
          <div className="ai-corpo">
            <div className="ai-hero">
              <span className="ai-icone"><Sparkles size={25} /></span>
              <span className="ai-kicker">Tudo pronto para começar</span>
              <h1>{s?.name || 'Seu salão'} está a uma escolha de ficar no ar.</h1>
              <p>Escolha como quer começar. Nada será cobrado automaticamente e você não precisa cadastrar cartão para testar.</p>
            </div>

            <div className="ai-resumo">
              <span><b>{agendas}</b> {agendas === 1 ? 'agenda' : 'agendas'}</span>
              <i />
              <span>mensalidade atual <strong>{cheio ? reais(cheio / 100) : 'calculando…'}</strong></span>
            </div>

            <div className="ai-escolhas">
              <section className="ai-opcao ai-teste">
                <span className="ai-opcao-selo"><Sparkles size={13} /> Quero conhecer primeiro</span>
                <h2>{REGRAS.testeDias} dias grátis</h2>
                <p>Use a MIMO completa com clientes reais. Sem cartão, sem Pix e sem cobrança automática.</p>
                <ul>
                  <li><Check size={14} /> Link e QR liberados</li>
                  <li><Check size={14} /> Painel completo</li>
                  <li><Check size={14} /> Você decide depois se continua</li>
                </ul>
                <button type="button" className="btn btn-ghost ai-botao-grande" onClick={comecarTeste} disabled={indo}>
                  {indo ? 'Ativando…' : `Começar meus ${REGRAS.testeDias} dias grátis`}
                </button>
                <small>Ao escolher o teste, a oferta de 20% da primeira mensalidade não fica reservada.</small>
              </section>

              <section className="ai-opcao ai-pagar">
                <span className="ai-opcao-selo destaque"><Gift size={13} /> Oferta de boas-vindas</span>
                <div className="ai-preco">
                  <span><s>{cheio ? reais(cheio / 100) : '...'}</s><b>{oferta ? reais(oferta / 100) : '...'}</b></span>
                  <em>{descontoPct}% OFF</em>
                </div>
                <h2>Já quero começar pagando</h2>
                <p>Você abre mão do teste grátis e ativa 30 dias agora. A primeira mensalidade tem {descontoPct}% de desconto.</p>
                <div className="ai-pagar-botoes">
                  <button type="button" onClick={abrirPix} disabled={indo || !oferta}>
                    <Smartphone size={19} /><span><strong>Pix</strong><small>QR Code na hora</small></span>
                  </button>
                  <button type="button" onClick={() => setModo('cartao')} disabled={indo || !oferta}>
                    <CreditCard size={19} /><span><strong>Cartão</strong><small>Pagamento único</small></span>
                  </button>
                </div>
                <small><ShieldCheck size={12} /> Sem recorrência. No cartão, os dados são enviados ao Asaas somente para esta cobrança.</small>
              </section>
            </div>

            {erro && <div className="ai-erro">{erro}</div>}
            <p className="ai-rodape">Depois desta escolha, seu salão entra no ar e você segue para o painel.</p>
          </div>
        )}

        {modo === 'pix' && (
          <div className="ai-corpo ai-pagamento">
            <div className="ai-hero compacto">
              <span className="ai-icone"><Smartphone size={24} /></span>
              <span className="ai-kicker">Primeira mensalidade · {descontoPct}% OFF</span>
              <h1>Falta só confirmar o Pix.</h1>
              <p>Pague <strong>{reais(Number(pix?.total_cents ?? oferta) / 100)}</strong>. Quando o Asaas confirmar, a MIMO libera seus 30 dias automaticamente.</p>
            </div>
            <div className="ai-pix-box">
              {pix?.copia_cola ? <QrPix payload={pix.copia_cola} imagem={pix.imagem} /> : <p><LoaderCircle className="ai-gira" size={18} /> Gerando seu Pix…</p>}
            </div>
            {erro && <div className="ai-erro">{erro}</div>}
            <div className="ai-acoes">
              <button type="button" className="btn btn-primary ai-botao-grande" onClick={() => conferir(true)} disabled={indo || !pix?.copia_cola}>{indo ? 'Conferindo…' : 'Já paguei, conferir'}</button>
              <button type="button" className="btn btn-ghost" onClick={trocarOpcao} disabled={indo}>Escolher outra opção</button>
            </div>
            <small className="ai-seguranca"><ShieldCheck size={12} /> Este pagamento não cria débito automático nem renovação recorrente.</small>
          </div>
        )}

        {modo === 'cartao' && (
          <CartaoInicial
            total={oferta}
            desconto={descontoPct}
            indo={indo}
            erro={erro}
            onEnviar={pagarCartao}
            onVoltar={() => { setErro(''); setModo('escolha') }}
          />
        )}

        {modo === 'analise' && (
          <div className="ai-corpo ai-pagamento">
            <div className="ai-hero compacto">
              <span className="ai-icone"><LoaderCircle className="ai-gira" size={24} /></span>
              <span className="ai-kicker">Pagamento enviado</span>
              <h1>O cartão está sendo confirmado.</h1>
              <p>Algumas transações levam alguns instantes para o Asaas concluir. Pode deixar esta tela aberta, a MIMO confere sozinha.</p>
            </div>
            {erro && <div className="ai-erro">{erro}</div>}
            <button type="button" className="btn btn-primary ai-botao-grande" onClick={() => conferir(true)} disabled={indo}>{indo ? 'Conferindo…' : 'Conferir agora'}</button>
            <button type="button" className="btn btn-ghost" onClick={trocarOpcao} disabled={indo}>Tentar outra forma</button>
          </div>
        )}

        {modo === 'sucesso' && (
          <div className="ai-corpo ai-sucesso">
            <span className="ai-sucesso-check"><Check size={30} /></span>
            <span className="ai-kicker">{sucesso?.fase === 'teste' ? 'Teste iniciado' : 'Pagamento confirmado'}</span>
            <h1>Agora sim. Seu salão está no ar. 🎉</h1>
            <p>
              {sucesso?.fase === 'teste'
                ? (sucesso?.ate
                  ? `Seus ${REGRAS.testeDias} dias grátis começaram agora. Você pode usar tudo até ${dataCurta(sucesso.ate)}.`
                  : `Seus ${REGRAS.testeDias} dias grátis começam a contar assim que a agenda estiver configurada: serviços e profissionais. Até lá, nada conta.`)
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
      className="ai-corpo ai-pagamento ai-cartao"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ok) return
        onEnviar(
          { nome: c.nome.trim(), numero: c.numero, mes, ano, cvv: c.cvv },
          { cep: c.cep, numero: c.numeroEnd },
        )
      }}
    >
      <div className="ai-hero compacto">
        <span className="ai-icone"><CreditCard size={24} /></span>
        <span className="ai-kicker">Primeira mensalidade · {desconto}% OFF</span>
        <h1>Pagar {reais(Number(total || 0) / 100)} no cartão</h1>
        <p>É uma cobrança única. O cartão não fica vinculado e não existe renovação automática.</p>
      </div>

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
        <label className="ai-campo">CEP da fatura
          <input value={c.cep} onChange={set('cep')} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" required />
        </label>
        <label className="ai-campo">Número
          <input value={c.numeroEnd} onChange={set('numeroEnd')} inputMode="numeric" placeholder="120" required />
        </label>
      </div>

      {erro && <div className="ai-erro">{erro}</div>}
      <button type="submit" className="btn btn-primary ai-botao-grande" disabled={!ok || indo}>{indo ? 'Processando…' : `Pagar ${reais(Number(total || 0) / 100)}`}</button>
      <button type="button" className="btn btn-ghost" onClick={onVoltar} disabled={indo}>Voltar às opções</button>
      <small className="ai-seguranca"><ShieldCheck size={12} /> A MIMO não armazena número nem CVV. Os dados desta cobrança são enviados ao Asaas.</small>
    </form>
  )
}
