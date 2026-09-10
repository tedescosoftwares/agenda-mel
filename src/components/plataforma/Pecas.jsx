import { Link } from 'react-router-dom'
import { SetaIcon } from '../icons'
import { CalendarDays, ChevronDown } from 'lucide-react'

// As peças que se repetem em todo o painel da plataforma: o cabeçalho
// da tela, o card de número com variação e tendência, o card-painel
// com título e link, a pílula de status, iniciais e "há quanto tempo".

export function Cabecalho({ titulo, sub, direita }) {
  return (
    <div className="plat-cabecalho">
      <div><h1>{titulo}</h1>{sub && <p className="muted">{sub}</p>}</div>
      {direita ?? <div className="plat-periodo"><CalendarDays size={15} /> Últimos 30 dias <ChevronDown size={14} /></div>}
    </div>
  )
}

export function Kpi({ Icon, cor = 'rosa', n, rotulo, anterior, serie, legenda = 'vs. mês anterior', sub }) {
  const delta = anterior == null ? null : anterior === 0 ? (n > 0 ? 100 : 0) : Math.round(((n - anterior) / anterior) * 100)
  return (
    <div className="plat-kpi">
      <div className="plat-kpi-topo">
        <span className={'plat-icone ' + cor}>{Icon ? <Icon /> : null}</span>
        <div><strong>{n ?? 0}</strong><span className="muted">{rotulo}</span></div>
      </div>
      <div className="plat-kpi-pe">
        {delta != null ? (
          <span className={'plat-delta ' + (delta >= 0 ? 'sobe' : 'desce')}>{delta >= 0 ? '↗' : '↘'} {delta >= 0 ? '+' : ''}{delta}% <small className="muted">{legenda}</small></span>
        ) : <span className="muted plat-delta-sub">{sub ?? ''}</span>}
        {serie && <Tendencia pontos={serie} cor={cor} />}
      </div>
    </div>
  )
}

export function Tendencia({ pontos, cor = 'rosa', largura = 86, altura = 26 }) {
  const ps = (pontos ?? []).map(Number)
  if (ps.length < 2) return <svg width={largura} height={altura} />
  const max = Math.max(...ps), min = Math.min(...ps)
  const y = (v) => max === min ? altura / 2 : altura - 3 - ((v - min) / (max - min)) * (altura - 6)
  const x = (i) => (i / (ps.length - 1)) * (largura - 2) + 1
  const d = ps.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const stroke = cor === 'roxo' || cor === 'violeta' ? '#aa4cff' : cor === 'menta' ? '#12a06a' : cor === 'azul' ? '#3a6fd8' : cor === 'ambar' ? '#e0a100' : '#ff2d7a'
  return <svg className="plat-tendencia" width={largura} height={altura} viewBox={`0 0 ${largura} ${altura}`}><path d={d} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export function Painel({ Icon, titulo, sub, link, linkRotulo = 'Ver todos', children, className = '', direita }) {
  return (
    <section className={'plat-painel ' + className}>
      <header>
        <div className="plat-painel-tit">{Icon && <Icon />}<div><h3>{titulo}</h3>{sub && <p className="muted">{sub}</p>}</div></div>
        {direita ?? (link && <Link to={link} className="plat-link">{linkRotulo} <SetaIcon /></Link>)}
      </header>
      {children}
    </section>
  )
}

const TOM = {
  ok: 'menta', online: 'menta', enviado: 'menta', entregue: 'menta', lido: 'menta', vinculado: 'menta', ativo: 'menta', ativa: 'menta', concluido: 'menta', zerada: 'menta', 'em dia': 'menta', 'sem erros': 'menta', succeeded: 'menta', confirmado: 'menta',
  na_fila: 'ambar', pendente: 'ambar', enviando: 'ambar', atenção: 'ambar', atencao: 'ambar', implantação: 'ambar', 'convite pendente': 'ambar', parado: 'ambar',
  falhou: 'carmim', failed: 'carmim', 'sem vínculo': 'carmim', desativado: 'carmim', faltou: 'carmim', erro: 'carmim',
  cancelado: 'cinza', saiu: 'cinza', inativo: 'cinza',
  plataforma: 'roxo', admin: 'rosa', profissional: 'menta', cliente: 'rosa', salao: 'rosa', salão: 'rosa', autonoma: 'roxo', autônoma: 'roxo', oportunidade: 'roxo',
}
export function Pilula({ children, tom }) {
  const t = tom ?? TOM[String(children ?? '').toLowerCase()] ?? 'cinza'
  return <span className={'plat-pilula ' + t}>{children}</span>
}

export function Vazio({ children }) {
  return <p className="muted plat-vazio">{children}</p>
}

export function haQuanto(iso) {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `há ${Math.round(s / 60)} min`
  if (s < 86400) return `há ${Math.round(s / 3600)} horas`
  const d = Math.round(s / 86400)
  return d === 1 ? 'há 1 dia' : d < 30 ? `há ${d} dias` : new Date(iso).toLocaleDateString('pt-BR')
}

export function Iniciais({ nome, cor }) {
  const p = String(nome || '?').trim().split(/\s+/)
  const ini = ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()
  return <span className={'plat-iniciais ' + (cor ?? ['rosa', 'roxo', 'menta', 'azul', 'ambar'][ini.charCodeAt(0) % 5])}>{ini}</span>
}
