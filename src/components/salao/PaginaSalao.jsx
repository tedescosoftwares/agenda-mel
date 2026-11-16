import { useMemo, useRef, useState } from 'react'
import { MapPin, Clock, Store, BadgePercent, MessageCircle, Star, Wallet, Share2, Sparkles, ChevronRight, X, CalendarHeart, Phone, Lock, Compass } from 'lucide-react'
import ComoChegar from '../ComoChegar'
import { StarIcon, InstagramIcon } from '../icons'
import { iniciais } from '../../lib/booking'
import { formatPreco, formatDuracao } from '../../lib/format'
import { agruparPorCategoria } from '../../lib/categorias'
import { temPino, linksDeRota } from '../../lib/geo'
import { MODOS, textoSinal, POLITICAS } from '../../lib/pagamento'
import { situacaoAgora, precoDoServico, duracaoDoServico, quemFaz, menorPrecoDaCasa, horaCurta, primeiroNome } from '../../../packages/core/salao.js'
import '../../salao-pagina.css'

// A página do salão (3.79), a mesma para quem visita (o endereço nome.mimo.com.vc, sem conta) e para a cliente
// logada (/cliente/salao/:id). Mostra tudo: fotos, se está aberto agora, serviços com preço por categoria, a equipe,
// as avaliações, o horário, o mapa e as regras de pagamento. As ações saem por callbacks e quem usa decide o que
// fazem: na página pública, marcar e falar com o salão pedem a conta (a folha "entre para marcar"); logada, seguem
// direto para o fluxo de marcar de sempre. O app (apps/mobile/src/app/salao/[id].tsx) espelha esta página.
//
//   modo        'publico' | 'cliente'
//   onAgendar   ({ servico, prof }) → marcar um serviço (prof: com quem, se já escolheu)
//   onContato   () → falar com o salão (público: pede a conta)
//   onProfissional (p) → logada: o perfil da profissional (no público, tocar nela filtra os serviços dela)
//   onPreferida (id|null) → logada: a estrela da preferida
//   onPromo     (promo) → a promoção tocada
//   guiaUrl     link do guia de salões (rodapé)
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const POR_CATEGORIA = 5

