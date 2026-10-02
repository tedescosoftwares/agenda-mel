import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AdminShell from '../../components/AdminShell'
import AvisosNovos from '../../components/AvisosNovos'
import LigarAvisos from '../../components/LigarAvisos'
import PendenciasBaixa from '../../components/PendenciasBaixa'
import PrimeirosPassos from '../../components/PrimeirosPassos'
import AcessoAviso from '../../components/AcessoAviso'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatarCents, formatarReaisCurto, formatarPct, mesAtual, nomeDoMes } from '../../lib/numeros'
import GraficoLinha from '../../components/GraficoLinha'
import { toISODate } from '../../lib/format'
import { linkDoSalao } from '../../lib/endereco'
import QRCode from 'qrcode'
import { AGENDA_ART_EXACT, MEL_ART_EXACT } from '../../assets/mockArtExact'
import { CalendarPlus, Users, Sparkles, MessageCircle, FileSignature, ArrowRight, CalendarDays, TrendingUp, Clock3, QrCode, Settings2, X, PlayCircle, ChevronRight, Activity, CircleDot, Rocket, BellRing, BookOpen, Scissors, Link2, Headphones, Trophy, BadgeCheck, Copy, ExternalLink } from 'lucide-react'

// Dashboard do salão (tela 23): o dia de hoje em quatro números, o
// faturamento do mês dia a dia, o que está esperando resposta, e os
// atalhos para o que se faz todo dia.
export default function AdminDashboard() {
  const { salao, profile } = useAuth()
  const [hoje, setHoje] = useState({ atendimentos: 0, faturamento: 0 })
  const [pendentes, setPendentes] = useState(0)
  const [naFila, setNaFila] = useState(0)
  const [linhas, setLinhas] = useState([])
  const [porDia, setPorDia] = useState([])
  const [semContrato, setSemContrato] = useState([])
  const [primeiros, setPrimeiros] = useState(null)
  const [clientesCount, setClientesCount] = useState(0)
  const [homeCarregada, setHomeCarregada] = useState(false)
  const navigate = useNavigate()
  useEffect(() => {
    try {
      if (localStorage.getItem('mimo-pdv') === '1' && window.innerWidth >= 900 && !sessionStorage.getItem('mimo-pdv-pausado')) navigate('/admin/pdv', { replace: true })
    } catch { /* sem armazenamento */ }
  }, [navigate])
  const salaoId = salao?.id

  const carregar = useCallback(async () => {
    if (!salaoId) return
    setHomeCarregada(false)
    const d = toISODate(new Date()), mes = mesAtual()
    const [ag, pend, fila, res, mesAg, pp, clientes] = await Promise.all([
      supabase.from('appointments').select('price_cents, status').eq('salon_id', salaoId).eq('date', d).neq('status', 'cancelado'),
      supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('salon_id', salaoId).eq('status', 'pendente').gte('date', d),
      supabase.from('waitlist_entries').select('id, professionals!inner(salon_id)', { count: 'exact', head: true }).eq('professionals.salon_id', salaoId).eq('status', 'aguardando'),
      supabase.rpc('resumo_do_salao', { salao: salaoId, mes }),
      supabase.from('appointments').select('date, price_cents').eq('salon_id', salaoId).eq('status', 'concluido').gte('date', mes),
      supabase.rpc('primeiros_passos', { salao: salaoId }),
      supabase.rpc('clientes_do_salao', { salao: salaoId }),
    ])
    const lista = ag.data ?? []
    setHoje({ atendimentos: lista.length, faturamento: lista.reduce((s, a) => s + (a.price_cents ?? 0), 0) })
    setPendentes(pend.count ?? 0)
    setNaFila(fila.count ?? 0)
    setLinhas(res.data ?? [])
    const soma = {}
    for (const a of mesAg.data ?? []) soma[a.date] = (soma[a.date] ?? 0) + (a.price_cents ?? 0)
    setPorDia(Object.entries(soma).sort().map(([k, v]) => ({ x: k.slice(8, 10), y: v / 100 })))
    setPrimeiros(pp.data ?? null)
    setClientesCount(Array.isArray(clientes.data) ? clientes.data.length : 0)
    setHomeCarregada(true)
  }, [salaoId])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => {
    if (!salao?.id || salao?.tipo === 'autonoma') return
    // só quem foi configurada como parceira (ou de antes da 119, sem vínculo definido) entra no aviso
    Promise.all([supabase.rpc('parcerias_da_equipe', { salao: salao.id }), supabase.from('professionals').select('id, vinculo').eq('salon_id', salao.id)]).then(([{ data }, { data: profs }]) => {
      const parceiras = new Set((profs ?? []).filter((p) => !p.vinculo || p.vinculo === 'parceira').map((p) => p.id))
      setSemContrato((data ?? []).filter((l) => parceiras.has(l.professional_id) && (l.status === 'sem_contrato' || l.status === 'rascunho' || l.status === 'enviado')))
    })
  }, [salao?.id, salao?.tipo])

  const totalMes = linhas.reduce((s, l) => s + Number(l.faturamento_cents ?? 0), 0)
  const atendMes = linhas.reduce((s, l) => s + Number(l.atendimentos ?? 0), 0)
  const ocup = linhas.length ? Math.round(linhas.reduce((s, l) => s + Number(l.ocupacao_bps ?? 0), 0) / linhas.length) : 0
  const maior = Math.max(1, ...linhas.map((l) => Number(l.faturamento_cents ?? 0)))

  const nomeSalao = salao?.name ?? 'Meu salão'
  const linkSalao = linkDoSalao(salao)
  const primeiraPalavra = nomeSalao.split(' ')[0]
  const hojeTexto = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  const temMovimento = hoje.atendimentos > 0 || totalMes > 0 || pendentes > 0 || naFila > 0
  const servicosProntos = Number(primeiros?.servicos ?? 0) > 0
  const equipePronta = salao?.tipo === 'autonoma' || Number(primeiros?.equipe ?? 0) > 0
  const categoriasProntas = Array.isArray(salao?.categorias_escolhidas) && salao.categorias_escolhidas.length > 0
  const linkPronto = Boolean(salao?.ativado_em)
  const progressoConfig = [categoriasProntas, servicosProntos, equipePronta, linkPronto]
  const feitosConfig = progressoConfig.filter(Boolean).length
  const primeiroAcesso = primeiros !== null && (!servicosProntos || !equipePronta || !linkPronto)

  const salaoAtivo = Boolean(salao?.ativado_em)
  const fotosSalao = Array.isArray(salao?.fotos) ? salao.fotos : []
  const capaSalao = fotosSalao[0] || salao?.cover_url || salao?.foto_capa_url || ''
  const logoSalao = salao?.logo_url || ''
  const iniciaisSalao = nomeSalao.split(/\s+/).filter(Boolean).slice(0,2).map((x) => x[0]).join('').toUpperCase()
  const nomePessoa = profile?.full_name?.split(' ')?.[0] || ''
  const horaAgora = new Date().getHours()
  const saudacao = horaAgora < 12 ? 'Bom dia' : horaAgora < 18 ? 'Boa tarde' : 'Boa noite'

  const agoraMimo = primeiroAcesso
    ? {
        icone: <Rocket size={19} />,
        selo: 'Próximo passo',
        titulo: 'Termine a configuração para começar a receber agendamentos.',
        texto: 'Serviços, profissionais e o link do salão ficam prontos por aqui, sem voltar para o onboarding.',
        acao: 'Continuar configuração',
        para: '/admin/configurar',
      }
    : pendentes > 0
    ? {
        icone: <BellRing size={19} />,
        selo: 'Precisa da sua atenção',
        titulo: pendentes === 1 ? 'Tem 1 pedido esperando confirmação.' : `Tem ${pendentes} pedidos esperando confirmação.`,
        texto: 'Responder rápido deixa a agenda redonda e a cliente segura de que está tudo certo.',
        acao: 'Ver pedidos na agenda',
        para: '/admin/agenda',
      }
    : naFila > 0
      ? {
          icone: <Users size={19} />,
          selo: 'Oportunidade agora',
          titulo: naFila === 1 ? 'Tem 1 cliente esperando uma vaga.' : `Tem ${naFila} clientes esperando uma vaga.`,
          texto: 'Se algum horário abrir, sua fila já te mostra quem pode ocupar esse espaço.',
          acao: 'Abrir agenda',
          para: '/admin/agenda',
        }
      : hoje.atendimentos > 0
        ? {
            icone: <Activity size={19} />,
            selo: 'Seu salão está em movimento',
            titulo: hoje.atendimentos === 1 ? 'Você tem 1 atendimento hoje.' : `Você tem ${hoje.atendimentos} atendimentos hoje.`,
            texto: `${formatarCents(hoje.faturamento)} em serviços já estão na agenda de hoje.`,
            acao: 'Acompanhar meu dia',
            para: '/admin/agenda',
          }
        : salaoAtivo
          ? {
              icone: <Sparkles size={19} />,
              selo: 'Tudo tranquilo por aqui',
              titulo: 'Sua agenda está pronta para receber clientes.',
              texto: 'Hoje ainda está livre. É um bom momento para compartilhar seu link ou revisar seus serviços.',
              acao: 'Ver meu salão',
              para: '/admin/salao',
            }
          : {
              icone: <Rocket size={19} />,
              selo: 'Sua MIMO está tomando forma',
              titulo: 'A base está pronta. Agora vamos colocar seu salão para rodar.',
              texto: 'Cadastre serviços, organize sua equipe e então libere o link e o QR Code para as clientes.',
              acao: 'Continuar configuração',
              para: '/admin/configurar',
            }

  if (!homeCarregada) {
    return (
      <AdminShell amplo>
        <div className="admin-home admin-home-loading" aria-busy="true">
          <div className="admin-home-skeleton hero"></div>
          <div className="admin-home-skeleton passos"></div>
          <div className="admin-home-skeleton-grid">
            <div className="admin-home-skeleton agenda"></div>
            <div className="admin-home-skeleton centro"></div>
            <div className="admin-home-skeleton lateral"></div>
          </div>
        </div>
      </AdminShell>
    )
  }

  if (primeiroAcesso) {
    return (
      <AdminShell amplo primeiroAcesso>
        <div className="mimo-first">
          <TutorialPainel primeiroAcesso />
          <PrimeiroAcessoHome
            saudacao={saudacao}
            nomePessoa={nomePessoa}
            capaSalao={capaSalao}
            logoSalao={logoSalao}
            iniciaisSalao={iniciaisSalao}
            nomeSalao={nomeSalao}
            hoje={hoje}
            clientesCount={clientesCount}
            feitosConfig={feitosConfig}
            categoriasProntas={categoriasProntas}
            servicosProntos={servicosProntos}
            equipePronta={equipePronta}
            linkPronto={linkPronto}
            salaoAtivo={salaoAtivo}
            linkSalao={linkSalao}
          />
        </div>
      </AdminShell>
    )
  }

  return (
    <AdminShell amplo>
      <div className="admin-home">
        <TutorialPainel primeiroAcesso={primeiroAcesso} />

        <section className={'admin-home-hero' + (capaSalao ? ' tem-capa' : '') + (primeiroAcesso ? ' primeiro-acesso' : '')} data-tour="inicio" style={capaSalao ? { '--home-hero-capa': `url("${capaSalao}")` } : undefined}>
          <div className="admin-home-hero-copy">
            <span className="admin-home-eyebrow"><Sparkles size={13} /> {saudacao}{nomePessoa ? `, ${nomePessoa}` : ''}</span>
            <h1>{temMovimento ? <>Tudo acontecendo em <strong>{primeiraPalavra}</strong>, num só lugar.</> : <>Seu salão ganhou um <strong>centro de comando.</strong></>}</h1>
            <p>{temMovimento
              ? 'Agenda, equipe, clientes e números organizados para você bater o olho e saber o que precisa de atenção.'
              : 'Você já montou a base. Agora faltam poucos passos para começar a receber agendamentos de verdade.'}</p>
            {!primeiroAcesso && (
              <div className="admin-home-status">
                <span className={salaoAtivo ? 'online' : 'configurando'}><i></i>{salaoAtivo ? 'Agenda ativa' : 'Em configuração'}</span>
                <span><CalendarDays size={12} /> {hoje.atendimentos} {hoje.atendimentos === 1 ? 'horário hoje' : 'horários hoje'}</span>
                <span><QrCode size={12} /> {salaoAtivo ? 'Link disponível' : 'Link após ativação'}</span>
              </div>
            )}
            <div className="admin-home-hero-acoes">
              {primeiroAcesso ? (
                <>
                  <Link to="/admin/configurar" className="btn btn-primary"><Settings2 size={16} /> Continuar configuração <ArrowRight size={15} /></Link>
                  <button type="button" className="btn btn-ghost admin-home-tour-btn" onClick={() => window.dispatchEvent(new CustomEvent('mimo:abrir-tour-painel'))}><PlayCircle size={16} /> Fazer tour guiado <small>1 min</small></button>
                </>
              ) : (
                <>
                  <Link to="/admin/agenda" className="btn btn-primary"><CalendarDays size={16} /> Abrir agenda</Link>
                  <Link to="/admin/configurar" className="btn btn-ghost"><Settings2 size={16} /> Configurar salão</Link>
                </>
              )}
            </div>
          </div>

          <div className={'admin-home-hoje' + (primeiroAcesso ? ' primeiro' : '')}>
            <div className="admin-home-negocio-mini">
              <span className="admin-home-negocio-avatar">
                {logoSalao ? <img src={logoSalao} alt="" /> : capaSalao ? <img src={capaSalao} alt="" /> : <b>{iniciaisSalao || 'M'}</b>}
              </span>
              <span><small>Seu salão</small><strong>{nomeSalao}</strong></span>
              <span className="admin-home-online"><i></i> Online</span>
              <ChevronRight size={16} />
            </div>
            {primeiroAcesso ? (
              <div className="admin-home-hoje-metricas">
                <span><small>Hoje</small><strong>{hoje.atendimentos}</strong><em>{hoje.atendimentos === 1 ? 'atendimento' : 'atendimentos'}</em></span>
                <span><small>Faturamento hoje</small><strong>{formatarCents(hoje.faturamento)}</strong></span>
                <span><small>Novos clientes</small><strong>{clientesCount}</strong></span>
              </div>
            ) : (
              <>
                {capaSalao && <div className="admin-home-capa-mini" style={{ backgroundImage:`linear-gradient(180deg,rgba(45,8,57,.08),rgba(45,8,57,.58)),url("${capaSalao}")` }} />}
                <div className="admin-home-hoje-topo"><span>Hoje</span><small>{hojeTexto}</small></div>
                <div className="admin-home-hoje-numero"><strong>{hoje.atendimentos}</strong><span>{hoje.atendimentos === 1 ? 'atendimento' : 'atendimentos'}</span></div>
                <div className="admin-home-hoje-linha"><span><TrendingUp size={14} /> previsto hoje</span><strong>{formatarCents(hoje.faturamento)}</strong></div>
                <Link to="/admin/agenda" className="admin-home-hoje-link">Ver agenda de hoje <ArrowRight size={14} /></Link>
              </>
            )}
          </div>
        </section>

        {primeiroAcesso && (
          <section className="admin-home-primeiro" aria-label="Primeiros passos no painel">
            <div className="admin-home-primeiro-config" data-tour="primeiros-passos">
              <div className="admin-home-primeiro-topo">
                <div className="admin-home-primeiro-intro">
                  <span className="admin-home-primeiro-icone"><Sparkles size={18} /></span>
                  <div>
                    <span className="admin-home-label">Primeiros passos</span>
                    <h2>Deixe seu salão pronto para receber clientes.</h2>
                    <p>Complete o essencial abaixo para liberar a agenda e começar a receber agendamentos de verdade.</p>
                  </div>
                </div>
                <div className="admin-home-primeiro-progresso">
                  <strong>{feitosConfig} de 4 concluídos</strong>
                  <span><i style={{ width:`${(feitosConfig / 4) * 100}%` }} /></span>
                </div>
                <div className="admin-home-primeiro-falta">
                  <Sparkles size={15} />
                  <span><strong>{feitosConfig >= 3 ? 'Quase lá!' : 'Falta pouco!'}</strong><small>Seu salão já está quase pronto.</small></span>
                </div>
              </div>

              <div className="admin-home-primeiro-etapas">
                <Link to="/admin/configurar" className={categoriasProntas ? 'feito' : 'atual'}>
                  <b>{categoriasProntas ? <BadgeCheck size={16} /> : '1'}</b>
                  <span><strong>Categorias de serviços</strong><small>Organize os tipos de atendimento.</small></span>
                  <ChevronRight size={15} />
                </Link>
                <Link to="/admin/configurar" className={servicosProntos ? 'feito' : (!categoriasProntas ? '' : 'atual')}>
                  <b>{servicosProntos ? <BadgeCheck size={16} /> : '2'}</b>
                  <span><strong>Serviços</strong><small>Cadastre duração, preço e detalhes.</small></span>
                  <ChevronRight size={15} />
                </Link>
                <Link to="/admin/equipe" className={equipePronta ? 'feito' : (servicosProntos ? 'atual' : '')}>
                  <b>{equipePronta ? <BadgeCheck size={16} /> : '3'}</b>
                  <span><strong>Profissionais</strong><small>Monte a equipe e defina as agendas.</small></span>
                  <ChevronRight size={15} />
                </Link>
                <Link to="/admin/salao" className={linkPronto ? 'feito' : (equipePronta ? 'atual' : '')}>
                  <b>{linkPronto ? <BadgeCheck size={16} /> : '4'}</b>
                  <span><strong>Compartilhar link</strong><small>Leve sua agenda para os clientes.</small></span>
                  <ChevronRight size={15} />
                </Link>
              </div>
            </div>

            <div className="admin-home-primeiro-grade" data-tour="primeiro-operacao">
              <section className="card admin-home-primeiro-agenda">
                <div className="admin-home-secao-topo compacto">
                  <div><span className="admin-home-label">Seu dia</span><h2>Agenda de hoje</h2></div>
                  <Link to="/admin/agenda">Ver agenda completa <ArrowRight size={13} /></Link>
                </div>
                <div className="admin-home-primeiro-vazio">
                  <img className="admin-home-agenda-art" src={AGENDA_ART_EXACT} alt="" />
                  <strong>Ainda não há agendamentos para hoje.</strong>
                  <p>Quando os primeiros clientes agendarem, eles aparecerão aqui com horário, serviço e profissional.</p>
                  <Link to="/admin/agenda?encaixe=1" className="btn btn-primary">Fazer um agendamento teste</Link>
                  <button type="button" className="admin-home-como" onClick={() => window.dispatchEvent(new CustomEvent('mimo:abrir-tour-painel'))}>Como funciona?</button>
                </div>
              </section>

              <div className="admin-home-primeiro-centro">
                <section className="card admin-home-agora-primeiro">
                  <div className="admin-home-secao-topo compacto">
                    <div><span className="admin-home-label">Agora na MIMO</span><h2>Seu salão está tomando forma</h2></div>
                  </div>
                  <div className="admin-home-agora-lista">
                    <span className={salaoAtivo ? 'ok' : 'pendente'}><i>{salaoAtivo ? <BadgeCheck size={15} /> : <CircleDot size={14} />}</i><b>{salaoAtivo ? 'Seu salão está online' : 'Seu espaço já está criado'}</b><small>{salaoAtivo ? 'Clientes já podem acessar seu link.' : 'A base do salão está salva.'}</small></span>
                    <span className={categoriasProntas ? 'ok' : 'pendente'}><i>{categoriasProntas ? <BadgeCheck size={15} /> : <CircleDot size={14} />}</i><b>{categoriasProntas ? 'Categorias criadas' : 'Crie suas categorias'}</b><small>Organize o que você oferece.</small></span>
                    <Link to="/admin/servicos" className={servicosProntos ? 'ok' : 'atual'}><i>{servicosProntos ? <BadgeCheck size={15} /> : <Scissors size={14} />}</i><b>{servicosProntos ? 'Serviços cadastrados' : 'Cadastre seus serviços'}</b><small>{servicosProntos ? 'Sua vitrine já sabe o que você oferece.' : 'Falta esse passo para montar a agenda.'}</small><ChevronRight size={14} /></Link>
                    <button type="button" className="tour" onClick={() => window.dispatchEvent(new CustomEvent('mimo:abrir-tour-painel'))}><i><PlayCircle size={15} /></i><b>Aprenda com o tour</b><small>Veja o painel em menos de 1 minuto.</small><ChevronRight size={14} /></button>
                  </div>
                </section>

                <section className="card admin-home-primeiro-explica">
                  <div className="admin-home-primeiro-explica-topo">
                    <span className="admin-home-primeiro-explica-icone"><LayoutDashboard size={18} /></span>
                    <div><strong>O que você vai conquistar</strong><small>Quando a configuração terminar, essa Home vira o centro da operação.</small></div>
                  </div>
                  <div className="admin-home-primeiro-beneficios">
                    <article><span><CalendarDays size={16} /></span><strong>Agenda organizada</strong><small>Veja o dia e quem vai atender.</small></article>
                    <article><span><Users size={16} /></span><strong>Equipe em um só lugar</strong><small>Serviços, horários e agenda de cada profissional.</small></article>
                    <article><span><BellRing size={16} /></span><strong>Pedidos de clientes</strong><small>Receba e confirme solicitações.</small></article>
                    <article><span><Link2 size={16} /></span><strong>Seu salão para compartilhar</strong><small>Link e QR para marcarem sozinhos.</small></article>
                  </div>
                </section>
              </div>

              <aside className="admin-home-primeiro-lateral">
                <section className="card admin-home-acoes admin-home-acoes-primeiro" data-tour="atalhos">
                  <div className="admin-home-secao-topo compacto">
                    <div><span className="admin-home-label">Acesso rápido</span><h2>Ações rápidas</h2></div>
                  </div>
                  <div className="admin-home-atalhos">
                    <Link to="/admin/servicos"><span><Scissors size={18} /></span><strong>Cadastrar serviço</strong><small>Adicione o que seu salão oferece</small><ArrowRight size={14} /></Link>
                    <Link to="/admin/equipe"><span><Users size={18} /></span><strong>Adicionar profissional</strong><small>Monte a equipe e os horários</small><ArrowRight size={14} /></Link>
                    <Link to="/admin/salao"><span><QrCode size={18} /></span><strong>Ver meu salão</strong><small>Confira sua página pública</small><ArrowRight size={14} /></Link>
                    <Link to="/admin/salao"><span><Link2 size={18} /></span><strong>Compartilhar link</strong><small>Leve a agenda aos clientes</small><ArrowRight size={14} /></Link>
                  </div>
                </section>

                <section className="card admin-home-compartilhar" data-tour="link">
                  <div>
                    <span className="admin-home-label">Divulgue seu salão</span>
                    <strong>Seu link já pode morar no Instagram, WhatsApp e balcão.</strong>
                    <small>{linkPronto ? 'Copie o link ou use o QR Code.' : 'Assim que a configuração terminar, este é o endereço que você compartilha.'}</small>
                  </div>
                  <div className="admin-home-compartilhar-corpo">
                    <span className="admin-home-link-mini">{linkSalao || 'seusalao.mimo.com.vc'}</span>
                    {linkSalao && <HomeQr texto={linkSalao} />}
                  </div>
                  <div className="admin-home-compartilhar-acoes">
                    {linkSalao && <button type="button" onClick={() => navigator.clipboard?.writeText(linkSalao)}><Copy size={13} /> Copiar link</button>}
                    {linkSalao && <a href={linkSalao} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Abrir</a>}
                  </div>
                </section>

                <section className="card admin-home-primeiro-ajuda">
                  <span><Headphones size={18} /></span>
                  <div>
                    <strong>Precisa de ajuda?</strong>
                    <small>Acesse os tutoriais ou fale com o suporte da MIMO.</small>
                  </div>
                  <span className="admin-home-mel-balao">Oi! Eu sou a <b>Mel</b> 💗</span>
                  <Link to="/admin/guia">Acessar central de ajuda <ArrowRight size={13} /></Link>
                  <img className="admin-home-mel" src={MEL_ART_EXACT} alt="Mel, assistente virtual da MIMO" />
                </section>
              </aside>
            </div>
          </section>
        )}

        {!primeiroAcesso && <section className="admin-home-pulso">
          <div className="admin-home-pulso-principal">
            <span className="admin-home-pulso-icone">{agoraMimo.icone}<i></i></span>
            <div>
              <span className="admin-home-pulso-selo"><CircleDot size={11} /> Agora na MIMO</span>
              <small>{agoraMimo.selo}</small>
              <strong>{agoraMimo.titulo}</strong>
              <p>{agoraMimo.texto}</p>
            </div>
            <Link to={agoraMimo.para} className="admin-home-pulso-acao">{agoraMimo.acao} <ArrowRight size={14} /></Link>
          </div>
          <div className="admin-home-pulso-trilha" aria-label="Estado atual do salão">
            <span className={salaoAtivo ? 'feito' : 'atual'}><i></i><span><strong>{salaoAtivo ? 'Salão online' : 'Preparando salão'}</strong><small>{salaoAtivo ? 'Clientes já podem entrar pelo seu link.' : 'Finalize os pontos essenciais para liberar sua vitrine.'}</small></span></span>
            <span className={pendentes > 0 ? 'atual' : ''}><i></i><span><strong>{pendentes > 0 ? `${pendentes} ${pendentes === 1 ? 'pedido pendente' : 'pedidos pendentes'}` : 'Pedidos em dia'}</strong><small>{pendentes > 0 ? 'Tem cliente esperando sua confirmação.' : 'Nada esperando resposta agora.'}</small></span></span>
            <span className={naFila > 0 ? 'atual' : ''}><i></i><span><strong>{naFila > 0 ? `${naFila} na fila de espera` : 'Fila tranquila'}</strong><small>{naFila > 0 ? 'Há clientes de olho numa oportunidade.' : 'Nenhuma cliente aguardando vaga.'}</small></span></span>
          </div>
        </section>}

        {!primeiroAcesso && <div className="admin-home-alertas" data-tour="primeiros-passos">
          <AcessoAviso />
          <PrimeirosPassos salao={salao} />
          <AvisosNovos />
          <PendenciasBaixa para="/admin/fechar-dia" />
          <LigarAvisos texto="Pedidos, cancelamentos e clientes chamando no WhatsApp chegam na hora, mesmo com o app fechado." />
          {semContrato.length > 0 && (
            <Link to="/admin/equipe" className="card fin-alerta parceria-alerta">
              <FileSignature size={18} />
              <span><strong>Parceria ainda não formalizada.</strong> {semContrato.length === 1 ? `${semContrato[0].nome} está configurada como parceira na MIMO, mas não há contrato registrado.` : `${semContrato.length} profissionais estão configuradas como parceiras na MIMO, mas não há contrato registrado.`} Confira se a formalização da relação está adequada ao modelo adotado pelo salão. <u>Ver orientação</u></span>
            </Link>
          )}
        </div>}

        {!primeiroAcesso && <section className="admin-home-resumo" data-tour="numeros">
          <div className="admin-home-secao-topo">
            <div><span className="admin-home-label">Visão rápida</span><h2>Seu negócio hoje</h2></div>
            <span className="admin-home-data">{hojeTexto}</span>
          </div>

          <div className="admin-home-kpis">
            <div className="admin-home-kpi destaque">
              <span className="admin-home-kpi-icone"><CalendarDays size={18} /></span>
              <span className="admin-home-kpi-label">Atendimentos hoje</span>
              <strong>{hoje.atendimentos}</strong>
              <small>{formatarCents(hoje.faturamento)} em serviços agendados</small>
            </div>
            <div className="admin-home-kpi">
              <span className="admin-home-kpi-icone"><TrendingUp size={18} /></span>
              <span className="admin-home-kpi-label">{nomeDoMes(mesAtual()).split(' ')[0]}</span>
              <strong>{formatarReaisCurto(totalMes)}</strong>
              <small>{atendMes} {atendMes === 1 ? 'atendimento concluído' : 'atendimentos concluídos'}</small>
            </div>
            <Link to="/admin/agenda" className="admin-home-kpi admin-home-kpi-link">
              <span className="admin-home-kpi-icone"><Clock3 size={18} /></span>
              <span className="admin-home-kpi-label">Esperando confirmação</span>
              <strong>{pendentes}</strong>
              <small>{pendentes === 1 ? 'pedido precisa de resposta' : 'pedidos precisam de resposta'}</small>
            </Link>
            <div className="admin-home-kpi">
              <span className="admin-home-kpi-icone"><Users size={18} /></span>
              <span className="admin-home-kpi-label">Fila de espera</span>
              <strong>{naFila}</strong>
              <small>ocupação média de {formatarPct(ocup)}</small>
            </div>
          </div>
        </section>}

        {!primeiroAcesso && <div className="admin-home-grade">
          <section className="card admin-home-grafico">
            <div className="admin-home-secao-topo compacto">
              <div><span className="admin-home-label">Movimento</span><h2>Faturamento do mês</h2></div>
              <span className="admin-home-total">{formatarReaisCurto(totalMes)}</span>
            </div>
            {porDia.length
              ? <GraficoLinha pontos={porDia} />
              : <div className="admin-home-vazio"><TrendingUp size={22} /><strong>Os números começam aqui.</strong><span>Quando os primeiros atendimentos forem concluídos, o movimento do mês aparece neste gráfico.</span></div>}
          </section>

          <aside className="admin-home-lateral" data-tour="atalhos">
            <section className="card admin-home-acoes">
              <div className="admin-home-secao-topo compacto">
                <div><span className="admin-home-label">Acesso rápido</span><h2>O que você pode fazer agora</h2></div>
              </div>
              <div className="admin-home-atalhos">
                <Link to="/admin/agenda?encaixe=1"><span><CalendarPlus size={18} /></span><strong>Novo encaixe</strong><small>Adicionar um atendimento manualmente</small><ArrowRight size={14} /></Link>
                <Link to="/admin/equipe"><span><Users size={18} /></span><strong>Equipe</strong><small>Profissionais e agendas</small><ArrowRight size={14} /></Link>
                <Link to="/admin/servicos"><span><Sparkles size={18} /></span><strong>Serviços</strong><small>Preços, duração e categorias</small><ArrowRight size={14} /></Link>
                <Link to="/admin/whatsapp"><span><MessageCircle size={18} /></span><strong>WhatsApp</strong><small>Mensagens e automações</small><ArrowRight size={14} /></Link>
                <Link to="/admin/guia"><span><BookOpen size={18} /></span><strong>Guia MIMO</strong><small>Vídeos rápidos para aprender o sistema</small><ArrowRight size={14} /></Link>
              </div>
            </section>

            <section className="card admin-home-profissionais">
              <div className="admin-home-secao-topo compacto">
                <div><span className="admin-home-label">Equipe</span><h2>Por profissional</h2></div>
                <Link to="/admin/equipe">Ver equipe</Link>
              </div>
              <div className="barra-list">
                {linhas.slice(0, 5).map((l) => (
                  <div key={l.professional_id} className="barra-item">
                    <div className="barra-topo"><span className="barra-nome">{l.nome}</span><span className="barra-valor">{formatarCents(l.faturamento_cents)}</span></div>
                    <div className="barra-trilho"><span className="barra-preenche" style={{ width: `${Math.max(2, (Number(l.faturamento_cents) * 100) / maior)}%` }} /></div>
                    <span className="barra-nota">{l.atendimentos}× · {formatarPct(l.ocupacao_bps)} ocupada</span>
                  </div>
                ))}
                {linhas.length === 0 && <div className="admin-home-vazio mini"><Users size={19} /><strong>Sua equipe vai aparecer aqui.</strong><span>Adicione profissionais para acompanhar o movimento de cada agenda.</span></div>}
              </div>
            </section>
          </aside>
        </div>}

        {!primeiroAcesso && <section className="admin-home-link card" data-tour="link">
          <div>
            <span className="admin-home-link-icone"><QrCode size={20} /></span>
            <span><strong>Seu salão também vive fora deste painel.</strong><small>Quando serviços e equipe estiverem prontos, seu link e QR Code viram a porta de entrada das clientes.</small></span>
          </div>
          <Link to="/admin/configurar" className="btn btn-ghost">Preparar meu link <ArrowRight size={15} /></Link>
        </section>}
      </div>
    </AdminShell>
  )
}

