import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDialogo } from '../../context/DialogoContext'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatPreco, formatDuracao, toISODate } from '../../lib/format'
import { formatDataCurta, formatDataLonga, iniciais } from '../../lib/booking'
import { StarIcon } from '../../components/icons'
import ConviteAdiantar from '../../components/ConviteAdiantar'
import OfertaVaga from '../../components/OfertaVaga'
import AvaliarModal from '../../components/AvaliarModal'
import { Repeat, Check, ChevronRight, CalendarDays, Clock, MapPin, Star, Sparkles } from 'lucide-react'

// Meus agendamentos (tela 09, repaginada em 2.20): o próximo horário em
// destaque no topo, os demais em cartões com a data em bloco, e o
// histórico agrupado por mês com as estrelas que ela deu. Tudo abre a
// página do agendamento; as ações rápidas ficam no cartão.
//
// Remarcar é um pedido: aparece como um cartão próprio ("troca
// aguardando"), e o horário atual continua na lista, com uma nota
// dizendo para onde ele quer ir.

const ROTULO = { pendente: 'Aguardando', confirmado: 'Confirmado', concluido: 'Concluído', faltou: 'Não fui', cancelado: 'Cancelado' }

export default function ClienteAgenda() {
  const { confirmar } = useDialogo()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [aba, setAba] = useState(params.get('aba') === 'historico' ? 'historico' : 'proximos')
  const [proximos, setProximos] = useState([])
  const [historico, setHistorico] = useState([])
  const [notas, setNotas] = useState(new Map())
  const [vagas, setVagas] = useState([])
  const [avaliando, setAvaliando] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const carregar = useCallback(async () => {
    const hoje = toISODate(new Date())
    const sel = '*, services (name, price, duration_minutes), professionals (id, name, photo_url), salons (name, city), appointment_offers (id, status, proposed_start_time, previous_start_time, expires_at)'
    const [px, hs, rv, vg] = await Promise.all([
      supabase.from('appointments').select(sel).eq('client_id', user.id).gte('date', hoje).neq('status', 'cancelado').order('date').order('start_time'),
      supabase.from('appointments').select(sel).eq('client_id', user.id).lt('date', hoje).order('date', { ascending: false }).order('start_time', { ascending: false }).limit(40),
      supabase.from('reviews').select('appointment_id, nota').eq('client_id', user.id),
      supabase.from('waitlist_offers').select('*, waitlist_entries (id, services (name), professionals (name))').eq('status', 'pendente').gt('expires_at', new Date().toISOString()),
    ])
    if (px.error) setError(px.error.message)
    // o que é de hoje mas já terminou não é "próximo": vai para o histórico
    const agora = new Date()
    const jaFoi = (a) => new Date(`${a.date}T${a.end_time || a.start_time}`) <= agora
    const lista = (px.data ?? []).filter((a) => !jaFoi(a))
    const passouHoje = (px.data ?? []).filter(jaFoi).reverse()
    const faltam = lista.filter((a) => a.remarca_de && !lista.some((o) => o.id === a.remarca_de)).map((a) => a.remarca_de)
    const extras = faltam.length ? (await supabase.from('appointments').select('id, date, start_time').in('id', faltam)).data ?? [] : []
    setProximos(lista.map((a) => ({ ...a, origem: a.remarca_de ? (lista.find((o) => o.id === a.remarca_de) ?? extras.find((o) => o.id === a.remarca_de) ?? null) : null })))
    setHistorico([...passouHoje, ...(hs.data ?? [])])
    setNotas(new Map((rv.data ?? []).map((r) => [r.appointment_id, r.nota])))
    setVagas(vg.data ?? [])
    setLoading(false)
  }, [user.id])

  useEffect(() => { carregar() }, [carregar])

  async function cancelar(a) {
    const pergunta = ehPedidoDeTroca(a)
      ? 'Seu horário atual continua valendo.'
      : trocaAberta(a)
        ? `${a.services?.name} em ${formatDataCurta(a.date)} às ${a.start_time.slice(0, 5)}. O pedido de troca cai junto.`
        : `${a.services?.name} em ${formatDataCurta(a.date)} às ${a.start_time.slice(0, 5)}.`
    if (!(await confirmar({ titulo: ehPedidoDeTroca(a) ? 'Desistir da troca?' : 'Cancelar este horário?', texto: pergunta, ok: ehPedidoDeTroca(a) ? 'Desistir' : 'Cancelar horário', cancelar: 'Manter', perigo: true }))) return
    const { error } = await supabase.from('appointments').update({ status: 'cancelado' }).eq('id', a.id)
    if (error) setError(error.message)
    else carregar()
  }

  // o pedido de troca aberto de cada horário atual, se houver
  const trocaAberta = (a) => proximos.find((p) => p.remarca_de === a.id && p.status === 'pendente')
  // o destaque: o primeiro horário de verdade (não um pedido de troca)
  const destaque = proximos.find((a) => !ehPedidoDeTroca(a)) ?? null
  const restantes = proximos.filter((a) => a !== destaque)
  const meses = useMemo(() => agruparPorMes(historico), [historico])
  const feitos = historico.filter((a) => a.status === 'concluido').length

  return (
    <ClienteShell titulo="Meus agendamentos">
      <div className="abas">
        <button className={aba === 'proximos' ? 'aba active' : 'aba'} onClick={() => setAba('proximos')}>Próximos{proximos.length ? ` · ${proximos.length}` : ''}</button>
        <button className={aba === 'historico' ? 'aba active' : 'aba'} onClick={() => setAba('historico')}>Histórico{feitos ? ` · ${feitos}` : ''}</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {aba === 'proximos' && vagas.map((v) => <OfertaVaga key={v.id} oferta={v} onRespondido={carregar} />)}
      {aba === 'proximos' && convites(proximos).map(({ appt, oferta }) => (
        <ConviteAdiantar key={oferta.id} oferta={oferta} servico={appt.services?.name} profissional={appt.professionals?.name} onRespondido={carregar} />
      ))}

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : aba === 'proximos' ? (
        proximos.length === 0 ? (
          <div className="card ag-vazio">
            <span className="ag-vazio-icone"><CalendarDays size={28} /></span>
            <strong>Nada marcado por enquanto</strong>
            <p className="muted">Escolha uma profissional e um horário. Leva menos de um minuto.</p>
            <Link to="/cliente/home" className="btn btn-primary">Marcar um horário</Link>
          </div>
        ) : (
          <>
            {destaque && <Destaque a={destaque} troca={trocaAberta(destaque)} onCancelar={() => cancelar(destaque)} />}
            {restantes.length > 0 && <h3 className="ag-secao">Depois</h3>}
            <div className="ag-lista">
              {restantes.map((a) => (
                <Cartao key={a.id} a={a} troca={trocaAberta(a)} onAbrir={() => navigate(`/cliente/agendamento/${a.id}`)}>
                  <div className="ag-acoes" onClick={(e) => e.stopPropagation()}>
                    {podeCancelar(a) && <button className="btn-mini btn-mini-nao" onClick={() => cancelar(a)}>{ehPedidoDeTroca(a) ? 'Desistir da troca' : 'Cancelar'}</button>}
                    {podeRemarcar(a) && !trocaAberta(a) && <Link className="btn-mini btn-mini-rosa" to={`/cliente/agendamento/data?prof=${a.professional_id}&servico=${a.service_id}&remarcar=${a.id}`}>Remarcar</Link>}
                  </div>
                </Cartao>
              ))}
            </div>
          </>
        )
      ) : (
        historico.length === 0 ? (
          <div className="card ag-vazio">
            <span className="ag-vazio-icone"><Sparkles size={28} /></span>
            <strong>Seu histórico começa no primeiro atendimento</strong>
            <p className="muted">Depois de cada visita você pode avaliar e marcar de novo por aqui.</p>
          </div>
        ) : (
          meses.map(([mes, itens]) => (
            <section key={mes} className="ag-mes">
              <h3 className="ag-secao">{mes} <span className="muted">· {itens.filter((a) => a.status === 'concluido').length} {itens.filter((a) => a.status === 'concluido').length === 1 ? 'atendimento' : 'atendimentos'}</span></h3>
              <div className="ag-lista">
                {itens.map((a) => (
                  <Cartao key={a.id} a={a} historico nota={notas.get(a.id)} onAbrir={() => navigate(`/cliente/agendamento/${a.id}`)}>
                    <div className="ag-acoes" onClick={(e) => e.stopPropagation()}>
                      {a.status === 'concluido' && !notas.has(a.id) && <button className="btn-mini btn-mini-rosa" onClick={() => setAvaliando(a)}><StarIcon /> Avaliar</button>}
                      {a.professionals && a.service_id && <Link className="btn-mini" to={`/cliente/profissional/${a.professionals.id}/servicos?servico=${a.service_id}`}>Marcar de novo</Link>}
                    </div>
                  </Cartao>
                ))}
              </div>
            </section>
          ))
        )
      )}

      {avaliando && (
        <AvaliarModal
          appt={avaliando}
          onFechar={() => setAvaliando(null)}
          onPronto={() => { setAvaliando(null); carregar() }}
        />
      )}
    </ClienteShell>
  )
}

