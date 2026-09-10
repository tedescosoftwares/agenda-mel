import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho, Kpi, Painel, Pilula, Vazio, Iniciais } from '../../components/plataforma/Pecas'
import { supabase } from '../../lib/supabase'
import { useDialogo } from '../../context/DialogoContext'
import { PredioIcon, UsersIcon, TeamIcon, CalendarIcon, SearchIcon, PulsoIcon, SetaIcon } from '../../components/icons'
import { User, MapPin, Pencil, Check as CheckIcon } from 'lucide-react'

// Salões e autônomas: a lista de unidades com tamanho e ações, o
// checklist de implantação de quem ainda não começou, e o ranking do
// mês. "Implantação" é um salão sem atendimento concluído.
export default function Saloes() {
  const navigate = useNavigate()
  const [q, setQ] = useSearchParams()
  const { confirmar } = useDialogo()
  const [lista, setLista] = useState(null)
  const [busca, setBusca] = useState('')
  const [tipo, setTipo] = useState('todos')
  const [soAtivos, setSoAtivos] = useState(true)
  const [erro, setErro] = useState('')
  const [novo, setNovo] = useState(q.get('novo') === '1' ? { nome: '', cidade: '', tipo: 'salao', email: '' } : null)
  const [salvando, setSalvando] = useState(false)

  const carregar = () => supabase.rpc('plataforma_saloes').then(({ data, error }) => { if (error) setErro(error.message); setLista(data ?? []) })
  useEffect(() => { carregar() }, [])

  const t = busca.trim().toLowerCase()
  const vis = useMemo(() => (lista ?? []).filter((s) => (!soAtivos || s.ativo) && (tipo === 'todos' || s.tipo === tipo) && (!t || s.nome.toLowerCase().includes(t) || (s.dona || '').toLowerCase().includes(t) || (s.cidade || '').toLowerCase().includes(t) || (s.codigo || '').toLowerCase() === t)), [lista, t, tipo, soAtivos])
  const ativos = (lista ?? []).filter((s) => s.ativo)
  const implantacao = ativos.filter((s) => s.atendimentos === 0)
  const top = [...ativos].sort((a, b) => b.atendimentos_mes - a.atendimentos_mes).slice(0, 3)
  const maxMes = Math.max(1, ...top.map((s) => s.atendimentos_mes))

  async function criar() {
    if (!novo.nome.trim()) return
    setSalvando(true); setErro('')
    const { data, error } = await supabase.rpc('plataforma_criar_salao', { nome: novo.nome.trim(), cidade: novo.cidade.trim() || null, tipo: novo.tipo, email_dona: novo.email.trim() || null })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setNovo(null); q.delete('novo'); setQ(q, { replace: true })
    await carregar()
    if (data?.id) navigate(`/plataforma/saloes/${data.id}`)
  }

  async function ativar(s, ligar) {
    const ok = await confirmar({ titulo: ligar ? `Reativar ${s.nome}?` : `Desativar ${s.nome}?`, texto: ligar ? 'Volta a aparecer e a aceitar horários.' : 'Some da vitrine e das agendas das clientes. Nada é apagado.', ok: ligar ? 'Reativar' : 'Desativar', perigo: !ligar })
    if (!ok) return
    const { error } = await supabase.rpc('plataforma_ativar_salao', { salao: s.id, ligar })
    if (error) setErro(error.message); else carregar()
  }

  return (
    <Shell acao={{ rotulo: 'Novo cadastro', onClick: () => setNovo({ nome: '', cidade: '', tipo: 'salao', email: '' }) }}>
      <Cabecalho titulo="Salões e autônomas" sub="Gerencie operações ativas, donos e status de cada unidade." direita={<span />} />
      {erro && <div className="alert alert-error">{erro}</div>}

      <div className="plat-duas-colunas">
        <div>
          <div className="plat-filtros">
            <div className="plat-busca-local"><SearchIcon /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, dono, cidade ou código…" /></div>
            <div className="plat-chips">
              {[['todos', 'Todos'], ['salao', 'Salões'], ['autonoma', 'Autônomas']].map(([k, r]) => <button key={k} className={'plat-chip' + (tipo === k ? ' ativo' : '')} onClick={() => setTipo(k)}>{r}</button>)}
              <button className={'plat-chip' + (soAtivos ? ' ativo' : '')} onClick={() => setSoAtivos((v) => !v)}>● {soAtivos ? 'Ativos' : 'Todos os status'}</button>
            </div>
          </div>

          <div className="plat-grade-4 compacta">
            <Kpi Icon={PredioIcon} cor="rosa" n={ativos.filter((s) => s.tipo === 'salao').length} rotulo="salões" sub={`${(lista ?? []).filter((s) => s.tipo === 'salao' && !s.ativo).length} desativados`} />
            <Kpi Icon={UsersIcon} cor="roxo" n={ativos.filter((s) => s.tipo === 'autonoma').length} rotulo="autônomas" sub="agendas de uma pessoa" />
            <Kpi Icon={TeamIcon} cor="rosa" n={ativos.reduce((a, s) => a + s.profissionais, 0)} rotulo="profissionais" sub="ativas nas unidades" />
            <Kpi Icon={UsersIcon} cor="roxo" n={ativos.reduce((a, s) => a + s.clientes, 0)} rotulo="clientes" sub="vinculadas" />
          </div>

          <Painel titulo="Unidades cadastradas" sub={`${vis.length} ${vis.length === 1 ? 'no total' : 'no total'}`} direita={<span className="muted plat-ordem">↕ Mais recentes</span>}>
            {!lista ? <Vazio>Carregando…</Vazio> : vis.length === 0 ? <Vazio>Nenhuma unidade com esse filtro.</Vazio> : (
              <ul className="plat-unidades">
                {vis.map((s) => (
                  <li key={s.id} className={s.ativo ? '' : 'apagado'}>
                    <span className={'plat-logo ' + (s.tipo === 'autonoma' ? 'roxo' : 'rosa')}>{s.tipo === 'autonoma' ? <UsersIcon /> : <PredioIcon />}</span>
                    <div className="plat-unidade-info">
                      <div className="plat-unidade-nome"><Link to={`/plataforma/saloes/${s.id}`}><strong>{s.nome}</strong></Link><Pilula>{s.tipo === 'autonoma' ? 'Autônoma' : 'Salão'}</Pilula><Pilula>{!s.ativo ? 'Desativado' : s.atendimentos === 0 ? 'Implantação' : s.tipo === 'autonoma' ? 'Ativa' : 'Ativo'}</Pilula></div>
                      <span className="muted"><User size={13} /> {s.dona || 'sem dona ainda'}</span>
                      <span className="muted"><MapPin size={13} /> {s.cidade || 'sem cidade'}</span>
                      <span className="muted">▦ Código: {s.codigo}</span>
                    </div>
                    <div className="plat-unidade-nums">
                      <span><strong>{s.profissionais}</strong><small>{s.profissionais === 1 ? 'profissional' : 'profissionais'}</small></span>
                      <span><strong>{s.clientes}</strong><small>clientes</small></span>
                      <span><strong>{s.atendimentos_mes}</strong><small>atendimentos no mês</small></span>
                    </div>
                    <div className="plat-unidade-acoes">
                      <Link to={`/plataforma/saloes/${s.id}`} className="btn btn-primary">Ver detalhes <SetaIcon /></Link>
                      <div>
                        <Link to={`/plataforma/saloes/${s.id}`} className="plat-btn-ico" title="Editar"><Pencil size={15} /></Link>
                        <Link to={`/plataforma/saloes/${s.id}?aba=equipe`} className="plat-btn-ico" title="Equipe"><TeamIcon /></Link>
                        <button className="plat-btn-ico" title={s.ativo ? 'Desativar' : 'Reativar'} onClick={() => ativar(s, !s.ativo)}>{s.ativo ? '⏻' : '↺'}</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Painel>
        </div>

        <aside className="plat-lado">
          <Painel Icon={PulsoIcon} titulo="Implantação" sub={`${implantacao.length} em implantação`}>
            {implantacao.length === 0 ? <Vazio>Todas as unidades já atendem.</Vazio> : implantacao.slice(0, 2).map((s) => (
              <div key={s.id} className="plat-implantacao">
                <div className="plat-implantacao-cab"><span className={'plat-logo ' + (s.tipo === 'autonoma' ? 'roxo' : 'rosa')}><PredioIcon /></span><div><strong>{s.nome}</strong><span className="muted">{s.dona || 'sem dona'}{s.cidade ? ` · ${s.cidade}` : ''}</span></div></div>
                <ul className="plat-checklist">
                  <Check ok titulo="Cadastro da unidade" />
                  <Check ok={Boolean(s.dona)} titulo="Dados da dona" />
                  <Check ok={s.servicos > 0 && s.tem_horario} titulo="Configurações iniciais" />
                  <Check ok={s.profissionais > 0} titulo="Convite de profissionais" />
                  <Check ok={s.atendimentos > 0} titulo="Primeiros atendimentos" />
                </ul>
                <Link to={`/plataforma/saloes/${s.id}`} className="btn btn-ghost btn-block plat-btn-suave">Ver detalhes da implantação <SetaIcon /></Link>
              </div>
            ))}
          </Painel>
          <Painel Icon={CalendarIcon} titulo="Top unidades por movimento" sub="Por atendimentos no mês">
            {top.length === 0 ? <Vazio>Sem atendimentos neste mês.</Vazio> : (
              <ul className="plat-ranking">
                {top.map((s, i) => (
                  <li key={s.id}><span className={'plat-rank' + (i === 0 ? ' primeiro' : '')}>{i + 1}</span><div><Link to={`/plataforma/saloes/${s.id}`}><strong>{s.nome}</strong></Link><i className="plat-barra"><b style={{ width: `${Math.round((s.atendimentos_mes / maxMes) * 100)}%` }} /></i></div><em><strong>{s.atendimentos_mes}</strong><small className="muted">atendimentos</small></em></li>
                ))}
              </ul>
            )}
          </Painel>
        </aside>
      </div>

      {novo && (
        <div className="modal-fundo plat-modal-fundo" onClick={() => setNovo(null)}>
          <div className="modal-caixa plat-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Novo cadastro</h3>
            <p className="muted">Cria a unidade já com código. Se a dona já tem conta no MIMO, coloca o e-mail dela e ela vira admin na hora; senão, deixa em branco e troca a dona depois.</p>
            <div className="form">
              <div className="plat-chips">
                <button className={'plat-chip' + (novo.tipo === 'salao' ? ' ativo' : '')} onClick={() => setNovo({ ...novo, tipo: 'salao' })}>Salão</button>
                <button className={'plat-chip' + (novo.tipo === 'autonoma' ? ' ativo' : '')} onClick={() => setNovo({ ...novo, tipo: 'autonoma' })}>Autônoma</button>
              </div>
              <label>{novo.tipo === 'salao' ? 'Nome do salão' : 'Nome da agenda (o nome dela)'}<input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} /></label>
              <label>Cidade<input value={novo.cidade} onChange={(e) => setNovo({ ...novo, cidade: e.target.value })} /></label>
              <label>E-mail da dona (opcional)<input type="email" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} placeholder="ela@email.com" /></label>
            </div>
            <div className="modal-acoes">
              <button className="btn btn-ghost" onClick={() => setNovo(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={criar} disabled={salvando || !novo.nome.trim()}>{salvando ? 'Criando…' : 'Criar'}</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}

function Check({ ok, titulo }) {
  return <li className={ok ? 'ok' : ''}><span className="plat-check">{ok ? <CheckIcon size={12} /> : ''}</span><span>{titulo}</span><Pilula tom={ok ? 'menta' : 'cinza'}>{ok ? 'Concluído' : 'Pendente'}</Pilula></li>
}

// o salão de perto
export function Salao() {
  const { id } = useParams()
  const [q] = useSearchParams()
  const { confirmar } = useDialogo()
  const [d, setD] = useState(null)
  const [erro, setErro] = useState('')
  const [aba, setAba] = useState(q.get('aba') || 'equipe')
  const [novaDona, setNovaDona] = useState('')

  const carregar = () => supabase.rpc('plataforma_salao', { salao: id }).then(({ data, error }) => { if (error) setErro(error.message); setD(data) })
  useEffect(() => { carregar() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function ativar(ligar) {
    const ok = await confirmar({ titulo: ligar ? 'Reativar este salão?' : 'Desativar este salão?', texto: ligar ? 'Volta a aparecer e a aceitar horários.' : 'Some da vitrine e das agendas das clientes. Nada é apagado.', ok: ligar ? 'Reativar' : 'Desativar', perigo: !ligar })
    if (!ok) return
    const { error } = await supabase.rpc('plataforma_ativar_salao', { salao: id, ligar })
    if (error) setErro(error.message); else carregar()
  }
  async function trocarDona() {
    if (!novaDona.trim()) return
    if (!(await confirmar({ titulo: 'Trocar a dona?', texto: `${novaDona} passa a administrar esta unidade.`, ok: 'Trocar' }))) return
    const { error } = await supabase.rpc('plataforma_trocar_dona', { salao: id, email_: novaDona.trim() })
    if (error) setErro(error.message); else { setNovaDona(''); carregar() }
  }

  const s = d?.salao ?? {}
  return (
    <Shell>
      <Cabecalho titulo={s.name ?? 'Salão'} sub={d ? `${s.tipo === 'autonoma' ? 'Agenda autônoma' : 'Salão'} · código ${s.codigo}${s.city ? ` · ${s.city}` : ''}` : ''} direita={<Link to="/plataforma/saloes" className="plat-link">← Todas as unidades</Link>} />
      {erro && <div className="alert alert-error">{erro}</div>}
      {!d ? <Vazio>Carregando…</Vazio> : (
        <div className="plat-duas-colunas">
          <div>
            <div className="plat-grade-4 compacta">
              <Kpi Icon={TeamIcon} cor="rosa" n={(d.equipe ?? []).filter((p) => p.ativa).length} rotulo="profissionais ativas" sub={`${(d.equipe ?? []).length} no total`} />
              <Kpi Icon={UsersIcon} cor="roxo" n={(d.clientes ?? []).length} rotulo="clientes vinculadas" sub="com vínculo aberto" />
              <Kpi Icon={CalendarIcon} cor="rosa" n={(d.equipe ?? []).reduce((a, p) => a + Number(p.atendimentos || 0), 0)} rotulo="atendimentos" sub="concluídos, desde sempre" />
              <Kpi Icon={PulsoIcon} cor={s.active ? 'menta' : 'carmim'} n={s.active ? 'Ativo' : 'Off'} rotulo="status" sub={s.active ? 'aparece na vitrine' : 'desativado pela plataforma'} />
            </div>
            <div className="abas plat-abas">
              {[['equipe', `Equipe (${d.equipe?.length ?? 0})`], ['clientes', `Clientes (${d.clientes?.length ?? 0})`], ['ultimos', 'Últimos horários']].map(([k, r]) => <button key={k} className={aba === k ? 'aba active' : 'aba'} onClick={() => setAba(k)}>{r}</button>)}
            </div>
            <Painel titulo={aba === 'equipe' ? 'Equipe' : aba === 'clientes' ? 'Clientes vinculadas' : 'Últimos 30 horários'}>
              {aba === 'equipe' && (
                <table className="plat-tabela"><thead><tr><th>Profissional</th><th>Código</th><th>Trouxe</th><th>Atendimentos</th><th>Status</th></tr></thead><tbody>
                  {(d.equipe ?? []).map((p) => <tr key={p.id}><td><div className="plat-pessoa"><Iniciais nome={p.nome} /><div><strong>{p.nome}</strong><small className="muted">{p.telefone || 'sem telefone'}{p.tem_conta ? '' : ' · sem conta'}</small></div></div></td><td className="mono">{p.codigo}</td><td>{p.trouxe}</td><td>{p.atendimentos}</td><td><Pilula>{p.ativa ? 'Ativa' : 'Saiu'}</Pilula></td></tr>)}
                  {(d.equipe ?? []).length === 0 && <tr><td colSpan={5}><Vazio>Nenhuma profissional ainda.</Vazio></td></tr>}
                </tbody></table>
              )}
              {aba === 'clientes' && (
                <table className="plat-tabela"><thead><tr><th>Cliente</th><th>Contato</th><th>Entrou</th><th>Canal</th><th>Trazida por</th></tr></thead><tbody>
                  {(d.clientes ?? []).map((c, i) => <tr key={i}><td><div className="plat-pessoa"><Iniciais nome={c.nome} /><strong>{c.nome || 'sem nome'}</strong></div></td><td className="muted">{c.telefone || '—'}</td><td className="muted">{new Date(c.entrou_em).toLocaleDateString('pt-BR')}</td><td><Pilula tom="roxo">{c.como}</Pilula></td><td>{c.trazida_por || <span className="muted">o salão</span>}</td></tr>)}
                  {(d.clientes ?? []).length === 0 && <tr><td colSpan={5}><Vazio>Nenhuma cliente vinculada ainda.</Vazio></td></tr>}
                </tbody></table>
              )}
              {aba === 'ultimos' && (
                <table className="plat-tabela"><thead><tr><th>Quando</th><th>Serviço</th><th>Cliente</th><th>Profissional</th><th>Status</th></tr></thead><tbody>
                  {(d.ultimos ?? []).map((a, i) => <tr key={i}><td className="muted">{new Date(a.data + 'T12:00').toLocaleDateString('pt-BR')} {a.hora}</td><td>{a.servico || 'Atendimento'}</td><td>{a.cliente || 'sem nome'}</td><td>{a.profissional}</td><td><Pilula>{a.status}</Pilula></td></tr>)}
                  {(d.ultimos ?? []).length === 0 && <tr><td colSpan={5}><Vazio>Nenhum horário ainda.</Vazio></td></tr>}
                </tbody></table>
              )}
            </Painel>
          </div>
          <aside className="plat-lado">
            <Painel Icon={UsersIcon} titulo="Dona">
              <div className="plat-pessoa grande"><Iniciais nome={d.dona?.nome || '?'} /><div><strong>{d.dona?.nome || 'sem dona ainda'}</strong><small className="muted">{d.dona?.email || ''}{d.dona?.telefone ? ` · ${d.dona.telefone}` : ''}</small></div></div>
              <div className="form" style={{ marginTop: '0.8rem' }}>
                <label>Trocar a dona (e-mail da nova)<input type="email" value={novaDona} onChange={(e) => setNovaDona(e.target.value)} placeholder="nova@email.com" /></label>
                <button className="btn btn-ghost" onClick={trocarDona} disabled={!novaDona.trim()}>Trocar dona</button>
              </div>
            </Painel>
            <Painel Icon={PredioIcon} titulo="Unidade">
              <div className="dado-linha"><span className="muted">Código</span><strong className="mono">{s.codigo}</strong></div>
              <div className="dado-linha"><span className="muted">Vitrine</span><strong>{d.equipe?.[0]?.slug ? <a className="plat-link" href={`/p/${d.equipe[0].slug}`} target="_blank" rel="noreferrer">/p/{d.equipe[0].slug}</a> : '—'}</strong></div>
              <div className="dado-linha"><span className="muted">Desde</span><strong>{s.created_at ? new Date(s.created_at).toLocaleDateString('pt-BR') : '—'}</strong></div>
              {s.active
                ? <button className="btn btn-ghost btn-block btn-perigo-borda" style={{ marginTop: '0.8rem' }} onClick={() => ativar(false)}>Desativar unidade</button>
                : <button className="btn btn-primary btn-block" style={{ marginTop: '0.8rem' }} onClick={() => ativar(true)}>Reativar unidade</button>}
            </Painel>
          </aside>
        </div>
      )}
    </Shell>
  )
}
