import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import CalendarioMes from '../../components/CalendarioMes'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatPreco, labelDuracao, formatDuracao } from '../../lib/format'
import { formatDataLonga } from '../../lib/booking'
import { Check, Sparkles, Repeat, Plus, Users, Hourglass } from 'lucide-react'

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
    // outras partes da visita, com outras profissionais do salão:
    // servico_profissional_hora, separadas por vírgula (081)
    extra: q.get('extra') || '',
  }
}

function lerExtras(extra) {
  return (extra || '').split(',').filter(Boolean).map((x) => {
    const [servico, prof, hora] = x.split('_')
    return servico && prof && hora ? { servico, prof, hora } : null
  }).filter(Boolean)
}
function escreverExtras(lista) {
  return lista.map((x) => `${x.servico}_${x.prof}_${x.hora}`).join(',')
}
function somarMin(hora, min) {
  const [h, m] = hora.split(':').map(Number)
  const tot = h * 60 + m + Number(min || 0)
  return `${String(Math.floor(tot / 60) % 24).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`
}
function diffMin(a, b) {
  const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number)
  return h2 * 60 + m2 - (h1 * 60 + m1)
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

// carrega a profissional e o(s) serviço(s) a partir dos ids da URL.
// Vários serviços (?servico=id1,id2) viram um só para o resto do fluxo:
// nome junto, duração e preço somados, e a lista para o resumo.
function useContexto(profId, servicoParam) {
  const [prof, setProf] = useState(null)
  const [servico, setServico] = useState(null)
  const ids = (servicoParam || '').split(',').filter(Boolean)
  const chave = ids.join(',')
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [p, s] = await Promise.all([
        profId ? supabase.from('professionals').select('id, name, photo_url, slug').eq('id', profId).maybeSingle() : { data: null },
        ids.length ? supabase.from('services').select('*').in('id', ids) : { data: null },
      ])
      if (!vivo) return
      setProf(p.data)
      setServico(juntar(ids, s.data))
    })()
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profId, chave])
  return { prof, servico }
}