// o próximo horário, grande, com o que ela precisa saber de bate-pronto
function Destaque({ a, troca, onCancelar }) {
  const navigate = useNavigate()
  const troca_ = ehPedidoDeTroca(a)
  return (
    <div className={'card ag-destaque ' + a.status} role="link" tabIndex={0} onClick={() => navigate(`/cliente/agendamento/${a.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/cliente/agendamento/${a.id}`) }}>
      <div className="ag-destaque-topo">
        <span className="ag-destaque-rotulo">{a.status === 'pendente' ? 'Aguardando confirmação' : 'Seu próximo horário'}</span>
        <span className="ag-destaque-quando">{emQuanto(a)}</span>
      </div>
      <div className="ag-destaque-corpo">
        <div className="ag-destaque-data">
          <strong>{diaNumero(a.date)}</strong>
          <span>{mesCurto(a.date)}</span>
        </div>
        <div className="ag-destaque-texto">
          <strong className="ag-destaque-servico">{a.services?.name ?? a.service_name}</strong>
          <span className="ag-destaque-linha"><Clock size={14} /> {diaSemana(a.date)} às {a.start_time.slice(0, 5)}{a.services?.duration_minutes ? ` · ${formatDuracao(a.services.duration_minutes)}` : ''}</span>
          {a.salons?.name && <span className="ag-destaque-linha"><MapPin size={14} /> {a.salons.name}{a.salons.city ? ` · ${a.salons.city}` : ''}</span>}
        </div>
      </div>
      <div className="ag-destaque-prof">
        <span className="ag-avatar">{a.professionals?.photo_url ? <img src={a.professionals.photo_url} alt="" /> : iniciais(a.professionals?.name)}</span>
        <span className="ag-destaque-prof-nome">com <strong>{a.professionals?.name}</strong></span>
        <span className="ag-destaque-preco">{formatPreco(a.price_cents != null ? a.price_cents / 100 : a.services?.price)}</span>
      </div>
      {troca && <p className="ag-nota"><Repeat size={14} /> Você pediu para mudar para {quando(troca)}. Aguardando a profissional.</p>}
      {troca_ && a.origem && <p className="ag-nota"><Repeat size={14} /> No lugar de {formatDataCurta(a.origem.date)} às {a.origem.start_time.slice(0, 5)}.</p>}
      <div className="ag-destaque-acoes" onClick={(e) => e.stopPropagation()}>
        <Link className="btn btn-primary" to={`/cliente/agendamento/${a.id}`}>Ver detalhes <ChevronRight size={16} /></Link>
        {podeRemarcar(a) && !troca && <Link className="btn btn-ghost" to={`/cliente/agendamento/data?prof=${a.professional_id}&servico=${a.service_id}&remarcar=${a.id}`}>Remarcar</Link>}
        {podeCancelar(a) && <button className="btn btn-ghost ag-cancelar" onClick={onCancelar}>{troca_ ? 'Desistir' : 'Cancelar'}</button>}
      </div>
    </div>
  )
}

