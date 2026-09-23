import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Receipt, Ban, Clock, UserRound, Sparkles, GripVertical, ChevronLeft, ChevronRight, Star, History, Plus, Heart, AlertTriangle, ZoomIn, ZoomOut } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useDialogo } from '../context/DialogoContext'
import { formatCents } from '../lib/pagamento'
import { agruparPorCategoria, bate } from '../lib/categorias'
import Avatar from './Avatar'

// O quadro do dia (103): uma coluna por profissional, as horas descendo,
// cada horário é um cartão que se arrasta para outra hora ou outra
// coluna (remarca pela casa e avisa a cliente). Clique num espaço vazio
// abre o modal de serviços para encaixar; clique num cartão abre o
// horário, com "abrir comanda" e "cancelar".
// 90px por hora é o nível de sempre. A lupa do tempo: Ctrl + rodinha (ou os botões) troca a escala; cada nível
// diz quantos px tem um minuto, de quanto em quanto vai a grade e o rótulo
const ZOOMS = [
  { escala: 0.8, grade: 60, rotulo: 60, nome: '1 h' },
  { escala: 1.5, grade: 30, rotulo: 60, nome: '30 min' },
  { escala: 2.6, grade: 15, rotulo: 30, nome: '15 min' },
  { escala: 4.2, grade: 15, rotulo: 15, nome: '15 min · lupa' },
]
const ZOOM_PADRAO = 1
const lerZoom = () => { try { const z = Number(localStorage.getItem('mimo-quadro-zoom')); return Number.isInteger(z) && z >= 0 && z < ZOOMS.length ? z : ZOOM_PADRAO } catch { return ZOOM_PADRAO } }
const PASSO = 15                // arrasto e cliques caem em múltiplos de 15 min
const min = (t) => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m }
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const isoHoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const somar = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const semanaDe = (iso) => { const d = new Date(iso + 'T12:00:00'); const seg = somar(iso, -((d.getDay() + 6) % 7)); return Array.from({ length: 7 }, (_, i) => somar(seg, i)) }
const rotuloDia = (iso) => { const d = new Date(iso + 'T12:00:00'); const t = `${DIAS_CURTOS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`; return t.charAt(0).toUpperCase() + t.slice(1) }

