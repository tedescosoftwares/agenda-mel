import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { MarcaIcon, Wordmark } from '../../components/icons'
import RodapeSocial from '../../components/RodapeSocial'

// "Sou profissional" — a porta de quem vai ATENDER pelo MIMO. Duas
// escolhas: trabalho por conta própria (vira um salão de uma pessoa,
// sem nunca ver a palavra salão) ou tenho um salão com equipe.
// Sem conta, a escolha vai junto no cadastro e o servidor abre o
// negócio quando o perfil nasce. Já logada como cliente sem agenda,
// abre agora.
export default function Comecar() {
  const { user, role, recarregarPerfil } = useAuth()
  const [tipo, setTipo] = useState('')
  const [nome, setNome] = useState('')
  const [cidade, setCidade] = useState('')
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function abrirAgora() {
    setSalvando(true); setErro('')
    const { data, error } = await supabase.rpc('abrir_negocio', { tipo, nome_negocio: nome.trim() || null, cidade: cidade.trim() || null })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    if (!data?.ok) { setErro('não deu para abrir'); return }
    await recarregarPerfil?.()
    window.location.href = tipo === 'salao' ? '/admin' : '/pro/agenda'
  }

  const q = (t) => `/login?modo=cadastro&papel=${t}${nome ? '&negocio=' + encodeURIComponent(nome.trim()) : ''}${cidade ? '&cidade=' + encodeURIComponent(cidade.trim()) : ''}`

  return (
    <div className="page-center login-bg">
      <div className="card login-card entrar-card">
        <div className="brand">
          <MarcaIcon className="brand-icon" width={44} height={40} id="comecar" />
          <Wordmark tamanho={2.2} />
        </div>
        <h2 className="login-titulo">Atender pelo MIMO</h2>
        <p className="muted login-sub">Sua agenda, seu link, suas clientes marcando sozinhas. Como você trabalha?</p>

        {erro && <div className="alert alert-error">{erro}</div>}

        <div className="entrar-opcoes">
          <button className={'card escolha' + (tipo === 'autonoma' ? ' ativa' : '')} onClick={() => setTipo('autonoma')}>
            <strong>Por conta própria</strong>
            <span className="muted">Atendo sozinha, em casa, em estúdio ou onde a cliente estiver.</span>
          </button>
          <button className={'card escolha' + (tipo === 'salao' ? ' ativa' : '')} onClick={() => setTipo('salao')}>
            <strong>Tenho um salão</strong>
            <span className="muted">Com equipe. Cada profissional tem a agenda dela e eu vejo tudo.</span>
          </button>
        </div>

        {tipo && (
          <div className="form" style={{ marginTop: '1rem' }}>
            {tipo === 'salao' && <label>Nome do salão<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Espaço Bela" /></label>}
            <label>Cidade<input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Santos" /></label>
            {user && role === 'cliente' ? (
              <button className="btn btn-primary btn-block" onClick={abrirAgora} disabled={salvando}>{salvando ? 'Abrindo…' : 'Abrir minha agenda'}</button>
            ) : user ? (
              <div className="alert alert-info">Você já faz parte de um salão com esta conta.</div>
            ) : (
              <>
                <Link to={q(tipo)} className="btn btn-primary btn-block">Criar conta</Link>
                <Link to="/login" className="btn btn-ghost btn-block">Já tenho conta</Link>
              </>
            )}
          </div>
        )}

        <p className="login-troca muted">É cliente? <Link to="/login" className="link-ver">Entrar</Link></p>
        <RodapeSocial />
      </div>
    </div>
  )
}
