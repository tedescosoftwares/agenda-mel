import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import CalendarioMes from '../../components/CalendarioMes'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatPreco, labelDuracao } from '../../lib/format'
import { toMin, minToHora, formatDataLonga } from '../../lib/booking'

// O fluxo de marcar, dentro do app: serviço → data → hora → confirmar.
// Cada passo é uma rota, e o que já foi escolhido viaja na URL
// (?prof&servico&data&hora). Assim o botão de voltar do celular volta
// UM passo, e um link no meio do fluxo abre no lugar certo.
//
// O mesmo fluxo serve para REMARCAR: chega com ?remarcar=<id do
// agendamento>, pula o passo do serviço (é o mesmo) e, no fim, em vez
// de criar um agendamento, abre um pedido de troca que passa pelo
// aceite da profissional. O horário atual fica guardado até ela
// responder.

function useEscolhas() {
  const [q] = useSearchParams()
  return {
    prof: q.get('prof') || '',
    servico: q.get('servico') || '',
    data: q.get('data') || '',
    hora: q.get('hora') || '',
    remarcar: q.get('remarcar') || '',
  }
}

// o agendamento que está sendo trocado, quando é remarcação
function useOrigem(id) {
  const [origem, setOrigem] = useState(null)
  useEffect(() => {
    if (!id) return
    supabase.from('appointments').select('id, date, start_time, end_time, status, service_id, professional_id').eq('id', id).maybeSingle().then(({ data }) => setOrigem(data))
  }, [id])
  return origem
}

function comQuery(rota, obj) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) if (v) q.set(k, v)
  return `${rota}?${q.toString()}`
}

// carrega a profissional e o serviço a partir dos ids da URL
function useContexto(profId, servicoId) {
  const [prof, setProf] = useState(null)
  const [servico, setServico] = useState(null)
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [p, s] = await Promise.all([
        profId ? supabase.from('professionals').select('id, name, photo_url, slug').eq('id', profId).maybeSingle() : { data: null },
        servicoId ? supabase.from('services').select('*').eq('id', servicoId).maybeSingle() : { data: null },
      ])
      if (!vivo) return
      setProf(p.data)
      setServico(s.data)
    })()
    return () => { vivo = false }
  }, [profId, servicoId])
  return { prof, servico }
}

