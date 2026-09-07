import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import LeitorQr from '../../components/LeitorQr'
import { MarcaIcon, Wordmark } from '../../components/icons'
import { extrairCodigo } from '../../lib/convite'

// /entrar — a PORTA do MIMO para quem não está logada. Ninguém chega
// aqui do nada: sempre foi uma profissional ou um salão que chamou. Então
// a primeira tela pergunta pelo código, não pelo e-mail:
//   Escanear o QR  ·  Digitar o código  ·  Já tenho conta
// O código leva para /v/<código>, que mostra quem convidou e cria a
// conta já com o vínculo. Cadastro solto não existe (a rota até aceita,
// mas nenhuma tela leva lá).
export default function ComCodigo() {
  const navigate = useNavigate()
  const [modo, setModo] = useState('menu')
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState('')

  const seguir = useCallback((bruto) => {
    const codigo = extrairCodigo(bruto)
    if (!codigo) { setErro('Isso não parece um código do MIMO: são seis letras, ou o link /v/…'); setModo('codigo'); return }
    navigate(`/v/${codigo}`)
  }, [navigate])
  const erroCamera = useCallback((m) => { setErro(m); setModo('codigo') }, [])

  return (
    <div className="page-center login-bg">
      <div className="card login-card entrar-card">
        <div className="brand">
          <MarcaIcon className="brand-icon" width={44} height={40} id="comcodigo" />
          <Wordmark tamanho={2.2} />
        </div>
        <h2 className="login-titulo">Bem-vinda ao MIMO</h2>
        <p className="muted login-sub">Sua profissional te mostrou um QR ou te passou um código de seis letras. É por ele que você entra na agenda dela.</p>

        {erro && <div className="alert alert-error">{erro}</div>}

        {modo === 'menu' && (
          <div className="entrar-opcoes">
            <button className="btn btn-primary btn-block" onClick={() => { setErro(''); setModo('camera') }}>📷 Escanear o QR</button>
            <button className="btn btn-ghost btn-block" onClick={() => { setErro(''); setModo('codigo') }}>Digitar o código</button>
          </div>
        )}
        {modo === 'camera' && (
          <>
            <LeitorQr onLido={seguir} onErro={erroCamera} />
            <button className="btn btn-ghost btn-block" onClick={() => setModo('menu')}>Cancelar</button>
          </>
        )}
        {modo === 'codigo' && (
          <form className="form" onSubmit={(e) => { e.preventDefault(); seguir(texto) }}>
            <label>Código ou link<input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="ANA7K2" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoFocus /></label>
            <button type="submit" className="btn btn-primary btn-block" disabled={!texto.trim()}>Continuar</button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => { setErro(''); setModo('menu') }}>Voltar</button>
          </form>
        )}

        {modo === 'menu' && <Link to="/login" className="btn btn-ghost btn-block" style={{ marginTop: '0.6rem' }}>Já tenho conta</Link>}
        <p className="login-troca muted" style={{ marginTop: '1rem' }}>Atende clientes? <Link to="/comecar" className="link-ver">Criar minha agenda</Link></p>
        <p className="brand-slogan" style={{ marginTop: '0.8rem', marginBottom: 0, textAlign: 'center' }}>Beleza na palma da mão</p>
      </div>
    </div>
  )
}
