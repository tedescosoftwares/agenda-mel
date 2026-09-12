import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useDialogo } from '../../context/DialogoContext'
import { formatPreco, formatDuracao } from '../../lib/format'
import { formatDataLonga, iniciais } from '../../lib/booking'
import { CalendarDays, Clock, MapPin, Sparkles, StickyNote, Repeat, CircleCheck, Hourglass, CircleX, Check, ChevronRight } from 'lucide-react'

// A página de um agendamento (2.16): tudo sobre ele num lugar só. É
// para onde os avisos apontam e para onde o cartão da lista leva.
const ESTADO = {
  pendente: { rotulo: 'Aguardando confirmação', Icone: Hourglass, texto: 'A profissional ainda vai confirmar. Você recebe um aviso assim que ela responder.' },
  confirmado: { rotulo: 'Confirmado', Icone: CircleCheck, texto: 'Está tudo certo. Se precisar, dá para remarcar ou cancelar por aqui.' },
  concluido: { rotulo: 'Concluído', Icone: Check, texto: 'Já aconteceu. Que tal contar como foi?' },
  cancelado: { rotulo: 'Cancelado', Icone: CircleX, texto: 'Este horário não vale mais.' },
  faltou: { rotulo: 'Não compareceu', Icone: CircleX, texto: 'Este horário passou sem atendimento.' },
}