export default function QuadroDoDia({ dia, agenda, semana = [], onTrocarDia, profs, horas, servicos, cats, clientes, salaoId, onAbrirComanda, onMudou }) {
  const { confirmar } = useDialogo()
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 60000); return () => clearInterval(t) }, [])
  const [arrastando, setArrastando] = useState(null)      // id do cartão no ar
  const [sombra, setSombra] = useState(null)              // { prof, inicio } enquanto arrasta
  const [novo, setNovo] = useState(null)                  // { prof, inicio } → modal de encaixe
  const [aberto, setAberto] = useState(null)              // cartão clicado
  const [adicionarEm, setAdicionarEm] = useState(null)    // horário que vai ganhar mais um serviço
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const weekday = new Date(dia + 'T12:00:00').getDay()
  const [ini, fim] = useMemo(() => {
    const abertos = (horas ?? []).filter((h) => h.open && (h.weekday == null || h.weekday === weekday))
    const a = abertos.length ? Math.min(...abertos.map((h) => min(h.start_time))) : 8 * 60
    const b = abertos.length ? Math.max(...abertos.map((h) => min(h.end_time))) : 20 * 60
    const extra = (agenda ?? []).reduce((acc, x) => [Math.min(acc[0], min(x.start_time)), Math.max(acc[1], min(x.end_time))], [a, b])
    return [Math.floor(extra[0] / 60) * 60, Math.ceil(extra[1] / 60) * 60]
  }, [horas, agenda, weekday])
  const [zoom, setZoom] = useState(lerZoom)
  const { escala, grade, rotulo: rotuloCada } = ZOOMS[zoom]
  const rolagem = useRef(null)
  function mudarZoom(delta, ancoraY) {
    setZoom((z) => {
      const novo = Math.max(0, Math.min(ZOOMS.length - 1, z + delta))
      if (novo === z) return z
      try { localStorage.setItem('mimo-quadro-zoom', String(novo)) } catch { /* sem armazenamento */ }
      // mantém o mesmo minuto embaixo do cursor (ou no meio da tela) depois de trocar a escala
      const el = rolagem.current
      if (el) {
        const y = ancoraY ?? el.clientHeight / 2
        const minuto = (el.scrollTop + y - 10) / ZOOMS[z].escala
        requestAnimationFrame(() => { el.scrollTop = Math.max(0, minuto * ZOOMS[novo].escala - y + 10) })
      }
      return novo
    })
  }
  useEffect(() => {
    const el = rolagem.current; if (!el) return
    const aoRolar = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      mudarZoom(e.deltaY < 0 ? 1 : -1, e.clientY - r.top)
    }
    el.addEventListener('wheel', aoRolar, { passive: false })
    return () => el.removeEventListener('wheel', aoRolar)
  }, [])
  const altura = (fim - ini) * escala
  const linhas = useMemo(() => { const l = []; for (let m = ini; m < fim; m += grade) l.push(m); return l }, [ini, fim, grade])
  const hojeStr = isoHoje()
  const ehHoje = dia === hojeStr
  const passado = dia < hojeStr
  const diasDaSemana = useMemo(() => semanaDe(dia), [dia])
  const contagem = useMemo(() => Object.fromEntries((semana ?? []).map((x) => [String(x.dia).slice(0, 10), x])), [semana])
  const agoraMin = agora.getHours() * 60 + agora.getMinutes()

  function posDoEvento(e, col) {
    const r = col.getBoundingClientRect()
    const y = Math.max(0, e.clientY - r.top + col.scrollTop)
    return ini + Math.round((y / escala) / PASSO) * PASSO
  }
  function soltar(e, prof) {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || arrastando
    setSombra(null); setArrastando(null)
    const a = agenda.find((x) => x.id === id)
    if (!a) return
    const inicio = Math.min(fim - PASSO, Math.max(ini, posDoEvento(e, e.currentTarget)))
    if (inicio === min(a.start_time) && prof === a.professional_id) return
    mover(a, prof, inicio)
  }
  async function mover(a, prof, inicio, novoDia = dia) {
    const p = profs.find((x) => x.id === prof)
    const ok = await confirmar({ titulo: `Mover ${a.cliente} para ${novoDia !== dia ? rotuloDia(novoDia) + ' às ' : ''}${hhmm(inicio)}${p && prof !== a.professional_id ? `, com ${p.name}` : ''}?`, texto: 'O horário antigo é cancelado e ela recebe o aviso do novo.', ok: 'Mover' })
    if (!ok) return
    setOcupado(true); setErro('')
    const { data, error } = await supabase.rpc('mover_horario', { appt: a.id, nova_data: novoDia, nova_hora: hhmm(inicio), nova_prof: prof })
    setOcupado(false)
    if (error) { setErro(error.message); return }
    if (data && data.ok === false) { setErro(data.motivo === 'ocupado' ? 'Esse horário já está ocupado.' : data.motivo === 'nao_faz' ? `${data.profissional} não faz esse serviço.` : 'Não deu para mover.'); return }
    onMudou?.()
  }
  async function cancelar(a) {
    const ok = await confirmar({ titulo: 'Cancelar este horário?', texto: `${a.cliente}, às ${a.start_time.slice(0, 5)}. O horário volta a ficar livre e ela é avisada.`, ok: 'Cancelar horário', perigo: true })
    if (!ok) return
    const { error } = await supabase.from('appointments').update({ status: 'cancelado' }).eq('id', a.id)
    if (error) setErro(error.message); else { setAberto(null); onMudou?.() }
  }

  const colunas = profs
  return (
    <div className="quadro">
      {erro && <div className="alert alert-error quadro-erro">{erro}<button type="button" onClick={() => setErro('')} aria-label="Fechar">×</button></div>}
      <div className="quadro-nav">
        <div className="quadro-nav-dia">
          <button type="button" className="quadro-nav-btn" onClick={() => onTrocarDia?.(somar(dia, -1))} aria-label="Dia anterior"><ChevronLeft size={18} /></button>
          <button type="button" className="quadro-nav-btn" onClick={() => onTrocarDia?.(somar(dia, 1))} aria-label="Dia seguinte"><ChevronRight size={18} /></button>
          <strong className="quadro-nav-rotulo">{rotuloDia(dia)}{ehHoje ? ' · hoje' : passado ? ' · passado' : ''}</strong>
          <span className="quadro-lupa" title="Ctrl + rodinha do mouse também muda a escala">
            <button type="button" className="quadro-nav-btn" onClick={() => mudarZoom(-1)} disabled={zoom === 0} aria-label="Menos detalhe"><ZoomOut size={15} /></button>
            <span className="quadro-lupa-nome">{ZOOMS[zoom].nome}</span>
            <button type="button" className="quadro-nav-btn" onClick={() => mudarZoom(1)} disabled={zoom === ZOOMS.length - 1} aria-label="Mais detalhe"><ZoomIn size={15} /></button>
          </span>
          <input type="date" className="quadro-nav-data" value={dia} onChange={(e) => e.target.value && onTrocarDia?.(e.target.value)} aria-label="Escolher o dia" />
          {!ehHoje && <button type="button" className="btn-mini btn-mini-neutro" onClick={() => onTrocarDia?.(hojeStr)}>Hoje</button>}
        </div>
        <div className="quadro-semana">
          <button type="button" className="quadro-nav-btn" onClick={() => onTrocarDia?.(somar(dia, -7))} aria-label="Semana anterior"><ChevronLeft size={16} /></button>
          {diasDaSemana.map((d) => {
            const c = contagem[d]; const dt = new Date(d + 'T12:00:00')
            return (
              <button key={d} type="button" className={'quadro-dia' + (d === dia ? ' ativo' : '') + (d === hojeStr ? ' hoje' : '') + (sombra?.dia === d ? ' alvo' : '')}
                onClick={() => onTrocarDia?.(d)}
                onDragOver={(e) => { e.preventDefault(); if (sombra?.dia !== d) setSombra({ dia: d }) }}
                onDragLeave={() => setSombra((s) => (s?.dia === d ? null : s))}
                onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || arrastando; setSombra(null); setArrastando(null); const a = agenda.find((x) => x.id === id); if (a && d !== dia) mover(a, a.professional_id, min(a.start_time), d) }}>
                <span className="quadro-dia-nome">{DIAS_CURTOS[dt.getDay()]}</span>
                <strong>{dt.getDate()}</strong>
                <span className="quadro-dia-conta">{c?.quantos ? `${c.quantos}` : '·'}</span>
              </button>
            )
          })}
          <button type="button" className="quadro-nav-btn" onClick={() => onTrocarDia?.(somar(dia, 7))} aria-label="Semana seguinte"><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="quadro-cabeca">
        <div className="quadro-gutter" />
        {colunas.map((p) => (
          <div key={p.id} className="quadro-col-cabeca"><Avatar nome={p.name} foto={p.photo_url} pequeno /><strong>{p.name}</strong><span className="muted">{agenda.filter((a) => a.professional_id === p.id && a.status !== 'cancelado').length} no dia</span></div>
        ))}
      </div>
      <div className="quadro-rolagem" ref={rolagem}>
        <div className="quadro-grade" style={{ height: altura }}>
          <div className="quadro-gutter">
            {linhas.map((m) => <span key={m} className={'quadro-hora' + (m % rotuloCada ? ' meia' : '') + (m % 60 ? ' fracao' : '')} style={{ top: (m - ini) * escala }}>{m % rotuloCada ? '' : hhmm(m)}</span>)}
          </div>
          {colunas.map((p) => (
            <div key={p.id} className={'quadro-col' + (sombra?.prof === p.id ? ' alvo' : '')}
              onDragOver={(e) => { e.preventDefault(); const inicio = Math.min(fim - PASSO, Math.max(ini, posDoEvento(e, e.currentTarget))); if (sombra?.prof !== p.id || sombra?.inicio !== inicio) setSombra({ prof: p.id, inicio }) }}
              onDragLeave={() => setSombra((s) => (s?.prof === p.id ? null : s))}
              onDrop={(e) => soltar(e, p.id)}
              onClick={(e) => { if (e.target !== e.currentTarget) return; const inicio = Math.min(fim - PASSO, Math.max(ini, posDoEvento(e, e.currentTarget))); setNovo({ prof: p.id, inicio }) }}
            >
              {linhas.map((m) => <span key={m} className={'quadro-linha' + (m % 60 ? ' meia' : '')} style={{ top: (m - ini) * escala }} />)}
              {ehHoje && agoraMin >= ini && agoraMin <= fim && <span className="quadro-agora" style={{ top: (agoraMin - ini) * escala }} />}
              {sombra?.prof === p.id && !sombra?.dia && arrastando && (() => { const a = agenda.find((x) => x.id === arrastando); if (!a) return null; const d = min(a.end_time) - min(a.start_time); return <span className="quadro-sombra" style={{ top: (sombra.inicio - ini) * escala, height: d * escala }}>{hhmm(sombra.inicio)}</span> })()}
              {agenda.filter((a) => a.professional_id === p.id).map((a) => {
                const top = (min(a.start_time) - ini) * escala, h = Math.max(24, (min(a.end_time) - min(a.start_time)) * escala)
                const movel = (a.status === 'pendente' || a.status === 'confirmado') && !a.comanda_id
                return (
                  <button key={a.id} type="button" draggable={movel && !ocupado} className={`quadro-cartao ${a.status}${a.comanda_id ? ' fechado' : ''}${arrastando === a.id ? ' no-ar' : ''}${movel ? ' movel' : ''}`}
                    style={{ top, height: h }} title={`${a.cliente} · ${a.servico}`}
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', a.id); e.dataTransfer.effectAllowed = 'move'; setArrastando(a.id) }}
                    onDragEnd={() => { setArrastando(null); setSombra(null) }}
                    onClick={(e) => { e.stopPropagation(); setAberto(a) }}>
                    {movel && <GripVertical size={12} className="quadro-grip" />}
                    {h < 84 && a.client_id && a.atendimentos === 0 && <span className="quadro-marca nova" title="Primeira vez na casa">1ª vez</span>}
                    {h < 84 && a.preferida_id && a.preferida_id !== a.professional_id && <span className="quadro-marca prefere" title={`Prefere ${a.preferida}`}><Heart size={9} /> {a.preferida?.split(' ')[0]}</span>}
                    <span className="quadro-cartao-hora">{a.start_time.slice(0, 5)}–{a.end_time.slice(0, 5)}</span>
                    <strong>{a.cliente}</strong>
                    {h >= 54 && <span className="quadro-cartao-serv">{a.servico}</span>}
                    {h >= 72 && <span className="quadro-cartao-pe">{formatCents(a.price_cents ?? 0)}{a.pago_cents > 0 ? ` · sinal ${formatCents(a.pago_cents)}` : ''}{a.comanda_id ? ' · fechado' : ''}{a.avaliacao?.nota ? <em className="quadro-nota" title={a.avaliacao.comentario ?? 'Avaliação da cliente'}>{'★'.repeat(a.avaliacao.nota)}</em> : null}</span>}
                    {h < 72 && a.avaliacao?.nota && <span className="quadro-marca nota" title={`Avaliou com ${a.avaliacao.nota} ${a.avaliacao.nota === 1 ? 'estrela' : 'estrelas'}`}>★ {a.avaliacao.nota}</span>}
                    {h >= 84 && a.client_id && (
                      <span className="quadro-cartao-cliente">
                        <span className={a.atendimentos === 0 ? 'nova' : ''}>{a.atendimentos === 0 ? 'Primeira vez' : `${a.atendimentos + 1}ª visita`}</span>
                        {a.preferida_id && <span className={a.preferida_id === a.professional_id ? 'ok' : 'prefere'}><Heart size={9} /> {a.preferida_id === a.professional_id ? 'preferida' : `prefere ${a.preferida?.split(' ')[0]}`}</span>}
                        {a.faltas > 0 && <span className="atencao">{a.faltas} {a.faltas === 1 ? 'falta' : 'faltas'}</span>}
                      </span>
                    )}
                    {h >= 84 && !a.client_id && <span className="quadro-cartao-cliente"><span>avulsa, sem conta</span></span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {novo && <NovoHorario prof={profs.find((p) => p.id === novo.prof)} inicio={novo.inicio} dia={dia} servicos={servicos} cats={cats} clientes={clientes} salaoId={salaoId} agenda={agenda} onFechar={() => setNovo(null)} onPronto={() => { setNovo(null); onMudou?.() }} />}
      {adicionarEm && <NovoHorario prof={profs.find((p) => p.id === adicionarEm.professional_id)} inicio={min(adicionarEm.end_time)} dia={dia} servicos={servicos} cats={cats} clientes={clientes} salaoId={salaoId} agenda={agenda} juntarEm={adicionarEm} onFechar={() => setAdicionarEm(null)} onPronto={() => { setAdicionarEm(null); onMudou?.() }} />}

      {aberto && (
        <div className="modal-fundo" onClick={() => setAberto(null)}>
          <div className="modal-caixa quadro-detalhe" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-fechar" onClick={() => setAberto(null)} aria-label="Fechar"><X size={18} /></button>
            <span className={'badge badge-' + aberto.status}>{aberto.comanda_id ? 'comanda fechada' : aberto.status}</span>
            <h3>{aberto.cliente}</h3>
            <p className="muted"><Clock size={14} /> {aberto.start_time.slice(0, 5)} até {aberto.end_time.slice(0, 5)} · {aberto.profissional}</p>
            <p className="muted"><Sparkles size={14} /> {aberto.servico} · {formatCents(aberto.price_cents ?? 0)}{aberto.pago_cents > 0 ? ` · sinal de ${formatCents(aberto.pago_cents)} pago pelo app` : ''}</p>
            {aberto.telefone && <p className="muted"><UserRound size={14} /> {aberto.telefone}</p>}
            {aberto.avaliacao?.nota && (
              <div className="quadro-avaliacao">
                <span className="quadro-avaliacao-estrelas" aria-label={`${aberto.avaliacao.nota} de 5`}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={15} className={n <= aberto.avaliacao.nota ? 'cheia' : ''} />)}</span>
                <span className="quadro-avaliacao-texto">
                  <strong>Ela avaliou este atendimento com {aberto.avaliacao.nota} {aberto.avaliacao.nota === 1 ? 'estrela' : 'estrelas'}</strong>
                  {aberto.avaliacao.comentario ? <q>{aberto.avaliacao.comentario}</q> : <span className="muted">Sem comentário.</span>}
                  {aberto.avaliacao.em && <small className="muted">{new Date(aberto.avaliacao.em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</small>}
                </span>
              </div>
            )}
            {aberto.client_id ? (
              <div className="quadro-resumo">
                <span className={'quadro-resumo-chip' + (aberto.atendimentos === 0 ? ' nova' : '')}>{aberto.atendimentos === 0 ? 'Primeira vez na casa' : `${aberto.atendimentos} ${aberto.atendimentos === 1 ? 'atendimento' : 'atendimentos'} aqui`}</span>
                {aberto.ultima_visita && <span className="quadro-resumo-chip">última vez {new Date(aberto.ultima_visita + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span>}
                {aberto.faltas > 0 && <span className="quadro-resumo-chip atencao"><AlertTriangle size={11} /> {aberto.faltas} {aberto.faltas === 1 ? 'falta' : 'faltas'}</span>}
                {aberto.preferida_id ? (
                  aberto.preferida_id === aberto.professional_id
                    ? <span className="quadro-resumo-chip ok"><Heart size={11} /> está com a preferida</span>
                    : <span className="quadro-resumo-chip prefere"><Heart size={11} /> prefere {aberto.preferida}, está com {aberto.profissional?.split(' ')[0]}</span>
                ) : <span className="quadro-resumo-chip">sem preferida</span>}
              </div>
            ) : <p className="muted quadro-dica">Cliente avulsa, sem conta no MIMO.</p>}
            {aberto.preferida_id && aberto.preferida_id !== aberto.professional_id && (aberto.status === 'pendente' || aberto.status === 'confirmado') && !aberto.comanda_id && (
              <p className="muted quadro-dica">Se a {aberto.preferida?.split(' ')[0]} tiver vaga, arraste o cartão para a coluna dela.</p>
            )}
            <div className="quadro-detalhe-acoes">
              {(aberto.status === 'pendente' || aberto.status === 'confirmado') && !aberto.comanda_id && <button type="button" className="btn btn-primary" onClick={() => { onAbrirComanda?.(aberto); setAberto(null) }}><Receipt size={15} /> Abrir comanda</button>}
              {(aberto.status === 'pendente' || aberto.status === 'confirmado') && !aberto.comanda_id && <button type="button" className="btn btn-ghost" onClick={() => { setAdicionarEm(aberto); setAberto(null) }}><Plus size={15} /> Adicionar serviço</button>}
              {(aberto.status === 'pendente' || aberto.status === 'confirmado') && !aberto.comanda_id && <button type="button" className="btn btn-ghost" onClick={() => cancelar(aberto)}><Ban size={15} /> Cancelar horário</button>}
            </div>
            {(aberto.status === 'pendente' || aberto.status === 'confirmado') && !aberto.comanda_id && <p className="muted quadro-dica">Para remarcar, arraste o cartão no quadro para outra hora, outra coluna ou um dia da faixa de cima.</p>}
            {aberto.client_id && <LinhaDoTempo salaoId={salaoId} clienteId={aberto.client_id} atualId={aberto.id} />}
          </div>
        </div>
      )}
    </div>
  )
}

// o modal de serviços: por categoria, escolhe um, a duração já vem; nome da cliente com a lista da carteira
function NovoHorario({ prof, inicio, dia, servicos, cats, clientes, agenda = [], juntarEm = null, onFechar, onPronto }) {
  const [busca, setBusca] = useState('')
  const [servico, setServico] = useState(null)
  const [nome, setNome] = useState(juntarEm?.cliente ?? '')
  const [clienteId, setClienteId] = useState(juntarEm?.client_id ?? null)
  const [aviso, setAviso] = useState('')
  const [telefone, setTelefone] = useState('')
  const [hora, setHora] = useState(hhmm(inicio))
  const [meus, setMeus] = useState(null)   // ids dos serviços que a profissional faz
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const primeiro = useRef(null)
  useEffect(() => { primeiro.current?.focus() }, [])
  useEffect(() => {
    if (!prof?.id) return
    supabase.from('professional_services').select('service_id').eq('professional_id', prof.id).then(({ data }) => setMeus(new Set((data ?? []).map((v) => v.service_id))))
  }, [prof?.id])
  const lista = useMemo(() => servicos.filter((s) => (!meus || meus.size === 0 || meus.has(s.id)) && (!busca || bate(s.name, busca))), [servicos, meus, busca])
  const grupos = useMemo(() => agruparPorCategoria(lista, cats), [lista, cats])
  function escolherCliente(v) { setNome(v); const c = clientes.find((x) => x.nome?.toLowerCase() === v.trim().toLowerCase()); setClienteId(c?.client_id ?? null); if (c?.telefone && !telefone) setTelefone(c.telefone) }
  // ela já está na cadeira (ou marcada) com essa profissional hoje? então o serviço entra no mesmo atendimento
  const jaTem = juntarEm ?? (clienteId ? agenda.find((a) => a.client_id === clienteId && a.professional_id === prof?.id && (a.status === 'pendente' || a.status === 'confirmado') && !a.comanda_id) : null)
  async function salvar(e) {
    e.preventDefault()
    if (!servico) { setErro('Escolha o serviço.'); return }
    if (!nome.trim() && !clienteId) { setErro('Diga quem é a cliente.'); return }
    setSalvando(true); setErro('')
    const { error } = await supabase.rpc('encaixar_atendimento', { prof: prof.id, servico: servico.id, dia, inicio: hora, nome_cliente: nome.trim() || null, telefone: telefone.trim() || null, cliente: clienteId })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    onPronto()
  }
  async function juntar() {
    if (!servico || !jaTem) return
    setSalvando(true); setErro('')
    const { data, error } = await supabase.rpc('adicionar_servico_ao_horario', { appt: jaTem.id, servico: servico.id })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    if (data && data.esticou === false) setAviso('O serviço entrou, mas o próximo horário dela está colado: o fim não esticou. Se precisar, arraste o próximo.')
    if (data && data.esticou === false) { setTimeout(onPronto, 2200) } else onPronto()
  }
  return (
    <div className="modal-fundo" onClick={onFechar}>
      <form className="modal-caixa form quadro-novo" onClick={(e) => e.stopPropagation()} onSubmit={salvar}>
        <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        <h3>{juntarEm ? `Mais um serviço para ${juntarEm.cliente}` : `Novo horário com ${prof?.name?.split(' ')[0]}`}</h3>
        {jaTem && !juntarEm && (
          <div className="quadro-juntar">
            <strong><Sparkles size={14} /> {nome.split(' ')[0]} já está com {prof?.name?.split(' ')[0]} às {jaTem.start_time.slice(0, 5)}.</strong>
            <span className="muted">Dá para pôr este serviço no mesmo atendimento: uma comanda só, o horário estica até {servico ? hhmm(min(jaTem.end_time) + servico.duration_minutes) : 'o fim do novo serviço'}.</span>
          </div>
        )}
        {juntarEm && <p className="muted quadro-dica">Entra no atendimento das {juntarEm.start_time.slice(0, 5)} com {prof?.name?.split(' ')[0]}: mesma comanda, o horário estica {servico ? `até ${hhmm(min(juntarEm.end_time) + servico.duration_minutes)}` : 'pela duração do serviço'}.</p>}
        {aviso && <div className="alert alert-info">{aviso}</div>}
        {!juntarEm && <div className="form-row">
          <label>Cliente
            <input ref={primeiro} list="quadro-clientes" value={nome} onChange={(e) => escolherCliente(e.target.value)} placeholder="Nome (ou escolha da lista)" />
            <datalist id="quadro-clientes">{clientes.map((x) => <option key={x.client_id} value={x.nome} />)}</datalist>
          </label>
          <label>Telefone <span className="muted">(opcional)</span><input value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="tel" /></label>
        </div>}
        {!juntarEm && !jaTem && <div className="form-row">
          <label>Começa às<input type="time" step="300" value={hora} onChange={(e) => setHora(e.target.value)} required /></label>
          <label>Termina<input value={servico ? hhmm(min(hora) + servico.duration_minutes) : '—'} readOnly disabled /></label>
        </div>}
        <div className="pdv-busca"><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar serviço…" /></div>
        <div className="quadro-servicos">
          {grupos.map((g) => (
            <div key={g.id || 'outros'} className="quadro-servicos-col">
              <span className="quadro-servicos-cat">{g.nome}</span>
              {g.itens.map((s) => (
                <button key={s.id} type="button" className={'pdv-servico' + (servico?.id === s.id ? ' escolhido' : '')} onClick={() => setServico(s)}>
                  <strong>{s.name}</strong><span>{formatCents(Math.round(Number(s.price) * 100))}</span><small className="muted">{s.duration_minutes} min</small>
                </button>
              ))}
            </div>
          ))}
          {grupos.length === 0 && <p className="muted">{meus && meus.size ? 'Nada com esse nome entre os serviços dela.' : 'Nenhum serviço ativo.'}</p>}
        </div>
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
          {jaTem
            ? <button type="button" className="btn btn-primary" disabled={salvando || !servico} onClick={juntar}><Plus size={15} /> {salvando ? 'Adicionando…' : `Adicionar ao atendimento${servico ? ` · ${servico.name}` : ''}`}</button>
            : <button type="submit" className="btn btn-primary" disabled={salvando || !servico}>{salvando ? 'Marcando…' : `Marcar ${servico ? servico.name : ''}`}</button>}
          {jaTem && !juntarEm && <button type="submit" className="btn-mini btn-mini-neutro" disabled={salvando || !servico}>Não, marcar separado às {hora}</button>}
        </div>
      </form>
    </div>
  )
}

// a linha do tempo da cliente na casa: o que ela já fez, com quem, quanto, como pagou
function LinhaDoTempo({ salaoId, clienteId, atualId }) {
  const [lista, setLista] = useState(null)
  useEffect(() => {
    let vivo = true
    supabase.rpc('pdv_historico', { salao: salaoId, cliente: clienteId, limite: 30 }).then(({ data }) => { if (vivo) setLista(data ?? []) })
    return () => { vivo = false }
  }, [salaoId, clienteId])
  const passados = (lista ?? []).filter((x) => x.id !== atualId)
  const feitos = passados.filter((x) => x.status === 'concluido')
  const gasto = feitos.reduce((s, x) => s + Number(x.comanda?.total_cents ?? x.price_cents ?? 0), 0)
  if (lista === null) return <p className="muted quadro-dica">Buscando o histórico…</p>
  if (passados.length === 0) return <p className="muted quadro-dica"><History size={14} /> Primeira vez dela na casa.</p>
  const ultima = feitos[0]
  return (
    <div className="lt">
      <div className="lt-resumo">
        <span><strong>{feitos.length}</strong> {feitos.length === 1 ? 'atendimento' : 'atendimentos'}</span>
        <span><strong>{formatCents(gasto)}</strong> na casa</span>
        {ultima && <span>última vez <strong>{new Date(ultima.dia + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</strong></span>}
      </div>
      <ol className="lt-lista">
        {passados.map((x) => {
          const dt = new Date(x.dia + 'T12:00:00')
          const total = x.comanda?.total_cents ?? x.price_cents ?? 0
          const formas = (x.comanda?.pagamentos ?? []).map((p) => p.forma === 'app' ? 'app' : p.forma).join(' + ')
          return (
            <li key={x.id} className={'lt-item ' + x.status}>
              <span className="lt-ponto" />
              <span className="lt-quando"><strong>{dt.getDate()}</strong><small>{MESES[dt.getMonth()]}{dt.getFullYear() !== new Date().getFullYear() ? ` ${String(dt.getFullYear()).slice(2)}` : ''}</small></span>
              <span className="lt-texto">
                <strong>{(x.itens?.length ? x.itens.map((i) => i.nome).join(' + ') : x.servico)}</strong>
                <span className="muted">{x.profissional ? `com ${x.profissional.split(' ')[0]}` : ''}{x.status === 'faltou' ? ' · não veio' : x.status !== 'concluido' ? ` · ${x.status}` : ''}{formas ? ` · ${formas}` : ''}{x.avaliacao ? ' · ' : ''}{x.avaliacao ? <em className="lt-nota"><Star size={10} /> {x.avaliacao}</em> : null}</span>
                {x.comentario && <q className="lt-comentario">{x.comentario}</q>}
              </span>
              <span className="lt-valor">{x.status === 'concluido' ? formatCents(total) : ''}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
