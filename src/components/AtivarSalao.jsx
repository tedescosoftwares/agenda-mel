import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { ArrowLeft, Check, Copy, Gift, LoaderCircle, QrCode, Rocket, ShieldCheck, Sparkles, Tags, Scissors, UsersRound, Route, Zap, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { reais } from '../lib/planos'
import { REGRAS, dataCurta } from '../lib/acesso'
import { assinatura } from '../lib/assinatura'
import { LogoMimo, MarcaIcon } from './icons'
import '../checkout-mimo.css'

// 2.81: a decisão final é uma tela própria, sem navegação e sem "X".
// O salão só sai daqui escolhendo:
//   • 7 dias grátis, sem cartão; OU
//   • primeira mensalidade agora, por Pix (Asaas), 20% OFF.
// 3.85: só Pix (o cartão saiu, aqui e na função assinatura-metodo). Tela pensada no celular: lá, o que resolve é
// "Copiar código Pix" (ninguém escaneia a própria tela); no computador, o QR vem primeiro. Enquanto o Pix está
// aberto, a tela confere sozinha a cada 5 s, e a Plataforma pode dar baixa à mão (Salões › o salão › Mensalidades):
// a confirmação aparece aqui do mesmo jeito. Não há recorrência nem cartão guardado.
export default function AtivarSalao({ s, onAtivado, onErro }) {
  const { recarregarAcesso, recarregarPerfil } = useAuth()
  const autonoma = s?.tipo === 'autonoma'
  const [estado, setEstado] = useState(null)
  const [modo, setModo] = useState('escolha') // escolha | pix | sucesso
  const [sucesso, setSucesso] = useState(null)
  const [indo, setIndo] = useState(false)
  const [erro, setErro] = useState('')
  const [pix, setPix] = useState(null)
  const [meses, setMeses] = useState(null)   // 3.94: o plano do "pagar agora" (1, 6 ou 12)
  const poll = useRef(null)

  const cheio = Number(estado?.valor_cents ?? estado?.mensalidade?.valor_cents ?? 0)
  const agendas = Number(estado?.mensalidade?.agendas ?? s?.equipe_prevista ?? 1)
  // os planos: mensal com os 20% da primeira mensalidade, semestral 10%, anual 15% (o banco manda os preços)
  const planos = estado?.planos?.length ? estado.planos : [[1, 'Mensal', Number(estado?.desconto_pct ?? REGRAS.descontoInicialPct ?? 20)], [6, 'Semestral', 10], [12, 'Anual', 15]]
    .map(([m, nome, pct]) => ({ meses: m, nome, desconto_pct: pct, sem_desconto_cents: cheio * m, total_cents: Math.floor((cheio * m * (100 - pct)) / 100) }))
  const mesesEscolhidos = meses ?? estado?.cobranca?.meses ?? 1
  const planoEscolhido = planos.find((p) => p.meses === mesesEscolhidos) ?? planos[0]
  const oferta = Number(planoEscolhido?.total_cents ?? estado?.oferta_cents ?? 0)
  const semDesconto = Number(planoEscolhido?.sem_desconto_cents ?? cheio)
  const descontoPct = Number(planoEscolhido?.desconto_pct ?? estado?.desconto_pct ?? REGRAS.descontoInicialPct ?? 20)
  const economia = Math.max(0, semDesconto - oferta)

  async function carregar() {
    if (!s?.id || autonoma) return null
    const { data, error } = await supabase.rpc('ativacao_inicial_estado', { salao: s.id })
    if (error) throw new Error(error.message)
    setEstado(data ?? null)
    if (data?.cobranca?.status === 'pago') setModo('sucesso')
    else if (data?.cobranca?.metodo === 'pix' && data?.cobranca?.copia_cola) {
      setPix(data.cobranca)
      setModo('pix')
    }
    return data
  }

  useEffect(() => {
    if (!autonoma) carregar().catch((e) => setErro(e.message))
  }, [s?.id, autonoma]) // eslint-disable-line react-hooks/exhaustive-deps

  // a conferência automática chama sempre a versão atual do conferir (antes o relógio guardava a do momento em que
  // o Pix abriu, ainda com "indo" ligado, e nunca conferia: só o botão "Já paguei" funcionava)
  const conferirAgora = useRef(null)
  useEffect(() => {
    if (modo !== 'pix') return
    clearInterval(poll.current)
    poll.current = setInterval(() => conferirAgora.current?.(false), 5000)
    return () => clearInterval(poll.current)
  }, [modo])

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
      const r = await assinatura('inicio_pix', s.id, { meses: mesesEscolhidos })
      setPix(r?.cobranca ?? null)
      setEstado((x) => ({ ...(x ?? {}), cobranca: r?.cobranca ?? x?.cobranca }))
      setModo('pix')
    })
  }

  async function conferir(manual = true) {
    if (indo) return
    if (manual) setIndo(true)
    try {
      const r = await assinatura('inicio_conferir', s.id)
      setEstado(r?.estado ?? estado)
      if (r?.estado?.cobranca?.copia_cola) setPix((x) => ({ ...(x ?? {}), ...r.estado.cobranca }))
      if (r?.acesso?.fase === 'ativa') {
        clearInterval(poll.current)
        await atualizarContexto()
        setSucesso(r.acesso)
        setModo('sucesso')
      } else if (manual) {
        setErro('Ainda não chegou. O Pix costuma cair em segundos; se você já pagou, espere um pouquinho que a tela confere sozinha.')
      }
    } catch (e) {
      if (manual) setErro(e?.message || String(e))
    } finally {
      if (manual) setIndo(false)
    }
  }

  useEffect(() => { conferirAgora.current = conferir })

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

  if (modo === 'escolha' || modo === 'pix') {
    return (
      <div className="ai-fundo ck-fundo" role="dialog" aria-modal="true" aria-label="Ativação do salão">
        <div className="ck">
          <header className="ck-topo">
            <LogoMimo pro altura={38} />
            <span className="ck-salvo"><ShieldCheck size={13} /> Configuração salva</span>
          </header>

          {modo === 'escolha' ? (
            <>
              <section className="ck-hero">
                <span className="ck-hero-marca"><MarcaIcon width={30} height={30} /></span>
                <span className="ck-kicker">Tudo pronto para começar</span>
                <h1><span>{s?.name || 'Seu salão'}</span> está pronto para entrar no ar.</h1>
                <p>Escolha como começar. Nenhuma das opções tem cobrança automática.</p>
                <div className="ck-plano">
                  <span><small>Seu plano</small><b>MIMO Pro · {agendas} {agendas === 1 ? 'agenda' : 'agendas'}</b></span>
                  <strong>{cheio ? reais(cheio / 100) : '…'}<small>/mês</small></strong>
                </div>
              </section>

              <div className="ck-opcoes">
                <section className="ck-opcao ck-pagar">
                  <span className="ck-fita"><Gift size={13} /> {mesesEscolhidos === 1 ? `Boas-vindas · ${descontoPct}% OFF` : `Plano ${planoEscolhido?.nome?.toLowerCase()} · ${descontoPct}% OFF`}</span>
                  <h2>Pagar agora e já ativar</h2>
                  <div className="ck-planos" role="radiogroup" aria-label="Escolha o plano">
                    {planos.map((p) => (
                      <button key={p.meses} type="button" role="radio" aria-checked={p.meses === mesesEscolhidos}
                        className={'ck-plano-op' + (p.meses === mesesEscolhidos ? ' ativo' : '')} onClick={() => setMeses(p.meses)} disabled={indo}>
                        <span>{p.nome}</span>
                        <b>{p.desconto_pct}% OFF</b>
                      </button>
                    ))}
                  </div>
                  <div className="ck-preco">
                    {semDesconto > 0 && economia > 0 && <s>{reais(semDesconto / 100)}</s>}
                    <strong>{oferta ? reais(oferta / 100) : '…'}</strong>
                    {economia > 0 && <em>você economiza {reais(economia / 100)}</em>}
                  </div>
                  <ul className="ck-lista">
                    <li><Check size={14} /> {mesesEscolhidos === 1 ? '1 mês liberado na hora' : `${mesesEscolhidos} meses liberados na hora`}</li>
                    {mesesEscolhidos > 1 && <li><Check size={14} /> {mesesEscolhidos} × {reais(cheio / 100)} = {reais(semDesconto / 100)}, com {descontoPct}% OFF</li>}
                    <li><Check size={14} /> {mesesEscolhidos === 1 ? `${descontoPct}% de desconto na primeira mensalidade` : 'Pagamento único por Pix'}</li>
                    <li><Check size={14} /> Sem cartão, sem renovação automática</li>
                  </ul>
                  <button type="button" className="ck-botao ck-botao-pix" onClick={abrirPix} disabled={indo || !oferta}>
                    {indo ? <LoaderCircle className="ai-gira" size={18} /> : <PixIcone />} {indo ? 'Gerando o Pix…' : `Pagar ${oferta ? reais(oferta / 100) : ''} com Pix`}
                  </button>
                  <small className="ck-nota"><ShieldCheck size={12} /> Processado pelo Asaas. {mesesEscolhidos === 1 ? 'Os 20% da primeira mensalidade valem só agora, na ativação.' : 'Os planos de 6 e 12 meses têm desconto sempre.'}</small>
                </section>

                <div className="ck-ou"><span>ou</span></div>

                <section className="ck-opcao ck-teste">
                  <span className="ck-fita ck-fita-suave"><Sparkles size={13} /> Sem compromisso</span>
                  <h2>{REGRAS.testeDias} dias grátis</h2>
                  <p>Use tudo de verdade antes de decidir. Sem cartão e sem Pix agora.</p>
                  <button type="button" className="ck-botao ck-botao-teste" onClick={comecarTeste} disabled={indo}>
                    <Sparkles size={16} /> {indo ? 'Ativando…' : `Começar ${REGRAS.testeDias} dias grátis`}
                  </button>
                  <small className="ck-nota">Escolhendo o teste, os 20% da primeira mensalidade saem da mesa. Os planos de 6 e 12 meses continuam com desconto.</small>
                </section>
              </div>

              {erro && <div className="ai-erro ck-erro">{erro}</div>}
              <p className="ck-rodape">Depois da escolha, seu salão entra no ar e você segue para o painel.</p>
            </>
          ) : (
            <TelaPix
              pix={pix}
              total={Number(pix?.total_cents ?? oferta)}
              descontoPct={descontoPct}
              rotulo={(pix?.meses ?? mesesEscolhidos) === 12 ? 'Plano anual' : (pix?.meses ?? mesesEscolhidos) === 6 ? 'Plano semestral' : 'Primeira mensalidade'}
              indo={indo}
              erro={erro}
              onConferir={() => conferir(true)}
              onVoltar={trocarOpcao}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="ai-fundo" role="dialog" aria-modal="true" aria-label="Ativação do salão">
      <div className="ai-shell">
        <header className="ai-topo">
          <LogoMimo pro altura={36} />
          <span><ShieldCheck size={14} /> Sua configuração está salva</span>
        </header>

        <div className="ai-corpo ai-sucesso ai-sucesso-guiado">
          <span className="ai-sucesso-check"><Check size={30} /></span>
          <span className="ai-kicker">{sucesso?.fase === 'teste' ? 'Teste iniciado' : 'Pagamento confirmado'}</span>
          <h1>Agora sim. Seu salão está no ar. 🎉</h1>
          <p>
            {sucesso?.fase === 'teste'
              ? (sucesso?.ate
                ? `Seus ${REGRAS.testeDias} dias grátis começaram agora. Você pode usar tudo até ${dataCurta(sucesso.ate)}.`
                : `Seu teste está liberado. Os ${REGRAS.testeDias} dias só começam a contar quando a agenda estiver pronta. Até lá, configure tudo com calma.`)
              : `Sua primeira mensalidade está paga e a MIMO está liberada até ${dataCurta(sucesso?.ate)}.`}
          </p>

          <div className="ai-sucesso-itens">
            <span><Check size={14} /> Link do salão liberado</span>
            <span><Check size={14} /> QR Code pronto</span>
            <span><Check size={14} /> Painel liberado</span>
          </div>

          <section className="ai-proximo-passo">
            <div className="ai-proximo-topo">
              <span className="ai-proximo-icone"><Route size={18} /></span>
              <span>
                <strong>Quando entrar, a gente te guia.</strong>
                <small>O painel tem um tour rápido para deixar sua agenda pronta sem você precisar descobrir tudo sozinho.</small>
              </span>
            </div>

            <div className="ai-proximo-etapas" aria-label="Próximos passos no painel">
              <span><i><Tags size={15} /></i><b>1</b><em><strong>Categorias</strong><small>Organize o que seu salão oferece.</small></em></span>
              <span><i><Scissors size={15} /></i><b>2</b><em><strong>Serviços</strong><small>Cadastre preço, duração e detalhes.</small></em></span>
              <span><i><UsersRound size={15} /></i><b>3</b><em><strong>Profissionais</strong><small>Monte a equipe e as agendas.</small></em></span>
            </div>

            <p><Sparkles size={14} /> Você pode seguir o tour inteiro ou configurar no seu ritmo. Tudo fica salvo.</p>
          </section>

          <button type="button" className="btn btn-primary ai-botao-grande ai-entrar-tour" onClick={entrar}>
            Entrar no painel e começar <Rocket size={17} />
          </button>
          <small className="ai-sucesso-ajuda">Primeira vez na MIMO? Procure o guia de configuração no painel.</small>
        </div>
      </div>
    </div>
  )
}

// o Pix aberto: valor, status ao vivo, copiar (o principal no celular) e o QR (o principal no computador)
function TelaPix({ pix, total, descontoPct, rotulo = 'Primeira mensalidade', indo, erro, onConferir, onVoltar }) {
  const [qr, setQr] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [verQr, setVerQr] = useState(false)
  const codigo = pix?.copia_cola || ''
  useEffect(() => {
    if (!codigo || pix?.imagem) return
    let vivo = true
    QRCode.toDataURL(codigo, { width: 520, margin: 1, color: { dark: '#2b0b1c', light: '#ffffff' } }).then((d) => { if (vivo) setQr(d) }).catch(() => {})
    return () => { vivo = false }
  }, [codigo, pix?.imagem])
  const imagem = pix?.imagem ? `data:image/png;base64,${pix.imagem}` : qr
  async function copiar() {
    try { await navigator.clipboard.writeText(codigo) } catch {
      const t = document.createElement('textarea'); t.value = codigo; document.body.appendChild(t); t.select()
      try { document.execCommand('copy') } catch { /* sem cópia: o código está na caixa */ }
      t.remove()
    }
    setCopiado(true); setTimeout(() => setCopiado(false), 2500)
  }
  return (
    <section className="ck-pix" aria-label="Pagamento por Pix">
      <button type="button" className="ck-voltar" onClick={onVoltar} disabled={indo}><ArrowLeft size={16} /> Voltar às opções</button>

      <div className="ck-pix-cabeca">
        <span className="ck-pix-icone"><PixIcone /></span>
        <span>
          <small>{rotulo} · {descontoPct}% OFF</small>
          <strong>{reais(total / 100)}</strong>
        </span>
        {pix?.sandbox && <span className="ck-teste-tag">ambiente de testes</span>}
      </div>

      <div className="ck-status" role="status">
        <i />
        <span><b>Aguardando o pagamento</b><small>A tela confere sozinha. Pagou, liberou.</small></span>
      </div>

      {!codigo ? (
        <p className="ck-gerando"><LoaderCircle className="ai-gira" size={18} /> Gerando seu Pix…</p>
      ) : (
        <>
          <div className="ck-copia">
            <span className="ck-copia-codigo">{codigo}</span>
            <button type="button" className={'ck-botao ck-botao-pix' + (copiado ? ' ok' : '')} onClick={copiar}>
              {copiado ? <><Check size={18} /> Código copiado</> : <><Copy size={18} /> Copiar código Pix</>}
            </button>
          </div>

          <div className={'ck-qr' + (verQr ? ' aberto' : '')}>
            <button type="button" className="ck-qr-abrir" onClick={() => setVerQr((v) => !v)}><QrCode size={16} /> {verQr ? 'Esconder o QR Code' : 'Pagar com QR Code (em outro aparelho)'}</button>
            <div className="ck-qr-img">{imagem ? <img src={imagem} alt="QR Code do Pix" /> : <i />}<small>Abra o app do banco e escaneie</small></div>
          </div>

          <ol className="ck-passos">
            <li><b>1</b><span><strong>Copie o código</strong><small>ou escaneie o QR</small></span></li>
            <li><b>2</b><span><strong>No app do banco</strong><small>Pix › Copia e cola</small></span></li>
            <li><b>3</b><span><strong>Volte aqui</strong><small>libera sozinho</small></span></li>
          </ol>
        </>
      )}

      {erro && <div className="ai-erro ck-erro">{erro}</div>}

      <button type="button" className="ck-botao ck-botao-claro" onClick={onConferir} disabled={indo || !codigo}>
        {indo ? <><LoaderCircle className="ai-gira" size={16} /> Conferindo…</> : <><Zap size={16} /> Já paguei, conferir agora</>}
      </button>

      <div className="ck-seguro">
        <ShieldCheck size={15} />
        <span><strong>Pagamento único e protegido</strong><small>Processado pelo Asaas. Sem débito automático e sem renovação. <Clock size={11} /> O código vale por hoje.</small></span>
      </div>
    </section>
  )
}

// o losango do Pix, desenhado (sem depender de imagem)
function PixIcone() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M12 2.8 21.2 12 12 21.2 2.8 12Z" />
      <path d="M7.6 9.6 10 12l-2.4 2.4M16.4 9.6 14 12l2.4 2.4" />
    </svg>
  )
}
