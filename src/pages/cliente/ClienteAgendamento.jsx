import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import AvaliarModal from '../../components/AvaliarModal'
import { formatCents } from '../../lib/pagamento'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useDialogo } from '../../context/DialogoContext'
import { formatPreco, formatDuracao } from '../../lib/format'
import { formatDataLonga, iniciais } from '../../lib/booking'
import ComoChegar from '../../components/ComoChegar'
import { Receipt } from 'lucide-react'
import { temPino, linksDeRota } from '../../lib/geo'
import { CalendarDays, Clock, MapPin, Sparkles, StickyNote, Repeat, CircleCheck, Hourglass, CircleX, Check, ChevronRight, Users, Star, Wallet } from 'lucide-react'

// A página de um agendamento (2.16): tudo sobre ele num lugar só. É
// para onde os avisos apontam e para onde o cartão da lista leva.
const ESTADO = {
  pendente: { rotulo: 'Aguardando confirmação', Icone: Hourglass, texto: 'A profissional ainda vai confirmar. Você recebe um aviso assim que ela responder.' },
  confirmado: { rotulo: 'Confirmado', Icone: CircleCheck, texto: 'Está tudo certo. Se precisar, dá para remarcar ou cancelar por aqui.' },
  concluido: { rotulo: 'Concluído', Icone: Check, texto: 'Já aconteceu. Que tal contar como foi?' },
  cancelado: { rotulo: 'Cancelado', Icone: CircleX, texto: 'Este horário não vale mais.' },
  faltou: { rotulo: 'Não compareceu', Icone: CircleX, texto: 'Este horário passou sem atendimento.' },
  aguardando_pagamento: { rotulo: 'Aguardando pagamento', Icone: Hourglass, texto: 'Assim que o PIX cair, o pedido vai para a profissional.' },
}

