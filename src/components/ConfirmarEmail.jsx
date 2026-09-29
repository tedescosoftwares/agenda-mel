import { useEffect, useRef, useState } from 'react'
import { Check, Mail, RefreshCw, KeyRound } from 'lucide-react'
import { supabase, isDemo } from '../lib/supabase'

// Depois do cadastro (129/131): a conta existe, falta o e-mail. Três jeitos
// de seguir, sem sair daqui:
//   1. ela toca no link do e-mail em qualquer aparelho: esta tela percebe
//      (tenta entrar com a senha a cada 5 s) e segue sozinha;
//   2. ela digita o código de 6 dígitos que vai no mesmo e-mail;
//   3. o link abre no próprio navegador: entra logada e cai no lugar certo.
// `onPronto()` é chamado com a sessão já aberta.
export default function ConfirmarEmail({ email, senha, onPronto, redirecionar }) {
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)
  const [reenviado, setReenviado] = useState(0)   // segundos até poder reenviar de novo
  const [pronta, setPronta] = useState(false)
  const timer = useRef(null)

  async function tentarEntrar(avisar = false) {
    if (isDemo) { setPronta(true); return true }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha })
    if (data?.session) { setPronta(true); return true }
    if (avisar) setErro(/not confirmed/i.test(error?.message ?? '') ? 'Ainda não chegou a confirmação. Abra o e-mail e toque no link, ou digite o código.' : (error?.message ?? 'Não deu para entrar.'))
    return false
  }
  // percebe sozinha quando o link foi tocado em outro aparelho
  useEffect(() => {
    if (!senha || pronta) return
    timer.current = setInterval(() => { tentarEntrar(false) }, 5000)
    return () => clearInterval(timer.current)
  }, [senha, pronta]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (pronta) { clearInterval(timer.current); onPronto?.() } }, [pronta]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (reenviado <= 0) return; const t = setTimeout(() => setReenviado((s) => s - 1), 1000); return () => clearTimeout(t) }, [reenviado])

  async function confirmarCodigo(e) {
    e?.preventDefault?.()
    const t = codigo.replace(/\D/g, '')
    if (t.length < 6) { setErro('O código tem 6 números.'); return }
    setIndo(true); setErro('')
    try {
      if (isDemo) { setPronta(true); return }
      const { data, error } = await supabase.auth.verifyOtp({ email, token: t, type: 'signup' })
      if (error) { setErro(/expired|invalid/i.test(error.message) ? 'Código errado ou vencido. Confira o e-mail mais recente ou peça outro.' : error.message); return }
      if (data?.session) setPronta(true)
      else await tentarEntrar(true)
    } finally { setIndo(false) }
  }
  async function reenviar() {
    setErro('')
    if (isDemo) { setReenviado(60); return }
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: redirecionar ? { emailRedirectTo: redirecionar } : undefined })
    if (error) { setErro(/rate limit/i.test(error.message) ? 'Calma: espere um minuto pra pedir outro.' : error.message); return }
    setReenviado(60)
  }

  if (pronta) {
    return (
      <div className="ce-caixa">
        <span className="ce-check"><Check size={20} /></span>
        <h1 className="ob-titulo">E-mail confirmado</h1>
        <p className="ob-sub">Entrando…</p>
      </div>
    )
  }
  return (
    <div className="ce-caixa">
      <span className="ce-icone"><Mail size={22} /></span>
      <h1 className="ob-titulo">Confira seu e-mail</h1>
      <p className="ob-sub">Mandamos um link e um código pra <strong>{email}</strong>. Toque no link em qualquer aparelho, ou digite o código aqui. Assim que confirmar, esta tela segue sozinha.</p>
      <form className="ce-codigo" onSubmit={confirmarCodigo}>
        <label><KeyRound size={14} /> Código de 6 números
          <input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} autoFocus />
        </label>
        <button type="submit" className="btn btn-primary" disabled={indo || codigo.length < 6}>{indo ? 'Conferindo…' : 'Confirmar'}</button>
      </form>
      {erro && <div className="alert alert-error">{erro}</div>}
      <p className="muted ce-espera"><RefreshCw size={13} className="ce-gira" /> Esperando a confirmação… Não achou o e-mail? Olhe o spam.</p>
      <div className="ce-acoes">
        <button type="button" className="btn btn-ghost btn-mini" onClick={reenviar} disabled={reenviado > 0}>{reenviado > 0 ? `Reenviar em ${reenviado}s` : 'Reenviar e-mail'}</button>
        <button type="button" className="btn btn-ghost btn-mini" onClick={() => tentarEntrar(true)}>Já confirmei</button>
      </div>
    </div>
  )
}
