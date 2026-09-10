import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho, Kpi, Painel, Pilula, Vazio, Iniciais, haQuanto } from '../../components/plataforma/Pecas'
import { supabase } from '../../lib/supabase'
import { UsersIcon, TeamIcon, LinkIcon, EngrenagemIcon, ConviteIcon, GraficoIcon, SearchIcon } from '../../components/icons'
import { Store, Link2 } from 'lucide-react'

const PAPEL = { cliente: 'cliente', profissional: 'profissional', admin: 'admin', plataforma: 'plataforma' }
const POR_PAGINA = 8

// Pessoas: clientes, profissionais e contas da plataforma numa lista só,
// com busca no banco, filtro por papel, paginação, e ao lado quem chegou
// nos últimos 30 dias, quem está sem vínculo e a distribuição por papel.
export default function Pessoas() {
  const [q] = useSearchParams()
  const [lista, setLista] = useState(null)
  const [busca, setBusca] = useState(q.get('q') || '')
  const [filtro, setFiltro] = useState('todos')
  const [pagina, setPagina] = useState(1)
  const [erro, setErro] = useState('')

  useEffect(() => {
    const t = setTimeout(() => {
      supabase.rpc('plataforma_pessoas', { busca: busca.trim() || null, quantas: 500 })
        .then(({ data, error }) => { if (error) setErro(error.message); setLista(data ?? []); setPagina(1) })
    }, 250)
    return () => clearTimeout(t)
  }, [busca])

  const n = (p) => (lista ?? []).filter(p).length
  const vis = useMemo(() => (lista ?? []).filter((p) =>
    filtro === 'todos' ? true
    : filtro === 'sem_vinculo' ? p.papel === 'cliente' && p.vinculos === 0
    : filtro === 'recentes' ? Date.now() - new Date(p.desde).getTime() < 30 * 86400e3
    : p.papel === filtro), [lista, filtro])
  const paginas = Math.max(1, Math.ceil(vis.length / POR_PAGINA))
  const pag = vis.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  const recentes = (lista ?? []).filter((p) => Date.now() - new Date(p.desde).getTime() < 30 * 86400e3).slice(0, 4)
  const semVinculo = (lista ?? []).filter((p) => p.papel === 'cliente' && p.vinculos === 0).slice(0, 3)
  const total = (lista ?? []).length || 1
  const dist = [['Clientes', 'cliente', 'rosa'], ['Profissionais', 'profissional', 'roxo'], ['Admins', 'admin', 'azul'], ['Plataforma', 'plataforma', 'menta']].map(([r, k, c]) => ({ r, k, c, n: n((p) => p.papel === k) }))

  return (
    <Shell acao={{ rotulo: 'Nova pessoa', onClick: () => window.open('/entrar', '_blank') }}>
      <Cabecalho titulo="Pessoas" sub="Clientes, profissionais e contas da plataforma em uma visão unificada." />
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="plat-duas-colunas">
        <div>
          <div className="plat-grade-5">
            <Kpi Icon={UsersIcon} cor="rosa" n={(lista ?? []).length} rotulo="pessoas" sub="Total na plataforma" />
            <Kpi Icon={UsersIcon} cor="rosa" n={n((p) => p.papel === 'cliente')} rotulo="clientes" sub={`${Math.round((n((p) => p.papel === 'cliente') / total) * 100)}% do total`} />
            <Kpi Icon={TeamIcon} cor="roxo" n={n((p) => p.papel === 'profissional')} rotulo="profissionais" sub={`${Math.round((n((p) => p.papel === 'profissional') / total) * 100)}% do total`} />
            <Kpi Icon={EngrenagemIcon} cor="azul" n={n((p) => p.papel === 'admin')} rotulo="admins" sub="donas de salão" />
            <Kpi Icon={LinkIcon} cor="carmim" n={n((p) => p.papel === 'cliente' && p.vinculos === 0)} rotulo="sem vínculo" sub="clientes fora de agenda" />
          </div>

          <Painel titulo="" className="sem-cabecalho">
            <div className="plat-filtros dentro">
              <div className="plat-busca-local"><SearchIcon /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, e-mail ou telefone…" /></div>
              <div className="plat-chips">
                {[['todos', `Todos ${(lista ?? []).length}`], ['cliente', `Clientes ${n((p) => p.papel === 'cliente')}`], ['profissional', `Profissionais ${n((p) => p.papel === 'profissional')}`], ['admin', `Admins ${n((p) => p.papel === 'admin')}`], ['sem_vinculo', `Sem vínculo ${n((p) => p.papel === 'cliente' && p.vinculos === 0)}`], ['recentes', 'Recentes']].map(([k, r]) => (
                  <button key={k} className={'plat-chip' + (filtro === k ? ' ativo' : '')} onClick={() => { setFiltro(k); setPagina(1) }}>{r}</button>
                ))}
              </div>
            </div>
            <table className="plat-tabela">
              <thead><tr><th>Nome</th><th>Papel</th><th>Contato</th><th>Vínculo principal</th><th>Última atividade</th><th>Status</th></tr></thead>
              <tbody>
                {!lista ? <tr><td colSpan={6}><Vazio>Carregando…</Vazio></td></tr> : pag.length === 0 ? <tr><td colSpan={6}><Vazio>Ninguém com esse filtro.</Vazio></td></tr> : pag.map((p) => (
                  <tr key={p.id}>
                    <td><div className="plat-pessoa"><Iniciais nome={p.nome} /><div><strong>{p.nome || 'Sem nome'}</strong><small className="muted">desde {new Date(p.desde + 'T12:00').toLocaleDateString('pt-BR')}</small></div></div></td>
                    <td><Pilula>{PAPEL[p.papel] ?? p.papel}</Pilula></td>
                    <td><div className="plat-contato"><span>{p.email}</span><small className="muted">{p.telefone || '—'}</small></div></td>
                    <td>{p.saloes ? <span className="plat-vinculo"><Store size={13} /> {p.saloes}</span> : p.papel === 'plataforma' ? <span className="plat-vinculo"><Store size={13} /> Conta da plataforma</span> : p.vinculos > 0 ? <span className="plat-vinculo"><Link2 size={13} /> {p.vinculos} {p.vinculos === 1 ? 'agenda' : 'agendas'}</span> : <span className="muted">—</span>}</td>
                    <td className="muted">{p.ultimo_acesso ? (Date.now() - new Date(p.ultimo_acesso).getTime() < 86400e3 ? <span><i className="plat-online" /> ativo hoje</span> : haQuanto(p.ultimo_acesso)) : 'nunca entrou'}</td>
                    <td><Pilula>{p.papel === 'cliente' && p.vinculos === 0 ? 'Sem vínculo' : p.ultimo_acesso ? 'Ativo' : 'Convite pendente'}</Pilula></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="plat-paginacao">
              <span className="muted">Mostrando {pag.length} de {vis.length} pessoas</span>
              <div>
                <button disabled={pagina === 1} onClick={() => setPagina((p) => p - 1)}>‹</button>
                {Array.from({ length: Math.min(paginas, 5) }, (_, i) => i + 1).map((p) => <button key={p} className={p === pagina ? 'ativo' : ''} onClick={() => setPagina(p)}>{p}</button>)}
                <button disabled={pagina === paginas} onClick={() => setPagina((p) => p + 1)}>›</button>
              </div>
            </div>
          </Painel>
        </div>

        <aside className="plat-lado">
          <Painel Icon={ConviteIcon} titulo="Novos cadastros" sub={`${(lista ?? []).filter((p) => Date.now() - new Date(p.desde).getTime() < 30 * 86400e3).length} pessoas nos últimos 30 dias`} link="/plataforma/pessoas" linkRotulo="Ver todos">
            <ul className="plat-lista-curta">{recentes.map((p) => <li key={p.id}><Iniciais nome={p.nome} /><strong>{p.nome || 'sem nome'}</strong><Pilula>{p.papel === 'cliente' && p.vinculos === 0 ? 'sem vínculo' : PAPEL[p.papel]}</Pilula><small className="muted">{haQuanto(p.desde + 'T12:00:00')}</small></li>)}{recentes.length === 0 && <Vazio>Ninguém novo em 30 dias.</Vazio>}</ul>
          </Painel>
          <Painel Icon={LinkIcon} titulo="Pendências de vínculo" sub={`${n((p) => p.papel === 'cliente' && p.vinculos === 0)} pessoas sem vínculo definido`} link="/plataforma/vinculos" linkRotulo="Ver todas as pendências">
            <ul className="plat-lista-curta">{semVinculo.map((p) => <li key={p.id}><Iniciais nome={p.nome} /><strong>{p.nome || 'sem nome'}</strong><small className="muted">{p.ultimo_acesso ? 'já entrou no app' : 'cadastro recente'}</small><small className="muted">{haQuanto(p.desde + 'T12:00:00')}</small></li>)}{semVinculo.length === 0 && <Vazio>Nenhuma pendência.</Vazio>}</ul>
          </Painel>
          <Painel Icon={GraficoIcon} titulo="Distribuição por perfil">
            <ul className="plat-distribuicao">{dist.map((d) => <li key={d.k}><span>{d.r}</span><strong>{d.n}</strong><i className="plat-barra"><b className={d.c} style={{ width: `${Math.round((d.n / total) * 100)}%` }} /></i><small className="muted">{Math.round((d.n / total) * 100)}%</small></li>)}</ul>
          </Painel>
        </aside>
      </div>
    </Shell>
  )
}
