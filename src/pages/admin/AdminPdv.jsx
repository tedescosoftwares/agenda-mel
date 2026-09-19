import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Monitor, Search, Plus, Minus, Trash2, Banknote, CreditCard, QrCode, Smartphone, RotateCcw, LogOut, LayoutDashboard, UserRound, Receipt, CircleCheck } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import { useAuth } from '../../context/AuthContext'
import { useDialogo } from '../../context/DialogoContext'
import { supabase } from '../../lib/supabase'
import { formatCents } from '../../lib/pagamento'
import { useCategorias, categoriasDoSalao, agruparPorCategoria, bate } from '../../lib/categorias'
import { MarcaIcon, Wordmark } from '../../components/icons'
import QuadroDoDia from '../../components/QuadroDoDia'
import { CalendarDays } from 'lucide-react'

// O PDV do balcão (102): tela cheia, feita para o computador do salão.
// Esquerda, a agenda de hoje (ou o caixa); centro, o catálogo; direita,
// a comanda. Puxa o horário da cliente, acrescenta o que ela fez, dá o
// desconto, registra como pagou (o sinal do app já vem abatido) e fecha.
// Fechar conclui o atendimento na agenda e deixa o rastro no caixa.
const FORMAS = [['dinheiro', 'Dinheiro', Banknote], ['debito', 'Débito', CreditCard], ['credito', 'Crédito', CreditCard], ['pix', 'PIX na hora', QrCode], ['outro', 'Outro', Receipt]]
const ROTULO_FORMA = { dinheiro: 'dinheiro', debito: 'débito', credito: 'crédito', pix: 'PIX', app: 'pelo app', outro: 'outro' }
const LARGURA_MINIMA = 900
const vazia = () => ({ appointment_id: null, client_id: null, cliente: '', professional_id: '', itens: [], sinal: 0, desconto: '', pagamentos: [], observacao: '' })
const reais = (t) => { const n = Number(String(t ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0 }
const emReais = (c) => (Number(c ?? 0) / 100).toFixed(2).replace('.', ',')

export default function AdminPdv() {
  const { salao } = useAuth()
  const { confirmar } = useDialogo()
  const navigate = useNavigate()
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
  function trocarModo(m) { setModo(m); try { localStorage.setItem('mimo-pdv-modo', m) } catch { /* sem armazenamento */ } }
  const [filtroProf, setFiltroProf] = useState('')
  const [busca, setBusca] = useState('')
  const [cat, setCat] = useState('')
  const [c, setC] = useState(vazia)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [toast, setToast] = useState('')

  const carregar = useCallback(async () => {
    if (!salao?.id) return
    const [d, s, p, cl, bh] = await Promise.all([
      supabase.rpc('pdv_dia', { salao: salao.id }),
      supabase.from('services').select('id, name, price, duration_minutes, categoria_id, active').eq('salon_id', salao.id).eq('active', true).order('name'),
      supabase.from('professionals').select('id, name, photo_url, active').eq('salon_id', salao.id).eq('active', true).order('name'),
      supabase.rpc('clientes_do_salao', { salao: salao.id }),
      supabase.from('business_hours').select('weekday, open, start_time, end_time').eq('salon_id', salao.id).eq('weekday', new Date().getDay()),
    ])
    if (d.error) setErro(d.error.message); else setDia(d.data)
    setHoras(bh.data ?? [])
    setServicos(s.data ?? []); setProfs(p.data ?? []); setClientes(cl.data ?? [])
  }, [salao?.id])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { const t = setInterval(carregar, 60000); return () => clearInterval(t) }, [carregar])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])

  const grupos = useMemo(() => agruparPorCategoria(servicos, cats), [servicos, cats])
  const visiveis = useMemo(() => servicos.filter((s) => (!cat || (s.categoria_id ?? '') === cat) && (!busca || bate(s.name, busca))), [servicos, cat, busca])
  const agenda = useMemo(() => (dia?.agenda ?? []).filter((a) => !filtroProf || a.professional_id === filtroProf), [dia, filtroProf])

  const subtotal = c.itens.reduce((s, i) => s + i.preco_cents * i.qtd, 0)
  const desconto = Math.min(subtotal, reais(c.desconto))
  const total = subtotal - desconto
  const sinal = Math.min(total, Number(c.sinal ?? 0))
  const pago = c.pagamentos.reduce((s, p) => s + Number(p.valor_cents ?? 0), 0)
  const restante = total - sinal - pago
  const podeFechar = c.itens.length > 0 && c.professional_id && (c.client_id || c.cliente.trim()) && restante === 0 && !ocupado

  function abrirHorario(a) {
    if (a.comanda_id) { setToast('Este horário já tem comanda fechada. Veja no Caixa.'); return }
    if (a.status !== 'pendente' && a.status !== 'confirmado') { setToast(`Este horário está ${a.status}.`); return }
    const itens = a.itens?.length ? a.itens.map((i) => ({ ...i, qtd: i.qtd ?? 1 })) : [{ service_id: null, nome: a.servico ?? 'Atendimento', preco_cents: a.price_cents ?? 0, qtd: 1, duracao: 0 }]
    setC({ ...vazia(), appointment_id: a.id, client_id: a.client_id, cliente: a.cliente, professional_id: a.professional_id ?? '', itens, sinal: a.pago_cents ?? 0 })
    setErro('')
  }
  function addItem(s) {
    setC((x) => {
      const k = x.itens.findIndex((i) => i.service_id === s.id)
      const itens = k >= 0 ? x.itens.map((i, j) => (j === k ? { ...i, qtd: i.qtd + 1 } : i)) : [...x.itens, { service_id: s.id, nome: s.name, preco_cents: Math.round(Number(s.price) * 100), qtd: 1, duracao: s.duration_minutes }]
      return { ...x, itens }
    })
  }
  const qtd = (k, d) => setC((x) => ({ ...x, itens: x.itens.map((i, j) => (j === k ? { ...i, qtd: Math.max(1, i.qtd + d) } : i)) }))
  const tirar = (k) => setC((x) => ({ ...x, itens: x.itens.filter((_, j) => j !== k) }))
  const preco = (k, v) => setC((x) => ({ ...x, itens: x.itens.map((i, j) => (j === k ? { ...i, preco_cents: reais(v) } : i)) }))
  function addPagamento(forma) { setC((x) => ({ ...x, pagamentos: [...x.pagamentos, { forma, valor_cents: Math.max(0, restante) }] })) }
  const mudarPag = (k, v) => setC((x) => ({ ...x, pagamentos: x.pagamentos.map((p, j) => (j === k ? { ...p, valor_cents: reais(v) } : p)) }))
  const tirarPag = (k) => setC((x) => ({ ...x, pagamentos: x.pagamentos.filter((_, j) => j !== k) }))
  function escolherCliente(nome) {
    const achou = clientes.find((x) => x.nome?.toLowerCase() === nome.trim().toLowerCase())
    setC((x) => ({ ...x, cliente: nome, client_id: achou?.client_id ?? null }))
  }

  async function fechar() {
    if (!podeFechar) return
    setOcupado(true); setErro('')
    const { data, error } = await supabase.rpc('pdv_fechar', { salao: salao.id, comanda: {
      appointment_id: c.appointment_id, client_id: c.client_id, cliente_nome: c.client_id ? null : c.cliente.trim(), professional_id: c.professional_id,
      itens: c.itens, desconto_cents: desconto, pagamentos: c.pagamentos.map((p) => ({ forma: p.forma, valor_cents: Number(p.valor_cents) })), observacao: c.observacao || null,
    } })
    setOcupado(false)
    if (error) { setErro(error.message); return }
    setToast(`Comanda fechada · ${formatCents(data?.total_cents ?? total)}`)
    setC(vazia())
    carregar()
  }
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
          <span className="pdv-chip forte">Caixa do dia <strong>{formatCents(caixa.total_cents)}</strong></span>
          {(caixa.por_forma ?? []).map((f) => <span key={f.forma} className="pdv-chip">{ROTULO_FORMA[f.forma] ?? f.forma} <strong>{formatCents(f.valor_cents)}</strong></span>)}
        </div>
        <div className="pdv-topo-acoes">
          <Link to="/admin/agenda" className="btn btn-ghost btn-mini"><LayoutDashboard size={14} /> Painel</Link>
          <button type="button" className="btn btn-ghost btn-mini" onClick={sairDoPdv}><LogOut size={14} /> Sair do PDV</button>
        </div>
      </header>

      {modo === 'quadro' ? (
        <div className="pdv-corpo pdv-corpo-quadro">
          <div className="pdv-painel pdv-quadro-painel">
            <QuadroDoDia dia={dia?.dia ?? new Date().toISOString().slice(0, 10)} agenda={dia?.agenda ?? []} profs={profs} horas={horas} servicos={servicos} cats={cats} clientes={clientes} salaoId={salao?.id}
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
                {!dia ? <p className="muted">Carregando…</p> : agenda.length === 0 ? <p className="muted">Nenhum horário hoje{filtroProf ? ' para ela' : ''}.</p> : agenda.map((a) => (
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
            <h3>{c.appointment_id ? 'Comanda do horário' : 'Comanda avulsa'}</h3>
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
          <label className="pdv-campo">Quem atendeu
            <select value={c.professional_id} onChange={(e) => setC({ ...c, professional_id: e.target.value })}>
              <option value="">escolha…</option>
              {profs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          <div className="pdv-itens">
            {c.itens.length === 0 && <p className="muted pdv-vazio">Toque num serviço do catálogo ou puxe um horário da agenda.</p>}
            {c.itens.map((i, k) => (
              <div key={k} className="pdv-item">
                <span className="pdv-item-nome">{i.nome}</span>
                <span className="pdv-item-qtd"><button type="button" onClick={() => qtd(k, -1)} aria-label="Menos"><Minus size={12} /></button>{i.qtd}<button type="button" onClick={() => qtd(k, 1)} aria-label="Mais"><Plus size={12} /></button></span>
                <span className="pdv-item-preco">R$ <input value={emReais(i.preco_cents)} onChange={(e) => preco(k, e.target.value)} inputMode="decimal" /></span>
                <button type="button" className="pdv-item-tirar" onClick={() => tirar(k)} aria-label="Tirar"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>

          <div className="pdv-totais">
            <div><span>Subtotal</span><strong>{formatCents(subtotal)}</strong></div>
            <div><span>Desconto</span><span className="pdv-totais-input">R$ <input value={c.desconto} onChange={(e) => setC({ ...c, desconto: e.target.value })} inputMode="decimal" placeholder="0,00" /></span></div>
            {sinal > 0 && <div><span><Smartphone size={13} /> Sinal pago pelo app</span><strong>− {formatCents(sinal)}</strong></div>}
            <div className="pdv-total"><span>Total</span><strong>{formatCents(total)}</strong></div>
          </div>

          <div className="pdv-pagamentos">
            <span className="muted pdv-pag-rotulo">{restante > 0 ? `Falta ${formatCents(restante)}` : restante < 0 ? `Sobra ${formatCents(-restante)} (troco ou valor a mais)` : total > 0 ? 'Pagamento fechado' : ''}</span>
            {c.pagamentos.map((p, k) => (
              <div key={k} className="pdv-pag">
                <span>{ROTULO_FORMA[p.forma]}</span>
                <span className="pdv-totais-input">R$ <input value={emReais(p.valor_cents)} onChange={(e) => mudarPag(k, e.target.value)} inputMode="decimal" /></span>
                <button type="button" className="pdv-item-tirar" onClick={() => tirarPag(k)} aria-label="Tirar"><Trash2 size={14} /></button>
              </div>
            ))}
            <div className="pdv-formas">
              {FORMAS.map(([k, r, Icon]) => <button key={k} type="button" className="pdv-forma" onClick={() => addPagamento(k)} disabled={total === 0}><Icon size={15} /> {r}</button>)}
            </div>
          </div>

          {erro && <div className="alert alert-error">{erro}</div>}
          <button type="button" className="btn btn-primary btn-block pdv-fechar" onClick={fechar} disabled={!podeFechar}>{ocupado ? 'Fechando…' : `Fechar comanda · ${formatCents(total)}`}</button>
          {!podeFechar && c.itens.length > 0 && <p className="muted pdv-vazio">{!c.professional_id ? 'Diga quem atendeu.' : !(c.client_id || c.cliente.trim()) ? 'Diga quem é a cliente.' : restante !== 0 ? 'Os pagamentos precisam fechar com o total.' : ''}</p>}
        </aside>
      </div>
      )}
      {toast && <div className="pdv-toast">{toast}</div>}
    </div>
  )
}

const capitalizar = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '')
