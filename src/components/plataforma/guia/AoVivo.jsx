import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { temGoogleMaps } from '../../../lib/googleMaps'
import { urlDoAmbiente } from '../../../lib/ambiente'
import { formatar, n0 } from '../../../lib/guiaMetricas'
import { Painel, Vazio } from '../Pecas'
import { Barras } from './desempenho/Barras'
import { Radio, Smartphone, Tablet, Monitor, MapPin, Navigation, Clock, ChevronDown, ChevronUp, ExternalLink, LoaderCircle, Layers, History, Sun, Map as MapaIcone } from 'lucide-react'
import '../../../guia-aovivo.css'

// O site ao vivo (3.44, migração 192): quem está no site agora, em que
// página, de onde veio (Google, Instagram, WhatsApp, direto...), com que
// aparelho, sistema e navegador, em que cidade (pelo GPS de quem autorizou a
// localização no guia; senão, aproximada pelo IP) e o caminho que fez. Lê
// site_ao_vivo() a cada 5 s com a aba à vista. Ninguém é identificado: o
// banco reconhece a visita por um código do dia e não guarda o IP.

const MapaAoVivo = lazy(() => import('./MapaAoVivo'))
const INTERVALO_MS = 5000
const ORIGEM = { google: 'Google', bing: 'Bing', instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', tiktok: 'TikTok', youtube: 'YouTube', direto: 'Direto', interno: 'Do próprio site', outro: 'Outro site' }
const APARELHO = { celular: 'Celular', tablet: 'Tablet', computador: 'Computador', outro: 'Outro' }
const ICONE = { celular: Smartphone, tablet: Tablet, computador: Monitor }
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

  useEffect(() => {
    let vivo = true
    let t
    const ler = async () => {
      if (document.visibilityState === 'visible') {
        const { data, error } = await supabase.rpc('site_ao_vivo')
        if (!vivo) return
        if (error) setErro(faltaMigracao(error) ? 'sem_192' : error.message || 'não deu para ler o site ao vivo')
        else { setErro(''); memoria = data; setDados(data) }
      }
      if (vivo) t = setTimeout(ler, INTERVALO_MS)
    }
    t = setTimeout(ler, 0)
    return () => { vivo = false; clearTimeout(t) }
  }, [])

  const ativos = useMemo(() => (Array.isArray(dados?.ativos) ? dados.ativos : []), [dados])
  const pontos = useMemo(() => ativos.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng))
    .map((v) => ({ id: v.id, lat: v.lat, lng: v.lng, gps: v.local_fonte === 'gps', titulo: `${lugarDe(v) ?? ''} · ${v.titulo || v.pagina}` })), [ativos])

  if (erro === 'sem_192') return <Vazio>O site ao vivo precisa da migração 192: rode o bat B (aplica a migração e carrega a base de IP) e depois o bat 2.</Vazio>
  if (!dados) return <div className="pg-carregando">{erro ? erro : <><LoaderCircle className="pg-gira" size={18} /> Olhando quem está no site…</>}</div>

  const agora = dados.agora
  const minutos = dados.minutos ?? []
  const maxMin = Math.max(1, ...minutos.map((m) => n0(m.n)))
  const hoje = dados.hoje ?? {}
  const maxHora = Math.max(1, ...(hoje.por_hora ?? []).map((h) => n0(h.n)))
  const totalTrinta = n0(dados.ultimos_30)
  const barras = (lista, chave, rotulo) => (lista ?? []).map((x) => ({ chave: String(x[chave]), n: x.n, rotulo: rotulo(x) }))

  return (
    <div className="pv" data-teste="ao-vivo">
      {erro && <div className="alert alert-error">{erro}</div>}
      <section className="pv-topo">
        <div className="pv-agora" role="status" aria-live="polite">
          <span className={'pv-pulso' + (n0(dados.no_site) ? ' ligado' : '')} aria-hidden="true" />
          <div>
            <strong data-teste="ao-vivo-n">{formatar(dados.no_site)}</strong>
            <span>{n0(dados.no_site) === 1 ? 'pessoa no site agora' : 'pessoas no site agora'}</span>
            <small>{formatar(totalTrinta)} nos últimos 30 minutos · atualiza a cada 5 s</small>
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
        </div>
      </section>

      <div className="pv-mesa">
        <Painel Icon={Radio} titulo="No site agora" sub="Cada visita, com a página de agora. Toque para ver o caminho que fez." className="pv-lista-painel">
          {ativos.length === 0 ? (
            <Vazio>Ninguém no site agora. Quando alguém abrir uma página do site, aparece aqui em segundos.</Vazio>
          ) : (
            <ul className="pv-lista" data-teste="ao-vivo-lista">
              {ativos.map((v) => <Visitante key={v.id} v={v} agora={agora} aberto={aberto === v.id} onAbrir={() => setAberto((x) => (x === v.id ? null : v.id))} />)}
            </ul>
          )}
          {(dados.recentes ?? []).length > 0 && (
            <details className="pv-recentes">
              <summary><History size={14} /> Saíram há pouco ({dados.recentes.length})</summary>
              <ul className="pv-lista pv-lista-saiu">
                {dados.recentes.map((v) => <Visitante key={v.id} v={v} agora={agora} saiu aberto={aberto === v.id} onAbrir={() => setAberto((x) => (x === v.id ? null : v.id))} />)}
              </ul>
            </details>
          )}
        </Painel>

        <div className="pv-lado">
          {temGoogleMaps() && (
            <Painel Icon={MapaIcone} titulo="Onde estão" sub="Rosa: cidade pelo GPS de quem autorizou a localização. Cinza: aproximada pelo IP."
              direita={<button type="button" className="plat-link" onClick={() => setMapa((x) => !x)}>{mapa ? 'Esconder' : 'Mostrar'}</button>}>
              {mapa && (pontos.length
                ? <Suspense fallback={<div className="pg-carregando"><LoaderCircle className="pg-gira" size={16} /> Abrindo o mapa…</div>}><MapaAoVivo pontos={pontos} /></Suspense>
                : <Vazio>Sem ninguém com cidade agora.</Vazio>)}
            </Painel>
          )}
          <Painel Icon={Layers} titulo="Páginas agora">
            <Barras itens={(dados.paginas_agora ?? []).map((p) => ({ chave: p.pagina, n: p.n, rotulo: p.titulo || p.pagina }))} total={n0(dados.no_site)} vazio="Ninguém no site agora." />
          </Painel>
          <Painel Icon={Navigation} titulo="De onde vieram" sub="Últimos 30 minutos">
            <Barras itens={barras(dados.origens, 'origem', (x) => ORIGEM[x.origem] ?? x.origem)} total={totalTrinta} />
          </Painel>
          <Painel Icon={Smartphone} titulo="Aparelhos" sub="Últimos 30 minutos">
            <Barras itens={barras(dados.dispositivos, 'dispositivo', (x) => APARELHO[x.dispositivo] ?? x.dispositivo)} total={totalTrinta} />
          </Painel>
          <Painel Icon={MapPin} titulo="Cidades" sub="Últimos 30 minutos">
            <Barras itens={(dados.cidades ?? []).map((c) => ({ chave: `${c.cidade}|${c.uf}`, n: c.n, rotulo: `${c.cidade}, ${c.uf}${n0(c.gps) ? ` · ${c.gps} por GPS` : ''}` }))} total={totalTrinta} vazio="Sem cidade conhecida ainda." />
          </Painel>
        </div>
      </div>

      <Painel Icon={Sun} titulo="Hoje" sub="Desde a meia-noite (horário de Brasília)" className="pv-hoje">
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

function Visitante({ v, agora, aberto, onAbrir, saiu = false }) {
  const Icone = ICONE[v.dispositivo] ?? Monitor
  const lugar = lugarDe(v)
  const tempo = segs(saiu ? v.visto_em : agora, v.inicio_em)
  const utm = v.utm && typeof v.utm === 'object' ? [v.utm.source, v.utm.medium, v.utm.campaign].filter(Boolean).join(' / ') : ''
  return (
    <li className={'pv-vis' + (aberto ? ' aberto' : '') + (saiu ? ' saiu' : '')} data-teste="ao-vivo-visita">
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
        </span>
        {aberto ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
      </button>
      {aberto && (
        <div className="pv-vis-detalhe" data-teste="ao-vivo-trajeto">
          <ol className="pv-trajeto">
            {(v.trajeto ?? []).map((p, i) => (
              <li key={`${p.p}-${i}`}>
                <span className="pv-trajeto-t">{mmss(p.t)}</span>
                <a href={urlDaPagina(p.p)} target="_blank" rel="noopener noreferrer">{p.p}</a>
                {i === (v.trajeto?.length ?? 0) - 1 && !saiu && <span className="pv-tag pv-aqui">agora</span>}
              </li>
            ))}
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
