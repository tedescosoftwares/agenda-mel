import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { formatPreco, labelDuracao, formatDuracao } from '../../lib/format'
import { precoEscrito, prefixoAPartir, AVISO_A_PARTIR } from '../../../packages/core/salao.js'
import { iniciais } from '../../lib/booking'
import { useCategorias, nomeDaCategoria } from '../../lib/categorias'
import { Sparkles, Clock, Tag, Users, Plus, Check, ChevronRight, BadgePercent, X, Zap } from 'lucide-react'
import Portal from '../../components/Portal'

// A página de um serviço (2.25): fotos, descrição, preço (com o desconto
// da promoção que ela enxerga), duração, quem faz e o que costuma ir
// junto. Chega com ?prof=<id> quando ela já está no fluxo de uma
// profissional, ?sel=<ids> com o que já tinha escolhido e ?de=<origem>
// dizendo de onde veio — é isso que decide o "voltar".
//
// 4.15: a profissional da URL só vale como ESCOLHIDA quando a cliente escolheu de verdade: veio do perfil dela
// (de=perfil:…), do passo de serviços dela (sem ?de) ou de um toque explícito (?firme=1: o filtro "com fulana", a
// promoção de uma profissional, a página dela). Fora isso é palpite (a preferida, a primeira): se mais de uma faz o
// serviço, "Escolher data" pergunta com quem, em vez de mandar todo mundo para a mesma.

// De onde ela veio → para onde o voltar leva. Sem `de`, vale a regra
// antiga: com profissional, a lista de serviços dela; senão, a Home.
//   home                      → /cliente/home
//   salao:<id>                → página do salão
//   categoria:<salao>:<cat>   → categoria do salão
//   perfil:<prof>             → perfil da profissional
function rotaDeOrigem(de, profId, sel = []) {
  if (de === 'home') return '/cliente/home'
  const [tipo, a, b] = (de || '').split(':')
  if (tipo === 'salao' && a) return `/cliente/salao/${a}`
  if (tipo === 'categoria' && a && b) return `/cliente/salao/${a}/categoria/${b}`
  if (tipo === 'perfil' && a) return `/cliente/profissional/${a}`
  if (profId) return `/cliente/profissional/${profId}/servicos${sel.length ? `?servico=${sel.join(',')}` : ''}`
  return '/cliente/home'
}

