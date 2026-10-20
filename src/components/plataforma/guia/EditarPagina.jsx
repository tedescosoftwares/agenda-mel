import { useEffect, useMemo, useRef, useState } from 'react'
import Portal from '../../Portal'
import { useDialogo } from '../../../context/DialogoContext'
import { PreviaGoogle } from './Previa'
import EscreverFora from './EscreverFora'
import { conteudoSeguro, categoriaDoGuia, rotaDaCidade, rotaDaCategoria } from '../../../lib/guia'
import { seoDaCidade } from '../../../lib/guiaSeo'
import { X, Plus, Trash2, LoaderCircle } from 'lucide-react'

// O texto de uma página de cidade ou de categoria, editável à mão (3.32): os mesmos campos que a IA
// escreve (título e descrição no Google, chamada, introdução, "como escolher" e perguntas). O que se
// salva vai para o rascunho e espera Aprovar, como o texto da IA; a página no ar não muda antes disso.
// "Escrever fora" copia o pedido da IA para o GPT de quem tem e preenche os campos com o JSON colado.

const vazio = () => ({ seo_title: '', meta_description: '', chamada: '', intro: [''], como_escolher: { titulo: '', itens: [''] }, faq: [], _meta: {} })
function textoDaPagina(conteudo) {
  const c = conteudoSeguro(conteudo)
  if (!c) return vazio()
  return {
    seo_title: c.seo_title, meta_description: c.meta_description, chamada: c.chamada,
    intro: c.intro.length ? c.intro : [''],
    como_escolher: { titulo: c.como_escolher.titulo, itens: c.como_escolher.itens.length ? c.como_escolher.itens : [''] },
    faq: c.faq, _meta: c._meta,
  }
}
function limparTexto(t) {
  const s = (v) => String(v ?? '').trim()
  return {
    seo_title: s(t.seo_title), meta_description: s(t.meta_description), chamada: s(t.chamada),
    intro: t.intro.map(s).filter(Boolean),
    como_escolher: { titulo: s(t.como_escolher.titulo), itens: t.como_escolher.itens.map(s).filter(Boolean) },
    faq: t.faq.map((f) => ({ pergunta: s(f.pergunta), resposta: s(f.resposta) })).filter((f) => f.pergunta && f.resposta),
  }
}
const palavras = (t) => String(t ?? '').trim().split(/\s+/).filter(Boolean).length
function Conta({ n, max, min, unidade = '' }) {
  const fora = (max && n > max) || (min && n > 0 && n < min)
  return <small className={'pg-conta' + (fora ? ' fora' : '')}>{n}{max ? `/${max}` : ''}{unidade}</small>
}

