import { Link, useLocation } from 'react-router-dom'
import { ArrowRight, FileText, ShieldCheck, Store, Sparkles, UserRound } from 'lucide-react'
import { NavSite, PeSite, useRevelar } from '../../components/site/Pecas'
import { Markdown, titulosDe } from '../../lib/markdown.jsx'
import { useSeo, migalhasLd, ORGANIZACAO_LD, SITE } from '../../lib/seo'
import { useDocumentosLegais, dataBr } from '../../lib/legal'
import { TIPOS_LEGAIS, tipoLegal, DOCUMENTOS_LEGAIS, EMPRESA, CNPJ, EMAIL_CONTATO, EMAIL_LGPD } from '../../conteudo/legal'

// As páginas dos documentos legais (120), com a cara da landing em volta:
// /termos (o índice), /termos/cliente, /termos/profissional, /termos/salao
// e /privacidade. O texto vem da versão publicada na plataforma; sem ela,
// da versão de código.
const ICONES = { cliente: UserRound, profissional: Sparkles, salao: Store, privacidade: ShieldCheck }

function Casa({ migalha, children, titulo, descricao }) {
  const { pathname } = useLocation()
  const raiz = useRevelar(pathname)
  useSeo({ titulo, descricao, caminho: pathname, jsonLd: { '@context': 'https://schema.org', '@graph': [ORGANIZACAO_LD, migalhasLd([['Início', '/'], ['Termos', '/termos'], [migalha, pathname]]), { '@type': 'WebPage', '@id': `${SITE}${pathname}`, name: titulo, description: descricao }] } })
  return (
    <div className="ld sp" ref={raiz}>
      <NavSite />
      <main><section className="sp-topo"><div className="ld-wrap"><nav className="sp-migalhas" aria-label="Você está em"><Link to="/">Início</Link><span>›</span>{pathname === '/termos' ? <b>Termos</b> : <><Link to="/termos">Termos</Link><span>›</span><b>{migalha}</b></>}</nav>{children}</div></section></main>
      <PeSite />
    </div>
  )
}

export function IndiceLegal() {
  const docs = useDocumentosLegais()
  return (
    <Casa migalha="Termos" titulo="Termos de uso e privacidade | MIMO" descricao="Os termos de uso da MIMO para clientes, profissionais e salões, e a Política de privacidade. Versões e datas sempre à vista.">
      <div className="lg-cabeca">
        <span className="ld-kicker">Termos e privacidade</span>
        <h1>O combinado, por escrito.</h1>
        <p className="ld-lead">Cada pessoa aceita o documento que vale pra ela. Aqui ficam todos, com a versão e a data de cada um.</p>
      </div>
      <div className="lg-cartoes">
        {TIPOS_LEGAIS.map((t) => { const Ic = ICONES[t.tipo]; const d = docs?.[t.tipo] ?? DOCUMENTOS_LEGAIS[t.tipo]; return (
          <Link key={t.tipo} to={t.rota} className="lg-cartao ld-rv">
            <span className="lg-cartao-icone"><Ic size={22} /></span>
            <strong>{t.rotulo}</strong>
            <span className="muted">{t.para}</span>
            <small>Versão de {dataBr(d.versao)}</small>
            <em>Ler <ArrowRight size={14} /></em>
          </Link>
        ) })}
      </div>
      <p className="lg-empresa"><FileText size={14} /> {EMPRESA} · CNPJ {CNPJ} · <a href={`mailto:${EMAIL_CONTATO}`}>{EMAIL_CONTATO}</a> · privacidade: <a href={`mailto:${EMAIL_LGPD}`}>{EMAIL_LGPD}</a></p>
    </Casa>
  )
}

export function PaginaLegal({ tipo }) {
  const docs = useDocumentosLegais()
  const t = tipoLegal(tipo)
  const doc = docs?.[tipo] ?? { ...DOCUMENTOS_LEGAIS[tipo], origem: 'codigo' }
  const titulos = titulosDe(doc.conteudo)
  return (
    <Casa migalha={t.rotulo} titulo={`${doc.titulo} | MIMO`} descricao={`${doc.titulo} da MIMO, versão de ${dataBr(doc.versao)}. ${t.para}.`}>
      <div className="lg-grade">
        <aside className="lg-lado">
          <div className="lg-lado-caixa">
            <small>Neste documento</small>
            <nav className="lg-indice">{titulos.map((x) => <a key={x.id} href={`#${x.id}`}>{x.texto}</a>)}</nav>
          </div>
          <div className="lg-lado-caixa">
            <small>Outros documentos</small>
            <nav className="lg-outros">{TIPOS_LEGAIS.filter((x) => x.tipo !== tipo).map((x) => <Link key={x.tipo} to={x.rota}>{x.rotulo}</Link>)}</nav>
          </div>
        </aside>
        <article className="lg-artigo">
          <span className="ld-kicker">{t.para}</span>
          <h1>{doc.titulo}</h1>
          <p className="lg-versao">Versão de <b>{dataBr(doc.versao)}</b>{doc.publicado_em ? ` · publicada em ${new Date(doc.publicado_em).toLocaleDateString('pt-BR')}` : ''} · {EMPRESA}, CNPJ {CNPJ}</p>
          <div className="legal-texto"><Markdown texto={doc.conteudo} /></div>
          <p className="lg-rodape">Dúvidas: <a href={`mailto:${EMAIL_CONTATO}`}>{EMAIL_CONTATO}</a> · Privacidade e dados pessoais: <a href={`mailto:${EMAIL_LGPD}`}>{EMAIL_LGPD}</a></p>
        </article>
      </div>
    </Casa>
  )
}

export const Termos = () => <IndiceLegal />
export const Privacidade = () => <PaginaLegal tipo="privacidade" />
