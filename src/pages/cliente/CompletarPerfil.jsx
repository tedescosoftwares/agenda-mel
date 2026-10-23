import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useDialogo } from '../../context/DialogoContext'
import { supabase } from '../../lib/supabase'
import { formatarFone, foneValido } from '../../lib/fone'
import { FraseDeAceite } from '../../components/LinkLegal'
import { useDocumentosLegais, aceitesPara } from '../../lib/legal'
import { iniciais } from '../../lib/booking'
import { precisaCompletar } from '../../lib/oauth'
import LinkSuporte from '../../components/LinkSuporte'
import { MarcaIcon, Wordmark } from '../../components/icons'

// Falta só o seu WhatsApp (3.60). A conta que nasce pelo Google chega sem
// telefone, e é pelo WhatsApp que chegam a confirmação e o lembrete; o salão
// também encaixa clientes por ele. Esta tela vem antes de tudo (ProtectedRoute)
// e chama completar_perfil (207): telefone (um WhatsApp, uma conta — 067),
// aniversário, o aceite dos termos e os encaixes que o salão já fez por esse número.
export default function CompletarPerfil() {
  const navigate = useNavigate()
  const { user, profile, recarregarPerfil, recarregarVinculos, signOut } = useAuth()
  const { confirmar } = useDialogo()
  const docs = useDocumentosLegais()
  const meta = user?.user_metadata ?? {}
  const [nome, setNome] = useState(profile?.full_name || meta.full_name || meta.name || '')
  const [fone, setFone] = useState('')
  const [nasc, setNasc] = useState('')
  const [termos, setTermos] = useState(false)
  const [erro, setErro] = useState('')
  const [jaTem, setJaTem] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const precisaAceite = !profile?.aceitou_termos_em
  const foto = profile?.avatar_url || meta.avatar_url || meta.picture || null

  if (profile && !precisaCompletar(user, profile)) return <Navigate to="/cliente/home" replace />

  async function concluir(e) {
    e.preventDefault(); setErro(''); setJaTem(false)
    if (nome.trim().split(' ').length < 2) { setErro('Diga seu nome e sobrenome, do jeito que a profissional te conhece.'); return }
    if (!foneValido(fone)) { setErro('Confere o WhatsApp: DDD + 9 dígitos, como (13) 99999-9999.'); return }
    if (nasc && !nascimentoOk(nasc)) { setErro('Confere a data de aniversário.'); return }
    if (precisaAceite && !termos) { setErro('Para continuar, é preciso aceitar os Termos e a Política de privacidade.'); return }
    setEnviando(true)
    try {
      // um WhatsApp, uma conta (067): confere antes de guardar
      const { data: livre, error: e1 } = await supabase.rpc('telefone_disponivel', { fone: formatarFone(fone) })
      if (e1) { setErro('Não consegui conferir o WhatsApp agora. Tenta de novo.'); return }
      if (livre && livre.disponivel === false) { if (livre.em_uso) setJaTem(true); else setErro(livre.motivo || 'Esse WhatsApp não serve.'); return }
      const { data, error } = await supabase.rpc('completar_perfil', {
        nome_: nome.trim(), fone_: formatarFone(fone), nascimento_: nasc || null, aceites_: precisaAceite ? aceitesPara('cliente', docs) : null,
      })
      if (error) { setErro(error.message); return }
      if (!data?.ok) { if (data?.em_uso) setJaTem(true); else setErro(data?.motivo || 'Não deu para guardar agora. Tenta de novo.'); return }
      await recarregarPerfil?.()
      await recarregarVinculos?.()
      navigate('/cliente/home', { replace: true })
    } finally { setEnviando(false) }
  }

  return (
    <div className="page-center login-bg">
      <div className="card login-card cad-card" data-teste="completar">
        <div className="brand">
          <MarcaIcon className="brand-icon" width={44} height={40} id="completar" />
          <Wordmark tamanho={2.2} />
        </div>
        <h2 className="login-titulo">Falta só o seu WhatsApp</h2>
        <p className="muted login-sub">Você entrou com o Google. É pelo WhatsApp que chegam a confirmação e o lembrete dos seus horários, e é por ele que a profissional te reconhece.</p>

        <div className="completar-quem">
          {foto ? <img src={foto} alt="" referrerPolicy="no-referrer" /> : <span className="convite-ini">{iniciais(nome || 'G')}</span>}
          <div>
            <strong>{nome || 'Sua conta Google'}</strong>
            <span className="muted">{user?.email}</span>
          </div>
        </div>

        <form onSubmit={concluir} className="form" data-teste="completar-form">
          <label>Nome e sobrenome<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Maria da Silva" autoComplete="name" required data-teste="completar-nome" /></label>
          <label>WhatsApp<input type="tel" inputMode="numeric" value={fone} onChange={(e) => setFone(formatarFone(e.target.value))} placeholder="(13) 99999-9999" autoComplete="tel" required data-teste="completar-fone" />
            <span className="campo-dica muted">É por ele que chegam a confirmação e o lembrete.</span></label>
          <label><span className="campo-rotulo">Aniversário <span className="muted">(opcional)</span></span><input type="date" value={nasc} onChange={(e) => setNasc(e.target.value)} max={hoje()} />
            <span className="campo-dica muted">A profissional gosta de lembrar.</span></label>
          {precisaAceite && (
            <label className="aceite-termos">
              <input type="checkbox" checked={termos} onChange={(e) => setTermos(e.target.checked)} data-teste="completar-termos" />
              <span><FraseDeAceite papel="cliente" /></span>
            </label>
          )}
          {erro && <div className="alert alert-error">{erro}</div>}
          {jaTem && (
            <div className="alert alert-info ja-tem" data-teste="completar-em-uso">
              <strong>Esse WhatsApp já está em uso</strong> por outra conta da MIMO. Se a conta é sua, saia desta e entre por ela, com e-mail e senha. Se o número é seu e você não tem outra conta, fale com o suporte.
              <div className="ja-tem-acoes">
                <button type="button" className="btn btn-primary" onClick={() => signOut()}>Entrar com a outra conta</button>
                <LinkSuporte chamada="whatsEmUso" className="btn btn-ghost">Falar com o suporte</LinkSuporte>
              </div>
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={enviando || (precisaAceite && !termos)} data-teste="completar-ok">{enviando ? 'Guardando…' : 'Concluir'}</button>
        </form>

        <p className="login-troca muted">
          <button type="button" className="link-ver" onClick={async () => { if (await confirmar({ titulo: 'Sair da conta?', ok: 'Sair', cancelar: 'Ficar' })) signOut() }}>Sair da conta</button>
        </p>
      </div>
    </div>
  )
}

function hoje() { return new Date().toISOString().slice(0, 10) }
function nascimentoOk(v) {
  const d = new Date(v + 'T12:00:00'); const ano = d.getFullYear()
  return !Number.isNaN(d.getTime()) && ano >= 1920 && d <= new Date()
}
