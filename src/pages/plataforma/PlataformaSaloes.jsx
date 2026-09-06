import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PlataformaShell from '../../components/PlataformaShell'
import { supabase } from '../../lib/supabase'
import { useDialogo } from '../../context/DialogoContext'
import { SearchIcon } from '../../components/icons'

// Todos os salões e autônomas, com o tamanho de cada um. Tocando, o
// salão de perto: dona, equipe, clientes e os últimos horários, mais as
// duas ações de suporte (desativar, trocar a dona).
export default function PlataformaSaloes() {
  const [lista, setLista] = useState(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    supabase.rpc('plataforma_saloes').then(({ data, error }) => { if (error) setErro(error.message); setLista(data ?? []) })
  }, [])

  const t = busca.trim().toLowerCase()
  const filtrados = useMemo(() => (lista ?? []).filter((s) => !t || s.nome.toLowerCase().includes(t) || (s.dona || '').toLowerCase().includes(t) || (s.cidade || '').toLowerCase().includes(t)), [lista, t])

  return (
    <PlataformaShell>
      <div className="page-head"><div><h2>Salões e autônomas</h2><p className="muted">{lista ? `${lista.length} no total` : ''}</p></div></div>
      <div className="search-box"><SearchIcon /><input type="search" placeholder="Nome, dona ou cidade…" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
      {erro && <div className="alert alert-error">{erro}</div>}
      {!lista ? <p className="muted">Carregando…</p> : (
        <div className="cliente-list">
          {filtrados.map((s) => (
            <Link key={s.id} to={`/plataforma/saloes/${s.id}`} className={'card prof-row' + (s.ativo ? '' : ' apagado')}>
              <span className="ajuste-icone">{s.tipo === 'autonoma' ? '💅' : '🏠'}</span>
              <span className="cliente-info">
                <span className="cliente-nome"><span className="nome-txt">{s.nome}</span>{!s.ativo && <span className="badge badge-faltou">desativado</span>}</span>
                <span className="muted cliente-meta">{s.tipo === 'autonoma' ? 'autônoma' : `${s.profissionais} profissionais`} · {s.clientes} clientes · {s.atendimentos_mes} no mês{s.cidade ? ` · ${s.cidade}` : ''}</span>
                <span className="muted cliente-meta">{s.dona || 'sem dona'} · código {s.codigo} · desde {new Date(s.desde + 'T12:00').toLocaleDateString('pt-BR')}</span>
              </span>
            </Link>
          ))}
          {filtrados.length === 0 && <div className="card empty-state"><p>Nenhum salão com esse nome.</p></div>}
        </div>
      )}
    </PlataformaShell>
  )
}

export function PlataformaSalao() {
  const { id } = useParams()
  const { confirmar } = useDialogo()
  const [d, setD] = useState(null)
  const [erro, setErro] = useState('')
  const [aba, setAba] = useState('equipe')
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
    const ok = await confirmar({ titulo: 'Trocar a dona?', texto: `${novaDona} passa a administrar este salão.`, ok: 'Trocar' })
    if (!ok) return
    const { error } = await supabase.rpc('plataforma_trocar_dona', { salao: id, email_: novaDona.trim() })
    if (error) setErro(error.message); else { setNovaDona(''); carregar() }
  }

  if (!d) return <PlataformaShell voltar="/plataforma/saloes" titulo="Salão"><p className="muted">{erro || 'Carregando…'}</p></PlataformaShell>
  const s = d.salao ?? {}
  return (
    <PlataformaShell voltar="/plataforma/saloes" titulo={s.name}>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="card">
        <div className="dado-linha"><span className="muted">Tipo</span><strong>{s.tipo === 'autonoma' ? 'autônoma' : 'salão'}{s.active ? '' : ' · desativado'}</strong></div>
        <div className="dado-linha"><span className="muted">Dona</span><strong>{d.dona?.nome || '—'}<br /><small className="muted">{d.dona?.email}{d.dona?.telefone ? ` · ${d.dona.telefone}` : ''}</small></strong></div>
        <div className="dado-linha"><span className="muted">Código</span><strong>{s.codigo}</strong></div>
        <div className="dado-linha"><span className="muted">Vitrine</span><strong><a className="link-ver" href={`/p/${d.equipe?.[0]?.slug ?? ''}`} target="_blank" rel="noreferrer">/p/{d.equipe?.[0]?.slug ?? '—'}</a></strong></div>
        <div className="dado-linha"><span className="muted">Cidade</span><strong>{s.city || '—'}</strong></div>
      </div>

      <div className="abas">
        {[['equipe', `Equipe (${d.equipe?.length ?? 0})`], ['clientes', `Clientes (${d.clientes?.length ?? 0})`], ['ultimos', 'Últimos']].map(([k, r]) => (
          <button key={k} className={aba === k ? 'aba active' : 'aba'} onClick={() => setAba(k)}>{r}</button>
        ))}
      </div>

      {aba === 'equipe' && (
        <div className="cliente-list">
          {(d.equipe ?? []).map((p) => (
            <div key={p.id} className={'card cliente-row' + (p.ativa ? '' : ' apagado')}>
              <div className="cliente-info">
                <span className="cliente-nome"><span className="nome-txt">{p.nome}</span>{!p.ativa && <span className="badge badge-faltou">saiu</span>}{!p.tem_conta && <span className="badge badge-pendente">sem conta</span>}</span>
                <span className="muted cliente-meta">código {p.codigo} · trouxe {p.trouxe} · {p.atendimentos} atendimentos{p.telefone ? ` · ${p.telefone}` : ''}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {aba === 'clientes' && (
        <div className="cliente-list">
          {(d.clientes ?? []).map((c, i) => (
            <div key={i} className="card cliente-row">
              <div className="cliente-info">
                <span className="cliente-nome"><span className="nome-txt">{c.nome || 'Sem nome'}</span></span>
                <span className="muted cliente-meta">{c.telefone || 'sem telefone'} · entrou {new Date(c.entrou_em).toLocaleDateString('pt-BR')} por {c.como}{c.trazida_por ? ` · trazida por ${c.trazida_por.split(' ')[0]}` : ''}</span>
              </div>
            </div>
          ))}
          {(d.clientes ?? []).length === 0 && <div className="card empty-state"><p>Nenhuma cliente vinculada ainda.</p></div>}
        </div>
      )}
      {aba === 'ultimos' && (
        <div className="cliente-list">
          {(d.ultimos ?? []).map((a, i) => (
            <div key={i} className={'card agd-card ' + a.status}>
              <div className="agd-topo"><span className="agd-quando">{new Date(a.data + 'T12:00').toLocaleDateString('pt-BR')} · {a.hora}</span><span className={`badge badge-${a.status}`}>{a.status}</span></div>
              <strong className="agd-servico">{a.servico || 'Atendimento'}</strong>
              <span className="muted agd-meta">{a.cliente || 'sem nome'} com {a.profissional}</span>
            </div>
          ))}
        </div>
      )}

      <h3 className="secao-titulo">Suporte</h3>
      <div className="card form">
        <label>Trocar a dona (e-mail da nova)<input type="email" value={novaDona} onChange={(e) => setNovaDona(e.target.value)} placeholder="nova@email.com" /></label>
        <button className="btn btn-ghost" onClick={trocarDona} disabled={!novaDona.trim()}>Trocar dona</button>
        {s.active
          ? <button className="btn btn-ghost btn-perigo-borda" onClick={() => ativar(false)}>Desativar salão</button>
          : <button className="btn btn-primary" onClick={() => ativar(true)}>Reativar salão</button>}
      </div>
    </PlataformaShell>
  )
}
