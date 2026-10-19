import { createElement, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  MapPin, Clock, Phone, MessageCircle, Globe, Navigation, Share2, Check, Award, CalendarCheck, Info, ChevronDown,
  ArrowRight, Lightbulb, Sparkles, Scissors, Hand, Eye, ScanFace, Flower2, Brush, Store, CreditCard, Accessibility, SquareParking, Baby, Bath,
  LocateFixed, X, Images,
} from 'lucide-react'
import { IconeInstagram } from '../IconesSociais'
import Portal from '../Portal'
import { Coracao, comecarEm } from '../site/Pecas'
import {
  categoriaDoGuia, conteudoSeguro, faqDaPagina, horariosResumo, horariosEmUmaLinha, abertoAgora,
  linkMapa, linkWhatsDoTel, linkInstagram, telefoneBonito, soDigitosTel, rotaDoLugar, rotaDaCategoria, rotaDaCidade, atributosEmTexto,
  fotosDoLugar, altDaFoto, miniatura, paraFotoInteira,
} from '../../lib/guia'
import { trilhaDoLugar } from '../../lib/guiaSeo'
import { linkDoBairro } from '../../lib/guiaColecoes'
import { useMinhaPosicao, distanciaKm, kmTexto } from '../../lib/guiaPerto'
import { urlDoEndereco, urlDoAmbiente } from '../../lib/ambiente'
import { REGRAS } from '../../lib/acesso'
import '../../landing.css'
import '../../guia.css'
import '../../guia-perto.css'

// pagamento, acessibilidade, estacionamento, crianças, banheiro (3.10)
const ICONE_ATRIBUTO = { pagamento: CreditCard, acessibilidade: Accessibility, estacionamento: SquareParking, criancas: Baby, banheiro: Bath }

// A página de um salão no guia (3.9): a landing em si, sem barra, rodapé
// nem SEO, porque a Plataforma mostra esta mesma peça na prévia antes de
// aprovar (o que ela vê é o que vai para o ar). Quem embrulha com o site
// e cuida do formulário é a página GuiaLugar.
//
// Honestidade em primeiro lugar: nada de nota, avaliação ou "parceiro".
// Fato vem dos dados (endereço, horário, serviços, canais que o próprio
// salão divulga); o texto da IA só fala do serviço e do que está nos dados.
// O botão principal é sempre o da MIMO; os canais do salão vêm depois.
//
// Com fotos (3.14, enviadas pela Plataforma ou as da página do salão na
// MIMO), a primeira é a capa e as outras ficam numa faixa; tocar abre a
// foto grande. Sem foto do salão: a capa é um cartaz com o gradiente da marca, o ícone
// da categoria e o nome. O layout responde à largura da própria página
// (container queries), então a prévia em "celular" da Plataforma mostra o
// layout de celular mesmo num monitor grande.

// o ícone de cada categoria (a capa, os cartões e os blocos da cidade); a cor vem do CSS (.gd-tom-*)
const ICONE_CATEGORIA = { beleza: Sparkles, cabelo: Scissors, unhas: Hand, cilios: Eye, sobrancelhas: ScanFace, barbearia: Scissors, estetica: Flower2, maquiagem: Brush }
export function IconeCategoria({ slug, ...props }) {
  return createElement(ICONE_CATEGORIA[slug] ?? Store, props)
}

// na prévia nada navega: link interno vira texto
export function Ir({ previa, to, className, children, ...resto }) {
  if (previa) return <span className={className} {...resto}>{children}</span>
  return <Link to={to} className={className} {...resto}>{children}</Link>
}

// o relógio de Itanhaém, não o de quem lê (alguém em Lisboa veria "fechado" às 15h daqui)
function horaDoSalao() {
  try { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })) } catch { return new Date() }
}
function useAgora() {
  const [agora, setAgora] = useState(horaDoSalao)
  useEffect(() => { const t = setInterval(() => setAgora(horaDoSalao()), 60000); return () => clearInterval(t) }, [])
  return agora
}