export default function ClienteServico() {
  const { id } = useParams()
  const [q] = useSearchParams()
  const navigate = useNavigate()
  const profId = q.get('prof') || ''
  const de = q.get('de') || ''
  const sel = (q.get('sel') || '').split(',').filter(Boolean)
  const cats = useCategorias()
  const [s, setS] = useState(null)
  const [quem, setQuem] = useState([])
  const [juntos, setJuntos] = useState([])
  const [desconto, setDesconto] = useState(null)
  const [foto, setFoto] = useState(0)
  const [loading, setLoading] = useState(true)
  const [perguntar, setPerguntar] = useState(false)   // a folha "com quem?"
  // 4.16: o próximo horário livre de cada uma (a folha mostra, e "quem tem horário mais perto" usa). null = procurando
  const [proximos, setProximos] = useState(null)       // { [profId]: { dia, hora } | null }
  useEffect(() => {
    if (!perguntar || !s) return
    let vivo = true
    setProximos(null)
    Promise.all(quem.map(async (p) => {
      const duracao = p.duracao_minutos ?? s.duration_minutes
      try {
        const { data: dias } = await supabase.rpc('dias_com_vaga', { prof: p.id, duracao, quantos: 1 })
        const dia = dias?.[0]?.dia
        if (!dia) return [p.id, null]
        const { data: horas } = await supabase.rpc('horarios_livres', { prof: p.id, dia, duracao })
        const hora = horas?.[0]?.hora
        return [p.id, hora ? { dia, hora: String(hora).slice(0, 5) } : null]
      } catch { return [p.id, null] }
    })).then((pares) => { if (vivo) setProximos(Object.fromEntries(pares)) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perguntar])

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [sv, ps, ju, de] = await Promise.all([
        supabase.from('services').select('*, salons (name, tipo)').eq('id', id).maybeSingle(),
        supabase.from('professional_services').select('preco_cents, duracao_minutos, professionals (id, name, photo_url, active, salon_id)').eq('service_id', id),
        supabase.rpc('servicos_sugeridos_para', { servicos: [id] }),
        supabase.rpc('descontos_para_mim', { servicos: [id] }),
      ])
      if (!vivo) return
      // (se o banco não devolver o salão junto, o serviço vem sozinho)
      setS(sv.data ?? (sv.error ? (await supabase.from('services').select('*').eq('id', id).maybeSingle()).data : null) ?? null)
      setQuem((ps.data ?? []).map((v) => (v.professionals ? { ...v.professionals, preco_cents: v.preco_cents, duracao_minutos: v.duracao_minutos } : null)).filter((p) => p?.active).sort((a, b) => a.name.localeCompare(b.name)))
      const ids = (ju.data ?? []).map((x) => x.sugerido_id)
      if (ids.length) {
        const { data: js } = await supabase.from('services').select('id, name, price, duration_minutes, images, a_partir').in('id', ids)
        if (vivo) setJuntos(js ?? [])
      } else setJuntos([])
      setDesconto((de.data ?? [])[0] ?? null)
      setLoading(false)
    })()
    return () => { vivo = false }
  }, [id])

  const voltar = rotaDeOrigem(de, profId, sel)
  if (loading) return <ClienteShell titulo="Serviço" voltar={voltar}><p className="carregando">Carregando…</p></ClienteShell>
  if (!s) return <ClienteShell titulo="Serviço" voltar={voltar}><div className="card empty-state"><p>Não encontramos esse serviço.</p></div></ClienteShell>

  const jaEscolhido = sel.includes(s.id)
  const escolha = jaEscolhido ? sel : [...sel, s.id]
  // a origem segue junto para o próximo serviço e para o fluxo de marcar
  const comOrigem = (obj) => new URLSearchParams({ ...obj, ...(de ? { de } : {}) })
  // com quem: a que ela escolheu de verdade, ou a única que faz. O palpite da URL (sem escolha dela) vira só sugestão.
  const escolhida = Boolean(profId) && (!de || de.startsWith('perfil:') || q.get('firme') === '1' || sel.length > 0)
  const prof = (escolhida && quem.some((p) => p.id === profId) ? profId : '') || (quem.length === 1 ? quem[0].id : '')
  const sugerida = !prof && profId && quem.some((p) => p.id === profId) ? profId : ''
  const salaoNome = s.salons?.tipo === 'salao' ? s.salons?.name : null
  // quem tem o horário livre mais cedo (dia e hora); empate fica com a preferida, depois pela ordem do nome
  const maisPerto = proximos
    ? quem.filter((p) => proximos[p.id]).sort((a, b) => `${proximos[a.id].dia} ${proximos[a.id].hora}`.localeCompare(`${proximos[b.id].dia} ${proximos[b.id].hora}`) || (b.id === sugerida) - (a.id === sugerida))[0] ?? null
    : null
  const quando = (x) => {
    const d = new Date(x.dia + 'T12:00:00'), hoje = new Date(), amanha = new Date(Date.now() + 864e5)
    const dia = d.toDateString() === hoje.toDateString() ? 'hoje' : d.toDateString() === amanha.toDateString() ? 'amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '')
    return `${dia} às ${x.hora}`
  }
  const irParaData = (p) => navigate(`/cliente/agendamento/data?${comOrigem({ prof: p, servico: escolha.join(','), firme: '1' })}`)
  const fotos = s.images ?? []
  const precoPor = desconto ? desconto.preco_com_desconto_cents / 100 : null

  return (
    <ClienteShell titulo={s.name} voltar={voltar}>
      <div className={'svc-galeria' + (fotos.length ? '' : ' sem-foto')}>
        {fotos.length ? <img src={fotos[foto]} alt={s.name} /> : <span className="svc-sem-foto"><Sparkles size={42} /></span>}
        {desconto && <span className="svc-selo"><BadgePercent size={14} /> -{desconto.desconto_pct}%</span>}
        {fotos.length > 1 && (
          <div className="svc-miniaturas">
            {fotos.map((f, i) => <button key={f} type="button" className={i === foto ? 'on' : ''} onClick={() => setFoto(i)} aria-label={`Foto ${i + 1}`}><img src={f} alt="" /></button>)}
          </div>
        )}
      </div>

      <div className="svc-cabeca">
        <span className="muted svc-categoria">{nomeDaCategoria(cats, s.categoria_id)}{s.is_combo ? ' · combo' : ''}</span>
        <h2>{s.name}</h2>
        <div className="svc-preco">
          {precoPor != null ? (
            <><strong>{s.a_partir ? <span className="muted svc-a-partir">a partir de </span> : null}{formatPreco(precoPor)}</strong><s className="muted">{formatPreco(s.price)}</s><span className="svc-promo-nome">{desconto.titulo}</span></>
          ) : <strong>{s.a_partir && Number(s.price) > 0 ? <span className="muted svc-a-partir">a partir de </span> : null}{precoEscrito(s.price, formatPreco)}</strong>}
          <span className="muted svc-dur"><Clock size={14} /> {labelDuracao(s)}</span>
        </div>
        {s.a_partir && Number(s.price) > 0 && <p className="muted svc-a-partir-aviso">{AVISO_A_PARTIR}</p>}
        {!(Number(s.price) > 0) && <p className="muted svc-a-partir-aviso">O valor é combinado com o salão no atendimento.</p>}
      </div>

      {s.description && <div className="card svc-bloco"><Tag size={16} /><p>{s.description}</p></div>}

      {quem.length > 0 && (
        <section className="svc-secao">
          <h3 className="secao-titulo"><Users size={15} /> {!profId && quem.length > 1 ? 'Com quem você quer marcar?' : 'Quem faz'}</h3>
          <div className="cliente-list">
            {quem.map((p) => (
              // 4.14: tocar em quem faz já leva para a data, com este serviço escolhido (antes abria o perfil dela e
              // pedia o serviço de novo)
              <Link key={p.id} to={`/cliente/agendamento/data?${comOrigem({ prof: p.id, servico: escolha.join(','), firme: '1' })}`} className={'card agdt-linha agdt-link' + (p.id === prof ? ' svc-prof-atual' : '')}>
                <span className="agdt-avatar">{p.photo_url ? <img src={p.photo_url} alt="" /> : iniciais(p.name)}</span>
                <span className="cliente-info"><span className="cliente-nome"><span className="nome-txt">{p.name}</span></span>{p.id === prof && quem.length > 1 && <span className="muted cliente-meta">você está marcando com ela</span>}{p.id === sugerida && <span className="muted cliente-meta">sua preferida</span>}{(p.preco_cents != null || p.duracao_minutos != null) && <span className="muted cliente-meta">com ela: {[p.preco_cents != null ? formatPreco(p.preco_cents / 100) : null, p.duracao_minutos != null ? formatDuracao(p.duracao_minutos) : null].filter(Boolean).join(' · ')}</span>}</span>
                <span className="link-ver svc-quem-agendar">Agendar <ChevronRight size={15} /></span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {juntos.length > 0 && (
        <section className="svc-secao">
          <h3 className="secao-titulo">Costuma ir junto</h3>
          <div className="cliente-list">
            {juntos.map((x) => (
              <Link key={x.id} to={`/cliente/servico/${x.id}?${comOrigem({ ...(prof ? { prof } : {}), sel: escolha.join(',') })}`} className="card servico-linha">
                <span className="servico-linha-foto" aria-hidden="true">{x.images?.[0] ? <img src={x.images[0]} alt="" /> : <Sparkles />}</span>
                <span className="cliente-info"><span className="cliente-nome"><span className="nome-txt">{x.name}</span></span><span className="muted cliente-meta">{prefixoAPartir(x)}{precoEscrito(x.price, formatPreco)} · {formatDuracao(x.duration_minutes)}</span></span>
                <ChevronRight size={18} className="agdt-seta" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* o rodapé fixo só existe quando há com quem marcar; sem ninguém, a
          nota vai no fluxo, em cartão, em vez de flutuar no pé da tela */}
      {prof ? (
        <>
          <div className="svc-espaco" aria-hidden="true" />
          <div className="rodape-fixo rodape-servicos">
            {sel.length > 0 && !jaEscolhido && <p className="muted svc-rodape-nota">Entra junto com {sel.length === 1 ? 'o que você já escolheu' : `os ${sel.length} que você já escolheu`}.</p>}
            <button className="btn btn-primary btn-block" onClick={() => irParaData(prof)}>
              {jaEscolhido ? <><Check size={16} /> Escolher data</> : sel.length ? <><Plus size={16} /> Adicionar e escolher data</> : 'Escolher data'}
            </button>
            <Link to={`/cliente/profissional/${prof}/servicos?servico=${escolha.join(',')}`} className="btn btn-ghost btn-block">{jaEscolhido ? 'Ver outros serviços' : 'Adicionar e ver outros serviços'}</Link>
          </div>
        </>
      ) : quem.length > 1 ? (
        <>
          <div className="svc-espaco" aria-hidden="true" />
          <div className="rodape-fixo">
            <button className="btn btn-primary btn-block" onClick={() => setPerguntar(true)} data-teste="svc-escolher-data">Escolher data</button>
          </div>
        </>
      ) : (
        <div className="card empty-state"><p>Ninguém atendendo com este serviço agora.</p></div>
      )}

      {perguntar && (
        <Portal><div className="modal-fundo" onClick={() => setPerguntar(false)}>
          <div className="modal-caixa svc-quem-folha" role="dialog" aria-modal="true" aria-labelledby="svc-quem-titulo" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="svc-quem-fechar" onClick={() => setPerguntar(false)} aria-label="Fechar"><X size={17} /></button>
            <h3 id="svc-quem-titulo">Com quem você quer marcar?</h3>
            <p className="muted">{quem.length} profissionais fazem {s.name}{salaoNome ? ` no ${salaoNome}` : ''}. Tem preferência por alguma?</p>
            <button type="button" className="svc-quem-perto" disabled={!maisPerto} data-teste="svc-mais-perto"
              onClick={() => navigate(`/cliente/agendamento/hora?${comOrigem({ prof: maisPerto.id, servico: escolha.join(','), data: proximos[maisPerto.id].dia, firme: '1' })}`)}>
              <Zap size={18} />
              <span><strong>Quem tem horário mais perto</strong>
                <small>{proximos == null ? 'Procurando os horários…' : maisPerto ? `${maisPerto.name.split(' ')[0]} · ${quando(proximos[maisPerto.id])}` : 'Ninguém com horário livre nos próximos dias'}</small></span>
              <ChevronRight size={18} />
            </button>
            <p className="svc-quem-ou">ou escolha</p>
            <div className="cliente-list">
              {[...quem].sort((a, b) => (b.id === sugerida) - (a.id === sugerida)).map((p) => (
                <button key={p.id} type="button" className="card agdt-linha agdt-link svc-quem-opcao" onClick={() => irParaData(p.id)}>
                  <span className="agdt-avatar">{p.photo_url ? <img src={p.photo_url} alt="" /> : iniciais(p.name)}</span>
                  <span className="cliente-info"><span className="cliente-nome"><span className="nome-txt">{p.name}</span></span>{p.id === sugerida && <span className="muted cliente-meta">sua preferida</span>}{proximos && <span className="muted cliente-meta">{proximos[p.id] ? `próximo horário: ${quando(proximos[p.id])}` : 'sem horário livre nos próximos dias'}</span>}{(p.preco_cents != null || p.duracao_minutos != null) && <span className="muted cliente-meta">com ela: {[p.preco_cents != null ? formatPreco(p.preco_cents / 100) : null, p.duracao_minutos != null ? formatDuracao(p.duracao_minutos) : null].filter(Boolean).join(' · ')}</span>}</span>
                  <ChevronRight size={18} className="agdt-seta" />
                </button>
              ))}
            </div>
          </div>
        </div></Portal>
      )}
    </ClienteShell>
  )
}
