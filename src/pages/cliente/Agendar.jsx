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

function usarEscolhas() {
  const [q] = useSearchParams()
  return {
    prof: q.get('prof') || '',
    servico: q.get('servico') || '',
    data: q.get('data') || '',
    hora: q.get('hora') || '',
  }
}

function comQuery(rota, obj) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) if (v) q.set(k, v)
  return `${rota}?${q.toString()}`
}

// carrega a profissional e o serviço a partir dos ids da URL
function usarContexto(profId, servicoId) {
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

function Trilha({ passo }) {
  const nomes = ['Serviço', 'Data', 'Hora', 'Confirmar']
  return (
    <ol className="trilha">
      {nomes.map((r, i) => (
        <li key={r} className={'trilha-passo' + (i + 1 === passo ? ' atual' : '') + (i + 1 < passo ? ' feito' : '')}>
          <button type="button" disabled>
            <span className="trilha-num">{i + 1 < passo ? '✓' : i + 1}</span>
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
  const esc = usarEscolhas()
  const navigate = useNavigate()
  const { prof, servico } = usarContexto(esc.prof, esc.servico)
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
    <ClienteShell titulo="Escolher data" voltar={comQuery(`/cliente/profissional/${esc.prof}/servicos`, { servico: esc.servico })}>
      <Trilha passo={2} />
      {prof && servico && <p className="muted" style={{ marginTop: 0 }}>{servico.name} com {prof.name}</p>}

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
  const esc = usarEscolhas()
  const navigate = useNavigate()
  const { servico } = usarContexto(esc.prof, esc.servico)
  const [slots, setSlots] = useState(null)
  const [hora, setHora] = useState(esc.hora)

  useEffect(() => {
    if (!esc.prof || !esc.data || !servico) return
    supabase.rpc('horarios_livres', { prof: esc.prof, dia: esc.data, duracao: servico.duration_minutes })
      .then(({ data }) => setSlots((data ?? []).map((h) => String(h.hora ?? h).slice(0, 5))))
  }, [esc.prof, esc.data, servico])

  return (
    <ClienteShell titulo="Escolher hora" voltar={comQuery('/cliente/agendamento/data', esc)}>
      <Trilha passo={3} />
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
  const esc = usarEscolhas()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { prof, servico } = usarContexto(esc.prof, esc.servico)
  const [obs, setObs] = useState('')
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  const confirmar = useCallback(async () => {
    if (!servico || !esc.data || !esc.hora) return
    setSaving(true)
    setErro('')
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

  return (
    <ClienteShell titulo="Confirmar pedido" voltar={comQuery('/cliente/agendamento/hora', esc)}>
      <Trilha passo={4} />
      {erro && <div className="alert alert-error">{erro}</div>}

      <h3 className="secao-titulo">Resumo do pedido</h3>
      <div className="card resumo-pedido">
        <div className="resumo-linha"><span className="muted">Serviço</span><strong>{servico?.name}</strong></div>
        <div className="resumo-linha"><span className="muted">Profissional</span><strong>{prof?.name}</strong></div>
        <div className="resumo-linha"><span className="muted">Data</span><strong>{esc.data && formatDataLonga(esc.data)}</strong></div>
        <div className="resumo-linha"><span className="muted">Horário</span><strong>{esc.hora}</strong></div>
        {servico && <div className="resumo-linha"><span className="muted">Duração</span><strong>{labelDuracao(servico)}</strong></div>}
        <div className="resumo-linha resumo-total"><span>Valor</span><strong>{servico && formatPreco(servico.price)}</strong></div>
      </div>

      <label className="campo-solto">
        <span>Observação (opcional)</span>
        <textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Alguma preferência ou aviso para a profissional?" rows={3} />
      </label>

      <div className="card aviso-suave">
        <strong>Confirmação pelo WhatsApp</strong>
        <span className="muted">A profissional confirma o pedido e você recebe um aviso. Se ela não responder no prazo dela, o sistema decide sozinho.</span>
      </div>

      <div className="rodape-fixo">
        <button className="btn btn-primary btn-block" onClick={confirmar} disabled={saving || !servico}>
          {saving ? 'Enviando…' : 'Confirmar pedido'}
        </button>
      </div>
    </ClienteShell>
  )
}

// ---------------------------------------------------------------- 5
export function AgendarSucesso() {
  const { id } = useParams()
  const [appt, setAppt] = useState(null)
  useEffect(() => {
    if (!id || id === 'novo') return
    supabase.from('appointments').select('*, services (name), professionals (name)').eq('id', id).maybeSingle().then(({ data }) => setAppt(data))
  }, [id])

  return (
    <ClienteShell semTopo>
      <div className="sucesso">
        <span className="sucesso-check" aria-hidden="true">✓</span>
        <h2>Pedido enviado!</h2>
        <p className="muted">Seu horário ficou guardado. Assim que a profissional confirmar, você recebe um aviso aqui e no WhatsApp.</p>
        {appt && (
          <div className="card resumo-pedido" style={{ textAlign: 'left', width: '100%' }}>
            <div className="resumo-linha"><span className="muted">Serviço</span><strong>{appt.services?.name}</strong></div>
            <div className="resumo-linha"><span className="muted">Com</span><strong>{appt.professionals?.name}</strong></div>
            <div className="resumo-linha"><span className="muted">Quando</span><strong>{formatDataLonga(appt.date)} às {appt.start_time.slice(0, 5)}</strong></div>
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
