import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import LeitorQr from '../../components/LeitorQr'
import { MarcaIcon, Wordmark } from '../../components/icons'
import { extrairCodigo } from '../../lib/convite'

// /entrar — para quem ainda NÃO tem conta e recebeu um QR ou código da
// profissional. Lê o código (câmera ou digitado) e leva para /v/<código>,
// que mostra quem convidou e manda criar a conta já com o vínculo.
// Quem já tem conta faz o mesmo por dentro do app (/cliente/entrar).
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
        <h2 className="login-titulo">Entrar na agenda da sua profissional</h2>
        <p className="muted login-sub">Ela te mostrou um QR ou te passou um código de seis letras. É por ele que você entra.</p>

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

        <p className="login-troca muted">Já tem conta? <Link to="/login" className="link-ver">Entrar</Link></p>
      </div>
    </div>
  )
}
