import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { homeDoPapel } from '../../lib/roles'
import { supabase } from '../../lib/supabase'
import { extrairCodigo, guardarConvite } from '../../lib/convite'
import { formatarFone, foneValido } from '../../lib/fone'
import { TERMOS_VERSAO } from '../../lib/termos'
import { iniciais } from '../../lib/booking'
import CampoSenha from '../../components/CampoSenha'
import RodapeSocial from '../../components/RodapeSocial'
import { MarcaIcon, Wordmark } from '../../components/icons'
import { MailCheck } from 'lucide-react'

// O cadastro da cliente (065). Sempre nasce de um convite: QR, código
// ou link de uma profissional ou salão. Dois passos curtos — quem é
// você, e como você entra — e no fim a tela de "confira seu e-mail",
// com reenvio. O convite vai nos metadados e o servidor cria o vínculo
// quando o perfil nasce (053); aniversário e aceite também (065).
export default function CadastroCliente() {
  const { user, role, loading, signUp } = useAuth()
  const [q] = useSearchParams()
  const convite = extrairCodigo(q.get('convite'))
  const [quem, setQuem] = useState(undefined)
  const [passo, setPasso] = useState(1)
  const [nome, setNome] = useState('')
  const [fone, setFone] = useState('')
  const [nasc, setNasc] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [termos, setTermos] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [pronto, setPronto] = useState(false)
  const [reenviado, setReenviado] = useState('')

  useEffect(() => {
    if (!convite) { setQuem(null); return }
    guardarConvite(convite)
    supabase.rpc('resolver_codigo', { chave: convite }).then(({ data }) => setQuem(data ?? null))
  }, [convite])

  if (loading || quem === undefined) return <div className="page-center"><p className="muted">Carregando…</p></div>
  if (user) return <Navigate to={homeDoPapel(role)} replace />
  if (!convite) return <Navigate to="/entrar" replace />

  function seguir(e) {
    e.preventDefault(); setErro('')
    if (nome.trim().split(' ').length < 2) { setErro('Diga seu nome e sobrenome, do jeito que a profissional te conhece.'); return }
    if (!foneValido(fone)) { setErro('Confere o WhatsApp: DDD + 9 dígitos, como (13) 99999-9999.'); return }
    if (nasc && !nascimentoOk(nasc)) { setErro('Confere a data de aniversário.'); return }
    setPasso(2)
  }

  async function criar(e) {
    e.preventDefault(); setErro('')
    if (!termos) { setErro('Para criar a conta, é preciso aceitar os Termos e a Política de privacidade.'); return }
    setEnviando(true)
    const extra = { codigo_convite: convite, termos: TERMOS_VERSAO }
    if (nasc) extra.nascimento = nasc
    const { error } = await signUp(email.trim(), senha, nome.trim(), formatarFone(fone), extra)
    setEnviando(false)
    if (error) { setErro(traduz(error.message)); return }
    setPronto(true)
  }

  async function reenviar() {
    setReenviado('')
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() })
    setReenviado(error ? 'Não deu para reenviar agora. Tente em um minuto.' : 'Reenviado! Olha a caixa de entrada e o spam.')
  }

  const primeiroNome = quem?.nome ? quem.nome.split(' ')[0] : ''

  return (
    <div className="page-center login-bg">
      <div className="card login-card cad-card">
        <div className="brand">
          <MarcaIcon className="brand-icon" width={44} height={40} id="cadastro" />
          <Wordmark tamanho={2.2} />
        </div>

        {pronto ? (
          <div className="cad-pronto">
            <span className="cad-pronto-icone" aria-hidden="true"><MailCheck size={44} strokeWidth={1.6} /></span>
            <h2 className="login-titulo">Falta só confirmar</h2>
            <p className="muted login-sub">Mandamos um e-mail para <strong>{email.trim()}</strong>. Toca no botão que está nele e a sua conta abre já dentro da agenda {primeiroNome ? `de ${primeiroNome}` : ''}.</p>
            <p className="muted cad-dica">Não chegou? Olha o spam ou as Promoções. Pode levar um minuto.</p>
            {reenviado && <div className="alert alert-info">{reenviado}</div>}
            <Link to={`/login?convite=${convite}`} className="btn btn-primary btn-block">Já confirmei, entrar</Link>
            <button type="button" className="btn btn-ghost btn-block" onClick={reenviar}>Reenviar e-mail</button>
          </div>
        ) : (
          <>
            {quem ? (
              <div className="convite-quem cad-quem">
                {quem.foto ? <img src={quem.foto} alt="" /> : <span className="convite-ini">{iniciais(quem.nome)}</span>}
                <div>
                  <span className="muted">Você vai entrar na agenda de</span>
                  <strong>{quem.nome}</strong>
                </div>
              </div>
            ) : (
              <div className="alert alert-error">Código não encontrado. <Link to="/entrar">Tentar outro</Link></div>
            )}

            <div className="cad-passos" aria-label={`Passo ${passo} de 2`}>
              <span className={passo >= 1 ? 'ativo' : ''}>1 · Quem é você</span>
              <span className={passo >= 2 ? 'ativo' : ''}>2 · Como você entra</span>
            </div>

            {passo === 1 ? (
              <form onSubmit={seguir} className="form">
                <label>Nome e sobrenome<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Maria da Silva" autoComplete="name" autoFocus required /></label>
                <label>WhatsApp<input type="tel" inputMode="numeric" value={fone} onChange={(e) => setFone(formatarFone(e.target.value))} placeholder="(13) 99999-9999" autoComplete="tel" required />
                  <span className="campo-dica muted">É por ele que chegam a confirmação e o lembrete.</span></label>
                <label><span className="campo-rotulo">Aniversário <span className="muted">(opcional)</span></span><input type="date" value={nasc} onChange={(e) => setNasc(e.target.value)} max={hoje()} />
                  <span className="campo-dica muted">A profissional gosta de lembrar.</span></label>
                {erro && <div className="alert alert-error">{erro}</div>}
                <button type="submit" className="btn btn-primary btn-block" disabled={!quem}>Continuar</button>
              </form>
            ) : (
              <form onSubmit={criar} className="form">
                <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" autoComplete="email" autoFocus required />
                  <span className="campo-dica muted">Vai receber um e-mail para confirmar.</span></label>
                <CampoSenha valor={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Pelo menos 6 caracteres" />
                <label className="aceite-termos">
                  <input type="checkbox" checked={termos} onChange={(e) => setTermos(e.target.checked)} />
                  <span>Li e aceito os <Link to="/termos" target="_blank">Termos de uso</Link> e a <Link to="/privacidade" target="_blank">Política de privacidade</Link>.</span>
                </label>
                {erro && <div className="alert alert-error">{erro}</div>}
                <button type="submit" className="btn btn-primary btn-block" disabled={enviando || !termos || senha.length < 6}>{enviando ? 'Criando…' : 'Criar minha conta'}</button>
                <button type="button" className="btn btn-ghost btn-block" onClick={() => { setErro(''); setPasso(1) }}>Voltar</button>
              </form>
            )}

            <p className="login-troca muted">Já tem conta? <Link to={`/login?convite=${convite}`} className="link-ver">Entrar</Link></p>
          </>
        )}
        <RodapeSocial />
      </div>
    </div>
  )
}

function hoje() { return new Date().toISOString().slice(0, 10) }
function nascimentoOk(v) {
  const d = new Date(v + 'T12:00:00'); const ano = d.getFullYear()
  return !Number.isNaN(d.getTime()) && ano >= 1920 && d <= new Date()
}
function traduz(msg) {
  const mapa = {
    'User already registered': 'Este e-mail já tem conta. Entre com a senha, ou use "Esqueci a senha".',
    'Password should be at least 6 characters': 'A senha precisa ter pelo menos 6 caracteres.',
    'Failed to fetch': 'Não foi possível conectar. Confira sua internet.',
    'Load failed': 'Não foi possível conectar. Confira sua internet e tente de novo.',
    'Signup requires a valid password': 'A senha precisa ter pelo menos 6 caracteres.',
  }
  return mapa[msg] ?? msg
}
