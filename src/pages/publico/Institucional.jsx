import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Mail } from 'lucide-react'
import { BotaoWhats, FaixaWhats, CartaoWhats } from '../../components/site/Whats'
import { useSeo, migalhasLd, ORGANIZACAO_LD } from '../../lib/seo'
import { EMAIL_CONTATO } from '../../lib/termos'
import { NavSite, PeSite, Cabeca, Foto, useRevelar, comecarEm } from '../../components/site/Pecas'
import '../../landing.css'
import { seoDaRota } from '../../lib/conteudoPublico'
import { PAGINAS_INSTITUCIONAIS } from '../../conteudo/paginasSeo'
import { linhas } from '../../lib/paginas'
import { Markdown } from '../../lib/markdown.jsx'

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

// o miolo de cada institucional: o do código (paginasSeo.js) abre na hora, o do banco chega por cima
function useConteudoDe(rota) {
  const cod = PAGINAS_INSTITUCIONAIS.find((p) => p.rota === rota)
  const [c, setC] = useState(() => ({ seo_title: cod?.seo_title, meta_description: cod?.meta_description, ...(cod?.conteudo || {}) }))
  useEffect(() => {
    let vivo = true
    seoDaRota(rota).then((s) => { if (vivo && s) setC({ seo_title: s.seo_title || cod?.seo_title, meta_description: s.meta_description || cod?.meta_description, ...(cod?.conteudo || {}), ...(s.conteudo || {}) }) })
    return () => { vivo = false }
  }, [rota]) // eslint-disable-line react-hooks/exhaustive-deps
  return c
}
const PLANO = ({ nome, preco, texto, itens, botao, quente, etiqueta, pilula }) => (
  <article className={'ld-plano ld-rv' + (quente ? ' ld-quente' : '')}>
    {etiqueta && <span className="ld-etiqueta">{etiqueta}</span>}
    <span className="ld-pilula">{pilula}</span>
    <h3>{nome}</h3>
    <div className="ld-preco">{preco} <small>/mês</small></div>
    <p>{texto}</p>
    <ul className="ld-checks">{linhas(itens).map((i) => <li key={i}>{i}</li>)}</ul>
    {botao}
  </article>
)

export function Planos() {
  const c = useConteudoDe('/planos')
  return (
    <Pagina caminho="/planos" migalha="Planos" titulo={c.seo_title} descricao={c.meta_description}>
      <Cabeca como="h1" kicker={c.kicker} titulo={linhas(c.h1)}>{c.intro}</Cabeca>
      <div className="ld-planos ld-planos-3">
        <PLANO pilula="Autônoma" nome="Grátis" preco="R$ 0" texto="Para quem trabalha por conta própria." itens={c.autonomaItens} botao={<a className="ld-btn ld-fantasma" href={comecarEm('autonoma')}>Criar agenda grátis</a>} />
        <PLANO quente etiqueta="feito para crescer" pilula="Salão até 10 agendas" nome="MIMO Pro" preco="R$ 49,90" texto="Até 3 profissionais inclusas. Da 4ª à 10ª, + R$ 9,90 por profissional ativa na agenda." itens={c.proItens} botao={<a className="ld-btn ld-primario" href={comecarEm('salao')}>Criar meu salão</a>} />
        <PLANO pilula="Salão com 11 ou mais" nome="MIMO Pro+" preco="R$ 149,90" texto="Até 11 profissionais inclusas. Da 12ª em diante, + R$ 7,90 por profissional, sem limite." itens={c.promaisItens} botao={<a className="ld-btn ld-fantasma" href={comecarEm('salao')}>Criar meu salão</a>} />
      </div>
      {c.nota && <div className="sp-nota"><Markdown texto={c.nota} /></div>}
      <FaixaWhats chamada="planos" />
    </Pagina>
  )
}

export function Sobre() {
  const c = useConteudoDe('/sobre')
  return (
    <Pagina caminho="/sobre" migalha="Sobre" titulo={c.seo_title} descricao={c.meta_description}>
      <Cabeca como="h1" kicker={c.kicker} titulo={linhas(c.h1)}>{c.intro}</Cabeca>
      <div className="sp-sobre ld-rv">
        <div className="sp-sobre-foto"><Foto nome="equipe" alt="Dona do salão e duas profissionais olhando a agenda no tablet" /></div>
        <div className="sp-sobre-texto">
          <Markdown texto={c.texto || ''} />
          <div className="ld-cta-lado"><a className="ld-btn ld-primario" href={comecarEm()}>Começar agora <ArrowRight size={16} /></a><BotaoWhats chamada="conversar" /></div>
        </div>
      </div>
    </Pagina>
  )
}

export function Contato() {
  const c = useConteudoDe('/contato')
  return (
    <Pagina caminho="/contato" migalha="Contato" titulo={c.seo_title} descricao={c.meta_description}>
      <Cabeca como="h1" kicker={c.kicker} titulo={linhas(c.h1)}>{c.intro}</Cabeca>
      <div className="sp-contato ld-rv">
        <CartaoWhats />
        <a className="sp-contato-carta" href={`mailto:${EMAIL_CONTATO}`}><Mail size={22} /><strong>E-mail</strong><span>{EMAIL_CONTATO}</span></a>
        <a className="sp-contato-carta" href={comecarEm()}><ArrowRight size={22} /><strong>Quero começar</strong><span>Crie a conta e fale com a gente de dentro do app</span></a>
      </div>
      {c.nota && <div className="sp-nota"><Markdown texto={c.nota} /></div>}
    </Pagina>
  )
}
