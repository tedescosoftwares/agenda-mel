import { useMemo, useState } from 'react'
import { Painel, Pilula, Vazio, haQuanto } from '../Pecas'
import { PreviaGoogle } from './Previa'
import EscolhaIA from './EscolhaIA'
import { GUIA_CATEGORIAS, categoriaDoGuia, conteudoSeguro, rotaDaCidade, rotaDaCategoria } from '../../../lib/guia'
import { seoDaCidade } from '../../../lib/guiaSeo'
import { urlDoAmbiente } from '../../../lib/ambiente'
import EditarPagina from './EditarPagina'
import { enviarFotoDaCidade } from '../../../lib/guiaFotos'
import { MapPinned, Check, RefreshCw, Sparkles, ExternalLink, LoaderCircle, TriangleAlert, BookOpen, Wand2, Globe, Pencil, ImagePlus, Trash2, Image as ImagemIcone } from 'lucide-react'

// O texto da página da cidade (/saloes/itanhaem) e de cada categoria
// (/saloes/itanhaem/unhas). As linhas nascem sozinhas na importação; a
// página aparece no site assim que tiver um salão publicado, com o texto
// padrão enquanto não houver um aprovado aqui.
//
// Na linha da cidade há também "Sobre a cidade" (3.22, migração 170): o que a
// redação sabe da cidade (região, tipo de cidade, temporada, como ela se
// organiza). Não aparece no site; a IA usa em todas as páginas da cidade, a da
// cidade, as de categoria e a de cada salão, para o texto não sair igual ao de
// qualquer outra cidade.

const ORDEM_CAT = Object.fromEntries(['', ...GUIA_CATEGORIAS.map((c) => c.slug)].map((s, i) => [s, i]))
const ROTULO = { sem: 'sem texto', revisar: 'para revisar', nova: 'no ar · versão nova', no_ar: 'no ar' }
const TOM = { sem: 'cinza', revisar: 'ambar', nova: 'roxo', no_ar: 'menta' }

function faseDaPagina(p) {
  if (p.status === 'publicado') return p.rascunho ? 'nova' : 'no_ar'
  return p.rascunho || p.conteudo ? 'revisar' : 'sem'
}
const tituloDe = (p) => (p.categoria ? `${categoriaDoGuia(p.categoria).rotulo} em ${p.cidade}` : `Página da cidade · ${p.cidade}`)

