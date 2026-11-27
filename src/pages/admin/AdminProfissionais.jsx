import { useCallback, useEffect, useState } from 'react'
import { useDialogo } from '../../context/DialogoContext'
import { useNavigate, Link } from 'react-router-dom'
import AdminShell from '../../components/AdminShell'
import AcessosDoPainel from '../../components/AcessosDoPainel'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { ChevronIcon, LinkIcon, ClockIcon } from '../../components/icons'
import Avatar from '../../components/Avatar'
import { CalendarClock, Trash2, FileSignature, MessageCircle, Plus, Link2, Copy, Mail, UsersRound } from 'lucide-react'
import { STATUS, PARCERIA_LIGADA } from '../../lib/contratoParceria'
import { urlDoAmbiente } from '../../lib/ambiente'
import { situacaoDe, resumoDias, vinculoPor, primeiroNome, enviarAcesso, enviarAcessoWhats } from '../../lib/equipe'
import ProfissionalDrawer from '../../components/ProfissionalDrawer'
import '../../equipe.css'
import { linkDaProfissional } from '../../lib/endereco'
import AgendasExtras from '../../components/AgendasExtras'
import { PLANOS, precoPara, reais } from '../../lib/planos'

// A equipe do salão (119): a mesma gaveta do onboarding configura a
// profissional inteira (dados, vínculo, serviços, horários, repasse,
// permissões) e a lista mostra a situação de cada uma — quem ainda não
// ativou o acesso ganha o botão de mandar o link.
export default function AdminProfissionais() {
  const { confirmar } = useDialogo()
  const { salao, recarregarPerfil, acesso } = useAuth()
  const navigate = useNavigate()
  const [equipe, setEquipe] = useState(null)
  const [services, setServices] = useState([])
  const [cats, setCats] = useState([])
  const [parcerias, setParcerias] = useState({}) // professional_id -> linha de parcerias_da_equipe
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [gaveta, setGaveta] = useState(null) // null | 'nova' | profissional
  const [coletar, setColetar] = useState(false)
  // 4.10 (265): passou das agendas liberadas? Antes de abrir a ficha, a tela mostra a conta (AgendasExtras)
  const [extras, setExtras] = useState(false)
  const [folga, setFolga] = useState(0)   // agendas liberadas nesta visita (o perfil só recarrega depois)
  const liberadas = Math.max(PLANOS.pro.inclusas, Number(salao?.equipe_prevista ?? 0)) + folga
  const comAgenda = (equipe ?? []).filter((p) => p.active ?? !['inativa', 'rascunho'].includes(p.situacao)).length
  const autonoma = salao?.tipo === 'autonoma'
  const noTeste = acesso?.fase === 'teste'
  // 4.34: a conta fica à vista. Até 3 agendas o valor é o mesmo; cada uma depois soma na mensalidade.
  const hoje = precoPara(Math.max(1, comAgenda))
  const comMaisUma = precoPara(comAgenda + 1)
  const sobeComMaisUma = !autonoma && comMaisUma.total > precoPara(Math.max(1, comAgenda)).total
  // antes de abrir uma agenda que muda o valor, a tela diz de quanto para quanto (no teste grátis também)
  async function avisarValor(nome) {
    if (!sobeComMaisUma) return true
    return Boolean(await confirmar({
      titulo: nome ? `Reativar ${nome} muda a mensalidade` : 'Mais uma agenda muda a mensalidade',
      texto: `Hoje são ${comAgenda} ${comAgenda === 1 ? 'agenda' : 'agendas'} por ${reais(hoje.total)} por mês. Com ${comAgenda + 1}, passa para ${reais(comMaisUma.total)} por mês${comMaisUma.plano !== hoje.plano ? ` (plano ${comMaisUma.nome})` : ''}.${noTeste ? ' No teste grátis você não paga nada agora: esse é o valor quando o plano começar.' : ''}`,
      ok: 'Entendi, continuar', cancelar: 'Voltar',
    }))
  }
  async function adicionar() {
    if (!autonoma && comAgenda >= liberadas) { setExtras(true); return }
    if (!(await avisarValor())) return
    setGaveta('nova')
  }
  // a dona que atende liga e desliga a própria agenda aqui (antes só dava no cadastro inicial)
  async function donaAtender(p, atende) {
    setError(''); setInfo('')
    if (atende) { if (!(await avisarValor(primeiroNome(p.name)))) return }
    else {
      const ok = await confirmar({ titulo: 'Parar de atender?', texto: 'Sua agenda deixa de aparecer para as clientes marcarem e para de contar no plano. O histórico fica guardado e você continua administrando o salão. Dá para voltar a atender quando quiser, por este mesmo botão.', ok: 'Parar de atender', cancelar: 'Continuar atendendo', perigo: true })
      if (!ok) return
    }
    const { error } = await supabase.rpc('dona_atender', { salao: salao.id, atende })
    if (error) { setError(error.message); return }
    setInfo(atende ? 'Sua agenda voltou a aparecer para as clientes.' : 'Sua agenda foi desligada. Você continua como administradora.')
    await fetchTudo(); recarregarPerfil?.()
  }
  const linkEquipe = urlDoAmbiente('pro', `/equipe/${salao?.codigo_equipe ?? ''}`)

  const fetchTudo = useCallback(async () => {
    if (!salao?.id) return
    const [eq, servRes, catRes, parcRes] = await Promise.all([
      supabase.rpc('equipe_da_casa', { salao: salao.id }),
      supabase.from('services').select('id, name, price, duration_minutes, categoria_id').eq('salon_id', salao.id).eq('active', true).order('name'),
      supabase.from('categorias_de_servico').select('id, salon_id, nome').or(`salon_id.eq.${salao.id},salon_id.is.null`),
      PARCERIA_LIGADA ? supabase.rpc('parcerias_da_equipe', { salao: salao.id }) : Promise.resolve({ data: [] }),
    ])
    if (eq.error) setError('Erro ao carregar a equipe: ' + eq.error.message)
    else { setEquipe(Array.isArray(eq.data) ? eq.data : []); setError('') }
    setServices(servRes.data ?? []); setCats(catRes.data ?? [])
    setParcerias(Object.fromEntries((parcRes.data ?? []).map((l) => [l.professional_id, l])))
  }, [salao?.id])
  useEffect(() => { fetchTudo() }, [fetchTudo])

  async function acao(qual, p) {
    setError(''); setInfo('')
    if (qual === 'reativar' && !(await avisarValor(primeiroNome(p.name)))) return
    if (qual === 'remover') {
      const ok = await confirmar({ titulo: `Remover ${p.name} do salão?`, texto: 'Ela perde o acesso à agenda deste salão. O histórico de atendimentos fica guardado.', ok: 'Remover', perigo: true })
      if (!ok) return
    }
    const { error } = await supabase.rpc('equipe_situacao', { prof: p.id, acao: qual })
    if (error) setError(error.message)
    else fetchTudo()
  }
  // 4.54 (migração 280): ao tirar uma profissional, o salão escolhe: só desativar (tudo fica guardado) ou desativar e
  // excluir o perfil (página, link, avaliações e dados dela vão embora; os atendimentos já feitos ficam no histórico)
  const [saindo, setSaindo] = useState(null)   // { p, previa }
  async function pedirSaida(p) {
    setError(''); setInfo(''); setSaindo({ p, previa: null })
    const { data, error } = await supabase.rpc('equipe_excluir_previa', { prof: p.id })
    setSaindo((x) => (x && x.p.id === p.id ? { ...x, previa: error ? { falta: true } : (data ?? {}) } : x))
  }
  // 4.55 (migração 281): o que ela ainda tem marcado: cancela tudo de uma vez (as clientes são avisadas) ou vai remarcar
  const [cancelando, setCancelando] = useState(false)
  async function cancelarOsDela() {
    const { p, previa } = saindo, n = Number(previa?.futuros ?? 0)
    const ok = await confirmar({ titulo: `Cancelar ${n === 1 ? 'o horário' : `os ${n} horários`} de ${primeiroNome(p.name)}?`, texto: 'Cada cliente é avisada do cancelamento, e o sinal pago volta pelas regras do salão. Não dá para desfazer.', ok: n === 1 ? 'Cancelar o horário' : `Cancelar os ${n}`, perigo: true })
    if (!ok) return
    setCancelando(true)
    const { data, error } = await supabase.rpc('equipe_cancelar_futuros', { prof: p.id })
    setCancelando(false)
    if (error) { setError(/schema cache|could not find the function/i.test(error.message ?? '') ? 'Para cancelar tudo de uma vez, o banco precisa da atualização 281 (opção B do .bat).' : error.message); setSaindo(null); return }
    setInfo(`${data?.cancelados ?? n} ${Number(data?.cancelados ?? n) === 1 ? 'horário cancelado' : 'horários cancelados'}. As clientes foram avisadas.`)
    pedirSaida(p)
  }
  function irRemarcar() {
    const p = saindo.p
    try { localStorage.setItem('mimo-agenda-prof', p.id) } catch { /* sem armazenamento */ }
    setSaindo(null); navigate(`/admin/agenda?prof=${p.id}`)
  }
  async function soDesativar() { const p = saindo.p; setSaindo(null); await acao('desativar', p) }
  async function excluirPerfil() {
    const { p } = saindo
    const ok = await confirmar({ titulo: `Excluir o perfil de ${primeiroNome(p.name)} de vez?`, texto: 'Não dá para desfazer. A página, o link, as avaliações e os dados dela são apagados agora.', ok: 'Excluir perfil', perigo: true })
    if (!ok) return
    const { error } = await supabase.rpc('equipe_excluir', { prof: p.id })
    if (error) { setError(error.message); setSaindo(null); return }
    setSaindo(null); setInfo(`O perfil de ${p.name} foi excluído.`); fetchTudo(); recarregarPerfil?.()
  }
  async function copiarLink(p) {
    const url = linkDaProfissional(p, salao)
    try { await navigator.clipboard.writeText(url); setInfo(`Link de ${p.name} copiado: ${url}`) } catch { setInfo(`Link de ${p.name}: ${url}`) }
  }
  async function enviado(p) { try { await supabase.rpc('equipe_acesso_enviado', { prof: p.id }) } catch { /* segue */ } fetchTudo() }
  // manda o acesso por e-mail (129); sem e-mail, abre a gaveta pra cadastrar
  async function enviarPorEmail(p) {
    setError(''); setInfo('')
    if (!p.email) { setInfo(`Cadastre o e-mail de ${primeiroNome(p.name)} pra mandar o acesso.`); setGaveta(p); return }
    try {
      const r = await enviarAcesso(supabase, p)
      setInfo(`Acesso enviado para o e-mail ${r.email}.`)
      fetchTudo()
    } catch (e) { setError(e.message) }
  }
  // 4.38: o acesso pelo WhatsApp da MIMO, direto para o número dela
  async function enviarPorWhats(p) {
    setError(''); setInfo('')
    if (!p.email) { setInfo(`Cadastre o e-mail de ${primeiroNome(p.name)}: é com ele que ela entra.`); setGaveta(p); return }
    try { const r = await enviarAcessoWhats(p); setInfo(`Acesso de ${primeiroNome(p.name)} enviado para o WhatsApp ${r.telefone || p.phone}, pelo número da MIMO.`); fetchTudo() } catch (e) { setError(e.message) }
  }
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
            {pendentes.length > 0 ? ` · ${pendentes.length} na agenda sem ativar o acesso` : ''}
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {info && <div className="alert alert-info">{info}</div>}
      {rascunhos.length > 0 && <div className="alert alert-info">{rascunhos.length === 1 ? `${rascunhos[0].name} mandou nome e WhatsApp pelo link da equipe.` : `${rascunhos.length} profissionais mandaram os dados pelo link da equipe.`} Configure para liberar o acesso.</div>}

      {equipe !== null && lista.length > 0 && (
        <div className="card eq-plano">
          {!autonoma && (
            <div className="eq-plano-conta">
              <span className="eq-plano-ico"><UsersRound size={18} /></span>
              <div>
                <strong>{comAgenda} {comAgenda === 1 ? 'agenda ativa' : 'agendas ativas'} · {reais(hoje.total)} por mês</strong>
                <p>
                  {comAgenda < PLANOS.pro.inclusas
                    ? `O plano inclui ${PLANOS.pro.inclusas} agendas: ainda ${PLANOS.pro.inclusas - comAgenda === 1 ? 'cabe 1' : `cabem ${PLANOS.pro.inclusas - comAgenda}`} sem mudar o valor. Da 4ª em diante, cada uma soma ${reais(PLANOS.pro.extra)} por mês.`
                    : `O plano inclui ${PLANOS.pro.inclusas} agendas. A próxima leva a mensalidade para ${reais(comMaisUma.total)}${comMaisUma.plano !== hoje.plano ? ` (plano ${comMaisUma.nome})` : ''}.`}
                  {noTeste ? ' No teste grátis você não paga nada agora.' : ''}
                </p>
              </div>
            </div>
          )}
          <button type="button" className="btn btn-primary eq-plano-add" onClick={adicionar}><Plus size={17} /> Adicionar profissional</button>
        </div>
      )}

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
          <button type="button" className="btn btn-primary" onClick={adicionar}><Plus size={16} /> Adicionar profissional</button>
        </div>
      ) : (
        <div className="cliente-list">
          {lista.map((p) => {
            const sit = situacaoDe(p)
            const pendente = p.situacao === 'configurada' && !p.user_id
            return (
              <div key={p.id} className={'card prof-row' + (p.situacao === 'inativa' ? ' inactive' : '')}>
                <Avatar nome={p.name} foto={p.photo_url} />
                <div className="cliente-info">
                  <span className="cliente-nome"><span className="nome-txt">{p.name}</span></span>
                  <span className="muted cliente-meta">
                    {p.especialidade || (PARCERIA_LIGADA ? vinculoPor(p.vinculo)?.nome : null) || 'Profissional'} · {p.situacao === 'rascunho' ? 'só nome e WhatsApp' : `${(p.servicos ?? []).length} serviço${(p.servicos ?? []).length === 1 ? '' : 's'} · ${resumoDias(p.horarios)}`}
                  </span>
                  <span className="prof-selos">
                    {p.dona && <em className="eq-papel">Administradora</em>}
                    <span className={'gv-situacao ' + sit.cor}>{sit.rotulo}</span>
                    {parcerias[p.id] && (!p.vinculo || p.vinculo === 'parceira') && <span className={'parceria-selo ' + parcerias[p.id].status}>{parcerias[p.id].status === 'sem_contrato' ? 'sem contrato' : `${STATUS[parcerias[p.id].status]?.toLowerCase()}${parcerias[p.id].status === 'assinado' && parcerias[p.id].homologacao !== 'homologado' ? ', sem homologação' : ''}`}</span>}
                  </span>
                  {p.situacao === 'rascunho' && <button type="button" className="btn-mini prof-acao" onClick={() => setGaveta(p)}>Configurar profissional</button>}
                  {p.situacao === 'inativa' && !p.dona && <button type="button" className="btn-mini prof-acao eq-excluir" onClick={() => pedirSaida(p)}><Trash2 size={12} /> Excluir perfil</button>}
                  {pendente && <span className="prof-acoes"><button type="button" className="btn-mini" onClick={() => enviarPorWhats(p)}><MessageCircle size={12} /> {p.acesso_enviado_em ? 'Reenviar por WhatsApp' : 'Enviar acesso por WhatsApp'}</button><button type="button" className="btn-mini" onClick={() => enviarPorEmail(p)}><Mail size={12} /> {p.acesso_enviado_em ? 'Reenviar por e-mail' : 'Enviar por e-mail'}</button><button type="button" className="btn-mini btn-mini-neutro" onClick={() => copiarAcesso(p)}><Copy size={12} /> Copiar link</button></span>}
                </div>
                {parcerias[p.id] && (!p.vinculo || p.vinculo === 'parceira') && (
                  <Link to={`/admin/equipe/${p.id}/parceria`} className="icon-btn" aria-label={`Contrato de parceria de ${p.name}`} title="Contrato de parceria"><FileSignature size={18} /></Link>
                )}
                <button className="icon-btn" onClick={() => copiarLink(p)} aria-label={`Copiar link de ${p.name}`} title="Copiar link da agenda dela"><LinkIcon /></button>
                <label className="switch" title={p.dona ? (p.situacao === 'inativa' ? 'Voltar a atender' : 'Parar de atender') : (p.situacao === 'inativa' ? 'Reativar' : 'Desativar')}>
                  <input type="checkbox" checked={p.situacao !== 'inativa'} aria-label={p.dona ? 'Você atende' : `${p.name} ativa`}
                    onChange={() => (p.dona ? donaAtender(p, p.situacao === 'inativa') : p.situacao === 'inativa' ? acao('reativar', p) : pedirSaida(p))} />
                  <span></span>
                </label>
                <button className="icon-btn" onClick={() => setGaveta(p)} aria-label={`Configurar ${p.name}`}><ChevronIcon /></button>
              </div>
            )
          })}
        </div>
      )}

      {salao && salao.tipo !== 'autonoma' && <AcessosDoPainel salao={salao} />}

      {salao?.codigo_equipe && (
        <div className="card eq-coletar" style={{ marginTop: '0.8rem' }}>
          <div>
            <strong><Link2 size={14} /> Coletar dados da equipe por link</strong>
            <p>Compartilhe este link para a profissional informar nome e WhatsApp. Você conclui a configuração dela antes de liberar o acesso.</p>
            {coletar ? <div className="ob-link"><input readOnly value={linkEquipe} onFocus={(e) => e.target.select()} /><button type="button" className="btn-mini" onClick={() => { navigator.clipboard?.writeText(linkEquipe); setInfo('Link da equipe copiado.') }}><Copy size={12} /> Copiar</button></div> : <button type="button" className="btn-mini btn-mini-neutro" onClick={() => setColetar(true)}>Mostrar link</button>}
          </div>
        </div>
      )}

      {saindo && (() => {
        const { p, previa } = saindo, nome = primeiroNome(p.name), inativa = p.situacao === 'inativa'
        const n = (v) => Number(v ?? 0), trava = n(previa?.futuros) > 0
        return (
          <div className="modal-fundo" role="presentation" onClick={() => setSaindo(null)}>
            <div className="modal-caixa eq-saida" role="dialog" aria-modal="true" aria-labelledby="eq-saida-titulo" onClick={(e) => e.stopPropagation()}>
              <h3 id="eq-saida-titulo">{inativa ? `Excluir o perfil de ${nome}?` : `${nome} vai sair da agenda?`}</h3>
              {trava && (
                <div className="eq-saida-futuros">
                  <strong>{nome} ainda tem {n(previa.futuros)} {n(previa.futuros) === 1 ? 'horário marcado' : 'horários marcados'}</strong>
                  <span>Resolva isso antes: passe para outra profissional ou outro dia, ou cancele tudo de uma vez.</span>
                  <div>
                    <button type="button" className="btn btn-outline btn-sm" onClick={irRemarcar}><CalendarClock size={15} /> Remarcar na Agenda</button>
                    <button type="button" className="btn btn-outline btn-sm eq-saida-cancelar" onClick={cancelarOsDela} disabled={cancelando}>{cancelando ? 'Cancelando…' : n(previa.futuros) === 1 ? 'Cancelar o horário e avisar a cliente' : `Cancelar os ${n(previa.futuros)} e avisar as clientes`}</button>
                  </div>
                </div>
              )}
              {!inativa && (
                <button type="button" className="eq-saida-op" onClick={soDesativar}>
                  <strong>Apenas desativar</strong>
                  <span>A agenda dela sai do ar e ela perde o acesso. A ficha, a página, as avaliações e o histórico ficam guardados, e dá para reativar depois.{trava ? ' Os horários marcados continuam na agenda até você remarcar ou cancelar.' : ''}</span>
                </button>
              )}
              {previa === null ? <p className="muted">Conferindo o que ela tem…</p> : previa.falta ? (
                <p className="muted eq-saida-nota">Para excluir o perfil, o banco precisa da atualização 280 (opção B do .bat).</p>
              ) : (
                <button type="button" className="eq-saida-op perigo" onClick={excluirPerfil} disabled={trava}>
                  <strong><Trash2 size={15} /> {inativa ? 'Excluir o perfil' : 'Desativar e excluir o perfil'}</strong>
                  <span>Apaga de vez: a página e o link dela, a foto, a bio e o contato, os serviços e horários dela{n(previa.avaliacoes) > 0 ? `, as ${n(previa.avaliacoes)} ${n(previa.avaliacoes) === 1 ? 'avaliação que ela recebeu' : 'avaliações que ela recebeu'}` : ' e as avaliações'}{previa.tem_conta ? ', e o acesso dela a este salão (a conta dela na MIMO continua, como cliente)' : ''}. Não dá para desfazer.</span>
                  {n(previa.atendimentos) > 0 && <span className="eq-saida-fica">Fica guardado: {n(previa.atendimentos) === 1 ? 'o atendimento que ela já fez' : `os ${n(previa.atendimentos)} atendimentos que ela já fez`} e as comandas, porque são o histórico e o financeiro do salão.</span>}
                  {trava && <span className="eq-saida-trava">Primeiro remarque ou cancele {n(previa.futuros) === 1 ? 'o horário marcado' : `os ${n(previa.futuros)} horários marcados`}, aqui em cima.</span>}
                </button>
              )}
              <div className="modal-acoes"><button type="button" className="btn btn-ghost" onClick={() => setSaindo(null)}>Voltar</button></div>
            </div>
          </div>
        )
      })()}

      {gaveta && salao && <ProfissionalDrawer salao={salao} profissional={gaveta === 'nova' ? null : gaveta} servicos={services} cats={cats} onFechar={() => { setGaveta(null); fetchTudo() }} onSalvo={() => fetchTudo()} />}
      {extras && <AgendasExtras salaoId={salao.id} onFechar={() => setExtras(false)}
        onLiberadas={(n) => { setFolga((x) => x + n); setExtras(false); recarregarPerfil?.(); setGaveta('nova') }} />}
    </AdminShell>
  )
}
