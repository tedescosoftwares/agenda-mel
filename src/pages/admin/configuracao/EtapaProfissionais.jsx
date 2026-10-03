import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Pencil, Camera, Check } from 'lucide-react'
import Portal from '../../../components/Portal'
import Avatar from '../../../components/Avatar'
import ProfissionalDrawer from '../../../components/ProfissionalDrawer'
import { supabase } from '../../../lib/supabase'
import { reduzirFoto } from '../../../lib/imagem'
import { formatarFone } from '../../../lib/fone'
import { FUNCOES, PERMISSOES_RECOMENDADAS } from '../../../lib/equipe'
import { useAuth } from '../../../context/AuthContext'

// Etapa 3 da configuração inicial (2.94): "Quem atende por aí?" — a
// equipe em cartões. Cadastro rápido (nome, WhatsApp, cargo, foto) pela
// mesma RPC da gaveta; editar abre a gaveta completa. Autônoma vê "Você".
export default function EtapaProfissionais({ s, autonoma, setErro, onEstado }) {
  const { profile } = useAuth()
  const [equipe, setEquipe] = useState(null)
  const [servicos, setServicos] = useState([])
  const [cats, setCats] = useState([])
  const [novo, setNovo] = useState(false)
  const [gaveta, setGaveta] = useState(null)
  const carregar = useCallback(async () => {
    const [eq, sv, ct] = await Promise.all([
      supabase.rpc('equipe_da_casa', { salao: s.id }),
      supabase.from('services').select('id, name, price, duration_minutes, categoria_id').eq('salon_id', s.id).eq('active', true).order('name'),
      supabase.from('categorias_de_servico').select('id, salon_id, nome, ordem, slug, ativa').or(`salon_id.eq.${s.id},salon_id.is.null`).order('ordem'),
    ])
    setEquipe(Array.isArray(eq.data) ? eq.data : []); setServicos(sv.data ?? []); setCats(ct.data ?? [])
  }, [s.id])
  useEffect(() => { carregar() }, [carregar])
  const ativas = (equipe ?? []).filter((p) => p.situacao !== 'inativa')
  const dona = ativas.find((p) => p.dona) ?? null

  // autônoma: tudo é dela; ao continuar, os serviços sem vínculo entram na agenda dela
  useEffect(() => {
    onEstado({
      podeContinuar: autonoma || ativas.length > 0,
      rodape: autonoma ? 'Sua agenda é só sua' : ativas.length === 0 ? 'Adicione pelo menos uma profissional' : `${ativas.length} ${ativas.length === 1 ? 'profissional' : 'profissionais'}`,
      aoContinuar: autonoma && dona ? async () => {
        const ligados = new Set((dona.servicos ?? []).map((x) => x.service_id))
        const faltam = servicos.filter((sv) => !ligados.has(sv.id)).map((sv) => ({ professional_id: dona.id, service_id: sv.id }))
        if (faltam.length) await supabase.from('professional_services').insert(faltam)
      } : null,
    })
  }, [autonoma, ativas.length, dona?.id, servicos.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="cfg-etapa cfg-etapa-equipe">
      <header className="cfg-etapa-topo">
        <h2>{autonoma ? 'Sua agenda' : 'Quem atende por aí?'}</h2>
        <p>{autonoma ? 'Você é a profissional da sua agenda. Todos os serviços entram nela.' : 'Adicione quem vai aparecer na agenda. Depois ligamos cada pessoa aos serviços.'}</p>
      </header>
      {equipe === null ? <p className="muted">Carregando…</p> : (
        <div className="cfg-equipe-grade">
          {autonoma && (
            <div className="cfg-prof voce">
              <Avatar nome={dona?.name ?? profile?.full_name ?? 'Você'} foto={dona?.photo_url ?? profile?.avatar_url} grande />
              <strong>{dona?.name ?? profile?.full_name ?? 'Você'}</strong>
              <small>Você</small>
              <span className="cfg-prof-ok"><Check size={13} /> Já adicionada</span>
            </div>
          )}
          {!autonoma && ativas.map((p) => (
            <div key={p.id} className={'cfg-prof' + (p.dona ? ' voce' : '')}>
              <Avatar nome={p.name} foto={p.photo_url} grande />
              <strong>{p.name}</strong>
              <small>{p.dona ? 'Você' : (p.especialidade || 'Profissional')}</small>
              <span className="muted">{(p.servicos ?? []).length} {(p.servicos ?? []).length === 1 ? 'serviço' : 'serviços'}</span>
              {!p.dona && <button type="button" className="btn btn-ghost btn-mini" onClick={() => setGaveta(p)}><Pencil size={13} /> Editar</button>}
            </div>
          ))}
          {!autonoma && (
            <button type="button" className="cfg-prof cfg-prof-mais" onClick={() => setNovo(true)}>
              <span className="cfg-prof-mais-icone"><Plus size={22} /></span>
              <strong>{ativas.length ? 'Adicionar profissional' : 'Adicionar primeira profissional'}</strong>
              <small>{ativas.length ? '' : 'Quem trabalha com você?'}</small>
            </button>
          )}
        </div>
      )}
      {novo && <ProfissionalQuickForm salao={s} onFechar={() => setNovo(false)} onSalvo={() => { setNovo(false); carregar() }} setErro={setErro} />}
      {gaveta && <ProfissionalDrawer salao={s} profissional={gaveta} servicos={servicos} cats={cats} onFechar={() => { setGaveta(null); carregar() }} onSalvo={() => carregar()} />}
    </section>
  )
}

// o cadastro rápido: só o que a agenda precisa agora
function ProfissionalQuickForm({ salao, onFechar, onSalvo, setErro }) {
  const [v, setV] = useState({ name: '', phone: '', email: '', especialidade: '', foto: null })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErroLocal] = useState('')
  const arq = useRef(null)
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }))
  async function trocarFoto(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    try { setV((x) => ({ ...x, foto: null })); const r = await reduzirFoto(file, { max: 512, quadrado: true }); setV((x) => ({ ...x, foto: r })) } catch (err) { setErroLocal(err.message) }
  }
  async function salvar(e) {
    e.preventDefault()
    if (!v.name.trim()) { setErroLocal('Diga o nome dela.'); return }
    if (v.phone.replace(/\D/g, '').length < 10) { setErroLocal('Diga o WhatsApp: é por ele que ela recebe os avisos e o acesso.'); return }
    setSalvando(true); setErroLocal('')
    try {
      let photo_url = null
      if (v.foto?.blob) {
        const path = `equipe/${crypto.randomUUID()}.jpg`
        const { error } = await supabase.storage.from('professional-photos').upload(path, v.foto.blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
        if (error) throw new Error('Não deu para subir a foto: ' + error.message)
        photo_url = supabase.storage.from('professional-photos').getPublicUrl(path).data.publicUrl
      }
      const dados = { name: v.name.trim(), phone: v.phone.trim(), email: v.email.trim() || null, especialidade: v.especialidade || null, photo_url, servicos: [], usa_horario_salao: true, permissoes: PERMISSOES_RECOMENDADAS }
      const { error } = await supabase.rpc('equipe_salvar_profissional', { salao: salao.id, dados })
      if (error) throw new Error(error.message)
      onSalvo()
    } catch (err) { setErroLocal(err.message); setErro?.('') } finally { setSalvando(false) }
  }
  return (
    <Portal><div className="modal-fundo cfg-drawer-fundo" onClick={onFechar}>
      <form className="cfg-drawer" onClick={(e) => e.stopPropagation()} onSubmit={salvar} role="dialog" aria-modal="true" aria-label="Adicionar profissional">
        <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">×</button>
        <h3>Adicionar profissional</h3>
        <p className="muted">Só o essencial agora. Horários, repasse e acesso ficam em Profissionais, quando quiser.</p>
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className="cfg-quick-foto">
          <button type="button" className="cfg-foto-btn" onClick={() => arq.current?.click()}>{v.foto ? <img src={v.foto.preview} alt="" /> : <><Camera size={18} /><span>Foto</span></>}</button>
          <input ref={arq} type="file" accept="image/*" hidden onChange={trocarFoto} />
          <div className="cfg-quick-campos">
            <label>Nome<input value={v.name} onChange={set('name')} placeholder="Nome completo" autoFocus /></label>
            <label>WhatsApp<input value={v.phone} onChange={(e) => setV((x) => ({ ...x, phone: formatarFone(e.target.value) }))} inputMode="tel" placeholder="(13) 99999-0000" /></label>
          </div>
        </div>
        <label>E-mail <small className="muted">(opcional, para o acesso dela)</small><input type="email" value={v.email} onChange={set('email')} placeholder="ela@exemplo.com" /></label>
        <label>Cargo <small className="muted">(opcional)</small>
          <div className="chips cfg-chips">{FUNCOES.map((f) => <button key={f} type="button" className={'chip' + (v.especialidade === f ? ' active' : '')} onClick={() => setV((x) => ({ ...x, especialidade: x.especialidade === f ? '' : f }))}>{f}</button>)}</div>
        </label>
        <div className="modal-acoes"><button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button><button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? 'Salvando…' : 'Adicionar'}</button></div>
      </form>
    </div></Portal>
  )
}
