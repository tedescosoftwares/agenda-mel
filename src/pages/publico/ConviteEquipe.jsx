import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Store, Users, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { MarcaIcon, Wordmark } from '../../components/icons'

// O convite da equipe (114): o salão manda o link, a profissional abre,
// vê o salão e entra. Sem conta, o cadastro já nasce vinculado (o código
// vai nos metadados e o servidor amarra); com conta, entra na hora.
const CHAVE = 'mimo-equipe'
export default function ConviteEquipe() {
  const { codigo } = useParams()
  const { user, role, loading, recarregarPerfil } = useAuth()
  const navigate = useNavigate()
  const [salao, setSalao] = useState(undefined)
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)

  useEffect(() => {
    supabase.rpc('equipe_por_codigo', { convite: codigo }).then(({ data }) => setSalao(data ?? null))
    try { localStorage.setItem(CHAVE, String(codigo).toUpperCase()) } catch { /* nada */ }
  }, [codigo])

  async function entrar() {
    setIndo(true); setErro('')
    const { data, error } = await supabase.rpc('entrar_na_equipe', { convite: codigo })
    setIndo(false)
    if (error) { setErro(error.message); return }
    try { localStorage.removeItem(CHAVE) } catch { /* nada */ }
    await recarregarPerfil?.()
    navigate('/pro/agenda', { replace: true, state: { entrou: data?.salao } })
  }

  if (loading || salao === undefined) return <div className="page-center"><p className="muted">Carregando…</p></div>
  return (
    <div className="page-center login-bg">
      <div className="card login-card entrar-card">
        <div className="brand"><MarcaIcon className="brand-icon" width={44} height={40} id="equipe" /><Wordmark tamanho={2.2} /></div>
        {!salao ? (
          <>
            <h2 className="login-titulo">Convite não encontrado</h2>
            <p className="muted login-sub">Confere o link com quem te mandou.</p>
            <Link to="/comecar" className="btn btn-ghost btn-block">Quero abrir minha própria agenda</Link>
          </>
        ) : (
          <>
            <div className="eq-salao">
              <span className="eq-logo">{salao.logo_url ? <img src={salao.logo_url} alt="" /> : <Store size={24} />}</span>
              <div><strong>{salao.nome}</strong><span className="muted">{salao.cidade ? `${salao.cidade} · ` : ''}{salao.quantas} {salao.quantas === 1 ? 'profissional' : 'profissionais'}</span></div>
            </div>
            <h2 className="login-titulo">Você foi convidada para a equipe</h2>
            <p className="muted login-sub">Sua agenda, seu link e suas clientes, dentro do salão. A agenda fica compartilhada com a casa.</p>
            <ul className="pronto-lista convite-lista">
              <li><Check size={14} /> Agenda própria, que o salão também vê</li>
              <li><Check size={14} /> Seu link de agendamento</li>
              <li><Check size={14} /> Clientes que entram por você ficam ligadas ao salão</li>
            </ul>
            {erro && <div className="alert alert-error">{erro}</div>}
            {user ? (
              role === 'cliente' || role === 'profissional'
                ? <button type="button" className="btn btn-primary btn-block" onClick={entrar} disabled={indo}><Users size={16} /> {indo ? 'Entrando…' : `Entrar na equipe de ${salao.nome}`}</button>
                : <div className="alert alert-info">Esta conta já é dona de um negócio. Pra entrar numa equipe, use outra conta.</div>
            ) : (
              <>
                <Link to={`/pro/entrar?modo=cadastro&papel=equipe&equipe=${codigo}`} className="btn btn-primary btn-block">Criar minha conta e entrar</Link>
                <Link to={`/pro/entrar?equipe=${codigo}`} className="btn btn-ghost btn-block">Já tenho conta</Link>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
