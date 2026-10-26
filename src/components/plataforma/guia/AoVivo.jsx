import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { temGoogleMaps } from '../../../lib/googleMaps'
import { formatar, n0, taxa, taxaTexto } from '../../../lib/guiaMetricas'
import { Painel, Vazio } from '../Pecas'
import { Nav } from './PecasWa'
import { Barras } from './desempenho/Barras'
import HistoricoSite from './HistoricoSite'
import { ORIGEM, APARELHO, acaoDe, tomDe, desfechoDe, Provavel, faltaMigracao, duracao, lugarDe, Toque, ResumoSaidas, Visitante } from './AoVivoPecas'
import { Radio, Smartphone, MapPin, Navigation, LoaderCircle, Layers, History, Sun, Map as MapaIcone, MousePointerClick, CircleCheck, CalendarRange } from 'lucide-react'
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
// 3.62 (migração 209): duas seções, Agora (esta) e Histórico (HistoricoSite:
// qualquer período de até 90 dias, com filtros); cada visita mostra a hora
// que entrou e saiu, há quanto tempo foi e se a pessoa é nova ou já voltou.
// As peças compartilhadas moram em AoVivoPecas.

const SECOES = [['agora', 'Agora', Radio], ['historico', 'Histórico', CalendarRange]]
let secaoMemoria = 'agora'

export default function AoVivo() {
  const [secao, setSecao] = useState(secaoMemoria)
  useEffect(() => { secaoMemoria = secao }, [secao])
  return (
    <div className="pv" data-teste="ao-vivo">
      <Nav secoes={SECOES} secao={secao} onTrocar={setSecao} prefixo="ao-vivo" rotulo="Seções do site ao vivo" />
      {secao === 'historico' ? <HistoricoSite /> : <Agora />}
    </div>
  )
}

const MapaAoVivo = lazy(() => import('./MapaAoVivo'))
const INTERVALO_MS = 5000
const INTERVALO_LONGO_MS = 20000 // com mais de uma hora na tela, a leitura é maior (até 500 visitas): 20 s bastam
// 3.49 (migração 196): o período de quem passou por aqui, na lista e no mapa; lembrado ao trocar de aba
const HORAS = [1, 6, 12, 24]
const rotuloPeriodo = (h) => (h === 1 ? 'Última hora' : `Últimas ${h} horas`)
let horasMemoria = 1
let memoria = null // voltar para a aba mostra a última leitura na hora

