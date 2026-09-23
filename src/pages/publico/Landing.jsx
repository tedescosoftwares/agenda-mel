import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays, Users, Heart, RotateCcw, MessageCircle, Wallet, QrCode, Clock, Star,
  Check, Menu, X, ArrowRight, Sparkles, LayoutGrid, Receipt, ChevronDown, Hand, Scissors, Palette, Eye, Flower2,
} from 'lucide-react'
import { MarcaIcon, Wordmark } from '../../components/icons'
import { urlDoAmbiente } from '../../lib/ambiente'
import { EMAIL_CONTATO } from '../../lib/termos'
import '../../landing.css'

// A porta da rua: mimo.com.vc para quem ainda não é de casa. Fala com a
// dona do salão e com a profissional autônoma; a cliente entra pelo
// código de quem a chamou (o link "Sou cliente" leva lá).
// Os botões de começar apontam para o ambiente pro, onde o cadastro vive.

const TITULO = 'MIMO | Sistema para salão de beleza, agenda online e gestão de equipe'
const DESCRICAO = 'Agenda online, equipe, clientes, WhatsApp, avaliações, sinal por Pix e repasses num só lugar. Para salões e profissionais autônomas. Autônoma grátis.'

const RECURSOS = [
  { Icone: LayoutGrid, titulo: 'Quadro do dia', texto: 'Cada profissional numa coluna, cada horário num cartão. Arraste para remarcar, confirme com um clique e veja o dia inteiro sem abrir menu.', tag: 'AGENDA DO SALÃO' },
  { Icone: Users, titulo: 'Equipe e vínculo', texto: 'Cadastre a profissional, defina serviços, horários e a regra de repasse. Ela recebe o app dela pelo link da equipe.', tag: 'GESTÃO DE EQUIPE' },
  { Icone: Receipt, titulo: 'Comanda e repasse', texto: 'A visita vira uma comanda só, mesmo com duas profissionais. No fechamento, o sistema já separa o que é de quem.', tag: 'FINANCEIRO' },
  { Icone: MessageCircle, titulo: 'WhatsApp no contexto', texto: 'Confirmação, lembrete, cancelamento, remarcação e retorno saem ligados ao horário certo, não a uma conversa solta.', tag: 'AUTOMAÇÃO' },
  { Icone: Wallet, titulo: 'Sinal por Pix', texto: 'Sinal fixo ou por porcentagem na hora de marcar. O horário só segura quando o Pix entra, e o restante fecha no salão.', tag: 'PAGAMENTO' },
  { Icone: QrCode, titulo: 'QR e link próprios', texto: 'A cliente entra pelo seu QR, pelo balcão ou pelo link da profissional. O vínculo já nasce sabendo de onde ela veio.', tag: 'AQUISIÇÃO' },
  { Icone: Clock, titulo: 'Lista de espera', texto: 'Cancelou? A vaga é oferecida a quem estava esperando aquele serviço, aquela profissional, aquele horário.', tag: 'OCUPAÇÃO' },
  { Icone: RotateCcw, titulo: 'Retorno de clientes', texto: 'Quem está sumida, quem tem manutenção vencendo e quem faz aniversário aparecem como ação, não como relatório.', tag: 'FIDELIZAÇÃO' },
  { Icone: Star, titulo: 'Avaliações reais', texto: 'A cliente avalia cada serviço depois do atendimento. A nota fica com a profissional e aparece no quadro na hora.', tag: 'REPUTAÇÃO' },
]

const FAQ = [
  ['A MIMO serve para salão com várias profissionais?', 'Sim. O salão cadastra as profissionais, define serviços, horários e agendas individuais, e enxerga tudo num quadro só. Cada profissional tem o app dela para ver os próprios horários.'],
  ['A profissional autônoma paga mensalidade?', 'Não. A conta de autônoma é gratuita: uma agenda, serviços, horários, clientes, QR e link próprios.'],
  ['Quem configura a agenda da profissional que trabalha no salão?', 'O próprio salão. Ele define vínculo, serviços, horários e a regra de repasse. A profissional entra pelo link da equipe e já encontra tudo pronto.'],
  ['A cliente precisa procurar meu salão num marketplace?', 'Não. Ninguém entra na MIMO do nada: a cliente chega pelo seu QR, código ou link, e passa a ver só a agenda de quem a chamou.'],
  ['Dá para cobrar sinal por Pix?', 'Dá. Você escolhe sinal fixo ou porcentagem do serviço. O horário fica reservado enquanto o Pix não entra e o restante é cobrado no salão ao fechar a comanda.'],
  ['Precisa baixar aplicativo na loja?', 'Não. A MIMO funciona pelo navegador e pode ser adicionada à tela inicial do celular, com aviso e tudo, como um aplicativo instalado.'],
]

