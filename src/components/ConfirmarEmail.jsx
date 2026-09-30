import { useEffect, useRef, useState } from 'react'
import { Check, Mail, RefreshCw } from 'lucide-react'
import { supabase, isDemo } from '../lib/supabase'

// Depois do cadastro (129/131, 2.81.2): a conta existe, falta o e-mail.
// Só o link: ela toca nele em qualquer aparelho, cai na página "E-mail
// confirmado", e esta tela percebe sozinha (tenta entrar com a senha a
// cada 5 s) e segue. Sem código pra digitar: o do e-mail e o da tela
// nunca batiam. `onPronto()` é chamado com a sessão já aberta.
export default function ConfirmarEmail({ email, senha, onPronto, redirecionar }) {
  const [erro, setErro] = useState('')
  const [reenviado, setReenviado] = useState(0)   // segundos até poder reenviar de novo
  const [pronta, setPronta] = useState(false)
  const [conferindo, setConferindo] = useState(false)
  const timer = useRef(null)

  async function tentarEntrar(avisar = false) {
    if (isDemo) { setPronta(true); return true }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha })
    if (data?.session) { setPronta(true); return true }
    if (avisar) setErro(/not confirmed/i.test(error?.message ?? '') ? 'Ainda não chegou a confirmação. Abra o e-mail e toque no botão "Confirmar meu e-mail".' : (error?.message ?? 'Não deu para entrar.'))
    return false
  }
  // percebe sozinha quando o link foi tocado (aqui ou em outro aparelho)
  useEffect(() => {
    if (!senha || pronta) return
    timer.current = setInterval(() => { tentarEntrar(false) }, 5000)
    return () => clearInterval(timer.current)
  }, [senha, pronta]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (pronta) { clearInterval(timer.current); onPronto?.() } }, [pronta]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (reenviado <= 0) return; const t = setTimeout(() => setReenviado((s) => s - 1), 1000); return () => clearTimeout(t) }, [reenviado])

  async function reenviar() {
    setErro('')
    if (isDemo) { setReenviado(60); return }
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: redirecionar ? { emailRedirectTo: redirecionar } : undefined })
    if (error) { setErro(/rate limit/i.test(error.message) ? 'Calma: espere um minuto pra pedir outro.' : error.message); return }
    setReenviado(60)
  }
  async function jaConfirmei() { setConferindo(true); await tentarEntrar(true); setConferindo(false) }

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
      <p className="ob-sub">Mandamos um link pra <strong>{email}</strong>. Toque em <strong>"Confirmar meu e-mail"</strong>, em qualquer aparelho. Assim que confirmar, esta tela segue sozinha.</p>
      {erro && <div className="alert alert-error">{erro}</div>}
      <p className="muted ce-espera"><RefreshCw size={13} className="ce-gira" /> Esperando a confirmação… Não achou o e-mail? Olhe o spam.</p>
      <div className="ce-acoes">
        <button type="button" className="btn btn-ghost btn-mini" onClick={reenviar} disabled={reenviado > 0}>{reenviado > 0 ? `Reenviar em ${reenviado}s` : 'Reenviar e-mail'}</button>
        <button type="button" className="btn btn-primary btn-mini" onClick={jaConfirmei} disabled={conferindo}>{conferindo ? 'Conferindo…' : 'Já confirmei'}</button>
      </div>
    </div>
  )
}