export default function EditarPagina({ pagina, g, onFechar }) {
  const { confirmar } = useDialogo()
  const inicial = useMemo(() => textoDaPagina(pagina?.rascunho ?? pagina?.conteudo), [pagina])
  const [texto, setTexto] = useState(inicial)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const caixa = useRef(null)
  const sujo = JSON.stringify(texto) !== JSON.stringify(inicial)

  async function fechar() {
    if (sujo && !(await confirmar({ titulo: 'Sair sem salvar?', texto: 'As mudanças feitas aqui se perdem.', ok: 'Sair sem salvar', cancelar: 'Continuar editando' }))) return
    onFechar()
  }
  const teclas = useRef(null)
  useEffect(() => {
    teclas.current = (e) => {
      if (document.querySelector('.dialogo-fundo')) return
      if (e.key === 'Escape') { e.preventDefault(); fechar() }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); salvar() }
    }
  })
  useEffect(() => {
    caixa.current?.focus()
    const ouvir = (e) => teclas.current?.(e)
    window.addEventListener('keydown', ouvir)
    return () => window.removeEventListener('keydown', ouvir)
  }, [])

  if (!pagina) return null
  const setT = (k, v) => setTexto((t) => ({ ...t, [k]: v }))
  const setLista = (k, i, v) => setTexto((t) => ({ ...t, [k]: t[k].map((x, j) => (j === i ? v : x)) }))
  const tirar = (k, i) => setTexto((t) => ({ ...t, [k]: t[k].filter((_, j) => j !== i) }))
  const setItem = (i, v) => setT('como_escolher', { ...texto.como_escolher, itens: texto.como_escolher.itens.map((x, j) => (j === i ? v : x)) })

  async function salvar() {
    if (salvando) return
    setErro('')
    const limpo = limparTexto(texto)
    if (!limpo.intro.length && !limpo.seo_title) { setErro('Escreva pelo menos o título e um parágrafo, ou deixe a IA gerar.'); return }
    if (!sujo) { onFechar(); return }
    setSalvando(true)
    const r = await g.salvarPagina(pagina.id, { rascunho: { ...limpo, _meta: { ...(texto._meta ?? {}), editado_em: new Date().toISOString() } }, gerado_em: new Date().toISOString() })
    setSalvando(false)
    if (!r.ok) { setErro(r.erro); return }
    g.avisar({ texto: `${titulo}: texto salvo, esperando aprovação.`, tom: 'ok' })
    onFechar()
  }

  const titulo = pagina.categoria ? `${categoriaDoGuia(pagina.categoria).rotulo} em ${pagina.cidade}` : `Página da cidade · ${pagina.cidade}`
  const caminho = pagina.categoria ? rotaDaCategoria(pagina.cidade_slug, pagina.categoria) : rotaDaCidade(pagina.cidade_slug)
  const seo = seoDaCidade(pagina.cidade, pagina.cidade_slug, pagina.categoria, limparTexto(texto))

  return (
    <Portal>
      <div className="modal-fundo plat-modal-fundo" onClick={fechar} role="presentation">
        <div className="modal-caixa plat-modal pg-modal-editar" role="dialog" aria-modal="true" aria-labelledby="pg-edp-t" onClick={(e) => e.stopPropagation()} data-teste="editar-pagina">
          <header className="pg-ed-topo">
            <div><h3 id="pg-edp-t">Editar {titulo}</h3><small className="muted">{caminho} · o endereço da página não muda</small></div>
            <button type="button" className="pg-ed-x" onClick={fechar} aria-label="Fechar"><X size={20} /></button>
          </header>
          <div className="pg-ed-corpo" ref={caixa} tabIndex={-1}>
            <div className="pg-form">
              <EscreverFora tipo="pagina" id={pagina.id} g={g} onJson={(o) => setTexto({ ...textoDaPagina(o), _meta: texto._meta })} />
              <PreviaGoogle titulo={seo.titulo} descricao={seo.descricao} caminho={seo.caminho} tituloBruto={texto.seo_title} descricaoBruta={texto.meta_description} />
              <label className="pg-campo">Título no Google <Conta n={texto.seo_title.length} max={60} />
                <input value={texto.seo_title} onChange={(e) => setT('seo_title', e.target.value)} placeholder={`Ex.: ${pagina.categoria ? categoriaDoGuia(pagina.categoria).rotulo : 'Salões de beleza'} em ${pagina.cidade}: endereços e horários`} />
              </label>
              <label className="pg-campo">Descrição no Google <Conta n={texto.meta_description.length} max={155} min={120} />
                <textarea rows={2} value={texto.meta_description} onChange={(e) => setT('meta_description', e.target.value)} />
              </label>
              <label className="pg-campo">Chamada (abaixo do título) <Conta n={texto.chamada.length} max={140} />
                <textarea rows={2} value={texto.chamada} onChange={(e) => setT('chamada', e.target.value)} />
              </label>

              <fieldset className="pg-grupo">
                <legend>Introdução</legend>
                {texto.intro.map((p, i) => (
                  <div key={i} className="pg-linha-lista">
                    <label className="pg-campo">Parágrafo {i + 1} <Conta n={palavras(p)} min={45} max={110} unidade=" palavras" />
                      <textarea rows={4} value={p} onChange={(e) => setLista('intro', i, e.target.value)} />
                    </label>
                    {texto.intro.length > 1 && <button type="button" className="pg-tirar" onClick={() => tirar('intro', i)} aria-label={`Tirar o parágrafo ${i + 1}`}><Trash2 size={15} /></button>}
                  </div>
                ))}
                {texto.intro.length < 3 && <button type="button" className="plat-link" onClick={() => setT('intro', [...texto.intro, ''])}><Plus size={14} /> Parágrafo</button>}
              </fieldset>

              <fieldset className="pg-grupo">
                <legend>Como escolher</legend>
                <label className="pg-campo">Título <Conta n={texto.como_escolher.titulo.length} max={50} />
                  <input value={texto.como_escolher.titulo} onChange={(e) => setT('como_escolher', { ...texto.como_escolher, titulo: e.target.value })} placeholder={`Ex.: Como escolher ${pagina.categoria ? categoriaDoGuia(pagina.categoria).singular : 'um salão'} em ${pagina.cidade}`} />
                </label>
                {texto.como_escolher.itens.map((d, i) => (
                  <div key={i} className="pg-linha-lista">
                    <label className="pg-campo">Item {i + 1} <Conta n={d.length} max={150} />
                      <input value={d} onChange={(e) => setItem(i, e.target.value)} />
                    </label>
                    {texto.como_escolher.itens.length > 1 && <button type="button" className="pg-tirar" onClick={() => setT('como_escolher', { ...texto.como_escolher, itens: texto.como_escolher.itens.filter((_, j) => j !== i) })} aria-label={`Tirar o item ${i + 1}`}><Trash2 size={15} /></button>}
                  </div>
                ))}
                {texto.como_escolher.itens.length < 6 && <button type="button" className="plat-link" onClick={() => setT('como_escolher', { ...texto.como_escolher, itens: [...texto.como_escolher.itens, ''] })}><Plus size={14} /> Item</button>}
              </fieldset>

              <fieldset className="pg-grupo">
                <legend>Perguntas frequentes</legend>
                <p className="pg-nota">Sobre o serviço e a escolha na cidade. Quantos lugares há, quais abrem no sábado e por bairro entram sozinhos, a partir dos dados.</p>
                {texto.faq.map((f, i) => (
                  <div key={i} className="pg-linha-lista">
                    <div className="pg-coluna">
                      <label className="pg-campo">Pergunta {i + 1}<input value={f.pergunta} onChange={(e) => setLista('faq', i, { ...f, pergunta: e.target.value })} /></label>
                      <label className="pg-campo">Resposta<textarea rows={2} value={f.resposta} onChange={(e) => setLista('faq', i, { ...f, resposta: e.target.value })} /></label>
                    </div>
                    <button type="button" className="pg-tirar" onClick={() => tirar('faq', i)} aria-label={`Tirar a pergunta ${i + 1}`}><Trash2 size={15} /></button>
                  </div>
                ))}
                {texto.faq.length < 5 && <button type="button" className="plat-link" onClick={() => setT('faq', [...texto.faq, { pergunta: '', resposta: '' }])}><Plus size={14} /> Pergunta</button>}
              </fieldset>
            </div>
          </div>
          {erro && <div className="alert alert-error pg-ed-erro">{erro}</div>}
          <footer className="pg-ed-pe">
            <small className="muted">{sujo ? 'O texto fica esperando aprovação: a página no ar não muda até aprovar.' : 'Ctrl+Enter salva · Esc fecha'}</small>
            <button type="button" className="btn btn-ghost" onClick={fechar}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={salvar} disabled={salvando || !sujo}>{salvando ? <><LoaderCircle size={15} className="pg-gira" /> Salvando…</> : 'Salvar'}</button>
          </footer>
        </div>
      </div>
    </Portal>
  )
}
