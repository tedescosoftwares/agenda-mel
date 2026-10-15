// O HTML estático do site inteiro (3.16), chamado por paginas-estaticas.mjs.
//
// Até aqui só o guia de salões escrevia o corpo da página dentro de
// <div id="root"> no build (guia-estatico.mjs). O resto do site (home,
// páginas de produto, blog, institucionais e termos) saía só com as metas:
// antes de rodar o JavaScript, o Google via dezenas de páginas "iguais",
// a mesma casca vazia. Foi assim que dois artigos viraram "cópia, canônica
// diferente" e 24 páginas ficaram "detectadas, mas não indexadas".
//
// Agora cada página pública leva o texto de verdade: o robô lê sem
// JavaScript, e a pessoa recebe o app, que troca o corpo ao abrir. O
// rodapé estático (Soluções, Para profissionais, MIMO, cidades do guia)
// entra em todas as páginas, inclusive nas centenas do guia: é a malha
// interna que o robô enxerga na primeira passada.
//
// O Markdown aqui é o mesmo do app (src/lib/markdown.jsx): títulos, listas,
// citações, parágrafos, negrito, itálico e links. Tudo o que vem do banco
// ou do código passa por esc().

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const texto = (v) => (v == null ? '' : String(v))
const linhasDe = (v) => (Array.isArray(v) ? v.map(texto).map((s) => s.trim()).filter(Boolean) : typeof v === 'string' ? v.split('\n').map((s) => s.trim()).filter(Boolean) : [])
const dataBr = (v) => { if (!v) return ''; const d = new Date(String(v).length === 10 ? `${v}T12:00:00-03:00` : v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }) }
const hrefOk = (u) => /^(https?:\/\/|\/|#|mailto:)/i.test(String(u ?? '').trim())

export function idDoTitulo(t) {
  return String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// negrito, itálico e links, sobre o texto já escapado
function inline(cru) {
  const t = esc(cru)
  return t.replace(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g, (m) => {
    if (m.startsWith('**')) return `<strong>${m.slice(2, -2)}</strong>`
    if (m.startsWith('[')) {
      const [, rotulo, url] = m.match(/\[([^\]]+)\]\(([^)]+)\)/)
      const u = url.replace(/&amp;/g, '&')
      return hrefOk(u) ? `<a href="${esc(u)}"${/^https?:\/\//i.test(u) ? ' rel="noopener"' : ''}>${rotulo}</a>` : rotulo
    }
    return `<em>${m.slice(1, -1)}</em>`
  })
}

