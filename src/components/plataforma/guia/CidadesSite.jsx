import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { formatar, n0 } from '../../../lib/guiaMetricas'
import { Painel, Vazio } from '../Pecas'
import { Kpi } from './HistoricoSite'
import { faltaMigracao } from './AoVivoPecas'
import { CalendarRange, LoaderCircle, MapPinned, Search, Hourglass, Timer, MousePointerClick, ChevronDown, Info } from 'lucide-react'

// As cidades do guia no Google (4.5, migração 260): para cada cidade com salão no ar, quando ela foi ao ar, quando começou
// a aparecer nas buscas do Google (Search Console), quando chegou a primeira visita pelo Google e, no período, as aparições,
// os cliques e as visitas dia a dia. Serve para medir quanto o Google demora a mostrar as páginas novas. Lê site_cidades()
// uma vez por mudança de período (sem relógio). As aparições vêm do resumo por cidade e por dia que o banco monta a cada
// sincronização do Search Console (site_buscas_cidades), não das linhas de cada busca.

const PERIODOS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias']]
const ORDENS = [['recentes', 'Mais recentes no ar'], ['aparicoes', 'Mais aparições no Google'], ['google', 'Mais visitas do Google'], ['nome', 'A a Z']]
const memoria = { dias: 30, regiao: '', ordem: 'recentes', resultado: null }

