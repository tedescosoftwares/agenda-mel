import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { formatar, n0, taxa, taxaTexto } from '../../../lib/guiaMetricas'
import { Painel, Vazio } from '../Pecas'
import { Barras } from './desempenho/Barras'
import { ORIGEM, APARELHO, acaoDe, desfechoDe, Provavel, faltaMigracao, duracao, Visitante } from './AoVivoPecas'
import { CalendarRange, LoaderCircle, Users, Sparkles, Repeat, MousePointerClick, Clock, LogIn, Search, CircleCheck, Eye, X } from 'lucide-react'

// O histórico do site (3.62, migração 209): as visitas de um período de até 90 dias (hoje, 5, 7, 10, 15, 30, 90 dias ou
// duas datas), com filtros (primeira vez ou voltou, só quem tocou em contato, origem, aparelho, cidade, página), o resumo
// (visitas, pessoas, novas e recorrentes, contato, prováveis agendamentos, tempo médio, por dia, por hora, por dia da
// semana, origens, aparelhos, navegadores, cidades, entradas, páginas mais vistas, toques, salões, desfechos, saídas sem
// contatar) e a lista das visitas em páginas de 50, cada uma com o dia, a hora de entrada e de saída, há quanto tempo foi,
// quanto ficou, o trajeto, as ações e o desfecho. Lê site_visitas() uma vez por mudança de período ou filtro (sem relógio).

