import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays, Users, Heart, RotateCcw, MessageCircle, Wallet, QrCode, Clock, Star,
  Check, Menu, X, ArrowRight, ChevronDown, Hand, Scissors, Palette, Eye, Flower2,
  LayoutGrid, Receipt, UserRound, PauseCircle, CalendarPlus, Ban, Send, Bell, MapPin,
} from 'lucide-react'
import { MarcaIcon } from '../../components/icons'
import { urlDoAmbiente } from '../../lib/ambiente'
import { EMAIL_CONTATO } from '../../lib/termos'
import '../../landing.css'

// A porta da rua: mimo.com.vc para quem ainda não é de casa. Fala com a
// dona do salão e com a profissional autônoma; a cliente entra pelo
// código de quem a chamou (o "Entrar" leva lá). Os botões de começar
// apontam para o ambiente pro, onde o cadastro vive.
//
// A narrativa: problema → operação → relacionamento → funcionalidades →
// preço → ação. Os mocks são o produto de verdade, em HTML e CSS.
// O logo é sempre /mimo-logo.svg: trocou o arquivo, trocou em tudo.

const TITULO = 'MIMO | Sistema para Salão de Beleza e Agenda Online'
const DESCRICAO = 'Organize agenda, clientes, equipe, WhatsApp, retorno e pagamentos com a MIMO. Sistema para salão de beleza e profissional autônoma. Plano grátis para autônomas.'

const FAQ = [
  ['A MIMO serve para salão com várias profissionais?', 'Sim. O salão cadastra as profissionais, define serviços, horários e agendas individuais, e enxerga tudo numa tela só. Cada profissional tem o app dela para ver os próprios horários.'],
  ['A profissional autônoma paga mensalidade?', 'Não. A conta de autônoma é gratuita: uma agenda, serviços, horários, clientes, QR e link próprios.'],
  ['Quem configura a agenda da profissional que trabalha no salão?', 'O próprio salão. Ele define vínculo, serviços, horários e permissões. A profissional entra pelo link da equipe e já encontra tudo pronto.'],
  ['A cliente precisa procurar meu salão num marketplace?', 'Não. Ninguém entra na MIMO do nada: a cliente chega pelo seu QR, código, link ou convite, e passa a ver só a agenda de quem a chamou.'],
  ['Dá para cobrar sinal no agendamento?', 'Dá, quando o salão habilita. Você escolhe sinal fixo ou porcentagem do serviço, ou pagamento completo. O status financeiro fica ligado ao próprio atendimento.'],
  ['Precisa baixar aplicativo na loja?', 'Não. A MIMO funciona pelo navegador e pode ser adicionada à tela inicial do celular, com aviso e tudo, como um aplicativo instalado.'],
]

const PROFISSOES = ['manicure', 'cabeleireira', 'lash designer', 'designer de sobrancelhas', 'maquiadora', 'barbeira', 'esteticista', 'nail designer', 'trancista', 'depiladora', 'colorista', 'massoterapeuta']
const CATEGORIAS = [[Hand, 'unhas'], [Scissors, 'cabelo'], [Palette, 'make'], [Eye, 'sobrancelha'], [Flower2, 'estética']]

// os cartazes da parede: frases do nicho, no tom das artes da marca
const CARTAZES = [
  { tom: 'rosa', gira: -2, titulo: ['Cadeira', 'vazia', '*custa caro.'], sub: 'A lista de espera preenche a vaga que abriu.', bilhete: 'agenda cheia' },
  { tom: 'creme', gira: 1.5, titulo: ['Sua cliente', '*marca', 'sozinha.'], sub: 'Pelo seu QR, no horário que você abriu.', bilhete: 'sem WhatsApp às 23h' },
  { tom: 'preto', gira: -1, titulo: ['Mani?', 'Escova?', 'Cílios?', '*Fecha junto.'], sub: 'Uma comanda só. O repasse já sai separado.', bilhete: 'o que é de quem' },
  { tom: 'rosa-2', gira: 2, titulo: ['Avaliação', 'na hora.', '*Nota no quadro.'], sub: 'Cada serviço, cada profissional.', bilhete: 'cinco estrelas' },
]

const VINCULOS = ['Profissional parceira', 'Funcionária do salão', 'Autônoma vinculada', 'Aluga espaço', 'Temporária']

const GRUPOS = [
  { Icone: CalendarDays, nome: 'Agenda', itens: ['Agenda geral', 'Agenda por profissional', 'Bloqueios', 'Pausas', 'Encaixes', 'Múltiplos serviços', 'Lista de espera'] },
  { Icone: Heart, nome: 'Clientes', itens: ['Histórico', 'Retorno', 'Preferências', 'Origem', 'Avaliações'] },
  { Icone: Users, nome: 'Equipe', itens: ['Vínculos', 'Serviços', 'Horários', 'Permissões', 'Comissões'] },
  { Icone: MessageCircle, nome: 'Comunicação', itens: ['WhatsApp', 'Confirmação', 'Lembretes', 'Reagendamento', 'Pós-atendimento'] },
  { Icone: Wallet, nome: 'Financeiro', itens: ['Sinal', 'Pagamentos', 'Comanda', 'Caixa', 'Comissões'] },
]

const ARTIGOS = [
  ['Agenda', 'Como organizar a agenda de um salão de beleza', 'Caderno, WhatsApp, planilha ou sistema: como escolher sem complicar a operação.'],
  ['Gestão', 'Como reduzir horários vagos no salão', 'Cancelamento, lista de espera, retorno e ocupação: onde o salão perde agenda sem perceber.'],
  ['Clientes', 'Como fazer clientes voltarem ao salão', 'Retorno, manutenção e relacionamento sem depender da memória da profissional.'],
]

