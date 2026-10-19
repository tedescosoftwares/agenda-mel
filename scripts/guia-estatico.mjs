// O guia de salões no HTML estático (chamado por paginas-estaticas.mjs).
// Recebe o que guia_publicadas() devolve e monta uma página por rota:
// /saloes, /saloes/<cidade>, /saloes/<cidade>/<categoria>,
// /saloes/<cidade>/<salão> e as coleções (3.12) /saloes/<cidade>/bairro/<b> e
// /saloes/<cidade>/horario/<h>[/<categoria>] (só as que passam do mínimo de
// salões, as mesmas de guiaColecoes.js), com título, descrição, JSON-LD e o CORPO já
// escrito dentro de <div id="root">. O robô que não roda JavaScript lê o
// texto inteiro; a pessoa recebe o app, que troca esse corpo ao abrir.
// Tudo o que vem do banco passa por esc().
import {
  GUIA_CATEGORIAS, categoriaDoGuia, conteudoSeguro, faqDaPagina, horariosResumo, atributosEmTexto,
  rotaDoGuia, rotaDaCidade, rotaDaCategoria, rotaDoLugar, seoPadraoDaCidade, fotosDoLugar, altDaFoto, categoriasDaLista, quemEsta } from '../src/lib/guia.js'
import { artigosDaCidade } from '../src/lib/guiaArtigos.js'
import {
  seoDoLugar, seoDaCidade, seoDoIndice, trilhaDoLugar, trilhaDaCidade,
  jsonLdDoLugar, jsonLdDaCidade, jsonLdDoIndice,
  seoDaColecao, jsonLdDaColecao, trilhaDaColecao,
} from '../src/lib/guiaSeo.js'
import { colecoesDaCidade, montarColecao, linksDeColecoes, linkDoBairro } from '../src/lib/guiaColecoes.js'
import { panoramaDaCidade, juntarFaq, tituloDoPanorama } from '../src/lib/guiaPanorama.js'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const SITE = 'https://mimo.com.vc'
// a imagem do link (og:image): a primeira foto, com endereço completo
const imagemDoLugar = (l) => { const f = fotosDoLugar(l)[0]; return f ? (f.startsWith('/') ? SITE + f : f) : undefined }
// as fotos no HTML estático (3.14): o robô lê o alt e o Google Imagens indexa
const fotosHtml = (l) => { const fs = fotosDoLugar(l); return fs.length ? `<section><h2>Fotos</h2>${fs.map((f, i) => `<figure><img src="${esc(f)}" alt="${esc(altDaFoto(l, i))}"${i ? ' loading="lazy"' : ''} /></figure>`).join('')}</section>` : '' }
// "Leia também" e "Salões em outras cidades" nas páginas de cidade e de categoria
const leiaTambem = (artigos) => (artigos?.length ? `<section><h2>Leia também</h2><ul>${artigos.slice(0, 3).map((a) => `<li><a href="/blog/${esc(a.slug)}">${esc(a.title)}</a></li>`).join('')}</ul></section>` : '')
const outrasCidades = (cidades, atual) => { const o = (cidades ?? []).filter((c) => c.cidade_slug !== atual); return o.length ? `<nav aria-label="Outras cidades"><h2>Salões em outras cidades</h2><ul>${o.map((c) => `<li><a href="${esc(rotaDaCidade(c.cidade_slug))}">${esc(`Salões em ${c.cidade}`)}</a> (${c.total})</li>`).join('')}</ul></nav>` : '' }
const dia = (v) => (v ? String(v).slice(0, 10) : undefined)
const migalhas = (trilha) => `<nav aria-label="Você está em">${trilha.map(([n, r], i) => (i < trilha.length - 1 ? `<a href="${esc(r)}">${esc(n)}</a> › ` : `<span>${esc(n)}</span>`)).join('')}</nav>`
const faqHtml = (faq) => (faq.length ? `<section><h2>Perguntas frequentes</h2>${faq.map((f) => `<h3>${esc(f.pergunta)}</h3><p>${esc(f.resposta)}</p>`).join('')}</section>` : '')
const listaDeCartoes = (cartoes, cidadeSlug) => `<ul>${cartoes.map((c) => `<li><a href="${esc(rotaDoLugar(cidadeSlug, c.slug))}">${esc(c.nome)}</a>${c.bairro ? ` (${esc(c.bairro)})` : ''}${c.resumo ? `: ${esc(c.resumo)}` : ''}</li>`).join('')}</ul>`

