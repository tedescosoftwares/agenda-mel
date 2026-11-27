import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Store, Check, Eye, EyeOff, ShieldCheck, CalendarDays } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { LogoMimo } from '../../components/icons'
import { chamar } from '../../lib/pagamento'
import { useDocumentosLegais, aceitesPara, versaoMaior } from '../../lib/legal'
import { FraseDeAceite } from '../../components/LinkLegal'

// 4.51 (migração 279): o link do acesso ao painel (administração ou recepção). Quem recebe abre, vê de qual salão é
// e cria a senha aqui mesmo (ou entra, se o e-mail já tem conta). O convite só ativa na conta do e-mail convidado.
const PAPEL = {
  admin: ['Administração', 'Você vai ver e cuidar de tudo no painel do salão: agenda, equipe, serviços, financeiro e configurações.'],
  recepcao: ['Recepção', 'Você vai cuidar da agenda de todas, das clientes, dos encaixes, da comanda e do fechamento do dia.'],
}

export default function AtivarPainel() {
  const { token } = useParams()
  const { user, loading, recarregarPerfil, signOut } = useAuth()
  const docs = useDocumentosLegais()
  const [conv, setConv] = useState(undefined)
  const [senha, setSenha] = useState('')
  const [ver, setVer] = useState(false)
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)
  const [pronta, setPronta] = useState(null)
  const [existe, setExiste] = useState(false)

  useEffect(() => { supabase.rpc('acesso_painel_ver', { token_: token }).then(({ data }) => setConv(data ?? null), () => setConv(null)) }, [token])

  async function criar(e) {
    e.preventDefault(); setErro('')
    if (senha.length < 8) { setErro('A senha precisa de pelo menos 8 caracteres.'); return }
    setIndo(true)
    try {
      const aceites = aceitesPara('ativar', docs)
      const r = await chamar('acesso', { acao: 'painel_criar', token, senha, termos: versaoMaior(aceites), aceites })
      if (r?.existe) { setExiste(true); return }
      if (r?.sessao) { await supabase.auth.setSession(r.sessao); await recarregarPerfil?.() }
      setPronta({ semSessao: !r?.sessao })
    } catch (er) { setErro(er.message || 'Não deu para criar a senha agora. Tente de novo.') } finally { setIndo(false) }
  }
  async function ativar() {
    setIndo(true); setErro('')
    const { error } = await supabase.rpc('acesso_painel_ativar', { token_: token })
    setIndo(false)
    if (error) { setErro(error.message); return }
    await recarregarPerfil?.()
    setPronta({ semSessao: false })
  }

  if (loading || conv === undefined) return <div className="page-center"><p className="muted">Carregando…</p></div>
  const [rotulo, texto] = PAPEL[conv?.papel] ?? PAPEL.recepcao
  const primeiro = String(conv?.nome ?? '').split(' ')[0]
  const outraConta = Boolean(user && conv?.email && user.email && conv.email.trim().toLowerCase() !== user.email.trim().toLowerCase())
  const entrar = `/pro/entrar?email=${encodeURIComponent(conv?.email ?? '')}&depois=${encodeURIComponent(`/acesso-painel/${token}`)}`
  return (
    <div className="page-center login-bg">
      <div className="card login-card entrar-card ativar-card">
        <div className="brand"><LogoMimo altura={60} pro className="brand-logo" /></div>
        {!conv ? (
          <>
            <h2 className="login-titulo">Convite não encontrado</h2>
            <p className="muted login-sub">Confira o link com quem te mandou. Se o acesso foi tirado, peça outro.</p>
            <Link to="/pro/entrar" className="btn btn-primary btn-block">Entrar na MIMO Pro</Link>
          </>
        ) : pronta ? (
          <>
            <span className="ativar-check"><Check size={22} /></span>
            <h2 className="login-titulo">Tudo pronto, {primeiro} 💗</h2>
            <p className="muted login-sub">Seu acesso de {rotulo.toLowerCase()} ao {conv.salao.nome} está ativo.</p>
            {pronta.semSessao
              ? <Link to="/pro/entrar" className="btn btn-primary btn-block">Entrar com o e-mail e a senha</Link>
              : <button type="button" className="btn btn-primary btn-block" onClick={() => { window.location.href = '/admin/agenda' }}>Abrir o painel</button>}
          </>
        ) : conv.usado ? (
          <>
            <h2 className="login-titulo">Esse convite já foi usado</h2>
            <p className="muted login-sub">{primeiro}, seu acesso ao {conv.salao.nome} já está ligado a uma conta. É só entrar.</p>
            <Link to="/pro/entrar" className="btn btn-primary btn-block">Entrar com a minha conta</Link>
          </>
        ) : (
          <>
            <div className="eq-salao">
              <span className="eq-logo">{conv.salao.logo_url ? <img src={conv.salao.logo_url} alt="" /> : <Store size={24} />}</span>
              <div><strong>{conv.salao.nome}</strong><span className="muted">{conv.salao.cidade || 'Salão na MIMO'}</span></div>
            </div>
            <h2 className="login-titulo">{primeiro}, você recebeu um acesso de {rotulo.toLowerCase()}</h2>
            <p className="muted login-sub">{texto}</p>
            <ul className="pronto-lista convite-lista ativar-lista">
              <li>{conv.papel === 'admin' ? <ShieldCheck size={14} /> : <CalendarDays size={14} />}<span>Acesso de <strong>{rotulo}</strong> ao painel do {conv.salao.nome}</span></li>
            </ul>
            {erro && <div className="alert alert-error">{erro}</div>}
            {user && outraConta ? (
              <>
                <div className="alert alert-info">Este convite é para <strong>{conv.email}</strong>, e este navegador está com <strong>{user.email}</strong>. Saia desta conta para continuar.</div>
                <button type="button" className="btn btn-primary btn-block" onClick={() => signOut?.()}>Sair desta conta e continuar</button>
              </>
            ) : user ? (
              <button type="button" className="btn btn-primary btn-block" onClick={ativar} disabled={indo}>{indo ? 'Ativando…' : 'Ativar meu acesso'}</button>
            ) : existe ? (
              <>
                <div className="alert alert-info">O e-mail <strong>{conv.email}</strong> já tem conta na MIMO. Entre com a senha dessa conta e abra este link de novo: o acesso é ativado na hora.</div>
                <Link to={entrar} className="btn btn-primary btn-block">Entrar com a minha conta</Link>
              </>
            ) : (
              <form className="ativar-senha" onSubmit={criar}>
                <label>Seu e-mail de entrada<input value={conv.email} readOnly disabled /></label>
                <label>Crie a sua senha
                  <span className="ativar-senha-campo">
                    <input type={ver ? 'text' : 'password'} value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Pelo menos 8 caracteres" autoComplete="new-password" minLength={8} required />
                    <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? 'Esconder a senha' : 'Mostrar a senha'}>{ver ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                  </span>
                </label>
                <p className="muted ativar-aceite">Ao criar a senha você confirma: <FraseDeAceite papel="ativar" /></p>
                <button type="submit" className="btn btn-primary btn-block" disabled={indo}>{indo ? 'Criando…' : 'Criar senha e entrar'}</button>
                <p className="muted ativar-confere">O e-mail não é o seu? Peça ao salão para corrigir. <Link to={entrar} className="plat-link">Já tenho conta</Link></p>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}