export default function ClienteAgendamento() {
  const { id } = useParams()
  const { user } = useAuth()
  const { confirmar } = useDialogo()
  const navigate = useNavigate()
  const [a, setA] = useState(null)
  const [origem, setOrigem] = useState(null)
  const [itens, setItens] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from('appointments')
      .select('*, services (name, price, duration_minutes), professionals (id, name, photo_url), salons (name, address, city, phone, tipo)')
      .eq('id', id).eq('client_id', user.id).maybeSingle()
    if (error) setErro(error.message)
    setA(data ?? null)
    if (data) {
      const { data: it } = await supabase.from('appointment_services').select('id, name, price_cents, duration_minutes, ordem').eq('appointment_id', data.id).order('ordem')
      setItens(it ?? [])
    }
    if (data?.remarca_de) {
      const { data: o } = await supabase.from('appointments').select('id, date, start_time').eq('id', data.remarca_de).maybeSingle()
      setOrigem(o ?? null)
    }
    setLoading(false)
  }, [id, user.id])
  useEffect(() => { carregar() }, [carregar])

  async function cancelar() {
    const troca = Boolean(a.remarca_de) && a.status === 'pendente'
    if (!(await confirmar({ titulo: troca ? 'Desistir da troca?' : 'Cancelar este horário?', texto: troca ? 'Seu horário atual continua valendo.' : `${a.services?.name} em ${formatDataLonga(a.date)} às ${a.start_time.slice(0, 5)}.`, ok: troca ? 'Desistir' : 'Cancelar horário', cancelar: 'Manter', perigo: true }))) return
    const { error } = await supabase.from('appointments').update({ status: 'cancelado' }).eq('id', a.id)
    if (error) setErro(error.message); else carregar()
  }

  if (loading) return <ClienteShell titulo="Agendamento" voltar="/cliente/meus-agendamentos"><p className="muted">Carregando…</p></ClienteShell>
  if (!a) return <ClienteShell titulo="Agendamento" voltar="/cliente/meus-agendamentos"><div className="card empty-state"><p>Não encontramos esse agendamento.</p>{erro && <p className="muted">{erro}</p>}</div></ClienteShell>

  const troca = Boolean(a.remarca_de) && a.status === 'pendente'
  const est = ESTADO[a.status] ?? ESTADO.pendente
  const futuro = new Date(`${a.date}T${a.start_time}`) > new Date()
  const podeMexer = futuro && (a.status === 'pendente' || a.status === 'confirmado')
  const preco = a.price_cents != null ? a.price_cents / 100 : a.services?.price
  const duracao = a.services?.duration_minutes ?? minutosEntre(a.start_time, a.end_time)
  const salao = a.salons
  const endereco = [salao?.address, salao?.city].filter(Boolean).join(' · ')
  const mapa = endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([salao?.name, salao?.address, salao?.city].filter(Boolean).join(', '))}` : null

  return (
    <ClienteShell titulo="Agendamento" voltar="/cliente/meus-agendamentos">
      <div className={'card agdt-topo ' + a.status}>
        <span className={`badge badge-${troca ? 'remarcacao' : a.status}`}><est.Icone size={13} /> {troca ? 'Troca aguardando' : est.rotulo}</span>
        <h2 className="agdt-servico">{a.services?.name ?? a.service_name}</h2>
        <p className="agdt-quando"><CalendarDays size={18} /> <span><strong>{capitalizar(formatDataLonga(a.date))}</strong><br />às {a.start_time.slice(0, 5)}{a.end_time ? ` · até ${a.end_time.slice(0, 5)}` : ''}</span></p>
        <p className="muted agdt-nota">{troca && origem ? `No lugar de ${formatDataLonga(origem.date)} às ${origem.start_time.slice(0, 5)}. Até ela responder, o horário de antes continua valendo.` : est.texto}</p>
      </div>

      {a.professionals && (
        <Link to={`/cliente/profissional/${a.professionals.id}`} className="card agdt-linha agdt-link">
          <span className="agdt-avatar">{a.professionals.photo_url ? <img src={a.professionals.photo_url} alt="" /> : iniciais(a.professionals.name)}</span>
          <span className="cliente-info"><span className="muted agdt-rotulo">Com</span><span className="cliente-nome"><span className="nome-txt">{a.professionals.name}</span></span></span>
          <ChevronRight size={18} className="agdt-seta" />
        </Link>
      )}

      <div className="card agdt-dados">
        {salao && (
          <div className="agdt-item"><MapPin size={18} /><span><span className="muted agdt-rotulo">Onde</span><strong>{salao.name}</strong>{endereco && <span className="muted">{endereco}</span>}{mapa && <a href={mapa} target="_blank" rel="noreferrer" className="agdt-mapa">Como chegar</a>}</span></div>
        )}
        {itens.length > 1 ? (
          <div className="agdt-item"><Sparkles size={18} /><span><span className="muted agdt-rotulo">Serviços</span>
            <ul className="agdt-itens">{itens.map((x) => <li key={x.id}><span>{x.name}</span><span className="muted">{formatDuracao(x.duration_minutes)} · {formatPreco(x.price_cents / 100)}</span></li>)}</ul>
            <strong>{[preco != null ? formatPreco(preco) : null, duracao ? formatDuracao(duracao) : null].filter(Boolean).join(' · ')} no total</strong></span></div>
        ) : (
          <div className="agdt-item"><Sparkles size={18} /><span><span className="muted agdt-rotulo">Serviço</span><strong>{a.services?.name ?? a.service_name}</strong><span className="muted">{[preco != null ? formatPreco(preco) : null, duracao ? formatDuracao(duracao) : null].filter(Boolean).join(' · ')}</span></span></div>
        )}
        {a.notes && <div className="agdt-item"><StickyNote size={18} /><span><span className="muted agdt-rotulo">Sua observação</span><span>{a.notes}</span></span></div>}
        <div className="agdt-item"><Clock size={18} /><span><span className="muted agdt-rotulo">Pedido feito</span><span>{new Date(a.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span></span></div>
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}

      <div className="agdt-acoes">
        {podeMexer && !troca && a.service_id && (
          <Link className="btn btn-primary btn-block" to={`/cliente/agendamento/data?prof=${a.professional_id}&servico=${a.service_id}&remarcar=${a.id}`}><Repeat size={16} /> Remarcar</Link>
        )}
        {podeMexer && <button className="btn btn-ghost btn-block" onClick={cancelar}>{troca ? 'Desistir da troca' : 'Cancelar horário'}</button>}
        {!podeMexer && a.professionals && a.service_id && (
          <Link className="btn btn-primary btn-block" to={`/cliente/profissional/${a.professionals.id}/servicos?servico=${a.service_id}`}>Marcar de novo</Link>
        )}
        {a.status === 'concluido' && <Link className="btn btn-ghost btn-block" to="/cliente/meus-agendamentos?aba=historico">Avaliar</Link>}
      </div>
    </ClienteShell>
  )
}

function minutosEntre(ini, fim) {
  if (!ini || !fim) return null
  const [h1, m1] = ini.split(':').map(Number), [h2, m2] = fim.split(':').map(Number)
  return h2 * 60 + m2 - (h1 * 60 + m1)
}
function capitalizar(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }
