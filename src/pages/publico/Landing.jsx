import { Link } from 'react-router-dom'
import {
  CalendarDays, Users, Heart, MessageCircle, Wallet, Check, ArrowRight, ChevronDown,
  Hand, Scissors, Palette, Eye, Flower2, LayoutGrid, UserRound, PauseCircle, CalendarPlus,
} from 'lucide-react'
import { useSeo } from '../../lib/seo'
import { NavSite, PeSite, Foto, Coracao, MarcaCartaz, Cabeca, useRevelar, comecarEm } from '../../components/site/Pecas'
import { PalcoCelular, MockDesktop, MockProfissional, MockRetorno, MockEspera, MockWhats, MockPagamento, MockQr, VINCULOS } from '../../components/site/Mocks'
import { RotinaCartas, Historias, AntesDepois, ProdutoReal, Tamanhos, Simulador, CapturaLead, Confianca, PorQue } from '../../components/site/Secoes'
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

const GRUPOS = [
  { Icone: CalendarDays, nome: 'Agenda', itens: ['Agenda geral', 'Agenda por profissional', 'Bloqueios', 'Pausas', 'Encaixes', 'Múltiplos serviços', 'Lista de espera'] },
  { Icone: Heart, nome: 'Clientes', itens: ['Histórico', 'Origem', 'Retorno', 'Preferências', 'Avaliações'] },
  { Icone: Users, nome: 'Equipe', itens: ['Vínculos', 'Serviços', 'Horários', 'Permissões', 'Comissões'] },
  { Icone: MessageCircle, nome: 'Comunicação', itens: ['WhatsApp', 'Confirmação', 'Lembrete', 'Reagendamento', 'Pós-atendimento', 'Retorno'] },
  { Icone: Wallet, nome: 'Financeiro', itens: ['Sinal', 'Pagamentos', 'Comanda', 'Caixa', 'Comissões'] },
]

const ARTIGOS = [
  ['Agenda', 'Como organizar a agenda de um salão de beleza', 'Caderno, WhatsApp, planilha ou sistema: como escolher sem complicar a operação.', 'como-organizar-agenda-salao-de-beleza'],
  ['Gestão', 'Como reduzir horários vagos no salão', 'Cancelamento, lista de espera, retorno e ocupação: onde o salão perde agenda sem perceber.', 'como-reduzir-horarios-vagos-salao'],
  ['Clientes', 'Como fazer clientes voltarem ao salão', 'Retorno, manutenção e relacionamento sem depender da memória da profissional.', 'como-fazer-clientes-voltarem-salao'],
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
        { '@type': 'Offer', name: 'MIMO Pro', price: '49.90', priceCurrency: 'BRL', description: 'Salão com até 10 agendas: até 3 profissionais inclusas, mais R$ 9,90 por profissional adicional.' },
        { '@type': 'Offer', name: 'MIMO Pro+', price: '149.90', priceCurrency: 'BRL', description: 'Salão com 11 ou mais agendas: até 10 profissionais inclusas, mais R$ 7,90 por profissional adicional, sem limite.' },
      ],
      publisher: { '@id': 'https://mimo.com.vc/#organization' },
    },
    { '@type': 'FAQPage', '@id': 'https://mimo.com.vc/#faq', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ],
}