// o site como se lê: 'salaostudio21.com.br'; encurtador e linktree levam o caminho ('bit.ly/2OLtN2H')
function dominio(url) {
  try {
    const u = new URL(url)
    const caminho = u.pathname.replace(/\/+$/, '')
    return u.hostname.replace(/^www\./, '') + (caminho && caminho.length <= 24 ? caminho : '')
  } catch { return String(url ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/[/?#].*$/, '') }
}

// "Agendar pela MIMO": o endereço próprio do salão quando existe; sem ele, a
// entrada com o código (o salão passa o código e a cliente entra na agenda)
function linkDaAgenda(lugar) {
  if (lugar?.mimo?.subdominio) return urlDoEndereco(lugar.mimo.subdominio, '/')
  return urlDoAmbiente('cliente', '/entrar')
}

// o texto de quando a página ainda não tem texto aprovado: só fatos, sem enfeite
function sobrePadrao(l, cat) {
  const lista = (l.servicos ?? []).slice(0, 6).map((s) => s.toLowerCase())
  const servicos = lista.length > 1 ? `${lista.slice(0, -1).join(', ')} e ${lista.at(-1)}` : lista[0]
  const horario = horariosEmUmaLinha(l.horarios)
  return [
    `${l.nome} fica ${l.bairro ? `no bairro ${l.bairro}, ` : ''}em ${l.cidade}, e está no guia da MIMO na categoria ${cat.rotulo.toLowerCase()}.` +
      (servicos ? ` Pelas informações públicas do estabelecimento, os serviços incluem ${servicos}.` : ''),
    (horario ? `O horário divulgado é ${horario.charAt(0).toLowerCase() + horario.slice(1)}. ` : '') + 'Horários, serviços e preços podem mudar: vale confirmar direto com o salão antes de ir.',
  ]
}

export default function PaginaDoLugar({ lugar, conteudo, vizinhos = [], mesmaCategoria = [], previa = false, onInteresse = () => {} }) {
  const agora = useAgora()
  const ctaRef = useRef(null)
  const [barra, setBarra] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [fotoAberta, setFotoAberta] = useState(-1) // a foto grande (3.14); -1 = fechada
  const temLugar = !!lugar
  const fotos = fotosDoLugar(lugar)
  // a foto grande: Esc fecha, as setas andam, a página atrás não rola
  useEffect(() => {
    if (fotoAberta < 0) return
    const n = fotos.length
    const tecla = (e) => {
      if (e.key === 'Escape') setFotoAberta(-1)
      else if (e.key === 'ArrowRight') setFotoAberta((i) => (i + 1) % n)
      else if (e.key === 'ArrowLeft') setFotoAberta((i) => (i - 1 + n) % n)
    }
    window.addEventListener('keydown', tecla)
    const rolagem = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', tecla); document.body.style.overflow = rolagem }
  }, [fotoAberta, fotos.length])
  const { posicao } = useMinhaPosicao({ olhar: !previa }) // a posição, se a pessoa ativou numa lista do guia (3.13)

  // a barra de baixo (celular) aparece quando o botão do herói sai da tela
  useEffect(() => {
    const el = ctaRef.current
    if (previa || !el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([e]) => setBarra(!e.isIntersecting && e.boundingClientRect.top < 0))
    io.observe(el)
    return () => io.disconnect()
  }, [previa, temLugar])

  // o cartão de fatos acompanha a rolagem no computador; se ele for mais alto que a
  // tela, o "grudar" acontece pela base (top negativo), senão o botão dele nunca apareceria
  const ladoRef = useRef(null)
  useEffect(() => {
    const el = ladoRef.current
    if (previa || !el || !('ResizeObserver' in window)) return
    const ajustar = () => el.style.setProperty('--gd-lado-topo', `${Math.min(96, window.innerHeight - el.offsetHeight - 24)}px`)
    const ro = new ResizeObserver(ajustar)
    ro.observe(el)
    window.addEventListener('resize', ajustar)
    ajustar()
    return () => { ro.disconnect(); window.removeEventListener('resize', ajustar) }
  }, [previa, temLugar])

  if (!lugar) return null
  // site só com http(s): um 'javascript:' digitado na Plataforma nunca vira link
  const l = { ...lugar, site: /^https?:\/\//i.test(lugar.site ?? '') ? lugar.site : null }
  const c = conteudoSeguro(conteudo)
  const cat = categoriaDoGuia(l.categoria)
  const trilha = trilhaDoLugar(l)
  const estado = abertoAgora(l.horarios, agora)
  const horas = horariosResumo(l.horarios)
  const faq = faqDaPagina(l, c)
  const sobre = c?.sobre?.length ? c.sobre : sobrePadrao(l, cat)
  const chamada = c?.chamada || `${cat.singular.charAt(0).toUpperCase() + cat.singular.slice(1)}${l.bairro ? ` no bairro ${l.bairro}` : ''}, em ${l.cidade}: endereço, horário, serviços e como marcar.`
  // nome comprido ("Espaço Bela Flor Estética Avançada e Bem-Estar") pede letra menor no título e na capa
  const tamanhoNome = l.nome.length > 40 ? ' gd-nome-muito-longo' : l.nome.length > 24 ? ' gd-nome-longo' : ''
  const naMimo = !!l.na_mimo
  // a data em que a página foi atualizada: quem lê sabe quão fresco é o dado
  const atualizado = l.atualizado_em ? new Date(l.atualizado_em).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }) : ''
  const enderecoCompleto = [l.endereco, l.bairro, l.cidade && `${l.cidade}${l.uf ? ` - ${l.uf}` : ''}`].filter(Boolean).join(', ')
  const mapa = linkMapa(l.nome, enderecoCompleto)
  // "a 1,2 km de você" (3.13): só quando a pessoa já ativou a localização numa lista do guia (nunca na prévia)
  const km = !previa && posicao && l.latitude != null && l.longitude != null ? distanciaKm(posicao, { lat: Number(l.latitude), lng: Number(l.longitude) }) : null
  const msgZap = 'Olá! Vi a página de vocês no guia da MIMO e queria saber sobre horários.'
  const zap = l.whatsapp ? linkWhatsDoTel(l.whatsapp, msgZap) : null
  const telMesmoDoZap = l.telefone && l.whatsapp && soDigitosTel(l.telefone) === soDigitosTel(l.whatsapp)
  const tel = l.telefone ? `tel:+55${soDigitosTel(l.telefone)}` : null
  const insta = l.instagram ? linkInstagram(l.instagram) : null
  const handle = l.instagram ? '@' + String(l.instagram).replace(/^@/, '') : ''

  // os vizinhos que já aparecem em "Perto dali" não se repetem na lista da categoria
  const vistos = new Set(vizinhos.map((v) => v.slug))
  const outros = mesmaCategoria.filter((m) => !vistos.has(m.slug) && m.slug !== l.slug)

  // "Mais salões no Centro": só quando a página do bairro existe (guia_pagina manda quantos o bairro tem)
  const doBairro = linkDoBairro(l)

  const marcar = () => onInteresse('quero_marcar')
  // o botão principal (herói, cartão de fatos e barra de baixo): sempre o da MIMO
  const principal = (classe = '') => naMimo
    ? (previa ? <span className={'ld-btn ld-primario ld-grande ' + classe}><CalendarCheck size={19} /> Agendar pela MIMO</span>
      : <a className={'ld-btn ld-primario ld-grande ' + classe} href={linkDaAgenda(l)} data-evento="agendar_mimo"><CalendarCheck size={19} /> Agendar pela MIMO</a>)
    : <button type="button" className={'ld-btn ld-primario ld-grande ' + classe} onClick={marcar} data-evento="quero_marcar"><CalendarCheck size={19} /> Quero marcar aqui pelo app</button>

  async function compartilhar() {
    if (previa) return
    const url = window.location.href
    try {
      if (navigator.share) { await navigator.share({ title: l.nome, text: `${l.nome} · ${cat.curto} em ${l.cidade}`, url }); return }
      await navigator.clipboard.writeText(url)
      setCopiado(true); setTimeout(() => setCopiado(false), 2200)
    } catch { /* a pessoa desistiu de compartilhar */ }
  }

  // os atalhos do herói: até quatro, como na ficha de um lugar no mapa
  const atalhos = [
    { chave: 'mapa', href: mapa, ic: <Navigation size={20} />, rotulo: 'Como chegar' },
    zap ? { chave: 'zap', href: zap, ic: <MessageCircle size={20} />, rotulo: 'WhatsApp' } : tel ? { chave: 'tel', href: tel, ic: <Phone size={20} />, rotulo: 'Ligar', mesmaAba: true } : null,
    insta ? { chave: 'insta', href: insta, ic: <IconeInstagram size={20} />, rotulo: 'Instagram' } : null,
    l.site ? { chave: 'site', href: l.site, ic: <Globe size={20} />, rotulo: 'Site' } : null,
    { chave: 'partilha', ic: copiado ? <Check size={20} /> : <Share2 size={20} />, rotulo: copiado ? 'Link copiado' : 'Compartilhar', acao: compartilhar, evento: 'compartilhar' },
  ].filter(Boolean).slice(0, 4)

  return (
    <>
      <div className={'gd-pagina' + tamanhoNome + (previa ? ' ld gd-previa' : '')}>
        {/* ---- herói ---- */}
        <section className="gd-heroi">
          <div className="gd-wrap">
            <nav className="gd-migalhas" aria-label="Você está em">
              {trilha.map(([nome, rota], i) => i < trilha.length - 1
                ? <span key={rota} className="gd-migalha"><Ir previa={previa} to={rota}>{nome}</Ir><span aria-hidden="true">›</span></span>
                : <b key={rota} aria-current="page">{nome}</b>)}
            </nav>

            <div className="gd-heroi-grade">
              <div className="gd-heroi-texto">
                <div className="gd-selos">
                  <Ir previa={previa} to={rotaDaCategoria(l.cidade_slug, l.categoria)} className="gd-selo"><IconeCategoria slug={l.categoria} size={15} /> {cat.curto}</Ir>
                  {l.bairro && <span className="gd-selo"><MapPin size={15} /> {l.bairro}</span>}
                  {l.selecao && <span className="gd-selo gd-selo-selecao" title="Curadoria da equipe MIMO"><Award size={15} /> Seleção MIMO</span>}
                  {naMimo && <span className="gd-selo gd-selo-mimo"><CalendarCheck size={15} /> Na MIMO</span>}
                </div>
                <h1 className="gd-h1">{l.nome}</h1>
                <p className="gd-chamada">{chamada}</p>
                {estado && (
                  <p className={'gd-agora' + (estado.aberto ? ' gd-aberto' : '')}><i aria-hidden="true" />{estado.texto}</p>
                )}
                <div className="gd-heroi-cta" ref={ctaRef} data-area="heroi">
                  {principal()}
                  <div className="gd-atalhos" style={{ '--n': atalhos.length }}>
                    {atalhos.map((a) => a.acao
                      ? <button key={a.chave} type="button" className="gd-atalho" onClick={a.acao} data-evento={a.evento}>{a.ic}<span>{a.rotulo}</span></button>
                      : <a key={a.chave} className="gd-atalho" href={a.href} {...(a.mesmaAba ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>{a.ic}<span>{a.rotulo}</span></a>)}
                  </div>
                </div>
              </div>

              {fotos.length ? (
                <button type="button" className="gd-capa gd-capa-foto" onClick={() => setFotoAberta(0)} aria-label={`Ver as fotos de ${l.nome}`}>
                  <img src={fotos[0]} alt={altDaFoto(l, 0)} fetchPriority="high" decoding="async" />
                  {fotos.length > 1 && <span className="gd-capa-mais"><Images size={15} aria-hidden="true" /> {fotos.length} fotos</span>}
                  <span className="gd-capa-guia">guia mimo · {l.cidade}</span>
                </button>
              ) : (
                <div className={`gd-capa gd-tom-${l.categoria}`} aria-hidden="true">
                  <IconeCategoria slug={l.categoria} className="gd-capa-fundo" strokeWidth={1.2} />
                  <Coracao className="gd-capa-coracao" />
                  <div className="gd-capa-centro">
                    <span className="gd-capa-icone"><IconeCategoria slug={l.categoria} size={34} strokeWidth={1.8} /></span>
                    <strong className="gd-capa-nome">{l.nome}</strong>
                    <span className="gd-capa-onde">{cat.curto} · {l.bairro || l.cidade}</span>
                  </div>
                  <span className="gd-capa-guia">guia mimo · {l.cidade}</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ---- as fotos (3.14) ---- */}
        {fotos.length > 1 && (
          <section className="gd-sec gd-sec-fotos" aria-label={`Fotos de ${l.nome}`}>
            <div className="gd-wrap">
              <div className="gd-fotos">
                {fotos.map((f, i) => (
                  <button key={f} type="button" className="gd-foto" onClick={() => setFotoAberta(i)} aria-label={`Abrir a foto ${i + 1} de ${fotos.length}`}>
                    <img src={miniatura(f)} data-cheia={f} onError={paraFotoInteira} alt={altDaFoto(l, i)} loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ---- fatos ao lado, texto no meio ---- */}
        <section className="gd-sec gd-sec-corpo">
          <div className="gd-wrap gd-corpo">
            <aside className="gd-lado" aria-labelledby="gd-fatos-t" ref={ladoRef}>
              <div className="gd-fatos" data-area="fatos">
                <h2 id="gd-fatos-t" className="gd-fatos-titulo">Informações</h2>
                <dl>
                  <div className="gd-fato">
                    <dt><span className="gd-fato-ic"><MapPin size={18} /></span>Endereço</dt>
                    <dd>
                      {l.endereco || l.bairro ? (
                        <>
                          {l.endereco && <span className="gd-fato-forte">{l.endereco}</span>}
                          <span>{[l.bairro, `${l.cidade}${l.uf ? ` - ${l.uf}` : ''}`].filter(Boolean).join(', ')}</span>
                          {l.cep && <span>CEP {l.cep}</span>}
                          {km != null && <span className="gd-fato-km"><LocateFixed size={14} aria-hidden="true" /> a {kmTexto(km)} de você</span>}
                        </>
                      ) : <span>Endereço não informado. Confirme com o salão.</span>}
                      <a className="gd-fato-link" href={mapa} target="_blank" rel="noopener noreferrer">Abrir no mapa <ArrowRight size={14} /></a>
                    </dd>
                  </div>

                  <div className="gd-fato">
                    <dt><span className="gd-fato-ic"><Clock size={18} /></span>Horário</dt>
                    <dd>
                      {horas.length ? (
                        <>
                          {estado && <span className={'gd-agora gd-agora-mini' + (estado.aberto ? ' gd-aberto' : '')}><i aria-hidden="true" />{estado.aberto ? 'Aberto agora' : 'Fechado agora'}</span>}
                          <span className="gd-horas">
                            {horas.map((h) => <span key={h.dias} className={h.horas === 'Fechado' ? 'gd-horas-fechado' : ''}><b>{h.dias}</b><em>{h.horas}</em></span>)}
                          </span>
                        </>
                      ) : <span>Horário não informado. Confirme com o salão antes de ir.</span>}
                    </dd>
                  </div>

                  {(l.telefone || l.whatsapp) && (
                    <div className="gd-fato">
                      <dt><span className="gd-fato-ic">{zap && (!l.telefone || telMesmoDoZap) ? <MessageCircle size={18} /> : <Phone size={18} />}</span>{telMesmoDoZap ? 'Telefone e WhatsApp' : zap && !l.telefone ? 'WhatsApp' : 'Telefone'}</dt>
                      <dd>
                        {l.telefone && <a className="gd-fato-forte" href={tel}>{telefoneBonito(l.telefone)}</a>}
                        {zap && !telMesmoDoZap && l.telefone && <span>WhatsApp: <a href={zap} target="_blank" rel="noopener noreferrer">{telefoneBonito(l.whatsapp)}</a></span>}
                        {zap && !l.telefone && <a className="gd-fato-forte" href={zap} target="_blank" rel="noopener noreferrer">{telefoneBonito(l.whatsapp)}</a>}
                        {zap && <a className="gd-fato-link" href={zap} target="_blank" rel="noopener noreferrer">Chamar no WhatsApp <ArrowRight size={14} /></a>}
                      </dd>
                    </div>
                  )}

                  {atributosEmTexto(l.atributos).map((a) => (
                    <div className="gd-fato" key={a.campo}>
                      <dt><span className="gd-fato-ic">{createElement(ICONE_ATRIBUTO[a.campo] ?? Info, { size: 18 })}</span>{a.rotulo}</dt>
                      <dd><span>{a.texto.charAt(0).toUpperCase() + a.texto.slice(1)}</span></dd>
                    </div>
                  ))}

                  {(insta || l.site) && (
                    <div className="gd-fato">
                      <dt><span className="gd-fato-ic">{insta ? <IconeInstagram size={18} /> : <Globe size={18} />}</span>{insta && l.site ? 'Na internet' : insta ? 'Instagram' : 'Site'}</dt>
                      <dd>
                        {insta && <a className="gd-fato-forte" href={insta} target="_blank" rel="noopener noreferrer">{handle}</a>}
                        {l.site && <a className={insta ? '' : 'gd-fato-forte'} href={l.site} target="_blank" rel="noopener noreferrer">{dominio(l.site)}</a>}
                      </dd>
                    </div>
                  )}
                </dl>

                {l.servicos?.length > 0 && (
                  <div className="gd-fatos-servicos">
                    <h3>Serviços</h3>
                    <ul className="gd-chips">{l.servicos.map((s) => <li key={s}>{s}</li>)}</ul>
                  </div>
                )}

                <div className="gd-fatos-cta">{principal('gd-largo')}</div>

                <p className="gd-fatos-fonte">
                  {naMimo ? 'Informações do próprio salão na MIMO' : 'Dados públicos do estabelecimento'}{atualizado ? `, atualizados em ${atualizado}` : ''}.{' '}
                  <button type="button" onClick={() => onInteresse('corrigir')} data-evento="corrigir">Algo errado? Avise a gente</button>
                </p>
              </div>
            </aside>

            <div className="gd-principal">
              <section className="gd-bloco" aria-labelledby="gd-sobre-t">
                <span className="ld-kicker">{tamanhoNome ? 'Sobre' : 'Conheça'}</span>
                <h2 id="gd-sobre-t" className="gd-h2">{tamanhoNome ? 'Conheça o lugar' : `Sobre ${l.nome}`}</h2>
                <div className="gd-texto">{sobre.map((p, i) => <p key={i}>{p}</p>)}</div>
              </section>

              {c?.destaques?.length > 0 && (
                <section className="gd-bloco" aria-labelledby="gd-dest-t">
                  <span className="ld-kicker">Destaques</span>
                  <h2 id="gd-dest-t" className="gd-h2">Em poucas palavras</h2>
                  <div className={`gd-destaques gd-destaques-${c.destaques.length}`}>
                    {c.destaques.map((d, i) => (
                      <article className="gd-destaque ld-rv" key={d.titulo} style={{ transitionDelay: `${i * 50}ms` }}>
                        <span className="gd-destaque-n">{String(i + 1).padStart(2, '0')}</span>
                        <h3>{d.titulo}</h3>
                        <p>{d.texto}</p>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {c?.dicas?.itens?.length > 0 && (
                <section className="gd-bloco gd-dicas ld-rv" aria-labelledby="gd-dicas-t">
                  <div className="gd-dicas-topo">
                    <span className="gd-dicas-ic"><Lightbulb size={22} /></span>
                    <div><span className="ld-kicker">Dicas</span><h2 id="gd-dicas-t" className="gd-h3">{c.dicas.titulo || 'Antes de marcar'}</h2></div>
                  </div>
                  <ul>{c.dicas.itens.map((d) => <li key={d}><Check size={16} /><span>{d}</span></li>)}</ul>
                </section>
              )}

              {faq.length > 0 && (
                <section className="gd-bloco" aria-labelledby="gd-faq-t">
                  <span className="ld-kicker">Dúvidas</span>
                  <h2 id="gd-faq-t" className="gd-h2">Perguntas frequentes</h2>
                  <div className="ld-faq gd-faq">
                    {faq.map((f) => <details key={f.pergunta}><summary>{f.pergunta}<ChevronDown size={18} /></summary><p>{f.resposta}</p></details>)}
                  </div>
                </section>
              )}
            </div>
          </div>
        </section>

        {/* ---- perto dali e a mesma categoria ---- */}
        {vizinhos.length > 0 && (
          <section className="gd-sec gd-sec-alt" aria-labelledby="gd-perto-t">
            <div className="gd-wrap">
              <div className="gd-sec-cabeca">
                <span className="ld-kicker">Perto dali</span>
                <h2 id="gd-perto-t" className="gd-h2">Outros lugares por perto</h2>
                <p>Salões e estúdios de beleza perto de {l.nome}, em {l.cidade}.</p>
              </div>
              <div className="gd-cartoes gd-trilho">{vizinhos.map((v) => <CartaoLugar key={v.slug} lugar={v} cidadeSlug={l.cidade_slug} cidade={l.cidade} previa={previa} />)}</div>
            </div>
          </section>
        )}

        <section className={'gd-sec' + (vizinhos.length ? '' : ' gd-sec-alt')} aria-labelledby="gd-mais-t">
          <div className="gd-wrap">
            <div className="gd-sec-cabeca">
              <span className="ld-kicker">{cat.rotulo}</span>
              <h2 id="gd-mais-t" className="gd-h2">{outros.length ? `Mais ${cat.plural} em ${l.cidade}` : `Explore o guia de ${l.cidade}`}</h2>
            </div>
            {outros.length > 0 && <div className="gd-cartoes gd-trilho">{outros.map((v) => <CartaoLugar key={v.slug} lugar={v} cidadeSlug={l.cidade_slug} cidade={l.cidade} previa={previa} />)}</div>}
            <div className="gd-explorar">
              <Ir previa={previa} to={rotaDaCategoria(l.cidade_slug, l.categoria)} className="gd-explorar-link"><IconeCategoria slug={l.categoria} size={18} /><span><b>{cat.rotulo} em {l.cidade}</b><small>todos os endereços e horários</small></span><ArrowRight size={18} /></Ir>
              <Ir previa={previa} to={rotaDaCidade(l.cidade_slug)} className="gd-explorar-link"><MapPin size={18} /><span><b>Salões em {l.cidade}</b><small>o guia da cidade, por bairro</small></span><ArrowRight size={18} /></Ir>
              {doBairro && <Ir previa={previa} to={doBairro.caminho} className="gd-explorar-link"><MapPin size={18} /><span><b>{doBairro.rotulo}</b><small>{doBairro.total} endereços de beleza no bairro</small></span><ArrowRight size={18} /></Ir>}
            </div>
          </div>
        </section>

        {/* ---- a dona ---- */}
        {!naMimo && (
          <section className="gd-sec gd-sec-dono" data-area="dono">
            <div className="gd-wrap">
              <div className="gd-dono ld-rv">
                <div className="gd-dono-texto">
                  <span className="ld-kicker">Para quem atende</span>
                  <h2 className="gd-h2">É o seu salão?</h2>
                  {/* a reivindicação (3.12): a equipe confirma com a pessoa por e-mail; nada muda na página antes disso */}
                  <p>Diga que é você: a gente confirma por e-mail e passa a falar com você sobre esta página.</p>
                  <p>E, se quiser, coloque a agenda de {l.nome} online: a cliente marca sozinha, pelo link ou pelo app.</p>
                  {!fotos.length && <p>Tem fotos do salão? Confirmado que é você, a gente manda um link para enviar: elas entram nesta página de graça.</p>}
                  <p className="gd-dono-letra">Para autônoma é grátis para sempre. Salão com equipe testa {REGRAS.testeDias} dias, sem cartão.</p>
                </div>
                <div className="gd-dono-botoes">
                  <button type="button" className="ld-btn ld-branco ld-grande" onClick={() => onInteresse('sou_dono')} data-evento="sou_dono"><Store size={18} /> Sim, sou responsável</button>
                  {previa ? <span className="ld-btn ld-fantasma ld-grande gd-dono-fala">Criar minha agenda grátis <ArrowRight size={18} /></span>
                    : <a className="ld-btn ld-fantasma ld-grande gd-dono-fala" href={comecarEm('salao')} data-evento="criar_agenda">Criar minha agenda grátis <ArrowRight size={18} /></a>}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ---- o aviso de página informativa (regra 3 do contrato) ---- */}
        {!naMimo && (
          <section className="gd-sec gd-sec-aviso" data-area="aviso">
            <div className="gd-wrap">
              <p className="gd-aviso">
                <Info size={18} aria-hidden="true" />
                <span>
                  Página informativa feita pela MIMO com dados públicos do estabelecimento. {l.nome} ainda não agenda pela MIMO.{' '}
                  <button type="button" onClick={() => onInteresse('corrigir')} data-evento="corrigir">É o responsável? Corrija ou peça a remoção.</button>
                </span>
              </p>
            </div>
          </section>
        )}
      </div>

      {/* a foto grande (3.14) */}
      {fotoAberta >= 0 && fotos[fotoAberta] && (
        <Portal>
          <div className="gd-foto-fundo" onClick={() => setFotoAberta(-1)} role="presentation">
            <div className="gd-foto-caixa" role="dialog" aria-modal="true" aria-label={`Foto ${fotoAberta + 1} de ${fotos.length}: ${l.nome}`} onClick={(e) => e.stopPropagation()}>
              <img src={fotos[fotoAberta]} alt={altDaFoto(l, fotoAberta)} />
              <button type="button" className="gd-foto-x" onClick={() => setFotoAberta(-1)} aria-label="Fechar"><X size={20} /></button>
              {fotos.length > 1 && (
                <div className="gd-foto-nav">
                  <button type="button" onClick={() => setFotoAberta((i) => (i - 1 + fotos.length) % fotos.length)} aria-label="Foto anterior"><ChevronDown size={20} style={{ transform: 'rotate(90deg)' }} /></button>
                  <span>{fotoAberta + 1} / {fotos.length}</span>
                  <button type="button" onClick={() => setFotoAberta((i) => (i + 1) % fotos.length)} aria-label="Próxima foto"><ChevronDown size={20} style={{ transform: 'rotate(-90deg)' }} /></button>
                </div>
              )}
            </div>
          </div>
        </Portal>
      )}

      {/* a barra de baixo no celular: fora da página (que é um container) para o fixed valer na tela */}
      {!previa && (
        <div className={'gd-barra' + (barra ? ' gd-barra-on' : '')} inert={!barra} data-area="barra">
          {principal('gd-barra-principal')}
          {zap && <a className="gd-barra-zap" href={zap} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp do salão"><MessageCircle size={22} /></a>}
        </div>
      )}
    </>
  )
}

// o cartão de um salão nas listas (perto dali, a categoria, a cidade)
export function CartaoLugar({ lugar, cidadeSlug, cidade, previa = false }) {
  const cat = categoriaDoGuia(lugar.categoria)
  const servicos = (lugar.servicos ?? []).slice(0, 3)
  const foto = fotosDoLugar(lugar)[0] // a capa (3.14): l.foto nos cartões do banco, l.fotos[0] nos outros
  return (
    <Ir previa={previa} to={rotaDoLugar(cidadeSlug, lugar.slug)} className="gd-cartao ld-rv">
      {foto ? (
        <span className="gd-cartao-capa gd-cartao-foto"><img src={miniatura(foto)} data-cheia={foto} onError={paraFotoInteira} alt="" loading="lazy" decoding="async" /></span>
      ) : (
        <span className={`gd-cartao-capa gd-tom-${lugar.categoria}`} aria-hidden="true">
          <IconeCategoria slug={lugar.categoria} className="gd-cartao-fundo" strokeWidth={1.2} />
          <span className="gd-cartao-icone"><IconeCategoria slug={lugar.categoria} size={20} /></span>
        </span>
      )}
      <span className="gd-cartao-corpo">
        <span className="gd-cartao-selos">
          {lugar.selecao && <span className="gd-selo gd-selo-selecao gd-selo-mini"><Award size={13} /> Seleção MIMO</span>}
          {lugar.na_mimo && <span className="gd-selo gd-selo-mimo gd-selo-mini"><CalendarCheck size={13} /> Na MIMO</span>}
        </span>
        <strong className="gd-cartao-nome">{lugar.nome}</strong>
        <span className="gd-cartao-onde"><MapPin size={14} /> {lugar.bairro || cidade} · {cat.curto}{lugar.distancia != null && <span className="gd-cartao-km"> · a {kmTexto(lugar.distancia)}</span>}</span>
        {lugar.resumo && <span className="gd-cartao-resumo">{lugar.resumo}</span>}
        {servicos.length > 0 && <span className="gd-chips gd-chips-mini">{servicos.map((s) => <span key={s}>{s}</span>)}</span>}
        <span className="gd-cartao-ver">Ver a página <ArrowRight size={15} /></span>
      </span>
    </Ir>
  )
}
