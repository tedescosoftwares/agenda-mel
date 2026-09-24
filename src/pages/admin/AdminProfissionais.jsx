import { useCallback, useEffect, useState } from 'react'
import { useDialogo } from '../../context/DialogoContext'
import { Link } from 'react-router-dom'
import AdminShell from '../../components/AdminShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { ChevronIcon, LinkIcon, ClockIcon } from '../../components/icons'
import Avatar from '../../components/Avatar'
import { FileSignature, MessageCircle, Plus, Link2, Copy } from 'lucide-react'
import { STATUS } from '../../lib/contratoParceria'
import { urlDoAmbiente } from '../../lib/ambiente'
import { situacaoDe, resumoDias, vinculoPor, mensagemDeAcesso, primeiroNome } from '../../lib/equipe'
import ProfissionalDrawer from '../../components/ProfissionalDrawer'
import '../../equipe.css'

// A equipe do salão (119): a mesma gaveta do onboarding configura a
// profissional inteira (dados, vínculo, serviços, horários, repasse,
// permissões) e a lista mostra a situação de cada uma — quem ainda não
// ativou o acesso ganha o botão de mandar o link.
export default function AdminProfissionais() {
  const { confirmar } = useDialogo()
  const { salao } = useAuth()
  const [equipe, setEquipe] = useState(null)
  const [services, setServices] = useState([])
  const [cats, setCats] = useState([])
  const [parcerias, setParcerias] = useState({}) // professional_id -> linha de parcerias_da_equipe
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [gaveta, setGaveta] = useState(null) // null | 'nova' | profissional
  const [coletar, setColetar] = useState(false)
  const linkEquipe = urlDoAmbiente('pro', `/equipe/${salao?.codigo_equipe ?? ''}`)

  const fetchTudo = useCallback(async () => {
    if (!salao?.id) return
    const [eq, servRes, catRes, parcRes] = await Promise.all([
      supabase.rpc('equipe_da_casa', { salao: salao.id }),
      supabase.from('services').select('id, name, price, duration_minutes, categoria_id').eq('salon_id', salao.id).eq('active', true).order('name'),
      supabase.from('categorias_de_servico').select('id, salon_id, nome').or(`salon_id.eq.${salao.id},salon_id.is.null`),
      supabase.rpc('parcerias_da_equipe', { salao: salao.id }),
    ])
    if (eq.error) setError('Erro ao carregar a equipe: ' + eq.error.message)
    else { setEquipe(Array.isArray(eq.data) ? eq.data : []); setError('') }
    setServices(servRes.data ?? []); setCats(catRes.data ?? [])
    setParcerias(Object.fromEntries((parcRes.data ?? []).map((l) => [l.professional_id, l])))
  }, [salao?.id])
  useEffect(() => { fetchTudo() }, [fetchTudo])

  async function acao(qual, p) {
    setError(''); setInfo('')
    if (qual === 'remover') {
      const ok = await confirmar({ titulo: `Remover ${p.name} do salão?`, texto: 'Ela perde o acesso à agenda deste salão. O histórico de atendimentos fica guardado.', ok: 'Remover', perigo: true })
      if (!ok) return
    }
    const { error } = await supabase.rpc('equipe_situacao', { prof: p.id, acao: qual })
    if (error) setError(error.message)
    else fetchTudo()
  }
  async function copiarLink(p) {
    const url = urlDoAmbiente('cliente', `/p/${p.slug}`)
    try { await navigator.clipboard.writeText(url); setInfo(`Link de ${p.name} copiado: ${url}`) } catch { setInfo(`Link de ${p.name}: ${url}`) }
  }
  async function enviado(p) { try { await supabase.rpc('equipe_acesso_enviado', { prof: p.id }) } catch { /* segue */ } fetchTudo() }
  async function copiarAcesso(p) {
    const url = urlDoAmbiente('pro', `/ativar/${p.token}`)
    try { await navigator.clipboard.writeText(url); setInfo(`Link de acesso de ${primeiroNome(p.name)} copiado.`) } catch { setInfo(`Link de acesso: ${url}`) }
    enviado(p)
  }

  const lista = equipe ?? []
  const ativas = lista.filter((p) => p.situacao === 'ativa').length
  const pendentes = lista.filter((p) => p.situacao === 'configurada' && !p.user_id)
  const rascunhos = lista.filter((p) => p.situacao === 'rascunho')

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <h2>Equipe</h2>
          <p className="muted">
            {lista.length} {lista.length === 1 ? 'profissional' : 'profissionais'}
            {lista.length > 0 ? ` · ${ativas} ativa${ativas === 1 ? '' : 's'}` : ''}
            {pendentes.length > 0 ? ` · ${pendentes.length} aguardando ativação` : ''}
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {info && <div className="alert alert-info">{info}</div>}
      {rascunhos.length > 0 && <div className="alert alert-info">{rascunhos.length === 1 ? `${rascunhos[0].name} mandou nome e WhatsApp pelo link da equipe.` : `${rascunhos.length} profissionais mandaram os dados pelo link da equipe.`} Configure para liberar o acesso.</div>}

      {/* o horário padrão do salão é da casa, não de uma profissional */}
      <Link to="/admin/horarios" className="card prof-row atalho-horarios">
        <span className="ajuste-icone"><ClockIcon /></span>
        <div className="cliente-info">
          <span className="cliente-nome"><span className="nome-txt">Horário padrão do salão</span></span>
          <span className="muted cliente-meta">Quem usa o horário do salão acompanha quando ele mudar</span>
        </div>
        <ChevronIcon />
      </Link>

      {equipe === null ? (
        <p className="muted">Carregando…</p>
      ) : lista.length === 0 ? (
        <div className="card empty-state">
          <p>Ninguém na equipe ainda.</p>
          <p className="muted">Você configura cada profissional; ela recebe um link e entra com a agenda pronta.</p>
          <button type="button" className="btn btn-primary" onClick={() => setGaveta('nova')}><Plus size={16} /> Adicionar profissional</button>
        </div>
      ) : (
        <div className="cliente-list">
          {lista.map((p) => {
            const sit = situacaoDe(p)
            const pendente = p.situacao === 'configurada' && !p.user_id
            const whats = pendente && p.token ? `https://wa.me/55${String(p.phone ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(mensagemDeAcesso({ salao: salao?.name, profissional: p.name, link: urlDoAmbiente('pro', `/ativar/${p.token}`) }))}` : ''
            return (
              <div key={p.id} className={'card prof-row' + (p.situacao === 'inativa' ? ' inactive' : '')}>
                <Avatar nome={p.name} foto={p.photo_url} />
                <div className="cliente-info">
                  <span className="cliente-nome"><span className="nome-txt">{p.name}</span>{p.dona && <em className="eq-papel">Administradora</em>}</span>
                  <span className="muted cliente-meta">
                    {p.especialidade || vinculoPor(p.vinculo)?.nome || 'Profissional'} · {p.situacao === 'rascunho' ? 'só nome e WhatsApp' : `${(p.servicos ?? []).length} serviço${(p.servicos ?? []).length === 1 ? '' : 's'} · ${resumoDias(p.horarios)}`}
                  </span>
                  <span className="prof-selos">
                    <span className={'gv-situacao ' + sit.cor}>{sit.rotulo}</span>
                    {parcerias[p.id] && (!p.vinculo || p.vinculo === 'parceira') && <span className={'parceria-selo ' + parcerias[p.id].status}>{parcerias[p.id].status === 'sem_contrato' ? 'sem contrato' : `${STATUS[parcerias[p.id].status]?.toLowerCase()}${parcerias[p.id].status === 'assinado' && parcerias[p.id].homologacao !== 'homologado' ? ', sem homologação' : ''}`}</span>}
                  </span>
                  {p.situacao === 'rascunho' && <button type="button" className="btn-mini prof-acao" onClick={() => setGaveta(p)}>Configurar profissional</button>}
                  {pendente && whats && <span className="prof-acoes"><a className="btn-mini" href={whats} target="_blank" rel="noreferrer" onClick={() => enviado(p)}><MessageCircle size={12} /> {p.acesso_enviado_em ? 'Reenviar acesso' : 'Enviar acesso'}</a><button type="button" className="btn-mini btn-mini-neutro" onClick={() => copiarAcesso(p)}><Copy size={12} /> Copiar link</button></span>}
                </div>
                {parcerias[p.id] && (!p.vinculo || p.vinculo === 'parceira') && (
                  <Link to={`/admin/equipe/${p.id}/parceria`} className="icon-btn" aria-label={`Contrato de parceria de ${p.name}`} title="Contrato de parceria"><FileSignature size={18} /></Link>
                )}
                <button className="icon-btn" onClick={() => copiarLink(p)} aria-label={`Copiar link de ${p.name}`} title="Copiar link da agenda dela"><LinkIcon /></button>
                {!p.dona && (
                  <label className="switch" title={p.situacao === 'inativa' ? 'Reativar' : 'Desativar'}>
                    <input type="checkbox" checked={p.situacao !== 'inativa'} onChange={() => acao(p.situacao === 'inativa' ? 'reativar' : 'desativar', p)} />
                    <span></span>
                  </label>
                )}
                <button className="icon-btn" onClick={() => setGaveta(p)} aria-label={`Configurar ${p.name}`}><ChevronIcon /></button>
              </div>
            )
          })}
        </div>
      )}

      {salao?.codigo_equipe && (
        <div className="card eq-coletar" style={{ marginTop: '0.8rem' }}>
          <div>
            <strong><Link2 size={14} /> Coletar dados da equipe por link</strong>
            <p>Compartilhe este link para a profissional informar nome e WhatsApp. Você conclui a configuração dela antes de liberar o acesso.</p>
            {coletar ? <div className="ob-link"><input readOnly value={linkEquipe} onFocus={(e) => e.target.select()} /><button type="button" className="btn-mini" onClick={() => { navigator.clipboard?.writeText(linkEquipe); setInfo('Link da equipe copiado.') }}><Copy size={12} /> Copiar</button></div> : <button type="button" className="btn-mini btn-mini-neutro" onClick={() => setColetar(true)}>Mostrar link</button>}
          </div>
        </div>
      )}

      {gaveta && salao && <ProfissionalDrawer salao={salao} profissional={gaveta === 'nova' ? null : gaveta} servicos={services} cats={cats} onFechar={() => { setGaveta(null); fetchTudo() }} onSalvo={() => fetchTudo()} />}
      {!gaveta && <button className="fab" onClick={() => setGaveta('nova')} aria-label="Adicionar profissional">+</button>}
    </AdminShell>
  )
}
