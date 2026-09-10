import { useEffect, useState } from 'react'
import { useDialogo } from '../../context/DialogoContext'
import { Link } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import FotoUpload from '../../components/FotoUpload'
import { ChevronIcon } from '../../components/icons'
import AvisosNoCelular from '../../components/AvisosNoCelular'
import AvisosPorEmail from '../../components/AvisosPorEmail'
import RodapeSocial from '../../components/RodapeSocial'
import { formatarFone, foneValido } from '../../lib/fone'

// Perfil da cliente (065): foto, nome, desde quando, os números dela
// (atendimentos, próximos, agendas, créditos), dados editáveis na
// própria tela, as agendas, as preferências de aviso e a saída.
export default function ClientePerfil() {
  const { confirmar } = useDialogo()
  const { profile, user, signOut, recarregarPerfil, vinculos, recarregarVinculos } = useAuth()
  const [editando, setEditando] = useState(false)
  const [nome, setNome] = useState('')
  const [fone, setFone] = useState('')
  const [nasc, setNasc] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [resumo, setResumo] = useState(null)

  useEffect(() => { supabase.rpc('meu_perfil_resumo').then(({ data }) => setResumo(data ?? {})) }, [profile?.id])

  function abrirEdicao() {
    setNome(profile?.full_name ?? ''); setFone(profile?.phone ?? ''); setNasc(profile?.nascimento ?? ''); setErro(''); setEditando(true)
  }

  async function salvar() {
    if (nome.trim().length < 2) { setErro('Diga seu nome.'); return }
    if (fone && !foneValido(fone)) { setErro('Confere o WhatsApp: DDD + 9 dígitos.'); return }
    setSalvando(true)
    const { error } = await supabase.from('profiles').update({ full_name: nome.trim(), phone: fone ? formatarFone(fone) : null, nascimento: nasc || null }).eq('id', profile.id)
    setSalvando(false)
    if (error) setErro(error.message)
    else { setErro(''); setEditando(false); recarregarPerfil?.() }
  }

  async function salvarFoto(url) {
    const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', profile.id)
    if (error) setErro(error.message)
    else recarregarPerfil?.()
  }

  async function sairDaAgenda(ag) {
    const ok = await confirmar({ titulo: `Sair da agenda de ${ag.salao.nome}?`, texto: 'Você deixa de ver os horários de quem atende lá. Dá para voltar escaneando o QR de novo.', ok: 'Sair da agenda', perigo: true })
    if (!ok) return
    const { error } = await supabase.rpc('sair_da_agenda', { salao: ag.salao.id })
    if (error) setErro(error.message)
    else recarregarVinculos?.()
  }

  async function trocarLembretes(v) {
    const { error } = await supabase.from('profiles').update({ accepts_reminders: v }).eq('id', profile.id)
    if (error) setErro(error.message)
    else recarregarPerfil?.()
  }

  const desde = resumo?.desde ? new Date(resumo.desde).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '') : null
  const saldo = (resumo?.saldo_cents ?? 0) / 100

  return (
    <ClienteShell titulo="Perfil">
      <div className="cl-topo">
        <div className="cl-topo-capa" aria-hidden="true" />
        <div className="cl-topo-corpo">
          <FotoUpload compacto bucket="avatars" nome={profile?.full_name || user?.email} pasta={profile?.id} valor={profile?.avatar_url} onChange={salvarFoto} onErro={setErro} />
          <h2>{profile?.full_name || 'Minha conta'}</h2>
          <p className="muted">{desde ? `No MIMO desde ${desde}` : user?.email}</p>
          <div className="cl-numeros">
            <div><strong>{resumo?.atendimentos ?? '–'}</strong><span>atendimentos</span></div>
            <div><strong>{resumo?.proximos ?? '–'}</strong><span>marcados</span></div>
            <div><strong>{resumo?.agendas ?? (vinculos ?? []).length}</strong><span>{(resumo?.agendas ?? 1) === 1 ? 'agenda' : 'agendas'}</span></div>
            <div><strong>{saldo > 0 ? `R$ ${saldo.toFixed(0)}` : '–'}</strong><span>créditos</span></div>
          </div>
        </div>
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}

      <h3 className="secao-titulo">Meus dados</h3>
      <div className="card">
        {editando ? (
          <div className="form">
            <label>Nome e sobrenome<input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" /></label>
            <label>WhatsApp<input type="tel" inputMode="numeric" value={fone} onChange={(e) => setFone(formatarFone(e.target.value))} placeholder="(13) 99999-9999" />
              <span className="campo-dica muted">É por ele que chegam confirmação e lembrete.</span></label>
            <label>Aniversário<input type="date" value={nasc} onChange={(e) => setNasc(e.target.value)} /></label>
            <div className="modal-acoes">
              <button className="btn btn-ghost" onClick={() => setEditando(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="dado-linha"><span className="muted">Nome</span><strong>{profile?.full_name || '—'}</strong></div>
            <div className="dado-linha"><span className="muted">WhatsApp</span><strong>{profile?.phone || 'não informado'}</strong></div>
            <div className="dado-linha"><span className="muted">Aniversário</span><strong>{profile?.nascimento ? aniversario(profile.nascimento) : <button className="link-ver" onClick={abrirEdicao}>adicionar</button>}</strong></div>
            <div className="dado-linha"><span className="muted">E-mail</span><strong className="quebra">{user?.email}</strong></div>
            <button className="btn-mini" style={{ marginTop: '0.7rem' }} onClick={abrirEdicao}>Editar</button>
          </>
        )}
      </div>

      <h3 className="secao-titulo">Minhas agendas</h3>
      <div className="cliente-list">
        {(vinculos ?? []).map((ag) => (
          <div key={ag.salao.id} className="card cl-ajuste">
            <div className="cliente-info">
              <span className="cliente-nome"><span className="nome-txt">{ag.salao.nome}</span></span>
              <span className="muted cliente-meta">
                {ag.trazida_por ? `entrou pela ${ag.trazida_por.nome.split(' ')[0]}` : 'entrou pelo código do salão'} · {new Date(ag.entrou_em).toLocaleDateString('pt-BR')}
              </span>
            </div>
            <button className="btn-mini btn-mini-nao" onClick={() => sairDaAgenda(ag)}>Sair</button>
          </div>
        ))}
        <Link to="/cliente/entrar" className="card prof-row">
          <span className="ajuste-icone">➕</span>
          <span className="cliente-info"><span className="cliente-nome"><span className="nome-txt">Entrar em outra agenda</span></span><span className="muted cliente-meta">QR, código ou link da profissional</span></span>
          <ChevronIcon />
        </Link>
      </div>

      <h3 className="secao-titulo">Como você quer ser avisada</h3>
      <AvisosNoCelular />
      <AvisosPorEmail />
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
        <Link to="/privacidade" className="card prof-row">
          <span className="ajuste-icone">🔒</span>
          <span className="cliente-info"><span className="cliente-nome"><span className="nome-txt">Seus dados e privacidade</span></span><span className="muted cliente-meta">O que guardamos e como pedir a exclusão</span></span>
          <ChevronIcon />
        </Link>
      </div>

      <button className="btn btn-ghost btn-block" style={{ marginTop: '1.4rem' }} onClick={async () => { if (await confirmar({ titulo: 'Sair da conta?', ok: 'Sair', cancelar: 'Ficar' })) signOut() }}>
        Sair da conta
      </button>
      <RodapeSocial compacto />
    </ClienteShell>
  )
}

function aniversario(iso) {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })
}