function PrimeiroAcessoHome({
  saudacao,
  nomePessoa,
  capaSalao,
  logoSalao,
  iniciaisSalao,
  nomeSalao,
  hoje,
  clientesCount,
  feitosConfig,
  categoriasProntas,
  servicosProntos,
  equipePronta,
  linkPronto,
  salaoAtivo,
  linkSalao,
}) {
  const progresso = Math.max(0, Math.min(100, (feitosConfig / 4) * 100))
  const abrirTour = () => window.dispatchEvent(new CustomEvent('mimo:abrir-tour-painel'))

  return (
    <>
      <section
        className="mimo-first-hero"
        data-tour="inicio"
        style={capaSalao ? { '--mimo-first-cover': `url("${capaSalao}")` } : undefined}
      >
        <div className="mimo-first-hero-bg" aria-hidden="true" />
        <div className="mimo-first-hero-copy">
          <span className="mimo-first-kicker"><Sparkles size={13} /> {saudacao}{nomePessoa ? `, ${nomePessoa}` : ''}</span>
          <h1>Seu salão ganhou um <strong>centro de comando.</strong></h1>
          <p>Organize sua agenda, sua equipe e receba mais clientes de forma simples, tudo em um só lugar.</p>
          <div className="mimo-first-hero-actions">
            <Link to="/admin/configurar" className="mimo-first-primary"><Settings2 size={16} /> Continuar configuração <ArrowRight size={15} /></Link>
            <button type="button" className="mimo-first-secondary" onClick={abrirTour}><PlayCircle size={16} /> Fazer tour guiado <span>1 min</span></button>
          </div>
        </div>

        <div className="mimo-first-salon-card">
          <div className="mimo-first-salon-head">
            <span className="mimo-first-salon-photo">
              {logoSalao ? <img src={logoSalao} alt="" /> : capaSalao ? <img src={capaSalao} alt="" /> : <b>{iniciaisSalao || 'M'}</b>}
            </span>
            <span className="mimo-first-salon-name"><small>Seu salão</small><strong>{nomeSalao}</strong></span>
            <span className="mimo-first-online"><i /> Online</span>
            <ChevronRight size={16} />
          </div>
          <div className="mimo-first-metrics">
            <span><small>Hoje</small><strong>{hoje.atendimentos}</strong><em>{hoje.atendimentos === 1 ? 'atendimento' : 'atendimentos'}</em></span>
            <span><small>Faturamento hoje</small><strong>{formatarCents(hoje.faturamento)}</strong></span>
            <span><small>Novos clientes</small><strong>{clientesCount}</strong></span>
          </div>
        </div>
      </section>

      <section className="mimo-first-setup" data-tour="primeiros-passos">
        <div className="mimo-first-setup-head">
          <div className="mimo-first-setup-title">
            <span className="mimo-first-setup-icon"><Sparkles size={18} /></span>
            <div>
              <span className="mimo-first-kicker">Primeiros passos</span>
              <h2>Deixe seu salão pronto para receber clientes</h2>
              <p>Complete as etapas abaixo para liberar sua agenda e começar a receber agendamentos de verdade.</p>
            </div>
          </div>
          <div className="mimo-first-progress">
            <div><strong>{feitosConfig} de 4 concluídos</strong><span><i style={{ width:`${progresso}%` }} /></span></div>
            <aside><Sparkles size={14} /><span><b>{feitosConfig >= 3 ? 'Quase lá!' : 'Falta pouco!'}</b><small>Seu salão já está quase pronto.</small></span></aside>
          </div>
        </div>

        <div className="mimo-first-steps">
          <Link to="/admin/configurar" className={categoriasProntas ? 'done' : 'current'}>
            <b>{categoriasProntas ? <BadgeCheck size={15} /> : '1'}</b>
            <span><strong>Categorias de serviços</strong><small>Crie as categorias: cabelo, unha, estética...</small></span>
            <ChevronRight size={14} />
          </Link>
          <Link to="/admin/configurar" className={servicosProntos ? 'done' : (categoriasProntas ? 'current' : '')}>
            <b>{servicosProntos ? <BadgeCheck size={15} /> : '2'}</b>
            <span><strong>Serviços</strong><small>Cadastre seus serviços, duração e preços.</small></span>
            <ChevronRight size={14} />
          </Link>
          <Link to="/admin/equipe" className={equipePronta ? 'done' : (servicosProntos ? 'current' : '')}>
            <b>{equipePronta ? <BadgeCheck size={15} /> : '3'}</b>
            <span><strong>Profissionais</strong><small>Adicione sua equipe e defina as agendas.</small></span>
            <ChevronRight size={14} />
          </Link>
          <Link to="/admin/salao" className={linkPronto ? 'done' : (equipePronta ? 'current' : '')}>
            <b>{linkPronto ? <BadgeCheck size={15} /> : '4'}</b>
            <span><strong>Compartilhar link</strong><small>Divulgue seu link para receber clientes.</small></span>
            <ChevronRight size={14} />
          </Link>
        </div>
      </section>

      <section className="mimo-first-board" data-tour="primeiro-operacao">
        <article className="mimo-first-panel mimo-first-agenda">
          <header>
            <div><span className="mimo-first-kicker">Seu dia</span><h3>Agenda de hoje</h3></div>
            <Link to="/admin/agenda">Ver agenda completa <ArrowRight size={13} /></Link>
          </header>
          <div className="mimo-first-agenda-empty">
            <img src={AGENDA_ART_EXACT} alt="" />
            <strong>Ainda não há agendamentos para hoje.</strong>
            <p>Quando os primeiros clientes agendarem, eles aparecerão aqui com horário, serviço e profissional.</p>
            <Link to="/admin/agenda?encaixe=1" className="mimo-first-primary small"><CalendarPlus size={14} /> Fazer um agendamento teste</Link>
            <button type="button" onClick={abrirTour}>Como funciona?</button>
          </div>
        </article>

        <div className="mimo-first-middle">
          <article className="mimo-first-panel mimo-first-status">
            <header><div><span className="mimo-first-kicker">Agora na MIMO</span><h3>Seu salão está tomando forma</h3></div></header>
            <div className="mimo-first-status-list">
              <span className="ok"><i><BadgeCheck size={14} /></i><b>Seu salão está online</b><small>Clientes já podem acessar seu link.</small></span>
              <span className={categoriasProntas ? 'ok' : ''}><i>{categoriasProntas ? <BadgeCheck size={14} /> : <CircleDot size={13} />}</i><b>{categoriasProntas ? 'Categorias criadas' : 'Crie suas categorias'}</b><small>Organize o que você oferece.</small></span>
              <Link to="/admin/servicos" className={servicosProntos ? 'ok' : 'current'}><i>{servicosProntos ? <BadgeCheck size={14} /> : <Scissors size={13} />}</i><b>{servicosProntos ? 'Serviços cadastrados' : 'Cadastre seus serviços'}</b><small>{servicosProntos ? 'Sua vitrine já sabe o que você oferece.' : 'Falta esse passo para montar a agenda.'}</small><ChevronRight size={13} /></Link>
              <button type="button" className="tour" onClick={abrirTour}><i><PlayCircle size={14} /></i><b>Aprenda com o tour</b><small>Veja o painel em menos de 1 minuto.</small><ChevronRight size={13} /></button>
            </div>
          </article>

          <article className="mimo-first-panel mimo-first-benefits">
            <div className="mimo-first-benefits-head"><span><Trophy size={17} /></span><div><strong>O que você vai conquistar</strong><small>Quando a configuração terminar, essa Home vira o centro da operação.</small></div></div>
            <div className="mimo-first-benefits-grid">
              <span><i><CalendarDays size={15} /></i><b>Agenda organizada</b><small>Veja todos os atendimentos do dia.</small></span>
              <span><i><Users size={15} /></i><b>Equipe em um só lugar</b><small>Serviços, horários e agenda de cada profissional.</small></span>
              <span><i><BellRing size={15} /></i><b>Pedidos de clientes</b><small>Receba e confirme solicitações.</small></span>
              <span><i><Link2 size={15} /></i><b>Seu salão para compartilhar</b><small>Link e QR para marcarem sozinhos.</small></span>
            </div>
          </article>
        </div>

        <aside className="mimo-first-side">
          <article className="mimo-first-panel mimo-first-actions" data-tour="atalhos">
            <header><div><span className="mimo-first-kicker">Acesso rápido</span><h3>Ações rápidas</h3></div></header>
            <div className="mimo-first-actions-grid">
              <Link to="/admin/servicos"><i><Scissors size={17} /></i><b>Cadastrar serviço</b><small>Adicione o que seu salão oferece</small></Link>
              <Link to="/admin/equipe"><i><Users size={17} /></i><b>Adicionar profissional</b><small>Monte a equipe e os horários</small></Link>
              <Link to="/admin/salao"><i><QrCode size={17} /></i><b>Ver meu salão</b><small>Confira sua página pública</small></Link>
              <Link to="/admin/salao"><i><Link2 size={17} /></i><b>Compartilhar link</b><small>Leve a agenda aos clientes</small></Link>
            </div>
          </article>

          <article className="mimo-first-panel mimo-first-share" data-tour="link">
            <div>
              <span className="mimo-first-kicker">Divulgue seu salão</span>
              <strong>Seu link já pode morar no Instagram, WhatsApp e balcão.</strong>
              <small>{linkPronto ? 'Copie o link ou use o QR Code.' : 'Assim que a configuração terminar, este é o endereço que você compartilha.'}</small>
            </div>
            <div className="mimo-first-share-body">
              <span>{linkSalao || 'seusalao.mimo.com.vc'}</span>
              {linkSalao && <HomeQr texto={linkSalao} />}
            </div>
            <div className="mimo-first-share-actions">
              {linkSalao && <button type="button" onClick={() => navigator.clipboard?.writeText(linkSalao)}><Copy size={12} /> Copiar link</button>}
              {linkSalao && <a href={linkSalao} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Abrir</a>}
            </div>
          </article>

          <article className="mimo-first-panel mimo-first-help">
            <div className="mimo-first-help-copy">
              <i><Headphones size={17} /></i>
              <div><strong>Precisa de ajuda?</strong><small>Acesse os tutoriais ou fale com o suporte da MIMO.</small></div>
            </div>
            <Link to="/admin/guia">Acessar central de ajuda <ArrowRight size={12} /></Link>
            <span className="mimo-first-help-bubble">Oi! Eu sou a <b>Mel</b> 💗</span>
            <img src={MEL_ART_EXACT} alt="Mel, assistente virtual da MIMO" />
          </article>
        </aside>
      </section>
    </>
  )
}

