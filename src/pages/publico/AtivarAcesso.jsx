import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Store, Check, Sparkles, CalendarDays, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { MarcaIcon, Wordmark } from '../../components/icons'
import { formatarFone } from '../../lib/fone'
import { resumoDias, primeiroNome } from '../../lib/equipe'

// O link de acesso que o salão manda (119). A profissional abre, vê que o
// salão já deixou a agenda pronta, confirma o WhatsApp e cria a senha
// (ou entra, se já tem conta). Nada de escolher vínculo, serviço, preço
// ou horário: isso o salão já configurou.
export default function AtivarAcesso() {
  const { token } = useParams()
  const { user, role, loading, recarregarPerfil } = useAuth()
  const navigate = useNavigate()
  const [acesso, setAcesso] = useState(undefined)
  const [etapa, setEtapa] = useState(1)   // 1 boas-vindas · 2 confirmar telefone
  const [fone, setFone] = useState('')
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)
  const [pronta, setPronta] = useState(null)

  useEffect(() => { supabase.rpc('acesso_por_token', { token }).then(({ data }) => setAcesso(data ?? null)) }, [token])

  // já logada: confirma o telefone e ativa na hora
  async function ativar() {
    if (fone.replace(/\D/g, '').length < 10) { setErro('Digite o seu WhatsApp, com DDD.'); return }
    setIndo(true); setErro('')
    const { data, error } = await supabase.rpc('ativar_acesso', { token, fone })
    setIndo(false)
    if (error) { setErro(error.message); return }
    setPronta(data)
    await recarregarPerfil?.()
  }
  // sem conta: confere o telefone aqui (o final tem que bater) e manda pro cadastro com o token
  function seguirParaCadastro() {
    const d = fone.replace(/\D/g, '')
    if (d.length < 10) { setErro('Digite o seu WhatsApp, com DDD.'); return }
    if (acesso?.profissional?.telefone_final && !d.endsWith(acesso.profissional.telefone_final)) { setErro('Esse número não é o que o salão cadastrou. Confere com quem te mandou o link.'); return }
    navigate(`/pro/entrar?modo=cadastro&papel=ativar&ativar=${token}&fone=${encodeURIComponent(fone)}`)
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
        ) : etapa === 1 ? (
          <>
            <SalaoCabeca acesso={acesso} />
            <h2 className="login-titulo">Você foi adicionada ao {acesso.salao.nome}</h2>
            <p className="ativar-nome"><strong>{p.nome}</strong>{p.especialidade && <span className="muted">{` · ${p.especialidade}`}</span>}<small className="muted">{`WhatsApp final ${p.telefone_final}`}</small></p>
            <p className="muted login-sub">O salão já configurou sua agenda. Você não precisa escolher serviço, preço, vínculo nem horário.</p>
            <ul className="pronto-lista convite-lista ativar-lista">
              <li><Sparkles size={14} /><span>{`${p.servicos} ${p.servicos === 1 ? 'serviço configurado' : 'serviços configurados'}`}</span></li>
              <li><CalendarDays size={14} /><span>{`Atende ${resumoDias((p.dias ?? []).map((d) => ({ weekday: d, open: true })))}`}</span></li>
              <li><ShieldCheck size={14} /><span>Sua agenda, seu link e suas clientes, dentro do salão</span></li>
            </ul>
            <button type="button" className="btn btn-primary btn-block" onClick={() => setEtapa(2)}>Continuar</button>
          </>
        ) : (
          <>
            <SalaoCabeca acesso={acesso} />
            <h2 className="login-titulo">Confirme o seu WhatsApp</h2>
            <p className="muted login-sub">O número que o salão cadastrou termina em <b>{p.telefone_final}</b>. Digite o seu, com DDD, pra confirmar que é você.</p>
            {erro && <div className="alert alert-error">{erro}</div>}
            <label className="ativar-fone">WhatsApp<input type="tel" inputMode="numeric" value={fone} onChange={(e) => setFone(formatarFone(e.target.value))} placeholder="(11) 98765-4321" autoFocus /></label>
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
