import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { formatPreco, labelDuracao, formatDuracao } from '../../lib/format'
import { iniciais } from '../../lib/booking'
import { useCategorias, nomeDaCategoria } from '../../lib/categorias'
import { Sparkles, Clock, Tag, Users, Plus, Check, ChevronRight, BadgePercent } from 'lucide-react'

// A página de um serviço (2.25): fotos, descrição, preço (com o desconto
// da promoção que ela enxerga), duração, quem faz e o que costuma ir
// junto. Chega com ?prof=<id> quando ela já está no fluxo de uma
// profissional, e ?sel=<ids> com o que já tinha escolhido.
export default function ClienteServico() {
  const { id } = useParams()
  const [q] = useSearchParams()
  const navigate = useNavigate()
  const profId = q.get('prof') || ''
  const sel = (q.get('sel') || '').split(',').filter(Boolean)
  const cats = useCategorias()
  const [s, setS] = useState(null)
  const [quem, setQuem] = useState([])
  const [juntos, setJuntos] = useState([])
  const [desconto, setDesconto] = useState(null)
  const [foto, setFoto] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [sv, ps, ju, de] = await Promise.all([
        supabase.from('services').select('*').eq('id', id).maybeSingle(),
        supabase.from('professional_services').select('professionals (id, name, photo_url, active, salon_id)').eq('service_id', id),
        supabase.rpc('servicos_sugeridos_para', { servicos: [id] }),
        supabase.rpc('descontos_para_mim', { servicos: [id] }),
      ])
      if (!vivo) return
      setS(sv.data ?? null)
      setQuem((ps.data ?? []).map((v) => v.professionals).filter((p) => p?.active).sort((a, b) => a.name.localeCompare(b.name)))
      const ids = (ju.data ?? []).map((x) => x.sugerido_id)
      if (ids.length) {
        const { data: js } = await supabase.from('services').select('id, name, price, duration_minutes, images').in('id', ids)
        if (vivo) setJuntos(js ?? [])
      } else setJuntos([])
      setDesconto((de.data ?? [])[0] ?? null)
      setLoading(false)
    })()
    return () => { vivo = false }
  }, [id])

  const voltar = profId ? `/cliente/profissional/${profId}/servicos${sel.length ? `?servico=${sel.join(',')}` : ''}` : '/cliente/home'
  if (loading) return <ClienteShell titulo="Serviço" voltar={voltar}><p className="muted">Carregando…</p></ClienteShell>
  if (!s) return <ClienteShell titulo="Serviço" voltar={voltar}><div className="card empty-state"><p>Não encontramos esse serviço.</p></div></ClienteShell>

  const jaEscolhido = sel.includes(s.id)
  const escolha = jaEscolhido ? sel : [...sel, s.id]
  // com quem: a da URL, ou a única que faz
  const prof = profId || (quem.length === 1 ? quem[0].id : '')
  const fotos = s.images ?? []
  const precoPor = desconto ? desconto.preco_com_desconto_cents / 100 : null

  return (
    <ClienteShell titulo={s.name} voltar={voltar}>
      <div className="svc-galeria">
        {fotos.length ? <img src={fotos[foto]} alt={s.name} /> : <span className="svc-sem-foto"><Sparkles size={42} /></span>}
        {desconto && <span className="svc-selo"><BadgePercent size={14} /> -{desconto.desconto_pct}%</span>}
        {fotos.length > 1 && (
          <div className="svc-miniaturas">
            {fotos.map((f, i) => <button key={f} type="button" className={i === foto ? 'on' : ''} onClick={() => setFoto(i)} aria-label={`Foto ${i + 1}`}><img src={f} alt="" /></button>)}
          </div>
        )}
      </div>

      <div className="svc-cabeca">
        <span className="muted svc-cat">{nomeDaCategoria(cats, s.categoria_id)}{s.is_combo ? ' · combo' : ''}</span>
        <h2>{s.name}</h2>
        <div className="svc-preco">
          {precoPor != null ? (
            <><strong>{formatPreco(precoPor)}</strong><s className="muted">{formatPreco(s.price)}</s><span className="svc-promo-nome">{desconto.titulo}</span></>
          ) : <strong>{formatPreco(s.price)}</strong>}
          <span className="muted svc-dur"><Clock size={14} /> {labelDuracao(s)}</span>
        </div>
      </div>

      {s.description && <div className="card svc-bloco"><Tag size={16} /><p>{s.description}</p></div>}

      {quem.length > 0 && (
        <section className="svc-secao">
          <h3 className="secao-titulo"><Users size={15} /> Quem faz</h3>
          <div className="cliente-list">
            {quem.map((p) => (
              <Link key={p.id} to={`/cliente/profissional/${p.id}`} className={'card agdt-linha agdt-link' + (p.id === profId ? ' svc-prof-atual' : '')}>
                <span className="agdt-avatar">{p.photo_url ? <img src={p.photo_url} alt="" /> : iniciais(p.name)}</span>
                <span className="cliente-info"><span className="cliente-nome"><span className="nome-txt">{p.name}</span></span>{p.id === profId && <span className="muted cliente-meta">você está marcando com ela</span>}</span>
                <ChevronRight size={18} className="agdt-seta" />
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
              <Link key={x.id} to={`/cliente/servico/${x.id}?${new URLSearchParams({ ...(prof ? { prof } : {}), sel: escolha.join(',') })}`} className="card servico-linha">
                <span className="servico-linha-foto" aria-hidden="true">{x.images?.[0] ? <img src={x.images[0]} alt="" /> : <Sparkles />}</span>
                <span className="cliente-info"><span className="cliente-nome"><span className="nome-txt">{x.name}</span></span><span className="muted cliente-meta">{formatPreco(x.price)} · {formatDuracao(x.duration_minutes)}</span></span>
                <ChevronRight size={18} className="agdt-seta" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="svc-espaco" aria-hidden="true" />

      <div className="rodape-fixo rodape-servicos">
        {sel.length > 0 && !jaEscolhido && <p className="muted svc-rodape-nota">Entra junto com {sel.length === 1 ? 'o que você já escolheu' : `os ${sel.length} que você já escolheu`}.</p>}
        {prof ? (
          <>
            <button className="btn btn-primary btn-block" onClick={() => navigate(`/cliente/agendamento/data?prof=${prof}&servico=${escolha.join(',')}`)}>
              {jaEscolhido ? <><Check size={16} /> Escolher data</> : sel.length ? <><Plus size={16} /> Adicionar e escolher data</> : 'Escolher data'}
            </button>
            <Link to={`/cliente/profissional/${prof}/servicos?servico=${escolha.join(',')}`} className="btn btn-ghost btn-block">{jaEscolhido ? 'Ver outros serviços' : 'Adicionar e ver outros serviços'}</Link>
          </>
        ) : quem.length > 1 ? (
          <p className="muted svc-rodape-nota">Escolha acima com quem quer marcar.</p>
        ) : (
          <p className="muted svc-rodape-nota">Ninguém atendendo com este serviço agora.</p>
        )}
      </div>
    </ClienteShell>
  )
}