const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', '@id': 'https://mimo.com.vc/#organization', name: 'MIMO', url: 'https://mimo.com.vc/', logo: 'https://mimo.com.vc/mimo-logo.svg', description: 'Plataforma de agenda, operação e relacionamento para negócios de beleza.' },
    { '@type': 'WebSite', '@id': 'https://mimo.com.vc/#website', url: 'https://mimo.com.vc/', name: 'MIMO', publisher: { '@id': 'https://mimo.com.vc/#organization' }, inLanguage: 'pt-BR' },
    {
      '@type': 'SoftwareApplication', '@id': 'https://mimo.com.vc/#software', name: 'MIMO', url: 'https://mimo.com.vc/',
      applicationCategory: 'BusinessApplication', operatingSystem: 'Web, iOS, Android', inLanguage: 'pt-BR', description: DESCRICAO,
      offers: [
        { '@type': 'Offer', name: 'MIMO Autônoma', price: '0', priceCurrency: 'BRL' },
        { '@type': 'Offer', name: 'MIMO Pro Salão', price: '49.90', priceCurrency: 'BRL', description: 'Mensalidade base, mais R$ 9,90 por profissional ativa na agenda.' },
      ],
      publisher: { '@id': 'https://mimo.com.vc/#organization' },
    },
    { '@type': 'FAQPage', '@id': 'https://mimo.com.vc/#faq', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ],
}

// coração de pincel, como nos cartazes da marca
function Coracao({ className }) {
  return (
    <svg viewBox="0 0 64 60" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M32 54 C 12 40, 4 29, 7 17 C 10 7, 22 5, 31 16 C 41 5, 54 7, 57 17 C 60 29, 52 40, 32 54 Z" />
      <path d="M33 51 C 15 38, 9 28, 11 19" strokeWidth="4" opacity="0.55" />
    </svg>
  )
}

// a marca como nos cartazes: MIMO em caixa alta com o coração sobre o i
function MarcaCartaz() {
  return (
    <span className="ld-cz-marca" aria-label="mimo">
      <span className="ld-cz-marca-nome">M<b>i<Coracao /></b>MO</span>
      <small>agenda de salão</small>
    </span>
  )
}

// as fotos do pacote da marca: WebP em dois tamanhos, preguiçosas
// fora do herói. A alt descreve a cena, não repete o título.
function Foto({ nome, alt, className = '', prioridade = false }) {
  return (
    <img
      className={'ld-foto ' + className}
      src={`/imagens/${nome}-1400.webp`}
      srcSet={`/imagens/${nome}-720.webp 720w, /imagens/${nome}-1400.webp 1400w`}
      sizes="(max-width: 700px) 100vw, 640px"
      alt={alt}
      loading={prioridade ? 'eager' : 'lazy'}
      fetchPriority={prioridade ? 'high' : 'auto'}
      decoding="async"
    />
  )
}

function Logo({ altura = 40 }) {
  return <img src="/mimo-logo.svg" alt="MIMO" height={altura} style={{ height: altura, width: 'auto' }} />
}

