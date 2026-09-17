import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { Copy, Check, Clock, ShieldCheck, Receipt } from 'lucide-react'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useDialogo } from '../../context/DialogoContext'
import { chamar, formatCents, COMO_FUNCIONA, POLITICAS, CREDITO_DIAS, TERMOS_VERSAO, TAXA_PIX_TEXTO } from '../../lib/pagamento'
import { formatDataLonga } from '../../lib/booking'

// A tela do PIX (090, 096). Em ordem: o resumo do que ela está pagando
// (cada serviço, o sinal, o resto no atendimento), as condições com o
// "li e aceito", o QR com o relógio dos 15 minutos, e o comprovante.
// Depois de pago ela vê o comprovante e segue pelo botão; não pula sozinha.
export default function ClientePagamento() {
  const { appt } = useParams()
  const { user, profile, recarregarPerfil } = useAuth()
  const { confirmar } = useDialogo()
  const navigate = useNavigate()
  const [a, setA] = useState(null)
  const [itens, setItens] = useState([])
  const [regras, setRegras] = useState(null)      // pagamento_do_salao: sinal_pct, politica
  const [pg, setPg] = useState(null)              // { pagamento_id, copia_cola, valor_cents, expira_em }
  const [pago, setPago] = useState(null)          // o pagamento confirmado (comprovante)
  const [cpf, setCpf] = useState(profile?.cpf ?? '')
  const [aceite, setAceite] = useState(false)
  const [erro, setErro] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [restante, setRestante] = useState(null)
  const [estado, setEstado] = useState('carregando')   // carregando | resumo | cpf | gerando | aguardando | pago | expirado | erro
  const canvas = useRef(null)

  // o horário, os serviços e as regras da casa; se já está pago, vai direto ao comprovante
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data } = await supabase.from('appointments').select('id, status, date, start_time, price_cents, service_name, pago_cents, salon_id, services (name), professionals (name), salons (name)').eq('id', appt).eq('client_id', user.id).maybeSingle()
      if (!vivo) return
      setA(data ?? null)
      if (!data) { setEstado('erro'); setErro('Não encontramos esse horário.'); return }
      const [{ data: it }, { data: r }, { data: pgs }] = await Promise.all([
        supabase.from('appointment_services').select('id, name, price_cents, preco_cheio_cents, ordem').eq('appointment_id', data.id).order('ordem'),
        data.salon_id ? supabase.rpc('pagamento_do_salao', { salao: data.salon_id }) : Promise.resolve({ data: null }),
        supabase.from('pagamentos').select('id, status, valor_cents, total_cents, sinal_pct, pago_em, cobranca_id, termos_aceitos_em').eq('appointment_id', data.id).eq('status', 'pago').order('pago_em', { ascending: false }).limit(1),
      ])
      if (!vivo) return
      setItens(it ?? [])
      setRegras(r ?? null)
      if (pgs?.[0]) { setPago(pgs[0]); setEstado('pago') } else setEstado('resumo')
    })()
    return () => { vivo = false }
  }, [appt, user.id])

  const gerar = useCallback(async () => {
    setErro(''); setEstado('gerando')
    try {
      const r = await chamar('pagamento-criar', { appointment_id: appt, aceite: true, termos_versao: TERMOS_VERSAO })
      if (r?.ok === false && r.motivo === 'sem_cpf') { setEstado('cpf'); return }
      if (r?.ok === false) { setErro(r.motivo); setEstado('erro'); return }
      setPg(r); setEstado('aguardando')
    } catch (e) { setErro(e.message); setEstado('erro') }
  }, [appt])

  // o QR, desenhado aqui mesmo a partir do copia e cola
  useEffect(() => {
    if (!pg?.copia_cola || !canvas.current) return
    QRCode.toCanvas(canvas.current, pg.copia_cola, { width: 220, margin: 1, color: { dark: '#1f2026', light: '#ffffff' } }).catch(() => {})
  }, [pg?.copia_cola, estado])

  // o relógio e a confirmação: pergunta ao banco a cada 4 s; pago vira comprovante
  useEffect(() => {
    if (estado !== 'aguardando' || !pg?.pagamento_id) return
    const tick = async () => {
      if (pg.expira_em) setRestante(Math.max(0, Math.floor((new Date(pg.expira_em) - Date.now()) / 1000)))
      const { data } = await supabase.from('pagamentos').select('id, status, valor_cents, total_cents, sinal_pct, pago_em, cobranca_id, termos_aceitos_em').eq('id', pg.pagamento_id).maybeSingle()
      if (data?.status === 'pago') { setPago(data); setEstado('pago') }
      else if (data?.status === 'expirado' || data?.status === 'cancelado') setEstado('expirado')
    }
    tick()
    const t = setInterval(tick, 4000)
    return () => clearInterval(t)
  }, [estado, pg?.pagamento_id, pg?.expira_em])

  async function salvarCpf(e) {
    e.preventDefault()
    const d = cpf.replace(/\D/g, '')
    if (!cpfValido(d)) { setErro('Confira o CPF: parece que tem um número errado.'); return }
    const { error } = await supabase.from('profiles').update({ cpf: d }).eq('id', user.id)
    if (error) { setErro(error.message); return }
    recarregarPerfil?.(); gerar()
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(pg.copia_cola); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { /* sem clipboard */ }
  }

  const [simulando, setSimulando] = useState(false)
  const [simulado, setSimulado] = useState('')
  async function simular() {
    setSimulando(true); setErro('')
    try {
      const r = await chamar('pagamento-criar', { appointment_id: appt, simular: true })
      setSimulado(r?.jeito === 'pix' && r.pendente ? (r.repetida ? 'Já existe uma transação esperando autorização no painel do sandbox da conta MIMO. Aprove lá com o token 000000; não criei outra.' : 'A conta MIMO do sandbox pediu autorização (ação crítica). Aprove no painel com o token 000000 e esta tela confirma sozinha. Não toque de novo: cada toque criaria outra transação.')
        : r?.jeito === 'pix' ? 'Pago com o saldo da conta MIMO do sandbox: o dinheiro entrou de verdade na conta da profissional (no sandbox).'
        : 'A conta MIMO do sandbox não tinha saldo' + (r?.motivo_pix ? ` (${r.motivo_pix})` : '') + ', então a cobrança foi baixada como "recebida em dinheiro". Não gera saldo; a devolução, se houver, desfaz a baixa.')
    } catch (e) { setErro(e.message) } finally { setSimulando(false) }
  }

  async function desistir() {
    if (!(await confirmar({ titulo: 'Desistir do horário?', texto: 'A vaga volta a ficar livre para outra pessoa.', ok: 'Desistir', cancelar: 'Continuar pagando', perigo: true }))) return
    await supabase.from('appointments').update({ status: 'cancelado' }).eq('id', appt)
    navigate('/cliente/home', { replace: true })
  }

  // a prévia do que ela vai pagar: o banco confirma na hora de gerar
  const total = a?.price_cents ?? 0
  const pct = pg?.sinal_pct ?? regras?.sinal_pct ?? 100
  const agora = pg?.valor_cents ?? (total > 0 ? Math.max(100, Math.round(total * pct / 100)) : 0)
  const resto = Math.max(0, total - agora)
  const pol = POLITICAS[regras?.politica] ?? POLITICAS.moderada
  const minutos = restante != null ? `${String(Math.floor(restante / 60)).padStart(2, '0')}:${String(restante % 60).padStart(2, '0')}` : null
  const voltar = estado === 'pago' ? `/cliente/agendamento/${appt}` : `/cliente/agendamento/${appt}`

  const resumo = a && (
    <div className="card resumo-pedido pag-resumo">
      <div className="resumo-linha"><span className="muted">Com</span><strong>{a.professionals?.name}{a.salons?.name && a.salons.name !== a.professionals?.name ? ` · ${a.salons.name}` : ''}</strong></div>
      <div className="resumo-linha"><span className="muted">Data</span><strong>{formatDataLonga(a.date)}</strong></div>
      <div className="resumo-linha"><span className="muted">Horário</span><strong>{a.start_time?.slice(0, 5)}</strong></div>
      {itens.length > 0 ? itens.map((x) => (
        <div key={x.id} className="resumo-linha pag-item"><span>{x.name}</span><span>{x.preco_cheio_cents > x.price_cents ? <><s className="muted">{formatCents(x.preco_cheio_cents)}</s> </> : null}{formatCents(x.price_cents)}</span></div>
      )) : (
        <div className="resumo-linha pag-item"><span>{a.service_name ?? a.services?.name}</span><span>{formatCents(total)}</span></div>
      )}
      <div className="resumo-linha"><span className="muted">Total dos serviços</span><strong>{formatCents(total)}</strong></div>
      <div className="resumo-linha resumo-total"><span>{pct < 100 ? `Sinal de ${pct}%, agora por PIX` : 'Agora por PIX'}</span><strong>{formatCents(agora)}</strong></div>
      {resto > 0 && <p className="muted pag-resto">O restante, {formatCents(resto)}, você acerta no atendimento.</p>}
    </div>
  )

  return (
    <ClienteShell titulo={estado === 'pago' ? 'Comprovante' : 'Pagar pelo app'} voltar={voltar}>
      {estado !== 'pago' && resumo}

      {erro && <div className="alert alert-error">{erro}</div>}

      {estado === 'carregando' && <p className="carregando">Carregando…</p>}

      {estado === 'resumo' && a && (
        <div className="card pag-termos">
          <strong>Antes de pagar, combinado é combinado</strong>
          <ul>
            <li>O PIX vai para a conta de recebimento de <strong>{a.salons?.name ?? a.professionals?.name}</strong>, processado por {COMO_FUNCIONA.provedor.split(' ')[0]}. A vaga fica guardada por 15 minutos enquanto o PIX não cai; caiu, o horário está confirmado.</li>
            <li>Cancelando até <strong>{pol.horas} h antes</strong> (política {pol.rotulo.toLowerCase()}), o valor volta para a sua conta em até 1 dia útil, <strong>menos a taxa do PIX ({TAXA_PIX_TEXTO})</strong>, que o processador não devolve. Se você pagar já dentro do prazo, ainda pode desistir com devolução em até 1 hora depois de pagar.</li>
            <li>Depois desse prazo, o sinal não é devolvido: vira <strong>crédito por {CREDITO_DIAS} dias</strong> para marcar de novo com a mesma casa. Sem uso nesse período, fica com a casa. Remarcar leva o sinal junto, em qualquer prazo.</li>
            <li>Se for a profissional quem cancelar, o valor volta também, menos a taxa do PIX.</li>
            {resto > 0 && <li>O restante, {formatCents(resto)}, é pago no atendimento, direto com a profissional.</li>}
          </ul>
          <label className="pag-escolha-check">
            <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
            <span><strong>Li e aceito as condições</strong> <span className="muted">de pagamento, devolução e crédito descritas acima.</span></span>
          </label>
          <button type="button" className="btn btn-primary btn-block" disabled={!aceite} onClick={gerar}>Gerar o PIX de {formatCents(agora)}</button>
          <button type="button" className="link-ver pag-desistir" onClick={desistir}>Desistir do horário</button>
        </div>
      )}

      {estado === 'cpf' && (
        <form className="card form pag-cpf" onSubmit={salvarCpf}>
          <strong>Só uma vez: seu CPF</strong>
          <p className="muted">O PIX precisa do CPF de quem paga. Fica guardado para as próximas vezes e não aparece para a profissional.</p>
          <label>CPF<input inputMode="numeric" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(e.target.value)} autoFocus /></label>
          <button className="btn btn-primary btn-block">Continuar para o PIX</button>
        </form>
      )}

      {estado === 'gerando' && <div className="card empty-state"><p className="muted">Gerando o seu PIX…</p></div>}

      {estado === 'aguardando' && pg && (
        <div className="card pag-pix">
          <canvas ref={canvas} className="pag-qr" />
          <p className="muted pag-instrucao">Abra o app do seu banco, escolha <strong>Pix, ler QR code</strong> e aponte a câmera. Ou copie o código:</p>
          <button type="button" className={'btn btn-block ' + (copiado ? 'btn-ghost' : 'btn-primary')} onClick={copiar}>{copiado ? <><Check size={16} /> Copiado!</> : <><Copy size={16} /> Copiar código PIX</>}</button>
          {minutos && <p className="pag-relogio"><Clock size={14} /> {restante > 0 ? <>Reserva guardada por <strong>{minutos}</strong></> : 'A reserva venceu'}</p>}
          <p className="muted pag-espera">Assim que o PIX cair, esta tela mostra o comprovante.</p>
          <button type="button" className="link-ver pag-desistir" onClick={desistir}>Desistir do horário</button>
          {pg.sandbox && <button type="button" className="btn btn-ghost btn-block pag-simular" onClick={simular} disabled={simulando}>{simulando ? 'Simulando…' : 'Simular pagamento (teste)'}</button>}
          {simulado && <p className="muted pag-espera">{simulado}</p>}
        </div>
      )}

      {estado === 'pago' && a && pago && (
        <>
          <div className="card sucesso pag-pago">
            <span className="sucesso-check" aria-hidden="true"><Check /></span>
            <h2>Pagamento confirmado!</h2>
            <p className="muted">Seu horário já está confirmado na agenda da profissional.</p>
          </div>
          <div className="card pag-comprovante">
            <div className="pag-comprovante-topo"><Receipt size={18} /><strong>Comprovante</strong></div>
            <div className="resumo-linha"><span className="muted">Valor pago</span><strong>{formatCents(pago.valor_cents)}{pago.sinal_pct && pago.sinal_pct < 100 ? ` (sinal de ${pago.sinal_pct}%)` : ''}</strong></div>
            <div className="resumo-linha"><span className="muted">Forma</span><strong>PIX</strong></div>
            <div className="resumo-linha"><span className="muted">Pago em</span><strong>{pago.pago_em ? new Date(pago.pago_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</strong></div>
            {a.salons?.name && a.salons.name !== a.professionals?.name && <div className="resumo-linha"><span className="muted">Para</span><strong>{a.salons.name}</strong></div>}
            <div className="resumo-linha"><span className="muted">Com</span><strong>{a.professionals?.name}</strong></div>
            <div className="resumo-linha"><span className="muted">Data</span><strong>{formatDataLonga(a.date)}</strong></div>
            <div className="resumo-linha"><span className="muted">Horário</span><strong>{a.start_time?.slice(0, 5)}</strong></div>
            {itens.length > 0 ? itens.map((x) => (
              <div key={x.id} className="resumo-linha pag-item"><span>{x.name}</span><span>{formatCents(x.price_cents)}</span></div>
            )) : (
              <div className="resumo-linha pag-item"><span>{a.service_name ?? a.services?.name}</span><span>{formatCents(total)}</span></div>
            )}
            <div className="resumo-linha"><span className="muted">Total dos serviços</span><strong>{formatCents(pago.total_cents ?? total)}</strong></div>
            {(pago.total_cents ?? total) - pago.valor_cents > 0 && <div className="resumo-linha"><span className="muted">Restante no atendimento</span><strong>{formatCents((pago.total_cents ?? total) - pago.valor_cents)}</strong></div>}
            {pago.cobranca_id && <p className="muted pag-comprovante-id">Identificação do pagamento: {pago.cobranca_id}</p>}
            {pago.termos_aceitos_em && <p className="muted pag-comprovante-id">Condições aceitas em {new Date(pago.termos_aceitos_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.</p>}
          </div>
          <Link to={`/cliente/agendamento/sucesso/${appt}`} className="btn btn-primary btn-block">Tudo certo, seguir</Link>
          <Link to={`/cliente/agendamento/${appt}`} className="btn btn-ghost btn-block">Ver o horário</Link>
        </>
      )}

      {estado === 'expirado' && (
        <div className="card empty-state">
          <p><strong>A reserva venceu.</strong></p>
          <p className="muted">O PIX não chegou a tempo e o horário voltou a ficar livre. Se ainda quiser, marque de novo.</p>
          <Link to="/cliente/home" className="btn btn-primary btn-block">Voltar ao início</Link>
        </div>
      )}

      {estado === 'erro' && (
        <div className="card empty-state">
          {a && <button type="button" className="btn btn-primary btn-block" onClick={() => { setErro(''); setEstado('resumo') }}>Tentar de novo</button>}
          <Link to={a ? `/cliente/agendamento/${appt}` : '/cliente/home'} className="btn btn-ghost btn-block">{a ? 'Ver o horário' : 'Voltar ao início'}</Link>
        </div>
      )}

      <p className="muted pag-rodape"><ShieldCheck size={13} /> Pagamento processado por {COMO_FUNCIONA.provedor.split(' ')[0]}, instituição autorizada pelo Banco Central.</p>
    </ClienteShell>
  )
}

function cpfValido(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}
