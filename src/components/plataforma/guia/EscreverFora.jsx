import { useState } from 'react'
import { Copy, ClipboardPaste, LoaderCircle, Check, ShieldCheck, TriangleAlert } from 'lucide-react'
import { pedidoParaTexto, extrairJsonColado, copiarTexto } from '../../../lib/guiaColar'

// o resultado da conferência (3.32.1): o que a validação da IA diria do texto colado ou editado
export function Conferencia({ r }) {
  if (!r) return null
  if (r.erro) return <div className="alert alert-error" data-teste="conferencia">Não deu para conferir o texto: {r.erro}</div>
  const graves = r.problemas.filter((p) => p.nivel === 'grave')
  const estilo = r.problemas.filter((p) => p.nivel !== 'grave')
  if (!graves.length && !estilo.length && !r.avisos.length) return <p className="pg-nota pg-conferido" data-teste="conferencia"><ShieldCheck size={14} /> Conferido: passou nas regras do guia.</p>
  return (
    <div className="pg-conferencia" data-teste="conferencia">
      {graves.length > 0 && <div className="alert alert-error"><b><TriangleAlert size={14} /> Não pode ir assim ({graves.length}):</b><ul>{graves.map((p, i) => <li key={i}>{p.texto}</li>)}</ul></div>}
      {estilo.length > 0 && <div className="pg-alerta ambar"><TriangleAlert size={16} /><div><b>Vale melhorar</b>{estilo.map((p, i) => <span key={i}>{p.texto}</span>)}</div></div>}
      {r.avisos.length > 0 && <small className="muted">{r.avisos.join(' · ')}</small>}
    </div>
  )
}

// Escrever fora (3.32): quem tem o próprio modelo (o GPT, por exemplo) copia daqui o pedido que a função
// montaria para a IA (ficha, regras e formato), cola lá, e traz o JSON da resposta de volta: os campos do
// editor se preenchem. Nada é gravado até Salvar. Serve para a página de um salão (tipo 'lugar') e para
// a página de uma cidade ou categoria (tipo 'pagina').
export default function EscreverFora({ tipo, id, g, onJson }) {
  const [copiando, setCopiando] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [manual, setManual] = useState('') // o pedido para copiar à mão, quando o navegador não deixa copiar
  const [colado, setColado] = useState('')
  const [erro, setErro] = useState('')
  const [conferencia, setConferencia] = useState(null)
  const [conferindo, setConferindo] = useState(false)

  async function copiar() {
    if (copiando) return
    setErro(''); setManual(''); setCopiado(false); setCopiando(true)
    try {
      const r = await g.pedidoParaIa(tipo, id)
      if (!r.ok) { setErro(`Não deu para montar o pedido: ${r.erro}`); return }
      const texto = pedidoParaTexto(r)
      if (await copiarTexto(texto)) setCopiado(true)
      else setManual(texto)
    } finally { setCopiando(false) }
  }
  async function preencher() {
    setErro(''); setConferencia(null)
    const o = extrairJsonColado(colado)
    if (!o) { setErro('Não achei um JSON no que foi colado. Cole a resposta inteira do GPT, com as chaves { }.'); return }
    onJson(o)
    setColado('')
    // a mesma conferência que a IA passa (3.32.1): nome de lugar, nota, preço, inventário de bairros, tamanhos
    setConferindo(true)
    try { setConferencia(await g.conferirTexto(tipo, id, o)) } finally { setConferindo(false) }
  }

  return (
    <fieldset className="pg-grupo pg-fora" data-teste="escrever-fora">
      <legend>Escrever fora (com o seu GPT)</legend>
      <p className="pg-nota">Copie o pedido, cole no GPT (ou em outro modelo), e traga a resposta em JSON para cá. Os campos abaixo se preenchem; você confere e salva.</p>
      <div className="pg-fora-linha">
        <button type="button" className="btn btn-ghost pg-btn-peq" onClick={copiar} disabled={copiando}>
          {copiando ? <LoaderCircle size={14} className="pg-gira" /> : copiado ? <Check size={14} /> : <Copy size={14} />} {copiado ? 'Pedido copiado' : '1. Copiar o pedido para o GPT'}
        </button>
        {copiado && <small className="muted">Cole no GPT e peça só o JSON de volta.</small>}
      </div>
      {manual && (
        <label className="pg-campo">O navegador não deixou copiar sozinho: selecione tudo aqui e copie
          <textarea rows={5} readOnly value={manual} onFocus={(e) => e.target.select()} data-teste="pedido-manual" />
        </label>
      )}
      <label className="pg-campo">2. Cole aqui a resposta do GPT (o JSON)
        <textarea rows={4} value={colado} onChange={(e) => setColado(e.target.value)} placeholder={'{ "seo_title": "...", ... }'} data-teste="json-colado" />
      </label>
      <div className="pg-fora-linha">
        <button type="button" className="btn btn-ghost pg-btn-peq" onClick={preencher} disabled={!colado.trim() || conferindo}>{conferindo ? <LoaderCircle size={14} className="pg-gira" /> : <ClipboardPaste size={14} />} 3. Preencher os campos com o que foi colado</button>
        {conferindo && <small className="muted">Conferindo pelas regras do guia…</small>}
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}
      <Conferencia r={conferencia} />
    </fieldset>
  )
}
