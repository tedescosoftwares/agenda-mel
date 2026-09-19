import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { UserRound, LogOut, Bell, ChevronRight, Store } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useDialogo } from '../context/DialogoContext'
import { supabase } from '../lib/supabase'
import Avatar from './Avatar'

// O menu da conta na barra de cima (admin e pro): toca no avatar e abre
// um cartãozinho com quem está logada, os atalhos e o "Sair". "Minha
// conta" abre uma folha para mudar nome e telefone sem sair da tela.
// `itens` são os atalhos de cada ambiente: [{ to, rotulo, Icon }].
export default function MenuDaConta({ itens = [], papel, foto }) {
  const { profile, user, signOut, salao, saloes, trocarSalao, recarregarPerfil } = useAuth()
  const { confirmar } = useDialogo()
  const [aberto, setAberto] = useState(false)
  const [conta, setConta] = useState(false)
  const ref = useRef(null)
  const nome = profile?.full_name || user?.email || ''

  useEffect(() => {
    if (!aberto) return
    const fora = (e) => { if (!ref.current?.contains(e.target)) setAberto(false) }
    const tecla = (e) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('touchstart', fora, { passive: true })
    document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('touchstart', fora); document.removeEventListener('keydown', tecla) }
  }, [aberto])

  async function sair() {
    setAberto(false)
    if (await confirmar({ titulo: 'Sair da conta?', ok: 'Sair', cancelar: 'Ficar' })) signOut()
  }

  return (
    <div className="conta-menu" ref={ref}>
      <button type="button" className={'avatar-btn' + (aberto ? ' aberto' : '')} onClick={() => setAberto((v) => !v)} aria-haspopup="menu" aria-expanded={aberto} aria-label="Menu da conta">
        <Avatar nome={nome} foto={foto ?? profile?.avatar_url} pequeno />
      </button>
      {aberto && (
        <div className="conta-pop" role="menu">
          <div className="conta-pop-topo">
            <Avatar nome={nome} foto={foto ?? profile?.avatar_url} />
            <div className="conta-pop-quem">
              <strong>{nome}</strong>
              {user?.email && <span className="muted">{user.email}</span>}
              {papel && <span className="conta-papel">{papel}</span>}
            </div>
          </div>
          {saloes?.length > 1 && (
            <div className="conta-pop-saloes">
              <span className="muted">Salão em uso</span>
              <div className="chips">
                {saloes.map((x) => <button key={x.id} type="button" className={'chip' + (x.id === salao?.id ? ' active' : '')} onClick={() => { trocarSalao(x.id); setAberto(false) }}>{x.name}</button>)}
              </div>
            </div>
          )}
          <button type="button" role="menuitem" className="conta-item" onClick={() => { setAberto(false); setConta(true) }}><UserRound size={17} /><span>Minha conta</span><ChevronRight size={15} className="conta-seta" /></button>
          {itens.map((i) => (
            <Link key={i.to} to={i.to} role="menuitem" className="conta-item" onClick={() => setAberto(false)}><i.Icon size={17} /><span>{i.rotulo}</span><ChevronRight size={15} className="conta-seta" /></Link>
          ))}
          <button type="button" role="menuitem" className="conta-item conta-sair" onClick={sair}><LogOut size={17} /><span>Sair da conta</span></button>
        </div>
      )}
      {conta && <MinhaConta fechar={() => setConta(false)} profile={profile} user={user} recarregar={recarregarPerfil} />}
    </div>
  )
}

function MinhaConta({ fechar, profile, user, recarregar }) {
  const [nome, setNome] = useState(profile?.full_name ?? '')
  const [fone, setFone] = useState(profile?.phone ?? '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  async function salvar(e) {
    e.preventDefault()
    if (!nome.trim()) { setErro('Diga o seu nome.'); return }
    setSalvando(true); setErro('')
    const { error } = await supabase.from('profiles').update({ full_name: nome.trim(), phone: fone.trim() || null }).eq('id', user.id)
    if (error) { setErro(error.message); setSalvando(false); return }
    await recarregar?.()
    setSalvando(false)
    fechar()
  }
  return (
    <div className="modal-fundo" onClick={fechar}>
      <form className="modal-caixa conta-folha" onClick={(e) => e.stopPropagation()} onSubmit={salvar}>
        <button type="button" className="modal-fechar" onClick={fechar} aria-label="Fechar">×</button>
        <h3>Minha conta</h3>
        <p className="muted">É assim que seu nome aparece para a equipe e nas assinaturas.</p>
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className="form">
          <label>Nome<input value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={80} /></label>
          <label>Telefone<input value={fone} onChange={(e) => setFone(e.target.value)} inputMode="tel" placeholder="(13) 99999-0000" /></label>
          <label>E-mail<input value={user?.email ?? ''} readOnly disabled /><span className="muted salao-dica">O e-mail é o seu login. Para trocar, fale com o suporte.</span></label>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={fechar}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </div>
  )
}

export const ITENS_ADMIN = [
  { to: '/admin/salao', rotulo: 'Página do salão', Icon: Store },
  { to: '/avisos', rotulo: 'Avisos', Icon: Bell },
]
export const ITENS_PRO = [
  { to: '/pro/link', rotulo: 'Meu link', Icon: Store },
  { to: '/avisos', rotulo: 'Avisos', Icon: Bell },
]
