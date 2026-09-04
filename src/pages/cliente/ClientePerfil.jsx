import { useState } from 'react'
import { useDialogo } from '../../context/DialogoContext'
import { Link } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Avatar from '../../components/Avatar'
import { ChevronIcon } from '../../components/icons'

// Perfil (tela 14): dados pessoais, contato, preferências, e a saída.
// Nome e telefone se editam aqui — o telefone é o que amarra a conta ao
// WhatsApp, então errar ele é ficar sem aviso nenhum.
export default function ClientePerfil() {
  const { confirmar } = useDialogo()
  const { profile, user, signOut, recarregarPerfil } = useAuth()
  const [editando, setEditando] = useState(false)
  const [nome, setNome] = useState(profile?.full_name ?? '')
  const [fone, setFone] = useState(profile?.phone ?? '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    setSalvando(true)
    const { error } = await supabase.from('profiles').update({ full_name: nome.trim(), phone: fone.trim() || null }).eq('id', profile.id)
    setSalvando(false)
    if (error) setErro(error.message)
    else { setErro(''); setEditando(false); recarregarPerfil?.() }
  }

  async function trocarLembretes(v) {
    const { error } = await supabase.from('profiles').update({ accepts_reminders: v }).eq('id', profile.id)
    if (error) setErro(error.message)
    else recarregarPerfil?.()
  }

  return (
    <ClienteShell titulo="Perfil">
      <div className="cl-perfil-topo">
        <Avatar nome={profile?.full_name || user?.email} grande />
        <h2>{profile?.full_name || 'Minha conta'}</h2>
        <p className="muted">{user?.email}</p>
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}

      <h3 className="secao-titulo">Dados pessoais</h3>
      <div className="card">
        {editando ? (
          <div className="form">
            <label>Nome completo<input value={nome} onChange={(e) => setNome(e.target.value)} /></label>
            <label>WhatsApp<input type="tel" value={fone} onChange={(e) => setFone(e.target.value)} placeholder="(11) 99999-9999" /></label>
            <div className="modal-acoes">
              <button className="btn btn-ghost" onClick={() => setEditando(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="dado-linha"><span className="muted">Nome</span><strong>{profile?.full_name || '—'}</strong></div>
            <div className="dado-linha"><span className="muted">WhatsApp</span><strong>{profile?.phone || 'não informado'}</strong></div>
            <div className="dado-linha"><span className="muted">E-mail</span><strong>{user?.email}</strong></div>
            <button className="btn-mini" style={{ marginTop: '0.7rem' }} onClick={() => { setNome(profile?.full_name ?? ''); setFone(profile?.phone ?? ''); setEditando(true) }}>Editar</button>
          </>
        )}
      </div>

      <h3 className="secao-titulo">Preferências</h3>
      <div className="card cl-ajuste">
        <div className="cliente-info">
          <span className="cliente-nome"><span className="nome-txt">Lembretes no WhatsApp</span></span>
          <span className="muted cliente-meta">Aviso na véspera do seu horário</span>
        </div>
        <button className={'switch' + (profile?.accepts_reminders ? ' on' : '')} onClick={() => trocarLembretes(!profile?.accepts_reminders)} role="switch" aria-checked={Boolean(profile?.accepts_reminders)} aria-label="Lembretes no WhatsApp" />
      </div>

      <h3 className="secao-titulo">Mais</h3>
      <div className="cliente-list">
        <Link to="/cliente/indicacao" className="card prof-row">
          <span className="ajuste-icone">🎁</span>
          <span className="cliente-info"><span className="cliente-nome"><span className="nome-txt">Indique e ganhe</span></span><span className="muted cliente-meta">Seu código, suas amigas e seus créditos</span></span>
          <ChevronIcon />
        </Link>
        <Link to="/cliente/fila-espera" className="card prof-row">
          <span className="ajuste-icone">🕐</span>
          <span className="cliente-info"><span className="cliente-nome"><span className="nome-txt">Fila de espera</span></span><span className="muted cliente-meta">Onde você está esperando vaga</span></span>
          <ChevronIcon />
        </Link>
        <a href="https://wa.me/5513991719086" className="card prof-row" target="_blank" rel="noreferrer">
          <span className="ajuste-icone">💬</span>
          <span className="cliente-info"><span className="cliente-nome"><span className="nome-txt">Contato e ajuda</span></span><span className="muted cliente-meta">Fale com o salão pelo WhatsApp</span></span>
          <ChevronIcon />
        </a>
      </div>

      <button className="btn btn-ghost btn-block" style={{ marginTop: '1.4rem' }} onClick={async () => { if (await confirmar({ titulo: 'Sair da conta?', ok: 'Sair', cancelar: 'Ficar' })) signOut() }}>
        Sair da conta
      </button>
    </ClienteShell>
  )
}