// aparece quando entra na tela (uma vez só)
function useRevelar() {
  const ref = useRef(null)
  useEffect(() => {
    const raiz = ref.current
    if (!raiz || !('IntersectionObserver' in window)) return
    const itens = raiz.querySelectorAll('.ld-rv')
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { e.target.classList.add('ld-vis'); io.unobserve(e.target) }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
    itens.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
  return ref
}

function Cabeca({ kicker, titulo, children, centro = false, claro = false }) {
  return (
    <div className={'ld-cabeca ld-rv' + (centro ? ' ld-centro' : '') + (claro ? ' ld-cabeca-clara' : '')}>
      <span className="ld-kicker">{kicker}</span>
      <h2>{titulo.map((l, i) => <span key={i}>{l}</span>)}</h2>
      {children && <p>{children}</p>}
    </div>
  )
}

export default function Landing() {
  const raiz = useRevelar()
  const [menu, setMenu] = useState(false)
  const [entrarAberto, setEntrarAberto] = useState(false)
  const entrarRef = useRef(null)
  const comecar = (tipo) => urlDoAmbiente('pro', tipo ? `/comecar?tipo=${tipo}` : '/comecar')
  const entrar = urlDoAmbiente('pro', '/pro/entrar')

  useEffect(() => {
    const antes = document.title
    document.title = TITULO
    const desc = document.querySelector('meta[name="description"]')
    const descAntes = desc?.getAttribute('content')
    desc?.setAttribute('content', DESCRICAO)
    const canon = document.createElement('link')
    canon.rel = 'canonical'; canon.href = 'https://mimo.com.vc/'
    document.head.appendChild(canon)
    return () => { document.title = antes; if (descAntes) desc?.setAttribute('content', descAntes); canon.remove() }
  }, [])

  useEffect(() => {
    if (!menu && !entrarAberto) return
    const tecla = (e) => { if (e.key === 'Escape') { setMenu(false); setEntrarAberto(false) } }
    const fora = (e) => { if (entrarRef.current && !entrarRef.current.contains(e.target)) setEntrarAberto(false) }
    window.addEventListener('keydown', tecla)
    document.addEventListener('pointerdown', fora)
    return () => { window.removeEventListener('keydown', tecla); document.removeEventListener('pointerdown', fora) }
  }, [menu, entrarAberto])

  const links = [['#saloes', 'Para salões'], ['#autonomas', 'Para autônomas'], ['#funcionalidades', 'Funcionalidades'], ['#como-funciona', 'Como funciona'], ['#planos', 'Planos'], ['#conteudos', 'Conteúdos']]

  return (
    <div className="ld" ref={raiz}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      <header className="ld-nav">
        <div className="ld-wrap ld-nav-in">
          <a href="#topo" className="ld-logo" aria-label="MIMO, início"><Logo altura={52} /></a>
          <nav className="ld-links" aria-label="Seções">{links.map(([h, t]) => <a key={h} href={h}>{t}</a>)}</nav>
          <div className="ld-acoes">
            <div className="ld-entrar" ref={entrarRef}>
              <button className="ld-btn ld-fantasma" aria-haspopup="menu" aria-expanded={entrarAberto} onClick={() => setEntrarAberto((a) => !a)}>Entrar <ChevronDown size={16} /></button>
              {entrarAberto && (
                <div className="ld-entrar-menu" role="menu">
                  <a role="menuitem" href={entrar}><MarcaIcon width={22} height={19} id="ld-en-pro" /><span><b>MIMO Pro</b><small>Salão e profissional · pro.mimo.com.vc</small></span></a>
                  <Link role="menuitem" to="/entrar"><MarcaIcon width={22} height={19} id="ld-en-cli" /><span><b>MIMO</b><small>Cliente: entrar com o código · mimo.com.vc</small></span></Link>
                </div>
              )}
            </div>
            <a className="ld-btn ld-primario" href={comecar()}>Começar agora</a>
            <button className="ld-menu-btn" aria-label={menu ? 'Fechar menu' : 'Abrir menu'} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>{menu ? <X size={22} /> : <Menu size={22} />}</button>
          </div>
        </div>
        {menu && (
          <div className="ld-menu" onClick={() => setMenu(false)}>
            {links.map(([h, t]) => <a key={h} href={h}>{t}</a>)}
            <a className="ld-btn ld-primario" href={comecar()}>Começar agora</a>
            <div className="ld-menu-entrar">
              <span>Entrar</span>
              <a href={entrar}><b>MIMO Pro</b><small>salão e profissional</small></a>
              <Link to="/entrar"><b>MIMO</b><small>cliente, com o código</small></Link>
            </div>
          </div>
        )}
      </header>

      <main id="topo">
        {/* ---------- HERÓI ---------- */}
        <section className="ld-hero">
          <div className="ld-wrap ld-hero-grade">
            <div className="ld-hero-texto">
              <span className="ld-kicker">Feita para quem vive da beleza</span>
              <h1>Sua rotina no lugar.<span>Seus clientes mais perto.</span></h1>
              <Coracao className="ld-hero-coracao" />
              <p className="ld-lead">A MIMO conecta agenda, clientes, equipe, WhatsApp, retorno e pagamentos numa experiência feita para a rotina real de quem trabalha com beleza.</p>
              <p className="ld-lead ld-lead-2">Menos conversa perdida. Menos horário vazio. Mais organização para o salão e mais facilidade para a cliente.</p>
              <div className="ld-hero-cta">
                <a className="ld-btn ld-primario ld-grande" href={comecar()}>Começar agora <ArrowRight size={18} /></a>
                <a className="ld-btn ld-fantasma ld-grande" href="#como-funciona">Ver como funciona</a>
                <span className="ld-bilhete ld-bilhete-hero">sua cliente marca sozinha <i>♥</i></span>
              </div>
              <ul className="ld-prova">
                <li><i><Check size={12} /></i> Profissional autônoma grátis</li>
                <li><i><Check size={12} /></i> Salões com múltiplas agendas</li>
                <li><i><Check size={12} /></i> Funciona no celular</li>
              </ul>
            </div>
            <PalcoCelular />
          </div>
        </section>

        <div className="ld-fita" aria-hidden="true">
          <div className="ld-fita-trilho">
            {[0, 1].map((k) => (
              <span key={k}>agenda <i>♥</i> clientes <i>♥</i> equipe <i>♥</i> retorno <i>♥</i> whatsapp <i>♥</i> lista de espera <i>♥</i> sinal <i>♥</i> comanda <i>♥</i></span>
            ))}
          </div>
        </div>

        {/* ---------- A ROTINA REAL ---------- */}
        <section>
          <div className="ld-wrap">
            <Cabeca kicker="A rotina real" titulo={['Um salão não funciona em uma tela só.', 'Por isso a MIMO conecta tudo.']} />
            <div className="ld-rotina">
              <div className="ld-rotina-foto ld-rv"><Foto nome="salao" alt="Salão de beleza com recepção, cadeiras e espelhos iluminados" /></div>
              <div className="ld-rotina-texto ld-rv">
                <p>A agenda é só uma parte da rotina.</p>
                <p>Tem cliente perguntando horário no WhatsApp, profissional com disponibilidade diferente, cancelamento de última hora, comissão, retorno, encaixe e uma cadeira que não pode ficar vazia.</p>
                <p>A MIMO conecta essas partes para o salão não depender de memória, papel e dez ferramentas diferentes.</p>
              </div>
              <div className="ld-rotina-cartas">
                {[[CalendarDays, 'Agenda', 'Horários, bloqueios, encaixes e múltiplos serviços.'], [Heart, 'Clientes', 'Histórico, preferências, retornos e relacionamento.'], [Users, 'Equipe', 'Cada profissional com seus serviços, horários e regras.'], [MessageCircle, 'Comunicação', 'Confirmações, lembretes e retorno pelo WhatsApp.']].map(([Ic, t, d], i) => (
                  <article className="ld-rotina-carta ld-rv" key={t} style={{ transitionDelay: `${i * 70}ms` }}><div className="ld-ico"><Ic size={22} /></div><h3>{t}</h3><p>{d}</p></article>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------- COMO A MIMO CONECTA ---------- */}
        <section id="como-funciona" className="ld-alt">
          <div className="ld-wrap">
            <Cabeca kicker="Como a MIMO funciona" titulo={['Cliente, profissional e salão.', 'Tudo conectado, sem misturar as relações.']} centro />
            <div className="ld-conecta">
              <div className="ld-grafo ld-rv">
                <div className="ld-no ld-no-cliente"><i><UserRound size={22} /></i><strong>Cliente</strong><span>uma conta, vários negócios</span></div>
                <span className="ld-seta" aria-hidden="true"><ArrowRight size={22} /></span>
                <div className="ld-no ld-no-salao"><i><LayoutGrid size={22} /></i><strong>Salão</strong><span>vínculo por QR, link, convite</span></div>
                <span className="ld-seta" aria-hidden="true"><ArrowRight size={22} /></span>
                <div className="ld-no ld-no-prof"><i><Scissors size={22} /></i><strong>Profissional</strong><span>origem e histórico guardados</span></div>
              </div>
              <div className="ld-conecta-baixo">
              <div className="ld-conecta-foto ld-rv"><Foto nome="cliente" alt="Cliente escolhendo data e horário no celular com a profissional, no balcão do salão" /></div>
              <div className="ld-conecta-texto ld-rv">
                <p>Na MIMO, a cliente não precisa entrar em um marketplace genérico para procurar seu salão.</p>
                <p>Ela pode chegar pelo seu QR Code, link, convite ou por uma profissional do salão. A MIMO registra essa origem e mantém o relacionamento organizado dentro do contexto correto.</p>
                <p className="ld-sub">Uma cliente pode conhecer vários negócios. Cada relação continua sendo independente.</p>
              </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- PARA SALÕES ---------- */}
        <section id="saloes">
          <div className="ld-wrap">
            <Cabeca kicker="Para salões" titulo={['O salão vê a operação inteira.', 'Cada profissional vê o que precisa.']}>
              O salão configura equipe, serviços, horários, vínculos e regras. Cada profissional pode ter sua própria agenda dentro da estrutura do salão, sem perder a visão geral da operação.
            </Cabeca>
            <div className="ld-rv"><MockDesktop /></div>
            <div className="ld-quatro">
              {[[LayoutGrid, 'Agenda geral', 'Veja todo o salão em uma única tela.'], [UserRound, 'Agenda por profissional', 'Cada pessoa com seus próprios horários e serviços.'], [PauseCircle, 'Bloqueios e pausas', 'Almoço, folga, férias ou horário indisponível.'], [CalendarPlus, 'Encaixes', 'Aproveite horários livres sem bagunçar a agenda.']].map(([Ic, t, d], i) => (
                <article className="ld-mini ld-rv" key={t} style={{ transitionDelay: `${i * 60}ms` }}><Ic size={20} /><h3>{t}</h3><p>{d}</p></article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- EQUIPE E VÍNCULOS ---------- */}
        <section className="ld-alt">
          <div className="ld-wrap ld-duas">
            <div>
              <Cabeca kicker="Equipe e vínculos" titulo={['Cada profissional trabalha de um jeito.', 'A MIMO acompanha isso.']}>
                O salão cadastra a profissional e define como ela trabalha dentro da operação. Serviços, horários, agenda e permissões são configurados pelo próprio salão.
              </Cabeca>
              <div className="ld-vinculos ld-rv">
                {VINCULOS.map((v) => <span className="ld-chip" key={v}>{v}</span>)}
              </div>
              <p className="ld-sub ld-rv">O tipo de vínculo funciona como uma configuração inicial. O salão continua podendo ajustar horários, serviços e permissões individualmente.</p>
            </div>
            <div className="ld-rv"><MockProfissional /></div>
          </div>
          <div className="ld-wrap">
            <figure className="ld-faixa ld-rv">
              <Foto nome="equipe" alt="Dona do salão e duas profissionais olhando a agenda no tablet" />
              <figcaption>Cada uma com a sua agenda. O salão com a visão geral.</figcaption>
            </figure>
          </div>
        </section>

        {/* ---------- CLIENTES E RETORNO ---------- */}
        <section>
          <div className="ld-wrap ld-duas ld-duas-inv">
            <div className="ld-rv"><MockRetorno /></div>
            <div>
              <Cabeca kicker="Clientes e retorno" titulo={['A agenda termina.', 'O relacionamento continua.']}>
                A MIMO ajuda o salão a lembrar quem deveria voltar, quem está há muito tempo sem atendimento e quem já tem histórico com determinada profissional.
              </Cabeca>
              <ul className="ld-checks ld-rv"><li>Manutenção no prazo certo</li><li>Recorrência sem depender da memória</li><li>Histórico por profissional e por serviço</li><li>Retenção que vira ação, não relatório</li></ul>
            </div>
          </div>
        </section>

        {/* ---------- LISTA DE ESPERA ---------- */}
        <section className="ld-alt">
          <div className="ld-wrap ld-duas">
            <div>
              <Cabeca kicker="Lista de espera" titulo={['Cancelou?', 'A vaga não precisa morrer junto.']}>
                Quando um horário fica livre, a MIMO ajuda o salão a encontrar clientes da lista de espera que combinam com aquele serviço, profissional e período.
              </Cabeca>
            </div>
            <div className="ld-rv"><MockEspera /></div>
          </div>
        </section>

        {/* ---------- WHATSAPP ---------- */}
        <section>
          <div className="ld-wrap ld-duas ld-duas-inv">
            <div className="ld-rv"><MockWhats /></div>
            <div>
              <Cabeca kicker="WhatsApp" titulo={['O WhatsApp continua sendo WhatsApp.', 'Só deixa de ser bagunça.']}>
                Confirmação, lembrete, cancelamento, reagendamento e retorno acompanham o contexto real da agenda. A conversa não precisa ficar desconectada do atendimento.
              </Cabeca>
            </div>
          </div>
        </section>

        {/* ---------- PAGAMENTOS ---------- */}
        <section className="ld-alt">
          <div className="ld-wrap ld-duas">
            <div>
              <Cabeca kicker="Pagamentos" titulo={['Agenda e pagamento', 'falando a mesma língua.']}>
                Quando habilitado pelo salão, o agendamento pode trabalhar com sinal ou pagamento completo. O status financeiro fica ligado ao próprio atendimento.
              </Cabeca>
            </div>
            <div className="ld-rv"><MockPagamento /></div>
          </div>
        </section>

        {/* ---------- QR ---------- */}
        <section>
          <div className="ld-wrap ld-duas ld-duas-inv">
            <div className="ld-rv"><MockQr /></div>
            <div>
              <Cabeca kicker="QR Code" titulo={['Do balcão para a agenda', 'em segundos.']}>
                Coloque o QR da MIMO no balcão, espelho, cartão, panfleto ou Instagram. A cliente escaneia, entra no ambiente do salão e começa o agendamento.
              </Cabeca>
              <div className="ld-categorias ld-categorias-esq ld-rv" aria-hidden="true">
                {CATEGORIAS.map(([Ic, n]) => <span key={n}><i><Ic size={24} /></i>{n}</span>)}
              </div>
            </div>
          </div>
        </section>

        {/* ---------- DIFERENCIAL ---------- */}
        <section className="ld-manifesto">
          <div className="ld-wrap ld-manifesto-grade">
            <div className="ld-rv">
              <span className="ld-kicker">O que a MIMO acredita</span>
              <h2>A MIMO não quer tomar sua cliente. Quer ajudar você a cuidar melhor da relação.</h2>
              <p>Clientes não são propriedade de uma plataforma. Por isso a MIMO separa identidade, vínculo e origem.</p>
              <div className="ld-nota">Se uma cliente chegou pelo seu salão ou por uma profissional da sua equipe, essa informação continua registrada.</div>
            </div>
            <blockquote className="ld-citacao ld-rv">
              Beleza, <em>organização</em> e relacionamento. Não é software de contador.
              <Coracao className="ld-citacao-coracao" />
            </blockquote>
          </div>
        </section>

        <section className="ld-parede">
          <div className="ld-wrap">
            <Cabeca kicker="A cara da casa" titulo={['Na parede do salão.']} centro>A MIMO fala como o salão fala: direto, com carinho e sem cara de planilha.</Cabeca>
            <div className="ld-cartazes">
              {CARTAZES.map((c, i) => (
                <article className={`ld-cartaz ld-cz-${c.tom} ld-rv`} key={i} style={{ '--gira': `${c.gira}deg`, transitionDelay: `${i * 80}ms` }}>
                  <h3>{c.titulo.map((l, k) => <span key={k} className={l.startsWith('*') ? 'ld-cz-destaque' : ''}>{l.replace(/^\*/, '')}</span>)}</h3>
                  <p>{c.sub}</p>
                  <Coracao className="ld-cz-coracao" />
                  <div className="ld-cz-rodape">
                    <MarcaCartaz />
                    <span className="ld-bilhete ld-cz-bilhete">{c.bilhete} <i>♥</i></span>
                  </div>
                  <div className="ld-cz-icones">{CATEGORIAS.map(([Ic, n]) => <span key={n}><Ic size={18} />{n}</span>)}</div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- PARA AUTÔNOMAS ---------- */}
        <section id="autonomas" className="ld-alt">
          <div className="ld-wrap ld-duas">
            <div>
              <Cabeca kicker="Para autônomas" titulo={['Trabalha sozinha?', 'Você não precisa de um sistema gigante.']}>
                A profissional autônoma encontra na MIMO o essencial para organizar serviços, horários e clientes. Sem menus de equipe que ela não usa. Sem pagar por estrutura que não precisa.
              </Cabeca>
              <div className="ld-profissoes ld-rv" aria-label="Para quem é">
                <span className="ld-profissoes-titulo">Feita para</span>
                {PROFISSOES.map((p) => <span className="ld-chip" key={p}>{p}</span>)}
              </div>
            </div>
            <div className="ld-auto-foto ld-rv"><Foto nome="agenda-celular" alt="Dois celulares com a agenda do dia e a lista de serviços da MIMO" /></div>
          </div>
          <div className="ld-wrap">
            <article className="ld-plano ld-plano-leve ld-plano-faixa ld-rv">
              <div>
                <span className="ld-pilula">Plano Autônoma</span>
                <div className="ld-preco">R$ 0 <small>/mês</small></div>
                <p>O essencial, de graça, sem cartão.</p>
              </div>
              <ul className="ld-checks ld-checks-2col"><li>Agenda</li><li>Serviços</li><li>Horários</li><li>Clientes</li><li>Histórico</li><li>QR</li><li>Link próprio</li><li>Retorno</li></ul>
              <a className="ld-btn ld-primario" href={comecar('autonoma')}>Criar agenda grátis</a>
            </article>
          </div>
        </section>

        {/* ---------- FUNCIONALIDADES ---------- */}
        <section id="funcionalidades">
          <div className="ld-wrap">
            <Cabeca kicker="Funcionalidades" titulo={['Tudo o que a rotina pede,', 'agrupado do jeito que ela acontece.']} centro />
            <figure className="ld-faixa ld-faixa-alta ld-rv">
              <Foto nome="painel" alt="Notebook com o painel do salão e celular com o app da cliente, sobre a bancada" />
              <figcaption>O salão no PC, a profissional e a cliente no celular.</figcaption>
            </figure>
            <div className="ld-grupos">
              {GRUPOS.map(({ Icone, nome, itens }, i) => (
                <article className="ld-grupo ld-rv" key={nome} style={{ transitionDelay: `${i * 50}ms` }}>
                  <div className="ld-grupo-topo"><div className="ld-ico"><Icone size={20} /></div><h3>{nome}</h3></div>
                  <ul>{itens.map((it) => <li key={it}>{it}</li>)}</ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- PLANOS ---------- */}
        <section id="planos" className="ld-alt">
          <div className="ld-wrap">
            <Cabeca kicker="Planos" titulo={['Preço que o salão entende', 'sem pedir orçamento.']} centro>Você paga pelas agendas profissionais que realmente utiliza.</Cabeca>
            <div className="ld-planos">
              <article className="ld-plano ld-rv">
                <span className="ld-pilula">Autônoma</span>
                <h3>Grátis</h3>
                <div className="ld-preco">R$ 0 <small>/mês</small></div>
                <p>Para quem trabalha por conta própria.</p>
                <ul className="ld-checks"><li>1 agenda profissional</li><li>Clientes</li><li>Serviços</li><li>Horários</li><li>QR e link</li></ul>
                <a className="ld-btn ld-fantasma" href={comecar('autonoma')}>Criar agenda grátis</a>
              </article>
              <article className="ld-plano ld-quente ld-rv">
                <span className="ld-etiqueta">feito para crescer</span>
                <span className="ld-pilula">Salão</span>
                <h3>MIMO Pro</h3>
                <div className="ld-preco">R$ 49,90 <small>/mês</small></div>
                <p>+ R$ 9,90 por profissional ativa na agenda.</p>
                <ul className="ld-checks"><li>Equipe e várias agendas</li><li>Agenda geral, comanda e repasses</li><li>Lista de espera e WhatsApp</li><li>Sinal e pagamentos</li><li>Avaliações e projeção da semana</li></ul>
                <a className="ld-btn ld-primario" href={comecar('salao')}>Criar meu salão</a>
              </article>
            </div>
          </div>
        </section>

        {/* ---------- CONTEÚDO ---------- */}
        <section id="conteudos">
          <div className="ld-wrap">
            <Cabeca kicker="Conteúdos" titulo={['O que a dona do salão', 'já está perguntando.']}>Guias curtos, ligados à rotina. Sem blog genérico.</Cabeca>
            <div className="ld-artigos">
              {ARTIGOS.map(([tag, t, d], i) => (
                <article className="ld-artigo ld-rv" key={t} style={{ transitionDelay: `${i * 60}ms` }}><small>{tag}</small><h3>{t}</h3><p>{d}</p><span className="ld-embreve">Em breve</span></article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section id="duvidas" className="ld-alt">
          <div className="ld-wrap">
            <Cabeca kicker="Perguntas frequentes" titulo={['Dúvidas sobre a MIMO']} centro />
            <div className="ld-faq">
              {FAQ.map(([q, a], i) => (
                <details className="ld-rv" key={q} style={{ transitionDelay: `${i * 40}ms` }}>
                  <summary>{q}<ChevronDown size={18} /></summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- CTA ---------- */}
        <section>
          <div className="ld-wrap">
            <div className="ld-cta ld-rv">
              <div>
                <h2>A agenda é só o começo. A relação é o produto.</h2>
                <p>A MIMO organiza o dia do salão, preserva o vínculo com a cliente e transforma operação em relacionamento. Construída e testada junto à rotina real de profissionais de beleza.</p>
                <div className="ld-cta-lado">
                  <a className="ld-btn ld-branco ld-grande" href={comecar()}>Começar agora <ArrowRight size={18} /></a>
                  <span className="ld-bilhete ld-bilhete-cta">esse é só o começo <i>♥</i></span>
                </div>
              </div>
              <div className="ld-cta-foto"><Foto nome="lifestyle" alt="Bancada de beleza com pincéis, esmaltes e o app MIMO no celular" /></div>
            </div>
          </div>
        </section>
      </main>

      <footer className="ld-pe">
        <div className="ld-wrap ld-pe-in">
          <div>
            <Logo altura={44} />
            <p>Beleza, organização e relacionamento.</p>
          </div>
          <nav className="ld-pe-links" aria-label="Rodapé">
            <Link to="/termos">Termos de uso</Link>
            <Link to="/privacidade">Privacidade</Link>
            <a href={`mailto:${EMAIL_CONTATO}`}>Contato</a>
            <Link to="/entrar">Sou cliente</Link>
            <a href={entrar}>Sou profissional</a>
          </nav>
          <div className="ld-pe-fim">mimo.com.vc<br />© {new Date().getFullYear()} Tedesco Softwares</div>
        </div>
      </footer>
    </div>
  )
}

/* ============================================================
   Os mocks: o produto, em HTML e CSS. Nada de número inventado.
   ============================================================ */

// herói: o celular grande com a agenda de hoje e três avisos ao redor
function PalcoCelular() {
  const hoje = [
    ['09:00', 'Escova + hidratação', 'Camila · com Ana', 'ok'],
    ['11:30', 'Manutenção em gel', 'Juliana · com Bia', 'ok'],
    ['14:30', 'Escova', 'Melissa · com Ana', 'proximo'],
    ['16:30', 'Horário livre', 'oferecer à lista de espera', 'livre'],
    ['17:30', 'Coloração', 'Fernanda · com Carla', 'pedido'],
  ]
  return (
    <div className="ld-palco" aria-label="Profissional de beleza mostrando a MIMO no celular">
      <div className="ld-halo" aria-hidden="true" />
      <div className="ld-hero-foto"><Foto nome="profissional" alt="Profissional de beleza sorrindo no salão, com o app MIMO aberto no celular" prioridade /></div>
      <div className="ld-cel">
        <div className="ld-cel-tela">
          <div className="ld-cel-status"><span>9:41</span><span>●●●</span></div>
          <div className="ld-cel-topo">
            <div><small>Quarta, 23 de setembro</small><strong>Hoje no salão</strong></div>
            <MarcaIcon width={26} height={23} id="ld-cel" />
          </div>
          <div className="ld-cel-dias">{['S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => <span key={i} className={i === 2 ? 'on' : ''}>{d}<b>{21 + i}</b></span>)}</div>
          <div className="ld-cel-lista">
            {hoje.map(([h, s, q, st], i) => (
              <div className={`ld-cel-item ${st}`} key={i} style={{ animationDelay: `${0.3 + i * 0.12}s` }}>
                <span className="ld-cel-hora">{h}</span>
                <div><b>{s}</b><small>{q}</small></div>
                {st === 'ok' && <em>confirmado</em>}
                {st === 'proximo' && <em>próximo</em>}
                {st === 'pedido' && <em>aceitar?</em>}
                {st === 'livre' && <em>vaga</em>}
              </div>
            ))}
          </div>
          <div className="ld-cel-barra"><span className="on"><CalendarDays size={18} /></span><span><Users size={18} /></span><span><Bell size={18} /></span><span><Wallet size={18} /></span></div>
        </div>
      </div>
      <div className="ld-aviso ld-av-1" aria-hidden="true"><RotateCcw size={16} /><div><strong>3 clientes para retornar</strong><span>Camila, Juliana e Paula passaram do prazo</span></div></div>
      <div className="ld-aviso ld-av-2" aria-hidden="true"><Clock size={16} /><div><strong>1 horário ficou disponível</strong><span>16:30 com Ana · 2 na lista de espera</span><b>Preencher</b></div></div>
      <div className="ld-aviso ld-av-3" aria-hidden="true"><Bell size={16} /><div><strong>Próximo atendimento</strong><span>14:30 • Escova • Melissa</span></div></div>
    </div>
  )
}

// para salões: a agenda geral do PC, com a equipe na lateral
const COLUNAS = [
  { nome: 'Ana', cor: 'a', cartoes: [[0, 2, 'Escova + hidratação', 'Camila', 'ok'], [3, 2, 'Coloração', 'Fernanda', 'ok'], [6, 1, 'Corte', 'Lívia', 'pedido']] },
  { nome: 'Bia', cor: 'b', cartoes: [[1, 1, 'Manicure', 'Juliana', 'ok'], [2, 1, 'Pedicure', 'Juliana', 'ok'], [4, 2, 'Alongamento em gel', 'Renata', 'ok']] },
  { nome: 'Carla', cor: 'c', cartoes: [[0, 1, 'Sobrancelha', 'Paula', 'ok'], [2, 2, 'Lash lifting', 'Marina', 'ok'], [5, 2, 'Design + henna', 'Talita', 'ok']] },
]
const HORAS = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30']

function MockDesktop() {
  return (
    <div className="ld-desk">
      <div className="ld-desk-barra"><i /><i /><i /><span>pro.mimo.com.vc/admin/pdv</span></div>
      <div className="ld-desk-corpo">
        <aside className="ld-desk-lateral">
          <div className="ld-desk-marca"><MarcaIcon width={22} height={19} id="ld-desk" /> Studio Essenza</div>
          {[['Agenda geral', true], ['Comanda', false], ['Projeção', false], ['Equipe', false], ['Clientes', false], ['Serviços', false], ['Horários', false], ['Repasses', false]].map(([n, on]) => <span key={n} className={on ? 'on' : ''}>{n}</span>)}
          <div className="ld-desk-equipe">
            <small>Equipe hoje</small>
            {COLUNAS.map((c) => <span key={c.nome} className={`ld-col-${c.cor}`}><i>{c.nome[0]}</i>{c.nome}<em>★ 4,9</em></span>)}
          </div>
        </aside>
        <div className="ld-quadro ld-quadro-desk">
          <div className="ld-quadro-topo">
            <div><small>Quarta, 23 de setembro</small><strong>Agenda geral</strong></div>
            <div className="ld-quadro-abas"><b className="on">Quadro</b><b>Comanda</b><b>Projeção</b></div>
          </div>
          <div className="ld-quadro-numeros">
            <div><strong>11</strong><span>atendimentos hoje</span></div>
            <div><strong>2</strong><span>horários vagos</span></div>
            <div><strong>1</strong><span>pedido para aceitar</span></div>
          </div>
          <div className="ld-quadro-grade">
            <div className="ld-quadro-horas">{HORAS.map((h) => <span key={h}>{h}</span>)}</div>
            {COLUNAS.map((c) => (
              <div className={`ld-quadro-col ld-col-${c.cor}`} key={c.nome}>
                <div className="ld-quadro-prof"><i>{c.nome[0]}</i>{c.nome}<span>★ 4,9</span></div>
                <div className="ld-quadro-pista">
                  {c.cartoes.map(([ini, dur, serv, cli, st], k) => (
                    <div className={`ld-cartao ${st}`} key={k} style={{ top: `${ini * 12.5}%`, height: `calc(${dur * 12.5}% - 4px)`, animationDelay: `${0.2 + k * 0.1}s` }}>
                      <b>{serv}</b><span>{cli}</span>
                      {st === 'pedido' && <em>confirmar?</em>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// equipe: o cadastro da profissional, passo a passo
function MockProfissional() {
  return (
    <div className="ld-form">
      <div className="ld-form-topo"><div className="ld-form-foto">M</div><div><strong>Melissa Andrade</strong><small>(13) 99999-0000 · cabeleireira</small></div><span className="ld-chip ld-chip-ok">ativa</span></div>
      <div className="ld-form-bloco"><small>1 · Tipo de vínculo</small><div className="ld-form-chips">{VINCULOS.map((v, i) => <span key={v} className={i === 0 ? 'on' : ''}>{v}</span>)}</div></div>
      <div className="ld-form-bloco"><small>2 · Serviços</small><div className="ld-form-chips">{[['Escova', true], ['Hidratação', true], ['Coloração', true], ['Corte', true], ['Manicure', false], ['Sobrancelha', false]].map(([s, on]) => <span key={s} className={on ? 'on' : ''}>{on && <Check size={12} />}{s}</span>)}</div></div>
      <div className="ld-form-bloco"><small>3 · Horários</small><div className="ld-form-horas">{[['Seg', '9–18'], ['Ter', '9–18'], ['Qua', 'folga'], ['Qui', '9–18'], ['Sex', '9–20'], ['Sáb', '8–16']].map(([d, h]) => <span key={d} className={h === 'folga' ? 'folga' : ''}><b>{d}</b>{h}</span>)}</div></div>
      <div className="ld-form-bloco"><small>4 · Permissões</small><div className="ld-form-perm">{[['Ver a própria agenda', true], ['Aceitar pedidos de horário', true], ['Fechar comanda', false], ['Ver a agenda das colegas', false]].map(([p, on]) => <span key={p}><i className={on ? 'on' : ''} />{p}</span>)}</div></div>
      <div className="ld-form-pe"><span className="ld-btn ld-primario">Salvar e enviar o link da equipe</span></div>
    </div>
  )
}

// clientes: quem deveria voltar
function MockRetorno() {
  return (
    <div className="ld-retorno">
      <div className="ld-retorno-resumo"><RotateCcw size={18} /><strong>3 clientes para retornar hoje</strong></div>
      <article className="ld-retorno-carta">
        <div className="ld-avatar">C</div>
        <div><strong>Camila</strong><small>Último atendimento: 32 dias</small><small>Serviço: manutenção em gel · com Bia</small></div>
        <span className="ld-btn ld-whats"><MessageCircle size={14} /> Chamar no WhatsApp</span>
      </article>
      <article className="ld-retorno-carta">
        <div className="ld-avatar b">J</div>
        <div><strong>Juliana</strong><small>Retorno sugerido esta semana</small><small>Último serviço: coloração · com Ana</small></div>
        <span className="ld-chip">manutenção</span>
      </article>
      <article className="ld-retorno-carta apagada">
        <div className="ld-avatar c">P</div>
        <div><strong>Paula</strong><small>Último atendimento: 47 dias</small><small>Sobrancelha · com Carla</small></div>
        <span className="ld-chip">sumida</span>
      </article>
    </div>
  )
}

// lista de espera: a vaga que abriu e quem cabe nela
function MockEspera() {
  return (
    <div className="ld-espera">
      <div className="ld-espera-topo"><Ban size={16} /><div><strong>16:30 ficou disponível</strong><small>Renata cancelou · manicure com Bia</small></div></div>
      <small className="ld-espera-rotulo">Possíveis clientes</small>
      {[['Mariana', 'quer manicure', '15h–18h', 'M'], ['Carla', 'quer manicure', '16h–19h', 'C']].map(([n, q, f, l]) => (
        <div className="ld-espera-item" key={n}><div className="ld-avatar">{l}</div><div><strong>{n}</strong><small>{q} · {f}</small></div><Check size={16} /></div>
      ))}
      <span className="ld-btn ld-primario ld-espera-btn">Preencher horário</span>
    </div>
  )
}

// whatsapp: a mensagem com o contexto do atendimento
function MockWhats() {
  return (
    <div className="ld-whats-caixa">
      <div className="ld-whats-topo"><div className="ld-avatar">C</div><div><strong>Camila</strong><small>online</small></div></div>
      <div className="ld-whats-balao">
        <p>Oi, Camila 💗</p>
        <p>Seu horário no <b>Studio Essenza</b> é amanhã às <b>14h</b>.</p>
        <p><small>Serviço</small>Escova + hidratação</p>
        <p><small>Profissional</small>Melissa</p>
        <span className="ld-whats-hora">18:02 ✓✓</span>
      </div>
      <div className="ld-whats-acoes"><span>Confirmar</span><span>Reagendar</span></div>
      <div className="ld-whats-balao ld-whats-resposta"><p>Confirmado! Até amanhã 💗</p><span className="ld-whats-hora">18:05</span></div>
      <div className="ld-whats-nota"><Send size={14} /> A resposta cai direto na agenda: o horário fica confirmado sozinho.</div>
    </div>
  )
}

// pagamentos: sinal e restante ligados ao atendimento
function MockPagamento() {
  return (
    <div className="ld-pag">
      <div className="ld-pag-topo"><div><small>Sábado, 27 · 10:00</small><strong>Coloração + corte</strong><small>Fernanda · com Ana</small></div><span className="ld-chip ld-chip-ok">sinal pago</span></div>
      <div className="ld-pag-linhas">
        <div><span>Serviço</span><b>R$ 180</b></div>
        <div className="ld-pag-sinal"><span>Sinal <small>pago por Pix</small></span><b>R$ 50</b></div>
        <div><span>Restante <small>no salão, ao fechar</small></span><b>R$ 130</b></div>
      </div>
      <div className="ld-pag-barra"><i style={{ width: '28%' }} /></div>
      <div className="ld-pag-pe"><Receipt size={14} /> O status financeiro fica no próprio atendimento, e na comanda quando o dia fecha.</div>
    </div>
  )
}

// qr: a foto do balcão, com os lugares onde a plaquinha cabe
function MockQr() {
  return (
    <div className="ld-qr-cena">
      <Foto nome="qr" alt="Cliente apontando a câmera do celular para a plaquinha com o QR da MIMO no balcão do salão" />
      <div className="ld-qr-onde">
        {[[MapPin, 'Balcão'], [Eye, 'Espelho'], [QrCode, 'Cartão'], [Star, 'Instagram']].map(([Ic, n]) => <span key={n}><Ic size={16} />{n}</span>)}
      </div>
    </div>
  )
}
