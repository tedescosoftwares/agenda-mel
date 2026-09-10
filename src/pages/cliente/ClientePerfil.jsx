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
import CampoSenha from '../../components/CampoSenha'
import { Plus, Gift, Hourglass, MessageCircle, ShieldCheck, Lock } from 'lucide-react'

// Perfil da cliente (065): foto, nome, desde quando, os números dela
// (atendimentos, próximos, agendas, créditos), dados editáveis na
// própria tela, as agendas, as preferências de aviso e a saída.
export default function ClientePerfil() {
  const { confirmar } = useDialogo()
  const { profile, user, signOut, recarregarPerfil, vinculos, recarregarVinculos } = useAuth()
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [resumo, setResumo] = useState(null)
  // o que está aberto embaixo: 'nasc' | 'fone' | 'email' | null
  const [folha, setFolha] = useState(null)
  const [nasc, setNasc] = useState('')
  const [fone, setFone] = useState('')
  const [codigo, setCodigo] = useState('')
  const [pedido, setPedido] = useState(null)
  const [novoEmail, setNovoEmail] = useState('')
  const [senhaAtual, setSenhaAtual] = useState('')
  const [feito, setFeito] = useState('')

  useEffect(() => { supabase.rpc('meu_perfil_resumo').then(({ data }) => setResumo(data ?? {})) }, [profile?.id])

  function abrir(qual) {
    setErro(''); setFeito(''); setCodigo(''); setPedido(null); setSenhaAtual(''); setNovoEmail('')
    setNasc(profile?.nascimento ?? ''); setFone('')
    setFolha(qual)
  }
  function fechar() { setFolha(null); setErro('') }

  async function salvarNasc() {
    setSalvando(true)
    const { error } = await supabase.from('profiles').update({ nascimento: nasc || null }).eq('id', profile.id)
    setSalvando(false)
    if (error) setErro(error.message)
    else { fechar(); recarregarPerfil?.() }
  }

  // WhatsApp: o código vai para o número NOVO (ou para o e-mail, sem canal ligado)
  async function pedirCodigo() {
    if (!foneValido(fone)) { setErro('Confere o WhatsApp: DDD + 9 dígitos.'); return }
    setSalvando(true); setErro('')
    const { data, error } = await supabase.rpc('pedir_troca_whatsapp', { novo: formatarFone(fone) })
    setSalvando(false)
    if (error) setErro(error.message)
    else setPedido(data)
  }
  async function confirmarCodigo() {
    setSalvando(true); setErro('')
    const { error } = await supabase.rpc('confirmar_troca_whatsapp', { codigo_: codigo.trim() })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    fechar(); setFeito('WhatsApp trocado. Os próximos avisos vão para o número novo.')
    recarregarPerfil?.()
  }

  // e-mail: confere a senha, e o Supabase manda o link de confirmação para o endereço novo
  async function trocarEmail() {
    const alvo = novoEmail.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(alvo)) { setErro('Confere o e-mail novo.'); return }
    if (alvo === (user?.email ?? '').toLowerCase()) { setErro('Esse já é o seu e-mail.'); return }
    setSalvando(true); setErro('')
    const { error: e1 } = await supabase.auth.signInWithPassword({ email: user.email, password: senhaAtual })
    if (e1) { setSalvando(false); setErro('Senha atual incorreta.'); return }
    const { error: e2 } = await supabase.auth.updateUser({ email: alvo })
    setSalvando(false)
    if (e2) { setErro(e2.message); return }
    fechar(); setFeito(`Mandamos um link para ${alvo}. O e-mail só muda depois que você tocar nele.`)
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

      {feito && <div className="alert alert-info">{feito}</div>}

      <h3 className="secao-titulo">Meus dados</h3>
      <div className="card">
        <div className="dado-linha"><span className="muted">Nome</span><strong className="dado-travado"><Lock size={12} /> {profile?.full_name || '—'}</strong></div>
        <div className="dado-linha"><span className="muted">WhatsApp</span><strong>{profile?.phone || 'não informado'} <button className="link-ver" onClick={() => abrir('fone')}>trocar</button></strong></div>
        <div className="dado-linha"><span className="muted">E-mail</span><strong className="quebra">{user?.email} <button className="link-ver" onClick={() => abrir('email')}>trocar</button></strong></div>
        <div className="dado-linha"><span className="muted">Aniversário</span><strong>{profile?.nascimento ? aniversario(profile.nascimento) : '—'} <button className="link-ver" onClick={() => abrir('nasc')}>{profile?.nascimento ? 'editar' : 'adicionar'}</button></strong></div>
        <p className="muted dado-nota">O nome é como a profissional te conhece. Para corrigir, fale com a gente em Contato e ajuda.</p>
      </div>

      {folha && (
        <div className="modal-fundo" onClick={fechar} role="presentation">
          <div className="modal-caixa folha-dados" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            {folha === 'nasc' && (
              <>
                <h3>Aniversário</h3>
                <p className="muted">A profissional gosta de lembrar.</p>
                <div className="form">
                  <label>Data<input type="date" value={nasc} onChange={(e) => setNasc(e.target.value)} /></label>
                </div>
              </>
            )}
            {folha === 'fone' && !pedido && (
              <>
                <h3>Trocar WhatsApp</h3>
                <p className="muted">Mandamos um código de 6 dígitos para o número novo. Assim a gente sabe que ele é seu.</p>
                <div className="form">
                  <label>Número novo<input type="tel" inputMode="numeric" value={fone} onChange={(e) => setFone(formatarFone(e.target.value))} placeholder="(13) 99999-9999" /></label>
                </div>
              </>
            )}
            {folha === 'fone' && pedido && (
              <>
                <h3>Digite o código</h3>
                <p className="muted">{pedido.via === 'whatsapp' ? `Chegou no WhatsApp ${pedido.para}.` : `Nenhuma agenda sua tem WhatsApp ligado, então mandamos para o e-mail ${pedido.para}.`} Vale por 10 minutos.</p>
                <div className="form">
                  <label>Código<input inputMode="numeric" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} placeholder="000000" className="campo-codigo" /></label>
                </div>
              </>
            )}
            {folha === 'email' && (
              <>
                <h3>Trocar e-mail</h3>
                <p className="muted">Por segurança, confirme a senha. Depois um link vai para o e-mail novo; o antigo continua valendo até você tocar nele.</p>
                <div className="form">
                  <label>E-mail novo<input type="email" value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)} placeholder="novo@email.com" /></label>
                  <CampoSenha rotulo="Senha atual" valor={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} autoComplete="current-password" dica={false} />
                </div>
              </>
            )}
            {erro && <div className="alert alert-error">{erro}</div>}
            <div className="modal-acoes">
              <button className="btn btn-ghost" onClick={fechar}>Cancelar</button>
              {folha === 'nasc' && <button className="btn btn-primary" onClick={salvarNasc} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>}
              {folha === 'fone' && !pedido && <button className="btn btn-primary" onClick={pedirCodigo} disabled={salvando || !foneValido(fone)}>{salvando ? 'Enviando…' : 'Mandar código'}</button>}
              {folha === 'fone' && pedido && <button className="btn btn-primary" onClick={confirmarCodigo} disabled={salvando || codigo.length !== 6}>{salvando ? 'Conferindo…' : 'Confirmar'}</button>}
              {folha === 'email' && <button className="btn btn-primary" onClick={trocarEmail} disabled={salvando || !novoEmail || !senhaAtual}>{salvando ? 'Enviando…' : 'Mandar link'}</button>}
            </div>
          </div>
        </div>
      )}

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
          <span className="ajuste-icone"><Plus /></span>
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
          <span className="ajuste-icone"><Gift /></span>
          <span className="cliente-info"><span className="cliente-nome"><span className="nome-txt">Indique e ganhe</span></span><span className="muted cliente-meta">Seu código, suas amigas e seus créditos</span></span>
          <ChevronIcon />
        </Link>
        <Link to="/cliente/fila-espera" className="card prof-row">
          <span className="ajuste-icone"><Hourglass /></span>
          <span className="cliente-info"><span className="cliente-nome"><span className="nome-txt">Fila de espera</span></span><span className="muted cliente-meta">Onde você está esperando vaga</span></span>
          <ChevronIcon />
        </Link>
        <a href="https://wa.me/5513991719086" className="card prof-row" target="_blank" rel="noreferrer">
          <span className="ajuste-icone"><MessageCircle /></span>
          <span className="cliente-info"><span className="cliente-nome"><span className="nome-txt">Contato e ajuda</span></span><span className="muted cliente-meta">Fale com o salão pelo WhatsApp</span></span>
          <ChevronIcon />
        </a>
        <Link to="/privacidade" className="card prof-row">
          <span className="ajuste-icone"><ShieldCheck /></span>
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