// coração de pincel, como nos cartazes da marca
export default function Landing() {
  const raiz = useRevelar()
  const comecar = comecarEm
  useSeo({ titulo: TITULO, descricao: DESCRICAO, caminho: '/', jsonLd: JSON_LD })

  return (
    <div className="ld" ref={raiz}>
      <NavSite />

      <main id="topo">
        {/* ---------- HERÓI ---------- */}
        <section className="ld-hero">
          <div className="ld-wrap ld-hero-grade">
            <div className="ld-hero-texto">
              <span className="ld-kicker">Feita para quem vive da beleza</span>
              <h1>Sua rotina no lugar.<span>Seus clientes mais perto.</span></h1>
              <Coracao className="ld-hero-coracao" />
              <p className="ld-lead">A MIMO conecta agenda, clientes, equipe, WhatsApp, retorno e pagamentos numa experiência feita para a rotina real de quem trabalha com beleza.</p>
              <p className="ld-lead ld-lead-2">Menos conversa perdida. Menos horário vazio. Mais clareza para trabalhar.</p>
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
            <Cabeca kicker="A rotina real do salão" titulo={['Um salão não funciona em uma tela só.', 'Por isso a MIMO conecta tudo.']} />
            <div className="ld-rotina">
              <div className="ld-rotina-foto ld-rv"><Foto nome="salao" alt="Salão de beleza com recepção, cadeiras e espelhos iluminados" /></div>
              <div className="ld-rotina-texto ld-rv">
                <p>A agenda é só uma parte da rotina.</p>
                <p>Tem cliente perguntando horário no WhatsApp, profissional com disponibilidade diferente, cancelamento de última hora, retorno, encaixe, pagamento e uma cadeira que não pode ficar vazia.</p>
                <p>A MIMO conecta essas partes para o salão não depender de memória, papel e várias ferramentas desconectadas.</p>
              </div>
              <RotinaCartas />
            </div>
          </div>
        </section>

        {/* ---------- HISTÓRIAS DE USO ---------- */}
        <section id="como-funciona" className="ld-alt">
          <div className="ld-wrap">
            <Cabeca kicker="Histórias de uso" titulo={['A MIMO trabalha', 'quando a rotina muda.']}>Uma cliente cancela, outra some, entra uma profissional nova, alguém escaneia o QR do balcão. É nessas horas que a agenda de papel trava e a MIMO segue.</Cabeca>
            <Historias />
          </div>
        </section>

        {/* ---------- ANTES × COM MIMO ---------- */}
        <section>
          <div className="ld-wrap">
            <Cabeca kicker="Antes × com MIMO" titulo={['A informação existe.', 'A diferença é onde ela mora.']} centro />
            <AntesDepois />
          </div>
        </section>

        {/* ---------- PRODUTO REAL ---------- */}
        <section className="ld-alt">
          <div className="ld-wrap">
            <Cabeca kicker="Produto real" titulo={['Não é só agenda.', 'É o dia inteiro do salão conectado.']} centro>O salão no PC, a profissional e a cliente no celular. Cada parte da rotina tem um lugar, e todas conversam.</Cabeca>
            <ProdutoReal />
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
                O salão cadastra a profissional e define como ela trabalha dentro da operação. Serviços, horários, agenda, acesso e permissões são configurados pelo próprio salão.
              </Cabeca>
              <div className="ld-vinculos ld-rv">
                {VINCULOS.map((v) => <span className="ld-chip" key={v}>{v}</span>)}
              </div>
              <p className="ld-sub ld-rv">O vínculo funciona como uma configuração inicial. Depois o salão pode ajustar regras individualmente. A profissional recebe o convite e ativa o acesso quando tudo já está pronto.</p>
            </div>
            <div className="ld-rv"><MockProfissional /></div>
          </div>
        </section>

        {/* ---------- CLIENTES E RETORNO ---------- */}
        <section>
          <div className="ld-wrap ld-duas ld-duas-inv">
            <div className="ld-rv"><MockRetorno /></div>
            <div>
              <Cabeca kicker="Clientes e retorno" titulo={['A agenda termina.', 'O relacionamento continua.']}>
                A MIMO ajuda o salão a lembrar quem deveria voltar, quem está há muito tempo sem atendimento e quem possui histórico com determinada profissional.
              </Cabeca>
              <ul className="ld-checks ld-rv"><li>Manutenção no prazo certo</li><li>Recorrência sem depender da memória</li><li>Histórico por profissional e por serviço</li><li>Encontre quem deveria voltar, sem procurar conversa antiga</li></ul>
            </div>
          </div>
        </section>

        {/* ---------- LISTA DE ESPERA ---------- */}
        <section className="ld-alt">
          <div className="ld-wrap ld-duas">
            <div>
              <Cabeca kicker="Lista de espera" titulo={['Cancelou?', 'A vaga não precisa morrer junto.']}>
                Quando um horário fica livre, a MIMO ajuda o salão a encontrar clientes da lista de espera compatíveis com aquele serviço, profissional e período.
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
                Confirmação, lembrete, cancelamento, reagendamento e retorno acompanham o contexto real da agenda. Confirme um horário sem procurar conversa antiga.
              </Cabeca>
            </div>
          </div>
        </section>

        {/* ---------- PAGAMENTOS ---------- */}
        <section className="ld-alt">
          <div className="ld-wrap ld-duas">
            <div>
              <Cabeca kicker="Pagamentos" titulo={['Agenda e pagamento', 'falando a mesma língua.']}>
                Quando habilitado pelo salão, o agendamento pode trabalhar com sinal ou pagamento completo. O status financeiro acompanha o próprio atendimento.
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

        {/* ---------- DIFERENCIAL DE RELACIONAMENTO ---------- */}
        <section className="ld-manifesto">
          <div className="ld-wrap ld-manifesto-grade">
            <div className="ld-rv">
              <span className="ld-kicker">O que a MIMO acredita</span>
              <h2>A MIMO não quer tomar sua cliente. Quer ajudar você a cuidar melhor da relação.</h2>
              <p>Clientes não são propriedade de uma plataforma. Por isso a MIMO separa identidade, vínculo e origem.</p>
              <div className="ld-nota">Se uma cliente chegou pelo salão, por uma profissional ou por uma campanha, essa informação continua registrada no contexto correto.</div>
            </div>
            <div className="ld-grafo ld-grafo-escuro ld-rv">
              <div className="ld-no ld-no-cliente"><i><UserRound size={22} /></i><strong>Cliente</strong><span>uma conta, vários negócios</span></div>
              <span className="ld-seta" aria-hidden="true"><ArrowRight size={22} /></span>
              <div className="ld-no ld-no-salao"><i><LayoutGrid size={22} /></i><strong>Salão</strong><span>vínculo por QR, link, convite</span></div>
              <span className="ld-seta" aria-hidden="true"><ArrowRight size={22} /></span>
              <div className="ld-no ld-no-prof"><i><Scissors size={22} /></i><strong>Profissional</strong><span>quem atendeu fica no histórico</span></div>
              <div className="ld-grafo-tags"><span>origem registrada</span><span>vínculo preservado</span><span>histórico separado</span></div>
            </div>
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

        {/* ---------- FEITA PARA CADA TAMANHO ---------- */}
        <section>
          <div className="ld-wrap">
            <Cabeca kicker="Feita para cada tamanho" titulo={['Feita para o tamanho', 'que você tem hoje.']} centro />
            <Tamanhos />
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

        {/* ---------- SIMULADOR ---------- */}
        <section id="simulador">
          <div className="ld-wrap">
            <Cabeca kicker="Simulador de preço" titulo={['Veja quanto ficaria', 'para o seu salão.']} centro />
            <Simulador />
          </div>
        </section>

        {/* ---------- PLANOS ---------- */}
        <section id="planos" className="ld-alt">
          <div className="ld-wrap">
            <Cabeca kicker="Planos" titulo={['Preço que o salão entende', 'sem pedir orçamento.']} centro>Você paga pelas agendas profissionais que realmente utiliza. Recepção e administração não contam.</Cabeca>
            <div className="ld-planos ld-planos-3">
              <article className="ld-plano ld-rv">
                <span className="ld-pilula">Autônoma</span>
                <h3>Grátis</h3>
                <div className="ld-preco">R$ 0 <small>/mês</small></div>
                <p>Para quem trabalha por conta própria.</p>
                <ul className="ld-checks"><li>1 agenda profissional</li><li>Serviços e horários</li><li>Clientes e histórico</li><li>QR e link próprios</li><li>Retorno de clientes</li></ul>
                <a className="ld-btn ld-fantasma" href={comecar('autonoma')}>Criar agenda grátis</a>
              </article>
              <article className="ld-plano ld-quente ld-rv">
                <span className="ld-etiqueta">feito para crescer</span>
                <span className="ld-pilula">Salão até 10 agendas</span>
                <h3>MIMO Pro</h3>
                <div className="ld-preco">R$ 49,90 <small>/mês</small></div>
                <p>Até 3 profissionais inclusas. Da 4ª à 10ª, + R$ 9,90 por profissional ativa na agenda.</p>
                <ul className="ld-checks"><li>Equipe e várias agendas</li><li>Agenda geral, comanda e repasses</li><li>Lista de espera e WhatsApp</li><li>Sinal e pagamentos</li><li>Avaliações e projeção da semana</li></ul>
                <a className="ld-btn ld-primario" href={comecar('salao')}>Criar meu salão</a>
              </article>
              <article className="ld-plano ld-rv">
                <span className="ld-pilula">Salão com 11 ou mais</span>
                <h3>MIMO Pro+</h3>
                <div className="ld-preco">R$ 149,90 <small>/mês</small></div>
                <p>Até 10 profissionais inclusas. A partir da 11ª, + R$ 7,90 por profissional, sem limite.</p>
                <ul className="ld-checks"><li>Tudo do MIMO Pro</li><li>Profissionais sem limite</li><li>Permissões por profissional</li><li>Comissões e relatórios</li><li>Operação mais estruturada</li></ul>
                <a className="ld-btn ld-fantasma" href={comecar('salao')}>Criar meu salão</a>
              </article>
            </div>
          </div>
        </section>

        {/* ---------- POR QUE A MIMO EXISTE ---------- */}
        <section>
          <div className="ld-wrap">
            <Cabeca kicker="Por que a MIMO existe" titulo={['A MIMO começou', 'olhando a rotina real.']} />
            <PorQue />
          </div>
        </section>

        {/* ---------- FUNCIONALIDADES ---------- */}
        <section id="funcionalidades" className="ld-alt">
          <div className="ld-wrap">
            <Cabeca kicker="Funcionalidades" titulo={['Tudo o que a rotina pede,', 'agrupado do jeito que ela acontece.']} centro />
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

        {/* ---------- MIMO ENSINA ---------- */}
        <section id="conteudos">
          <div className="ld-wrap">
            <Cabeca kicker="MIMO ensina" titulo={['Rotina de salão,', 'sem enrolação.']}>Guias curtos, ligados à rotina. Úteis mesmo para quem ainda não usa a MIMO.</Cabeca>
            <div className="ld-artigos">
              {ARTIGOS.map(([tag, t, d, slug], i) => (
                <Link className="ld-artigo ld-rv" to={`/blog/${slug}`} key={slug} style={{ transitionDelay: `${i * 60}ms` }}><small>{tag}</small><h3>{t}</h3><p>{d}</p><span className="ld-embreve">Ler o guia →</span></Link>
              ))}
            </div>
            <div className="ld-centro-botao ld-rv"><Link className="ld-btn ld-fantasma" to="/blog">Ver todos os conteúdos <ArrowRight size={16} /></Link></div>
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

        {/* ---------- CAPTURA DE LEAD ---------- */}
        <section id="quero-ver">
          <div className="ld-wrap ld-captura">
            <div className="ld-rv">
              <Cabeca kicker="Vamos conversar" titulo={['Quer ver como a MIMO', 'ficaria no seu salão?']}>Conta quantas profissionais atendem e a gente te mostra a agenda montada do seu jeito, sem compromisso.</Cabeca>
              <ul className="ld-checks"><li>Resposta de gente, pelo WhatsApp</li><li>Sem cartão, sem contrato</li><li>Se preferir, crie a conta agora e veja por dentro</li></ul>
            </div>
            <CapturaLead />
          </div>
        </section>

        {/* ---------- CONFIANÇA + CTA ---------- */}
        <section className="ld-alt ld-fim">
          <div className="ld-wrap">
            <Confianca />
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

      <PeSite />
    </div>
  )
}