const PASSOS_TOUR_DIA = [
  { alvo:'[data-tour="inicio"]', titulo:'Esse é o centro do seu salão', texto:'Aqui você enxerga o dia, abre sua agenda e continua qualquer configuração que ainda faltar.' },
  { alvo:'[data-tour="primeiros-passos"]', titulo:'A MIMO te mostra o que falta', texto:'Enquanto o salão ainda estiver sendo preparado, esta área te conduz por serviços, equipe, ativação, link e QR.' },
  { alvo:'[data-tour="numeros"]', titulo:'Os números aparecem sem você caçar', texto:'Atendimentos, movimento do mês, pedidos pendentes e fila de espera ficam resumidos aqui.' },
  { alvo:'[data-tour="atalhos"]', titulo:'As ações do dia a dia ficam perto', texto:'Equipe, serviços, encaixes e WhatsApp estão a um toque. Você não precisa decorar menus.' },
  { alvo:'[data-tour="link"]', titulo:'E daqui seu salão vai para a rua', texto:'O link e o QR Code são a porta de entrada das clientes. Quando a configuração estiver pronta, é isso que você compartilha.' },
]

const PASSOS_TOUR_PRIMEIRO = [
  { alvo:'[data-tour="inicio"]', titulo:'Esse é o centro do seu salão', texto:'A Home mostra o que já está pronto, o que falta e o caminho mais curto para colocar sua agenda para rodar.' },
  { alvo:'[data-tour="primeiros-passos"]', titulo:'Comece por estes quatro passos', texto:'Categorias, serviços, profissionais e o link público. Conforme você conclui, essa área vai desaparecendo e o painel do dia a dia assume o lugar.' },
  { alvo:'[data-tour="primeiro-operacao"]', titulo:'Aqui nasce a rotina do salão', texto:'A agenda, os pedidos e os resultados vão aparecer nesta área quando os primeiros clientes começarem a marcar.' },
  { alvo:'[data-tour="atalhos"]', titulo:'Você não precisa decorar menus', texto:'As ações mais comuns ficam perto enquanto você ainda está montando o salão.' },
  { alvo:'[data-tour="link"]', titulo:'Esse é o endereço do seu salão na MIMO', texto:'Quando estiver tudo pronto, compartilhe o link ou o QR Code no WhatsApp, Instagram e no balcão.' },
]