// Markdown → HTML, a mesma gramática do app
export function mdParaHtml(md) {
  const linhas = String(md || '').replace(/\r/g, '').split('\n')
  const saida = []
  let i = 0
  while (i < linhas.length) {
    const l = linhas[i]
    if (!l.trim()) { i++; continue }
    let m
    if ((m = l.match(/^(#{1,3}) (.+)/))) {
      const nivel = m[1].length, t = m[2].trim()
      const tag = nivel === 3 ? 'h3' : 'h2'
      saida.push(`<${tag} id="${esc(idDoTitulo(t))}">${inline(t)}</${tag}>`)
      i++; continue
    }
    if (/^[-*] /.test(l)) {
      const itens = []
      while (i < linhas.length && /^[-*] /.test(linhas[i])) { itens.push(linhas[i].replace(/^[-*] /, '')); i++ }
      saida.push(`<ul>${itens.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`)
      continue
    }
    if (/^\d+\. /.test(l)) {
      const itens = []
      while (i < linhas.length && /^\d+\. /.test(linhas[i])) { itens.push(linhas[i].replace(/^\d+\. /, '')); i++ }
      saida.push(`<ol>${itens.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`)
      continue
    }
    if (/^> /.test(l)) {
      const ls = []
      while (i < linhas.length && /^> /.test(linhas[i])) { ls.push(linhas[i].replace(/^> /, '')); i++ }
      saida.push(`<blockquote>${inline(ls.join(' '))}</blockquote>`)
      continue
    }
    const ls = []
    while (i < linhas.length && linhas[i].trim() && !/^(#{1,3} |[-*] |\d+\. |> )/.test(linhas[i])) { ls.push(linhas[i].trim()); i++ }
    saida.push(`<p>${inline(ls.join(' '))}</p>`)
  }
  return saida.join('\n')
}

const migalhas = (trilha) => `<nav aria-label="Você está em">${trilha.map(([n, r], i) => (i < trilha.length - 1 ? `<a href="${esc(r)}">${esc(n)}</a> › ` : `<span>${esc(n)}</span>`)).join('')}</nav>`
const lista = (itens, f = (x) => esc(x)) => (itens?.length ? `<ul>${itens.map((x) => `<li>${f(x)}</li>`).join('')}</ul>` : '')
const faqHtml = (faq, titulo = 'Perguntas frequentes') => {
  const pares = (faq ?? []).map((f) => (Array.isArray(f) ? f : f && typeof f === 'object' ? [f.pergunta ?? f.a, f.resposta ?? f.b] : null)).filter((p) => p && p[0] && p[1])
  return pares.length ? `<section><h2>${esc(titulo)}</h2>${pares.map(([q, a]) => `<h3>${esc(q)}</h3><p>${inline(a)}</p>`).join('')}</section>` : ''
}

// o estilo da primeira pintura: enquanto o app não monta, o texto estático sai legível, não cru
export const ESTILO_PRE_APP = '<style id="pre-app">#root>main{font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:860px;margin:0 auto;padding:24px 16px;color:#1f2026}#root>main h1{font-size:1.8rem;line-height:1.2}#root>main a{color:#a3123a}#root>main img{max-width:100%;height:auto;border-radius:12px}#root>main nav ul{padding-left:18px}#root>footer{font:14px/1.5 system-ui,sans-serif;max-width:860px;margin:0 auto;padding:16px;color:#666;border-top:1px solid #eee}#root>footer a{color:#a3123a;margin-right:10px;white-space:nowrap}</style>'

// ---- o rodapé de todas as páginas: a malha interna ---------------------------------------
export function rodapeEstatico({ solucoes = [], profissionais = [], cidades = [] } = {}) {
  const coluna = (titulo, itens) => (itens.length ? `<div><strong>${esc(titulo)}</strong><br />${itens.map(([n, r]) => `<a href="${esc(r)}">${esc(n)}</a>`).join(' · ')}</div>` : '')
  const rotulo = (p) => p.rodape || p.kicker
  return `<footer>${coluna('Soluções', solucoes.map((p) => [rotulo(p), p.rota]))}${coluna('Para profissionais', profissionais.map((p) => [rotulo(p), p.rota]))}${coluna('MIMO', [['Planos', '/planos'], ['Sobre', '/sobre'], ['Blog', '/blog'], ['Guia de salões', '/saloes'], ...cidades.slice(0, 8).map((c) => [`Salões em ${c.cidade}`, `/saloes/${c.cidade_slug}`]), ['Contato', '/contato'], ['Termos de uso', '/termos'], ['Privacidade', '/privacidade']])}<p>© MIMO Desenvolvimento Ltda · mimo.com.vc</p></footer>`
}

// ---- um artigo do blog ---------------------------------------------------------------------
// a: { slug, titulo, resumo, conteudo, categoria: { slug, nome } | null, autor, publicado_em, minutos, produto_url, produto_rotulo, relacionados: [{ slug, titulo }], caixa, faq }
export function corpoDoArtigo(a, { caixaGuia = '' } = {}) {
  const cat = a.categoria?.slug ? [[a.categoria.nome || a.categoria.slug, `/blog/categoria/${a.categoria.slug}`]] : []
  const meta = [a.autor ? `Por ${esc(a.autor)}` : '', dataBr(a.publicado_em), a.minutos ? `${a.minutos} min de leitura` : ''].filter(Boolean).join(' · ')
  return `<main><article>
${migalhas([['Início', '/'], ['Blog', '/blog'], ...cat, [a.titulo, `/blog/${a.slug}`]])}
${cat.length ? `<p>${esc(cat[0][0])}</p>` : ''}
<h1>${esc(a.titulo)}</h1>
${a.resumo ? `<p>${esc(a.resumo)}</p>` : ''}
${meta ? `<p><small>${meta}</small></p>` : ''}
${mdParaHtml(a.conteudo)}
${a.caixa?.titulo || a.caixa?.texto ? `<aside><strong>${esc(a.caixa.titulo || 'Na prática')}</strong><p>${esc(a.caixa.texto)}</p></aside>` : ''}
${a.produto_url && hrefOk(a.produto_url) ? `<p><a href="${esc(a.produto_url)}">${esc(a.produto_rotulo || 'Conheça a MIMO')}</a></p>` : ''}
${faqHtml(a.faq)}
${a.relacionados?.length ? `<section><h2>Outros conteúdos que podem te interessar</h2>${lista(a.relacionados, (r) => `<a href="/blog/${esc(r.slug)}">${esc(r.titulo)}</a>`)}</section>` : ''}
${caixaGuia}
</article></main>`
}

// ---- o índice do blog e uma categoria -------------------------------------------------------
export function corpoDoBlog({ cabeca = {}, artigos = [], categoria = null, categorias = [] } = {}) {
  const h1 = categoria ? categoria.nome : linhasDe(cabeca.h1).join(' ') || 'Blog da MIMO'
  const intro = categoria ? (categoria.descricao || '') : (cabeca.intro || '')
  return `<main>
${migalhas(categoria ? [['Início', '/'], ['Blog', '/blog'], [categoria.nome, `/blog/categoria/${categoria.slug}`]] : [['Início', '/'], ['Blog', '/blog']])}
<p>${esc(categoria ? 'Categoria' : cabeca.kicker || 'Blog MIMO')}</p>
<h1>${esc(h1)}</h1>
${intro ? `<p>${esc(intro)}</p>` : ''}
${categorias.length ? `<nav aria-label="Categorias"><a href="/blog">Todos</a> · ${categorias.map((c) => `<a href="/blog/categoria/${esc(c.slug)}">${esc(c.nome)}</a>`).join(' · ')}</nav>` : ''}
<section>${artigos.length ? artigos.map((a) => `<article><h2><a href="/blog/${esc(a.slug)}">${esc(a.titulo)}</a></h2>${a.categoria?.nome ? `<p><small>${esc(a.categoria.nome)}${a.minutos ? ` · ${a.minutos} min de leitura` : ''}</small></p>` : ''}${a.resumo ? `<p>${esc(a.resumo)}</p>` : ''}</article>`).join('') : '<p>Ainda não tem guia nesta categoria.</p>'}</section>
</main>`
}

// ---- uma página de produto (PAGINAS_SEO, normalizada) ---------------------------------------
export function corpoDaPaginaSeo(p, { pai = null, relacionadas = [], artigos = [] } = {}) {
  const sec = (titulo, html) => (html ? `<section>${titulo ? `<h2>${esc(titulo)}</h2>` : ''}${html}</section>` : '')
  const rotina = (p.rotina ?? []).map((c) => `<h3>${esc(c.titulo)}</h3>${c.cena ? `<p>${esc(c.cena)}</p>` : ''}${c.resolve ? `<p>${esc(c.resolve)}</p>` : ''}`).join('')
  const modulos = (p.modulos ?? []).map((m) => `<section id="${esc(m.id)}">${m.kicker ? `<p>${esc(m.kicker)}</p>` : ''}<h2>${esc(m.titulo)}</h2>${m.texto ? `<p>${esc(m.texto)}</p>` : ''}${lista(m.itens)}</section>`).join('')
  const blocos = (p.blocos ?? []).map((b) => `<section><h2>${esc(b.titulo)}</h2>${b.texto ? `<p>${esc(b.texto)}</p>` : ''}${lista(b.itens)}</section>`).join('')
  const funcoes = (p.funcoes ?? []).map((f) => `<h3>${esc(f.titulo)}</h3><p>${esc(f.texto)}</p>`).join('')
  return `<main>
${migalhas([['Início', '/'], ...(pai ? [[pai.kicker, pai.rota]] : []), [p.kicker, p.rota]])}
<p>${esc(p.kicker)}</p>
<h1>${esc((p.h1 ?? []).join(' '))}</h1>
${p.sub ? `<p>${esc(p.sub)}</p>` : ''}
${lista(p.provas)}
${sec('A rotina real do salão', rotina)}
${p.mockTitulo || p.mockTexto ? `<section><h2>${esc(p.mockTitulo || 'O produto')}</h2>${p.mockTexto ? `<p>${esc(p.mockTexto)}</p>` : ''}</section>` : ''}
${modulos}
${blocos}
${sec('Funcionalidades', funcoes)}
${p.sinonimos ? `<section><h2>${esc(p.sinonimos.titulo)}</h2><p>${esc(p.sinonimos.texto)}</p></section>` : ''}
${p.planos ? '<section><h2>Planos</h2><p>Autônoma: grátis, para sempre. MIMO Pro: R$ 49,90 por mês com até 3 profissionais, e R$ 9,90 por profissional da 4ª à 10ª. MIMO Pro+: R$ 149,90 por mês para 11 ou mais. Sem fidelidade. <a href="/planos">Ver os planos</a>.</p></section>' : ''}
${p.faixa ? `<section><h2>${esc(p.faixa.titulo)}</h2><p>${esc(p.faixa.texto)}</p></section>` : ''}
${faqHtml(p.faq, p.faqTitulo || 'Perguntas frequentes')}
${relacionadas.length ? `<nav aria-label="Veja também"><h2>Veja também</h2>${lista(relacionadas, (r) => `<a href="${esc(r.rota)}">${esc(r.rodape || r.kicker)}</a>`)}</nav>` : ''}
${artigos.length ? `<section><h2>Leia no blog</h2>${lista(artigos, (a) => `<a href="/blog/${esc(a.slug)}">${esc(a.titulo)}</a>`)}</section>` : ''}
<p><a href="/planos">${esc(p.cta?.rotulo || 'Começar agora')}: veja os planos</a></p>
</main>`
}

// ---- as institucionais -----------------------------------------------------------------------
const cabecaHtml = (c, migalha, rota) => `${migalhas([['Início', '/'], [migalha, rota]])}${c.kicker ? `<p>${esc(c.kicker)}</p>` : ''}<h1>${esc(linhasDe(c.h1).join(' '))}</h1>${c.intro ? `<p>${esc(c.intro)}</p>` : ''}`
export function corpoDePlanos(c = {}) {
  const plano = (nome, preco, textoPlano, itens) => `<section><h2>${esc(nome)}: ${esc(preco)} por mês</h2><p>${esc(textoPlano)}</p>${lista(linhasDe(itens))}</section>`
  return `<main>
${cabecaHtml(c, 'Planos', '/planos')}
${plano('Autônoma, grátis', 'R$ 0', 'Para quem trabalha por conta própria.', c.autonomaItens)}
${plano('MIMO Pro', 'R$ 49,90', 'Até 3 profissionais inclusas. Da 4ª à 10ª, mais R$ 9,90 por profissional ativa na agenda.', c.proItens)}
${plano('MIMO Pro+', 'R$ 149,90', 'Até 11 profissionais inclusas. Da 12ª em diante, mais R$ 7,90 por profissional, sem limite.', c.promaisItens)}
${c.nota ? mdParaHtml(c.nota) : ''}
</main>`
}
export function corpoDeSobre(c = {}) {
  return `<main>
${cabecaHtml(c, 'Sobre', '/sobre')}
${mdParaHtml(c.texto || '')}
</main>`
}
export function corpoDeContato(c = {}, { email = 'contato@mimo.com.vc' } = {}) {
  return `<main>
${cabecaHtml(c, 'Contato', '/contato')}
<p>E-mail: <a href="mailto:${esc(email)}">${esc(email)}</a>. Quem já usa a MIMO encontra o canal de ajuda dentro do painel.</p>
${c.nota ? mdParaHtml(c.nota) : ''}
</main>`
}

// ---- termos e privacidade --------------------------------------------------------------------
// tipos: TIPOS_LEGAIS; docs: { [tipo]: { titulo, versao, conteudo, publicado_em } }
export function corpoDeTermos(tipos, docs) {
  return `<main>
${migalhas([['Início', '/'], ['Termos e privacidade', '/termos']])}
<h1>O combinado, por escrito.</h1>
<p>Cada pessoa aceita o documento que vale pra ela. Aqui ficam todos, com a versão e a data de cada um.</p>
${lista(tipos, (t) => { const d = docs?.[t.tipo]; return `<a href="${esc(t.rota)}">${esc(t.rotulo)}</a>${t.para ? ` — ${esc(t.para)}` : ''}${d?.versao ? ` (versão ${esc(d.versao)})` : ''}` })}
</main>`
}
export function corpoLegal(tipo, doc) {
  return `<main>
${migalhas([['Início', '/'], ['Termos e privacidade', '/termos'], [doc.titulo, tipo.rota]])}
<h1>${esc(doc.titulo)}</h1>
<p><small>${[doc.versao ? `Versão ${esc(doc.versao)}` : '', doc.publicado_em ? `publicada em ${dataBr(doc.publicado_em)}` : ''].filter(Boolean).join(', ')}</small></p>
${mdParaHtml(doc.conteudo)}
</main>`
}

// ---- a home ---------------------------------------------------------------------------------
export function corpoDaHome(c = {}, faq = [], { hub = '/sistema-para-salao-de-beleza', hubAutonoma = '/app-para-profissional-de-beleza' } = {}) {
  return `<main>
${c.kicker ? `<p>${esc(c.kicker)}</p>` : ''}
<h1>${esc(linhasDe(c.h1).join(' '))}</h1>
${c.lead ? `<p>${esc(c.lead)}</p>` : ''}
${c.lead2 ? `<p>${esc(c.lead2)}</p>` : ''}
${lista(linhasDe(c.provas))}
<section><h2>Para salões</h2><p>Agenda por profissional, cliente marcando sozinha pelo link, confirmação no WhatsApp, sinal por Pix, lista de espera e comanda. <a href="${esc(hub)}">Sistema para salão de beleza</a>.</p></section>
<section><h2>Para autônomas</h2><p>Uma agenda profissional, QR e link próprios, clientes e histórico, retorno de clientes. Grátis para sempre. <a href="${esc(hubAutonoma)}">App para profissional de beleza</a>.</p></section>
<section><h2>Planos</h2><p>Autônoma grátis. MIMO Pro por R$ 49,90 por mês até 3 profissionais. MIMO Pro+ por R$ 149,90 por mês para 11 ou mais. <a href="/planos">Ver os planos</a>.</p></section>
${faqHtml(faq)}
<p><a href="/blog">Blog da MIMO</a> · <a href="/saloes">Guia de salões de beleza</a></p>
</main>`
}