export default function PaginasCidade({ g }) {
  const [selId, setSelId] = useState(null)
  const [versao, setVersao] = useState('rascunho')
  const [instr, setInstr] = useState('')
  const [erro, setErro] = useState('')
  const [aprovando, setAprovando] = useState(false)
  const [ctx, setCtx] = useState(null) // { id, texto } do que está sendo digitado; sem isso, o que está no banco
  const [salvandoCtx, setSalvandoCtx] = useState(false)
  const [confira, setConfira] = useState(null) // { id, itens, modelo }: o que a IA pediu para conferir na sugestão (3.28)
  const [editando, setEditando] = useState(false) // 3.32: o editor do texto da página
  const [enviandoFoto, setEnviandoFoto] = useState(false) // 3.32: a foto da cidade subindo

  // quantos salões no ar em cada página (a da cidade conta todos): dos totais por cidade (3.25, migração 174),
  // que valem para todas as cidades; num banco sem eles, da lista carregada
  const noAr = useMemo(() => {
    const m = {}
    if (Array.isArray(g.resumo)) {
      for (const r of g.resumo) {
        m[`${r.cidade_slug}/`] = Number(r.no_ar ?? 0)
        for (const [c, n] of Object.entries(r.categorias ?? {})) m[`${r.cidade_slug}/${c}`] = Number(n ?? 0)
      }
      return m
    }
    for (const l of g.lugares) if (l.status === 'publicado') {
      m[`${l.cidade_slug}/`] = (m[`${l.cidade_slug}/`] ?? 0) + 1
      m[`${l.cidade_slug}/${l.categoria}`] = (m[`${l.cidade_slug}/${l.categoria}`] ?? 0) + 1
    }
    return m
  }, [g.resumo, g.lugares])

  // as cidades que têm páginas, cada uma com as suas (a da cidade primeiro, depois as categorias)
  const cidades = useMemo(() => {
    const m = new Map()
    for (const p of [...g.paginas].sort((a, b) => a.cidade.localeCompare(b.cidade, 'pt-BR') || (ORDEM_CAT[a.categoria] ?? 99) - (ORDEM_CAT[b.categoria] ?? 99))) {
      if (!m.has(p.cidade_slug)) m.set(p.cidade_slug, { slug: p.cidade_slug, nome: p.cidade, paginas: [], pendentes: 0, noAr: noAr[`${p.cidade_slug}/`] ?? 0 })
      const c = m.get(p.cidade_slug)
      c.paginas.push(p)
      if (['revisar', 'nova'].includes(faseDaPagina(p))) c.pendentes++
    }
    return [...m.values()]
  }, [g.paginas, noAr])
  // 3.29: uma cidade por vez na lista (eram 29 cidades com 8 páginas cada, numa rolagem só). A escolhida no alto da
  // tela manda; dá para trocar aqui também, e a troca vale para a tela inteira
  // (a escolha local vale enquanto a cidade do alto não muda; mudou, a do alto manda de novo: derivado, sem efeito)
  const [sel, setSel] = useState(null) // { base: a cidade do alto na hora da escolha, slug }
  const cidadeSel = sel && sel.base === g.cidade ? sel.slug : g.cidade || null
  const cidadeAtiva = cidades.find((c) => c.slug === cidadeSel) ?? cidades.find((c) => c.pendentes) ?? cidades[0] ?? null
  const daCidade = cidadeAtiva?.paginas ?? []
  const todas = cidades.flatMap((x) => x.paginas)
  // sem escolha, abre na página da cidade que espera revisão; senão na da cidade
  const atual = daCidade.find((p) => p.id === selId) ?? daCidade.find((p) => faseDaPagina(p) === 'revisar' || faseDaPagina(p) === 'nova') ?? daCidade[0] ?? null
  function escolher(id) { setSelId(id); setVersao('rascunho'); setInstr(''); setErro('') }
  function trocarCidade(slug) {
    setSel({ base: g.cidade, slug }); setSelId(null); setErro('')
    if (g.cidade !== slug && g.escolherCidade) g.escolherCidade(slug)
  }
  // a caixa "Sobre a cidade" (só a linha da cidade tem): o que se digita fica por página; o resto vem do banco
  const contexto = ctx && ctx.id === atual?.id ? ctx.texto : (atual?.contexto ?? '')
  const setContexto = (texto) => setCtx({ id: atual?.id, texto })

  if (g.carregando) return <Painel Icon={MapPinned} titulo="Páginas da cidade"><Vazio>Carregando…</Vazio></Painel>
  if (!todas.length) return (
    <Painel Icon={MapPinned} titulo="Páginas da cidade" sub="O texto da página de cada cidade e de cada categoria.">
      <Vazio>Nenhuma página ainda. Elas aparecem sozinhas depois da primeira importação (uma por cidade e uma por categoria que tiver salão).</Vazio>
    </Painel>
  )

  const fase = atual ? faseDaPagina(atual) : null
  const ger = atual ? g.gerando[atual.id] : null
  const falha = atual ? g.falhas[atual.id] : null
  const mostrado = atual ? (versao === 'no_ar' && atual.conteudo ? atual.conteudo : (atual.rascunho ?? atual.conteudo)) : null
  const c = conteudoSeguro(mostrado)
  const nNoAr = atual ? (noAr[`${atual.cidade_slug}/${atual.categoria}`] ?? 0) : 0
  const caminho = atual ? (atual.categoria ? rotaDaCategoria(atual.cidade_slug, atual.categoria) : rotaDaCidade(atual.cidade_slug)) : '/'
  const seo = atual ? seoDaCidade(atual.cidade, atual.cidade_slug, atual.categoria, mostrado) : null
  const sem = c?._meta?.semelhanca

  async function gerar() {
    setErro('')
    const r = await g.gerarPagina(atual.id, instr)
    if (r.ok) { setInstr(''); setVersao('rascunho') }
  }
  async function aprovar() {
    setAprovando(true); setErro('')
    const r = await g.aprovarPagina(atual.id)
    setAprovando(false)
    if (!r.ok) { setErro(r.erro); return }
    g.avisar({ texto: `${tituloDe(atual)}: texto no ar.`, tom: 'ok' })
  }
  async function salvarContexto(e) {
    e.preventDefault()
    setSalvandoCtx(true); setErro('')
    const r = await g.salvarContexto(atual.id, contexto)
    setSalvandoCtx(false)
    if (!r.ok) { setErro(r.erro); return }
    setCtx(null); setConfira(null)
    g.avisar({ texto: `Sobre ${atual.cidade}: guardado. Vale para os próximos textos gerados da cidade.`, tom: 'ok' })
  }
  const ctxMudou = (contexto ?? '').trim() !== (atual?.contexto ?? '').trim()
  // a IA sugere o "Sobre a cidade" (3.28): entra na caixa para a pessoa ler, mexer e guardar
  const sugerindo = atual ? g.gerando[`ctx:${atual.id}`] : null
  // a foto da cidade (3.32, migração 177): sobe pelo mesmo caminho das fotos dos salões e fica na linha da cidade
  async function enviarFoto(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || !atual) return
    setErro(''); setEnviandoFoto(true)
    try {
      const { url } = await enviarFotoDaCidade(atual.cidade_slug, f)
      const r = await g.salvarPagina(atual.id, { foto: url })
      if (!r.ok) setErro(r.erro)
      else g.avisar({ texto: `Foto de ${atual.cidade} guardada. Entra no site na próxima publicação.`, tom: 'ok' })
    } catch (err) { setErro(err.message || 'não deu para enviar a foto') } finally { setEnviandoFoto(false) }
  }
  async function tirarFoto() {
    if (!atual) return
    const r = await g.salvarPagina(atual.id, { foto: null })
    if (!r.ok) setErro(r.erro)
  }
  async function sugerir() {
    if (!atual || sugerindo) return
    setErro('')
    const r = await g.sugerirContexto(atual.id)
    if (!r.ok) { setErro(`Não deu para sugerir: ${r.erro}`); return }
    setCtx({ id: atual.id, texto: r.texto })
    setConfira({ id: atual.id, itens: r.confira, modelo: r.modelo, fontes: r.fontes, pesquisou: r.pesquisou })
  }
  // escrever todas (3.30): as páginas de cidade cuja descrição ainda é a semente ou está vazia (o que a IA já escreveu
  // e o que a equipe editou ficam; para refazer um, "Melhorar com a IA" na cidade)
  const paraEscrever = todas.filter((p) => !p.categoria && (!p.contexto || p.contexto_origem === 'semente'))
  const andamento = g.contextos
  const origem = atual?.contexto_origem
  const fontesGravadas = atual?.contexto_fontes && typeof atual.contexto_fontes === 'object' ? atual.contexto_fontes : null

  return (
    <div className="pg-paginas">
      <aside className="pg-paginas-lista plat-painel">
        <label className="pg-paginas-cidade" data-teste="paginas-cidade">
          <span>Cidade</span>
          <select className="plat-select" value={cidadeAtiva?.slug ?? ''} onChange={(e) => trocarCidade(e.target.value)} aria-label="Cidade das páginas">
            {cidades.map((c) => <option key={c.slug} value={c.slug}>{c.nome}{c.pendentes ? ` · ${c.pendentes} para revisar` : ''}{c.noAr ? '' : ' · fora do site'}</option>)}
          </select>
          <small>{cidades.length === 1 ? '1 cidade com páginas' : `${cidades.length} cidades com páginas`}{cidadeAtiva && !cidadeAtiva.noAr ? ' · esta ainda não tem salão no ar' : ''}</small>
        </label>
        <div className="pg-paginas-todas" data-teste="escrever-todas">
          <button type="button" className="btn btn-ghost pg-btn-peq" onClick={() => g.escreverContextos(paraEscrever)} disabled={!paraEscrever.length || (andamento && !andamento.fim)} title={paraEscrever.length ? 'A IA escreve o "Sobre a cidade" das cidades que ainda estão com a semente geral ou vazias, uma por vez, gravando. O que ela já escreveu e o que a equipe editou ficam. No Gemini, ela pesquisa no Google e guarda as fontes.' : 'Todas as cidades já têm o "Sobre a cidade" escrito. Para refazer um, "Melhorar com a IA" na cidade.'}>
            {andamento && !andamento.fim ? <><LoaderCircle size={14} className="pg-gira" /> {andamento.feitos} de {andamento.total} · {andamento.atual}…</> : <><Globe size={14} /> Escrever o "Sobre a cidade" de todas ({paraEscrever.length})</>}
          </button>
          {andamento?.fim && <small>{andamento.feitos - andamento.erros.length} {andamento.feitos - andamento.erros.length === 1 ? 'escrita' : 'escritas'}{andamento.erros.length ? ` · ${andamento.erros.length} com erro (${andamento.erros.map(([c, e]) => `${c}: ${e}`).join('; ').slice(0, 160)})` : ''}</small>}
        </div>
        {[['Página da cidade', daCidade.filter((p) => !p.categoria)], ['Por categoria', daCidade.filter((p) => p.categoria)]].map(([titulo, paginas]) => paginas.length > 0 && (
          <div key={titulo} className="pg-paginas-grupo">
            <h4>{titulo}</h4>
            {paginas.map((p) => {
              const f = faseDaPagina(p)
              const n = noAr[`${p.cidade_slug}/${p.categoria}`] ?? 0
              return (
                <button key={p.id} type="button" className={'pg-item' + (p.id === atual?.id ? ' ativo' : '')} onClick={() => escolher(p.id)}>
                  <span className="pg-item-nome">
                    <b>{p.categoria ? categoriaDoGuia(p.categoria).rotulo : cidadeAtiva?.nome ?? 'Página da cidade'}</b>
                    {g.gerando[p.id] ? <LoaderCircle size={14} className="pg-gira pg-item-gerando" /> : <i className={'pg-ponto ' + TOM[f]} title={ROTULO[f]} />}
                  </span>
                  <span className="pg-item-sub"><span>{ROTULO[f]} · {n ? `${n} no ar` : 'fora do site (nenhum salão no ar)'}</span></span>
                </button>
              )
            })}
          </div>
        ))}
      </aside>

      {atual && (
        <section className="pg-paginas-detalhe plat-painel">
          <div className="pg-acoes-topo">
            <div className="pg-acoes-nome"><h2>{tituloDe(atual)}</h2><Pilula tom={TOM[fase]}>{ROTULO[fase]}</Pilula></div>
            {nNoAr > 0 && <a className="plat-link" href={urlDoAmbiente('cliente', caminho)} target="_blank" rel="noopener noreferrer">ver no site <ExternalLink size={12} /></a>}
          </div>
          <p className="pg-acoes-sub">
            {nNoAr ? `No site com ${nNoAr} ${nNoAr === 1 ? 'salão' : 'salões'}` : 'Ainda fora do site: entra quando o primeiro salão daqui for publicado'}
            {fase === 'sem' || fase === 'revisar' ? ' · sem texto aprovado, o site usa o texto padrão' : ''}
            {atual.gerado_em ? ` · gerado ${haQuanto(atual.gerado_em)}` : ''}
            {mostrado?._meta?.modelo ? ` · IA ${String(mostrado._meta.modelo).replace(/^.*\//, '')}` : ''}
          </p>
          <div className="pg-botoes">
            <button type="button" className="btn btn-primary" onClick={aprovar} disabled={!atual.rascunho || aprovando || !!ger}>{aprovando ? <LoaderCircle size={16} className="pg-gira" /> : <Check size={16} />} {fase === 'nova' ? 'Publicar versão nova' : 'Aprovar'}</button>
            <button type="button" className="btn btn-ghost" onClick={gerar} disabled={!!ger}>{ger ? <LoaderCircle size={16} className="pg-gira" /> : fase === 'sem' ? <Sparkles size={16} /> : <RefreshCw size={16} />} {ger ? (ger.espera ? `Tentando de novo em ${ger.espera} s` : 'Gerando…') : fase === 'sem' ? 'Gerar' : 'Gerar de novo'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditando(true)} disabled={!!ger} title="Editar o texto à mão, ou colar o que o seu GPT escreveu"><Pencil size={16} /> Editar texto</button>
            <EscolhaIA g={g} />
            {fase === 'nova' && (
              <div className="pg-seg">
                <button type="button" className={versao === 'rascunho' ? 'ativo' : ''} onClick={() => setVersao('rascunho')}>Versão nova</button>
                <button type="button" className={versao === 'no_ar' ? 'ativo' : ''} onClick={() => setVersao('no_ar')}>No ar</button>
              </div>
            )}
          </div>
          <form className="pg-instrucao" onSubmit={(e) => { e.preventDefault(); gerar() }}>
            <input value={instr} onChange={(e) => setInstr(e.target.value.slice(0, 400))} placeholder="O que mudar? (opcional) Ex.: fale mais da orla, menos formal…" aria-label="O que mudar no texto" disabled={!!ger} />
          </form>
          {erro && <div className="alert alert-error">{erro}</div>}
          {falha && !ger && <div className="alert alert-error">Não deu para gerar: {falha}</div>}

          {atual.categoria === '' && (
            <form className="pg-contexto" onSubmit={salvarContexto} data-teste="sobre-a-cidade">
              <div className="pg-contexto-cabeca">
                <BookOpen size={16} />
                <div>
                  <b>Sobre {atual.cidade}</b>
                  <span>O que a redação sabe da cidade. Não aparece no site: a IA usa em todas as páginas de {atual.cidade} (cidade, categorias e cada salão), para o texto não sair igual ao de qualquer outra cidade. O que mais ajuda: como a cidade se organiza (o Centro, os bairros de praia e os de moradores, o que fica ao norte e ao sul, a rodovia que a corta), as avenidas de comércio, a temporada e quem vem, as referências que quem mora conhece (praça, orla, rio). Só coisa certa e geral; nada de opinião sobre bairro ("tranquilo", "movimentado").</span>
                </div>
              </div>
              <textarea value={contexto} onChange={(e) => setContexto(e.target.value.slice(0, 1500))} rows={5} placeholder={`Ex.: ${atual.cidade} fica no litoral sul de São Paulo. O Centro, junto à orla, concentra o comércio; ao norte ficam os bairros de praia (…), ao sul (…), e para dentro, em volta da rodovia, os bairros de moradores (…). O movimento cresce no verão e nos feriados…`} aria-label={`Sobre ${atual.cidade}`} disabled={salvandoCtx} />
              {confira && confira.id === atual.id && (confira.itens.length > 0 || confira.fontes?.length > 0) && (
                <div className="pg-contexto-confira" data-teste="confira">
                  <b><TriangleAlert size={14} /> Antes de guardar, confira{confira.modelo ? ` (sugestão do ${String(confira.modelo).replace(/^.*\//, '')}${confira.pesquisou ? ', com pesquisa no Google' : ', de memória'})` : ''}:</b>
                  <ul>{confira.itens.map((x) => <li key={x}>{x}</li>)}</ul>
                  {confira.fontes?.length > 0 && <span className="pg-contexto-fontes">Fontes: {confira.fontes.map((f, i) => <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer">{i ? ' · ' : ''}{f.titulo}</a>)}</span>}
                </div>
              )}
              {!(confira && confira.id === atual.id) && origem && (
                <small className="pg-contexto-origem" data-teste="origem">
                  {origem === 'editado' ? 'Escrito pela equipe: a IA não mexe.' : origem === 'ia' ? `Escrito pela IA${fontesGravadas?.modelo ? ` (${String(fontesGravadas.modelo).replace(/^.*\//, '')}${fontesGravadas.pesquisou ? ', com pesquisa no Google' : ''})` : ''}; vale conferir e guardar para virar texto da equipe.` : 'Semente geral: a IA escreve por cima na primeira geração de uma página desta cidade (ou use o botão acima).'}
                  {origem === 'ia' && Array.isArray(fontesGravadas?.fontes) && fontesGravadas.fontes.length > 0 && <span className="pg-contexto-fontes"> Fontes: {fontesGravadas.fontes.map((f, i) => <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer">{i ? ' · ' : ''}{f.titulo}</a>)}</span>}
                </small>
              )}
              <div className="pg-contexto-pe">
                <small>{(contexto ?? '').length}/1500{!atual.contexto && !contexto ? ' · sem contexto, a IA escreve sem saber nada da cidade' : ''}</small>
                <span className="pg-contexto-botoes">
                  <button type="button" className="btn btn-ghost" onClick={sugerir} disabled={!!sugerindo || salvandoCtx} title="A IA escolhida ao lado de Gerar escreve o que sabe da cidade, ancorado nos bairros do guia. Você confere e guarda.">
                    {sugerindo ? <><LoaderCircle size={16} className="pg-gira" /> {sugerindo.espera ? `em ${sugerindo.espera} s` : 'Sugerindo…'}</> : <><Wand2 size={16} /> {contexto ? 'Melhorar com a IA' : 'Sugerir com a IA'}</>}
                  </button>
                  <button type="submit" className="btn btn-ghost" disabled={!ctxMudou || salvandoCtx}>{salvandoCtx ? <LoaderCircle size={16} className="pg-gira" /> : <Check size={16} />} Guardar</button>
                </span>
              </div>
            </form>
          )}

          {atual.categoria === '' && (
            <div className="pg-contexto pg-cidade-foto" data-teste="foto-da-cidade">
              <div className="pg-contexto-cabeca">
                <ImagemIcone size={16} />
                <div>
                  <b>Foto de {atual.cidade}</b>
                  <small>Aparece no alto da página da cidade e das categorias dela, e é a imagem do link no WhatsApp. Uma imagem na horizontal (16:9), sua ou gerada por IA; nada copiado da internet.</small>
                </div>
              </div>
              <div className="pg-cidade-foto-corpo">
                {atual.foto ? <img src={atual.foto} alt={`Foto de ${atual.cidade}`} /> : <div className="pg-cidade-foto-vazia">Sem foto ainda</div>}
                <div className="pg-cidade-foto-acoes">
                  <label className={'btn btn-ghost pg-btn-peq' + (enviandoFoto ? ' desligado' : '')}>
                    <input type="file" accept="image/*" onChange={enviarFoto} disabled={enviandoFoto} hidden data-teste="arquivo-foto-cidade" />
                    {enviandoFoto ? <LoaderCircle size={14} className="pg-gira" /> : <ImagePlus size={14} />} {enviandoFoto ? 'Enviando…' : atual.foto ? 'Trocar a foto' : 'Enviar a foto'}
                  </label>
                  {atual.foto && <button type="button" className="btn btn-ghost pg-btn-peq" onClick={tirarFoto}><Trash2 size={14} /> Tirar</button>}
                </div>
              </div>
            </div>
          )}

          <div className="pg-pagina-texto">
            <PreviaGoogle titulo={seo.titulo} descricao={seo.descricao} caminho={seo.caminho} tituloBruto={c?.seo_title || seo.titulo} descricaoBruta={c?.meta_description || seo.descricao} />
            {sem && Number(sem.indice) > 0.35 && <div className="pg-alerta ambar"><TriangleAlert size={16} /><div><b>Parecido com outra página ({Math.round(Number(sem.indice) * 100)}%)</b><span>Lembra a de {sem.slug}. Vale gerar de novo.</span></div></div>}
            {!c ? (
              <div className="pg-lista-vazia"><p>Sem texto ainda. No site, a página mostra o título padrão (<b>{seo.h1}</b>), os números e a lista dos salões.</p></div>
            ) : (
              <article className="pg-texto">
                <h1>{seo.h1}</h1>
                {c.chamada && <p className="pg-texto-chamada">{c.chamada}</p>}
                {c.intro.map((p, i) => <p key={i}>{p}</p>)}
                {c.como_escolher.itens.length > 0 && (
                  <>
                    <h3>{c.como_escolher.titulo || 'Como escolher'}</h3>
                    <ul>{c.como_escolher.itens.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </>
                )}
                {c.faq.length > 0 && (
                  <>
                    <h3>Perguntas frequentes</h3>
                    {c.faq.map((f, i) => <details key={i}><summary>{f.pergunta}</summary><p>{f.resposta}</p></details>)}
                  </>
                )}
              </article>
            )}
          </div>
        </section>
      )}
      {editando && atual && <EditarPagina pagina={atual} g={g} onFechar={() => setEditando(false)} />}
    </div>
  )
}
