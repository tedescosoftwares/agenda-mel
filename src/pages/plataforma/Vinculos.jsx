import { useEffect, useMemo, useState } from 'react'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho, Kpi, Painel, Pilula, Vazio, Iniciais, haQuanto } from '../../components/plataforma/Pecas'
import { supabase } from '../../lib/supabase'
import { LinkIcon, UsersIcon, ConviteIcon, ClockIcon, GraficoIcon, QrIcon, MailIcon } from '../../components/icons'

const CANAL = { qr: 'QR', link: 'Link', codigo: 'Código', cadastro: 'Cadastro', vitrine: 'Vitrine', agendamento: 'Agendou', encaixe: 'Encaixe', whatsapp: 'WhatsApp' }

// Convites e vínculos: quem entrou por onde e para qual agenda, os canais
// que mais trazem gente e o funil (contas → com vínculo → sem vínculo).
export default function Vinculos() {
  const [lista, setLista] = useState(null)
  const [funil, setFunil] = useState(null)
  const [k, setK] = useState(null)
  const [filtro, setFiltro] = useState('todos')
  const [erro, setErro] = useState('')

  useEffect(() => {
    supabase.rpc('plataforma_vinculos', { quantas: 200 }).then(({ data, error }) => { if (error) setErro(error.message); setLista(data ?? []) })
    supabase.rpc('plataforma_funil').then(({ data }) => setFunil(data))
    supabase.rpc('plataforma_kpis').then(({ data }) => setK(data))
  }, [])

  const vis = useMemo(() => (lista ?? []).filter((v) =>
    filtro === 'todos' ? true : filtro === 'ativos' ? v.ativo : filtro === 'sairam' ? !v.ativo : filtro === 'link' ? ['link', 'vitrine'].includes(v.canal) : v.canal === filtro), [lista, filtro])
  const canais = (funil?.canais ?? [])
  const totalCanais = canais.reduce((a, c) => a + Number(c.quantos), 0) || 1
  const contas = Number(funil?.contas ?? 0) || 0

  return (
    <Shell acao={{ rotulo: 'Novo salão', onClick: () => (window.location.href = '/plataforma/saloes?novo=1') }}>
      <Cabecalho titulo="Convites e vínculos" sub="Acompanhe quem entrou por QR, link, código ou agendamento, e para onde cada cliente foi vinculada." />
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="plat-grade-4">
        <Kpi Icon={LinkIcon} cor="roxo" n={k?.vinculos?.valor} anterior={k?.vinculos?.anterior} serie={k?.vinculos?.serie} rotulo="vínculos ativos" />
        <Kpi Icon={UsersIcon} cor="rosa" n={k?.sem_vinculo?.valor} rotulo="sem vínculo" sub="clientes fora de qualquer agenda" />
        <Kpi Icon={ClockIcon} cor="roxo" n={funil?.sairam ?? 0} rotulo="saíram de agendas" sub="vínculos encerrados" />
        <Kpi Icon={ConviteIcon} cor="rosa" n={k?.contas_7d?.valor} anterior={k?.contas_7d?.anterior} serie={k?.contas_7d?.serie} rotulo="contas novas (7 dias)" legenda="vs. período anterior" />
      </div>

      <div className="plat-duas-colunas">
        <div>
          <Painel Icon={ClockIcon} titulo="Vínculos recentes" sub="Últimos vínculos criados na plataforma, e por onde cada cliente entrou." direita={<div className="plat-chips">{[['todos', 'Todos'], ['qr', 'QR'], ['link', 'Link'], ['codigo', 'Código'], ['agendamento', 'Agendou'], ['encaixe', 'Encaixe'], ['ativos', 'Ativos'], ['sairam', 'Saíram']].map(([kk, r]) => <button key={kk} className={'plat-chip' + (filtro === kk ? ' ativo' : '')} onClick={() => setFiltro(kk)}>{r}</button>)}</div>}>
            <table className="plat-tabela">
              <thead><tr><th>Pessoa</th><th>Origem</th><th>Destino</th><th>Canal</th><th>Status</th><th>Criado em</th></tr></thead>
              <tbody>
                {!lista ? <tr><td colSpan={6}><Vazio>Carregando…</Vazio></td></tr> : vis.length === 0 ? <tr><td colSpan={6}><Vazio>Nenhum vínculo com esse filtro.</Vazio></td></tr> : vis.slice(0, 40).map((v) => (
                  <tr key={v.id}>
                    <td><div className="plat-pessoa"><Iniciais nome={v.pessoa} /><div><strong>{v.pessoa}</strong><small className="muted">{v.contato || '—'}</small></div></div></td>
                    <td><div><strong className="plat-normal">{v.origem}</strong><small className="muted plat-bloco">{v.origem_tipo === 'profissional' ? 'Profissional' : 'Salão'}</small></div></td>
                    <td><div><strong className="plat-normal">{v.destino}</strong><small className="muted plat-bloco">{v.destino_tipo === 'autonoma' ? 'Autônoma' : 'Salão'}</small></div></td>
                    <td><Pilula tom={v.canal === 'qr' ? 'roxo' : v.canal === 'link' ? 'rosa' : v.canal === 'cadastro' ? 'azul' : 'cinza'}>{v.canal === 'qr' ? '▦ ' : v.canal === 'link' ? '🔗 ' : ''}{CANAL[v.canal] ?? v.canal}</Pilula></td>
                    <td><Pilula>{v.ativo ? 'Vinculado' : 'Saiu'}</Pilula></td>
                    <td className="muted">{haQuanto(v.criado_em)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Painel>

          <Painel Icon={LinkIcon} titulo="Mapa de vínculos" sub="De onde as clientes vêm e para onde vão." link="/plataforma/saloes" linkRotulo="Ver unidades">
            <div className="plat-mapa">
              <div className="plat-mapa-col"><header><span>▦ Canais</span><Pilula tom="roxo">{totalCanais}</Pilula></header>{canais.map((c) => <div key={c.canal} className="plat-mapa-linha"><span>{CANAL[c.canal] ?? c.canal}</span><small className="muted">{c.quantos} {Number(c.quantos) === 1 ? 'vínculo' : 'vínculos'}</small></div>)}{canais.length === 0 && <Vazio>Nenhum ainda.</Vazio>}</div>
              <span className="plat-mapa-seta">→</span>
              <div className="plat-mapa-col"><header><span>👤 Clientes</span><Pilula tom="menta">{funil?.com_vinculo ?? 0}</Pilula></header>{(lista ?? []).filter((v) => v.ativo).slice(0, 3).map((v) => <div key={v.id} className="plat-mapa-linha"><span className="plat-pessoa"><Iniciais nome={v.pessoa} /> {v.pessoa}</span><small className="muted">via {CANAL[v.canal] ?? v.canal}</small></div>)}{(funil?.com_vinculo ?? 0) > 3 && <small className="muted">+{funil.com_vinculo - 3} outras clientes</small>}</div>
              <span className="plat-mapa-seta">→</span>
              <div className="plat-mapa-col"><header><span>🏠 Salões / Profissionais</span><Pilula tom="azul">{(funil?.destinos ?? []).length}</Pilula></header>{(funil?.destinos ?? []).slice(0, 4).map((d) => <div key={d.nome} className="plat-mapa-linha"><span>{d.tipo === 'autonoma' ? '👤' : '🏠'} {d.nome}</span><small className="muted">{d.quantos} {Number(d.quantos) === 1 ? 'cliente vinculada' : 'clientes vinculadas'}</small></div>)}</div>
            </div>
          </Painel>
        </div>

        <aside className="plat-lado">
          <Painel Icon={GraficoIcon} titulo="Canais que mais trazem" sub="Por onde as clientes entraram, do maior para o menor.">
            <ul className="plat-distribuicao canais">
              {canais.map((c) => <li key={c.canal}><span className={'plat-icone pequeno ' + (c.canal === 'qr' ? 'roxo' : c.canal === 'link' ? 'rosa' : 'azul')}>{c.canal === 'qr' ? <QrIcon /> : c.canal === 'cadastro' ? <MailIcon /> : <LinkIcon />}</span><span>{CANAL[c.canal] ?? c.canal}</span><i className="plat-barra"><b className={c.canal === 'qr' ? 'roxo' : 'rosa'} style={{ width: `${Math.round((c.quantos / totalCanais) * 100)}%` }} /></i><strong>{Math.round((c.quantos / totalCanais) * 100)}%</strong><small className="muted">{c.quantos} vinculadas</small></li>)}
              {canais.length === 0 && <Vazio>Sem vínculos ainda.</Vazio>}
            </ul>
          </Painel>
          <Painel Icon={ConviteIcon} titulo="Funil de entrada" sub="Da conta ao vínculo, em números.">
            <ul className="plat-funil">
              <li style={{ '--w': '100%' }}><strong>{contas}</strong><span className="muted">contas de cliente</span><em>100%</em></li>
              <li style={{ '--w': `${contas ? Math.max(20, Math.round(((funil?.com_vinculo ?? 0) / contas) * 100)) : 20}%` }}><strong>{funil?.com_vinculo ?? 0}</strong><span className="muted">com vínculo</span><em>{contas ? Math.round(((funil?.com_vinculo ?? 0) / contas) * 100) : 0}%</em></li>
              <li style={{ '--w': `${contas ? Math.max(15, Math.round(((funil?.sem_vinculo ?? 0) / contas) * 100)) : 15}%` }}><strong>{funil?.sem_vinculo ?? 0}</strong><span className="muted">sem vínculo</span><em>{contas ? Math.round(((funil?.sem_vinculo ?? 0) / contas) * 100) : 0}%</em></li>
            </ul>
          </Painel>
        </aside>
      </div>
    </Shell>
  )
}
