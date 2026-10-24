import { urlDoAmbiente } from '../../../lib/ambiente'
import { formatar, n0 } from '../../../lib/guiaMetricas'
import {
  Smartphone, Tablet, Monitor, MapPin, Clock, ChevronDown, ChevronUp, ExternalLink, MessageCircle, Phone, Route, AtSign, Globe, Mail, CalendarCheck,
  CalendarHeart, Send, BadgeCheck, CalendarPlus, Share2, PencilLine, LocateFixed, MousePointerClick, LogOut, LogIn, CircleCheck, Repeat, Sparkles,
} from 'lucide-react'

// As peças do site ao vivo (3.44 a 3.49) que a aba Agora e o Histórico (3.62, migração 209) compartilham: os rótulos
// das origens, aparelhos e toques, o desfecho de cada visita, os formatos de tempo e o cartão de uma visita.

export const ORIGEM = { google: 'Google', bing: 'Bing', instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', tiktok: 'TikTok', youtube: 'YouTube', direto: 'Direto', interno: 'Do próprio site', outro: 'Outro site' }
export const APARELHO = { celular: 'Celular', tablet: 'Tablet', computador: 'Computador', outro: 'Outro' }
export const ICONE = { celular: Smartphone, tablet: Tablet, computador: Monitor }
// os toques nas páginas dos salões (site_eventos_tipos): rótulo curto e ícone
export const ACAO = {
  whatsapp: ['WhatsApp', MessageCircle], ligar: ['Ligou', Phone], mapa: ['Como chegar', Route], instagram: ['Instagram', AtSign], site: ['Site do salão', Globe],
  email: ['E-mail', Mail], agendar_mimo: ['Agendar pela MIMO', CalendarCheck], quero_marcar: ['Quero marcar', CalendarHeart], pedido_enviado: ['Pedido enviado', Send],
  sou_dono: ['É o dono', BadgeCheck], criar_agenda: ['Criar agenda', CalendarPlus], compartilhar: ['Compartilhou', Share2], corrigir: ['Corrigir dados', PencilLine],
  localizacao: ['Localização ativada', LocateFixed],
}
export const acaoDe = (a) => ({ rotulo: ACAO[a.tipo]?.[0] ?? a.rotulo ?? a.tipo, Icon: ACAO[a.tipo]?.[1] ?? MousePointerClick })
// contato é o que leva a cliente ao salão (o mesmo da migração 193); forte é o que encerra a busca: quem sai logo
// depois disso provavelmente foi marcar (ou ir) ao salão
export const CONTATO = new Set(['whatsapp', 'ligar', 'mapa', 'instagram', 'site', 'email', 'agendar_mimo', 'quero_marcar', 'pedido_enviado'])
export const FORTE = new Set(['whatsapp', 'ligar', 'mapa', 'agendar_mimo', 'pedido_enviado'])
export const tomDe = (tipo) => (FORTE.has(tipo) ? 'forte' : CONTATO.has(tipo) ? 'contato' : 'outro')
export const SAIU = {
  whatsapp: 'Saiu pelo WhatsApp', ligar: 'Ligou e saiu', mapa: 'Saiu pelo Como chegar', agendar_mimo: 'Foi agendar pela MIMO', pedido_enviado: 'Enviou o pedido e saiu',
  quero_marcar: 'Quero marcar, sem enviar', instagram: 'Saiu pelo Instagram', site: 'Saiu pelo site do salão', email: 'Saiu pelo e-mail do salão',
}
// nas barras, o desfecho forte leva um visto verde no lugar do ícone
export const Provavel = (p) => <CircleCheck {...p} color="#0b7a50" />
// o desfecho da visita: texto, tom e, quando é forte, o que provavelmente aconteceu
export function desfechoDe(d) {
  if (!d || d === 'navegando') return null
  if (d === 'contatou') return { texto: 'Já tocou em contato', tom: 'contato', Icon: MousePointerClick }
  if (d === 'contatou_e_saiu') return { texto: 'Contatou e saiu depois', tom: 'contato', Icon: LogOut }
  if (d === 'sem_contato') return { texto: 'Saiu sem contatar', tom: 'fraco', Icon: LogOut }
  const tipo = d.replace(/^saiu_/, '')
  const forte = FORTE.has(tipo)
  return { texto: SAIU[tipo] ?? `Saiu depois de ${acaoDe({ tipo }).rotulo}`, tom: forte ? 'forte' : 'contato', Icon: acaoDe({ tipo }).Icon,
    provavel: forte ? (tipo === 'mapa' ? 'provável ida ao salão' : 'provável agendamento') : null }
}
export const faltaMigracao = (e) => e?.code === 'PGRST202' || e?.status === 404 || /could not find the function|schema cache/i.test(e?.message ?? '')

// 45 s · 3 min · 1 h 12 min
export function duracao(s) {
  const x = Math.max(0, Math.round(n0(s)))
  if (x < 60) return `${x} s`
  if (x < 3600) return `${Math.floor(x / 60)} min`
  return `${Math.floor(x / 3600)} h ${Math.floor((x % 3600) / 60)} min`
}
export const mmss = (s) => `${String(Math.floor(n0(s) / 60)).padStart(2, '0')}:${String(Math.round(n0(s)) % 60).padStart(2, '0')}`
export const segs = (a, b) => (new Date(a).getTime() - new Date(b).getTime()) / 1000
// "agora" · "há 40 s" · "há 3 min" · "há 2 h" · "ontem" · "há 5 dias" (3.62)
export function haTexto(s) {
  const x = Math.max(0, n0(s))
  if (x < 5) return 'agora'
  if (x < 86400) return `há ${duracao(x)}`
  const d = Math.floor(x / 86400)
  return d === 1 ? 'ontem' : `há ${d} dias`
}
export const ha = (s) => (s < 5 ? 'agora' : `há ${duracao(s)}`)
export const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '')
export const diaCurto = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '') : '')
export const rotuloOrigem = (v) => (v.origem === 'outro' && v.ref ? v.ref.replace(/^www\./, '') : ORIGEM[v.origem] ?? v.origem ?? 'Outro site')
export const aparelhoDe = (v) => [APARELHO[v.dispositivo] ?? null, v.sistema, v.navegador].filter(Boolean).join(' · ') || 'Aparelho desconhecido'
export const lugarDe = (v) => (v.cidade ? `${v.cidade}${v.uf ? `, ${v.uf}` : ''}${v.bairro ? ` (${v.bairro})` : ''}` : null)
export const urlDaPagina = (p) => urlDoAmbiente('cliente', p)
const MAX_CHIPS = 5

