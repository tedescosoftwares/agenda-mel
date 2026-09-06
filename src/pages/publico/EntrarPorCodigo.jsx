import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { MarcaIcon, Wordmark } from '../../components/icons'
import { extrairCodigo, guardarConvite } from '../../lib/convite'
import { iniciais } from '../../lib/booking'

// /v/ANA7K2 — o que está dentro do QR e o que vai no link do WhatsApp.
// Diz quem convidou e leva para o lugar certo:
//   logada como cliente  -> entra na agenda agora
//   logada como equipe   -> avisa para trocar de conta
//   sem conta            -> guarda o código e manda criar conta (o
//                           código vai junto no cadastro e o vínculo
//                           nasce no servidor) ou entrar
export default function EntrarPorCodigo() {
  const { codigo: bruto } = useParams()
  const navigate = useNavigate()
  const { user, role, loading, recarregarVinculos } = useAuth()
  const codigo = extrairCodigo(bruto)
  const [alvo, setAlvo] = useState(undefined)
  const [erro, setErro] = useState('')
  const [entrando, setEntrando] = useState(false)

  useEffect(() => {
    if (!codigo) { setAlvo(null); return }
    guardarConvite(codigo)
    supabase.rpc('resolver_codigo', { chave: codigo }).then(({ data }) => setAlvo(data ?? null))
  }, [codigo])

  async function entrar() {
    setEntrando(true); setErro('')
    const { data, error } = await supabase.rpc('vincular', { codigo, jeito: 'link' })
    setEntrando(false)
    if (error) { setErro(error.message); return }
    if (!data?.ok) { setErro(data?.motivo || 'não deu para entrar'); return }
    await recarregarVinculos?.()
    navigate('/cliente/home', { replace: true })
  }

  if (loading || alvo === undefined) return <div className="page-center"><p className="muted">Carregando…</p></div>

  return (
    <div className="page-center login-bg">
      <div className="card login-card entrar-card">
        <div className="brand">
          <MarcaIcon className="brand-icon" width={44} height={40} id="convite" />
          <Wordmark tamanho={2.2} />
        </div>

        {!alvo ? (
          <>
            <h2 className="login-titulo">Código não encontrado</h2>
            <p className="muted login-sub">Confere as seis letras com a profissional, ou pede o QR de novo.</p>
            <Link to="/" className="btn btn-ghost btn-block">Ir para o início</Link>
          </>
        ) : (
          <>
            <div className="convite-quem">
              {alvo.foto ? <img src={alvo.foto} alt="" /> : <span className="convite-ini">{iniciais(alvo.nome)}</span>}
              <div>
                <strong>{alvo.nome}</strong>
                <span className="muted">{alvo.tipo === 'profissional' ? (alvo.especialidade || (alvo.salao?.tipo === 'autonoma' ? 'Profissional autônoma' : alvo.salao?.nome)) : 'Salão'}{alvo.salao?.cidade ? ` · ${alvo.salao.cidade}` : ''}</span>
              </div>
            </div>
            <h2 className="login-titulo">{alvo.tipo === 'profissional' ? `${alvo.nome.split(' ')[0]} te convidou` : `${alvo.nome} te convidou`}</h2>
            <p className="muted login-sub">
              {alvo.salao?.tipo === 'autonoma' || alvo.tipo === 'salao'
                ? 'Entre na agenda para ver horários e marcar pelo app.'
                : `Entre na agenda do ${alvo.salao?.nome} para ver horários e marcar pelo app.`}
            </p>

            {erro && <div className="alert alert-error">{erro}</div>}

            {user && role === 'cliente' && (
              <button className="btn btn-primary btn-block" onClick={entrar} disabled={entrando}>{entrando ? 'Entrando…' : 'Entrar na agenda'}</button>
            )}
            {user && role !== 'cliente' && (
              <div className="alert alert-info">Você está logada como equipe. Saia da conta e entre como cliente para usar este convite.</div>
            )}
            {!user && (
              <div className="entrar-opcoes">
                <Link to={`/login?modo=cadastro&convite=${codigo}`} className="btn btn-primary btn-block">Criar minha conta</Link>
                <Link to={`/login?convite=${codigo}`} className="btn btn-ghost btn-block">Já tenho conta</Link>
              </div>
            )}
          </>
        )}
        <p className="brand-slogan" style={{ marginTop: '1.2rem', marginBottom: 0, textAlign: 'center' }}>Beleza na palma da mão</p>
      </div>
    </div>
  )
}
