import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { formatPreco, labelDuracao } from '../../lib/format'
import { iniciais } from '../../lib/booking'
import { useCategorias, agruparPorCategoria } from '../../lib/categorias'
import { StarIcon, InstagramIcon } from '../../components/icons'
import { MapPin, Phone, Clock, Sparkles, Store, ChevronRight, BadgePercent, MessageCircle } from 'lucide-react'

// A página do salão (085): fotos, descrição, contatos, horário, a
// equipe, os serviços por categoria (com quem faz) e as promoções da
// casa que ela enxerga. Tudo leva a marcar com alguém.
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export default function ClienteSalao() {
  const { id } = useParams()
  const navigate = useNavigate()
  const cats = useCategorias()
  const [pg, setPg] = useState(null)
  const [foto, setFoto] = useState(0)
  const [aba, setAba] = useState('servicos')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let vivo = true
    supabase.rpc('pagina_do_salao', { salao: id }).then(({ data }) => { if (!vivo) return; setPg(data ?? null); setLoading(false) })
    return () => { vivo = false }
  }, [id])

  const voltar = () => { if (window.history.length > 1) navigate(-1); else navigate('/cliente/home') }
  if (loading) return <ClienteShell voltar="/cliente/home"><p className="muted">Carregando…</p></ClienteShell>
  const s = pg?.salao
  if (!s) return <ClienteShell voltar="/cliente/home"><div className="card empty-state"><p>Não encontramos esse salão.</p></div></ClienteShell>

  const fotos = s.fotos ?? []
  const nota = pg.nota?.quantas ? pg.nota : null
  const endereco = [s.endereco, s.cidade].filter(Boolean).join(' · ')
  const mapa = endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([s.nome, s.endereco, s.cidade].filter(Boolean).join(', '))}` : null
  const zap = s.whatsapp ? 'https://wa.me/55' + String(s.whatsapp).replace(/\D/g, '').replace(/^55/, '') : null
  const insta = s.instagram ? 'https://instagram.com/' + String(s.instagram).replace(/^@/, '') : null
  const hoje = new Date().getDay()
  const horarios = (pg.horarios ?? [])
  const equipe = pg.equipe ?? []
  const servicos = pg.servicos ?? []
  const promos = pg.promocoes ?? []
  const linkServico = (sv) => `/cliente/servico/${sv.id}${sv.quem?.length === 1 ? `?prof=${sv.quem[0].id}` : ''}`

  return (
    <ClienteShell semTopo>
      <div className="perfil-capa salao-capa">
        {fotos.length ? <img src={fotos[foto]} alt="" /> : <span className="perfil-capa-ini"><Store size={64} /></span>}
        <button type="button" onClick={voltar} className="perfil-voltar" aria-label="Voltar">‹</button>
        {fotos.length > 1 && (
          <div className="salao-capa-pontos">{fotos.map((f, i) => <button key={f} type="button" className={i === foto ? 'on' : ''} onClick={() => setFoto(i)} aria-label={`Foto ${i + 1}`} />)}</div>
        )}
        {s.logo_url && <img className="salao-capa-logo" src={s.logo_url} alt="" />}
      </div>

      <div className="perfil-cabeca">
        <h2>{s.nome}</h2>
        {endereco && <p className="muted salao-linha"><MapPin size={14} /> {endereco}{mapa && <> · <a href={mapa} target="_blank" rel="noreferrer">como chegar</a></>}</p>}
        {nota ? (
          <p className="perfil-nota"><StarIcon /> <strong>{Number(nota.media).toFixed(1)}</strong><span className="muted">({nota.quantas} {nota.quantas === 1 ? 'avaliação' : 'avaliações'} da equipe)</span></p>
        ) : <p className="perfil-nota muted">Ainda sem avaliações</p>}
        <div className="salao-contatos">
          {zap && <a href={zap} target="_blank" rel="noreferrer" className="btn btn-ghost btn-mini"><MessageCircle size={14} /> WhatsApp</a>}
          {s.telefone && !zap && <a href={`tel:${String(s.telefone).replace(/\D/g, '')}`} className="btn btn-ghost btn-mini"><Phone size={14} /> Ligar</a>}
          {insta && <a href={insta} target="_blank" rel="noreferrer" className="btn btn-ghost btn-mini"><InstagramIcon /> @{String(s.instagram).replace(/^@/, '')}</a>}
        </div>
      </div>

      {s.descricao && <div className="card svc-bloco salao-descricao"><Store size={16} /><p>{s.descricao}</p></div>}

      {promos.length > 0 && (
        <section className="salao-secao">
          <h3 className="secao-titulo"><BadgePercent size={15} /> Promoções da casa</h3>
          <div className="upsell-lista salao-promos">
            {promos.map((p) => (
              <button key={p.id} type="button" className="salao-promo" onClick={() => { supabase.rpc('promocao_clicada', { promo: p.id }); if (p.service_id) navigate(`/cliente/servico/${p.service_id}${p.professional_id ? `?prof=${p.professional_id}` : ''}`) }}>
                <img src={p.imagem_url} alt="" loading="lazy" />
                {p.desconto_pct != null && <span className="promo-selo">-{p.desconto_pct}%</span>}
                <span className="promo-veu"><strong>{p.titulo}</strong>{p.texto && <span>{p.texto}</span>}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="abas">
        {[['servicos', 'Serviços'], ['equipe', 'Equipe'], ['sobre', 'Sobre']].map(([k, r]) => (
          <button key={k} className={aba === k ? 'aba active' : 'aba'} onClick={() => setAba(k)}>{r}</button>
        ))}
      </div>

      {aba === 'servicos' && (
        <div className="cliente-list">
          {servicos.length === 0 && <div className="card empty-state"><p>O salão ainda não cadastrou serviços.</p></div>}
          {agruparPorCategoria(servicos, cats).map((g, _, todos) => (
            <section key={g.id || 'outros'} className="cat-grupo">
              {todos.length > 1 && <h3 className="cat-titulo">{g.nome}</h3>}
              {g.itens.map((sv) => (
                <Link key={sv.id} to={linkServico(sv)} className="card servico-linha">
                  <span className="servico-linha-foto" aria-hidden="true">{sv.images?.[0] ? <img src={sv.images[0]} alt="" /> : <Sparkles />}</span>
                  <span className="cliente-info">
                    <span className="cliente-nome"><span className="nome-txt">{sv.name}</span>{sv.is_combo && <span className="badge badge-combo">combo</span>}</span>
                    <span className="muted cliente-meta">{formatPreco(sv.price)} · {labelDuracao(sv)}</span>
                    {sv.quem?.length > 0 && <span className="muted cliente-meta">com {sv.quem.map((p) => p.nome.split(' ')[0]).join(', ')}</span>}
                  </span>
                  <ChevronRight size={18} className="agdt-seta" />
                </Link>
              ))}
            </section>
          ))}
        </div>
      )}

      {aba === 'equipe' && (
        <div className="cliente-list">
          {equipe.length === 0 && <div className="card empty-state"><p>Ninguém atendendo por aqui ainda.</p></div>}
          {equipe.map((p) => (
            <Link key={p.id} to={`/cliente/profissional/${p.id}`} className="card prof-row">
              <span className="agdt-avatar">{p.foto ? <img src={p.foto} alt="" /> : iniciais(p.nome)}</span>
              <span className="cliente-info">
                <span className="cliente-nome"><span className="nome-txt">{p.nome}</span>{p.nota && <span className="muted salao-nota-mini"><StarIcon /> {Number(p.nota).toFixed(1)}</span>}</span>
                <span className="muted cliente-meta">{(p.faz ?? []).slice(0, 3).join(' · ') || p.bio || ''}</span>
              </span>
              <ChevronRight size={18} className="agdt-seta" />
            </Link>
          ))}
        </div>
      )}

      {aba === 'sobre' && (
        <div className="cliente-list">
          <div className="card agdt-dados">
            {endereco && <div className="agdt-item"><MapPin size={18} /><span><span className="muted agdt-rotulo">Onde</span><strong>{s.endereco}</strong>{s.cidade && <span className="muted">{s.cidade}</span>}{mapa && <a href={mapa} target="_blank" rel="noreferrer" className="agdt-mapa">Como chegar</a>}</span></div>}
            {(s.telefone || s.whatsapp) && <div className="agdt-item"><Phone size={18} /><span><span className="muted agdt-rotulo">Contato</span>{s.telefone && <strong>{s.telefone}</strong>}{s.whatsapp && s.whatsapp !== s.telefone && <span className="muted">WhatsApp {s.whatsapp}</span>}</span></div>}
            <div className="agdt-item"><Clock size={18} /><span><span className="muted agdt-rotulo">Horário</span>
              {horarios.length === 0 ? <span className="muted">Cada profissional tem o seu horário.</span> : (
                <ul className="salao-horarios">
                  {horarios.map((h) => <li key={h.weekday} className={h.weekday === hoje ? 'hoje' : ''}><span>{DIAS[h.weekday]}</span><span>{h.open ? `${String(h.start_time).slice(0, 5)} – ${String(h.end_time).slice(0, 5)}` : 'fechado'}</span></li>)}
                </ul>
              )}</span></div>
          </div>
        </div>
      )}
    </ClienteShell>
  )
}
