import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Store, Check, Sparkles, CalendarDays, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { MarcaIcon, Wordmark } from '../../components/icons'
import { resumoDias, primeiroNome } from '../../lib/equipe'

// O link de acesso que chega por e-mail (119, 129). A profissional abre,
// vê que o salão já deixou a agenda pronta e cria a senha (ou entra, se
// já tem conta). O link é o segredo: nada de conferir telefone. Nada de
// escolher vínculo, serviço, preço ou horário: isso o salão já configurou.
export default function AtivarAcesso() {
  const { token } = useParams()
  const { user, role, loading, recarregarPerfil } = useAuth()
  const navigate = useNavigate()
  const [acesso, setAcesso] = useState(undefined)
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)
  const [pronta, setPronta] = useState(null)

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
  return (
    <div className="page-center login-bg">
      <div className="card login-card entrar-card ativar-card">
        <div className="brand"><MarcaIcon className="brand-icon" width={44} height={40} id="ativar" /><Wordmark tamanho={2.2} /></div>
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
            <button type="button" className="btn btn-primary btn-block" onClick={() => navigate('/pro/agenda', { replace: true })}>Entrar na MIMO</button>
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
            <div className="alert alert-info">Esta conta já é dona de um negócio. Pra entrar numa equipe, saia e use outra conta.</div>
          </>
        ) : (
          <>
            <SalaoCabeca acesso={acesso} />
            <h2 className="login-titulo">Você foi adicionada ao {acesso.salao.nome}</h2>
            <p className="ativar-nome"><strong>{p.nome}</strong>{p.especialidade && <span className="muted">{` · ${p.especialidade}`}</span>}{p.email && <small className="muted">{p.email}</small>}</p>
            <p className="muted login-sub">O salão já configurou sua agenda. Você não precisa escolher serviço, preço, vínculo nem horário.</p>
            <ul className="pronto-lista convite-lista ativar-lista">
              <li><Sparkles size={14} /><span>{`${p.servicos} ${p.servicos === 1 ? 'serviço configurado' : 'serviços configurados'}`}</span></li>
              <li><CalendarDays size={14} /><span>{`Atende ${resumoDias((p.dias ?? []).map((d) => ({ weekday: d, open: true })))}`}</span></li>
              <li><ShieldCheck size={14} /><span>Sua agenda, seu link e suas clientes, dentro do salão</span></li>
            </ul>
            {erro && <div className="alert alert-error">{erro}</div>}
            {user
              ? <button type="button" className="btn btn-primary btn-block" onClick={ativar} disabled={indo}>{indo ? 'Ativando…' : 'Ativar meu acesso'}</button>
              : <>
                  <button type="button" className="btn btn-primary btn-block" onClick={seguirParaCadastro}>Criar minha senha</button>
                  <Link to={`/pro/entrar?ativar=${token}`} className="btn btn-ghost btn-block">Já tenho conta na MIMO</Link>
                </>}
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
