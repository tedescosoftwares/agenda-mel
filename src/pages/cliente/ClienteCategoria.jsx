import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { formatPreco, labelDuracao } from '../../lib/format'
import { iniciais } from '../../lib/booking'
import { useCategorias, capaPadrao } from '../../lib/categorias'
import { Sparkles, ChevronRight, Star, BadgePercent } from 'lucide-react'

// A página de uma categoria do salão (088): as imagens da categoria em
// carrossel no topo e os serviços dela embaixo. Quando mais de uma
// profissional faz o mesmo serviço, mostra quem, e a preferida da
// cliente (se houver) já vai marcada: tocar no serviço leva para ela.
export default function ClienteCategoria() {
  const { id, cat } = useParams()
  const navigate = useNavigate()
  const cats = useCategorias()
  const [pg, setPg] = useState(null)
  const [foto, setFoto] = useState(0)
  const [descontos, setDescontos] = useState({})
  const [escolhida, setEscolhida] = useState('')      // filtro "só com fulana" nesta visita
  const faixa = useRef(null)

  useEffect(() => {
    let vivo = true
    supabase.rpc('pagina_do_salao', { salao: id }).then(async ({ data }) => {
      if (!vivo) return
      setPg(data ?? null)
      const ids = (data?.servicos ?? []).map((s) => s.id)
      if (ids.length) {
        const { data: d } = await supabase.rpc('descontos_para_mim', { servicos: ids })
        if (vivo) setDescontos(Object.fromEntries((d ?? []).map((x) => [x.service_id, x])))
      }
    })
    return () => { vivo = false }
  }, [id])

  const categoria = cat === 'outros' ? { id: '', nome: 'Outros' } : cats.find((c) => c.id === cat)
  // só o que alguém faz (o resto não dá para marcar), da categoria pedida
  const servicos = useMemo(() => (pg?.servicos ?? []).filter((s) => (s.quem ?? []).length > 0).filter((s) => (cat === 'outros' ? !s.categoria_id || !cats.some((c) => c.id === s.categoria_id) : s.categoria_id === cat)), [pg, cat, cats])
  const imagens = (cat !== 'outros' && pg?.capas?.[cat]?.length) ? pg.capas[cat] : [capaPadrao(categoria?.nome)]
  const equipe = pg?.equipe ?? []
  const preferida = pg?.preferida ? equipe.find((p) => p.id === pg.preferida) : null
  // quem aparece nos chips: só quem faz algo desta categoria
  const quemFaz = equipe.filter((p) => servicos.some((s) => (s.quem ?? []).some((q) => q.id === p.id)))
  const filtro = escolhida || ''
  const visiveis = filtro ? servicos.filter((s) => (s.quem ?? []).some((q) => q.id === filtro)) : servicos

  // para onde o toque leva: a escolhida desta visita, senão a preferida
  // (se ela faz), senão a única que faz; senão a página do serviço decide
  const profPara = (sv) => {
    const quem = sv.quem ?? []
    if (filtro && quem.some((q) => q.id === filtro)) return filtro
    if (preferida && quem.some((q) => q.id === preferida.id)) return preferida.id
    if (quem.length === 1) return quem[0].id
    return ''
  }

  async function marcarPreferida(profId) {
    setPg((x) => ({ ...x, preferida: profId }))
    await supabase.rpc('escolher_preferida', { salao: id, prof: profId })
  }

  const voltar = `/cliente/salao/${id}`
  if (!pg) return <ClienteShell titulo="Categoria" voltar={voltar}><p className="carregando">Carregando…</p></ClienteShell>
  if (!categoria) return <ClienteShell titulo="Categoria" voltar={voltar}><div className="card empty-state"><p>Categoria não encontrada.</p></div></ClienteShell>

  return (
    <ClienteShell titulo={categoria.nome} voltar={voltar}>
      <div className="catpg-capa">
        <div className="salao-carrossel" ref={faixa} onScroll={() => { const el = faixa.current; if (el) setFoto(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))) }}>
          {imagens.map((f, i) => <img key={f} src={f} alt="" loading={i === 0 ? 'eager' : 'lazy'} />)}
        </div>
        <span className="cat-card-veu"><strong>{categoria.nome}</strong><span>{servicos.length} {servicos.length === 1 ? 'serviço' : 'serviços'} · {pg.salao?.nome}</span></span>
        {imagens.length > 1 && <div className="salao-capa-pontos">{imagens.map((f, i) => <button key={f} type="button" className={i === foto ? 'on' : ''} onClick={() => faixa.current?.scrollTo({ left: i * faixa.current.clientWidth, behavior: 'smooth' })} aria-label={`Imagem ${i + 1}`} />)}</div>}
      </div>

      {quemFaz.length > 1 && (
        <div className="catpg-quem">
          <span className="muted catpg-rotulo">Com quem?</span>
          <div className="filtro-chips rolavel">
            <button type="button" className={!filtro ? 'chip active' : 'chip'} onClick={() => setEscolhida('')}>{preferida ? `Tanto faz` : 'Qualquer uma'}</button>
            {quemFaz.map((p) => (
              <button key={p.id} type="button" className={'chip chip-prof' + (filtro === p.id ? ' active' : '')} onClick={() => setEscolhida(filtro === p.id ? '' : p.id)}>
                <span className="chip-avatar">{p.foto ? <img src={p.foto} alt="" /> : iniciais(p.nome)}</span>
                {p.nome.split(' ')[0]}{preferida?.id === p.id && <Star size={11} className="chip-estrela" />}
              </button>
            ))}
          </div>
          {preferida ? (
            <p className="muted catpg-pref"><Star size={12} /> Sua preferida é {preferida.nome.split(' ')[0]}: o toque já vai para ela.{filtro && filtro !== preferida.id && <> <button type="button" className="link-ver" onClick={() => marcarPreferida(filtro)}>Tornar {quemFaz.find((p) => p.id === filtro)?.nome.split(' ')[0]} a preferida</button></>}</p>
          ) : filtro ? (
            <p className="muted catpg-pref"><button type="button" className="link-ver" onClick={() => marcarPreferida(filtro)}><Star size={12} /> Marcar {quemFaz.find((p) => p.id === filtro)?.nome.split(' ')[0]} como minha preferida neste salão</button></p>
          ) : null}
        </div>
      )}

      <div className="cliente-list">
        {visiveis.length === 0 && <div className="card empty-state"><p>Nada nesta categoria{filtro ? ' com ela' : ''}.</p></div>}
        {visiveis.map((sv) => {
          const prof = profPara(sv)
          const quem = sv.quem ?? []
          const d = descontos[sv.id]
          return (
            <Link key={sv.id} to={`/cliente/servico/${sv.id}?${new URLSearchParams({ ...(prof ? { prof } : {}), de: `categoria:${id}:${cat}` })}`} className="card servico-linha">
              <span className="servico-linha-foto" aria-hidden="true">{sv.images?.[0] ? <img src={sv.images[0]} alt="" /> : <Sparkles />}</span>
              <span className="cliente-info">
                <span className="cliente-nome"><span className="nome-txt">{sv.name}</span>{sv.is_combo && <span className="badge badge-combo">combo</span>}{d && <span className="badge badge-promo"><BadgePercent size={10} /> -{d.desconto_pct}%</span>}</span>
                <span className="muted cliente-meta">{d ? <><strong className="preco-por">{formatPreco(d.preco_com_desconto_cents / 100)}</strong> <s>{formatPreco(sv.price)}</s></> : formatPreco(sv.price)} · {labelDuracao(sv)}</span>
                {quem.length > 0 && (
                  <span className="catpg-quem-linha">
                    <span className="home-salao-avatares">{quem.slice(0, 4).map((q) => q.foto ? <img key={q.id} src={q.foto} alt="" /> : <span key={q.id}>{q.nome.charAt(0)}</span>)}</span>
                    {/* curto de propósito: fica ao lado dos avatares numa linha só */}
                    <span className="muted">{quem.length === 1 ? `com ${quem[0].nome.split(' ')[0]}` : prof ? `com ${quem.find((q) => q.id === prof)?.nome.split(' ')[0]}${preferida?.id === prof ? ' ★' : ''} · +${quem.length - 1}` : `${quem.length} profissionais`}</span>
                  </span>
                )}
              </span>
              <ChevronRight size={18} className="agdt-seta" />
            </Link>
          )
        })}
      </div>
    </ClienteShell>
  )
}
