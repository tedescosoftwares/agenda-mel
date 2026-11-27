import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Store, Check, Sparkles, CalendarDays, ShieldCheck, Eye, EyeOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { LogoMimo } from '../../components/icons'
import { resumoDias, primeiroNome } from '../../lib/equipe'
import { chamar } from '../../lib/pagamento'
import { useDocumentosLegais, aceitesPara, versaoMaior } from '../../lib/legal'
import { FraseDeAceite } from '../../components/LinkLegal'

// O link de acesso que chega por e-mail (119, 129). A profissional abre,
// vê que o salão já deixou a agenda pronta e cria a senha (ou entra, se
// já tem conta). O link é o segredo: nada de conferir telefone. Nada de
// escolher vínculo, serviço, preço ou horário: isso o salão já configurou.
export default function AtivarAcesso() {
  const { token } = useParams()
  const { user, role, loading, recarregarPerfil, signOut, profile } = useAuth()
  const [saindo, setSaindo] = useState(false)
  async function sairEContinuar() { setSaindo(true); setErro(''); try { await signOut?.() } finally { setSaindo(false) } }
  const quemEsta = profile?.full_name || user?.email || ''
  const navigate = useNavigate()
  const [acesso, setAcesso] = useState(undefined)
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)
  const [pronta, setPronta] = useState(null)
  // 4.38: a senha é criada aqui mesmo. O link do convite já prova que é ela: não tem segundo e-mail de confirmação.
  const docs = useDocumentosLegais()
  const [senha, setSenha] = useState('')
  const [verSenha, setVerSenha] = useState(false)
  const [jaTemConta, setJaTemConta] = useState(false)
  async function criarSenha(e) {
    e.preventDefault(); setErro('')
    if (senha.length < 8) { setErro('A senha precisa de pelo menos 8 caracteres.'); return }
    setIndo(true)
    try {
      const aceites = aceitesPara('ativar', docs)
      const r = await chamar('acesso', { acao: 'convite_criar', token, senha, termos: versaoMaior(aceites), aceites })
      if (r?.existe) { setJaTemConta(true); return }
      if (r?.sessao) { await supabase.auth.setSession(r.sessao); await recarregarPerfil?.() }
      setPronta({ ok: true, semSessao: !r?.sessao })
    } catch (er) { setErro(er.message || 'Não deu para criar a senha agora. Tente de novo.') } finally { setIndo(false) }
  }

  useEffect(() => { supabase.rpc('acesso_por_token', { token }).then(({ data }) => setAcesso(data ?? null)) }, [token])

  // já logada: ativa na hora
  async function ativar() {
    setIndo(true); setErro('')
    const { data, error } = await supabase.rpc('ativar_acesso', { token })
    setIndo(false)
    if (error) { setErro(error.message); return }
    setPronta(data)
    await recarregarPerfil?.()
  }
  // sem conta: cria a senha com o e-mail e o WhatsApp que o salão cadastrou já preenchidos
  function seguirParaCadastro() {
    const q = new URLSearchParams({ modo: 'cadastro', papel: 'ativar', ativar: token })
    if (acesso?.profissional?.email) q.set('email', acesso.profissional.email)
    if (acesso?.profissional?.telefone) q.set('fone', acesso.profissional.telefone)
    navigate(`/pro/entrar?${q.toString()}`)
  }

  if (loading || acesso === undefined) return <div className="page-center"><p className="muted">Carregando…</p></div>
  const p = acesso?.profissional
  const nome = primeiroNome(p?.nome)
  // 3.89.2 (migração 232): o convite só ativa na conta do e-mail convidado
  const outraConta = Boolean(user && p?.email && user.email && p.email.trim().toLowerCase() !== user.email.trim().toLowerCase())
  return (
    <div className="page-center login-bg">
      <div className="card login-card entrar-card ativar-card">
        <div className="brand"><LogoMimo altura={60} pro className="brand-logo" /></div>
        {!acesso ? (
          <>
            <h2 className="login-titulo">Link de acesso não encontrado</h2>
            <p className="muted login-sub">Confere o link com o salão que te mandou. Se ele já foi usado, é só entrar com a sua conta.</p>
            <Link to="/pro/entrar" className="btn btn-primary btn-block">Entrar na MIMO Pro</Link>
          </>
        ) : pronta ? (
          <>
            <span className="ativar-check"><Check size={22} /></span>
            <h2 className="login-titulo">Tudo pronto, {nome} 💗</h2>
            <p className="muted login-sub">Sua agenda no {acesso.salao.nome} já está configurada.</p>
            {pronta.semSessao
              ? <Link to="/pro/entrar" className="btn btn-primary btn-block">Entrar com o e-mail e a senha</Link>
              : <button type="button" className="btn btn-primary btn-block" onClick={() => navigate('/pro/agenda', { replace: true })}>Entrar na MIMO</button>}
          </>
        ) : acesso.usado || acesso.tem_conta ? (
          <>
            <SalaoCabeca acesso={acesso} />
            <h2 className="login-titulo">Esse acesso já foi ativado</h2>
            <p className="muted login-sub">{nome}, sua agenda no {acesso.salao.nome} já está ligada a uma conta. É só entrar.</p>
            <Link to="/pro/entrar" className="btn btn-primary btn-block">Entrar com a minha conta</Link>
          </>
        ) : acesso.situacao === 'inativa' ? (
          <>
            <SalaoCabeca acesso={acesso} />
            <h2 className="login-titulo">Essa agenda está desativada</h2>
            <p className="muted login-sub">Fale com o {acesso.salao.nome} para reativar o seu acesso.</p>
          </>
        ) : user && role !== 'cliente' && role !== 'profissional' ? (
          <>
            <SalaoCabeca acesso={acesso} />
            <h2 className="login-titulo">Convite para {p.nome}</h2>
            {p.email && <p className="muted login-sub ativar-para">{p.email}</p>}
            {/* 3.89: antes era um beco sem saída; quem testa no mesmo navegador da dona caía aqui */}
            <div className="alert alert-info">Este navegador está com a conta de <strong>{quemEsta}</strong>, que é dona de um negócio. Para ativar o acesso de {nome}, saia desta conta e continue.</div>
            <button type="button" className="btn btn-primary btn-block" onClick={sairEContinuar} disabled={saindo}>{saindo ? 'Saindo…' : 'Sair desta conta e continuar'}</button>
            <p className="muted ativar-confere">Confira o salão acima: o convite é do <strong>{acesso.salao.nome}</strong>. Se não for o que você esperava, o link é de outro convite.</p>
          </>
        ) : (
          <>
            <SalaoCabeca acesso={acesso} />
            <h2 className="login-titulo">Você foi adicionada ao {acesso.salao.nome}</h2>
            <p className="ativar-nome"><strong>{p.nome}</strong>{p.especialidade && <span className="muted">{` · ${p.especialidade}`}</span>}{p.email && <small className="muted">{p.email}</small>}</p>
            <p className="muted login-sub">O salão já configurou sua agenda. Você não precisa escolher serviço, preço, vínculo nem horário.{user ? '' : ' Falta só criar a sua senha.'}</p>
            <ul className="pronto-lista convite-lista ativar-lista">
              <li><Sparkles size={14} /><span>{`${p.servicos} ${p.servicos === 1 ? 'serviço configurado' : 'serviços configurados'}`}</span></li>
              <li><CalendarDays size={14} /><span>{`Atende ${resumoDias((p.dias ?? []).map((d) => ({ weekday: d, open: true })))}`}</span></li>
              <li><ShieldCheck size={14} /><span>Sua agenda, seu link e suas clientes, dentro do salão</span></li>
            </ul>
            {erro && <div className="alert alert-error">{erro}</div>}
            {user && outraConta
              ? <>
                  <div className="alert alert-info">Este convite é para <strong>{p.email}</strong>, e este navegador está com <strong>{user.email}</strong>. Para ativar, entre com a conta do e-mail do convite.</div>
                  <button type="button" className="btn btn-primary btn-block" onClick={sairEContinuar} disabled={saindo}>{saindo ? 'Saindo…' : 'Sair desta conta e continuar'}</button>
                </>
              : user
              ? <>
                  <button type="button" className="btn btn-primary btn-block" onClick={ativar} disabled={indo}>{indo ? 'Ativando…' : 'Ativar meu acesso'}</button>
                  <p className="muted ativar-confere">Vai ativar na conta de <strong>{quemEsta}</strong>. Não é você? <button type="button" className="plat-link" onClick={sairEContinuar} disabled={saindo}>Sair</button></p>
                </>
              : !p.email
              ? <>
                  <button type="button" className="btn btn-primary btn-block" onClick={seguirParaCadastro}>Criar minha senha</button>
                  <Link to={`/pro/entrar?ativar=${token}`} className="btn btn-ghost btn-block">Já tenho conta na MIMO</Link>
                </>
              : jaTemConta
              ? <>
                  <div className="alert alert-info">O e-mail <strong>{p.email}</strong> já tem conta na MIMO. Entre com a senha dessa conta e o acesso é ativado na hora.</div>
                  <Link to={`/pro/entrar?ativar=${token}&email=${encodeURIComponent(p.email)}`} className="btn btn-primary btn-block">Entrar com a minha conta</Link>
                </>
              : <form className="ativar-senha" onSubmit={criarSenha}>
                  <label>Seu e-mail de entrada<input value={p.email} readOnly disabled /></label>
                  <label>Crie a sua senha
                    <span className="ativar-senha-campo">
                      <input type={verSenha ? 'text' : 'password'} value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Pelo menos 8 caracteres" autoComplete="new-password" minLength={8} required />
                      <button type="button" onClick={() => setVerSenha((v) => !v)} aria-label={verSenha ? 'Esconder a senha' : 'Mostrar a senha'}>{verSenha ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                    </span>
                  </label>
                  <p className="muted ativar-aceite">Ao criar a senha você confirma: <FraseDeAceite papel="ativar" /></p>
                  <button type="submit" className="btn btn-primary btn-block" disabled={indo}>{indo ? 'Criando…' : 'Criar senha e entrar'}</button>
                  <p className="muted ativar-confere">O e-mail não é o seu? Peça ao salão para corrigir antes de criar a senha. <Link to={`/pro/entrar?ativar=${token}`} className="plat-link">Já tenho conta</Link></p>
                </form>}
          </>
        )}
      </div>
    </div>
  )
}

function SalaoCabeca({ acesso }) {
  return (
    <div className="eq-salao">
      <span className="eq-logo">{acesso.salao.logo_url ? <img src={acesso.salao.logo_url} alt="" /> : <Store size={24} />}</span>
      <div><strong>{acesso.salao.nome}</strong><span className="muted">{acesso.salao.cidade || 'Salão na MIMO'}</span></div>
    </div>
  )
}
