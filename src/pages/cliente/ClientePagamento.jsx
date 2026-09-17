import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { Copy, Check, Clock, ShieldCheck } from 'lucide-react'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useDialogo } from '../../context/DialogoContext'
import { chamar, formatCents, COMO_FUNCIONA } from '../../lib/pagamento'
import { formatDataLonga } from '../../lib/booking'

// A tela do PIX (090): QR, copia e cola, o relógio dos 15 minutos e a
// confirmação ao vivo. Chega aqui quem marcou num salão que cobra na
// hora, ou quem tocou em "Pagar agora" num horário já marcado.
export default function ClientePagamento() {
  const { appt } = useParams()
  const { user, profile, recarregarPerfil } = useAuth()
  const { confirmar } = useDialogo()
  const navigate = useNavigate()
  const [a, setA] = useState(null)
  const [pg, setPg] = useState(null)          // { pagamento_id, copia_cola, valor_cents, expira_em }
  const [pedirCpf, setPedirCpf] = useState(false)
  const [cpf, setCpf] = useState(profile?.cpf ?? '')
  const [erro, setErro] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [restante, setRestante] = useState(null)
  const [estado, setEstado] = useState('gerando')   // gerando | aguardando | pago | expirado | erro
  const canvas = useRef(null)

  useEffect(() => {
    supabase.from('appointments').select('id, status, date, start_time, price_cents, service_name, pago_cents, services (name), professionals (name)').eq('id', appt).eq('client_id', user.id).maybeSingle()
      .then(({ data }) => setA(data ?? null))
  }, [appt, user.id])

  const gerar = useCallback(async () => {
    setErro(''); setEstado('gerando')
    try {
      const r = await chamar('pagamento-criar', { appointment_id: appt })
      if (r?.ok === false && r.motivo === 'sem_cpf') { setPedirCpf(true); setEstado('cpf'); return }
      if (r?.ok === false) { setErro(r.motivo); setEstado('erro'); return }
      setPg(r); setEstado('aguardando')
    } catch (e) { setErro(e.message); setEstado('erro') }
  }, [appt])
  useEffect(() => { gerar() }, [gerar])

  // o QR, desenhado aqui mesmo a partir do copia e cola
  useEffect(() => {
    if (!pg?.copia_cola || !canvas.current) return
    QRCode.toCanvas(canvas.current, pg.copia_cola, { width: 220, margin: 1, color: { dark: '#1f2026', light: '#ffffff' } }).catch(() => {})
  }, [pg?.copia_cola, estado])

  // o relógio e a confirmação: pergunta ao banco a cada 4 s
  useEffect(() => {
    if (estado !== 'aguardando' || !pg?.pagamento_id) return
    const tick = async () => {
      if (pg.expira_em) setRestante(Math.max(0, Math.floor((new Date(pg.expira_em) - Date.now()) / 1000)))
      const { data } = await supabase.from('pagamentos').select('status').eq('id', pg.pagamento_id).maybeSingle()
      if (data?.status === 'pago') { setEstado('pago'); setTimeout(() => navigate(`/cliente/agendamento/sucesso/${appt}`, { replace: true }), 1200) }
      else if (data?.status === 'expirado' || data?.status === 'cancelado') setEstado('expirado')
    }
    tick()
    const t = setInterval(tick, 4000)
    return () => clearInterval(t)
  }, [estado, pg?.pagamento_id, pg?.expira_em, appt, navigate])

  async function salvarCpf(e) {
    e.preventDefault()
    const d = cpf.replace(/\D/g, '')
    if (!cpfValido(d)) { setErro('Confira o CPF: parece que tem um número errado.'); return }
    const { error } = await supabase.from('profiles').update({ cpf: d }).eq('id', user.id)
    if (error) { setErro(error.message); return }
    setPedirCpf(false); recarregarPerfil?.(); gerar()
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

  const sinal = a && pg && (pg.sinal_pct ? pg.sinal_pct < 100 : pg.valor_cents < a.price_cents)
  const minutos = restante != null ? `${String(Math.floor(restante / 60)).padStart(2, '0')}:${String(restante % 60).padStart(2, '0')}` : null

  return (
    <ClienteShell titulo="Pagar pelo app" voltar={`/cliente/agendamento/${appt}`}>
      {a && (
        <div className="card resumo-pedido pag-resumo">
          <div className="resumo-linha"><span className="muted">Serviço</span><strong>{a.service_name ?? a.services?.name}</strong></div>
          <div className="resumo-linha"><span className="muted">Com</span><strong>{a.professionals?.name}</strong></div>
          <div className="resumo-linha"><span className="muted">Quando</span><strong>{formatDataLonga(a.date)} às {a.start_time?.slice(0, 5)}</strong></div>
          {pg && <div className="resumo-linha resumo-total"><span>{sinal ? `Sinal (${pg.sinal_pct ?? Math.round(pg.valor_cents / a.price_cents * 100)}%)` : 'Valor'}</span><strong>{formatCents(pg.valor_cents)}</strong></div>}
          {sinal && <p className="muted pag-resto">O restante, {formatCents(a.price_cents - pg.valor_cents)}, você acerta no atendimento.</p>}
        </div>
      )}

      {erro && <div className="alert alert-error">{erro}</div>}

      {estado === 'cpf' && pedirCpf && (
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
          <p className="muted pag-espera">Assim que o PIX cair, esta tela confirma sozinha.</p>
          <button type="button" className="link-ver pag-desistir" onClick={desistir}>Desistir do horário</button>
          {pg.sandbox && <button type="button" className="btn btn-ghost btn-block pag-simular" onClick={simular} disabled={simulando}>{simulando ? 'Simulando…' : 'Simular pagamento (teste)'}</button>}
          {simulado && <p className="muted pag-espera">{simulado}</p>}
        </div>
      )}

      {estado === 'pago' && (
        <div className="card sucesso pag-pago">
          <span className="sucesso-check" aria-hidden="true"><Check /></span>
          <h2>Pagamento confirmado!</h2>
          <p className="muted">Seu horário já está confirmado na agenda da profissional.</p>
        </div>
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
          <button type="button" className="btn btn-primary btn-block" onClick={gerar}>Tentar de novo</button>
          <Link to={`/cliente/agendamento/${appt}`} className="btn btn-ghost btn-block">Ver o horário</Link>
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