const PROFISSOES = ['manicure', 'cabeleireira', 'lash designer', 'designer de sobrancelhas', 'maquiadora', 'barbeira', 'esteticista', 'nail designer', 'trancista', 'depiladora', 'colorista', 'massoterapeuta']

const PASSOS = [
  ['Escolha o perfil', 'Salão com equipe ou profissional autônoma. Leva dez segundos e muda só o que você vê depois.'],
  ['Cadastre os serviços', 'Nome, preço e duração. Para o salão, quem executa cada um.'],
  ['Monte a equipe e os horários', 'Cada profissional entra pelo link da equipe e já cai na agenda certa.'],
  ['Compartilhe o QR', 'A cliente escaneia, cria a conta vinculada a você e marca sozinha.'],
]

const CATEGORIAS = [[Hand, 'unhas'], [Scissors, 'cabelo'], [Palette, 'make'], [Eye, 'sobrancelha'], [Flower2, 'estética']]

// os cartazes da parede: frases do nicho, no tom das artes da marca
const CARTAZES = [
  { tom: 'rosa', gira: -2, titulo: ['Cadeira', 'vazia', '*custa caro.'], sub: 'A lista de espera preenche a vaga que abriu.', bilhete: 'agenda cheia' },
  { tom: 'creme', gira: 1.5, titulo: ['Sua cliente', '*marca', 'sozinha.'], sub: 'Pelo seu QR, no horário que você abriu.', bilhete: 'sem WhatsApp às 23h' },
  { tom: 'preto', gira: -1, titulo: ['Mani?', 'Escova?', 'Cílios?', '*Fecha junto.'], sub: 'Uma comanda só. O repasse já sai separado.', bilhete: 'o que é de quem' },
  { tom: 'rosa-2', gira: 2, titulo: ['Avaliação', 'na hora.', '*Nota no quadro.'], sub: 'Cada serviço, cada profissional.', bilhete: 'cinco estrelas' },
]

