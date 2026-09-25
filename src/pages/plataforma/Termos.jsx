import { useCallback, useEffect, useState } from 'react'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho, Pilula } from '../../components/plataforma/Pecas'
import { supabase } from '../../lib/supabase'
import { useDialogo } from '../../context/DialogoContext'
import { Markdown } from '../../lib/markdown.jsx'
import { esquecerDocumentos, dataBr } from '../../lib/legal'
import { TIPOS_LEGAIS, DOCUMENTOS_LEGAIS } from '../../conteudo/legal'
import { Scale, Plus, Eye, Pencil, ExternalLink, Send, History } from 'lucide-react'

// Termos e privacidade (120): a plataforma versiona os quatro documentos.
// Cada tipo tem a versão que vale (a última publicada) e o histórico.
// Rascunho edita à vontade; publicado não muda mais: publica outra versão,
// e quem aceitou a antiga aceita de novo na próxima entrada.
const hoje = () => new Date().toISOString().slice(0, 10)

export default function Termos() {
  const { confirmar } = useDialogo()
  const [docs, setDocs] = useState(null)
  const [aceites, setAceites] = useState([])
  const [editando, setEditando] = useState(null)   // { id?, tipo, versao, titulo, resumo, conteudo, status }
  const [previa, setPrevia] = useState(false)
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    const [d, a] = await Promise.all([
      supabase.from('documentos_legais').select('id, tipo, versao, titulo, resumo, status, publicado_em, atualizado_em, conteudo').order('versao', { ascending: false }),
      supabase.rpc('aceites_por_versao'),
    ])
    if (d.error) setErro(d.error.message)
    setDocs(d.data ?? []); setAceites(Array.isArray(a.data) ? a.data : [])
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const porTipo = (tipo) => (docs ?? []).filter((x) => x.tipo === tipo)
  const vigente = (tipo) => porTipo(tipo).filter((x) => x.status === 'publicado').sort((a, b) => String(b.publicado_em).localeCompare(String(a.publicado_em)))[0] ?? null
  const pessoas = (tipo, versao) => aceites.find((x) => x.tipo === tipo && x.versao === versao)?.pessoas ?? 0

  function novaVersao(tipo) {
    const base = vigente(tipo) ?? porTipo(tipo)[0]
    setEditando({ tipo, versao: hoje(), titulo: base?.titulo ?? DOCUMENTOS_LEGAIS[tipo].titulo, resumo: '', conteudo: base?.conteudo ?? DOCUMENTOS_LEGAIS[tipo].conteudo, status: 'rascunho' })
    setPrevia(false); setErro(''); setInfo('')
  }
  async function salvar(publicar = false) {
    if (!editando) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editando.versao)) { setErro('A versão é a data, no formato AAAA-MM-DD.'); return }
    if (!editando.conteudo.trim()) { setErro('O documento está vazio.'); return }
    if (publicar) {
      const ok = await confirmar({ titulo: 'Publicar esta versão?', texto: 'Ela passa a valer no site e no aceite. Quem aceitou a versão anterior vai precisar aceitar de novo na próxima entrada. Uma versão publicada não pode mais ser editada.', ok: 'Publicar' })
      if (!ok) return
    }
    setSalvando(true); setErro('')
    const payload = { tipo: editando.tipo, versao: editando.versao, titulo: editando.titulo.trim(), resumo: editando.resumo.trim() || null, conteudo: editando.conteudo, status: publicar ? 'publicado' : 'rascunho' }
    const q = editando.id ? supabase.from('documentos_legais').update(payload).eq('id', editando.id) : supabase.from('documentos_legais').insert(payload)
    const { error } = await q
    setSalvando(false)
    if (error) { setErro(error.code === '23505' ? 'Já existe uma versão com essa data para este documento. Use outra data.' : error.message); return }
    esquecerDocumentos()
    setInfo(publicar ? `Versão de ${dataBr(editando.versao)} publicada.` : 'Rascunho salvo.')
    setEditando(null); carregar()
  }
  async function publicarExistente(d) {
    const ok = await confirmar({ titulo: `Publicar a versão de ${dataBr(d.versao)}?`, texto: 'Ela passa a valer no site e no aceite. Quem aceitou a anterior aceita de novo na próxima entrada.', ok: 'Publicar' })
    if (!ok) return
    const { error } = await supabase.from('documentos_legais').update({ status: 'publicado' }).eq('id', d.id)
    if (error) { setErro(error.message); return }
    esquecerDocumentos(); setInfo(`Versão de ${dataBr(d.versao)} publicada.`); carregar()
  }
  async function apagarRascunho(d) {
    const ok = await confirmar({ titulo: 'Apagar este rascunho?', texto: 'Só rascunhos podem ser apagados.', ok: 'Apagar', perigo: true })
    if (!ok) return
    const { error } = await supabase.from('documentos_legais').delete().eq('id', d.id).eq('status', 'rascunho')
    if (error) setErro(error.message); else carregar()
  }

  return (
    <Shell>
      <Cabecalho titulo="Termos e privacidade" sub="Os quatro documentos legais, com versões. A última publicada de cada um é a que vale no site e no aceite." direita={<a className="btn btn-ghost" href="https://mimo.com.vc/termos" target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Ver no site</a>} />
      {erro && <div className="alert alert-error">{erro}</div>}
      {info && <div className="alert alert-info">{info}</div>}

      {editando ? (
        <div className="card lg-editor">
          <div className="lg-editor-topo">
            <div><small className="muted">{editando.id ? 'Editando rascunho' : 'Nova versão'} · {TIPOS_LEGAIS.find((t) => t.tipo === editando.tipo)?.rotulo}</small><h3>{editando.titulo || 'Sem título'}</h3></div>
            <div className="lg-editor-acoes">
              <button type="button" className={'btn btn-ghost' + (previa ? ' ativo' : '')} onClick={() => setPrevia((p) => !p)}><Eye size={16} /> {previa ? 'Editar' : 'Prévia'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditando(null)} disabled={salvando}>Cancelar</button>
              <button type="button" className="btn btn-ghost" onClick={() => salvar(false)} disabled={salvando}>Salvar rascunho</button>
              <button type="button" className="btn btn-primary" onClick={() => salvar(true)} disabled={salvando}><Send size={16} /> Publicar</button>
            </div>
          </div>
          <div className="lg-editor-campos">
            <label>Título<input value={editando.titulo} onChange={(e) => setEditando((x) => ({ ...x, titulo: e.target.value }))} /></label>
            <label>Versão (data)<input type="date" value={editando.versao} onChange={(e) => setEditando((x) => ({ ...x, versao: e.target.value }))} /></label>
            <label className="lg-campo-largo">O que mudou <span className="muted">(uma frase, aparece no histórico)</span><input value={editando.resumo} onChange={(e) => setEditando((x) => ({ ...x, resumo: e.target.value }))} placeholder="Ex.: incluído o item sobre pagamentos pelo app" /></label>
          </div>
          {previa ? <div className="lg-previa legal-texto"><Markdown texto={editando.conteudo} /></div>
            : <textarea className="lg-textarea" value={editando.conteudo} onChange={(e) => setEditando((x) => ({ ...x, conteudo: e.target.value }))} spellCheck="true" />}
          <p className="muted lg-dica">Markdown: <code>## 1. Título da seção</code>, <code>### Subseção</code>, <code>- item</code>, <code>**negrito**</code>. Um parágrafo por linha em branco.</p>
        </div>
      ) : (
        <div className="lg-tipos">
          {TIPOS_LEGAIS.map((t) => {
            const v = vigente(t.tipo)
            const lista = porTipo(t.tipo)
            return (
              <div key={t.tipo} className="card lg-tipo">
                <div className="lg-tipo-topo">
                  <span className="ajuste-icone"><Scale size={18} /></span>
                  <div className="cliente-info">
                    <span className="cliente-nome"><span className="nome-txt">{t.rotulo}</span></span>
                    <span className="muted cliente-meta">{t.para} · <a href={`https://mimo.com.vc${t.rota}`} target="_blank" rel="noopener noreferrer">mimo.com.vc{t.rota}</a></span>
                  </div>
                  <button type="button" className="btn btn-primary" onClick={() => novaVersao(t.tipo)}><Plus size={16} /> Nova versão</button>
                </div>
                {docs === null ? <p className="muted">Carregando…</p> : v ? (
                  <p className="lg-vigente"><Pilula tom="ok">vale agora</Pilula> Versão de <b>{dataBr(v.versao)}</b>, publicada em {new Date(v.publicado_em).toLocaleDateString('pt-BR')} · {pessoas(t.tipo, v.versao)} {pessoas(t.tipo, v.versao) === 1 ? 'pessoa aceitou' : 'pessoas aceitaram'}</p>
                ) : (
                  <p className="lg-vigente"><Pilula tom="aviso">sem versão publicada</Pilula> Vale o texto de código, versão de {dataBr(DOCUMENTOS_LEGAIS[t.tipo].versao)}. Publique uma versão para versionar por aqui.</p>
                )}
                {lista.length > 0 && (
                  <table className="plat-tabela lg-historico">
                    <thead><tr><th><History size={13} /> Versão</th><th>Situação</th><th>O que mudou</th><th>Aceites</th><th></th></tr></thead>
                    <tbody>
                      {lista.map((d) => (
                        <tr key={d.id}>
                          <td className="mono">{d.versao}</td>
                          <td>{d.status === 'publicado' ? <Pilula tom={v?.id === d.id ? 'ok' : undefined}>{v?.id === d.id ? 'vigente' : 'anterior'}</Pilula> : <Pilula tom="aviso">rascunho</Pilula>}</td>
                          <td className="muted">{d.resumo || '—'}</td>
                          <td>{pessoas(d.tipo, d.versao)}</td>
                          <td className="lg-historico-acoes">
                            {d.status === 'rascunho' ? <>
                              <button type="button" className="btn-mini" onClick={() => { setEditando({ ...d, resumo: d.resumo ?? '' }); setPrevia(false) }}><Pencil size={12} /> Editar</button>
                              <button type="button" className="btn-mini btn-mini-ok" onClick={() => publicarExistente(d)}><Send size={12} /> Publicar</button>
                              <button type="button" className="btn-mini btn-mini-nao" onClick={() => apagarRascunho(d)}>Apagar</button>
                            </> : <button type="button" className="btn-mini btn-mini-neutro" onClick={() => { setEditando({ ...d, resumo: d.resumo ?? '', id: undefined, versao: hoje(), status: 'rascunho' }); setPrevia(true) }}><Eye size={12} /> Ver / usar como base</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Shell>
  )
}