function TutorialPainel({ primeiroAcesso = false }) {
  const [convite, setConvite] = useState(() => {
    try { return localStorage.getItem('mimo-tour-painel-concluido') !== '1' && sessionStorage.getItem('mimo-tour-painel-depois') !== '1' }
    catch { return true }
  })
  const [passo, setPasso] = useState(-1)
  const [rect, setRect] = useState(null)

  const passos = primeiroAcesso ? PASSOS_TOUR_PRIMEIRO : PASSOS_TOUR_DIA
  const ativo = passo >= 0
  const atual = passos[passo]

  useEffect(() => {
    const abrir = () => iniciar()
    window.addEventListener('mimo:abrir-tour-painel', abrir)
    return () => window.removeEventListener('mimo:abrir-tour-painel', abrir)
  }, [])

  useEffect(() => {
    if (!ativo || !atual) return
    const atualizar = () => {
      const el = document.querySelector(atual.alvo)
      if (!el) { setRect(null); return }
      el.scrollIntoView({ behavior:'smooth', block:'center' })
      setTimeout(() => {
        const r = el.getBoundingClientRect()
        setRect({ top:r.top, left:r.left, width:r.width, height:r.height })
      }, 300)
    }
    atualizar()
    window.addEventListener('resize', atualizar)
    return () => window.removeEventListener('resize', atualizar)
  }, [ativo, atual])

  function depois() {
    try { sessionStorage.setItem('mimo-tour-painel-depois', '1') } catch { /* segue */ }
    setConvite(false)
  }
  function iniciar() { setConvite(false); setPasso(0) }
  function fechar() { setPasso(-1) }
  function proximo() {
    if (passo >= passos.length - 1) {
      try { localStorage.setItem('mimo-tour-painel-concluido', '1') } catch { /* segue */ }
      setPasso(-1)
      return
    }
    setPasso((x) => x + 1)
  }

  return (
    <>
      {convite && (
        <div className="admin-tour-convite">
          <span className="admin-tour-convite-icone"><PlayCircle size={21} /></span>
          <span><strong>Primeira vez por aqui?</strong><small>A MIMO pode te mostrar o básico deste painel em menos de 1 minuto.</small></span>
          <div><button type="button" className="btn btn-ghost" onClick={depois}>Agora não</button><button type="button" className="btn btn-primary" onClick={iniciar}>Me mostra <ArrowRight size={15} /></button></div>
        </div>
      )}

      {ativo && atual && (
        <div className="admin-tour-overlay">
          {rect && <div className="admin-tour-foco" style={{ top:rect.top - 8, left:rect.left - 8, width:rect.width + 16, height:rect.height + 16 }} />}
          <div className="admin-tour-card">
            <div className="admin-tour-card-topo"><span>{passo + 1} de {passos.length}</span><button type="button" onClick={fechar} aria-label="Fechar tutorial"><X size={17} /></button></div>
            <strong>{atual.titulo}</strong>
            <p>{atual.texto}</p>
            <div className="admin-tour-card-acoes">
              <button type="button" className="btn btn-ghost" onClick={fechar}>Sair do tour</button>
              <button type="button" className="btn btn-primary" onClick={proximo}>{passo === passos.length - 1 ? 'Pronto' : 'Próximo'} <ChevronRight size={15} /></button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}


function HomeQr({ texto }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current || !texto) return
    QRCode.toCanvas(ref.current, texto, { width: 92, margin: 1, color: { dark: '#3d0c4e', light: '#ffffff' } }).catch(() => {})
  }, [texto])
  return <canvas ref={ref} className="admin-home-qr" aria-label="QR Code do salão" />
}