function Cartao({ a, troca, historico = false, nota, onAbrir, children }) {
  const troca_ = ehPedidoDeTroca(a)
  return (
    <div className={'card ag-card ' + a.status + (troca_ ? ' troca' : '')} role="link" tabIndex={0} onClick={onAbrir} onKeyDown={(e) => { if (e.key === 'Enter') onAbrir() }}>
      <div className="ag-data">
        <span className="ag-data-sem">{diaSemana(a.date, true)}</span>
        <strong className="ag-data-dia">{diaNumero(a.date)}</strong>
        <span className="ag-data-mes">{mesCurto(a.date)}</span>
      </div>
      <div className="ag-corpo">
        <div className="ag-topo">
          <span className="ag-hora">{a.start_time.slice(0, 5)}{a.services?.duration_minutes ? ` · ${formatDuracao(a.services.duration_minutes)}` : ''}</span>
          <span className={`badge badge-${troca_ ? 'remarcacao' : a.status}`}>{troca_ ? 'Troca aguardando' : ROTULO[a.status] ?? a.status}</span>
        </div>
        <strong className="ag-servico">{a.services?.name ?? a.service_name}</strong>
        <span className="ag-prof">
          <span className="ag-avatar pequeno">{a.professionals?.photo_url ? <img src={a.professionals.photo_url} alt="" /> : iniciais(a.professionals?.name)}</span>
          <span className="muted">{a.professionals?.name}{a.salons?.name ? ` · ${a.salons.name}` : ''}</span>
          <span className="ag-preco">{formatPreco(a.price_cents != null ? a.price_cents / 100 : a.services?.price)}</span>
        </span>
        {historico && a.status === 'concluido' && nota && (
          <span className="ag-estrelas" aria-label={`Você deu ${nota} estrelas`}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={13} className={n <= nota ? 'cheia' : ''} />)} <span className="muted">sua avaliação</span></span>
        )}
        {troca_ && a.origem && <span className="ag-nota"><Repeat size={13} /> No lugar de {formatDataCurta(a.origem.date)} às {a.origem.start_time.slice(0, 5)}. Até ela responder, o de antes continua valendo.</span>}
        {troca && <span className="ag-nota"><Repeat size={13} /> Você pediu para mudar para {quando(troca)}. Aguardando a profissional.</span>}
        {children}
      </div>
      <ChevronRight size={18} className="ag-seta" />
    </div>
  )
}

