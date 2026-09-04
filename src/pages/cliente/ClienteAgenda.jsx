import { useCallback, useEffect, useState } from 'react'
import { useDialogo } from '../../context/DialogoContext'
import { Link } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatPreco, toISODate } from '../../lib/format'
import { formatDataCurta } from '../../lib/booking'
import { StarIcon } from '../../components/icons'
import ConviteAdiantar from '../../components/ConviteAdiantar'
import OfertaVaga from '../../components/OfertaVaga'

// Meus agendamentos (tela 09): duas abas, Próximos e Histórico. O que
// vem pela frente pode ser cancelado ou remarcado; o que já passou pode
// ser avaliado — uma vez só, e só se de fato aconteceu (o banco confere).
//
// Remarcar é um pedido: aparece aqui como um cartão próprio ("troca
// aguardando"), e o horário atual continua na lista, com uma nota
// dizendo para onde ele quer ir. A cliente pode desistir do pedido a
// qualquer momento sem mexer no horário atual.

const ROTULO = { pendente: 'Aguardando', confirmado: 'Confirmado', concluido: 'Concluído', faltou: 'Não fui', cancelado: 'Cancelado' }

export default function ClienteAgenda() {
  const { confirmar } = useDialogo()
  const { user } = useAuth()
  const [aba, setAba] = useState('proximos')
  const [proximos, setProximos] = useState([])
  const [historico, setHistorico] = useState([])
  const [avaliados, setAvaliados] = useState(new Set())
  const [vagas, setVagas] = useState([])
  const [avaliando, setAvaliando] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const carregar = useCallback(async () => {
    const hoje = toISODate(new Date())
    const sel = '*, services (name, price), professionals (id, name, photo_url), appointment_offers (id, status, proposed_start_time, previous_start_time, expires_at)'
    const [px, hs, rv, vg] = await Promise.all([
      supabase.from('appointments').select(sel).eq('client_id', user.id).gte('date', hoje).neq('status', 'cancelado').order('date').order('start_time'),
      supabase.from('appointments').select(sel).eq('client_id', user.id).lt('date', hoje).order('date', { ascending: false }).limit(30),
      supabase.from('reviews').select('appointment_id').eq('client_id', user.id),
      supabase.from('waitlist_offers').select('*, waitlist_entries (id, services (name), professionals (name))').eq('status', 'pendente').gt('expires_at', new Date().toISOString()),
    ])
    if (px.error) setError(px.error.message)
    // o horário de origem de cada pedido de troca. Sem embed do PostgREST
    // (a tabela aponta para ela mesma duas vezes e o cache de schema dele
    // já tropeçou nisso): quase sempre a origem está nesta mesma lista;
    // o que faltar vem numa segunda busca simples.
    const lista = px.data ?? []
    const faltam = lista.filter((a) => a.remarca_de && !lista.some((o) => o.id === a.remarca_de)).map((a) => a.remarca_de)
    const extras = faltam.length ? (await supabase.from('appointments').select('id, date, start_time').in('id', faltam)).data ?? [] : []
    setProximos(lista.map((a) => ({ ...a, origem: a.remarca_de ? (lista.find((o) => o.id === a.remarca_de) ?? extras.find((o) => o.id === a.remarca_de) ?? null) : null })))
    setHistorico(hs.data ?? [])
    setAvaliados(new Set((rv.data ?? []).map((r) => r.appointment_id)))
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

  const lista = aba === 'proximos' ? proximos : historico
  // o pedido de troca aberto de cada horário atual, se houver
  const trocaAberta = (a) => proximos.find((p) => p.remarca_de === a.id && p.status === 'pendente')

  return (
    <ClienteShell titulo="Meus agendamentos">
      <div className="abas">
        <button className={aba === 'proximos' ? 'aba active' : 'aba'} onClick={() => setAba('proximos')}>Próximos</button>
        <button className={aba === 'historico' ? 'aba active' : 'aba'} onClick={() => setAba('historico')}>Histórico</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {aba === 'proximos' && vagas.map((v) => <OfertaVaga key={v.id} oferta={v} onRespondido={carregar} />)}
      {aba === 'proximos' && convites(proximos).map(({ appt, oferta }) => (
        <ConviteAdiantar key={oferta.id} oferta={oferta} servico={appt.services?.name} profissional={appt.professionals?.name} onRespondido={carregar} />
      ))}

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : lista.length === 0 ? (
        <div className="card empty-state">
          <p>{aba === 'proximos' ? 'Nada marcado por enquanto.' : 'Você ainda não tem atendimentos passados.'}</p>
          {aba === 'proximos' && <Link to="/cliente/home" className="btn btn-primary">Marcar um horário</Link>}
        </div>
      ) : (
        <div className="cliente-list">
          {lista.map((a) => (
            <div key={a.id} className={'card agd-card ' + a.status + (ehPedidoDeTroca(a) ? ' troca' : '')}>
              <div className="agd-topo">
                <span className="agd-quando">{quando(a)}</span>
                <span className={`badge badge-${ehPedidoDeTroca(a) ? 'remarcacao' : a.status}`}>{ehPedidoDeTroca(a) ? 'Troca aguardando' : ROTULO[a.status] ?? a.status}</span>
              </div>
              <strong className="agd-servico">{a.services?.name}</strong>
              <span className="muted agd-meta">
                {a.professionals?.name} · {formatPreco(a.price_cents != null ? a.price_cents / 100 : a.services?.price)}
              </span>
              {ehPedidoDeTroca(a) && a.origem && (
                <span className="agd-troca">🔁 No lugar de {formatDataCurta(a.origem.date)} às {a.origem.start_time.slice(0, 5)}. Até ela responder, o horário de antes continua valendo.</span>
              )}
              {aba === 'proximos' && trocaAberta(a) && (
                <span className="agd-troca">🔁 Você pediu para mudar para {quando(trocaAberta(a))}. Aguardando a profissional.</span>
              )}
              <div className="agd-acoes">
                {aba === 'proximos' && podeCancelar(a) && (
                  <button className="btn-mini btn-mini-nao" onClick={() => cancelar(a)}>{ehPedidoDeTroca(a) ? 'Desistir da troca' : 'Cancelar'}</button>
                )}
                {aba === 'proximos' && podeRemarcar(a) && !trocaAberta(a) && (
                  <Link className="btn-mini btn-mini-rosa" to={`/cliente/agendamento/data?prof=${a.professional_id}&servico=${a.service_id}&remarcar=${a.id}`}>Remarcar</Link>
                )}
                {aba === 'proximos' && a.professionals && (
                  <Link className="btn-mini" to={`/cliente/profissional/${a.professionals.id}`}>Ver profissional</Link>
                )}
                {aba === 'historico' && a.status === 'concluido' && !avaliados.has(a.id) && (
                  <button className="btn-mini btn-mini-rosa" onClick={() => setAvaliando(a)}><StarIcon /> Avaliar</button>
                )}
                {aba === 'historico' && avaliados.has(a.id) && <span className="muted agd-avaliado">Avaliado ✓</span>}
                {aba === 'historico' && a.professionals && (
                  <Link className="btn-mini" to={`/cliente/profissional/${a.professionals.id}/servicos?servico=${a.service_id}`}>Marcar de novo</Link>
                )}
              </div>
            </div>
          ))}
        </div>
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

function AvaliarModal({ appt, onFechar, onPronto }) {
  const { user } = useAuth()
  const [nota, setNota] = useState(0)
  const [texto, setTexto] = useState('')
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  async function enviar() {
    if (!nota) return
    setSaving(true)
    const { error } = await supabase.from('reviews').insert({
      appointment_id: appt.id, client_id: user.id, professional_id: appt.professional_id, nota, comentario: texto.trim() || null,
    })
    setSaving(false)
    if (error) setErro(error.message)
    else onPronto()
  }

  return (
    <div className="modal-fundo" onClick={onFechar}>
      <div className="modal-caixa" onClick={(e) => e.stopPropagation()}>
        <h3>Como foi com {appt.professionals?.name?.split(' ')[0]}?</h3>
        <p className="muted">{appt.services?.name} · {formatDataCurta(appt.date)}</p>
        <div className="estrelas-escolha">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" className={n <= nota ? 'on' : ''} onClick={() => setNota(n)} aria-label={`${n} estrelas`}>
              <StarIcon cheio={n <= nota} width={30} height={30} />
            </button>
          ))}
        </div>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} placeholder="Conta pra gente (opcional)" />
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className="modal-acoes">
          <button className="btn btn-ghost" onClick={onFechar}>Depois</button>
          <button className="btn btn-primary" onClick={enviar} disabled={!nota || saving}>{saving ? 'Enviando…' : 'Enviar avaliação'}</button>
        </div>
      </div>
    </div>
  )
}

function quando(a) {
  const d = new Date(a.date + 'T12:00:00')
  const dia = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '')
  return `${dia} · ${a.start_time.slice(0, 5)}`
}
function convites(ags) {
  const agora = new Date()
  return ags.flatMap((appt) => (appt.appointment_offers ?? []).filter((o) => o.status === 'pendente' && new Date(o.expires_at) > agora).map((oferta) => ({ appt, oferta })))
}
function podeCancelar(a) {
  return (a.status === 'pendente' || a.status === 'confirmado') && new Date(`${a.date}T${a.start_time}`) > new Date()
}
// um pedido de troca ainda aberto (o horário novo, esperando o aceite)
function ehPedidoDeTroca(a) {
  return Boolean(a.remarca_de) && a.status === 'pendente'
}
// remarcar precisa do serviço para saber a duração; e um pedido de
// troca não se remarca, se desiste dele
function podeRemarcar(a) {
  return podeCancelar(a) && Boolean(a.service_id) && !ehPedidoDeTroca(a)
}