function Trilha({ passo, remarcar }) {
  // remarcando, o serviço já está decidido: a trilha começa na data
  const nomes = remarcar ? ['Data', 'Hora', 'Confirmar'] : ['Serviço', 'Data', 'Hora', 'Confirmar']
  const atual = remarcar ? passo - 1 : passo
  return (
    <ol className="trilha">
      {nomes.map((r, i) => (
        <li key={r} className={'trilha-passo' + (i + 1 === atual ? ' atual' : '') + (i + 1 < atual ? ' feito' : '')}>
          <button type="button" disabled>
            <span className="trilha-num">{i + 1 < atual ? '✓' : i + 1}</span>
            <span className="trilha-rotulo">{r}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------- 1
export function AgendarServicos() {
  const { id } = useParams()
  const [q] = useSearchParams()
  const preSel = q.get('servico') || ''
  const [servicos, setServicos] = useState([])
  const [sel, setSel] = useState(preSel)
  const [prof, setProf] = useState(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [p, vi] = await Promise.all([
        supabase.from('professionals').select('id, name').eq('id', id).maybeSingle(),
        supabase.from('professional_services').select('services (*)').eq('professional_id', id),
      ])
      if (!vivo) return
      setProf(p.data)
      setServicos((vi.data ?? []).map((v) => v.services).filter((s) => s?.active))
    })()
    return () => { vivo = false }
  }, [id])

  return (
    <ClienteShell titulo="Serviços" voltar={`/cliente/profissional/${id}`}>
      <Trilha passo={1} />
      {prof && <p className="muted" style={{ marginTop: 0 }}>Com {prof.name}</p>}

      <div className="cliente-list">
        {servicos.map((s) => (
          <button
            key={s.id}
            type="button"
            className={'card servico-linha escolhivel' + (sel === s.id ? ' ativo' : '')}
            onClick={() => setSel(s.id)}
          >
            <span className="servico-linha-foto" aria-hidden="true">
              {s.images?.[0] ? <img src={s.images[0]} alt="" /> : '✨'}
            </span>
            <span className="cliente-info">
              <span className="cliente-nome"><span className="nome-txt">{s.name}</span></span>
              <span className="muted cliente-meta">{formatPreco(s.price)} · {labelDuracao(s)}</span>
              {s.description && <span className="muted cliente-meta">{s.description}</span>}
            </span>
            <span className="radio-marca" aria-hidden="true" />
          </button>
        ))}
      </div>

      <div className="rodape-fixo">
        <Link
          to={comQuery('/cliente/agendamento/data', { prof: id, servico: sel })}
          className={'btn btn-primary btn-block' + (sel ? '' : ' desabilitado')}
          aria-disabled={!sel}
          onClick={(e) => { if (!sel) e.preventDefault() }}
        >
          Continuar
        </Link>
      </div>
    </ClienteShell>
  )
}

// ---------------------------------------------------------------- 2
export function AgendarData() {
  const esc = useEscolhas()
  const navigate = useNavigate()
  const { prof, servico } = useContexto(esc.prof, esc.servico)
  const [horas, setHoras] = useState([])
  const [sugeridos, setSugeridos] = useState([])
  const [data, setData] = useState(esc.data)

  useEffect(() => {
    if (!esc.prof) return
    supabase.from('professional_hours').select('*').eq('professional_id', esc.prof).then(({ data }) => setHoras(data ?? []))
  }, [esc.prof])

  useEffect(() => {
    if (!esc.prof || !servico) return
    supabase.rpc('dias_com_vaga', { prof: esc.prof, duracao: servico.duration_minutes, quantos: 3 }).then(({ data }) => setSugeridos(data ?? []))
  }, [esc.prof, servico])

  const diaAberto = (d) => Boolean(horas.find((h) => h.weekday === d.getDay())?.open)
  const seguir = (iso) => navigate(comQuery('/cliente/agendamento/hora', { ...esc, data: iso }))

  return (
    <ClienteShell titulo={esc.remarcar ? 'Nova data' : 'Escolher data'} voltar={esc.remarcar ? '/cliente/meus-agendamentos' : comQuery(`/cliente/profissional/${esc.prof}/servicos`, { servico: esc.servico })}>
      <Trilha passo={2} remarcar={esc.remarcar} />
      {prof && servico && <p className="muted" style={{ marginTop: 0 }}>{esc.remarcar ? 'Remarcando ' : ''}{servico.name} com {prof.name}</p>}

      <CalendarioMes valor={data} diaAberto={horas.length ? diaAberto : undefined} onEscolher={(iso) => { setData(iso); seguir(iso) }} />

      {sugeridos.length > 0 && (
        <>
          <p className="muted rotulo-solto">Datas disponíveis</p>
          <div className="filtro-chips">
            {sugeridos.map((d) => (
              <button key={d.dia} className={data === d.dia ? 'chip active' : 'chip'} onClick={() => seguir(d.dia)}>
                {curta(d.dia)}
              </button>
            ))}
          </div>
        </>
      )}
    </ClienteShell>
  )
}

// ---------------------------------------------------------------- 3
export function AgendarHora() {
  const esc = useEscolhas()
  const navigate = useNavigate()
  const { servico } = useContexto(esc.prof, esc.servico)
  const [slots, setSlots] = useState(null)
  const [hora, setHora] = useState(esc.hora)

  useEffect(() => {
    if (!esc.prof || !esc.data || !servico) return
    supabase.rpc('horarios_livres', { prof: esc.prof, dia: esc.data, duracao: servico.duration_minutes })
      .then(({ data }) => setSlots((data ?? []).map((h) => String(h.hora ?? h).slice(0, 5))))
  }, [esc.prof, esc.data, servico])

  return (
    <ClienteShell titulo={esc.remarcar ? 'Nova hora' : 'Escolher hora'} voltar={comQuery('/cliente/agendamento/data', esc)}>
      <Trilha passo={3} remarcar={esc.remarcar} />
      <p className="muted" style={{ marginTop: 0 }}>{esc.data && formatDataLonga(esc.data)}</p>

      <h3 className="secao-titulo">Horários disponíveis</h3>
      {slots === null ? (
        <p className="muted">Buscando…</p>
      ) : slots.length === 0 ? (
        <div className="card empty-state">
          <p>Nenhum horário livre neste dia.</p>
          <Link to={comQuery('/cliente/agendamento/data', esc)} className="btn btn-ghost">Escolher outro dia</Link>
        </div>
      ) : (
        <div className="slots-grid">
          {slots.map((h) => (
            <button key={h} type="button" className={h === hora ? 'slot active' : 'slot'} onClick={() => setHora(h)}>{h}</button>
          ))}
        </div>
      )}

      {servico && (
        <div className="card resumo-mini">
          <span className="muted">Valor</span>
          <strong>{formatPreco(servico.price)}</strong>
          <span className="muted">Duração: {labelDuracao(servico)}</span>
        </div>
      )}

      <div className="rodape-fixo">
        <button
          className="btn btn-primary btn-block"
          disabled={!hora}
          onClick={() => navigate(comQuery('/cliente/agendamento/confirmar', { ...esc, hora }))}
        >
          Continuar
        </button>
      </div>
    </ClienteShell>
  )
}

// ---------------------------------------------------------------- 4
export function AgendarConfirmar() {
  const esc = useEscolhas()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { prof, servico } = useContexto(esc.prof, esc.servico)
  const origem = useOrigem(esc.remarcar)
  const [obs, setObs] = useState('')
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  const confirmar = useCallback(async () => {
    if (!servico || !esc.data || !esc.hora) return
    setSaving(true)
    setErro('')

    if (esc.remarcar) {
      // remarcação: o banco cria o pedido ligado ao horário atual e
      // decide, pela configuração da profissional, se espera o aceite
      const { data, error } = await supabase.rpc('pedir_remarcacao', { appt: esc.remarcar, nova_data: esc.data, nova_hora: esc.hora })
      setSaving(false)
      if (error) { setErro('Não deu para pedir a remarcação: ' + error.message); return }
      if (!data?.ok) { setErro(capitalizar(data?.motivo || 'não deu para remarcar') + '.'); return }
      navigate(`/cliente/agendamento/sucesso/${data.appointment_id}`, { replace: true })
      return
    }

    const fim = toMin(esc.hora) + servico.duration_minutes
    const { data, error } = await supabase
      .from('appointments')
      .insert({
        client_id: user.id,
        professional_id: esc.prof,
        service_id: servico.id,
        date: esc.data,
        start_time: esc.hora,
        end_time: minToHora(fim),
        notes: obs.trim() || null,
      })
      .select('id')
      .maybeSingle()
    setSaving(false)
    if (error) {
      if (error.code === '23505' || error.code === '23P01') setErro('Esse horário acabou de ser reservado por outra pessoa. Escolha outro, por favor.')
      else setErro('Erro ao agendar: ' + error.message)
      return
    }
    navigate(`/cliente/agendamento/sucesso/${data?.id ?? 'novo'}`, { replace: true })
  }, [servico, esc, user, obs, navigate])

  const remarcando = Boolean(esc.remarcar)

  return (
    <ClienteShell titulo={remarcando ? 'Confirmar troca' : 'Confirmar pedido'} voltar={comQuery('/cliente/agendamento/hora', esc)}>
      <Trilha passo={4} remarcar={esc.remarcar} />
      {erro && <div className="alert alert-error">{erro}</div>}

      <h3 className="secao-titulo">{remarcando ? 'Resumo da troca' : 'Resumo do pedido'}</h3>
      <div className="card resumo-pedido">
        <div className="resumo-linha"><span className="muted">Serviço</span><strong>{servico?.name}</strong></div>
        <div className="resumo-linha"><span className="muted">Profissional</span><strong>{prof?.name}</strong></div>
        {remarcando ? (
          <>
            <div className="resumo-linha resumo-troca-de"><span className="muted">Era</span><strong>{origem ? `${curta(origem.date)} às ${origem.start_time.slice(0, 5)}` : '…'}</strong></div>
            <div className="resumo-linha resumo-troca-para"><span className="muted">Passa para</span><strong>{esc.data && curta(esc.data)} às {esc.hora}</strong></div>
          </>
        ) : (
          <>
            <div className="resumo-linha"><span className="muted">Data</span><strong>{esc.data && formatDataLonga(esc.data)}</strong></div>
            <div className="resumo-linha"><span className="muted">Horário</span><strong>{esc.hora}</strong></div>
          </>
        )}
        {servico && <div className="resumo-linha"><span className="muted">Duração</span><strong>{labelDuracao(servico)}</strong></div>}
        <div className="resumo-linha resumo-total"><span>Valor</span><strong>{servico && formatPreco(servico.price)}</strong></div>
      </div>

      {!remarcando && (
        <label className="campo-solto">
          <span>Observação (opcional)</span>
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Alguma preferência ou aviso para a profissional?" rows={3} />
        </label>
      )}

      <div className="card aviso-suave">
        <strong>{remarcando ? 'Seu horário atual continua guardado' : 'Confirmação pelo WhatsApp'}</strong>
        <span className="muted">
          {remarcando
            ? 'A profissional recebe o pedido de troca e responde. Enquanto isso, nada muda. Se ela não responder no prazo dela, o sistema decide sozinho.'
            : 'A profissional confirma o pedido e você recebe um aviso. Se ela não responder no prazo dela, o sistema decide sozinho.'}
        </span>
      </div>

      <div className="rodape-fixo">
        <button className="btn btn-primary btn-block" onClick={confirmar} disabled={saving || !servico}>
          {saving ? 'Enviando…' : remarcando ? 'Pedir a troca' : 'Confirmar pedido'}
        </button>
      </div>
    </ClienteShell>
  )
}

function capitalizar(t) {
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t
}

// ---------------------------------------------------------------- 5
export function AgendarSucesso() {
  const { id } = useParams()
  const [appt, setAppt] = useState(null)
  useEffect(() => {
    if (!id || id === 'novo') return
    supabase.from('appointments').select('*, services (name), professionals (name)').eq('id', id).maybeSingle().then(({ data }) => setAppt(data))
  }, [id])

  // três finais possíveis: pedido novo, pedido de troca, troca já feita
  const troca = Boolean(appt?.remarca_de)
  const jaTrocou = troca && appt.status === 'confirmado'
  const titulo = jaTrocou ? 'Remarcado!' : troca ? 'Pedido de troca enviado!' : 'Pedido enviado!'
  const texto = jaTrocou
    ? 'Sua profissional não pede confirmação, então a troca já valeu. Ela foi avisada.'
    : troca
      ? 'Seu horário atual continua guardado. Assim que a profissional aceitar a troca, você recebe um aviso aqui e no WhatsApp.'
      : 'Seu horário ficou guardado. Assim que a profissional confirmar, você recebe um aviso aqui e no WhatsApp.'

  return (
    <ClienteShell semTopo>
      <div className="sucesso">
        <span className="sucesso-check" aria-hidden="true">{troca ? '🔁' : '✓'}</span>
        <h2>{titulo}</h2>
        <p className="muted">{texto}</p>
        {appt && (
          <div className="card resumo-pedido" style={{ textAlign: 'left', width: '100%' }}>
            <div className="resumo-linha"><span className="muted">Serviço</span><strong>{appt.services?.name}</strong></div>
            <div className="resumo-linha"><span className="muted">Com</span><strong>{appt.professionals?.name}</strong></div>
            <div className="resumo-linha"><span className="muted">{troca ? 'Novo horário' : 'Quando'}</span><strong>{formatDataLonga(appt.date)} às {appt.start_time.slice(0, 5)}</strong></div>
          </div>
        )}
        <Link to="/cliente/meus-agendamentos" className="btn btn-primary btn-block">Ver meus agendamentos</Link>
        <Link to="/cliente/home" className="btn btn-ghost btn-block">Voltar ao início</Link>
      </div>
    </ClienteShell>
  )
}

function curta(iso) {
  const d = new Date(iso + 'T12:00:00')
  return `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