const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', '@id': 'https://mimo.com.vc/#organization', name: 'MIMO', url: 'https://mimo.com.vc/', logo: 'https://mimo.com.vc/pwa-512.png', description: 'Plataforma de agenda, operação e relacionamento para negócios de beleza.' },
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

  return (
    <div className="ld" ref={raiz}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      <header className="ld-nav">
        <div className="ld-wrap ld-nav-in">
          <a href="#topo" className="ld-logo" aria-label="MIMO, início"><MarcaIcon width={34} height={30} id="ld" /><Wordmark tamanho={1.7} /></a>
          <nav className="ld-links" aria-label="Seções">
            <a href="#saloes">Salões</a><a href="#autonomas">Autônomas</a><a href="#recursos">Recursos</a><a href="#como-funciona">Como funciona</a><a href="#planos">Planos</a><a href="#duvidas">Dúvidas</a>
          </nav>
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
            <a href="#saloes">Salões</a><a href="#autonomas">Autônomas</a><a href="#recursos">Recursos</a><a href="#como-funciona">Como funciona</a><a href="#planos">Planos</a><a href="#duvidas">Dúvidas</a>
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
        <section className="ld-hero">
          <div className="ld-wrap ld-hero-grade">
            <div className="ld-hero-texto">
              <span className="ld-selo"><Sparkles size={14} /> Sistema para salão de beleza e profissional autônoma</span>
              <h1>Beleza daqui.<span>Rotina no lugar.</span></h1>
              <Coracao className="ld-hero-coracao" />
              <p className="ld-lead">A MIMO junta agenda, equipe, clientes, WhatsApp, avaliações e pagamentos numa tela com cara de salão, não de escritório. Você abre e já sabe o que fazer agora.</p>
              <div className="ld-hero-cta">
                <a className="ld-btn ld-primario ld-grande" href={comecar('salao')}>Criar meu salão <ArrowRight size={18} /></a>
                <a className="ld-btn ld-fantasma ld-grande" href={comecar('autonoma')}>Sou autônoma: começar grátis</a>
                <span className="ld-bilhete ld-bilhete-hero">sua cliente marca sozinha <i>♥</i></span>
              </div>
              <ul className="ld-prova">
                <li><i><Check size={12} /></i> Autônoma grátis, sem cartão</li>
                <li><i><Check size={12} /></i> Salão com várias agendas num quadro só</li>
                <li><i><Check size={12} /></i> Sem loja de aplicativo: abre no celular</li>
              </ul>
            </div>
            <Palco />
          </div>
        </section>

        <div className="ld-fita" aria-hidden="true">
          <div className="ld-fita-trilho">
            {[0, 1].map((k) => (
              <span key={k}>agenda <i>♥</i> equipe <i>♥</i> comanda <i>♥</i> repasses <i>♥</i> whatsapp <i>♥</i> pix <i>♥</i> avaliações <i>♥</i> lista de espera <i>♥</i></span>
            ))}
          </div>
        </div>

        <section className="ld-manifesto">
          <div className="ld-wrap ld-manifesto-grade">
            <div className="ld-rv">
              <span className="ld-kicker">A cara da MIMO</span>
              <h2>Feita para beleza de verdade, não para parecer software de escritório.</h2>
              <p>A rotina de um salão tem cliente atrasada, encaixe de última hora, profissional com horário diferente, WhatsApp tocando e uma cadeira vazia que custa dinheiro. A MIMO fala essa língua.</p>
              <div className="ld-nota">Pessoas primeiro, painel depois. O bonito aqui serve a operação.</div>
            </div>
            <blockquote className="ld-citacao ld-rv">
              Seu salão não precisa de mais <em>um sistema</em>. Precisa de uma rotina que finalmente <em>faça sentido</em>.
              <Coracao className="ld-citacao-coracao" />
            </blockquote>
          </div>
        </section>

        <section>
          <div className="ld-wrap">
            <div className="ld-cabeca ld-rv">
              <span className="ld-kicker">O problema real</span>
              <h2>O salão não sofre por falta de aplicativo. Sofre porque a operação fica espalhada.</h2>
              <p>Agenda num lugar, conversa noutro, comissão numa planilha, retorno na memória e cancelamento virando cadeira vazia. A MIMO nasce para ligar essas pontas.</p>
            </div>
            <div className="ld-dor">
              <article className="ld-painel ld-rv">
                <h3>Quando tudo depende de WhatsApp, caderno e memória</h3>
                <ul>
                  <li>Horários se perdem entre mensagens e encaixes.</li>
                  <li>Cliente cancela e o buraco fica vazio.</li>
                  <li>Cada profissional trabalha com uma regra diferente.</li>
                  <li>Quem deveria voltar some da rotina.</li>
                  <li>A dona precisa perguntar para saber o que está acontecendo.</li>
                </ul>
              </article>
              <article className="ld-painel ld-escuro ld-rv">
                <h3>Quando a operação conversa com a agenda</h3>
                <ul>
                  <li>A disponibilidade considera serviço, profissional, bloqueios e horários.</li>
                  <li>A lista de espera aproveita a vaga que acabou de abrir.</li>
                  <li>Cliente, salão e profissional mantêm o contexto da relação.</li>
                  <li>O WhatsApp recebe o evento certo, na hora certa.</li>
                  <li>O quadro aponta o que merece atenção agora.</li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section className="ld-parede">
          <div className="ld-wrap">
            <div className="ld-cabeca ld-centro ld-rv">
              <span className="ld-kicker">A cara da casa</span>
              <h2>Na parede do salão.</h2>
              <p>A MIMO fala como o salão fala: direto, com carinho e sem cara de planilha.</p>
            </div>
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
                  <div className="ld-cz-icones">
                    {CATEGORIAS.map(([Ic, n]) => <span key={n}><Ic size={18} />{n}</span>)}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="saloes" className="ld-alt">
          <div className="ld-wrap">
            <div className="ld-cabeca ld-rv">
              <span className="ld-kicker">Sistema para salão de beleza</span>
              <h2>Gestão de salão que começa pelo atendimento, não pelo administrativo.</h2>
              <p>Primeiro o que move o dia: pessoas, serviços, horários, clientes e relacionamento. Financeiro e repasse entram ligados ao atendimento, não como um ERP gigante.</p>
            </div>
            <div className="ld-identidade">
              {[['Clara', 'A dona abre e entende o dia sem caça ao tesouro em menu.'], ['Próxima', 'Texto humano, linguagem de salão, não de sistema.'], ['Bonita sem frescura', 'Visual forte e feminino. A beleza serve a operação.'], ['Relacional', 'Cliente, salão e profissional ligados sem apagar a origem de ninguém.']].map(([t, d], i) => (
                <div className={`ld-id-carta ld-rv ld-id-${i}`} key={t}><b>{t}</b><span>{d}</span></div>
              ))}
            </div>
            <div className="ld-recursos" id="recursos">
              {RECURSOS.map(({ Icone, titulo, texto, tag }, i) => (
                <article className={`ld-recurso ld-rv ld-rc-${i % 3}`} key={titulo} style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
                  <div className="ld-ico"><Icone size={22} /></div>
                  <h3>{titulo}</h3>
                  <p>{texto}</p>
                  <span className="ld-tag">{tag}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="ld-wrap ld-fluxo">
            <div className="ld-grudado ld-rv">
              <span className="ld-kicker">Operação do salão</span>
              <h3>A MIMO responde uma pergunta simples: “o que eu tenho que fazer agora?”</h3>
              <p>Em vez de um painel cheio de gráfico decorativo, ela traz para a frente as tarefas e os sinais da agenda.</p>
            </div>
            <ol className="ld-fluxo-lista">
              {[['Hoje', 'Quem vem, quem cancelou, quem pediu horário e onde sobrou vaga.'], ['Equipe', 'Quem atende, o que faz, em quais horários e com qual regra de repasse.'], ['Clientes', 'Quem entrou, quem voltou, quem sumiu e quem chegou pelo QR de qual profissional.'], ['Oportunidades', 'Vaga liberada, cliente na lista de espera, retorno próximo, horário ocioso.'], ['Recebimento', 'Sinal, comanda e repasse ligados ao atendimento, sem virar sistema contábil.']].map(([t, d], i) => (
                <li className="ld-fluxo-item ld-rv" key={t} style={{ transitionDelay: `${i * 60}ms` }}><span className="ld-num">{i + 1}</span><div><strong>{t}</strong><p>{d}</p></div></li>
              ))}
            </ol>
          </div>
        </section>

        <section id="autonomas" className="ld-alt">
          <div className="ld-wrap">
            <div className="ld-cabeca ld-centro ld-rv">
              <span className="ld-kicker">Agenda para profissional autônoma</span>
              <h2>Trabalha sozinha? A MIMO começa grátis, sem o peso de um sistema de salão.</h2>
              <p>Você precisa organizar serviços, horários, clientes e retorno. Não precisa de comissão de equipe, permissões e vinte menus que não usa.</p>
            </div>
            <div className="ld-publicos">
              <article className="ld-publico ld-rosa ld-rv">
                <span className="ld-pilula">Autônoma · grátis</span>
                <h3>Uma agenda profissional que cabe na rotina.</h3>
                <p>Serviços, horários, clientes, QR e link próprios. Sua cliente marca sozinha e você recebe o aviso no celular.</p>
                <ul className="ld-checks"><li>Agenda e horários</li><li>Serviços e preços</li><li>Clientes e histórico</li><li>QR e link próprios</li><li>Retorno e relacionamento</li></ul>
                <a className="ld-btn ld-fantasma" href={comecar('autonoma')}>Começar grátis</a>
              </article>
              <article className="ld-publico ld-rv">
                <span className="ld-pilula">Salão · MIMO Pro</span>
                <h3>Quando entra equipe, a MIMO cresce junto.</h3>
                <p>O mesmo motor passa a cuidar de profissionais, agendas individuais, comanda, lista de espera, sinal e repasse.</p>
                <ul className="ld-checks"><li>Equipe e agendas separadas</li><li>Vínculo e repasse por profissional</li><li>Quadro do dia e comanda</li><li>Avaliações e projeção da semana</li><li>Clientes e origem preservadas</li></ul>
                <a className="ld-btn ld-primario" href={comecar('salao')}>Criar meu salão</a>
              </article>
            </div>
            <div className="ld-categorias ld-rv" aria-hidden="true">
              {CATEGORIAS.map(([Ic, n]) => <span key={n}><i><Ic size={26} /></i>{n}</span>)}
            </div>
            <div className="ld-profissoes ld-rv" aria-label="Para quem é">
              <span className="ld-profissoes-titulo">Feita para</span>
              {PROFISSOES.map((p) => <span className="ld-chip" key={p}>{p}</span>)}
            </div>
          </div>
        </section>

        <section>
          <div className="ld-wrap">
            <div className="ld-cabeca ld-centro ld-rv">
              <span className="ld-kicker">Relacionamento</span>
              <h2>A cliente entra pelo seu salão. Não começa numa vitrine genérica.</h2>
              <p>O QR ou o link cria o caminho direto para o seu negócio. A origem fica guardada: dá para saber se ela veio do balcão, de uma profissional ou de uma campanha.</p>
            </div>
            <div className="ld-grafo ld-rv">
              <div className="ld-no"><strong>Cliente</strong><span>uma conta na MIMO</span></div>
              <span className="ld-seta" aria-hidden="true"><ArrowRight size={22} /></span>
              <div className="ld-no"><strong>Salão</strong><span>vínculo por QR, código ou link</span></div>
              <span className="ld-seta" aria-hidden="true"><ArrowRight size={22} /></span>
              <div className="ld-no"><strong>Profissional</strong><span>origem e histórico preservados</span></div>
            </div>
          </div>
        </section>

        <section id="como-funciona" className="ld-alt">
          <div className="ld-wrap">
            <div className="ld-cabeca ld-centro ld-rv">
              <span className="ld-kicker">Como funciona</span>
              <h2>Do cadastro à primeira agenda no ar.</h2>
              <p>O começo separa salão e autônoma logo de cara e pede só o necessário para colocar horários disponíveis.</p>
            </div>
            <ol className="ld-passos">
              {PASSOS.map(([t, d], i) => (
                <li className="ld-passo ld-rv" key={t} style={{ transitionDelay: `${i * 70}ms` }}><span className="ld-num">{i + 1}</span><h3>{t}</h3><p>{d}</p></li>
              ))}
            </ol>
          </div>
        </section>

        <section id="planos">
          <div className="ld-wrap">
            <div className="ld-cabeca ld-centro ld-rv">
              <span className="ld-kicker">Planos</span>
              <h2>Preço que o salão entende sem pedir orçamento.</h2>
              <p>Autônoma começa grátis. O salão paga pela operação e pelas profissionais que estão de fato na agenda.</p>
            </div>
            <div className="ld-planos">
              <article className="ld-plano ld-rv">
                <span className="ld-pilula">Autônoma</span>
                <h3>MIMO Autônoma</h3>
                <div className="ld-preco">R$ 0 <small>/mês</small></div>
                <p>Para quem trabalha por conta própria.</p>
                <ul className="ld-checks"><li>1 agenda profissional</li><li>Serviços e horários</li><li>Clientes e histórico</li><li>QR e link próprios</li><li>Retorno e relacionamento</li></ul>
                <a className="ld-btn ld-fantasma" href={comecar('autonoma')}>Começar grátis</a>
              </article>
              <article className="ld-plano ld-quente ld-rv">
                <span className="ld-etiqueta">feito para crescer</span>
                <span className="ld-pilula">Salão</span>
                <h3>MIMO Pro</h3>
                <div className="ld-preco">R$ 49,90 <small>/mês</small></div>
                <p>+ R$ 9,90 por profissional ativa na agenda.</p>
                <ul className="ld-checks"><li>Equipe e várias agendas</li><li>Quadro do dia, comanda e repasses</li><li>Lista de espera e WhatsApp</li><li>Sinal por Pix</li><li>Avaliações e projeção da semana</li></ul>
                <a className="ld-btn ld-primario" href={comecar('salao')}>Criar meu salão</a>
              </article>
            </div>
          </div>
        </section>

        <section id="duvidas" className="ld-alt">
          <div className="ld-wrap">
            <div className="ld-cabeca ld-centro ld-rv"><span className="ld-kicker">Perguntas frequentes</span><h2>Dúvidas sobre a MIMO</h2></div>
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

        <section>
          <div className="ld-wrap">
            <div className="ld-cta ld-rv">
              <div>
                <h2>A agenda é só o começo. A relação é o produto.</h2>
                <p>A MIMO organiza o dia do salão, preserva o vínculo com a cliente e transforma operação em relacionamento. Bonita por fora, afiada por dentro.</p>
              </div>
              <div className="ld-cta-lado">
                <a className="ld-btn ld-branco ld-grande" href={comecar()}>Começar agora <ArrowRight size={18} /></a>
                <span className="ld-bilhete ld-bilhete-cta">esse é só o começo <i>♥</i></span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="ld-pe">
        <div className="ld-wrap ld-pe-in">
          <div>
            <span className="ld-logo"><MarcaIcon width={30} height={26} id="ld-pe" /><Wordmark tamanho={1.5} /></span>
            <p>Beleza daqui, no seu tempo.</p>
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

// A vitrine do produto: o quadro do dia do salão, o app da cliente em
// cima e dois avisos ao vivo. Tudo HTML e CSS, sem imagem.
const COLUNAS = [
  { nome: 'Ana', cor: 'a', cartoes: [[0, 2, 'Escova + hidratação', 'Camila', 'ok'], [3, 2, 'Coloração', 'Fernanda', 'ok'], [6, 1, 'Corte', 'Lívia', 'pedido']] },
  { nome: 'Bia', cor: 'b', cartoes: [[1, 1, 'Manicure', 'Juliana', 'ok'], [2, 1, 'Pedicure', 'Juliana', 'ok'], [4, 2, 'Alongamento em gel', 'Renata', 'ok']] },
  { nome: 'Carla', cor: 'c', cartoes: [[0, 1, 'Sobrancelha', 'Paula', 'ok'], [2, 2, 'Lash lifting', 'Marina', 'ok'], [5, 2, 'Design + henna', 'Talita', 'ok']] },
]
const HORAS = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30']

function Palco() {
  return (
    <div className="ld-palco" aria-label="Exemplo do quadro do dia da MIMO">
      <div className="ld-halo" aria-hidden="true" />
      <div className="ld-quadro">
        <div className="ld-quadro-topo">
          <div><small>Quarta, 23 de setembro</small><strong>Quadro do dia</strong></div>
          <div className="ld-quadro-abas"><b className="on">Quadro</b><b>Comanda</b><b>Projeção</b></div>
        </div>
        <div className="ld-quadro-numeros">
          <div><strong>11</strong><span>atendimentos hoje</span></div>
          <div><strong>2</strong><span>horários vagos</span></div>
          <div><strong>R$ 1.240</strong><span>previsto para hoje</span></div>
        </div>
        <div className="ld-quadro-grade">
          <div className="ld-quadro-horas">{HORAS.map((h) => <span key={h}>{h}</span>)}</div>
          {COLUNAS.map((c) => (
            <div className={`ld-quadro-col ld-col-${c.cor}`} key={c.nome}>
              <div className="ld-quadro-prof"><i>{c.nome[0]}</i>{c.nome}<span>★ 4,9</span></div>
              <div className="ld-quadro-pista">
                {c.cartoes.map(([ini, dur, serv, cli, st], k) => (
                  <div className={`ld-cartao ${st}`} key={k} style={{ top: `${ini * 12.5}%`, height: `calc(${dur * 12.5}% - 4px)`, animationDelay: `${0.35 + k * 0.14}s` }}>
                    <b>{serv}</b><span>{cli}</span>
                    {st === 'pedido' && <em>confirmar?</em>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="ld-fone" aria-hidden="true">
        <div className="ld-fone-topo"><MarcaIcon width={18} height={16} id="ld-fone" /><span>Seu horário</span></div>
        <div className="ld-fone-ok"><Check size={16} /></div>
        <strong>Confirmado!</strong>
        <p>Escova + hidratação<br />com Ana · hoje, 09:00</p>
        <div className="ld-fone-pix">Sinal pago por Pix · R$ 30</div>
      </div>

      <div className="ld-aviso ld-av-1" aria-hidden="true"><Star size={16} /><div><strong>Nova avaliação</strong><span>Marina deu 5 estrelas para Carla</span></div></div>
      <div className="ld-aviso ld-av-2" aria-hidden="true"><Heart size={16} /><div><strong>Vaga encontrada</strong><span>Uma cliente da lista de espera pode entrar às 12:00</span></div></div>
      <div className="ld-aviso ld-av-3" aria-hidden="true"><CalendarDays size={16} /><div><strong>Pedido de horário</strong><span>Lívia quer corte às 12:00 com Ana</span><b>Confirmar</b></div></div>
    </div>
  )
}