export default function PaginaSalao({ pg, cats, modo = 'cliente', onAgendar, onContato, onProfissional, onPreferida, onPromo, guiaUrl }) {
  const publico = modo === 'publico'
  const s = pg.salao
  const [foto, setFoto] = useState(0)
  const faixa = useRef(null)
  const servicosRef = useRef(null)
  const [descAberta, setDescAberta] = useState(false)
  const [abertas, setAbertas] = useState({})   // categoria → mostra todos
  const [comQuem, setComQuem] = useState(null) // público: a profissional tocada filtra os serviços dela
  const [todasAvaliacoes, setTodasAvaliacoes] = useState(false)

  const fotos = s.fotos ?? []
  const nota = pg.nota?.quantas ? pg.nota : null
  const pino = temPino(s.lat, s.lng)
  const rota = linksDeRota({ lat: s.lat, lng: s.lng, nome: s.nome, endereco: s.endereco, cidade: s.cidade })?.google ?? null
  const local = [s.bairro, s.cidade].filter(Boolean).join(', ')
  const agora = situacaoAgora(pg.horarios)
  const hoje = new Date().getDay()
  const equipe = pg.equipe ?? []
  // o que ninguém faz não dá para marcar: fica fora da vitrine
  const servicos = useMemo(() => (pg.servicos ?? []).filter((x) => (x.quem ?? []).length > 0), [pg.servicos])
  const visiveis = comQuem ? servicos.filter((x) => (x.quem ?? []).some((q) => q.id === comQuem.id)) : servicos
  const grupos = agruparPorCategoria(visiveis, cats)
  const destaques = comQuem ? [] : servicos.filter((x) => x.destaque).slice(0, 8)
  const promos = pg.promocoes ?? []
  const descontoDe = (id) => promos.find((p) => p.service_id === id && p.desconto_pct)?.desconto_pct ?? null
  const avaliacoes = (pg.avaliacoes ?? []).filter((a) => a.comentario || todasAvaliacoes)
  const menor = menorPrecoDaCasa(servicos)
  const pag = s.pagamento?.modo && s.pagamento.modo !== 'nao' ? s.pagamento : null
  const politica = pag?.politica ? POLITICAS[pag.politica] : null
  const zap = s.whatsapp ? 'https://wa.me/55' + String(s.whatsapp).replace(/\D/g, '').replace(/^55/, '') : null
  const insta = s.instagram ? 'https://instagram.com/' + String(s.instagram).replace(/^@/, '') : null
  const fechado = s.aceita === false

  const irParaServicos = () => servicosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const irParaCategoria = (id) => document.getElementById('sal-cat-' + (id || 'outros'))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  async function compartilhar() {
    const url = window.location.href
    try {
      if (navigator.share) await navigator.share({ title: s.nome, text: `${s.nome} na MIMO`, url })
      else { await navigator.clipboard?.writeText(url); window.alert('Link copiado.') }
    } catch { /* ela desistiu */ }
  }
  const escolher = (p) => {
    if (publico) { setComQuem((x) => (x?.id === p.id ? null : p)); irParaServicos() }
    else onProfissional?.(p)
  }

  return (
    <div className={'sal' + (publico ? ' sal-publico' : ' sal-cliente')}>
      {/* ---- a capa ---- */}
      <section className="sal-capa" aria-label="Fotos do salão">
        {fotos.length ? (
          <div className="sal-capa-faixa" ref={faixa} onScroll={() => { const el = faixa.current; if (el) setFoto(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))) }}>
            {fotos.map((f, i) => <img key={f} src={f} alt="" loading={i === 0 ? 'eager' : 'lazy'} />)}
          </div>
        ) : <div className="sal-capa-vazia" aria-hidden="true"><Store size={56} strokeWidth={1.4} /></div>}
        <span className="sal-capa-veu" aria-hidden="true" />
        {fotos.length > 1 && (
          <div className="sal-capa-pontos">
            {fotos.map((f, i) => <button key={f} type="button" className={i === foto ? 'on' : ''} onClick={() => faixa.current?.scrollTo({ left: i * faixa.current.clientWidth, behavior: 'smooth' })} aria-label={`Foto ${i + 1} de ${fotos.length}`} />)}
          </div>
        )}
      </section>

      <div className="sal-corpo">
        {/* ---- quem é, se está aberto, marcar ---- */}
        <aside className="sal-id" aria-label={s.nome}>
          <div className="sal-id-topo">
            <span className="sal-logo">{s.logo_url ? <img src={s.logo_url} alt="" /> : iniciais(s.nome)}</span>
            <div className="sal-id-nome">
              <h1>{s.nome}</h1>
              {local && <p className="sal-id-local"><MapPin size={13} /> {local}</p>}
            </div>
          </div>
          <div className="sal-id-selos">
            {nota && <span className="sal-selo sal-selo-nota"><StarIcon /> <b>{Number(nota.media).toFixed(1)}</b> <span>({nota.quantas})</span></span>}
            {agora && <span className={'sal-selo ' + (agora.aberto ? 'sal-selo-aberto' : 'sal-selo-fechado')}><i aria-hidden="true" />{agora.texto}</span>}
            {pag && <span className="sal-selo sal-selo-pag"><Wallet size={13} /> {MODOS[pag.modo]?.curto ?? 'Paga pelo app'}</span>}
          </div>
          {fechado && <p className="sal-aviso">Este salão não está recebendo agendamentos novos pelo app no momento. Os horários já marcados continuam valendo.</p>}
          {!fechado && (
            <button type="button" className="btn btn-primary btn-block sal-marcar" onClick={irParaServicos}>
              <CalendarHeart size={18} /> Agendar horário{menor ? <small> · a partir de {formatPreco(menor)}</small> : null}
            </button>
          )}
          <div className="sal-acoes">
            <button type="button" onClick={() => onContato?.()} className="sal-acao" aria-label={publico ? 'Falar com o salão (entre na sua conta)' : 'Falar pelo WhatsApp'}>
              <span><MessageCircle size={19} />{publico && <Lock size={10} className="sal-acao-cadeado" />}</span>WhatsApp
            </button>
            {rota && <a href={rota} target="_blank" rel="noreferrer" className="sal-acao"><span><Compass size={19} /></span>Rota</a>}
            {insta && <a href={insta} target="_blank" rel="noreferrer" className="sal-acao"><span><InstagramIcon /></span>Instagram</a>}
            <button type="button" onClick={compartilhar} className="sal-acao"><span><Share2 size={19} /></span>Compartilhar</button>
          </div>
          {publico && <p className="sal-id-dica"><Lock size={12} /> Para marcar ou falar com o salão, você cria sua conta grátis.</p>}
        </aside>

        <div className="sal-miolo">
          {/* ---- promoções ---- */}
          {promos.length > 0 && (
            <section className="sal-secao">
              <h2 className="sal-titulo"><BadgePercent size={17} /> Promoções da casa</h2>
              <div className="sal-faixa">
                {promos.map((p) => (
                  <button key={p.id} type="button" className="sal-promo" onClick={() => onPromo?.(p)}>
                    {p.imagem_url ? <img src={p.imagem_url} alt="" loading="lazy" /> : <span className="sal-promo-fundo" />}
                    {p.desconto_pct != null && <span className="sal-promo-selo">-{p.desconto_pct}%</span>}
                    <span className="sal-promo-veu"><strong>{p.titulo}</strong>{p.texto && <span>{p.texto}</span>}{p.fim && <small>até {new Date(p.fim + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</small>}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* ---- destaques ---- */}
          {destaques.length > 0 && (
            <section className="sal-secao">
              <h2 className="sal-titulo"><Sparkles size={17} /> Destaques da casa</h2>
              <div className="sal-faixa">
                {destaques.map((sv) => {
                  const pr = precoDoServico(sv)
                  const capa = sv.images?.[0] ?? pg.capas?.[sv.categoria_id]?.[0] ?? null
                  const d = descontoDe(sv.id)
                  return (
                    <button key={sv.id} type="button" className="sal-dest" onClick={() => onAgendar?.({ servico: sv })} disabled={fechado}>
                      <span className="sal-dest-foto">{capa ? <img src={capa} alt="" loading="lazy" /> : <Sparkles size={26} />}{d && <i>-{d}%</i>}</span>
                      <strong>{sv.name}</strong>
                      <span className="sal-dest-meta">{pr.aPartir && 'a partir de '}<b>{formatPreco(pr.valor)}</b> · {formatDuracao(duracaoDoServico(sv))}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {/* ---- serviços ---- */}
          <section className="sal-secao" ref={servicosRef} id="sal-servicos">
            <h2 className="sal-titulo"><Sparkles size={17} /> Serviços {servicos.length > 0 && <span className="sal-conta">{servicos.length}</span>}</h2>
            {comQuem && (
              <div className="sal-filtro">
                <span className="sal-filtro-av">{comQuem.foto ? <img src={comQuem.foto} alt="" /> : iniciais(comQuem.nome)}</span>
                <span>Serviços com <b>{primeiroNome(comQuem.nome)}</b></span>
                <button type="button" onClick={() => setComQuem(null)} aria-label="Ver todos os serviços"><X size={15} /></button>
              </div>
            )}
            {grupos.length > 1 && (
              <div className="sal-chips" role="tablist" aria-label="Categorias">
                {grupos.map((g) => <button key={g.id || 'outros'} type="button" className="sal-chip" onClick={() => irParaCategoria(g.id)}>{g.nome} <span>{g.itens.length}</span></button>)}
              </div>
            )}
            {visiveis.length === 0 && <div className="sal-vazio"><p>{comQuem ? `${primeiroNome(comQuem.nome)} ainda não tem serviços na agenda.` : 'O salão ainda não cadastrou serviços.'}</p></div>}
            {grupos.map((g) => {
              const todos = abertas[g.id || 'outros'] || g.itens.length <= POR_CATEGORIA + 1
              const itens = todos ? g.itens : g.itens.slice(0, POR_CATEGORIA)
              const capaCat = pg.capas?.[g.id]?.[0] ?? null
              return (
                <div key={g.id || 'outros'} className="sal-cat" id={'sal-cat-' + (g.id || 'outros')}>
                  {grupos.length > 1 && <h3 className="sal-cat-nome">{g.nome}</h3>}
                  <ul className="sal-lista">
                    {itens.map((sv) => {
                      const pr = precoDoServico(sv, comQuem?.id)
                      const dur = duracaoDoServico(sv, comQuem?.id)
                      const capa = sv.images?.[0] ?? capaCat
                      const d = descontoDe(sv.id)
                      return (
                        <li key={sv.id}>
                          <button type="button" className="sal-item" onClick={() => onAgendar?.({ servico: sv, prof: comQuem?.id ?? null })} disabled={fechado}>
                            <span className="sal-item-foto">{capa ? <img src={capa} alt="" loading="lazy" /> : <Sparkles size={18} />}</span>
                            <span className="sal-item-txt">
                              <strong>{sv.name}</strong>
                              <span className="sal-item-meta"><Clock size={12} /> {sv.is_combo ? `~${formatDuracao(dur)}` : formatDuracao(dur)}{!comQuem && quemFaz(sv) ? ` · ${quemFaz(sv)}` : ''}</span>
                              {sv.description && <span className="sal-item-desc">{sv.description}</span>}
                            </span>
                            <span className="sal-item-preco">
                              {d && <i>-{d}%</i>}
                              {pr.aPartir && <small>a partir de</small>}
                              <b>{formatPreco(pr.valor)}</b>
                              <span className="sal-item-ir">Agendar <ChevronRight size={14} /></span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  {!todos && <button type="button" className="sal-mais" onClick={() => setAbertas((x) => ({ ...x, [g.id || 'outros']: true }))}>Ver mais {g.itens.length - POR_CATEGORIA} em {g.nome}</button>}
                </div>
              )
            })}
          </section>

          {/* ---- a equipe ---- */}
          {equipe.length > 0 && (
            <section className="sal-secao">
              <h2 className="sal-titulo"><Star size={17} /> {equipe.length === 1 ? 'Quem atende' : 'A equipe'}</h2>
              {publico && equipe.length > 1 && <p className="sal-sub">Toque em quem você prefere para ver os serviços dela.</p>}
              {!publico && equipe.length > 1 && <p className="sal-sub">Marque a estrela da sua preferida: quando mais de uma faz o mesmo serviço, o app já leva para ela.</p>}
              <div className="sal-faixa sal-equipe">
                {equipe.map((p) => {
                  const pref = !publico && pg.preferida === p.id
                  return (
                    <div key={p.id} className={'sal-prof' + (comQuem?.id === p.id ? ' on' : '') + (pref ? ' preferida' : '')}>
                      <button type="button" className="sal-prof-corpo" onClick={() => escolher(p)}>
                        <span className="sal-prof-av">{p.foto ? <img src={p.foto} alt="" loading="lazy" /> : iniciais(p.nome)}</span>
                        <strong>{p.nome}</strong>
                        {p.nota ? <span className="sal-prof-nota"><StarIcon /> {Number(p.nota).toFixed(1)}{p.avaliacoes ? <span> ({p.avaliacoes})</span> : null}</span> : <span className="sal-prof-nota sal-prof-nova">nova na casa</span>}
                        <span className="sal-prof-faz">{p.especialidade || (p.faz ?? []).slice(0, 2).join(' · ') || p.bio || ''}</span>
                      </button>
                      {!publico && equipe.length > 1 && (
                        <button type="button" className={'sal-prof-estrela' + (pref ? ' on' : '')} onClick={() => onPreferida?.(pref ? null : p.id)} aria-pressed={pref} aria-label={pref ? 'Tirar a preferência' : `Marcar ${p.nome} como preferida`}><Star size={16} /></button>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* ---- avaliações ---- */}
          {nota && (
            <section className="sal-secao">
              <h2 className="sal-titulo"><StarIcon /> Avaliações</h2>
              <div className="sal-nota">
                <b>{Number(nota.media).toFixed(1)}</b>
                <span className="sal-nota-estrelas" aria-label={`${Number(nota.media).toFixed(1)} de 5`}>{[1, 2, 3, 4, 5].map((n) => <StarIcon key={n} cheio={n <= Math.round(nota.media)} />)}</span>
                <span className="sal-nota-conta">{nota.quantas} {nota.quantas === 1 ? 'avaliação' : 'avaliações'} de quem foi atendida</span>
              </div>
              {avaliacoes.length > 0 && (
                <ul className="sal-avals">
                  {avaliacoes.slice(0, todasAvaliacoes ? 12 : 3).map((a, i) => (
                    <li key={i} className="sal-aval">
                      <div className="sal-aval-topo">
                        <span className="sal-aval-ini">{iniciais(a.quem)}</span>
                        <span><strong>{a.quem}</strong><small>{[a.servico, a.profissional && `com ${primeiroNome(a.profissional)}`].filter(Boolean).join(' ')}</small></span>
                        <span className="sal-aval-estrelas" aria-label={`${a.nota} de 5`}>{[1, 2, 3, 4, 5].map((n) => <StarIcon key={n} cheio={n <= a.nota} />)}</span>
                      </div>
                      {a.comentario && <p>{a.comentario}</p>}
                      <small className="sal-aval-quando">{new Date(a.quando).toLocaleDateString('pt-BR')}</small>
                    </li>
                  ))}
                </ul>
              )}
              {!todasAvaliacoes && (pg.avaliacoes ?? []).length > 3 && <button type="button" className="sal-mais" onClick={() => setTodasAvaliacoes(true)}>Ver mais avaliações</button>}
            </section>
          )}

          {/* ---- sobre ---- */}
          <section className="sal-secao sal-sobre">
            <h2 className="sal-titulo"><Store size={17} /> Sobre o {s.tipo === 'autonoma' ? 'espaço' : 'salão'}</h2>
            {s.descricao && (
              <div className={'sal-desc' + (descAberta ? ' aberta' : '')}>
                <p>{s.descricao}</p>
                {s.descricao.length > 220 && <button type="button" className="link-ver" onClick={() => setDescAberta((v) => !v)}>{descAberta ? 'Mostrar menos' : 'Continuar lendo'}</button>}
              </div>
            )}
            <div className="sal-dados">
              {(pg.horarios ?? []).length > 0 && (
                <div className="sal-dado">
                  <Clock size={18} />
                  <div>
                    <span className="sal-dado-rotulo">Horário</span>
                    {agora && <span className={'sal-dado-agora ' + (agora.aberto ? 'aberto' : '')}>{agora.texto}</span>}
                    <ul className="sal-horarios">
                      {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                        const h = (pg.horarios ?? []).find((x) => x.weekday === d)
                        return <li key={d} className={d === hoje ? 'hoje' : ''}><span>{DIAS[d]}</span><span>{h?.open ? `${horaCurta(h.start_time)} às ${horaCurta(h.end_time)}` : 'fechado'}</span></li>
                      })}
                    </ul>
                  </div>
                </div>
              )}
              {(s.endereco || s.cidade) && (
                <div className="sal-dado">
                  <MapPin size={18} />
                  <div>
                    <span className="sal-dado-rotulo">Onde</span>
                    <strong>{s.endereco}</strong>
                    <span className="muted">{[s.bairro && !String(s.endereco ?? '').includes(s.bairro) ? s.bairro : null, s.cidade].filter(Boolean).join(' · ')}</span>
                  </div>
                </div>
              )}
              {pino && <ComoChegar lat={s.lat} lng={s.lng} nome={s.nome} endereco={s.endereco} cidade={s.cidade} altura={170} />}
              {pag && (
                <div className="sal-dado">
                  <Wallet size={18} />
                  <div>
                    <span className="sal-dado-rotulo">Pagamento</span>
                    <span>{textoSinal(pag.sinal_pct)} por PIX ao marcar{pag.modo === 'opcional' ? ' (opcional)' : ''}.</span>
                    {politica && <span className="muted">Cancelamento {politica.rotulo.toLowerCase()}: devolve até {politica.horas} h antes.</span>}
                  </div>
                </div>
              )}
              {(s.tem_contato || zap || s.telefone) && (
                <div className="sal-dado">
                  <Phone size={18} />
                  <div>
                    <span className="sal-dado-rotulo">Contato</span>
                    {publico ? (
                      <button type="button" className="link-ver sal-contato-trava" onClick={() => onContato?.()}><Lock size={12} /> Entre na sua conta para ver o WhatsApp</button>
                    ) : (
                      <>
                        {zap && <a href={zap} target="_blank" rel="noreferrer" className="link-ver">WhatsApp {s.whatsapp}</a>}
                        {s.telefone && s.telefone !== s.whatsapp && <a href={`tel:${String(s.telefone).replace(/\D/g, '')}`} className="muted">Telefone {s.telefone}</a>}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ---- o rodapé: a MIMO e o guia ---- */}
          <footer className="sal-rodape">
            <span className="sal-rodape-marca"><CalendarHeart size={15} /> {s.nome} agenda pela <b>MIMO</b></span>
            {guiaUrl && <a href={guiaUrl} className="sal-rodape-guia">Procurando outro serviço? Veja o guia de salões{s.cidade ? ` de ${s.cidade}` : ''} <ChevronRight size={14} /></a>}
          </footer>
        </div>
      </div>

      {/* ---- o botão de marcar, no pé (celular) ---- */}
      {publico && !fechado && (
        <div className="sal-pe">
          <span>{menor ? <>a partir de <b>{formatPreco(menor)}</b></> : <b>{s.nome}</b>}{agora && <small className={agora.aberto ? 'aberto' : ''}>{agora.texto}</small>}</span>
          <button type="button" className="btn btn-primary" onClick={irParaServicos}>Agendar</button>
        </div>
      )}
    </div>
  )
}