const PRESETS = [['hoje', 'Hoje', 0], ['5', '5 dias', 4], ['7', '7 dias', 6], ['10', '10 dias', 9], ['15', '15 dias', 14], ['30', '30 dias', 29], ['90', '90 dias', 89], ['datas', 'Datas', null]]
const POR_PAGINA = 50
const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const FORTES = ['saiu_whatsapp', 'saiu_ligar', 'saiu_mapa', 'saiu_agendar_mimo', 'saiu_pedido_enviado']
// hoje em Brasília, como "AAAA-MM-DD" (o banco conta os dias no mesmo fuso)
const hojeBr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const diasAntes = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
const diaBonito = (iso) => { const d = new Date(iso + 'T12:00:00Z'); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
const diaSemanaDe = (iso) => DIA_SEMANA[new Date(iso + 'T12:00:00Z').getUTCDay()]
const virgula = (x) => String(x).replace('.', ',')
// lembrado ao trocar de aba
const memoria = { preset: '7', de: null, ate: null, rec: 'todas', contato: false, origem: '', dispositivo: '', cidade: '', busca: '', resultado: null, lista: [] }

export default function HistoricoSite() {
  const hoje = hojeBr()
  const [preset, setPreset] = useState(memoria.preset)
  const [deDatas, setDeDatas] = useState(memoria.de ?? diasAntes(hoje, 6))
  const [ateDatas, setAteDatas] = useState(memoria.ate ?? hoje)
  const [rec, setRec] = useState(memoria.rec)
  const [contato, setContato] = useState(memoria.contato)
  const [origem, setOrigem] = useState(memoria.origem)
  const [dispositivo, setDispositivo] = useState(memoria.dispositivo)
  const [cidade, setCidade] = useState(memoria.cidade)
  const [busca, setBusca] = useState(memoria.busca)
  const [buscaLenta, setBuscaLenta] = useState(memoria.busca.trim())
  const [resultado, setResultado] = useState(memoria.resultado) // { params, dados }
  const [lista, setLista] = useState(memoria.lista)
  const [mais, setMais] = useState(false)
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState(null)
  const [opcoes, setOpcoes] = useState({ origens: [], dispositivos: [], cidades: [] }) // as opções dos filtros: as do período, sem filtro
  useEffect(() => { const t = setTimeout(() => setBuscaLenta(busca.trim()), 350); return () => clearTimeout(t) }, [busca])
  useEffect(() => { Object.assign(memoria, { preset, de: deDatas, ate: ateDatas, rec, contato, origem, dispositivo, cidade, busca }) }, [preset, deDatas, ateDatas, rec, contato, origem, dispositivo, cidade, busca])

  const { de, ate } = useMemo(() => {
    const p = PRESETS.find((x) => x[0] === preset)
    if (!p || p[2] == null) { const a = ateDatas && ateDatas <= hoje ? ateDatas : hoje; const d = deDatas && deDatas <= a ? deDatas : a; return { de: d < diasAntes(a, 89) ? diasAntes(a, 89) : d, ate: a } }
    return { de: diasAntes(hoje, p[2]), ate: hoje }
  }, [preset, deDatas, ateDatas, hoje])
  const params = useMemo(() => ({ de_: de, ate_: ate, recorrencia_: rec, so_contato_: contato, origem_: origem || null, dispositivo_: dispositivo || null, cidade_: cidade || null, pagina_: buscaLenta || null }),
    [de, ate, rec, contato, origem, dispositivo, cidade, buscaLenta])

  useEffect(() => {
    let vivo = true
    supabase.rpc('site_visitas', { ...params, limite_: POR_PAGINA, pular_: 0 }).then(({ data, error }) => {
      if (!vivo) return
      if (error) { setErro(faltaMigracao(error) ? 'sem_209' : error.message || 'não deu para ler o histórico'); return }
      setErro('')
      const visitas = Array.isArray(data?.visitas) ? data.visitas : []
      setResultado({ params, dados: data }); setLista(visitas); setAberto(null)
      memoria.resultado = { params, dados: data }; memoria.lista = visitas
      const semFiltro = params.recorrencia_ === 'todas' && !params.so_contato_ && !params.origem_ && !params.dispositivo_ && !params.cidade_ && !params.pagina_
      if (semFiltro && data?.resumo) setOpcoes({ origens: data.resumo.origens ?? [], dispositivos: data.resumo.dispositivos ?? [], cidades: data.resumo.cidades ?? [] })
    })
    return () => { vivo = false }
  }, [params])

  async function maisVisitas() {
    setMais(true)
    const { data, error } = await supabase.rpc('site_visitas', { ...params, limite_: POR_PAGINA, pular_: lista.length, so_lista_: true })
    setMais(false)
    if (!error && Array.isArray(data?.visitas)) setLista((l) => { const n = [...l, ...data.visitas]; memoria.lista = n; return n })
  }

  if (erro === 'sem_209') return <Vazio>O histórico do site precisa da migração 209: rode o bat B e depois o bat 2.</Vazio>
  const dados = resultado?.dados
  const carregando = !resultado || resultado.params !== params
  const resumo = dados?.resumo
  const ndias = Math.round((new Date(ate + 'T12:00:00Z') - new Date(de + 'T12:00:00Z')) / 86400e3) + 1
  const barras = (lista, chave, rotulo) => (lista ?? []).map((x) => ({ chave: String(x[chave]), n: x.n, rotulo: rotulo(x) }))
  const temFiltro = rec !== 'todas' || contato || origem || dispositivo || cidade || buscaLenta

  return (
    <div className="pv-hist" data-teste="hist">
      <section className="pv-hist-controles">
        <div className="pv-hist-periodo">
          <CalendarRange size={15} aria-hidden="true" />
          <div className="pv-periodo" role="group" aria-label="Período">
            {PRESETS.map(([id, texto]) => <button key={id} type="button" className={id === preset ? 'on' : ''} aria-pressed={id === preset} onClick={() => setPreset(id)} data-teste={`hist-periodo-${id}`}>{texto}</button>)}
          </div>
          {preset === 'datas' && (
            <span className="pv-hist-datas">
              <input type="date" value={deDatas} max={hoje} onChange={(e) => setDeDatas(e.target.value)} aria-label="De" data-teste="hist-de" />
              até
              <input type="date" value={ateDatas} max={hoje} onChange={(e) => setAteDatas(e.target.value)} aria-label="Até" data-teste="hist-ate" />
            </span>
          )}
          <small data-teste="hist-intervalo">{de === ate ? `${diaSemanaDe(de)} ${diaBonito(de)}` : `${diaBonito(de)} a ${diaBonito(ate)} · ${ndias} dias`}{carregando && <> · <LoaderCircle className="pg-gira" size={12} aria-label="lendo" /></>}</small>
        </div>
        <div className="pv-hist-filtros">
          <div className="pv-periodo" role="group" aria-label="Primeira vez ou voltou">
            {[['todas', 'Todas'], ['primeira', '1ª vez'], ['recorrente', 'Voltaram']].map(([id, texto]) => <button key={id} type="button" className={id === rec ? 'on' : ''} aria-pressed={id === rec} onClick={() => setRec(id)} data-teste={`hist-rec-${id}`}>{texto}</button>)}
          </div>
          <button type="button" className={'pv-hist-toggle' + (contato ? ' on' : '')} aria-pressed={contato} onClick={() => setContato((x) => !x)} data-teste="hist-contato"><MousePointerClick size={13} aria-hidden="true" /> Só quem tocou em contato</button>
          <select className="plat-select" value={origem} onChange={(e) => setOrigem(e.target.value)} aria-label="Origem" data-teste="hist-origem">
            <option value="">Toda origem</option>
            {opcoes.origens.map((o) => <option key={o.origem} value={o.origem}>{ORIGEM[o.origem] ?? o.origem} ({formatar(o.n)})</option>)}
          </select>
          <select className="plat-select" value={dispositivo} onChange={(e) => setDispositivo(e.target.value)} aria-label="Aparelho" data-teste="hist-aparelho">
            <option value="">Todo aparelho</option>
            {opcoes.dispositivos.map((o) => <option key={o.dispositivo} value={o.dispositivo}>{APARELHO[o.dispositivo] ?? o.dispositivo} ({formatar(o.n)})</option>)}
          </select>
          <select className="plat-select" value={cidade} onChange={(e) => setCidade(e.target.value)} aria-label="Cidade" data-teste="hist-cidade">
            <option value="">Toda cidade</option>
            {opcoes.cidades.map((c) => <option key={`${c.cidade}|${c.uf}`} value={c.cidade}>{c.cidade}, {c.uf} ({formatar(c.n)})</option>)}
          </select>
          <label className="pv-hist-busca"><Search size={13} aria-hidden="true" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Página ou título" aria-label="Buscar por página ou título" data-teste="hist-busca" />{busca && <button type="button" onClick={() => setBusca('')} aria-label="Limpar a busca"><X size={12} /></button>}</label>
          {temFiltro && <button type="button" className="plat-link" onClick={() => { setRec('todas'); setContato(false); setOrigem(''); setDispositivo(''); setCidade(''); setBusca('') }} data-teste="hist-limpar">Limpar filtros</button>}
        </div>
      </section>

      {erro && <div className="alert alert-error">{erro}</div>}
      {!dados ? (
        <div className="pg-carregando">{erro ? '' : <><LoaderCircle className="pg-gira" size={18} /> Lendo o histórico…</>}</div>
      ) : resumo && (
        <>
          <section className="pv-hist-kpis" data-teste="hist-kpis" aria-busy={carregando}>
            <Kpi Icon={Eye} n={resumo.visitas} rotulo="visitas" sub={`${formatar(resumo.paginas)} páginas vistas`} teste="hist-kpi-visitas" />
            <Kpi Icon={Users} n={resumo.pessoas} rotulo="pessoas diferentes" sub={n0(resumo.sem_pessoa) ? `+ ${formatar(resumo.sem_pessoa)} ${n0(resumo.sem_pessoa) === 1 ? 'visita' : 'visitas'} sem como saber` : 'pela conexão e o navegador'} />
            <Kpi Icon={Sparkles} n={resumo.primeira} rotulo="primeira vez" sub={`${taxaTexto(taxa(resumo.primeira, resumo.visitas))} das visitas`} tom="nova" teste="hist-kpi-primeira" />
            <Kpi Icon={Repeat} n={resumo.recorrente} rotulo="voltaram" sub={resumo.volta_media_dias != null ? `voltam a cada ${virgula(resumo.volta_media_dias)} dias, em média` : `${taxaTexto(taxa(resumo.recorrente, resumo.visitas))} das visitas`} tom="volta" teste="hist-kpi-recorrente" />
            <Kpi Icon={MousePointerClick} n={resumo.com_contato} rotulo="tocaram em contato" sub={`${taxaTexto(taxa(resumo.com_contato, resumo.visitas))} das visitas`} tom="contato" />
            <Kpi Icon={CircleCheck} n={resumo.provaveis} rotulo="prováveis agendamentos" sub="saíram num contato com o salão" tom="forte" />
            <Kpi Icon={Clock} n={duracao(resumo.tempo_medio_s)} rotulo="tempo médio" sub={`${virgula((n0(resumo.paginas) / Math.max(1, n0(resumo.visitas))).toFixed(1))} páginas por visita`} />
          </section>

          <Painel Icon={CalendarRange} titulo="Visitas por dia" sub="A barra inteira é o total do dia e a parte escura, quem tocou em contato. Passe o mouse para ver novas e recorrentes.">
            <PorDia dias={resumo.por_dia} />
          </Painel>

          <div className="pv-hoje-grade pv-hist-grade" data-teste="hist-quadros">
            <div><h4>De onde vieram</h4><Barras itens={barras(resumo.origens, 'origem', (x) => ORIGEM[x.origem] ?? x.origem)} total={n0(resumo.visitas)} /></div>
            <div><h4>Aparelhos</h4><Barras itens={barras(resumo.dispositivos, 'dispositivo', (x) => APARELHO[x.dispositivo] ?? x.dispositivo)} total={n0(resumo.visitas)} /></div>
            <div><h4>Navegadores</h4><Barras itens={barras(resumo.navegadores, 'navegador', (x) => x.navegador)} total={n0(resumo.visitas)} /></div>
            <div><h4>Cidades</h4><Barras itens={(resumo.cidades ?? []).map((c) => ({ chave: `${c.cidade}|${c.uf}`, n: c.n, rotulo: `${c.cidade}, ${c.uf}${n0(c.gps) ? ` · ${c.gps} por GPS` : ''}` }))} total={n0(resumo.visitas)} vazio="Sem cidade conhecida." /></div>
            <div><h4>Páginas de entrada</h4><Barras itens={(resumo.entradas ?? []).map((p) => ({ chave: p.pagina, n: p.n, rotulo: p.titulo || p.pagina }))} total={n0(resumo.visitas)} /></div>
            <div><h4>Páginas mais vistas</h4><Barras itens={barras(resumo.paginas_vistas, 'pagina', (x) => x.pagina)} total={n0(resumo.paginas)} /></div>
            <div><h4>Toques</h4><Barras cor="contato" itens={(resumo.acoes ?? []).map((a) => { const x = acaoDe(a); return { chave: a.tipo, n: a.n, rotulo: x.rotulo, Icon: x.Icon } })} total={n0(resumo.visitas)} vazio="Ninguém tocou em nada." /></div>
            <div><h4>Salões mais contatados</h4><Barras cor="pedido" itens={(resumo.saloes ?? []).map((l) => ({ chave: l.lugar, n: l.n, rotulo: `${l.lugar}${n0(l.whatsapp) ? ` · ${formatar(l.whatsapp)} no WhatsApp` : ''}${n0(l.pedidos) ? ` · ${formatar(l.pedidos)} ${n0(l.pedidos) === 1 ? 'pedido' : 'pedidos'}` : ''}` }))} total={(resumo.saloes ?? []).reduce((s, l) => s + n0(l.n), 0)} vazio="Nenhum salão contatado." /></div>
            <div><h4>Como as visitas terminaram</h4><Barras cor="contato" itens={(resumo.desfechos ?? []).map((d) => { const x = desfechoDe(d.desfecho); return { chave: d.desfecho, n: d.n, rotulo: x?.texto ?? d.desfecho, Icon: x?.provavel ? Provavel : x?.Icon } })} total={n0(resumo.terminadas)} vazio="Nenhuma visita terminou." />{FORTES.some((f) => (resumo.desfechos ?? []).some((d) => d.desfecho === f)) && <p className="pv-legenda"><CircleCheck size={13} color="#0b7a50" aria-hidden="true" /> saiu logo depois de tocar: provável agendamento (ou ida ao salão, no Como chegar)</p>}</div>
            <div><h4>Onde saem sem contatar</h4><Barras itens={(resumo.saidas_sem_contato ?? []).map((p) => ({ chave: p.pagina, n: p.n, rotulo: p.titulo || p.pagina }))} total={n0((resumo.desfechos ?? []).find((d) => d.desfecho === 'sem_contato')?.n)} vazio="Ninguém saiu sem contatar." /></div>
            <div><h4>Por hora do dia</h4><Horas lista={resumo.por_hora} /></div>
            <div><h4>Por dia da semana</h4><Barras itens={(resumo.por_dia_semana ?? []).map((d) => ({ chave: String(d.d), n: d.n, rotulo: DIA_SEMANA[d.d] }))} total={n0(resumo.visitas)} /></div>
          </div>
        </>
      )}

      {dados && (
        <Painel Icon={LogIn} titulo="As visitas" sub={`${formatar(dados.total)} ${n0(dados.total) === 1 ? 'visita' : 'visitas'}${temFiltro ? ' com esses filtros' : ''}, da mais recente à mais antiga. Toque para ver o caminho que fez.`} className="pv-lista-painel">
          {lista.length === 0 ? (
            <Vazio>Nenhuma visita neste período{temFiltro ? ' com esses filtros' : ''}.</Vazio>
          ) : (
            <>
              <ul className="pv-lista pv-lista-hist" data-teste="hist-lista">
                {lista.map((v) => <Visitante key={v.id} v={v} agora={dados.agora} saiu={v.terminou !== false} historico aberto={aberto === v.id} onAbrir={() => setAberto((x) => (x === v.id ? null : v.id))} />)}
              </ul>
              {lista.length < n0(dados.total) && <button type="button" className="btn btn-ghost pv-hist-mais" onClick={maisVisitas} disabled={mais} data-teste="hist-mais">{mais ? 'Carregando…' : `Mostrar mais (${formatar(n0(dados.total) - lista.length)} ${n0(dados.total) - lista.length === 1 ? 'restante' : 'restantes'})`}</button>}
            </>
          )}
        </Painel>
      )}

      <p className="pv-nota muted" data-teste="hist-nota">
        "1ª vez" e "voltou" vêm de um código fixo da conexão e do navegador, sem guardar o IP e sem nada no aparelho da pessoa; é aproximado: no celular fora do Wi-Fi a conexão muda, e a mesma pessoa pode aparecer como nova. As visitas ficam 90 dias; as de antes da migração 209 aparecem sem essa marca.
      </p>
    </div>
  )
}

function Kpi({ Icon, n, rotulo, sub, tom, teste }) {
  return (
    <div className="pv-kpi" data-tom={tom} data-teste={teste}>
      <span className="pv-kpi-icone"><Icon size={15} aria-hidden="true" /></span>
      <b>{typeof n === 'number' || typeof n === 'string' && /^\d/.test(n) && !/\s/.test(n) ? formatar(n) : n}</b>
      <span>{rotulo}</span>
      <small>{sub}</small>
    </div>
  )
}

// as visitas de cada dia do período: a barra é o total e a parte escura, quem tocou em contato
function PorDia({ dias }) {
  const lista = Array.isArray(dias) ? dias : []
  if (!lista.length) return <Vazio>Sem dias no período.</Vazio>
  const max = Math.max(1, ...lista.map((d) => n0(d.n)))
  const passo = lista.length > 45 ? 7 : lista.length > 20 ? 3 : lista.length > 10 ? 2 : 1
  return (
    <div className="pv-dias" role="img" aria-label="Visitas por dia" data-teste="hist-dias">
      {lista.map((d, i) => (
        <span key={d.dia} title={`${diaSemanaDe(d.dia)} ${diaBonito(d.dia)}: ${formatar(d.n)} ${n0(d.n) === 1 ? 'visita' : 'visitas'} · ${formatar(d.primeira)} novas · ${formatar(d.recorrente)} voltaram · ${formatar(d.contato)} com contato`} data-teste="hist-dia">
          <i style={{ height: `${Math.max(n0(d.n) ? 4 : 1, (n0(d.n) / max) * 100)}%` }}><em style={{ height: `${n0(d.n) ? (n0(d.contato) / n0(d.n)) * 100 : 0}%` }} /></i>
          <small>{i % passo === 0 && (lista.length - 1 - i >= passo / 2 || i === lista.length - 1) ? diaBonito(d.dia) : i === lista.length - 1 ? diaBonito(d.dia) : ''}</small>
        </span>
      ))}
    </div>
  )
}

function Horas({ lista }) {
  const h = Array.isArray(lista) ? lista : []
  const max = Math.max(1, ...h.map((x) => n0(x.n)))
  return (
    <div className="pv-horas" role="img" aria-label="Visitas por hora do dia">
      {h.map((x) => <span key={x.h} title={`${x.h}h: ${formatar(x.n)} visitas`}><i style={{ height: `${Math.max(n0(x.n) ? 6 : 1, (n0(x.n) / max) * 100)}%` }} /><small>{x.h % 3 === 0 ? `${x.h}h` : ''}</small></span>)}
    </div>
  )
}