const DIA = 86400e3
const dataDe = (iso) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00Z') : null)
const diaBonito = (iso) => { const d = dataDe(iso); return d ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}` : '' }
const diasEntre = (a, b) => (a && b ? Math.round((dataDe(b) - dataDe(a)) / DIA) : null)
const emDias = (n) => (n === 0 ? 'no mesmo dia' : n === 1 ? '1 dia' : `${formatar(n)} dias`)
const mediana = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) }

// a fase de uma cidade no Google: esperando (no ar e ainda sem aparecer), aparece (já aparece nas buscas) ou traz visitas
function faseDe(c) {
  if (c.primeira_visita_google) return 'visitas'
  if (c.primeira_aparicao) return 'aparece'
  return 'esperando'
}
const FASES = {
  esperando: { rotulo: 'Esperando o Google', tom: '' },
  aparece: { rotulo: 'Aparece no Google', tom: 'contato' },
  visitas: { rotulo: 'Traz visitas do Google', tom: 'forte' },
}

export default function CidadesSite() {
  const [dias, setDias] = useState(memoria.dias)
  const [regiao, setRegiao] = useState(memoria.regiao)
  const [ordem, setOrdem] = useState(memoria.ordem)
  const [resultado, setResultado] = useState(memoria.resultado) // { dias, dados }
  const [erro, setErro] = useState('')
  const [aberta, setAberta] = useState(null)
  useEffect(() => { Object.assign(memoria, { dias, regiao, ordem }) }, [dias, regiao, ordem])

  useEffect(() => {
    let vivo = true
    supabase.rpc('site_cidades', { dias_: dias }).then(({ data, error }) => {
      if (!vivo) return
      if (error) { setErro(faltaMigracao(error) ? 'sem_260' : error.message || 'não deu para ler as cidades'); return }
      setErro('')
      const r = { dias, dados: data }
      memoria.resultado = r
      setResultado(r)
    }, (e) => { if (vivo) setErro(e?.message ?? 'não deu para ler as cidades') })
    return () => { vivo = false }
  }, [dias])

  const dados = resultado?.dados
  const carregando = !resultado || resultado.dias !== dias
  const todas = useMemo(() => (Array.isArray(dados?.cidades) ? dados.cidades : []), [dados])
  const regioes = useMemo(() => {
    const m = new Map()
    for (const c of todas) if (c.regiao?.slug && !m.has(c.regiao.slug)) m.set(c.regiao.slug, c.regiao.nome)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  }, [todas])
  const cidades = useMemo(() => {
    const lista = todas.filter((c) => !regiao || (regiao === 'sem' ? !c.regiao : c.regiao?.slug === regiao))
    const por = {
      recentes: (a, b) => String(b.no_ar_desde ?? '').localeCompare(String(a.no_ar_desde ?? '')) || a.cidade.localeCompare(b.cidade, 'pt-BR'),
      aparicoes: (a, b) => n0(b.aparicoes) - n0(a.aparicoes) || a.cidade.localeCompare(b.cidade, 'pt-BR'),
      google: (a, b) => n0(b.visitas_google) - n0(a.visitas_google) || n0(b.visitas) - n0(a.visitas),
      nome: (a, b) => a.cidade.localeCompare(b.cidade, 'pt-BR'),
    }[ordem]
    return [...lista].sort(por)
  }, [todas, regiao, ordem])

  if (erro === 'sem_260') return <Vazio>As cidades do site precisam da migração 260: rode o bat B e depois o bat 2.</Vazio>

  const gsc = dados?.gsc ?? {}
  const hoje = dados?.ate
  // os números do topo, sobre as cidades da região escolhida
  const aparecem = cidades.filter((c) => c.primeira_aparicao)
  const esperando = cidades.filter((c) => !c.primeira_aparicao)
  // o tempo até aparecer só vale para quem foi ao ar com o Search Console já guardando (senão a 1ª aparição é o começo dos dados)
  const medidas = aparecem.filter((c) => gsc.primeiro_dia && c.no_ar_desde && String(c.no_ar_desde).slice(0, 10) > gsc.primeiro_dia).map((c) => Math.max(0, diasEntre(c.no_ar_desde, c.primeira_aparicao)))
  const esperaHoje = esperando.map((c) => diasEntre(c.no_ar_desde, hoje)).filter((x) => x != null)
  const soma = (k) => cidades.reduce((s, c) => s + n0(c[k]), 0)

  return (
    <div className="pv-hist pv-cid" data-teste="cidades-site">
      <section className="pv-hist-controles">
        <div className="pv-hist-periodo">
          <CalendarRange size={15} aria-hidden="true" />
          <div className="pv-periodo" role="group" aria-label="Período">
            {PERIODOS.map(([d, texto]) => <button key={d} type="button" className={d === dias ? 'on' : ''} aria-pressed={d === dias} onClick={() => setDias(d)} data-teste={`cid-periodo-${d}`}>{texto}</button>)}
          </div>
          {dados && <small>{diaBonito(dados.de)} a {diaBonito(dados.ate)}{carregando && <> · <LoaderCircle className="pg-gira" size={12} aria-label="lendo" /></>}</small>}
        </div>
        <div className="pv-hist-filtros">
          <select className="plat-select" value={regiao} onChange={(e) => setRegiao(e.target.value)} aria-label="Região" data-teste="cid-regiao">
            <option value="">Todas as regiões</option>
            {regioes.map(([slug, nome]) => <option key={slug} value={slug}>{nome}</option>)}
            {todas.some((c) => !c.regiao) && <option value="sem">Sem região</option>}
          </select>
          <select className="plat-select" value={ordem} onChange={(e) => setOrdem(e.target.value)} aria-label="Ordem" data-teste="cid-ordem">
            {ORDENS.map(([id, texto]) => <option key={id} value={id}>{texto}</option>)}
          </select>
        </div>
      </section>

      {erro && <div className="alert alert-error">{erro}</div>}
      {!dados ? (
        <div className="pg-carregando">{erro ? '' : <><LoaderCircle className="pg-gira" size={18} /> Lendo as cidades…</>}</div>
      ) : (
        <>
          <section className="pv-hist-kpis" data-teste="cid-kpis" aria-busy={carregando}>
            <Kpi Icon={MapPinned} n={cidades.length} rotulo={cidades.length === 1 ? 'cidade no ar' : 'cidades no ar'} sub={`${formatar(soma('no_ar'))} salões no ar`} />
            <Kpi Icon={Search} n={aparecem.length} rotulo="já aparecem no Google" sub={cidades.length ? `${Math.round((aparecem.length / cidades.length) * 100)}% das cidades` : ''} tom="contato" teste="cid-kpi-aparecem" />
            <Kpi Icon={Hourglass} n={esperando.length} rotulo="esperando o Google" sub={esperaHoje.length ? `no ar há ${emDias(mediana(esperaHoje))}, na mediana` : 'nenhuma'} teste="cid-kpi-esperando" />
            <Kpi Icon={Timer} n={medidas.length ? emDias(mediana(medidas)) : '—'} rotulo="até aparecer no Google" sub={medidas.length ? `mediana de ${formatar(medidas.length)} ${medidas.length === 1 ? 'cidade' : 'cidades'}` : 'falta cidade nova já medida'} tom="volta" teste="cid-kpi-tempo" />
            <Kpi Icon={Search} n={soma('aparicoes')} rotulo="aparições no Google" sub={`${formatar(soma('cliques'))} cliques no período`} />
            <Kpi Icon={MousePointerClick} n={soma('visitas_google')} rotulo="visitas pelo Google" sub={`de ${formatar(soma('visitas'))} visitas no período`} tom="forte" />
          </section>

          <p className="pv-cid-nota" data-teste="cid-nota">
            <Info size={13} aria-hidden="true" />
            <span>{gsc.ultimo_dia
              ? <>O Search Console chega com 2 a 3 dias de atraso: o último dia com dados é <b>{diaBonito(gsc.ultimo_dia)}</b>. As visitas pelo Google são as do próprio site, na hora.</>
              : <>Ainda não há dados do Search Console guardados (Desempenho › Buscas do Google). Até lá, a fase sai só das visitas pelo Google.</>}</span>
          </p>

          <Painel Icon={MapPinned} titulo="As cidades" sub="Toque numa cidade para ver o dia a dia. A barra clara é quantas vezes ela apareceu nas buscas do Google; a escura, as visitas que vieram do Google; a linha marca o dia em que foi ao ar." className="pv-lista-painel">
            {cidades.length === 0 ? <Vazio>Nenhuma cidade no ar{regiao ? ' nesta região' : ''}.</Vazio> : (
              <ul className="pv-cid-lista" data-teste="cid-lista">
                {cidades.map((c) => <Cidade key={c.cidade_slug} c={c} dados={dados} aberta={aberta === c.cidade_slug} onAbrir={() => setAberta((x) => (x === c.cidade_slug ? null : c.cidade_slug))} />)}
              </ul>
            )}
          </Painel>
        </>
      )}
    </div>
  )
}

function Cidade({ c, dados, aberta, onAbrir }) {
  const fase = faseDe(c)
  const f = FASES[fase]
  const noAr = diasEntre(c.no_ar_desde, dados.ate)
  const ateAparecer = c.primeira_aparicao ? Math.max(0, diasEntre(c.no_ar_desde, c.primeira_aparicao)) : null
  const ateVisita = c.primeira_visita_google ? Math.max(0, diasEntre(c.no_ar_desde, c.primeira_visita_google)) : null
  const desdeOComeco = c.primeira_aparicao && dados.gsc?.primeiro_dia && String(c.no_ar_desde ?? '').slice(0, 10) <= dados.gsc.primeiro_dia
  const frase = fase === 'esperando'
    ? `no ar há ${emDias(noAr)}, ainda sem aparecer`
    : fase === 'aparece'
      ? (desdeOComeco ? `aparece desde ${diaBonito(c.primeira_aparicao)} (desde o começo dos dados)` : `aparece desde ${diaBonito(c.primeira_aparicao)} · ${emDias(ateAparecer)} depois de ir ao ar`)
      : `1ª visita pelo Google em ${diaBonito(c.primeira_visita_google)} · ${emDias(ateVisita)} depois de ir ao ar`
  return (
    <li className={'pv-cid' + (aberta ? ' aberta' : '')} data-fase={fase} data-teste={`cid-${c.cidade_slug}`}>
      <button type="button" className="pv-cid-linha" onClick={onAbrir} aria-expanded={aberta}>
        <span className="pv-cid-nome">
          <span className="pv-cid-titulo"><b>{c.cidade}</b>{c.uf && <small> · {c.uf}</small>}</span>
          <small className="pv-cid-sub">{c.regiao?.nome ? `${c.regiao.nome} · ` : ''}no ar desde {diaBonito(c.no_ar_desde)} · {formatar(c.no_ar)} {n0(c.no_ar) === 1 ? 'salão' : 'salões'}</small>
        </span>
        <span className="pv-cid-fase"><span className="pv-chip" data-tom={f.tom}>{f.rotulo}</span><small>{frase}</small></span>
        <Serie c={c} dados={dados} />
        <span className="pv-cid-nums">
          <span><b>{formatar(c.aparicoes)}</b><small>aparições</small></span>
          <span><b>{formatar(c.cliques)}</b><small>cliques</small></span>
          <span className="pv-cid-google"><b>{formatar(c.visitas_google)}</b><small>do Google · {formatar(c.visitas)} visitas</small></span>
        </span>
        <ChevronDown size={16} className="pv-cid-seta" aria-hidden="true" />
      </button>
      {aberta && <Detalhe c={c} dados={dados} ateAparecer={ateAparecer} ateVisita={ateVisita} desdeOComeco={desdeOComeco} />}
    </li>
  )
}

// as barras do período: clara = aparições no Google; escura = visitas que vieram do Google; a linha = o dia em que foi ao ar
function Serie({ c, dados, grande = false }) {
  const ap = Array.isArray(c.serie?.ap) ? c.serie.ap : []
  const go = Array.isArray(c.serie?.go) ? c.serie.go : []
  const n = Math.max(ap.length, go.length)
  if (!n) return <span className="pv-cid-serie" />
  const maxAp = Math.max(1, ...ap.map(n0))
  const maxGo = Math.max(1, ...go.map(n0))
  const de = dataDe(dados.de)
  const noArIdx = c.no_ar_desde ? Math.round((dataDe(c.no_ar_desde) - de) / DIA) : -1
  const rotulo = `${formatar(c.aparicoes)} aparições e ${formatar(c.visitas_google)} visitas pelo Google em ${n} dias`
  return (
    <span className={'pv-cid-serie' + (grande ? ' grande' : '')} role="img" aria-label={rotulo}>
      {Array.from({ length: n }, (_, i) => {
        const dia = new Date(de.getTime() + i * DIA).toISOString().slice(0, 10)
        return (
          <i key={i} className={i === noArIdx ? 'ao-ar' : ''} title={`${diaBonito(dia)}: ${formatar(n0(ap[i]))} aparições · ${formatar(n0(go[i]))} visitas pelo Google${i === noArIdx ? ' · foi ao ar' : ''}`}>
            <em className="ap" style={{ height: n0(ap[i]) ? `max(2px, ${(n0(ap[i]) / maxAp) * 100}%)` : 0 }} />
            <em className="go" style={{ height: n0(go[i]) ? `max(2px, ${(n0(go[i]) / maxGo) * 70}%)` : 0 }} />
          </i>
        )
      })}
    </span>
  )
}

function Detalhe({ c, dados, ateAparecer, ateVisita, desdeOComeco }) {
  const marcos = [
    ['Foi ao ar', c.no_ar_desde, 'o primeiro salão publicado'],
    ['Último salão publicado', c.ultimo_publicado, null],
    ['1ª aparição no Google', c.primeira_aparicao, c.primeira_aparicao ? (desdeOComeco ? 'desde o começo dos dados do Search Console' : `${emDias(ateAparecer)} depois de ir ao ar`) : 'ainda não'],
    ['1º clique no Google', c.primeiro_clique, c.primeiro_clique ? null : 'ainda não'],
    ['1ª visita pelo Google', c.primeira_visita_google, c.primeira_visita_google ? `${emDias(ateVisita)} depois de ir ao ar` : 'ainda não'],
  ]
  return (
    <div className="pv-cid-detalhe">
      <Serie c={c} dados={dados} grande />
      <div className="pv-cid-eixo"><small>{diaBonito(dados.de)}</small><small>{diaBonito(dados.ate)}</small></div>
      <p className="pv-cid-legenda"><i className="ap" aria-hidden="true" /> aparições no Google <i className="go" aria-hidden="true" /> visitas pelo Google <i className="ar" aria-hidden="true" /> foi ao ar</p>
      <ul className="pv-cid-marcos">
        {marcos.map(([titulo, quando, sub]) => (
          <li key={titulo} className={quando ? '' : 'falta'}><span>{titulo}</span><b>{quando ? diaBonito(quando) : '—'}</b>{sub && <small>{sub}</small>}</li>
        ))}
      </ul>
      <a className="plat-link" href={`/saloes/${c.cidade_slug}`} target="_blank" rel="noreferrer">Abrir a página da cidade</a>
    </div>
  )
}
