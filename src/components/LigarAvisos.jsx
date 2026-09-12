import { useEffect, useState } from 'react'
import { BellRing, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { estadoPush, ativarPush } from '../lib/push'

// O convite para ligar os avisos no celular, nas telas iniciais. Só
// aparece quando dá para ligar (ou quando falta instalar, no iPhone).
// "Agora não" esconde por 7 dias; ligou, some de vez.
const CHAVE = 'mimo-ligar-avisos-depois'
export default function LigarAvisos({ texto }) {
  const { user } = useAuth()
  const [estado, setEstado] = useState(null)
  const [mexendo, setMexendo] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let adiado = 0
    try { adiado = Number(localStorage.getItem(CHAVE) || 0) } catch { /* sem storage */ }
    if (adiado > Date.now()) return
    estadoPush().then(setEstado)
  }, [])

  if (!estado || !['desligado', 'instale'].includes(estado)) return null

  async function ligar() {
    setMexendo(true); setErro('')
    try { await ativarPush(user.id); setEstado('ligado') } catch (e) { setErro(e.message) } finally { setMexendo(false) }
  }
  function depois() {
    try { localStorage.setItem(CHAVE, String(Date.now() + 7 * 86400e3)) } catch { /* sem storage */ }
    setEstado(null)
  }

  return (
    <div className="card ligar-avisos">
      <span className="ligar-avisos-icone"><BellRing size={22} /></span>
      <div className="ligar-avisos-texto">
        <strong>{estado === 'instale' ? 'Instale o MIMO para receber avisos' : 'Ligue os avisos no celular'}</strong>
        <span className="muted">{estado === 'instale'
          ? 'No Safari, toque em Compartilhar e em "Adicionar à Tela de Início". Depois, ligue os avisos aqui.'
          : (texto || 'Confirmações, lembretes e recados chegam na hora, mesmo com o app fechado.')}</span>
        {erro && <span className="ligar-avisos-erro">{erro}</span>}
        <div className="ligar-avisos-botoes">
          {estado === 'desligado' && <button className="btn btn-primary btn-mini" onClick={ligar} disabled={mexendo}>{mexendo ? 'Ligando…' : 'Ligar avisos'}</button>}
          <button className="btn btn-ghost btn-mini" onClick={depois}>Agora não</button>
        </div>
      </div>
      <button type="button" className="ligar-avisos-fechar" onClick={depois} aria-label="Agora não"><X size={16} /></button>
    </div>
  )
}
