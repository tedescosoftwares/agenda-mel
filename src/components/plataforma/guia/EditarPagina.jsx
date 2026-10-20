import { useEffect, useMemo, useRef, useState } from 'react'
import Portal from '../../Portal'
import { useDialogo } from '../../../context/DialogoContext'
import { PreviaGoogle } from './Previa'
import EscreverFora, { Conferencia } from './EscreverFora'
import { conteudoSeguro, categoriaDoGuia, rotaDaCidade, rotaDaCategoria } from '../../../lib/guia'
import { seoDaCidade } from '../../../lib/guiaSeo'
import { X, Plus, Trash2, LoaderCircle } from 'lucide-react'

// O texto de uma página de cidade ou de categoria, editável à mão (3.32): os mesmos campos que a IA
// escreve (título e descrição no Google, chamada, introdução num parágrafo, três pontos e perguntas). O que se
// salva vai para o rascunho e espera Aprovar, como o texto da IA; a página no ar não muda antes disso.
// "Escrever fora" copia o pedido da IA para o GPT de quem tem e preenche os campos com o JSON colado.

const PONTO_VAZIO = () => ({ titulo: '', texto: '' })
const vazio = () => ({ seo_title: '', meta_description: '', chamada: '', intro: [''], pontos: { titulo: '', itens: [PONTO_VAZIO(), PONTO_VAZIO(), PONTO_VAZIO()] }, faq: [], _meta: {} })
function textoDaPagina(conteudo) {
  const c = conteudoSeguro(conteudo)
  if (!c) return vazio()
  return {
    seo_title: c.seo_title, meta_description: c.meta_description, chamada: c.chamada,
    intro: c.intro.length ? c.intro : [''],
    // 3.35: os três pontos; um texto antigo (com "como escolher") abre com os pontos vazios para escrever
    pontos: { titulo: c.pontos.titulo, itens: c.pontos.itens.length ? c.pontos.itens : [PONTO_VAZIO(), PONTO_VAZIO(), PONTO_VAZIO()] },
    faq: c.faq, _meta: c._meta,
  }
}
function limparTexto(t) {
  const s = (v) => String(v ?? '').trim()
  return {
    seo_title: s(t.seo_title), meta_description: s(t.meta_description), chamada: s(t.chamada),
    intro: t.intro.map(s).filter(Boolean),
    pontos: { titulo: s(t.pontos.titulo), itens: t.pontos.itens.map((x) => ({ titulo: s(x.titulo), texto: s(x.texto) })).filter((x) => x.titulo && x.texto) },
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
  const [conferencia, setConferencia] = useState(null) // 3.32.1: o que a validação da IA diz do texto; { texto } é do que foi conferido
  const caixa = useRef(null)
  const sujo = JSON.stringify(texto) !== JSON.stringify(inicial)
  const graves = conferencia && !conferencia.erro && conferencia.texto === JSON.stringify(texto) ? conferencia.problemas.filter((p) => p.nivel === 'grave').length : 0

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
  const setPonto = (i, campo, v) => setT('pontos', { ...texto.pontos, itens: texto.pontos.itens.map((x, j) => (j === i ? { ...x, [campo]: v } : x)) })

  async function salvar() {
    if (salvando) return
    setErro('')
    const limpo = limparTexto(texto)
    if (!limpo.intro.length && !limpo.seo_title) { setErro('Escreva pelo menos o título e um parágrafo, ou deixe a IA gerar.'); return }
    if (!sujo) { onFechar(); return }
    setSalvando(true)
    // 3.32.1: a conferência da IA antes de gravar; com problema grave, só salva no segundo clique ("Salvar mesmo assim")
    if (!(conferencia && conferencia.texto === JSON.stringify(texto))) {
      const c = await g.conferirTexto('pagina', pagina.id, limpo)
      setConferencia({ ...c, texto: JSON.stringify(texto) })
      if (!c.erro && c.problemas.some((p) => p.nivel === 'grave')) { setSalvando(false); return }
    }
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
              <EscreverFora tipo="pagina" id={pagina.id} g={g} onJson={(o) => setTexto({ ...textoDaPagina(o), _meta: { ...(texto._meta ?? {}), modelo: 'escrito fora', provedor: 'manual' } })} />
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
                <legend>Introdução (um parágrafo forte)</legend>
                {texto.intro.map((p, i) => (
                  <div key={i} className="pg-linha-lista">
                    <label className="pg-campo">Parágrafo {i + 1} <Conta n={palavras(p)} min={80} max={140} unidade=" palavras" />
                      <textarea rows={4} value={p} onChange={(e) => setLista('intro', i, e.target.value)} />
                    </label>
                    {texto.intro.length > 1 && <button type="button" className="pg-tirar" onClick={() => tirar('intro', i)} aria-label={`Tirar o parágrafo ${i + 1}`}><Trash2 size={15} /></button>}
                  </div>
                ))}
                {texto.intro.length < 2 && <button type="button" className="plat-link" onClick={() => setT('intro', [...texto.intro, ''])}><Plus size={14} /> Parágrafo</button>}
              </fieldset>

              <fieldset className="pg-grupo">
                <legend>Pontos (três)</legend>
                <p className="pg-nota">Cada ponto tem um título curto e uma ou duas frases, ancorado num fato: um bairro ou rua, uma categoria ou serviço, um traço da cidade. Sem horário: isso fica nos números e nas perguntas.</p>
                <label className="pg-campo">Título do bloco <Conta n={texto.pontos.titulo.length} max={50} />
                  <input value={texto.pontos.titulo} onChange={(e) => setT('pontos', { ...texto.pontos, titulo: e.target.value })} placeholder="Ex.: O que vale saber" />
                </label>
                {texto.pontos.itens.map((x, i) => (
                  <div key={i} className="pg-linha-lista">
                    <div className="pg-ponto">
                      <label className="pg-campo">Ponto {i + 1}: título <Conta n={x.titulo.length} max={40} />
                        <input value={x.titulo} onChange={(e) => setPonto(i, 'titulo', e.target.value)} />
                      </label>
                      <label className="pg-campo">Texto <Conta n={x.texto.length} max={170} />
                        <textarea rows={2} value={x.texto} onChange={(e) => setPonto(i, 'texto', e.target.value)} />
                      </label>
                    </div>
                    {texto.pontos.itens.length > 1 && <button type="button" className="pg-tirar" onClick={() => setT('pontos', { ...texto.pontos, itens: texto.pontos.itens.filter((_, j) => j !== i) })} aria-label={`Tirar o ponto ${i + 1}`}><Trash2 size={15} /></button>}
                  </div>
                ))}
                {texto.pontos.itens.length < 3 && <button type="button" className="plat-link" onClick={() => setT('pontos', { ...texto.pontos, itens: [...texto.pontos.itens, PONTO_VAZIO()] })}><Plus size={14} /> Ponto</button>}
              </fieldset>

              <fieldset className="pg-grupo">
                <legend>Perguntas frequentes</legend>
                <p className="pg-nota">As perguntas da página saem dos dados do guia (quantos lugares, bairros, dias e horários, serviços) e acompanham a lista. Aqui, só o que você quiser acrescentar à mão; a IA não escreve perguntas para páginas de cidade.</p>
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
          {conferencia && conferencia.texto === JSON.stringify(texto) && <div className="pg-ed-erro"><Conferencia r={conferencia} /></div>}
          <footer className="pg-ed-pe">
            <small className="muted">{graves ? 'A conferência achou problema grave. Corrija, ou salve mesmo assim por sua conta.' : sujo ? 'O texto fica esperando aprovação: a página no ar não muda até aprovar.' : 'Ctrl+Enter salva · Esc fecha'}</small>
            <button type="button" className="btn btn-ghost" onClick={fechar}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={salvar} disabled={salvando || !sujo}>{salvando ? <><LoaderCircle size={15} className="pg-gira" /> Salvando…</> : graves ? 'Salvar mesmo assim' : 'Salvar'}</button>
          </footer>
        </div>
      </div>
    </Portal>
  )
}
