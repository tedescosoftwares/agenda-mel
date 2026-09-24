import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Store, Users, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { MarcaIcon, Wordmark } from '../../components/icons'
import { formatarFone } from '../../lib/fone'

// O link genérico da equipe (114 → 119). Ele só recolhe nome e WhatsApp:
// a profissional informa, o salão termina a configuração e libera o
// acesso pelo link individual. Quem já tem conta na MIMO entra pelo
// botão; se o salão já a cadastrou pelo telefone, a agenda já está
// pronta; senão, ela fica esperando o salão configurar.
const CHAVE = 'mimo-equipe'
export default function ConviteEquipe() {
  const { codigo } = useParams()
  const { user, role, loading, recarregarPerfil } = useAuth()
  const navigate = useNavigate()
  const [salao, setSalao] = useState(undefined)
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)
  const [f, setF] = useState({ nome: '', fone: '' })
  const [enviado, setEnviado] = useState(null)

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
  async function informar() {
    if (!f.nome.trim()) { setErro('Diga o seu nome.'); return }
    if (f.fone.replace(/\D/g, '').length < 10) { setErro('Diga o seu WhatsApp, com DDD.'); return }
    setIndo(true); setErro('')
    const { data, error } = await supabase.rpc('equipe_informar_dados', { convite: codigo, nome: f.nome.trim(), fone: f.fone })
    setIndo(false)
    if (error) { setErro(error.message); return }
    setEnviado(data)
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
        ) : enviado ? (
          <>
            <span className="ativar-check"><Check size={22} /></span>
            <h2 className="login-titulo">{enviado.ja ? 'Você já está na equipe' : 'Dados enviados!'}</h2>
            <p className="muted login-sub">{enviado.ja ? `O ${salao.nome} já tem o seu cadastro. Quando o acesso for liberado, o link chega pelo seu WhatsApp.` : `O ${salao.nome} termina a configuração da sua agenda e te manda o link de acesso pelo WhatsApp. Aí é só confirmar o número e criar a senha.`}</p>
          </>
        ) : (
          <>
            <div className="eq-salao">
              <span className="eq-logo">{salao.logo_url ? <img src={salao.logo_url} alt="" /> : <Store size={24} />}</span>
              <div><strong>{salao.nome}</strong><span className="muted">{salao.cidade ? `${salao.cidade} · ` : ''}{salao.quantas} {salao.quantas === 1 ? 'profissional' : 'profissionais'}</span></div>
            </div>
            <h2 className="login-titulo">Entre para a equipe</h2>
            <p className="muted login-sub">Informe seu nome e WhatsApp. O salão configura sua agenda (serviços, horários e o que mais precisar) e libera o seu acesso.</p>
            {erro && <div className="alert alert-error">{erro}</div>}
            {user && (role === 'cliente' || role === 'profissional') ? (
              <button type="button" className="btn btn-primary btn-block" onClick={entrar} disabled={indo}><Users size={16} /> {indo ? 'Entrando…' : `Entrar na equipe de ${salao.nome}`}</button>
            ) : user ? (
              <div className="alert alert-info">Esta conta já é dona de um negócio. Pra entrar numa equipe, use outra conta.</div>
            ) : (
              <>
                <label className="ativar-fone">Seu nome<input value={f.nome} onChange={(e) => setF((x) => ({ ...x, nome: e.target.value }))} placeholder="Carla Mendes" autoComplete="name" /></label>
                <label className="ativar-fone">WhatsApp<input type="tel" inputMode="numeric" value={f.fone} onChange={(e) => setF((x) => ({ ...x, fone: formatarFone(e.target.value) }))} placeholder="(11) 98765-4321" autoComplete="tel" /></label>
                <button type="button" className="btn btn-primary btn-block" onClick={informar} disabled={indo}>{indo ? 'Enviando…' : 'Enviar meus dados'}</button>
                <Link to={`/pro/entrar?equipe=${codigo}`} className="btn btn-ghost btn-block">Já tenho conta na MIMO</Link>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
