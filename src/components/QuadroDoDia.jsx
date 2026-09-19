import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Receipt, Ban, Clock, UserRound, Sparkles, GripVertical } from 'lucide-react'
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
const PX_POR_MIN = 1.5          // 90px por hora
const PASSO = 15                // arrasto e cliques caem em múltiplos de 15 min
const min = (t) => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m }
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export default function QuadroDoDia({ dia, agenda, profs, horas, servicos, cats, clientes, salaoId, onAbrirComanda, onMudou }) {
  const { confirmar } = useDialogo()
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 60000); return () => clearInterval(t) }, [])
  const [arrastando, setArrastando] = useState(null)      // id do cartão no ar
  const [sombra, setSombra] = useState(null)              // { prof, inicio } enquanto arrasta
  const [novo, setNovo] = useState(null)                  // { prof, inicio } → modal de encaixe
  const [aberto, setAberto] = useState(null)              // cartão clicado
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const [ini, fim] = useMemo(() => {
    const abertos = (horas ?? []).filter((h) => h.open)
    const a = abertos.length ? Math.min(...abertos.map((h) => min(h.start_time))) : 8 * 60
    const b = abertos.length ? Math.max(...abertos.map((h) => min(h.end_time))) : 20 * 60
    const extra = (agenda ?? []).reduce((acc, x) => [Math.min(acc[0], min(x.start_time)), Math.max(acc[1], min(x.end_time))], [a, b])
    return [Math.floor(extra[0] / 60) * 60, Math.ceil(extra[1] / 60) * 60]
  }, [horas, agenda])
  const altura = (fim - ini) * PX_POR_MIN
  const linhas = useMemo(() => { const l = []; for (let m = ini; m < fim; m += 30) l.push(m); return l }, [ini, fim])
  const hojeStr = new Date().toISOString().slice(0, 10)
  const ehHoje = dia === hojeStr
  const agoraMin = agora.getHours() * 60 + agora.getMinutes()

  function posDoEvento(e, col) {
    const r = col.getBoundingClientRect()
    const y = Math.max(0, e.clientY - r.top + col.scrollTop)
    return ini + Math.round((y / PX_POR_MIN) / PASSO) * PASSO
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
  async function mover(a, prof, inicio) {
    const p = profs.find((x) => x.id === prof)
    const ok = await confirmar({ titulo: `Mover ${a.cliente} para ${hhmm(inicio)}${p && prof !== a.professional_id ? `, com ${p.name}` : ''}?`, texto: 'O horário antigo é cancelado e ela recebe o aviso do novo.', ok: 'Mover' })
    if (!ok) return
    setOcupado(true); setErro('')
    const { data, error } = await supabase.rpc('mover_horario', { appt: a.id, nova_data: dia, nova_hora: hhmm(inicio), nova_prof: prof })
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
      <div className="quadro-cabeca">
        <div className="quadro-gutter" />
        {colunas.map((p) => (
          <div key={p.id} className="quadro-col-cabeca"><Avatar nome={p.name} foto={p.photo_url} pequeno /><strong>{p.name}</strong><span className="muted">{agenda.filter((a) => a.professional_id === p.id && a.status !== 'cancelado').length} hoje</span></div>
        ))}
      </div>
      <div className="quadro-rolagem">
        <div className="quadro-grade" style={{ height: altura }}>
          <div className="quadro-gutter">
            {linhas.map((m) => <span key={m} className={'quadro-hora' + (m % 60 ? ' meia' : '')} style={{ top: (m - ini) * PX_POR_MIN }}>{m % 60 ? '' : hhmm(m)}</span>)}
          </div>
          {colunas.map((p) => (
            <div key={p.id} className={'quadro-col' + (sombra?.prof === p.id ? ' alvo' : '')}
              onDragOver={(e) => { e.preventDefault(); const inicio = Math.min(fim - PASSO, Math.max(ini, posDoEvento(e, e.currentTarget))); if (sombra?.prof !== p.id || sombra?.inicio !== inicio) setSombra({ prof: p.id, inicio }) }}
              onDragLeave={() => setSombra((s) => (s?.prof === p.id ? null : s))}
              onDrop={(e) => soltar(e, p.id)}
              onClick={(e) => { if (e.target !== e.currentTarget) return; const inicio = Math.min(fim - PASSO, Math.max(ini, posDoEvento(e, e.currentTarget))); setNovo({ prof: p.id, inicio }) }}
            >
              {linhas.map((m) => <span key={m} className={'quadro-linha' + (m % 60 ? ' meia' : '')} style={{ top: (m - ini) * PX_POR_MIN }} />)}
              {ehHoje && agoraMin >= ini && agoraMin <= fim && <span className="quadro-agora" style={{ top: (agoraMin - ini) * PX_POR_MIN }} />}
              {sombra?.prof === p.id && arrastando && (() => { const a = agenda.find((x) => x.id === arrastando); if (!a) return null; const d = min(a.end_time) - min(a.start_time); return <span className="quadro-sombra" style={{ top: (sombra.inicio - ini) * PX_POR_MIN, height: d * PX_POR_MIN }}>{hhmm(sombra.inicio)}</span> })()}
              {agenda.filter((a) => a.professional_id === p.id).map((a) => {
                const top = (min(a.start_time) - ini) * PX_POR_MIN, h = Math.max(24, (min(a.end_time) - min(a.start_time)) * PX_POR_MIN)
                const movel = (a.status === 'pendente' || a.status === 'confirmado') && !a.comanda_id
                return (
                  <button key={a.id} type="button" draggable={movel && !ocupado} className={`quadro-cartao ${a.status}${a.comanda_id ? ' fechado' : ''}${arrastando === a.id ? ' no-ar' : ''}${movel ? ' movel' : ''}`}
                    style={{ top, height: h }} title={`${a.cliente} · ${a.servico}`}
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', a.id); e.dataTransfer.effectAllowed = 'move'; setArrastando(a.id) }}
                    onDragEnd={() => { setArrastando(null); setSombra(null) }}
                    onClick={(e) => { e.stopPropagation(); setAberto(a) }}>
                    {movel && <GripVertical size={12} className="quadro-grip" />}
                    <span className="quadro-cartao-hora">{a.start_time.slice(0, 5)}–{a.end_time.slice(0, 5)}</span>
                    <strong>{a.cliente}</strong>
                    {h >= 54 && <span className="quadro-cartao-serv">{a.servico}</span>}
                    {h >= 72 && <span className="quadro-cartao-pe">{formatCents(a.price_cents ?? 0)}{a.pago_cents > 0 ? ` · sinal ${formatCents(a.pago_cents)}` : ''}{a.comanda_id ? ' · fechado' : ''}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {novo && <NovoHorario prof={profs.find((p) => p.id === novo.prof)} inicio={novo.inicio} dia={dia} servicos={servicos} cats={cats} clientes={clientes} salaoId={salaoId} onFechar={() => setNovo(null)} onPronto={() => { setNovo(null); onMudou?.() }} />}

      {aberto && (
        <div className="modal-fundo" onClick={() => setAberto(null)}>
          <div className="modal-caixa quadro-detalhe" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-fechar" onClick={() => setAberto(null)} aria-label="Fechar"><X size={18} /></button>
            <span className={'badge badge-' + aberto.status}>{aberto.comanda_id ? 'comanda fechada' : aberto.status}</span>
            <h3>{aberto.cliente}</h3>
            <p className="muted"><Clock size={14} /> {aberto.start_time.slice(0, 5)} até {aberto.end_time.slice(0, 5)} · {aberto.profissional}</p>
            <p className="muted"><Sparkles size={14} /> {aberto.servico} · {formatCents(aberto.price_cents ?? 0)}{aberto.pago_cents > 0 ? ` · sinal de ${formatCents(aberto.pago_cents)} pago pelo app` : ''}</p>
            {aberto.telefone && <p className="muted"><UserRound size={14} /> {aberto.telefone}</p>}
            <div className="quadro-detalhe-acoes">
              {(aberto.status === 'pendente' || aberto.status === 'confirmado') && !aberto.comanda_id && <button type="button" className="btn btn-primary" onClick={() => { onAbrirComanda?.(aberto); setAberto(null) }}><Receipt size={15} /> Abrir comanda</button>}
              {(aberto.status === 'pendente' || aberto.status === 'confirmado') && !aberto.comanda_id && <button type="button" className="btn btn-ghost" onClick={() => cancelar(aberto)}><Ban size={15} /> Cancelar horário</button>}
            </div>
            {(aberto.status === 'pendente' || aberto.status === 'confirmado') && !aberto.comanda_id && <p className="muted quadro-dica">Para remarcar, arraste o cartão no quadro para outra hora ou outra coluna.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// o modal de serviços: por categoria, escolhe um, a duração já vem; nome da cliente com a lista da carteira
function NovoHorario({ prof, inicio, dia, servicos, cats, clientes, onFechar, onPronto }) {
  const [busca, setBusca] = useState('')
  const [servico, setServico] = useState(null)
  const [nome, setNome] = useState('')
  const [clienteId, setClienteId] = useState(null)
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
  return (
    <div className="modal-fundo" onClick={onFechar}>
      <form className="modal-caixa form quadro-novo" onClick={(e) => e.stopPropagation()} onSubmit={salvar}>
        <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        <h3>Novo horário com {prof?.name?.split(' ')[0]}</h3>
        <div className="form-row">
          <label>Cliente
            <input ref={primeiro} list="quadro-clientes" value={nome} onChange={(e) => escolherCliente(e.target.value)} placeholder="Nome (ou escolha da lista)" />
            <datalist id="quadro-clientes">{clientes.map((x) => <option key={x.client_id} value={x.nome} />)}</datalist>
          </label>
          <label>Telefone <span className="muted">(opcional)</span><input value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="tel" /></label>
        </div>
        <div className="form-row">
          <label>Começa às<input type="time" step="300" value={hora} onChange={(e) => setHora(e.target.value)} required /></label>
          <label>Termina<input value={servico ? hhmm(min(hora) + servico.duration_minutes) : '—'} readOnly disabled /></label>
        </div>
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
          <button type="submit" className="btn btn-primary" disabled={salvando || !servico}>{salvando ? 'Marcando…' : `Marcar ${servico ? servico.name : ''}`}</button>
        </div>
      </form>
    </div>
  )
}
