import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Mail, MessageCircle } from 'lucide-react'
import { useSeo, migalhasLd, ORGANIZACAO_LD } from '../../lib/seo'
import { EMAIL_CONTATO } from '../../lib/termos'
import { NavSite, PeSite, Cabeca, Foto, useRevelar, comecarEm } from '../../components/site/Pecas'
import '../../landing.css'

// As páginas institucionais curtas: planos, sobre e contato. Cada uma
// com title e description próprios e migalhas.
function Pagina({ caminho, titulo, descricao, migalha, children }) {
  const raiz = useRevelar()
  useEffect(() => { window.scrollTo(0, 0) }, [caminho])
  useSeo({ titulo, descricao, caminho, jsonLd: { '@context': 'https://schema.org', '@graph': [ORGANIZACAO_LD, migalhasLd([['Início', '/'], [migalha, caminho]])] } })
  return (
    <div className="ld sp" ref={raiz}>
      <NavSite />
      <main><section className="sp-topo"><div className="ld-wrap"><nav className="sp-migalhas" aria-label="Você está em"><Link to="/">Início</Link><span>›</span><b>{migalha}</b></nav>{children}</div></section></main>
      <PeSite />
    </div>
  )
}

export function Planos() {
  return (
    <Pagina caminho="/planos" migalha="Planos" titulo="Planos e preços | MIMO" descricao="Autônoma grátis. MIMO Pro por R$ 49,90/mês até 3 profissionais, mais R$ 9,90 por profissional até 10. MIMO Pro+ por R$ 149,90/mês para 11 ou mais, mais R$ 7,90 por profissional.">
      <Cabeca kicker="Planos" titulo={['Preço que o salão entende', 'sem pedir orçamento.']}>Três planos, uma regra: você paga pelas agendas profissionais que realmente utiliza. Recepção, gerente e conta administrativa não contam como agenda.</Cabeca>
      <div className="ld-planos ld-planos-3">
        <article className="ld-plano ld-rv">
          <span className="ld-pilula">Autônoma</span>
          <h3>Grátis</h3>
          <div className="ld-preco">R$ 0 <small>/mês</small></div>
          <p>Para quem trabalha por conta própria.</p>
          <ul className="ld-checks"><li>1 agenda profissional</li><li>Serviços e horários</li><li>Clientes e histórico</li><li>QR e link próprios</li><li>Retorno de clientes</li></ul>
          <a className="ld-btn ld-fantasma" href={comecarEm('autonoma')}>Criar agenda grátis</a>
        </article>
        <article className="ld-plano ld-quente ld-rv">
          <span className="ld-etiqueta">feito para crescer</span>
          <span className="ld-pilula">Salão até 10 agendas</span>
          <h3>MIMO Pro</h3>
          <div className="ld-preco">R$ 49,90 <small>/mês</small></div>
          <p>Até 3 profissionais inclusas. Da 4ª à 10ª, + R$ 9,90 por profissional ativa na agenda.</p>
          <ul className="ld-checks"><li>Equipe e várias agendas</li><li>Agenda geral, comanda e repasses</li><li>Lista de espera e WhatsApp</li><li>Sinal e pagamentos</li><li>Avaliações e projeção da semana</li></ul>
          <a className="ld-btn ld-primario" href={comecarEm('salao')}>Criar meu salão</a>
        </article>
        <article className="ld-plano ld-rv">
          <span className="ld-pilula">Salão com 11 ou mais</span>
          <h3>MIMO Pro+</h3>
          <div className="ld-preco">R$ 149,90 <small>/mês</small></div>
          <p>Até 11 profissionais inclusas. Da 12ª em diante, + R$ 7,90 por profissional, sem limite.</p>
          <ul className="ld-checks"><li>Tudo do MIMO Pro</li><li>Profissionais sem limite</li><li>Permissões por profissional</li><li>Comissões e relatórios</li><li>Operação mais estruturada</li></ul>
          <a className="ld-btn ld-fantasma" href={comecarEm('salao')}>Criar meu salão</a>
        </article>
      </div>
      <p className="sp-nota">Exemplos: 3 profissionais, R$ 49,90. 6 profissionais, R$ 79,60. 10 profissionais, R$ 119,20. 15 profissionais, R$ 181,50. Sem fidelidade. A autônoma que abrir um salão passa para o MIMO Pro com a mesma conta, sem perder clientes nem histórico.</p>
    </Pagina>
  )
}

export function Sobre() {
  return (
    <Pagina caminho="/sobre" migalha="Sobre" titulo="Sobre a MIMO | Beleza, organização e relacionamento" descricao="A MIMO é um sistema de agenda e relacionamento para salões e profissionais de beleza, construído junto à rotina real de quem vive da beleza.">
      <Cabeca kicker="Sobre a MIMO" titulo={['Feita com salão de verdade,', 'para salão de verdade.']}>A MIMO nasceu dentro de um salão, com a agenda de papel do lado. Cada função entrou porque alguém precisou dela numa terça-feira cheia, não porque estava na lista de um concorrente.</Cabeca>
      <div className="sp-sobre ld-rv">
        <div className="sp-sobre-foto"><Foto nome="equipe" alt="Dona do salão e duas profissionais olhando a agenda no tablet" /></div>
        <div className="sp-sobre-texto">
          <h2>O que a gente acredita</h2>
          <p><strong>Clientes não são propriedade de uma plataforma.</strong> A cliente chega pelo seu QR, pelo seu link ou por uma profissional da sua equipe, e essa origem fica registrada. Não existe vitrine genérica com o concorrente ao lado.</p>
          <p><strong>Bonita, mas não fútil. Simples, mas não rasa.</strong> A MIMO fala a língua do salão: cadeira vazia, encaixe, retorno, comanda. Nada de dashboard decorativo.</p>
          <p><strong>Tecnologia que não parece software de contador.</strong> A dona abre e sabe o que fazer agora. A profissional vê só a agenda dela. A cliente marca sozinha.</p>
          <p>A MIMO é desenvolvida pela <strong>MIMO Desenvolvimento Ltda</strong>, no litoral de São Paulo. Começou em Itanhaém, Peruíbe e Mongaguá e cresce salão a salão.</p>
          <a className="ld-btn ld-primario" href={comecarEm()}>Começar agora <ArrowRight size={16} /></a>
        </div>
      </div>
    </Pagina>
  )
}

export function Contato() {
  return (
    <Pagina caminho="/contato" migalha="Contato" titulo="Contato | MIMO" descricao="Fale com a equipe da MIMO: dúvidas sobre o sistema para salão, a conta de autônoma ou parcerias.">
      <Cabeca kicker="Contato" titulo={['Fala com a gente.']}>Dúvida sobre o sistema, sobre a conta de autônoma ou vontade de trazer a MIMO para o seu salão. Respondemos gente, não robô.</Cabeca>
      <div className="sp-contato ld-rv">
        <a className="sp-contato-carta" href={`mailto:${EMAIL_CONTATO}`}><Mail size={22} /><strong>E-mail</strong><span>{EMAIL_CONTATO}</span></a>
        <a className="sp-contato-carta" href={comecarEm()}><MessageCircle size={22} /><strong>Quero começar</strong><span>Crie a conta e fale com a gente de dentro do app</span></a>
      </div>
      <p className="sp-nota">Suporte pelo app: quem já usa a MIMO encontra o canal de ajuda dentro do painel. <Link to="/privacidade">Privacidade</Link> · <Link to="/termos">Termos de uso</Link>.</p>
    </Pagina>
  )
}