// 3.62: a pessoa já esteve aqui? (primeira_vez e visitas_antes vêm da migração 209; sem ela, nada aparece)
export function Recorrencia({ v, agora }) {
  if (v.primeira_vez === true) return <span className="pv-tag pv-nova" data-teste="ao-vivo-nova"><Sparkles size={11} aria-hidden="true" />1ª vez</span>
  if (v.primeira_vez === false) {
    const ultima = v.ultima_antes_em ? haTexto(segs(agora, v.ultima_antes_em)) : ''
    return <span className="pv-tag pv-volta" data-teste="ao-vivo-voltou" title={ultima ? `A última visita desta pessoa foi ${ultima}` : ''}><Repeat size={11} aria-hidden="true" />voltou · {n0(v.visitas_antes) + 1}ª visita{ultima ? ` · última ${ultima}` : ''}</span>
  }
  return null
}

// um toque no feed: o que, em que salão, quando, com que aparelho e de onde; tocar abre a visita
export function Toque({ a, agora, onAbrir }) {
  const { rotulo, Icon } = acaoDe(a)
  const lugar = lugarDe(a)
  const corpo = (
    <>
      <span className="pv-feed-icone" data-tom={tomDe(a.tipo)}><Icon size={15} aria-hidden="true" /></span>
      <span className="pv-feed-corpo">
        <b>{rotulo}{a.lugar && <span className="pv-feed-salao"> · {a.lugar}</span>}</b>
        <small>{ha(segs(agora, a.em))} · {APARELHO[a.dispositivo] ?? 'aparelho desconhecido'}{lugar ? ` · ${lugar}` : ''}</small>
      </span>
    </>
  )
  return (
    <li data-teste="ao-vivo-toque">
      {onAbrir ? <button type="button" className="pv-feed-item" onClick={onAbrir} title="Ver a visita">{corpo}</button> : <div className="pv-feed-item">{corpo}</div>}
    </li>
  )
}

// no resumo dos que saíram há pouco: quantos saíram num contato com o salão
export function ResumoSaidas({ lista }) {
  const n = lista.filter((v) => desfechoDe(v.desfecho)?.provavel).length
  return n ? <span className="pv-recentes-resumo"> · {n} {n === 1 ? 'saiu num contato com o salão' : 'saíram num contato com o salão'}</span> : null
}

// o cartão de uma visita: a página, a origem, a cidade, o aparelho, o tempo, as horas de entrada e saída (3.62), a
// recorrência, as ações e o desfecho; aberto, o trajeto com os toques e a ficha. historico: mostra o dia junto da hora.
export function Visitante({ v, agora, aberto, onAbrir, saiu = false, historico = false }) {
  const Icone = ICONE[v.dispositivo] ?? Monitor
  const lugar = lugarDe(v)
  const fimEm = v.saiu_em ?? v.visto_em
  const tempo = segs(saiu ? v.visto_em : agora, v.inicio_em)
  const utm = v.utm && typeof v.utm === 'object' ? [v.utm.source, v.utm.medium, v.utm.campaign].filter(Boolean).join(' / ') : ''
  const acoes = Array.isArray(v.acoes) ? v.acoes : []
  const fim = saiu ? desfechoDe(v.desfecho) : null
  // o caminho com os toques no meio, na ordem do tempo (a página antes do toque feito nela)
  const linha = [
    ...(v.trajeto ?? []).map((p, i) => ({ k: 'p', t: n0(p.t), p: p.p, ultima: i === (v.trajeto?.length ?? 0) - 1 })),
    ...acoes.map((a) => ({ k: 'a', t: n0(a.t), a })),
  ].sort((x, y) => x.t - y.t || (x.k === 'p' ? -1 : 1))
  return (
    <li id={`pv-vis-${v.id}`} className={'pv-vis' + (aberto ? ' aberto' : '') + (saiu ? ' saiu' : '') + (fim?.provavel ? ' provavel' : '')} data-teste="ao-vivo-visita">
      <button type="button" className="pv-vis-topo" onClick={onAbrir} aria-expanded={aberto}>
        <span className="pv-vis-icone" data-aparelho={v.dispositivo ?? 'outro'}><Icone size={18} aria-hidden="true" /></span>
        <span className="pv-vis-corpo">
          <b className="pv-vis-pagina">{v.titulo || v.pagina}</b>
          <small className="pv-vis-caminho">{v.pagina}</small>
          <span className="pv-vis-linha">
            <span className={'pv-tag pv-origem-' + (v.origem ?? 'outro')}>{rotuloOrigem(v)}</span>
            <Recorrencia v={v} agora={agora} />
            {lugar
              ? <span className="pv-vis-lugar"><MapPin size={12} aria-hidden="true" />{lugar} <span className={'pv-fonte ' + (v.local_fonte === 'gps' ? 'gps' : 'ip')}>{v.local_fonte === 'gps' ? 'GPS' : 'IP aprox.'}</span></span>
              : <span className="pv-vis-lugar muted"><MapPin size={12} aria-hidden="true" />cidade desconhecida</span>}
            <span>{aparelhoDe(v)}</span>
            <span><Clock size={12} aria-hidden="true" />{saiu ? `ficou ${duracao(tempo)}` : `há ${duracao(tempo)}`} · {formatar(v.paginas)} {n0(v.paginas) === 1 ? 'página' : 'páginas'}</span>
            <span className="pv-vis-horario" data-teste="ao-vivo-horario"><LogIn size={12} aria-hidden="true" />{historico ? `${diaCurto(v.inicio_em)} · ` : ''}entrou {hora(v.inicio_em)}{saiu ? ` · saiu ${hora(fimEm)} · ${haTexto(segs(agora, fimEm))}` : ''}</span>
          </span>
          {(acoes.length > 0 || fim) && (
            <span className="pv-vis-acoes" data-teste="ao-vivo-acoes">
              {fim && <span className="pv-desfecho" data-tom={fim.tom} data-teste="ao-vivo-desfecho"><fim.Icon size={12} aria-hidden="true" />{fim.texto}{fim.provavel && <em> · {fim.provavel}</em>}</span>}
              {acoes.slice(0, MAX_CHIPS).map((a, i) => { const { rotulo, Icon } = acaoDe(a); return <span key={`${a.tipo}-${i}`} className="pv-chip" data-tom={tomDe(a.tipo)} title={a.lugar ? `${rotulo} · ${a.lugar}` : rotulo}><Icon size={12} aria-hidden="true" />{rotulo}</span> })}
              {acoes.length > MAX_CHIPS && <span className="pv-chip">+{acoes.length - MAX_CHIPS}</span>}
            </span>
          )}
        </span>
        {aberto ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
      </button>
      {aberto && (
        <div className="pv-vis-detalhe" data-teste="ao-vivo-trajeto">
          <ol className="pv-trajeto">
            {linha.map((x, i) => x.k === 'p' ? (
              <li key={`p-${x.p}-${i}`}>
                <span className="pv-trajeto-t">{mmss(x.t)}</span>
                <a href={urlDaPagina(x.p)} target="_blank" rel="noopener noreferrer">{x.p}</a>
                {x.ultima && !saiu && <span className="pv-tag pv-aqui">agora</span>}
              </li>
            ) : (
              <li key={`a-${x.a.tipo}-${i}`} className="pv-trajeto-acao" data-tom={tomDe(x.a.tipo)}>
                <span className="pv-trajeto-t">{mmss(x.t)}</span>
                {(() => { const { rotulo, Icon } = acaoDe(x.a); return <span className="pv-chip" data-tom={tomDe(x.a.tipo)}><Icon size={12} aria-hidden="true" />{rotulo}</span> })()}
                {x.a.lugar && <span className="pv-trajeto-salao">{x.a.lugar}</span>}
              </li>
            ))}
            {saiu && (
              <li className="pv-trajeto-fim" data-tom={fim?.tom ?? 'fraco'}>
                <span className="pv-trajeto-t">{mmss(tempo)}</span>
                <span>{fim ? <>{fim.texto}{fim.provavel && <em> · {fim.provavel}</em>}</> : 'Saiu'}</span>
              </li>
            )}
          </ol>
          <dl className="pv-ficha">
            <dt>Horário</dt><dd>{diaCurto(v.inicio_em)} · entrou às {hora(v.inicio_em)}{saiu ? ` · saiu às ${hora(fimEm)} · ficou ${duracao(tempo)}` : ` · no site há ${duracao(tempo)}`}</dd>
            {v.primeira_vez != null && <><dt>Já esteve aqui</dt><dd>{v.primeira_vez ? 'Não: é a primeira visita desta conexão e navegador.' : `Sim: ${formatar(v.visitas_antes)} ${n0(v.visitas_antes) === 1 ? 'visita antes' : 'visitas antes'}${v.ultima_antes_em ? `, a última ${haTexto(segs(agora, v.ultima_antes_em))} (${diaCurto(v.ultima_antes_em)} às ${hora(v.ultima_antes_em)})` : ''}.`}</dd></>}
            <dt>Entrou por</dt><dd><a href={urlDaPagina(v.entrada)} target="_blank" rel="noopener noreferrer">{v.entrada} <ExternalLink size={11} /></a></dd>
            <dt>Origem</dt><dd>{ORIGEM[v.origem] ?? v.origem}{v.ref ? ` (${v.ref})` : ''}</dd>
            {utm && <><dt>Campanha</dt><dd>{utm}</dd></>}
            <dt>Aparelho</dt><dd>{aparelhoDe(v)}{v.tela ? ` · tela ${v.tela.replace('x', '×')}` : ''}</dd>
            {v.idioma && <><dt>Idioma</dt><dd>{v.idioma}</dd></>}
            <dt>Cidade</dt><dd>{lugar ? `${lugar} · ${v.local_fonte === 'gps' ? 'pelo GPS (autorizou a localização)' : 'aproximada pelo IP'}` : 'desconhecida'}</dd>
          </dl>
        </div>
      )}
    </li>
  )
}