function Agora() {
  const [dados, setDados] = useState(memoria)
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState(null)
  const [mapa, setMapa] = useState(true)
  const [verRecentes, setVerRecentes] = useState(true)
  const [horas, setHoras] = useState(horasMemoria)
  const [soApp, setSoApp] = useState(false) // 3.73: só as visitas pelo app (migração 217)
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

  const doApp = (v) => v.origem === 'app'
  const todosAtivos = useMemo(() => (Array.isArray(dados?.ativos) ? dados.ativos : []), [dados])
  const ativos = useMemo(() => (soApp ? todosAtivos.filter(doApp) : todosAtivos), [todosAtivos, soApp])
  const noAppAgora = useMemo(() => todosAtivos.filter(doApp).length, [todosAtivos])
  // o mapa (3.49): quem está no site agora em destaque e quem passou no período mais claro
  const passaram = useMemo(() => { const r = Array.isArray(dados?.recentes) ? dados.recentes : []; return soApp ? r.filter(doApp) : r }, [dados, soApp])
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
  const recentes = passaram
  // 3.73: com "só o app", os toques são os das visitas pelo app (o toque sem visita registrada fica de fora)
  const idsApp = new Set([...ativos, ...recentes].map((v) => v.id))
  const acoesRecentes = soApp ? (dados.acoes_recentes ?? []).filter((a) => a.visita != null && idsApp.has(a.visita)) : (dados.acoes_recentes ?? [])
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
    <>
      {erro && <div className="alert alert-error">{erro}</div>}
      <section className="pv-topo">
        <div className="pv-agora" role="status" aria-live="polite">
          <span className={'pv-pulso' + (n0(dados.no_site) ? ' ligado' : '')} aria-hidden="true" />
          <div>
            <strong data-teste="ao-vivo-n">{formatar(dados.no_site)}</strong>
            <span>{n0(dados.no_site) === 1 ? 'pessoa no site agora' : 'pessoas no site agora'}</span>
            <small>{formatar(dados.ultimos_30)} nos últimos 30 minutos · {formatar(totalTrinta)} {noPeriodo} · atualiza a cada {horas > 1 ? 20 : 5} s{noAppAgora ? <> · <b data-teste="ao-vivo-app-agora">{noAppAgora}</b> pelo app</> : null}</small>
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
          {hoje.primeira != null && <div data-teste="ao-vivo-novas-hoje"><b>{formatar(hoje.primeira)}</b><span>{n0(hoje.primeira) === 1 ? 'pessoa nova' : 'pessoas novas'} · {formatar(hoje.recorrente)} {n0(hoje.recorrente) === 1 ? 'voltou' : 'voltaram'}</span></div>}
        </div>
      </section>

      <div className="pv-mesa">
        <Painel Icon={Radio} titulo="No site agora" sub="Cada visita, com a página de agora. Toque para ver o caminho que fez." className="pv-lista-painel"
          direita={<div className="pv-periodo-e-app"><div className="pv-periodo" role="group" aria-label="Período de quem passou por aqui">{HORAS.map((h) => <button key={h} type="button" className={h === horas ? 'on' : ''} aria-pressed={h === horas} onClick={() => setHoras(h)} data-teste={`ao-vivo-horas-${h}`}>{h} h</button>)}</div><label className="pv-so-app"><input type="checkbox" checked={soApp} onChange={(e) => setSoApp(e.target.checked)} data-teste="ao-vivo-so-app" /> Só o app</label></div>}>
          {ativos.length === 0 ? (
            <Vazio>{soApp ? 'Ninguém no guia pelo app agora. Quando uma cliente abrir o guia no app, aparece aqui em segundos.' : 'Ninguém no site agora. Quando alguém abrir uma página do site, aparece aqui em segundos.'}</Vazio>
          ) : (
            <ul className="pv-lista" data-teste="ao-vivo-lista">
              {ativos.map((v) => <Visitante key={v.id} v={v} agora={agora} aberto={aberto === v.id} onAbrir={() => setAberto((x) => (x === v.id ? null : v.id))} />)}
            </ul>
          )}
          {recentes.length > 0 && (
            <details className="pv-recentes" open={verRecentes} onToggle={(e) => setVerRecentes(e.currentTarget.open)}>
              <summary data-teste="ao-vivo-passaram"><History size={14} /> Passaram por aqui {noPeriodo} ({recentes.length}{n0(dados.no_periodo) - ativos.length > recentes.length ? ` de ${formatar(n0(dados.no_periodo) - ativos.length)}` : ''}){temAcoes && <ResumoSaidas lista={recentes} />}{dados.recorrencia && <span className="pv-recentes-rec" data-teste="ao-vivo-rec-periodo"> · {formatar(dados.recorrencia.primeira)} {n0(dados.recorrencia.primeira) === 1 ? 'nova' : 'novas'} · {formatar(dados.recorrencia.recorrente)} {n0(dados.recorrencia.recorrente) === 1 ? 'voltou' : 'voltaram'}</span>}</summary>
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
                {acoesRecentes.length ? (
                  <ul className="pv-feed" data-teste="ao-vivo-toques">
                    {acoesRecentes.map((a, i) => <Toque key={`${a.em}-${a.tipo}-${a.visita ?? i}`} a={a} agora={agora} onAbrir={a.visita != null ? () => abrirVisita(a.visita) : null} />)}
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
        {dados.recorrencia && <> "1ª vez" e "voltou" vêm de um código fixo da conexão e do navegador (aproximado: no celular fora do Wi-Fi a conexão muda). O Histórico guarda 90 dias.</>}
      </p>
    </>
  )
}
