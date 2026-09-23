import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Monitor, Search, Plus, Minus, Trash2, RotateCcw, LogOut, LayoutDashboard, UserRound, Receipt, CircleCheck, Smartphone } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import { useAuth } from '../../context/AuthContext'
import { useDialogo } from '../../context/DialogoContext'
import { supabase } from '../../lib/supabase'
import { formatCents } from '../../lib/pagamento'
import { useCategorias, categoriasDoSalao, agruparPorCategoria, bate } from '../../lib/categorias'
import { MarcaIcon, Wordmark } from '../../components/icons'
import QuadroDoDia from '../../components/QuadroDoDia'
import FecharComanda from '../../components/FecharComanda'
import { imprimirCupom } from '../../lib/cupom'
import { useMovimentacao } from '../../lib/useMovimentacao'
import { preparar as prepararSom, tocar } from '../../lib/som'
import { Bell, Volume2, VolumeX, CalendarPlus, CalendarX, Banknote, MessageSquare, Clock3, CheckCircle2, X as XIcon } from 'lucide-react'
import { CalendarDays, Users, HandCoins, Star } from 'lucide-react'

// O PDV do balcão (102): tela cheia, feita para o computador do salão.
// Esquerda, a agenda de hoje (ou o caixa); centro, o catálogo; direita,
// a comanda. Puxa o horário da cliente, acrescenta o que ela fez, dá o
// desconto, registra como pagou (o sinal do app já vem abatido) e fecha.
// Fechar conclui o atendimento na agenda e deixa o rastro no caixa.
const ROTULO_FORMA = { dinheiro: 'dinheiro', debito: 'débito', credito: 'crédito', pix: 'PIX', app: 'pelo app', outro: 'outro' }
const LARGURA_MINIMA = 900
const vazia = () => ({ appointment_id: null, client_id: null, cliente: '', professional_id: '', itens: [], sinal: 0, desconto: '', pagamentos: [], observacao: '', visita: [] })
// os itens de um horário, cada um sabendo de que horário e de quem é
const itensDoHorario = (h) => (h.itens?.length ? h.itens : [{ service_id: null, nome: h.servico ?? 'Atendimento', preco_cents: h.price_cents ?? 0, duracao: 0 }])
  .map((i) => ({ ...i, qtd: i.qtd ?? 1, appointment_id: h.id, professional_id: h.professional_id ?? '', profissional: h.profissional ?? null }))