function juntar(ids, lista) {
  if (!lista?.length) return null
  const ordenada = ids.map((id) => lista.find((x) => x.id === id)).filter(Boolean)
  if (ordenada.length === 0) return null
  if (ordenada.length === 1) return { ...ordenada[0], ids, lista: ordenada }
  return {
    id: ordenada[0].id,
    ids,
    lista: ordenada,
    name: ordenada.map((x) => x.name).join(' + '),
    price: ordenada.reduce((a, x) => a + Number(x.price ?? 0), 0),
    duration_minutes: ordenada.reduce((a, x) => a + Number(x.duration_minutes ?? 0), 0),
    is_combo: ordenada.some((x) => x.is_combo),
  }
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
            <span className="trilha-num">{i + 1 < atual ? <Check size={14} /> : i + 1}</span>
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
  const preSel = (q.get('servico') || '').split(',').filter(Boolean)
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

  const alternar = (sid) => setSel((atual) => atual.includes(sid) ? atual.filter((x) => x !== sid) : (atual.length >= 6 ? atual : [...atual, sid]))
  const escolhidos = sel.map((sid) => servicos.find((s) => s.id === sid)).filter(Boolean)
  const totalMin = escolhidos.reduce((a, s) => a + Number(s.duration_minutes ?? 0), 0)
  const totalPreco = escolhidos.reduce((a, s) => a + Number(s.price ?? 0), 0)

  return (
    <ClienteShell titulo="Serviços" voltar={`/cliente/profissional/${id}`}>
      <Trilha passo={1} />
      {prof && <p className="muted" style={{ marginTop: 0 }}>Com {prof.name}.</p>}
      {sel.length === 1 && <p className="dica-mais"><Plus size={14} /> Quer mais um? Toque no <strong>+</strong> de outro serviço: marca tudo no mesmo horário.</p>}

      <div className="cliente-list">
        {servicos.map((s) => {
          const marcado = sel.includes(s.id)
          return (
            <button
              key={s.id}
              type="button"
              className={'card servico-linha escolhivel multi' + (marcado ? ' ativo' : '')}
              onClick={() => alternar(s.id)}
              aria-pressed={marcado}
            >
              <span className="servico-linha-foto" aria-hidden="true">
                {s.images?.[0] ? <img src={s.images[0]} alt="" /> : <Sparkles />}
              </span>
              <span className="cliente-info">
                <span className="cliente-nome"><span className="nome-txt">{s.name}</span></span>
                <span className="muted cliente-meta">{formatPreco(s.price)} · {labelDuracao(s)}</span>
                {s.description && <span className="muted cliente-meta">{s.description}</span>}
              </span>
              <span className={'check-marca' + (marcado ? ' on' : '')} aria-hidden="true">{marcado ? <Check size={14} /> : <Plus size={14} />}</span>
            </button>
          )
        })}
      </div>

      <div className="rodape-fixo rodape-servicos">
        {escolhidos.length > 0 && (
          <div className="resumo-servicos">
            <span className="resumo-servicos-nomes">{escolhidos.map((s) => s.name).join(' + ')}</span>
            <span className="muted">{escolhidos.length} {escolhidos.length === 1 ? 'serviço' : 'serviços'} · {formatDuracao(totalMin)} · <strong>{formatPreco(totalPreco)}</strong></span>
          </div>
        )}
        <Link
          to={comQuery('/cliente/agendamento/data', { prof: id, servico: sel.join(',') })}
          className={'btn btn-primary btn-block' + (sel.length ? '' : ' desabilitado')}
          aria-disabled={!sel.length}
          onClick={(e) => { if (!sel.length) e.preventDefault() }}
        >
          {sel.length > 1 ? 'Escolher data para os ' + sel.length : 'Escolher data'}
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
  const [outros, setOutros] = useState([])
  const [cabe, setCabe] = useState(true)
  const [conferindo, setConferindo] = useState(false)
  const ids = servico?.ids ?? (servico ? [servico.id] : [])
  const remarcando = Boolean(esc.remarcar)
  // a visita: partes com outras profissionais do salão (081)
  const extras = lerExtras(esc.extra)
  const [comEspera, setComEspera] = useState(false)
  const [visita, setVisita] = useState([])          // sugestões do banco
  const [detalhes, setDetalhes] = useState({ servicos: {}, profs: {} })
  const chaveExtras = esc.extra

  // os outros serviços dela, para o "quer aproveitar e adicionar?"
  useEffect(() => {
    if (!esc.prof || remarcando) return
    supabase.from('professional_services').select('services (*)').eq('professional_id', esc.prof)
      .then(({ data }) => setOutros((data ?? []).map((v) => v.services).filter((x) => x?.active)))
  }, [esc.prof, remarcando])

  // adicionou serviço: a duração cresce; o horário escolhido ainda cabe?
  const chaveIds = ids.join(',')
  useEffect(() => {
    if (!esc.prof || !esc.data || !esc.hora || !servico || remarcando || ids.length < 2) { setCabe(true); return }
    let vivo = true
    setConferindo(true)
    supabase.rpc('horarios_livres', { prof: esc.prof, dia: esc.data, duracao: servico.duration_minutes })
      .then(({ data }) => { if (!vivo) return; setCabe((data ?? []).map((h) => String(h.hora ?? h).slice(0, 5)).includes(esc.hora)); setConferindo(false) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esc.prof, esc.data, esc.hora, chaveIds, servico?.duration_minutes])

  // os nomes das partes que vieram na URL
  useEffect(() => {
    if (!extras.length) return
    let vivo = true
    Promise.all([
      supabase.from('services').select('id, name, price, duration_minutes').in('id', extras.map((x) => x.servico)),
      supabase.from('professionals').select('id, name, photo_url').in('id', extras.map((x) => x.prof)),
    ]).then(([s, p]) => {
      if (!vivo) return
      setDetalhes({ servicos: Object.fromEntries((s.data ?? []).map((x) => [x.id, x])), profs: Object.fromEntries((p.data ?? []).map((x) => [x.id, x])) })
    })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveExtras])

  // o que outras profissionais do salão fazem na sequência
  const fimDasPartes = extras.reduce((fim, x) => { const s = detalhes.servicos[x.servico]; const f = s ? somarMin(x.hora, s.duration_minutes) : x.hora; return f > fim ? f : fim }, '00:00')
  useEffect(() => {
    if (!esc.prof || !esc.data || !esc.hora || !servico || remarcando) { setVisita([]); return }
    let vivo = true
    supabase.rpc('sugestoes_de_visita', { prof: esc.prof, servicos: ids, dia: esc.data, hora: esc.hora, com_espera: comEspera, apos: extras.length ? fimDasPartes : null })
      .then(({ data }) => { if (vivo) setVisita(data ?? []) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esc.prof, esc.data, esc.hora, chaveIds, chaveExtras, comEspera, fimDasPartes, remarcando, Boolean(servico)])
  const sugVisita = visita.filter((v) => !extras.some((x) => x.servico === v.service_id) && !ids.includes(v.service_id)).slice(0, 4)
  const fimPrincipal = esc.hora && servico ? somarMin(esc.hora, servico.duration_minutes) : ''

  // mudar os serviços principais muda a hora em que ela termina: as partes saem
  const irCom = (novos) => navigate(comQuery('/cliente/agendamento/confirmar', { ...esc, servico: novos.join(','), extra: '' }), { replace: true })
  const irComExtras = (lista) => navigate(comQuery('/cliente/agendamento/confirmar', { ...esc, extra: escreverExtras(lista) }), { replace: true })
  const juntarParte = (v) => { if (extras.length < 3) irComExtras([...extras, { servico: v.service_id, prof: v.professional_id, hora: String(v.hora_sugerida).slice(0, 5) }]) }
  const tirarParte = (i) => irComExtras(extras.filter((_, k) => k !== i))
  const partesDetalhadas = extras.map((x) => ({ ...x, s: detalhes.servicos[x.servico], p: detalhes.profs[x.prof] }))
  const totalVisita = (servico?.price ?? 0) + partesDetalhadas.reduce((a, x) => a + Number(x.s?.price ?? 0), 0)
  const adicionar = (id) => { if (ids.length < 6 && !ids.includes(id)) irCom([...ids, id]) }
  const tirar = (id) => { if (ids.length > 1) irCom(ids.filter((x) => x !== id)) }
  const sugestoes = outros.filter((x) => !ids.includes(x.id)).slice(0, 4)

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

    // um ou vários serviços: o banco soma duração e preço e guarda os itens (079)
    // com outras profissionais na sequência é uma visita: cada parte vira um pedido (081)
    const partes = lerExtras(esc.extra)
    const { data, error } = partes.length
      ? await supabase.rpc('marcar_visita', { dia: esc.data, partes: [{ prof: esc.prof, servicos: servico.ids ?? [servico.id], hora: esc.hora }, ...partes.map((x) => ({ prof: x.prof, servicos: [x.servico], hora: x.hora }))], obs: obs.trim() || null })
      : await supabase.rpc('marcar_servicos', { prof: esc.prof, servicos: servico.ids ?? [servico.id], dia: esc.data, hora: esc.hora, obs: obs.trim() || null })
    setSaving(false)
    if (error) {
      if (error.code === '23505' || error.code === '23P01' || /^ocupado:/.test(error.message)) setErro(partes.length ? 'Um dos horários acabou de ser reservado por outra pessoa. Nada foi marcado: tire essa parte ou escolha outro horário.' : 'Esse horário acabou de ser reservado por outra pessoa. Escolha outro, por favor.')
      else setErro('Erro ao agendar: ' + error.message)
      return
    }
    if (data?.ok === false) {
      setErro(data.motivo === 'ocupado' ? 'Esse horário acabou de ser reservado por outra pessoa. Escolha outro, por favor.' : capitalizar(data.motivo || 'não deu para marcar') + '.')
      return
    }
    navigate(`/cliente/agendamento/sucesso/${data?.appointment_id ?? 'novo'}`, { replace: true })
  }, [servico, esc, user, obs, navigate])

  return (
    <ClienteShell titulo={remarcando ? 'Confirmar troca' : 'Confirmar pedido'} voltar={comQuery('/cliente/agendamento/hora', esc)}>
      <Trilha passo={4} remarcar={esc.remarcar} />
      {erro && <div className="alert alert-error">{erro}</div>}

      <h3 className="secao-titulo">{remarcando ? 'Resumo da troca' : 'Resumo do pedido'}</h3>
      <div className="card resumo-pedido">
        {servico?.lista?.length > 1 ? (
          <div className="resumo-itens">
            <span className="muted">Serviços</span>
            <ul>{servico.lista.map((x) => <li key={x.id}><span>{x.name}</span><span className="muted">{labelDuracao(x)} · {formatPreco(x.price)}{!remarcando && <button type="button" className="resumo-tirar" onClick={() => tirar(x.id)} aria-label={`Tirar ${x.name}`}>×</button>}</span></li>)}</ul>
          </div>
        ) : (
          <div className="resumo-linha"><span className="muted">Serviço</span><strong>{servico?.name}</strong></div>
        )}
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
        {servico && <div className="resumo-linha"><span className="muted">{servico.lista?.length > 1 ? 'Duração total' : 'Duração'}</span><strong>{formatDuracao(servico.duration_minutes)}{servico.lista?.length > 1 && <span className="muted resumo-soma"> ({servico.lista.map((x) => formatDuracao(x.duration_minutes)).join(' + ')})</span>}</strong></div>}
        <div className="resumo-linha resumo-total"><span>{servico?.lista?.length > 1 ? 'Valor total' : 'Valor'}</span><strong>{servico && formatPreco(servico.price)}</strong></div>
      </div>

      {partesDetalhadas.length > 0 && (
        <div className="card resumo-pedido resumo-visita">
          <div className="resumo-visita-topo"><Users size={16} /> <strong>Na mesma visita</strong><span className="muted">cada profissional confirma a parte dela</span></div>
          <ul className="resumo-partes">
            {partesDetalhadas.map((x, i) => (
              <li key={x.servico + x.prof}>
                <span className="resumo-parte-hora">{x.hora}</span>
                <span className="resumo-parte-oque"><strong>{x.s?.name ?? '…'}</strong><span className="muted">com {x.p?.name ?? '…'}{x.s ? ` · ${formatDuracao(x.s.duration_minutes)} · ${formatPreco(x.s.price)}` : ''}{fimPrincipal && diffMin(i === 0 ? fimPrincipal : somarMin(partesDetalhadas[i - 1].hora, partesDetalhadas[i - 1].s?.duration_minutes ?? 0), x.hora) > 0 ? ` · espera de ${formatDuracao(diffMin(i === 0 ? fimPrincipal : somarMin(partesDetalhadas[i - 1].hora, partesDetalhadas[i - 1].s?.duration_minutes ?? 0), x.hora))}` : ''}</span></span>
                <button type="button" className="resumo-tirar" onClick={() => tirarParte(i)} aria-label={`Tirar ${x.s?.name ?? 'parte'}`}>×</button>
              </li>
            ))}
          </ul>
          <div className="resumo-linha resumo-total"><span>Valor da visita</span><strong>{formatPreco(totalVisita)}</strong></div>
        </div>
      )}

      {!remarcando && !cabe && (
        <div className="alert alert-error resumo-nao-cabe">
          Com {servico?.lista?.[servico.lista.length - 1]?.name}, o atendimento fica com {formatDuracao(servico?.duration_minutes ?? 0)} e não cabe às {esc.hora}.
          <div className="resumo-nao-cabe-acoes">
            <Link className="btn btn-primary btn-mini" to={comQuery('/cliente/agendamento/hora', esc)}>Escolher outro horário</Link>
            <button type="button" className="btn btn-ghost btn-mini" onClick={() => tirar(ids[ids.length - 1])}>Tirar {servico?.lista?.[servico.lista.length - 1]?.name}</button>
          </div>
        </div>
      )}

      {!remarcando && sugestoes.length > 0 && (
        <section className="upsell">
          <h3 className="secao-titulo">Quer aproveitar e adicionar?</h3>
          <p className="muted upsell-sub">Entra no mesmo horário, um atrás do outro.</p>
          <div className="upsell-lista">
            {sugestoes.map((x) => (
              <button key={x.id} type="button" className="card upsell-item" onClick={() => adicionar(x.id)}>
                <span className="upsell-foto" aria-hidden="true">{x.images?.[0] ? <img src={x.images[0]} alt="" /> : <Sparkles size={18} />}</span>
                <span className="upsell-texto"><strong>{x.name}</strong><span className="muted">+{formatDuracao(x.duration_minutes)} · {formatPreco(x.price)}</span></span>
                <span className="upsell-mais"><Plus size={16} /> Adicionar</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!remarcando && (sugVisita.length > 0 || comEspera) && (
        <section className="upsell visita-oferta">
          <h3 className="secao-titulo">No salão, aproveita e faz também</h3>
          <p className="muted upsell-sub">Com outra profissional, na sequência do seu horário. Cada uma confirma a parte dela.</p>
          <label className="visita-espera">
            <input type="checkbox" checked={comEspera} onChange={(e) => setComEspera(e.target.checked)} />
            <span><strong>Aceito esperar um pouco</strong><span className="muted">abre mais horários no mesmo dia</span></span>
          </label>
          {sugVisita.length === 0 ? (
            <p className="muted visita-vazio">Ninguém livre na sequência neste dia.</p>
          ) : (
            <div className="upsell-lista">
              {sugVisita.map((v) => {
                const hora = String(v.hora_sugerida).slice(0, 5)
                const espera = diffMin(extras.length ? fimDasPartes : fimPrincipal, hora)
                return (
                  <button key={v.service_id + v.professional_id} type="button" className="card upsell-item visita-item" onClick={() => juntarParte(v)}>
                    <span className="upsell-foto" aria-hidden="true">{v.photo_url ? <img src={v.photo_url} alt="" /> : <Sparkles size={18} />}</span>
                    <span className="upsell-texto"><strong>{v.service_name}</strong><span className="muted">com {v.professional_name}</span><span className="muted">{formatDuracao(v.duration_minutes)} · {formatPreco(v.price)}</span></span>
                    <span className={'visita-hora' + (v.modo === 'logo_depois' ? '' : ' espera')}>{v.modo === 'logo_depois' || espera <= 0 ? <><Check size={13} /> às {hora}, na sequência</> : <><Hourglass size={13} /> às {hora}, espera de {formatDuracao(espera)}</>}</span>
                    <span className="upsell-mais"><Plus size={16} /> Juntar</span>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      )}

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
        <button className="btn btn-primary btn-block" onClick={confirmar} disabled={saving || !servico || !cabe || conferindo}>
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
  const [partes, setPartes] = useState([])
  useEffect(() => {
    if (!appt?.visita_id) { setPartes([]); return }
    supabase.rpc('partes_da_visita', { appt: appt.id }).then(({ data }) => setPartes(data ?? []))
  }, [appt?.id, appt?.visita_id])

  const troca = Boolean(appt?.remarca_de)
  const jaTrocou = troca && appt.status === 'confirmado'
  const jaConfirmou = !troca && appt?.status === 'confirmado'
  const titulo = jaTrocou ? 'Remarcado!' : jaConfirmou ? 'Agendamento confirmado! 🎉' : troca ? 'Pedido de troca enviado!' : 'Pedido enviado!'
  const texto = jaTrocou
    ? 'Sua profissional não pede confirmação, então a troca já valeu. Ela foi avisada.'
    : jaConfirmou
      ? 'Sua profissional não pede confirmação: o horário já é seu. Ela foi avisada.'
      : troca
        ? 'Seu horário atual continua guardado. Assim que a profissional aceitar a troca, você recebe um aviso aqui no app.'
        : partes.length
          ? 'Sua visita ficou guardada. Cada profissional confirma a parte dela, e você recebe um aviso aqui no app.'
          : 'Seu horário ficou guardado, aguardando a confirmação da profissional. Assim que ela responder, você recebe um aviso aqui no app.'

  return (
    <ClienteShell semTopo>
      <div className="sucesso">
        <span className="sucesso-check" aria-hidden="true">{troca ? <Repeat /> : <Check />}</span>
        <h2>{titulo}</h2>
        <p className="muted">{texto}</p>
        {appt && (
          <div className="card resumo-pedido" style={{ textAlign: 'left', width: '100%' }}>
            <div className="resumo-linha"><span className="muted">Serviço</span><strong>{appt.services?.name}</strong></div>
            <div className="resumo-linha"><span className="muted">Com</span><strong>{appt.professionals?.name}</strong></div>
            <div className="resumo-linha"><span className="muted">{troca ? 'Novo horário' : 'Quando'}</span><strong>{formatDataLonga(appt.date)} às {appt.start_time.slice(0, 5)}</strong></div>
            {partes.map((x) => (
              <div key={x.appointment_id} className="resumo-linha resumo-parte-sucesso"><span className="muted">Depois</span><strong>{x.servico} com {x.profissional} às {String(x.inicio).slice(0, 5)}</strong></div>
            ))}
          </div>
        )}
        {appt ? <Link to={`/cliente/agendamento/${appt.id}`} className="btn btn-primary btn-block">Ver este agendamento</Link>
              : <Link to="/cliente/meus-agendamentos" className="btn btn-primary btn-block">Ver meus agendamentos</Link>}
        <Link to="/cliente/home" className="btn btn-ghost btn-block">Voltar ao início</Link>
      </div>
    </ClienteShell>
  )
}

function curta(iso) {
  const d = new Date(iso + 'T12:00:00')
  return `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
