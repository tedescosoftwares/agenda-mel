import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useDocumentosLegais, precisaAceitar, aceitesPara, dataBr } from '../lib/legal'
import { tiposDoPapel, tipoLegal } from '../conteudo/legal'
import { FraseDeAceite } from './LinkLegal'
import { MarcaIcon, Wordmark } from './icons'

// A plataforma publicou termos novos (120): quem aceitou a versão antiga
// vê esta tela uma vez, na próxima entrada, e aceita antes de seguir.
// Só aparece quando existe versão publicada mais nova; sem banco, nunca.
export default function AceiteGate({ children }) {
  const { profile, recarregarPerfil } = useAuth()
  const docs = useDocumentosLegais()
  const [ok, setOk] = useState(false)
  const [indo, setIndo] = useState(false)
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState(false)
  if (feito || !docs || !precisaAceitar(profile, docs)) return children
  const tipos = tiposDoPapel(profile.role)
  async function aceitar() {
    setIndo(true); setErro('')
    const { error } = await supabase.rpc('aceitar_documentos', { aceites: aceitesPara(profile.role, docs), contexto: 'nova_versao' })
    if (error) { setErro(error.message); setIndo(false); return }
    setFeito(true)
    await recarregarPerfil?.()
  }
  return (
    <div className="page-center login-bg">
      <div className="card login-card entrar-card">
        <div className="brand"><MarcaIcon className="brand-icon" width={44} height={40} id="aceite" /><Wordmark tamanho={2.2} /></div>
        <span className="ativar-check espera"><ShieldCheck size={22} /></span>
        <h2 className="login-titulo">Atualizamos os nossos termos</h2>
        <p className="muted login-sub">Pra continuar usando a MIMO, é preciso ler e aceitar a versão nova. Leva um minuto.</p>
        <ul className="pronto-lista convite-lista ativar-lista">
          {tipos.map((t) => <li key={t}><ShieldCheck size={14} /><span>{tipoLegal(t).rotulo} · versão de {dataBr(docs[t].versao)}</span></li>)}
        </ul>
        {erro && <div className="alert alert-error">{erro}</div>}
        <label className="aceite-termos"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /><span><FraseDeAceite papel={profile.role} /></span></label>
        <button type="button" className="btn btn-primary btn-block" onClick={aceitar} disabled={!ok || indo}>{indo ? 'Aguarde…' : 'Aceitar e continuar'}</button>
      </div>
    </div>
  )
}