const reais = (t) => { const n = Number(String(t ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0 }
const emReais = (c) => (Number(c ?? 0) / 100).toFixed(2).replace('.', ',')

export default function AdminPdv() {
  const { salao, user } = useAuth()
  const { confirmar } = useDialogo()
  const navigate = useNavigate()
  const [som, setSom] = useState(() => { try { return localStorage.getItem('mimo-pdv-som') !== '0' } catch { return true } })
  const [feed, setFeed] = useState(false)
  const [vivo, setVivo] = useState(null)       // o evento que acabou de chegar, no aviso do canto
  useEffect(() => { const f = () => prepararSom(); window.addEventListener('pointerdown', f, { once: true }); return () => window.removeEventListener('pointerdown', f) }, [])
  const [largo, setLargo] = useState(() => window.innerWidth >= LARGURA_MINIMA)
  useEffect(() => { const f = () => setLargo(window.innerWidth >= LARGURA_MINIMA); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])

  const [dia, setDia] = useState(null)
  const [servicos, setServicos] = useState([])
  const [profs, setProfs] = useState([])
  const [clientes, setClientes] = useState([])
  const catsTodas = useCategorias()
  const cats = useMemo(() => categoriasDoSalao(catsTodas, salao?.id), [catsTodas, salao?.id])
  const [painel, setPainel] = useState('agenda')
  const [modo, setModo] = useState(() => { try { return localStorage.getItem('mimo-pdv-modo') || 'quadro' } catch { return 'quadro' } })
  const [horas, setHoras] = useState([])
  const [diaSel, setDiaSel] = useState(() => hojeIso())
  const [semana, setSemana] = useState([])
  function trocarModo(m) { setModo(m); try { localStorage.setItem('mimo-pdv-modo', m) } catch { /* sem armazenamento */ } }
  const [filtroProf, setFiltroProf] = useState('')
  const [busca, setBusca] = useState('')
  const [cat, setCat] = useState('')
  const [c, setC] = useState(vazia)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [toast, setToast] = useState('')
  const [folha, setFolha] = useState(false)          // a folha de fechar
  const [resultado, setResultado] = useState(null)   // o que o banco devolveu ao fechar
  const [ultima, setUltima] = useState(null)         // a última comanda fechada, para imprimir
  const [salaoInfo, setSalaoInfo] = useState(null)

  const carregar = useCallback(async () => {
    if (!salao?.id) return
    const de = somarDias(inicioDaSemana(diaSel), -7), ate = somarDias(inicioDaSemana(diaSel), 20)
    const [d, s, p, cl, bh, sem, si] = await Promise.all([
      supabase.rpc('pdv_dia', { salao: salao.id, dia: diaSel }),
      supabase.from('services').select('id, name, price, duration_minutes, categoria_id, active').eq('salon_id', salao.id).eq('active', true).order('name'),
      supabase.from('professionals').select('id, name, photo_url, active').eq('salon_id', salao.id).eq('active', true).order('name'),
      supabase.rpc('clientes_do_salao', { salao: salao.id }),
      supabase.from('business_hours').select('weekday, open, start_time, end_time').eq('salon_id', salao.id),
      supabase.rpc('pdv_dias', { salao: salao.id, de, ate }),
      supabase.from('salons').select('name, address, city, cnpj').eq('id', salao.id).maybeSingle(),
    ])
    if (d.error) setErro(d.error.message); else setDia(d.data)
    setHoras(bh.data ?? [])
    setSemana(sem.data ?? [])
    if (si?.data) setSalaoInfo(si.data)
    setServicos(s.data ?? []); setProfs(p.data ?? []); setClientes(cl.data ?? [])
  }, [salao?.id, diaSel])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { if (diaSel !== hojeIso()) return; const t = setInterval(carregar, 60000); return () => clearInterval(t) }, [carregar, diaSel])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])
  const { eventos, naoVistos, marcarVistos } = useMovimentacao({ salaoId: salao?.id, userId: user?.id, ligado: largo, som, onEvento: (ev) => { setVivo(ev); carregar() } })
  useEffect(() => { if (!vivo) return; const t = setTimeout(() => setVivo(null), 7000); return () => clearTimeout(t) }, [vivo])
  useEffect(() => { const base = 'MIMO · PDV'; document.title = naoVistos > 0 ? `(${naoVistos}) ${base}` : base; return () => { document.title = 'MIMO' } }, [naoVistos])
  function trocarSom(v) { setSom(v); try { localStorage.setItem('mimo-pdv-som', v ? '1' : '0') } catch { /* sem armazenamento */ } if (v) tocar('novo') }

  const grupos = useMemo(() => agruparPorCategoria(servicos, cats), [servicos, cats])
  const visiveis = useMemo(() => servicos.filter((s) => (!cat || (s.categoria_id ?? '') === cat) && (!busca || bate(s.name, busca))), [servicos, cat, busca])
  const agenda = useMemo(() => (dia?.agenda ?? []).filter((a) => !filtroProf || a.professional_id === filtroProf), [dia, filtroProf])
  // a lista da esquerda agrupa a visita: horários abertos da mesma cliente no dia viram um cartão só
  const lista = useMemo(() => {
    const todos = [...(dia?.agenda ?? [])].sort((x, y) => String(x.start_time).localeCompare(String(y.start_time)))
    const aberto = (a) => a.client_id && !a.comanda_id && (a.status === 'pendente' || a.status === 'confirmado')
    const grupos = new Map()
    for (const a of todos) if (aberto(a)) grupos.set(a.client_id, [...(grupos.get(a.client_id) ?? []), a])
    const vistos = new Set(); const out = []
    for (const a of todos) {
      if (vistos.has(a.id)) continue
      const g = aberto(a) ? grupos.get(a.client_id) : null
      if (g && g.length > 1) { g.forEach((x) => vistos.add(x.id)); if (!filtroProf || g.some((x) => x.professional_id === filtroProf)) out.push({ visita: true, id: 'v-' + a.id, horarios: g }) }
      else if (!filtroProf || a.professional_id === filtroProf) out.push(a)
    }
    return out
  }, [dia, filtroProf])

  const subtotal = c.itens.reduce((s, i) => s + i.preco_cents * i.qtd, 0)
  const desconto = Math.min(subtotal, reais(c.desconto))
  const total = subtotal - desconto
  const visitaInclusa = c.visita.filter((v) => v.incluido)
  const sinal = Math.min(total, Number(c.sinal ?? 0) + visitaInclusa.reduce((s, v) => s + (v.pago_cents ?? 0), 0))
  const variasProfs = new Set(c.itens.map((i) => i.professional_id || c.professional_id).filter(Boolean)).size > 1
  // a comanda agrupada por quem fez cada serviço: é assim que a cliente avalia e é assim que o repasse separa
  const porQuem = useMemo(() => {
    const ordem = []; const mapa = new Map()
    c.itens.forEach((i, k) => {
      const pid = i.professional_id || c.professional_id || ''
      if (!mapa.has(pid)) { mapa.set(pid, { id: pid, nome: profs.find((p) => p.id === pid)?.name ?? i.profissional ?? 'Sem profissional', itens: [], soma: 0 }); ordem.push(pid) }
      const g = mapa.get(pid); g.itens.push({ i, k }); g.soma += i.preco_cents * i.qtd
    })
    return ordem.map((id) => mapa.get(id))
  }, [c.itens, c.professional_id, profs])
  const profDoItem = (k, pid) => setC((x) => ({ ...x, itens: x.itens.map((i, j) => (j === k ? { ...i, professional_id: pid, profissional: profs.find((p) => p.id === pid)?.name ?? null } : i)) }))
  const podeAbrirCaixa = c.itens.length > 0 && c.professional_id && c.itens.every((i) => i.professional_id || c.professional_id) && (c.client_id || c.cliente.trim()) && total >= 0

  function abrirHorario(a) {
    if (a.comanda_id) { setToast('Este horário já tem comanda fechada. Veja no Caixa.'); return }
    if (diaSel > hojeIso()) { setToast('Esse horário é de outro dia. A comanda fecha no dia do atendimento.'); return }
    if (a.status !== 'pendente' && a.status !== 'confirmado') { setToast(`Este horário está ${a.status}.`); return }
    // a visita inteira: os outros horários dela hoje, ainda abertos, entram na mesma comanda (mesmo com outra profissional)
    const outros = (dia?.agenda ?? []).filter((o) => o.id !== a.id && a.client_id && o.client_id === a.client_id && !o.comanda_id && (o.status === 'pendente' || o.status === 'confirmado'))
      .sort((x, y) => String(x.start_time).localeCompare(String(y.start_time)))
    const visita = outros.map((o) => ({ appointment_id: o.id, professional_id: o.professional_id ?? '', profissional: o.profissional ?? null, hora: String(o.start_time ?? '').slice(0, 5), servico: o.servico ?? (o.itens ?? []).map((i) => i.nome).join(' + '), pago_cents: o.pago_cents ?? 0, itens: itensDoHorario(o), incluido: true }))
    setC({ ...vazia(), appointment_id: a.id, client_id: a.client_id, cliente: a.cliente, professional_id: a.professional_id ?? '', itens: [...itensDoHorario(a), ...visita.flatMap((v) => v.itens)], sinal: a.pago_cents ?? 0, visita })
    setErro('')
    if (outros.length) setToast(`${String(a.cliente ?? '').split(' ')[0]} tem mais ${outros.length === 1 ? 'um horário' : `${outros.length} horários`} hoje. Entrou tudo na mesma comanda.`)
  }
  function alternarVisita(id) {
    setC((x) => {
      const visita = x.visita.map((v) => (v.appointment_id === id ? { ...v, incluido: !v.incluido } : v))
      const v = visita.find((y) => y.appointment_id === id)
      const itens = v.incluido ? [...x.itens, ...v.itens] : x.itens.filter((i) => i.appointment_id !== id)
      return { ...x, visita, itens }
    })
  }
  function addItem(s) {
    setC((x) => {
      const k = x.itens.findIndex((i) => i.service_id === s.id && (i.appointment_id ?? null) === (x.appointment_id ?? null))
      const novo = { service_id: s.id, nome: s.name, preco_cents: Math.round(Number(s.price) * 100), qtd: 1, duracao: s.duration_minutes, appointment_id: x.appointment_id ?? null, professional_id: x.professional_id || null, profissional: null }
      const itens = k >= 0 ? x.itens.map((i, j) => (j === k ? { ...i, qtd: i.qtd + 1 } : i)) : [...x.itens, novo]
      return { ...x, itens }
    })
  }
  const qtd = (k, d) => setC((x) => ({ ...x, itens: x.itens.map((i, j) => (j === k ? { ...i, qtd: Math.max(1, i.qtd + d) } : i)) }))
  const tirar = (k) => setC((x) => ({ ...x, itens: x.itens.filter((_, j) => j !== k) }))
  const preco = (k, v) => setC((x) => ({ ...x, itens: x.itens.map((i, j) => (j === k ? { ...i, preco_cents: reais(v) } : i)) }))
  function escolherCliente(nome) {
    const achou = clientes.find((x) => x.nome?.toLowerCase() === nome.trim().toLowerCase())
    setC((x) => ({ ...x, cliente: nome, client_id: achou?.client_id ?? null }))
  }

  async function fechar(pagamentos, opcoes) {
    setOcupado(true); setErro('')
    const { data, error } = await supabase.rpc('pdv_fechar', { salao: salao.id, comanda: {
      appointment_id: c.appointment_id, appointment_ids: [c.appointment_id, ...visitaInclusa.map((v) => v.appointment_id)].filter(Boolean),
      client_id: c.client_id, cliente_nome: c.client_id ? null : c.cliente.trim(), professional_id: c.professional_id,
      itens: c.itens.map((i) => ({ ...i, professional_id: i.professional_id || c.professional_id, appointment_id: i.appointment_id ?? c.appointment_id ?? null })), desconto_cents: desconto, observacao: c.observacao || null, enviar_cupom: Boolean(opcoes?.enviarCupom),
      pagamentos: pagamentos.map((p) => ({ forma: p.forma, valor_cents: Number(p.valor_cents), recebido_cents: p.recebido_cents ?? null, detalhe: p.detalhe ?? null, parcelas: p.parcelas ?? null })),
    } })
    setOcupado(false)
    if (error) { setErro(error.message); return }
    const prof = profs.find((x) => x.id === c.professional_id)
    const nomesProfs = [...new Set(c.itens.map((i) => profs.find((p) => p.id === (i.professional_id || c.professional_id))?.name ?? i.profissional).filter(Boolean))]
    setUltima({ salao: { nome: salaoInfo?.name ?? salao?.name, endereco: salaoInfo?.address, cidade: salaoInfo?.city, cnpj: salaoInfo?.cnpj }, cliente: c.cliente, itens: c.itens, desconto, total, atendidaPor: nomesProfs.join(' e ') || prof?.name,
      quando: new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), comandaId: data?.comanda_id,
      pagamentos: [...(sinal > 0 ? [{ forma: 'app', valor_cents: sinal, troco_cents: 0 }] : []), ...pagamentos] })
    setResultado({ comanda_id: data?.comanda_id, cupom: Boolean(data?.cupom), total: data?.total_cents ?? total })
    carregar()
  }
  function novaComanda() { setResultado(null); setFolha(false); setC(vazia()); setErro('') }
  async function estornar(cm) {
    const ok = await confirmar({ titulo: 'Estornar esta comanda?', texto: `${formatCents(cm.total_cents)} de ${cm.cliente}. O caixa é corrigido e o horário volta para "confirmado", para fechar de novo.`, ok: 'Estornar' })
    if (!ok) return
    const { error } = await supabase.rpc('pdv_estornar', { comanda: cm.id, motivo: 'estornada no PDV' })
    if (error) setErro(error.message); else { setToast('Comanda estornada.'); carregar() }
  }
  function sairDoPdv() { try { sessionStorage.setItem('mimo-pdv-pausado', '1') } catch { /* sem armazenamento */ } navigate('/admin') }

  if (!largo) {
    return (
      <AdminShell>
        <div className="page-head"><div><h2>PDV do balcão</h2><p className="muted">{salao?.name}</p></div></div>
        <div className="card pdv-so-desktop">
          <span className="aj-cartao-icone aj-verde"><Monitor size={22} /></span>
          <strong>O PDV é para o computador do balcão.</strong>
          <p className="muted">Ele usa a tela inteira: agenda do dia de um lado, catálogo no meio, comanda do outro. No celular não cabe. Abra <strong>{window.location.host}</strong> no computador ou num tablet deitado, entre com a sua conta e toque em Ajustes › PDV do balcão.</p>
          <p className="muted">Enquanto isso, o fechamento do dia pelo celular continua em Início › Fechar o dia.</p>
          <Link to="/admin/ajustes" className="btn btn-ghost btn-block">Voltar aos ajustes</Link>
        </div>
      </AdminShell>
    )
  }

  const caixa = dia?.caixa ?? { total_cents: 0, por_forma: [], por_profissional: [] }
  return (
    <div className="pdv">
      <header className="pdv-topo">
        <span className="brand-inline"><MarcaIcon className="marca" id="pdv" /><Wordmark tamanho={1.2} /></span>
        <div className="pdv-modos" role="tablist">
          <button type="button" role="tab" className={modo === 'quadro' ? 'active' : ''} onClick={() => trocarModo('quadro')}><CalendarDays size={14} /> Quadro</button>
          <button type="button" role="tab" className={modo === 'comanda' ? 'active' : ''} onClick={() => trocarModo('comanda')}><Receipt size={14} /> Comanda</button>
        </div>
        <span className="pdv-topo-salao"><strong>{salao?.name}</strong><span className="muted">{capitalizar(new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))}</span></span>
        <div className="pdv-topo-caixa">
          <span className="pdv-chip forte" title="Tudo que entrou hoje, no balcão e pelo app">Caixa do dia <strong>{formatCents(caixa.total_cents)}</strong></span>
          {caixa.app_cents > 0 && <span className="pdv-chip" title="Sinais pagos pelo app, já na conta de recebimento">pelo app <strong>{formatCents(caixa.app_cents)}</strong></span>}
          {(caixa.por_forma ?? []).filter((f) => f.forma !== 'app').map((f) => <span key={f.forma} className="pdv-chip">{ROTULO_FORMA[f.forma] ?? f.forma} <strong>{formatCents(f.valor_cents)}</strong></span>)}
        </div>
        <div className="pdv-topo-acoes">
          <button type="button" className={'pdv-sino' + (naoVistos > 0 ? ' tem' : '')} onClick={() => { setFeed((v) => !v); marcarVistos() }} aria-label="Movimentação" title="Movimentação ao vivo"><Bell size={16} />{naoVistos > 0 && <span className="pdv-sino-conta">{naoVistos > 9 ? '9+' : naoVistos}</span>}</button>
          <button type="button" className="pdv-sino" onClick={() => trocarSom(!som)} aria-label={som ? 'Silenciar' : 'Ligar o som'} title={som ? 'Som ligado' : 'Som desligado'}>{som ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
          <Link to="/admin/agenda" className="btn btn-ghost btn-mini"><LayoutDashboard size={14} /> Painel</Link>
          <button type="button" className="btn btn-ghost btn-mini" onClick={sairDoPdv}><LogOut size={14} /> Sair do PDV</button>
        </div>
      </header>

      {modo === 'quadro' ? (
        <div className="pdv-corpo pdv-corpo-quadro">
          <div className="pdv-painel pdv-quadro-painel">
            <QuadroDoDia dia={diaSel} agenda={dia?.dia === diaSel ? (dia?.agenda ?? []) : []} semana={semana} onTrocarDia={setDiaSel} profs={profs} horas={horas} servicos={servicos} cats={cats} clientes={clientes} salaoId={salao?.id}
              onAbrirComanda={(a) => { abrirHorario(a); trocarModo('comanda') }} onMudou={carregar} />
          </div>
        </div>
      ) : (
      <div className="pdv-corpo">
        <aside className="pdv-painel pdv-agenda">
          <div className="tabs pdv-tabs" role="tablist">
            <button role="tab" className={'tab' + (painel === 'agenda' ? ' active' : '')} onClick={() => setPainel('agenda')}>Agenda de hoje</button>
            <button role="tab" className={'tab' + (painel === 'caixa' ? ' active' : '')} onClick={() => setPainel('caixa')}>Caixa</button>
          </div>
          {painel === 'agenda' ? (
            <>
              <div className="chips pdv-chips">
                <button type="button" className={'chip' + (!filtroProf ? ' active' : '')} onClick={() => setFiltroProf('')}>Todas</button>
                {profs.map((p) => <button key={p.id} type="button" className={'chip' + (filtroProf === p.id ? ' active' : '')} onClick={() => setFiltroProf(p.id)}>{p.name.split(' ')[0]}</button>)}
              </div>
              <button type="button" className="btn btn-primary btn-block pdv-avulsa" onClick={() => { setC(vazia()); setErro('') }}><Plus size={15} /> Comanda avulsa</button>
              <div className="pdv-lista">
                {!dia ? <p className="muted">Carregando…</p> : lista.length === 0 ? <p className="muted">Nenhum horário hoje{filtroProf ? ' para ela' : ''}.</p> : lista.map((a) => a.visita ? (
                  <button key={a.id} type="button" className={'pdv-horario pdv-visita-cartao' + (a.horarios.some((h) => h.id === c.appointment_id) ? ' ativo' : '')} onClick={() => abrirHorario(a.horarios[0])}>
                    <span className="pdv-hora">{a.horarios[0].start_time.slice(0, 5)}</span>
                    <span className="pdv-horario-texto">
                      <strong>{a.horarios[0].cliente}</strong>
                      {a.horarios.map((h) => <span key={h.id} className="muted"><b>{h.start_time.slice(0, 5)}</b> {h.servico}{h.profissional ? ` · ${h.profissional.split(' ')[0]}` : ''}</span>)}
                    </span>
                    <span className="pdv-horario-lado">
                      <span>{formatCents(a.horarios.reduce((t, h) => t + (h.price_cents ?? 0), 0))}</span>
                      <em className="pdv-selo visita"><Users size={11} /> {a.horarios.length} horários</em>
                      {a.horarios.some((h) => h.pago_cents > 0) && <em className="pdv-selo app">sinal {formatCents(a.horarios.reduce((t, h) => t + (h.pago_cents ?? 0), 0))}</em>}
                    </span>
                  </button>
                ) : (
                  <button key={a.id} type="button" className={'pdv-horario' + (a.id === c.appointment_id ? ' ativo' : '') + (a.comanda_id ? ' fechado' : '') + (a.status === 'concluido' && !a.comanda_id ? ' concluido' : '')} onClick={() => abrirHorario(a)}>
                    <span className="pdv-hora">{a.start_time.slice(0, 5)}</span>
                    <span className="pdv-horario-texto">
                      <strong>{a.cliente}</strong>
                      <span className="muted">{a.servico}{a.profissional ? ` · ${a.profissional.split(' ')[0]}` : ''}</span>
                    </span>
                    <span className="pdv-horario-lado">
                      <span>{formatCents(a.price_cents ?? 0)}</span>
                      {a.comanda_id ? <em className="pdv-selo ok"><CircleCheck size={11} /> fechado</em> : a.pago_cents > 0 ? <em className="pdv-selo app">sinal {formatCents(a.pago_cents)}</em> : <em className={'pdv-selo ' + a.status}>{a.status}</em>}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="pdv-lista">
              <div className="pdv-caixa-resumo">
                {(caixa.por_profissional ?? []).map((p) => <div key={p.professional_id ?? p.nome} className="pdv-caixa-linha"><span>{p.nome ?? 'Sem profissional'}</span><strong>{formatCents(p.valor_cents)}</strong><span className="muted">{p.comandas} {p.comandas === 1 ? 'comanda' : 'comandas'}</span></div>)}
                {(caixa.por_profissional ?? []).length === 0 && <p className="muted">Nenhuma comanda fechada hoje.</p>}
                <Link to="/admin/repasses" className="pdv-caixa-link"><HandCoins size={13} /> O que é de quem, no período</Link>
              </div>
              {(dia?.comandas ?? []).map((cm) => (
                <div key={cm.id} className={'pdv-comanda-fechada' + (cm.status === 'estornada' ? ' estornada' : '')}>
                  <span className="pdv-hora">{new Date(cm.fechada_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="pdv-horario-texto">
                    <strong>{cm.cliente}</strong>
                    <span className="muted">{(cm.itens ?? []).map((i) => i.nome).join(', ')}{cm.profissional ? ` · ${cm.profissional.split(' ')[0]}` : ''}</span>
                    <span className="muted">{(cm.pagamentos ?? []).map((p) => `${ROTULO_FORMA[p.forma] ?? p.forma} ${formatCents(p.valor_cents)}`).join(' · ')}{cm.status === 'estornada' ? ' · estornada' : ''}</span>
                  </span>
                  <span className="pdv-horario-lado"><span>{formatCents(cm.total_cents)}</span>{cm.status === 'fechada' && <button type="button" className="btn-mini btn-mini-neutro" onClick={() => estornar(cm)}><RotateCcw size={11} /> estornar</button>}</span>
                </div>
              ))}
            </div>
          )}
        </aside>

        <section className="pdv-painel pdv-catalogo">
          <div className="pdv-busca"><Search size={16} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar serviço…" /></div>
          <div className="chips pdv-chips">
            <button type="button" className={'chip' + (!cat ? ' active' : '')} onClick={() => setCat('')}>Tudo</button>
            {grupos.map((g) => <button key={g.id || 'outros'} type="button" className={'chip' + (cat === g.id ? ' active' : '')} onClick={() => setCat(g.id)}>{g.nome}</button>)}
          </div>
          <div className="pdv-grade">
            {visiveis.map((s) => (
              <button key={s.id} type="button" className="pdv-servico" onClick={() => addItem(s)}>
                <strong>{s.name}</strong>
                <span>{formatCents(Math.round(Number(s.price) * 100))}</span>
                <small className="muted">{s.duration_minutes} min</small>
              </button>
            ))}
            {visiveis.length === 0 && <p className="muted">Nada com esse nome.</p>}
          </div>
        </section>

        <aside className="pdv-painel pdv-comanda">
          <div className="pdv-comanda-topo">
            <h3>{c.appointment_id ? (visitaInclusa.length ? 'Comanda da visita' : 'Comanda do horário') : 'Comanda avulsa'}</h3>
            {(c.itens.length > 0 || c.appointment_id) && <button type="button" className="btn-mini btn-mini-neutro" onClick={() => setC(vazia())}>Limpar</button>}
          </div>
          <label className="pdv-campo"><UserRound size={14} /> Cliente
            {c.appointment_id ? <strong>{c.cliente}</strong> : (
              <>
                <input list="pdv-clientes" value={c.cliente} onChange={(e) => escolherCliente(e.target.value)} placeholder="Nome da cliente (ou escolha da lista)" />
                <datalist id="pdv-clientes">{clientes.map((x) => <option key={x.client_id} value={x.nome} />)}</datalist>
                {c.client_id && <small className="muted">cliente da carteira</small>}
              </>
            )}
          </label>
          {(!c.appointment_id || !c.professional_id) && (
            <label className="pdv-campo">Quem atendeu
              <select value={c.professional_id} onChange={(e) => setC({ ...c, professional_id: e.target.value })}>
                <option value="">escolha…</option>
                {profs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {c.itens.length > 0 && <small className="muted">Cada serviço pode ter a sua: troque no item.</small>}
            </label>
          )}
          {c.visita.length > 0 && (
            <div className="pdv-visita">
              <p><Users size={13} /> Ela continua no salão hoje</p>
              {c.visita.map((v) => (
                <label key={v.appointment_id} className={'pdv-visita-linha' + (v.incluido ? '' : ' fora')}>
                  <input type="checkbox" checked={v.incluido} onChange={() => alternarVisita(v.appointment_id)} />
                  <span><strong>{v.hora}</strong> {v.servico}{v.profissional ? ` · ${v.profissional.split(' ')[0]}` : ''}</span>
                  {v.pago_cents > 0 && <em>sinal {formatCents(v.pago_cents)}</em>}
                </label>
              ))}
              <small className="muted">Tudo numa comanda só, mesmo com outra profissional. Desmarque o que ela paga separado.</small>
            </div>
          )}

          <div className="pdv-itens">
            {c.itens.length === 0 && <p className="muted pdv-vazio">Toque num serviço do catálogo ou puxe um horário da agenda.</p>}
            {porQuem.map((g) => (
              <div key={g.id || 'sem'} className="pdv-grupo">
                {(variasProfs || c.visita.length > 0) && <div className="pdv-grupo-topo"><span><UserRound size={12} /> {g.nome}</span><strong>{formatCents(g.soma)}</strong></div>}
                {g.itens.map(({ i, k }) => (
                  <div key={k} className="pdv-item">
                    <span className="pdv-item-nome">{i.nome}</span>
                    <select className="pdv-item-prof" value={i.professional_id || c.professional_id || ''} onChange={(e) => profDoItem(k, e.target.value)} aria-label="Quem fez este serviço" title="Quem fez este serviço">
                      {!(i.professional_id || c.professional_id) && <option value="">quem?</option>}
                      {profs.map((p) => <option key={p.id} value={p.id}>{p.name.split(' ')[0]}</option>)}
                    </select>
                    <span className="pdv-item-qtd"><button type="button" onClick={() => qtd(k, -1)} aria-label="Menos"><Minus size={12} /></button>{i.qtd}<button type="button" onClick={() => qtd(k, 1)} aria-label="Mais"><Plus size={12} /></button></span>
                    <span className="pdv-item-preco">R$ <input value={emReais(i.preco_cents)} onChange={(e) => preco(k, e.target.value)} inputMode="decimal" /></span>
                    <button type="button" className="pdv-item-tirar" onClick={() => tirar(k)} aria-label="Tirar"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="pdv-totais">
            <div><span>Subtotal</span><strong>{formatCents(subtotal)}</strong></div>
            <div><span>Desconto</span><span className="pdv-totais-input">R$ <input value={c.desconto} onChange={(e) => setC({ ...c, desconto: e.target.value })} inputMode="decimal" placeholder="0,00" /></span></div>
            <div className="pdv-total"><span>Total</span><strong>{formatCents(total)}</strong></div>
            {sinal > 0 && <div><span><Smartphone size={13} /> Já pago pelo app (sinal)</span><strong>− {formatCents(sinal)}</strong></div>}
            {sinal > 0 && <div className="pdv-total pdv-a-receber"><span>A receber agora</span><strong>{formatCents(Math.max(0, total - sinal))}</strong></div>}
          </div>

          {erro && !folha && <div className="alert alert-error">{erro}</div>}
          <button type="button" className="btn btn-primary btn-block pdv-fechar" onClick={() => { setErro(''); setFolha(true) }} disabled={!podeAbrirCaixa || ocupado}><Receipt size={16} /> {sinal > 0 ? `Receber ${formatCents(Math.max(0, total - sinal))}` : `Fechar comanda · ${formatCents(total)}`}</button>
          {!podeAbrirCaixa && c.itens.length > 0 && <p className="muted pdv-vazio">{!c.professional_id ? 'Diga quem atendeu.' : 'Diga quem é a cliente.'}</p>}
          {c.itens.length > 0 && podeAbrirCaixa && <p className="muted pdv-vazio">{sinal > 0 ? `O sinal de ${formatCents(sinal)} pago pelo app já entra abatido. ` : ''}No caixa você escolhe dinheiro, PIX, cartão, vê o troco e manda o cupom para ela.</p>}
        </aside>
      </div>
      )}
      {folha && <FecharComanda total={total} sinal={sinal} itens={c.itens} cliente={c.cliente} temConta={Boolean(c.client_id)} ocupado={ocupado} erro={erro} resultado={resultado}
        onCancelar={() => { if (!ocupado) { setFolha(false); setErro('') } }} onConfirmar={fechar} onImprimir={() => ultima && imprimirCupom(ultima)} onNova={novaComanda} />}
      {vivo && (
        <div className={'pdv-vivo ' + vivo.tipo} role="status" onClick={() => setVivo(null)}>
          <span className="pdv-vivo-icone"><IconeEvento tipo={vivo.tipo} /></span>
          <span className="pdv-vivo-texto"><strong>{vivo.titulo}</strong><span>{vivo.texto}</span></span>
        </div>
      )}
      {feed && (
        <aside className="pdv-feed">
          <div className="pdv-feed-topo"><strong><Bell size={15} /> Movimentação</strong><button type="button" className="icon-btn" onClick={() => setFeed(false)} aria-label="Fechar"><XIcon size={16} /></button></div>
          <p className="muted pdv-feed-dica">Horários novos, pedidos, cancelamentos, PIX que caiu e avisos, na hora em que acontecem. {som ? 'Com som.' : 'Sem som.'}</p>
          <div className="pdv-feed-lista">
            {eventos.length === 0 && <p className="muted">Nada ainda. Fica aqui ouvindo.</p>}
            {eventos.map((ev) => (
              <div key={ev.id} className={'pdv-feed-item ' + ev.tipo}>
                <span className="pdv-vivo-icone"><IconeEvento tipo={ev.tipo} /></span>
                <span className="pdv-vivo-texto"><strong>{ev.titulo}</strong><span>{ev.texto}</span><small className="muted">{new Date(ev.quando).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></span>
              </div>
            ))}
          </div>
        </aside>
      )}
      {toast && <div className="pdv-toast">{toast}</div>}
    </div>
  )
}

const capitalizar = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '')
function IconeEvento({ tipo }) {
  if (tipo === 'novo') return <CalendarPlus size={18} />
  if (tipo === 'cancelou' || tipo === 'faltou') return <CalendarX size={18} />
  if (tipo === 'pago' || tipo === 'estorno') return <Banknote size={18} />
  if (tipo === 'remarcou') return <Clock3 size={18} />
  if (tipo === 'concluido' || tipo === 'status') return <CheckCircle2 size={18} />
  if (tipo === 'aviso') return <MessageSquare size={18} />
  if (tipo === 'avaliacao') return <Star size={18} />
  return <Bell size={18} />
}
const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const somarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const inicioDaSemana = (iso) => { const d = new Date(iso + 'T12:00:00'); return somarDias(iso, -((d.getDay() + 6) % 7)) }