export default function ClienteAgendamento() {
  const { id } = useParams()
  const { user } = useAuth()
  const { confirmar } = useDialogo()
  const navigate = useNavigate()
  const [a, setA] = useState(null)
  const [origem, setOrigem] = useState(null)
  const [itens, setItens] = useState([])
  const [partes, setPartes] = useState([])   // as outras partes da visita (081)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [comandaId, setComandaId] = useState(null)
  const [comandaHorarios, setComandaHorarios] = useState(0)
  const [pagamento, setPagamento] = useState(null)   // o último pagamento deste horário (090)
  const [regras, setRegras] = useState(null)         // modo/sinal do salão
  const [dinheiro, setDinheiro] = useState(null)     // prazo, quanto volta, crédito (094)
  const [avaliada, setAvaliada] = useState(null)   // null = ainda não sei; false = sem avaliação; {nota}
  const [avaliando, setAvaliando] = useState(false)
  const [q, setQ] = useSearchParams()

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from('appointments')
      .select('*, services (name, price, duration_minutes), professionals (id, name, photo_url), salons (id, name, address, city, phone, tipo, lat, lng)')
      .eq('id', id).eq('client_id', user.id).maybeSingle()
    if (error) setErro(error.message)
    setA(data ?? null)
    if (data) {
      const { data: pgs } = await supabase.from('pagamentos').select('id, status, valor_cents, total_cents, sinal_pct, pago_em, estorno_cents, motivo_estorno, liquido_cents, tentativas_estorno').eq('appointment_id', data.id).order('criado_em', { ascending: false }).limit(1)
      setPagamento(pgs?.[0] ?? null)
      if (data.salon_id) supabase.rpc('pagamento_do_salao', { salao: data.salon_id }).then(({ data: r }) => setRegras(r ?? null))
      if (data.pago_cents > 0 || pgs?.[0]) supabase.rpc('regras_do_agendamento', { appt: data.id }).then(({ data: r }) => setDinheiro(r ?? null)); else setDinheiro(null)
      const { data: rv } = await supabase.from('reviews').select('id, nota').eq('appointment_id', data.id).maybeSingle()
      // o comprovante é um só por visita: o horário pode ser o principal da comanda ou um dos outros (appointment_ids)
      const { data: cm } = await supabase.from('comandas').select('id, appointment_ids').eq('status', 'fechada').or(`appointment_id.eq.${data.id},appointment_ids.cs.{${data.id}}`).limit(1).maybeSingle()
      setComandaId(cm?.id ?? null)
      setComandaHorarios((cm?.appointment_ids ?? []).length)
      setAvaliada(rv ?? false)
      const { data: it } = await supabase.from('appointment_services').select('id, name, price_cents, preco_cheio_cents, promocao_id, duration_minutes, ordem').eq('appointment_id', data.id).order('ordem')
      setItens(it ?? [])
      if (data.visita_id) {
        const { data: pv } = await supabase.rpc('partes_da_visita', { appt: data.id })
        setPartes(pv ?? [])
      } else setPartes([])
    }
    if (data?.remarca_de) {
      const { data: o } = await supabase.from('appointments').select('id, date, start_time').eq('id', data.remarca_de).maybeSingle()
      setOrigem(o ?? null)
    }
    setLoading(false)
  }, [id, user.id])
  useEffect(() => { carregar() }, [carregar])

  // veio do push "Como foi com Ana?": abre a folha de estrelas direto
  const podeAvaliar = Boolean(a) && (a.status === 'concluido' || (a.status === 'confirmado' && new Date(`${a.date}T${a.end_time ?? a.start_time}`) < new Date()))
  useEffect(() => {
    if (q.get('avaliar') === '1' && podeAvaliar && avaliada === false) setAvaliando(true)
  }, [q, podeAvaliar, avaliada])
  function fecharAvaliacao() {
    setAvaliando(false)
    if (q.get('avaliar')) setQ({}, { replace: true })
  }

  async function cancelar() {
    const troca = Boolean(a.remarca_de) && a.status === 'pendente'
    let textoPago = ''
    if (a.pago_cents > 0 && dinheiro) {
      textoPago = dinheiro.dentro_do_prazo
        ? ` ${formatCents(dinheiro.volta_cents)} voltam para a sua conta em até 1 dia útil${dinheiro.taxa_cents > 0 ? ` (a taxa do PIX, ${formatCents(dinheiro.taxa_cents)}, não é devolvida)` : ''}. Se preferir, remarque: o sinal vai junto.`
        : ` Como faltam menos de ${dinheiro.horas} h, o sinal de ${formatCents(a.pago_cents)} não volta, mas vira crédito com ${dinheiro.salao ?? 'a profissional'} até ${formatDiaCurto(dinheiro.credito_ate_se_cancelar)}. Remarcar leva o sinal junto e já entra confirmado.`
    }
    if (!(await confirmar({ titulo: troca ? 'Desistir da troca?' : 'Cancelar este horário?', texto: troca ? 'Seu horário atual continua valendo.' : `${a.services?.name} em ${formatDataLonga(a.date)} às ${a.start_time.slice(0, 5)}.${textoPago}`, ok: troca ? 'Desistir' : 'Cancelar horário', cancelar: 'Manter', perigo: true }))) return
    const { error } = await supabase.from('appointments').update({ status: 'cancelado' }).eq('id', a.id)
    if (error) setErro(error.message); else carregar()
  }

  // a visita inteira: esta parte e as outras que ainda valem
  async function cancelarVisita() {
    const vivas = partes.filter((x) => x.status === 'pendente' || x.status === 'confirmado')
    if (!(await confirmar({ titulo: 'Cancelar a visita inteira?', texto: `${a.services?.name ?? a.service_name} e mais ${vivas.length === 1 ? '1 parte' : vivas.length + ' partes'} em ${formatDataLonga(a.date)}.`, ok: 'Cancelar tudo', cancelar: 'Manter', perigo: true }))) return
    const { error } = await supabase.from('appointments').update({ status: 'cancelado' }).in('id', [a.id, ...vivas.map((x) => x.appointment_id)])
    if (error) setErro(error.message); else carregar()
  }

  if (loading) return <ClienteShell titulo="Agendamento" voltar="/cliente/meus-agendamentos"><p className="carregando">Carregando…</p></ClienteShell>
  if (!a) return <ClienteShell titulo="Agendamento" voltar="/cliente/meus-agendamentos"><div className="card empty-state"><p>Não encontramos esse agendamento.</p>{erro && <p className="muted">{erro}</p>}</div></ClienteShell>

  const troca = Boolean(a.remarca_de) && a.status === 'pendente'
  const futuro = new Date(`${a.date}T${a.start_time}`) > new Date()
  const est = a.status === 'confirmado' && !futuro ? { ...ESTADO.confirmado, texto: 'Já aconteceu. Que tal contar como foi?' } : (ESTADO[a.status] ?? ESTADO.pendente)
  const podeMexer = futuro && (a.status === 'pendente' || a.status === 'confirmado' || a.status === 'aguardando_pagamento')
  const preco = a.price_cents != null ? a.price_cents / 100 : a.services?.price
  const duracao = a.services?.duration_minutes ?? minutosEntre(a.start_time, a.end_time)
  const salao = a.salons
  const vivas = partes.filter((x) => x.status === 'pendente' || x.status === 'confirmado')
  const recusadas = partes.filter((x) => x.status === 'cancelado')
  const endereco = [salao?.address, salao?.city].filter(Boolean).join(' · ')
  const pino = temPino(salao?.lat, salao?.lng)
  const mapa = linksDeRota({ lat: salao?.lat, lng: salao?.lng, nome: salao?.name, endereco: salao?.address, cidade: salao?.city })?.google ?? null

  return (
    <ClienteShell titulo="Agendamento" voltar="/cliente/meus-agendamentos">
      <div className={'card agdt-topo ' + a.status}>
        <span className={`badge badge-${troca ? 'remarcacao' : a.status}`}><est.Icone size={13} /> {troca ? 'Troca aguardando' : est.rotulo}</span>
        <h2 className="agdt-servico">{a.services?.name ?? a.service_name}</h2>
        <p className="agdt-quando"><CalendarDays size={18} /> <span><strong>{capitalizar(formatDataLonga(a.date))}</strong><br />às {a.start_time.slice(0, 5)}{a.end_time ? ` · até ${a.end_time.slice(0, 5)}` : ''}</span></p>
        <p className="muted agdt-nota">{troca && origem ? `No lugar de ${formatDataLonga(origem.date)} às ${origem.start_time.slice(0, 5)}. Até ela responder, o horário de antes continua valendo.` : est.texto}</p>
      </div>

      {(a.pago_cents > 0 || pagamento || a.status === 'aguardando_pagamento') && (
        <div className={'card pag-estado ' + (a.status === 'aguardando_pagamento' ? 'aguardando' : pagamento?.status ?? 'pago')}>
          <Wallet size={18} />
          <span>
            {a.status === 'aguardando_pagamento' ? <><strong>Aguardando o PIX</strong><span className="muted">A vaga fica guardada por 15 minutos.</span></>
              : pagamento?.status === 'estorno_pendente' || pagamento?.status === 'estornado' ? <><strong>{pagamento.status === 'estornado' ? 'Devolvido' : pagamento.tentativas_estorno >= 3 ? 'Devolução atrasada' : 'Devolução a caminho'}</strong><span className="muted">{formatCents(pagamento.estorno_cents ?? pagamento.valor_cents)} {pagamento.status === 'estornado' ? 'voltaram' : 'voltam'} para a sua conta.{pagamento.status !== 'estornado' && pagamento.tentativas_estorno >= 3 ? ' Já avisamos a profissional.' : ''}</span></>
              : pagamento?.status === 'credito' ? <><strong>Sinal virou crédito: {formatCents(pagamento.valor_cents)}</strong><span className="muted">Vale até {formatDiaCurto(pagamento.credito_ate)} para marcar de novo com {dinheiro?.salao ?? 'a profissional'}. Entra como sinal, sem pagar de novo.</span></>
              : pagamento?.status === 'retido' ? <><strong>Sinal retido</strong><span className="muted">{pagamento.motivo_estorno?.includes('venceu') ? `O crédito de ${formatCents(pagamento.valor_cents)} passou dos 30 dias sem uso e ficou com a profissional.` : `Cancelado em cima da hora: ${formatCents(pagamento.valor_cents)} ficaram com a profissional.`}</span></>
              : a.pago_cents > 0 ? <><strong>{a.pago_cents < (a.price_cents ?? 0) ? `Sinal pago: ${formatCents(a.pago_cents)}` : `Pago pelo app: ${formatCents(a.pago_cents)}`}</strong>{a.pago_cents < (a.price_cents ?? 0) && <span className="muted">Faltam {formatCents(a.price_cents - a.pago_cents)}, no atendimento.</span>}{podeMexer && dinheiro && <span className="muted">{dinheiro.dentro_do_prazo ? `Cancelando até ${formatQuando(dinheiro.limite)}, ${formatCents(dinheiro.volta_cents)} voltam. Remarcar leva o sinal junto.` : `Passou o prazo de ${dinheiro.horas} h: cancelando, o sinal vira crédito por 30 dias. Remarcar leva o sinal junto.`}</span>}</>
              : <><strong>Pagamento não concluído</strong><span className="muted">{pagamento?.status === 'expirado' ? 'A reserva venceu.' : 'Nenhum PIX confirmado.'}</span></>}
          </span>
          {a.status === 'aguardando_pagamento' && <Link className="btn btn-primary btn-mini" to={`/cliente/pagamento/${a.id}`}>Pagar</Link>}
          {pagamento?.status === 'credito' && a.professionals && a.service_id && <Link className="btn btn-primary btn-mini" to={`/cliente/profissional/${a.professionals.id}/servicos?servico=${a.service_id}`}>Usar</Link>}
          {((pagamento?.status === 'pago' && a.pago_cents > 0) || pagamento?.status === 'estornado' || pagamento?.status === 'estorno_pendente') && <Link className="btn btn-ghost btn-mini" to={`/cliente/pagamento/${a.id}`}>Comprovante</Link>}
        </div>
      )}

      {a.professionals && (
        <Link to={`/cliente/profissional/${a.professionals.id}`} className="card agdt-linha agdt-link">
          <span className="agdt-avatar">{a.professionals.photo_url ? <img src={a.professionals.photo_url} alt="" /> : iniciais(a.professionals.name)}</span>
          <span className="cliente-info"><span className="muted agdt-rotulo">Com</span><span className="cliente-nome"><span className="nome-txt">{a.professionals.name}</span></span></span>
          <ChevronRight size={18} className="agdt-seta" />
        </Link>
      )}

      <div className="card agdt-dados">
        {salao && (
          <div className="agdt-item"><MapPin size={18} /><span><span className="muted agdt-rotulo">Onde</span><strong>{salao.tipo === 'salao' && salao.id ? <Link to={`/cliente/salao/${salao.id}`} className="agdt-salao-link">{salao.name}</Link> : salao.name}</strong>{endereco && <span className="muted">{endereco}</span>}{mapa && !pino && <a href={mapa} target="_blank" rel="noreferrer" className="agdt-mapa">Como chegar</a>}{pino && futuro && a.status !== 'cancelado' && <ComoChegar lat={salao.lat} lng={salao.lng} nome={salao.name} endereco={salao.address} cidade={salao.city} altura={130} />}</span></div>
        )}
        {comandaId && (
          <div className="agdt-item"><Receipt size={18} /><span><span className="muted agdt-rotulo">Comprovante</span><strong>Atendimento fechado no balcão</strong>{comandaHorarios > 1 && <span className="muted">Um comprovante só, com os {comandaHorarios} horários dessa visita.</span>}<Link to={`/cliente/comanda/${comandaId}?de=${a.id}`} className="agdt-mapa">Ver o comprovante</Link></span></div>
        )}
        {itens.length > 1 ? (
          <div className="agdt-item"><Sparkles size={18} /><span><span className="muted agdt-rotulo">Serviços</span>
            <ul className="agdt-itens">{itens.map((x) => <li key={x.id}><span>{x.name}</span><span className="muted">{formatDuracao(x.duration_minutes)} · {x.preco_cheio_cents > x.price_cents ? <><s>{formatPreco(x.preco_cheio_cents / 100)}</s> {formatPreco(x.price_cents / 100)}</> : formatPreco(x.price_cents / 100)}</span></li>)}</ul>
            <strong>{[preco != null ? formatPreco(preco) : null, duracao ? formatDuracao(duracao) : null].filter(Boolean).join(' · ')} no total</strong></span></div>
        ) : (
          <div className="agdt-item"><Sparkles size={18} /><span><span className="muted agdt-rotulo">Serviço</span><strong>{a.services?.name ?? a.service_name}</strong><span className="muted">{a.desconto_cents > 0 && preco != null ? <><s>{formatPreco((a.price_cents + a.desconto_cents) / 100)}</s> {formatPreco(preco)} · promoção</> : preco != null ? formatPreco(preco) : null}{duracao ? `${preco != null ? ' · ' : ''}${formatDuracao(duracao)}` : ''}</span></span></div>
        )}
        {partes.length > 0 && (
          <div className="agdt-item"><Users size={18} /><span><span className="muted agdt-rotulo">Na mesma visita</span>
            <ul className="agdt-partes">
              {partes.map((x) => (
                <li key={x.appointment_id} className={x.status}>
                  <span className="agdt-parte-hora">{String(x.inicio).slice(0, 5)}</span>
                  <span className="agdt-parte-oque"><strong>{x.servico}</strong><span className="muted">com {x.profissional}{x.price_cents != null ? ` · ${formatPreco(x.price_cents / 100)}` : ''}</span></span>
                  <span className={`badge badge-${x.status}`}>{PARTE[x.status] ?? x.status}</span>
                </li>
              ))}
            </ul>
            <span className="muted">Cada profissional confirma a parte dela.</span></span></div>
        )}
        {a.notes && <div className="agdt-item"><StickyNote size={18} /><span><span className="muted agdt-rotulo">Sua observação</span><span>{a.notes}</span></span></div>}
        <div className="agdt-item"><Clock size={18} /><span><span className="muted agdt-rotulo">Pedido feito</span><span>{new Date(a.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span></span></div>
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}

      {recusadas.length > 0 && podeMexer && (
        <div className="card visita-decisao">
          <strong>{recusadas.map((x) => `${x.profissional} não pôde fazer ${x.servico}`).join('. ')}.</strong>
          <span className="muted">O resto da visita continua como está. O que você prefere?</span>
          <div className="visita-decisao-acoes">
            {recusadas.map((x) => x.service_id && (
              <Link key={x.appointment_id} className="btn btn-primary btn-mini" to={`/cliente/profissional/${x.professional_id}/servicos?servico=${x.service_id}`}>Marcar {x.servico} outro dia</Link>
            ))}
            <span className="muted visita-decisao-ou">ou manter só {a.services?.name ?? a.service_name}{vivas.length ? ' e o resto' : ''}: não precisa fazer nada.</span>
          </div>
        </div>
      )}

      <div className="agdt-acoes">
        {podeMexer && regras && regras.modo !== 'nao' && a.pago_cents === 0 && a.status !== 'aguardando_pagamento' && (
          <Link className="btn btn-primary btn-block" to={`/cliente/pagamento/${a.id}`}><Wallet size={16} /> Pagar agora pelo app</Link>
        )}
        {podeMexer && !troca && a.service_id && (
          <Link className={'btn btn-block ' + (regras && regras.modo !== 'nao' && a.pago_cents === 0 ? 'btn-ghost' : 'btn-primary')} to={`/cliente/agendamento/data?prof=${a.professional_id}&servico=${a.service_id}&remarcar=${a.id}`}><Repeat size={16} /> Remarcar</Link>
        )}
        {podeMexer && <button className="btn btn-ghost btn-block" onClick={cancelar}>{troca ? 'Desistir da troca' : vivas.length ? 'Cancelar só esta parte' : 'Cancelar horário'}</button>}
        {podeMexer && !troca && vivas.length > 0 && <button className="btn btn-ghost btn-block perigo" onClick={cancelarVisita}>Cancelar a visita inteira</button>}
        {podeAvaliar && avaliada === false && <button type="button" className="btn btn-primary btn-block" onClick={() => setAvaliando(true)}><Star size={16} /> Avaliar como foi</button>}
        {!podeMexer && a.professionals && a.service_id && (
          <Link className={'btn btn-block ' + (podeAvaliar && avaliada === false ? 'btn-ghost' : 'btn-primary')} to={`/cliente/profissional/${a.professionals.id}/servicos?servico=${a.service_id}`}>Marcar de novo</Link>
        )}
        {avaliada && <p className="muted agdt-avaliada"><Star size={14} /> Você deu {avaliada.nota} {avaliada.nota === 1 ? 'estrela' : 'estrelas'}. Obrigada por contar!</p>}
      </div>
      {avaliando && a.professionals && <AvaliarModal appt={a} onFechar={fecharAvaliacao} onPronto={() => { fecharAvaliacao(); carregar() }} />}
    </ClienteShell>
  )
}

const PARTE = { pendente: 'Aguardando', confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Recusado', faltou: 'Não foi' }

function minutosEntre(ini, fim) {
  if (!ini || !fim) return null
  const [h1, m1] = ini.split(':').map(Number), [h2, m2] = fim.split(':').map(Number)
  return h2 * 60 + m2 - (h1 * 60 + m1)
}
function capitalizar(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }

function formatDiaCurto(d) {
  if (!d) return ''
  return new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}
function formatQuando(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