function quando(a) {
  const d = new Date(a.date + 'T12:00:00')
  const dia = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '')
  return `${dia} · ${a.start_time.slice(0, 5)}`
}
function diaSemana(iso, curto = false) {
  const s = new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: curto ? 'short' : 'long' }).replace('.', '').replace('-feira', '')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function diaNumero(iso) { return iso.slice(8, 10) }
function mesCurto(iso) { return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') }
function emQuanto(a) {
  const d = new Date(`${a.date}T${a.start_time}`)
  const min = Math.round((d - new Date()) / 60000)
  if (min < 60) return `em ${Math.max(1, min)} min`
  if (min < 60 * 24) return `em ${Math.round(min / 60)} h`
  const dias = Math.round(min / 1440)
  if (dias === 1) return 'amanhã'
  return `em ${dias} dias`
}
function agruparPorMes(itens) {
  const m = new Map()
  for (const a of itens) {
    const k = new Date(a.date + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    const rotulo = k.charAt(0).toUpperCase() + k.slice(1)
    if (!m.has(rotulo)) m.set(rotulo, [])
    m.get(rotulo).push(a)
  }
  return [...m.entries()]
}
function convites(ags) {
  const agora = new Date()
  return ags.flatMap((appt) => (appt.appointment_offers ?? []).filter((o) => o.status === 'pendente' && new Date(o.expires_at) > agora).map((oferta) => ({ appt, oferta })))
}
function podeCancelar(a) {
  return (a.status === 'pendente' || a.status === 'confirmado') && new Date(`${a.date}T${a.start_time}`) > new Date()
}
function ehPedidoDeTroca(a) {
  return Boolean(a.remarca_de) && a.status === 'pendente'
}
function podeRemarcar(a) {
  return podeCancelar(a) && Boolean(a.service_id) && !ehPedidoDeTroca(a)
}
// eslint-disable-next-line no-unused-vars
const _usa = { formatDataLonga, Check }
