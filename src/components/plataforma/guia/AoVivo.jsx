import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { temGoogleMaps } from '../../../lib/googleMaps'
import { urlDoAmbiente } from '../../../lib/ambiente'
import { formatar, n0, taxa, taxaTexto } from '../../../lib/guiaMetricas'
import { Painel, Vazio } from '../Pecas'
import { Barras } from './desempenho/Barras'
import {
  Radio, Smartphone, Tablet, Monitor, MapPin, Navigation, Clock, ChevronDown, ChevronUp, ExternalLink, LoaderCircle, Layers, History, Sun, Map as MapaIcone,
  MessageCircle, Phone, Route, AtSign, Globe, Mail, CalendarCheck, CalendarHeart, Send, BadgeCheck, CalendarPlus, Share2, PencilLine, LocateFixed,
  MousePointerClick, LogOut, CircleCheck,
} from 'lucide-react'
import '../../../guia-aovivo.css'

// O site ao vivo (3.44, migração 192): quem está no site agora, em que
// página, de onde veio (Google, Instagram, WhatsApp, direto...), com que
// aparelho, sistema e navegador, em que cidade (pelo GPS de quem autorizou a
// localização no guia; senão, aproximada pelo IP) e o caminho que fez. Lê
// site_ao_vivo() a cada 5 s com a aba à vista. Ninguém é identificado: o
// banco reconhece a visita por um código do dia e não guarda o IP.
// Desde a 3.45 (migração 193), também onde cada visita tocou (WhatsApp,
// ligar, como chegar, Instagram, Quero marcar...) e como terminou: quem toca
// no WhatsApp e sai logo depois provavelmente foi marcar com o salão.

const MapaAoVivo = lazy(() => import('./MapaAoVivo'))
const INTERVALO_MS = 5000
const INTERVALO_LONGO_MS = 20000 // com mais de uma hora na tela, a leitura é maior (até 500 visitas): 20 s bastam
// 3.49 (migração 196): o período de quem passou por aqui, na lista e no mapa; lembrado ao trocar de aba
const HORAS = [1, 6, 12, 24]
const rotuloPeriodo = (h) => (h === 1 ? 'Última hora' : `Últimas ${h} horas`)
let horasMemoria = 1
const ORIGEM = { google: 'Google', bing: 'Bing', instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', tiktok: 'TikTok', youtube: 'YouTube', direto: 'Direto', interno: 'Do próprio site', outro: 'Outro site' }
const APARELHO = { celular: 'Celular', tablet: 'Tablet', computador: 'Computador', outro: 'Outro' }
const ICONE = { celular: Smartphone, tablet: Tablet, computador: Monitor }
// os toques nas páginas dos salões (site_eventos_tipos): rótulo curto e ícone
const ACAO = {
  whatsapp: ['WhatsApp', MessageCircle], ligar: ['Ligou', Phone], mapa: ['Como chegar', Route], instagram: ['Instagram', AtSign], site: ['Site do salão', Globe],
  email: ['E-mail', Mail], agendar_mimo: ['Agendar pela MIMO', CalendarCheck], quero_marcar: ['Quero marcar', CalendarHeart], pedido_enviado: ['Pedido enviado', Send],
  sou_dono: ['É o dono', BadgeCheck], criar_agenda: ['Criar agenda', CalendarPlus], compartilhar: ['Compartilhou', Share2], corrigir: ['Corrigir dados', PencilLine],
  localizacao: ['Localização ativada', LocateFixed],
}
const acaoDe = (a) => ({ rotulo: ACAO[a.tipo]?.[0] ?? a.rotulo ?? a.tipo, Icon: ACAO[a.tipo]?.[1] ?? MousePointerClick })
// contato é o que leva a cliente ao salão (o mesmo da migração 193); forte é o que encerra a busca: quem sai logo
// depois disso provavelmente foi marcar (ou ir) ao salão
const CONTATO = new Set(['whatsapp', 'ligar', 'mapa', 'instagram', 'site', 'email', 'agendar_mimo', 'quero_marcar', 'pedido_enviado'])
const FORTE = new Set(['whatsapp', 'ligar', 'mapa', 'agendar_mimo', 'pedido_enviado'])
const tomDe = (tipo) => (FORTE.has(tipo) ? 'forte' : CONTATO.has(tipo) ? 'contato' : 'outro')
const SAIU = {
  whatsapp: 'Saiu pelo WhatsApp', ligar: 'Ligou e saiu', mapa: 'Saiu pelo Como chegar', agendar_mimo: 'Foi agendar pela MIMO', pedido_enviado: 'Enviou o pedido e saiu',
  quero_marcar: 'Quero marcar, sem enviar', instagram: 'Saiu pelo Instagram', site: 'Saiu pelo site do salão', email: 'Saiu pelo e-mail do salão',
}
// nas barras de hoje, o desfecho forte leva um visto verde no lugar do ícone
const Provavel = (p) => <CircleCheck {...p} color="#0b7a50" />
// o desfecho da visita: texto, tom e, quando é forte, o que provavelmente aconteceu
function desfechoDe(d) {
  if (!d || d === 'navegando') return null
  if (d === 'contatou') return { texto: 'Já tocou em contato', tom: 'contato', Icon: MousePointerClick }
  if (d === 'contatou_e_saiu') return { texto: 'Contatou e saiu depois', tom: 'contato', Icon: LogOut }
  if (d === 'sem_contato') return { texto: 'Saiu sem contatar', tom: 'fraco', Icon: LogOut }
  const tipo = d.replace(/^saiu_/, '')
  const forte = FORTE.has(tipo)
  return { texto: SAIU[tipo] ?? `Saiu depois de ${acaoDe({ tipo }).rotulo}`, tom: forte ? 'forte' : 'contato', Icon: acaoDe({ tipo }).Icon,
    provavel: forte ? (tipo === 'mapa' ? 'provável ida ao salão' : 'provável agendamento') : null }
}
const faltaMigracao = (e) => e?.code === 'PGRST202' || e?.status === 404 || /could not find the function|schema cache/i.test(e?.message ?? '')

// 45 s · 3 min · 1 h 12 min
function duracao(s) {
  const x = Math.max(0, Math.round(n0(s)))
  if (x < 60) return `${x} s`
  if (x < 3600) return `${Math.floor(x / 60)} min`
  return `${Math.floor(x / 3600)} h ${Math.floor((x % 3600) / 60)} min`
}
const mmss = (s) => `${String(Math.floor(n0(s) / 60)).padStart(2, '0')}:${String(Math.round(n0(s)) % 60).padStart(2, '0')}`
const segs = (a, b) => (new Date(a).getTime() - new Date(b).getTime()) / 1000
const rotuloOrigem = (v) => (v.origem === 'outro' && v.ref ? v.ref.replace(/^www\./, '') : ORIGEM[v.origem] ?? v.origem ?? 'Outro site')
const aparelhoDe = (v) => [APARELHO[v.dispositivo] ?? null, v.sistema, v.navegador].filter(Boolean).join(' · ') || 'Aparelho desconhecido'
const lugarDe = (v) => (v.cidade ? `${v.cidade}${v.uf ? `, ${v.uf}` : ''}${v.bairro ? ` (${v.bairro})` : ''}` : null)
const urlDaPagina = (p) => urlDoAmbiente('cliente', p)

let memoria = null // voltar para a aba mostra a última leitura na hora

export default function AoVivo() {
  const [dados, setDados] = useState(memoria)
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState(null)
  const [mapa, setMapa] = useState(true)
  const [verRecentes, setVerRecentes] = useState(true)
  const [horas, setHoras] = useState(horasMemoria)
  useEffect(() => { horasMemoria = horas }, [horas]) // lembrado ao trocar de aba

  useEffect(() => {
    let vivo = true
    let t
    const ler = async () => {
      if (document.visibilityState === 'visible') {
        // 3.49: com o período (migração 196); num banco sem a 196, a chamada de sempre
        let { data, error } = await supabase.rpc('site_ao_vivo', { horas_: horas })
        if (error && faltaMigracao(error)) ({ data, error } = await supabase.rpc('site_ao_vivo'))
        if (!vivo) return
        if (error) setErro(faltaMigracao(error) ? 'sem_192' : error.message || 'não deu para ler o site ao vivo')
        else { setErro(''); memoria = data; setDados(data) }
      }
      if (vivo) t = setTimeout(ler, horas > 1 ? INTERVALO_LONGO_MS : INTERVALO_MS)
    }
    t = setTimeout(ler, 0)
    return () => { vivo = false; clearTimeout(t) }
  }, [horas])

  const ativos = useMemo(() => (Array.isArray(dados?.ativos) ? dados.ativos : []), [dados])
  // o mapa (3.49): quem está no site agora em destaque e quem passou no período mais claro
  const passaram = useMemo(() => (Array.isArray(dados?.recentes) ? dados.recentes : []), [dados])
  const pontos = useMemo(() => [...ativos.map((v) => ({ v, ativo: true })), ...passaram.map((v) => ({ v, ativo: false }))]
    .filter(({ v }) => Number.isFinite(v.lat) && Number.isFinite(v.lng))
    .map(({ v, ativo }) => ({ id: v.id, lat: v.lat, lng: v.lng, gps: v.local_fonte === 'gps', ativo, titulo: `${lugarDe(v) ?? ''} · ${v.titulo || v.pagina}${ativo ? '' : ' · saiu'}` })), [ativos, passaram])

  if (erro === 'sem_192') return <Vazio>O site ao vivo precisa da migração 192: rode o bat B (aplica a migração e carrega a base de IP) e depois o bat 2.</Vazio>
  if (!dados) return <div className="pg-carregando">{erro ? erro : <><LoaderCircle className="pg-gira" size={18} /> Olhando quem está no site…</>}</div>

  const agora = dados.agora
  const minutos = dados.minutos ?? []
  const maxMin = Math.max(1, ...minutos.map((m) => n0(m.n)))
  const hoje = dados.hoje ?? {}
  const maxHora = Math.max(1, ...(hoje.por_hora ?? []).map((h) => n0(h.n)))
  const horasDados = n0(dados.horas) || 1
  const periodoRotulo = rotuloPeriodo(horasDados)
  const noPeriodo = horasDados === 1 ? 'na última hora' : `nas últimas ${horasDados} horas`
  const totalTrinta = n0(dados.no_periodo ?? dados.ultimos_30) // o total do período (num banco sem a 196, os 30 min)
  const barras = (lista, chave, rotulo) => (lista ?? []).map((x) => ({ chave: String(x[chave]), n: x.n, rotulo: rotulo(x) }))
  const temAcoes = Array.isArray(dados.acoes_recentes) // a migração 193 já rodou
  const recentes = dados.recentes ?? []
  // tocar num toque do feed abre a visita dele (na lista de agora ou na dos que saíram há pouco)
  const abrirVisita = (id) => {
    if (id == null) return
    if (recentes.some((v) => v.id === id)) setVerRecentes(true)
    setAberto(id)
    setTimeout(() => document.getElementById(`pv-vis-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50)
  }
  const desfechos = hoje.desfechos ?? []
  const provaveis = desfechos.reduce((s, d) => s + (desfechoDe(d.desfecho)?.provavel ? n0(d.n) : 0), 0)
  const semContato = n0(desfechos.find((d) => d.desfecho === 'sem_contato')?.n)

  return (
    <div className="pv" data-teste="ao-vivo">
      {erro && <div className="alert alert-error">{erro}</div>}
      <section className="pv-topo">
        <div className="pv-agora" role="status" aria-live="polite">
          <span className={'pv-pulso' + (n0(dados.no_site) ? ' ligado' : '')} aria-hidden="true" />
          <div>
            <strong data-teste="ao-vivo-n">{formatar(dados.no_site)}</strong>
            <span>{n0(dados.no_site) === 1 ? 'pessoa no site agora' : 'pessoas no site agora'}</span>
            <small>{formatar(dados.ultimos_30)} nos últimos 30 minutos · {formatar(totalTrinta)} {noPeriodo} · atualiza a cada {horas > 1 ? 20 : 5} s</small>
          </div>
        </div>
        <div className="pv-minutos" role="img" aria-label={`Pessoas no site minuto a minuto, últimos 30 minutos; agora ${n0(dados.no_site)}`}>
          {minutos.map((m, i) => <i key={m.m} className={i === minutos.length - 1 ? 'agora' : ''} style={{ height: `${Math.max(n0(m.n) ? 8 : 2, (n0(m.n) / maxMin) * 100)}%` }} title={`${new Date(m.m).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}: ${n0(m.n)}`} />)}
          <span className="pv-minutos-legenda"><span>há 30 min</span><span>agora</span></span>
        </div>
        <div className="pv-hoje-num">
          <div><b>{formatar(hoje.visitas)}</b><span>visitas hoje</span></div>
          <div><b>{formatar(hoje.paginas)}</b><span>páginas vistas</span></div>
          <div><b>{duracao(hoje.tempo_medio_s)}</b><span>tempo médio</span></div>
          {hoje.com_contato != null && <div data-teste="ao-vivo-contato-hoje"><b>{formatar(hoje.com_contato)}</b><span>tocaram em contato · {taxaTexto(taxa(hoje.com_contato, hoje.visitas))}</span></div>}
        </div>
      </section>

      <div className="pv-mesa">
        <Painel Icon={Radio} titulo="No site agora" sub="Cada visita, com a página de agora. Toque para ver o caminho que fez." className="pv-lista-painel"
          direita={<div className="pv-periodo" role="group" aria-label="Período de quem passou por aqui">{HORAS.map((h) => <button key={h} type="button" className={h === horas ? 'on' : ''} aria-pressed={h === horas} onClick={() => setHoras(h)} data-teste={`ao-vivo-horas-${h}`}>{h} h</button>)}</div>}>
          {ativos.length === 0 ? (
            <Vazio>Ninguém no site agora. Quando alguém abrir uma página do site, aparece aqui em segundos.</Vazio>
          ) : (
            <ul className="pv-lista" data-teste="ao-vivo-lista">
              {ativos.map((v) => <Visitante key={v.id} v={v} agora={agora} aberto={aberto === v.id} onAbrir={() => setAberto((x) => (x === v.id ? null : v.id))} />)}
            </ul>
          )}
          {recentes.length > 0 && (
            <details className="pv-recentes" open={verRecentes} onToggle={(e) => setVerRecentes(e.currentTarget.open)}>
              <summary data-teste="ao-vivo-passaram"><History size={14} /> Passaram por aqui {noPeriodo} ({recentes.length}{n0(dados.no_periodo) - ativos.length > recentes.length ? ` de ${formatar(n0(dados.no_periodo) - ativos.length)}` : ''}){temAcoes && <ResumoSaidas lista={recentes} />}</summary>
              <ul className="pv-lista pv-lista-saiu">
                {recentes.map((v) => <Visitante key={v.id} v={v} agora={agora} saiu aberto={aberto === v.id} onAbrir={() => setAberto((x) => (x === v.id ? null : v.id))} />)}
              </ul>
            </details>
          )}
        </Painel>

        <div className="pv-lado">
          <Painel Icon={MousePointerClick} titulo="Onde estão tocando" sub="Os últimos toques nas páginas dos salões: WhatsApp, ligar, como chegar, Instagram, Quero marcar…" className="pv-toques-painel">
            {!temAcoes ? (
              <Vazio>Os toques aparecem aqui depois da migração 193 (rode o bat B).</Vazio>
            ) : (
              <>
                {(dados.acoes ?? []).length > 0 && (
                  <div className="pv-acoes-30" aria-label="Toques nos últimos 30 minutos">
                    {dados.acoes.map((x) => { const { rotulo, Icon } = acaoDe(x); return <span key={x.tipo} className="pv-chip" data-tom={tomDe(x.tipo)}><Icon size={12} aria-hidden="true" />{rotulo} <b>{formatar(x.n)}</b></span> })}
                    <small>{periodoRotulo.toLowerCase()}</small>
                  </div>
                )}
                {dados.acoes_recentes.length ? (
                  <ul className="pv-feed" data-teste="ao-vivo-toques">
                    {dados.acoes_recentes.map((a, i) => <Toque key={`${a.em}-${a.tipo}-${a.visita ?? i}`} a={a} agora={agora} onAbrir={a.visita != null ? () => abrirVisita(a.visita) : null} />)}
                  </ul>
                ) : (
                  <Vazio>Ninguém tocou em nada {noPeriodo}. Quando alguém tocar no WhatsApp, no Como chegar ou no Quero marcar de um salão, aparece aqui na hora.</Vazio>
                )}
              </>
            )}
          </Painel>
          {temGoogleMaps() && (
            <Painel Icon={MapaIcone} titulo="Onde estão" sub={`Rosa: pelo GPS de quem autorizou a localização. Roxo: aproximada pelo IP. Grande: no site agora; menor: passou ${noPeriodo}.`}
              direita={<button type="button" className="plat-link" onClick={() => setMapa((x) => !x)}>{mapa ? 'Esconder' : 'Mostrar'}</button>}>
              {mapa && (pontos.length
                ? <Suspense fallback={<div className="pg-carregando"><LoaderCircle className="pg-gira" size={16} /> Abrindo o mapa…</div>}><MapaAoVivo pontos={pontos} /></Suspense>
                : <Vazio>Sem ninguém com cidade {noPeriodo}.</Vazio>)}
            </Painel>
          )}
          <Painel Icon={Layers} titulo="Páginas agora">
            <Barras itens={(dados.paginas_agora ?? []).map((p) => ({ chave: p.pagina, n: p.n, rotulo: p.titulo || p.pagina }))} total={n0(dados.no_site)} vazio="Ninguém no site agora." />
          </Painel>
          <Painel Icon={Navigation} titulo="De onde vieram" sub={periodoRotulo}>
            <Barras itens={barras(dados.origens, 'origem', (x) => ORIGEM[x.origem] ?? x.origem)} total={totalTrinta} />
          </Painel>
          <Painel Icon={Smartphone} titulo="Aparelhos" sub={periodoRotulo}>
            <Barras itens={barras(dados.dispositivos, 'dispositivo', (x) => APARELHO[x.dispositivo] ?? x.dispositivo)} total={totalTrinta} />
          </Painel>
          <Painel Icon={MapPin} titulo="Cidades" sub={periodoRotulo}>
            <Barras itens={(dados.cidades ?? []).map((c) => ({ chave: `${c.cidade}|${c.uf}`, n: c.n, rotulo: `${c.cidade}, ${c.uf}${n0(c.gps) ? ` · ${c.gps} por GPS` : ''}` }))} total={totalTrinta} vazio="Sem cidade conhecida ainda." />
          </Painel>
        </div>
      </div>

      <Painel Icon={Sun} titulo="Hoje" sub="Desde a meia-noite (horário de Brasília)" className="pv-hoje">
        {hoje.desfechos && (
          <div className="pv-hoje-acoes" data-teste="ao-vivo-hoje-acoes">
            <p className="pv-hoje-frase">
              {n0(hoje.terminadas)
                ? <><b>{formatar(provaveis)}</b> {provaveis === 1 ? 'visita terminou' : 'visitas terminaram'} num contato com o salão (WhatsApp, ligação, como chegar, agendamento ou pedido) e não {provaveis === 1 ? 'voltou' : 'voltaram'}: {taxaTexto(taxa(provaveis, hoje.terminadas))} das {formatar(hoje.terminadas)} visitas que já terminaram hoje.</>
                : 'Nenhuma visita terminou hoje ainda.'}
            </p>
            <div className="pv-hoje-grade">
              <div>
                <h4>Como as visitas terminaram</h4>
                <Barras cor="contato" itens={desfechos.map((d) => { const x = desfechoDe(d.desfecho); return { chave: d.desfecho, n: d.n, rotulo: x?.texto ?? d.desfecho, Icon: x?.provavel ? Provavel : x?.Icon } })} total={n0(hoje.terminadas)} vazio="Nenhuma visita terminou ainda." />
                {provaveis > 0 && <p className="pv-legenda"><CircleCheck size={13} color="#0b7a50" aria-hidden="true" /> saiu logo depois de tocar: provável agendamento (ou ida ao salão, no Como chegar)</p>}
              </div>
              <div><h4>Toques de hoje</h4><Barras cor="contato" itens={(hoje.acoes ?? []).filter((a) => a.tipo !== 'localizacao').map((a) => { const x = acaoDe(a); return { chave: a.tipo, n: a.n, rotulo: x.rotulo, Icon: x.Icon } })} total={n0(hoje.visitas)} vazio="Ninguém tocou em nada hoje ainda." /></div>
              <div><h4>Salões mais contatados</h4><Barras cor="pedido" itens={(hoje.saloes ?? []).map((l) => ({ chave: l.lugar, n: l.n, rotulo: `${l.lugar}${n0(l.whatsapp) ? ` · ${formatar(l.whatsapp)} no WhatsApp` : ''}${n0(l.pedidos) ? ` · ${formatar(l.pedidos)} ${n0(l.pedidos) === 1 ? 'pedido' : 'pedidos'}` : ''}` }))} total={(hoje.saloes ?? []).reduce((s, l) => s + n0(l.n), 0)} vazio="Nenhum salão contatado hoje ainda." /></div>
              <div><h4>Onde saem sem contatar</h4><Barras itens={(hoje.saidas_sem_contato ?? []).map((p) => ({ chave: p.pagina, n: p.n, rotulo: p.titulo || p.pagina }))} total={semContato} vazio="Ninguém saiu sem contatar hoje." /></div>
            </div>
          </div>
        )}
        <div className="pv-horas" role="img" aria-label="Visitas por hora hoje">
          {(hoje.por_hora ?? []).map((h) => <span key={h.h} title={`${h.h}h: ${n0(h.n)} visitas`}><i style={{ height: `${Math.max(n0(h.n) ? 6 : 1, (n0(h.n) / maxHora) * 100)}%` }} /><small>{h.h % 3 === 0 ? `${h.h}h` : ''}</small></span>)}
        </div>
        <div className="pv-hoje-grade">
          <div><h4>De onde vieram</h4><Barras itens={barras(hoje.origens, 'origem', (x) => ORIGEM[x.origem] ?? x.origem)} total={n0(hoje.visitas)} /></div>
          <div><h4>Aparelhos</h4><Barras itens={barras(hoje.dispositivos, 'dispositivo', (x) => APARELHO[x.dispositivo] ?? x.dispositivo)} total={n0(hoje.visitas)} /></div>
          <div><h4>Navegadores</h4><Barras itens={barras(hoje.navegadores, 'navegador', (x) => x.navegador)} total={n0(hoje.visitas)} /></div>
          <div><h4>Cidades</h4><Barras itens={(hoje.cidades ?? []).map((c) => ({ chave: `${c.cidade}|${c.uf}`, n: c.n, rotulo: `${c.cidade}, ${c.uf}` }))} total={n0(hoje.visitas)} vazio="Sem cidade conhecida ainda." /></div>
          <div><h4>Páginas de entrada</h4><Barras itens={barras(hoje.entradas, 'pagina', (x) => x.pagina)} total={n0(hoje.visitas)} /></div>
        </div>
      </Painel>

      <p className="pv-nota muted" data-teste="ao-vivo-nota">
        Ninguém é identificado: a visita é reconhecida por um código do dia e o IP não é guardado.
        {dados.geo?.carregado_em
          ? <> A cidade pelo IP é aproximada (no celular, a operadora costuma aparecer na capital ou na cidade-polo), pela base <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">IP Geolocation by DB-IP</a> de {dados.geo.versao}. Quem autorizou a localização no guia aparece pelo GPS.</>
          : <> A cidade pelo IP liga quando o bat B carregar a base de IP (DB-IP Lite); até lá, só aparece a cidade de quem autorizou a localização no guia.</>}
      </p>
    </div>
  )
}

// "agora" · "há 40 s" · "há 3 min"
const ha = (s) => (s < 5 ? 'agora' : `há ${duracao(s)}`)
const MAX_CHIPS = 5

// um toque no feed: o que, em que salão, quando, com que aparelho e de onde; tocar abre a visita
function Toque({ a, agora, onAbrir }) {
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
function ResumoSaidas({ lista }) {
  const n = lista.filter((v) => desfechoDe(v.desfecho)?.provavel).length
  return n ? <span className="pv-recentes-resumo"> · {n} {n === 1 ? 'saiu num contato com o salão' : 'saíram num contato com o salão'}</span> : null
}

function Visitante({ v, agora, aberto, onAbrir, saiu = false }) {
  const Icone = ICONE[v.dispositivo] ?? Monitor
  const lugar = lugarDe(v)
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
            {lugar
              ? <span className="pv-vis-lugar"><MapPin size={12} aria-hidden="true" />{lugar} <span className={'pv-fonte ' + (v.local_fonte === 'gps' ? 'gps' : 'ip')}>{v.local_fonte === 'gps' ? 'GPS' : 'IP aprox.'}</span></span>
              : <span className="pv-vis-lugar muted"><MapPin size={12} aria-hidden="true" />cidade desconhecida</span>}
            <span>{aparelhoDe(v)}</span>
            <span><Clock size={12} aria-hidden="true" />{saiu ? `ficou ${duracao(tempo)}` : `há ${duracao(tempo)}`} · {formatar(v.paginas)} {n0(v.paginas) === 1 ? 'página' : 'páginas'}</span>
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