function corpoDoLugar(l, c, faq, bairro = null) {
  const cat = categoriaDoGuia(l.categoria)
  const horas = horariosResumo(l.horarios)
  const endereco = [l.endereco, l.bairro, `${l.cidade}${l.uf ? ` - ${l.uf}` : ''}`, l.cep].filter(Boolean).join(', ')
  return `<main>
${migalhas(trilhaDoLugar(l))}
<h1>${esc(l.nome)}</h1>
<p>${esc(c.chamada || `${cat.curto} em ${l.cidade}${l.bairro ? `, no bairro ${l.bairro}` : ''}.`)}</p>
${fotosHtml(l)}
<section><h2>Endereço e horário</h2><p>${esc(endereco)}</p>${horas.length ? `<ul>${horas.map((h) => `<li>${esc(h.dias)}: ${esc(h.horas)}</li>`).join('')}</ul>` : ''}${l.telefone ? `<p>Telefone: ${esc(l.telefone)}</p>` : ''}${l.servicos?.length ? `<p>Serviços: ${esc(l.servicos.join(', '))}</p>` : ''}${atributosEmTexto(l.atributos).map((a) => `<p>${esc(a.rotulo)}: ${esc(a.texto)}</p>`).join('')}</section>
${c.sobre.length ? `<section><h2>Sobre ${esc(l.nome)}</h2>${c.sobre.map((p) => `<p>${esc(p)}</p>`).join('')}</section>` : ''}
${c.destaques.length ? `<section>${c.destaques.map((d) => `<h3>${esc(d.titulo)}</h3><p>${esc(d.texto)}</p>`).join('')}</section>` : ''}
${c.dicas.itens.length ? `<section><h2>${esc(c.dicas.titulo || 'Dicas')}</h2><ul>${c.dicas.itens.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></section>` : ''}
${faqHtml(faq)}
${l.vizinhos?.length ? `<section><h2>Perto dali</h2>${listaDeCartoes(l.vizinhos, l.cidade_slug)}</section>` : ''}
<p><a href="${esc(rotaDaCategoria(l.cidade_slug, l.categoria))}">${esc(`${cat.rotulo} em ${l.cidade}`)}</a> · <a href="${esc(rotaDaCidade(l.cidade_slug))}">${esc(`Salões em ${l.cidade}`)}</a>${bairro ? ` · <a href="${esc(bairro.caminho)}">${esc(bairro.rotulo)}</a>` : ''}</p>
${l.na_mimo ? '' : `<p><small>Página informativa feita pela MIMO com dados públicos do estabelecimento. ${esc(l.nome)} ainda não agenda pela MIMO.</small></p>`}
</main>`
}

// cidade grande (3.20): a lista estática para em 96 na cidade e 240 na categoria; o resto dos links
// o Google acha pelas páginas de bairro e de categoria (e pelo "mesma categoria" de cada salão).
// Uma página com 1.500 links dilui o peso de cada um e não indexa melhor.
export const limiteDaLista = (categoria) => (categoria ? 240 : 96)

// os links das coleções: [{ caminho, rotulo, total }]
const navDeColecoes = (titulo, links) => (links.length ? `<nav aria-label="${esc(titulo)}"><h2>${esc(titulo)}</h2><ul>${links.map((x) => `<li><a href="${esc(x.caminho)}">${esc(x.rotulo)}</a> (${x.total})</li>`).join('')}</ul></nav>` : '')

function corpoDaCidade(dados, faq, colecoes = null, extras = {}, panorama = null) {
  const c = conteudoSeguro(dados.pagina) ?? conteudoSeguro({})
  const { h1 } = seoDaCidade(dados.cidade, dados.cidade_slug, dados.categoria, dados.pagina)
  const outras = (dados.categorias ?? []).filter((x) => x.categoria !== dados.categoria)
  return `<main>
${migalhas(trilhaDaCidade(dados.cidade, dados.cidade_slug, dados.categoria))}
<h1>${esc(h1)}</h1>
<p>${esc(c.chamada || seoPadraoDaCidade(dados.cidade, dados.categoria).meta_description)}</p>
${c.intro.map((p) => `<p>${esc(p)}</p>`).join('')}
${panorama?.paragrafos?.length ? `<section><h2>${esc(tituloDoPanorama(dados.cidade, dados.categoria))}</h2>${panorama.paragrafos.map((p) => `<p>${esc(p)}</p>`).join('')}</section>` : ''}
<section><h2>${esc(dados.categoria ? `${categoriaDoGuia(dados.categoria).rotulo} em ${dados.cidade}` : `Salões em ${dados.cidade}`)}</h2>${listaDeCartoes(dados.lugares.slice(0, limiteDaLista(dados.categoria)), dados.cidade_slug)}${dados.lugares.length > limiteDaLista(dados.categoria) ? `<p>${esc(`Aqui estão os ${limiteDaLista(dados.categoria)} primeiros de ${dados.lugares.length}. Os outros estão nas páginas por bairro e por categoria.`)}</p>` : ''}</section>
${c.como_escolher.itens.length ? `<section><h2>${esc(c.como_escolher.titulo || 'Como escolher')}</h2><ul>${c.como_escolher.itens.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></section>` : ''}
${colecoes ? navDeColecoes('Por horário', dados.categoria ? colecoes.categorias[dados.categoria] ?? [] : colecoes.horarios) : ''}
${colecoes && !dados.categoria ? navDeColecoes('Por bairro', colecoes.bairros) : ''}
${faqHtml(faq)}
${outras.length ? `<nav aria-label="Categorias"><h2>${esc(dados.categoria ? `Outras categorias em ${dados.cidade}` : `Por categoria em ${dados.cidade}`)}</h2><ul>${outras.map((x) => { const k = categoriaDoGuia(x.categoria); const quem = quemEsta(x.nomes, x.total); return `<li><a href="${esc(rotaDaCategoria(dados.cidade_slug, x.categoria))}">${esc(`${k.rotulo} em ${dados.cidade}`)}</a>${k.resumo ? `: ${esc(k.resumo)}` : ''}. ${x.total} ${x.total === 1 ? 'lugar' : 'lugares'}${quem ? `, como ${esc(quem)}` : ''}.</li>` }).join('')}</ul></nav>` : ''}
${dados.categoria ? `<p><a href="${esc(rotaDaCidade(dados.cidade_slug))}">${esc(`Todos os salões de ${dados.cidade}`)}</a></p>` : ''}
${leiaTambem(extras.artigos)}
${outrasCidades(extras.cidades, dados.cidade_slug)}
</main>`
}

// uma coleção (bairro ou horário): o mesmo texto da página do site (montarColecao)
function corpoDaColecao(m) {
  const r = m.relacionadas
  return `<main>
${migalhas(trilhaDaColecao(m))}
<h1>${esc(m.h1)}</h1>
<p>${esc(m.chamada)}</p>
${m.intro.map((p) => `<p>${esc(p)}</p>`).join('')}
<section><h2>${esc(m.tipo === 'bairro' ? `Os endereços ${/^centro$/i.test(m.nome) ? 'do Centro' : `do bairro ${m.nome}`}` : m.h1)}</h2>${listaDeCartoes(m.cartoes, m.cidade_slug)}</section>
${faqHtml(m.faq)}
${navDeColecoes('No mesmo horário, outras categorias', r.categorias)}
${navDeColecoes('Por horário', r.horarios)}
${navDeColecoes(m.tipo === 'bairro' ? 'Outros bairros' : 'Por bairro', r.bairros)}
<p><a href="${esc(rotaDaCidade(m.cidade_slug))}">${esc(`Todos os salões de ${m.cidade}`)}</a>${m.categoria ? ` · <a href="${esc(rotaDaCategoria(m.cidade_slug, m.categoria))}">${esc(`${categoriaDoGuia(m.categoria).rotulo} em ${m.cidade}`)}</a>` : ''}</p>
</main>`
}

// o mesmo agrupamento de guia_cidade(), feito aqui a partir da lista inteira. A ordem é a que
// guia_publicadas() mandou (3.17, migração 166: MIMO, Seleção, pontos de nota e foto, nome), e
// filtrar por categoria não a muda; a nota não vem para cá, então não dá para reordenar aqui.
const cartao = (l) => ({ slug: l.slug, nome: l.nome, bairro: l.bairro, categoria: l.categoria, resumo: l.conteudo?.resumo ?? null, servicos: (l.servicos ?? []).slice(0, 4), selecao: l.selecao, na_mimo: l.na_mimo })
function dadosDaCidade(lugares, paginas, cidadeSlug, categoria) {
  const daCidade = lugares.filter((l) => l.cidade_slug === cidadeSlug)
  const lista = categoria ? daCidade.filter((l) => l.categoria === categoria) : daCidade
  const contar = (ls, campo) => [...ls.reduce((m, l) => (l[campo] ? m.set(l[campo], (m.get(l[campo]) ?? 0) + 1) : m), new Map())].map(([k, total]) => ({ [campo]: k, total })).sort((a, b) => b.total - a.total)
  const pagina = paginas.find((p) => p.cidade_slug === cidadeSlug && (p.categoria ?? '') === categoria)
  return {
    cidade: daCidade[0].cidade, cidade_slug: cidadeSlug, uf: daCidade[0].uf, categoria, pagina: pagina?.conteudo ?? null, total: daCidade.length,
    categorias: categoriasDaLista(daCidade), bairros: contar(lista, 'bairro'), lugares: lista.map(cartao),
    atualizado: [...lista.map((l) => dia(l.atualizado_em)), dia(pagina?.atualizado_em)].filter(Boolean).sort().at(-1),
  }
}

// guia: o que guia_publicadas() devolve; artigos: [{ slug, title }] dos artigos publicados (para "Leia também")
export function paginasDoGuia(guia, artigos = []) {
  const lugares = Array.isArray(guia?.lugares) ? guia.lugares.filter((l) => l?.slug && l?.cidade_slug && l?.conteudo) : []
  const paginas = Array.isArray(guia?.paginas) ? guia.paginas : []
  if (!lugares.length) return []
  const out = []
  const cidades = [...new Set(lugares.map((l) => l.cidade_slug))]
  // as cidades com nome e total (o banco manda; sem ele, da própria lista)
  const listaCidades = Array.isArray(guia?.cidades) && guia.cidades.length ? guia.cidades
    : cidades.map((cs) => { const l = lugares.find((x) => x.cidade_slug === cs); return { cidade: l.cidade, cidade_slug: cs, uf: l.uf, total: lugares.filter((x) => x.cidade_slug === cs).length } })
  // a lista de cada cidade (a mesma lista para as contas das coleções, que guardam o resultado por lista)
  const daCidade = new Map(cidades.map((cs) => [cs, lugares.filter((l) => l.cidade_slug === cs)]))
  // os salões
  for (const l of lugares) {
    const c = conteudoSeguro(l.conteudo)
    const faq = faqDaPagina(l, c)
    const { titulo, descricao, caminho, noindex } = seoDoLugar(l, c)
    out.push({ caminho, titulo, descricao, noindex, atualizado: dia(l.atualizado_em), prioridade: '0.6', freq: 'monthly', imagem: imagemDoLugar(l), jsonLd: jsonLdDoLugar(l, c, faq), corpo: corpoDoLugar(l, c, faq, linkDoBairro(l, daCidade.get(l.cidade_slug))) })
  }
  // as cidades, as categorias e as coleções (bairro e horário) de cada uma
  for (const cs of cidades) {
    const doGuia = daCidade.get(cs)
    const colecoes = linksDeColecoes(doGuia, cs)
    const cats = ['', ...GUIA_CATEGORIAS.map((g) => g.slug).filter((s) => lugares.some((l) => l.cidade_slug === cs && l.categoria === s))]
    const extras = { artigos: artigosDaCidade(artigos, cs, listaCidades), cidades: listaCidades }
    for (const cat of cats) {
      const d = dadosDaCidade(lugares, paginas, cs, cat)
      // o panorama (3.22): os números da lista, montados aqui, e a FAQ dos dados junto com a da IA
      const panorama = panoramaDaCidade({ cidade: d.cidade, categoria: cat, lugares: d.lugares, completos: doGuia })
      const faq = juntarFaq(conteudoSeguro(d.pagina)?.faq ?? [], panorama.faq)
      const { titulo, descricao, caminho } = seoDaCidade(d.cidade, cs, cat, d.pagina)
      out.push({ caminho, titulo, descricao, atualizado: d.atualizado, prioridade: cat ? '0.7' : '0.8', freq: 'weekly', jsonLd: jsonLdDaCidade(d, faq), corpo: corpoDaCidade(d, faq, colecoes, extras, panorama) })
    }
    for (const col of colecoesDaCidade(doGuia, cs)) {
      const m = montarColecao(col, doGuia)
      const { titulo, descricao, caminho } = seoDaColecao(m)
      out.push({ caminho, titulo, descricao, atualizado: m.atualizado, prioridade: '0.6', freq: 'weekly', jsonLd: jsonLdDaColecao(m), corpo: corpoDaColecao(m) })
    }
  }
  // o índice: as cidades e, por categoria, as cidades que a têm (3.19)
  const lista = cidades.map((cs) => { const l = lugares.find((x) => x.cidade_slug === cs); return { cidade: l.cidade, cidade_slug: cs, uf: l.uf, total: daCidade.get(cs).length, categorias: categoriasDaLista(daCidade.get(cs)).map(({ categoria, total }) => ({ categoria, total })) } })
  const porCategoria = GUIA_CATEGORIAS.map((k) => ({ k, cidades: lista.map((c) => ({ c, n: c.categorias.find((x) => x.categoria === k.slug)?.total ?? 0 })).filter((x) => x.n > 0) })).filter((x) => x.cidades.length)
  const ix = seoDoIndice()
  out.push({
    caminho: rotaDoGuia(), titulo: ix.titulo, descricao: ix.descricao, prioridade: '0.6', freq: 'weekly', jsonLd: jsonLdDoIndice(lista),
    atualizado: lugares.map((l) => dia(l.atualizado_em)).filter(Boolean).sort().at(-1),
    corpo: `<main><h1>Guia de salões de beleza</h1><ul>${lista.map((c) => `<li><a href="${esc(rotaDaCidade(c.cidade_slug))}">${esc(`Salões em ${c.cidade}`)}</a> (${c.total})</li>`).join('')}</ul>${porCategoria.length ? `<section><h2>Por categoria</h2><ul>${porCategoria.map(({ k, cidades: cs }) => `<li>${esc(k.rotulo)}${k.resumo ? `: ${esc(k.resumo)}` : ''}. ${cs.map(({ c, n }) => `<a href="${esc(rotaDaCategoria(c.cidade_slug, k.slug))}">${esc(c.cidade)}</a> (${n})`).join(' · ')}</li>`).join('')}</ul></section>` : ''}</main>`,
  })
  return out
}
