import { useCallback, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useDialogo } from '../../context/DialogoContext'
import LeitorQr from '../../components/LeitorQr'
import { MarcaIcon, Wordmark } from '../../components/icons'
import { extrairCodigo } from '../../lib/convite'
import { ScanLine } from 'lucide-react'

// A única tela de quem ainda não entrou em agenda nenhuma. Não tem
// abas, não tem home: sem vínculo não há app. Três jeitos, um só
// mecanismo (vincular() no banco): escanear o QR, digitar o código,
// colar o link. Quem já tem agendas também chega aqui pelo perfil,
// para entrar em mais uma.
export default function Entrar() {
  const navigate = useNavigate()
  const [q] = useSearchParams()
  const { vinculos, recarregarVinculos, signOut, profile } = useAuth()
  const { avisar, confirmar } = useDialogo()
  const [modo, setModo] = useState(q.get('modo') === 'camera' ? 'camera' : 'menu') // menu | camera | codigo
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const jaTem = (vinculos ?? []).length > 0

  const vincular = useCallback(async (bruto, jeito) => {
    const codigo = extrairCodigo(bruto)
    if (!codigo) { setErro('Isso não parece um código do MIMO: são seis letras, ou o link /v/…'); setModo('codigo'); return }
    setEnviando(true); setErro('')
    const { data, error } = await supabase.rpc('vincular', { codigo, jeito })
    setEnviando(false)
    if (error) { setErro(error.message); setModo('codigo'); return }
    if (!data?.ok) { setErro(data?.motivo || 'não deu para entrar'); setModo('codigo'); return }
    await recarregarVinculos?.()
    const quem = data.trazida_por ? ` Você entrou pela ${data.trazida_por.split(' ')[0]}.` : ''
    await avisar({ titulo: data.novo ? `Você entrou na agenda de ${data.salao?.nome}` : `Você já estava em ${data.salao?.nome}`, texto: data.novo ? `Agora dá para marcar com quem atende lá.${quem}` : 'Nada mudou.', ok: 'Ver agenda' })
    navigate('/cliente/home', { replace: true })
  }, [recarregarVinculos, avisar, navigate])

  const lido = useCallback((t) => vincular(t, 'qr'), [vincular])
  const erroCamera = useCallback((m) => { setErro(m); setModo('codigo') }, [])

  return (
    <div className="page-center entrar-bg">
      <div className="card login-card entrar-card">
        <div className="brand">
          <MarcaIcon className="brand-icon" width={44} height={40} id="entrar" />
          <Wordmark tamanho={2.2} />
        </div>

        <h2 className="login-titulo">{jaTem ? 'Entrar numa agenda' : `Oi${profile?.full_name ? ', ' + profile.full_name.split(' ')[0] : ''}!`}</h2>
        <p className="muted login-sub">
          {modo === 'camera' ? 'Aponte para o QR da profissional ou do salão.' : jaTem ? 'Escaneie o QR ou digite o código de outra profissional ou salão.' : 'Para ver horários e marcar, entre na agenda da sua profissional. Peça o QR ou o código dela.'}
        </p>

        {erro && <div className="alert alert-error">{erro}</div>}

        {modo === 'menu' && (
          <div className="entrar-opcoes">
            <button className="btn btn-primary btn-block" onClick={() => { setErro(''); setModo('camera') }}><ScanLine size={18} /> Escanear o QR</button>
            <button className="btn btn-ghost btn-block" onClick={() => { setErro(''); setModo('codigo') }}>Digitar o código ou colar o link</button>
          </div>
        )}

        {modo === 'camera' && (
          <>
            <LeitorQr onLido={lido} onErro={erroCamera} />
            <button className="btn btn-ghost btn-block" onClick={() => { setErro(''); setModo('codigo') }} disabled={enviando}>Digitar o código</button>
            <button className="btn btn-ghost btn-block" onClick={() => (jaTem ? navigate(-1) : setModo('menu'))} disabled={enviando}>{enviando ? 'Entrando…' : 'Cancelar'}</button>
          </>
        )}

        {modo === 'codigo' && (
          <form className="form" onSubmit={(e) => { e.preventDefault(); vincular(texto, texto.includes('/') ? 'link' : 'codigo') }}>
            <label>Código ou link
              <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="ANA7K2" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
            </label>
            <button type="submit" className="btn btn-primary btn-block" disabled={enviando || !texto.trim()}>{enviando ? 'Entrando…' : 'Entrar na agenda'}</button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => { setErro(''); setModo('menu') }}>Voltar</button>
          </form>
        )}

        <p className="login-troca muted">
          {jaTem ? (
            <button type="button" className="link-ver" onClick={() => navigate('/cliente/home')}>Voltar para minhas agendas</button>
          ) : (
            <button type="button" className="link-ver" onClick={async () => { if (await confirmar({ titulo: 'Sair da conta?', ok: 'Sair', cancelar: 'Ficar' })) signOut() }}>Sair da conta</button>
          )}
        </p>
      </div>
    </div>
  )
}
