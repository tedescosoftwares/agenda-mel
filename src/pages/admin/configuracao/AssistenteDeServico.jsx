import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Clock, Image as ImageIcon, Sparkles, Upload, Link2, X } from 'lucide-react'
import Portal from '../../../components/Portal'
import { imagemDoItem } from '../../../components/CadastroDeServico'
import { duracaoDe, nomeSugerido } from '../../../lib/catalogoBusca'
import { formatDuracao, formatPreco } from '../../../lib/format'

// O assistente de serviço (2.98): ao escolher um serviço na configuração,
// a pessoa é levada passo a passo na mesma tela — (1) duração e preço,
// (2) foto (a padrão da MIMO ou a sua), (3) se combina com outros serviços
// do menu de serviços, mesmo de outra categoria — e só então entra no menu de serviços.
// Serviço personalizado ganha um passo antes: nome e categoria.

export const paraReais = (t) => { const n = Number(String(t ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : null }

export default function AssistenteDeServico({ catalogo, cats, item = null, tecnica = null, nomeInicial = '', categoriaInicial = '', servicos = [], compacto = false, onFechar, onConcluir }) {
  const personalizado = !item
  const tecnicas = useMemo(() => (item && catalogo ? catalogo.filhos(item.id).filter((i) => i.tipo === 'tecnica') : []), [item, catalogo])
  const [tec, setTec] = useState(tecnica)
  const [v, setV] = useState(() => ({
    nome: item ? nomeSugerido(item, tecnica) : (nomeInicial ?? ''),
    categoria_id: item?.categoria_id ?? categoriaInicial ?? '',
    duracao: item ? (duracaoDe(catalogo, tecnica ?? item) ?? 60) : 60,
    preco: '',
    descricao: '',
  }))
  const [foto, setFoto] = useState({ tipo: 'nenhuma', url: null, file: null, preview: null })
  const [juntos, setJuntos] = useState([])
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  // a foto padrão da MIMO: a do item do catálogo (ou da família), se existir
  const urlMimo = useMemo(() => (item ? (imagemDoItem(item) || (item.pai_id ? imagemDoItem(catalogo?.porId.get(item.pai_id)) : null)) : null), [item, catalogo])
  const [temMimo, setTemMimo] = useState(null)   // null = testando
  useEffect(() => {
    if (!urlMimo) { setTemMimo(false); return }
    let vivo = true
    const img = new Image()
    img.onload = () => { if (vivo) { setTemMimo(true); setFoto((f) => (f.tipo === 'nenhuma' ? { tipo: 'mimo', url: urlMimo, file: null, preview: null } : f)) } }
    img.onerror = () => { if (vivo) setTemMimo(false) }
    img.src = urlMimo
    return () => { vivo = false }
  }, [urlMimo])

  // ao trocar a técnica, nome e duração sugeridos acompanham (se a pessoa não mexeu)
  const mexeu = useRef({ nome: false, duracao: false })
  function trocarTecnica(id) {
    const t = tecnicas.find((x) => x.id === id) ?? null
    setTec(t)
    setV((x) => ({ ...x, nome: mexeu.current.nome ? x.nome : nomeSugerido(item, t), duracao: mexeu.current.duracao ? x.duracao : (duracaoDe(catalogo, t ?? item) ?? x.duracao) }))
  }

  const passos = [...(personalizado ? ['sobre'] : []), 'preco', 'foto', 'juntos']
  const [i, setI] = useState(0)
  const passo = passos[i]
  const ultimo = i === passos.length - 1
  const outros = servicos.filter((x) => x.active !== false)
  const porCat = useMemo(() => {
    const m = new Map()
    for (const sv of outros) { const k = sv.categoria_id ?? ''; if (!m.has(k)) m.set(k, []); m.get(k).push(sv) }
    return [...m.entries()].map(([id, lista]) => ({ id, nome: cats.find((c) => c.id === id)?.nome ?? 'Outros', lista })).sort((a, b) => a.nome.localeCompare(b.nome))
  }, [outros, cats])

  function valida() {
    if (passo === 'sobre') { if (!v.nome.trim()) return 'Dê um nome ao serviço.'; if (!v.categoria_id) return 'Escolha a categoria.' }
    if (passo === 'preco') { if (!(Number(v.duracao) > 0)) return 'Diga quanto tempo leva.'; if (v.preco.trim() && paraReais(v.preco) === null) return 'Preço inválido. Ex.: 80 ou 80,00' }
    return ''
  }
  async function continuar() {
    const e = valida(); if (e) { setErro(e); return }
    setErro('')
    if (!ultimo) { setI(i + 1); return }
    setSalvando(true)
    try {
      await onConcluir({ nome: v.nome.trim(), categoria_id: v.categoria_id || null, catalogo_item_id: item ? (tec ?? item).id : null, duracao: Number(v.duracao) || 60, preco: paraReais(v.preco) ?? 0, descricao: v.descricao.trim() || null, foto, juntos })
    } catch (err) { setErro(err?.message || 'Não deu para adicionar agora.'); setSalvando(false); return }
    setSalvando(false)
  }
  function voltar() { setErro(''); if (i > 0) setI(i - 1); else onFechar() }
  function escolherArquivo(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setErro('Escolha uma imagem (JPG, PNG ou WebP).'); return }
    setErro('')
    setFoto({ tipo: 'minha', url: null, file, preview: URL.createObjectURL(file) })
  }
  const precoN = paraReais(v.preco)
  const titulo = { sobre: 'Sobre o serviço', preco: 'Quanto tempo leva e quanto custa?', foto: 'Qual foto representa esse serviço?', juntos: 'Costuma ser feito junto com outro?' }[passo]

  return (
    <Portal><div className={'modal-fundo cfg-drawer-fundo' + (compacto ? ' cfg-folha-fundo' : '')} onClick={onFechar}>
      <div className={'cfg-drawer cfg-assist' + (compacto ? ' cfg-folha' : '')} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Adicionar serviço">
        {compacto && <span className="cfg-folha-puxador" aria-hidden="true" />}
        <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">×</button>
        <header className="cfg-assist-topo">
          <span className="cfg-assist-eyebrow"><Sparkles size={13} /> {personalizado ? 'Serviço personalizado' : item.caminho?.slice(0, -1).join(' › ') || 'Do catálogo'}</span>
          <strong className="cfg-assist-nome">{v.nome || 'Novo serviço'}</strong>
          <div className="cfg-assist-passos" aria-label={`Passo ${i + 1} de ${passos.length}`}>
            {passos.map((p, k) => <i key={p} className={k < i ? 'feito' : k === i ? 'atual' : ''} />)}
            <small>{i + 1} de {passos.length}</small>
          </div>
        </header>
        <h3 className="cfg-assist-titulo">{titulo}</h3>
        {erro && <div className="alert alert-error">{erro}</div>}

        {passo === 'sobre' && (
          <div className="cfg-assist-corpo">
            <label>Nome<input value={v.nome} onChange={(e) => setV({ ...v, nome: e.target.value })} placeholder="Ex.: Banho de lua" autoFocus /></label>
            <label>Categoria<select value={v.categoria_id} onChange={(e) => setV({ ...v, categoria_id: e.target.value })}><option value="">Escolha…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
            <label>Descrição <small className="muted">(opcional)</small><input value={v.descricao} onChange={(e) => setV({ ...v, descricao: e.target.value })} placeholder="O que está incluso, como é feito…" /></label>
          </div>
        )}

        {passo === 'preco' && (
          <div className="cfg-assist-corpo">
            {tecnicas.length > 0 && (
              <label>Técnica <small className="muted">(opcional)</small>
                <select value={tec?.id ?? ''} onChange={(e) => trocarTecnica(e.target.value)}><option value="">Não definir agora</option>{tecnicas.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</select>
              </label>
            )}
            <div className="cfg-drawer-duas">
              <label>Duração
                <span className="cfg-assist-campo"><input type="number" min="5" step="5" value={v.duracao} onChange={(e) => { mexeu.current.duracao = true; setV({ ...v, duracao: e.target.value }) }} autoFocus /><em>min</em></span>
                <small className="muted">{Number(v.duracao) > 0 ? `A agenda reserva ${formatDuracao(Number(v.duracao))}.` : 'Quanto tempo a cliente fica com você.'}</small>
              </label>
              <label>Preço
                <span className="cfg-assist-campo"><em>R$</em><input value={v.preco} onChange={(e) => setV({ ...v, preco: e.target.value })} inputMode="decimal" placeholder="0,00" /></span>
                <small className="muted">{precoN ? `A cliente vê ${formatPreco(precoN)}.` : 'Pode deixar para depois; sem preço, aparece “a combinar”.'}</small>
              </label>
            </div>
            <div className="cfg-assist-atalhos" aria-label="Durações comuns">
              {[30, 45, 60, 90, 120].map((m) => <button key={m} type="button" className={'btn-mini' + (Number(v.duracao) === m ? '' : ' btn-mini-neutro')} onClick={() => { mexeu.current.duracao = true; setV({ ...v, duracao: m }) }}>{formatDuracao(m)}</button>)}
            </div>
            {!personalizado && <label>Nome que suas clientes verão<input value={v.nome} onChange={(e) => { mexeu.current.nome = true; setV({ ...v, nome: e.target.value }) }} /></label>}
          </div>
        )}

        {passo === 'foto' && (
          <div className="cfg-assist-corpo">
            <p className="muted cfg-assist-dica">Ela aparece na sua página e na lista de serviços. Dá para trocar depois.</p>
            <div className="cfg-foto-opcoes">
              {temMimo !== false && (
                <button type="button" className={'cfg-foto-opcao' + (foto.tipo === 'mimo' ? ' marcada' : '')} onClick={() => setFoto({ tipo: 'mimo', url: urlMimo, file: null, preview: null })} disabled={temMimo === null}>
                  <span className="cfg-foto-previa">{urlMimo && <img src={urlMimo} alt="" />}</span>
                  <strong><Sparkles size={13} /> Foto da MIMO</strong>
                  <small>Pronta, do catálogo. Fica bonita e você não precisa fazer nada.</small>
                  <i className="cfg-foto-check"><Check size={12} strokeWidth={3} /></i>
                </button>
              )}
              <label className={'cfg-foto-opcao' + (foto.tipo === 'minha' ? ' marcada' : '')}>
                <input type="file" accept="image/*" hidden onChange={escolherArquivo} />
                <span className="cfg-foto-previa cfg-foto-previa-upload">{foto.preview ? <img src={foto.preview} alt="" /> : <Upload size={22} />}</span>
                <strong><ImageIcon size={13} /> Minha foto</strong>
                <small>{foto.file ? foto.file.name : 'Um resultado seu: o antes e depois, o acabamento, o detalhe.'}</small>
                <i className="cfg-foto-check"><Check size={12} strokeWidth={3} /></i>
              </label>
              <button type="button" className={'cfg-foto-opcao cfg-foto-opcao-sem' + (foto.tipo === 'nenhuma' ? ' marcada' : '')} onClick={() => setFoto({ tipo: 'nenhuma', url: null, file: null, preview: null })}>
                <span className="cfg-foto-previa"><X size={20} /></span>
                <strong>Sem foto por enquanto</strong>
                <small>Entra com a cor da categoria. Você coloca depois.</small>
                <i className="cfg-foto-check"><Check size={12} strokeWidth={3} /></i>
              </button>
            </div>
          </div>
        )}

        {passo === 'juntos' && (
          <div className="cfg-assist-corpo">
            <p className="muted cfg-assist-dica"><Link2 size={13} /> Quando a cliente marcar <strong>{v.nome || 'este serviço'}</strong>, o app oferece os marcados aqui na sequência, mesmo de outra categoria ou com outra profissional. Não é combo: cada um mantém preço e agenda.</p>
            {outros.length === 0 ? (
              <p className="muted cfg-assist-vazio">Você ainda não tem outros serviços no menu. Dá para marcar depois, em Serviços.</p>
            ) : (
              <div className="cfg-juntos">
                {porCat.map((g) => (
                  <div key={g.id || 'o'} className="cfg-juntos-grupo">
                    <span className="cfg-juntos-titulo">{g.nome}</span>
                    <div className="cfg-juntos-chips">
                      {g.lista.map((sv) => { const on = juntos.includes(sv.id); return (
                        <button key={sv.id} type="button" className={'chip' + (on ? ' active' : '')} onClick={() => setJuntos((j) => (on ? j.filter((x) => x !== sv.id) : [...j, sv.id]))} aria-pressed={on}>{on && <Check size={12} strokeWidth={3} />} {sv.name}<small>{formatDuracao(sv.duration_minutes)}</small></button>
                      ) })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {juntos.length > 0 && <p className="cfg-juntos-resumo">{juntos.length} {juntos.length === 1 ? 'serviço sugerido' : 'serviços sugeridos'} junto com {v.nome}.</p>}
          </div>
        )}

        <footer className="cfg-assist-pe">
          <button type="button" className="btn btn-ghost" onClick={voltar} disabled={salvando}><ArrowLeft size={15} /> {i === 0 ? 'Cancelar' : 'Voltar'}</button>
          <div className="cfg-assist-pe-dir">
            {(passo === 'foto' || passo === 'juntos') && !ultimo && <button type="button" className="plat-link" onClick={() => { setErro(''); setI(i + 1) }}>Pular</button>}
            <button type="button" className="btn btn-primary" onClick={continuar} disabled={salvando}>
              {salvando ? 'Adicionando…' : ultimo ? <><Check size={15} /> Adicionar ao menu</> : <>Continuar <ArrowRight size={15} /></>}
            </button>
          </div>
        </footer>
        <p className="muted cfg-assist-resumo"><Clock size={12} /> {formatDuracao(Number(v.duracao) || 0)} · {precoN ? formatPreco(precoN) : 'a combinar'} · {foto.tipo === 'mimo' ? 'foto da MIMO' : foto.tipo === 'minha' ? 'sua foto' : 'sem foto'}{juntos.length ? ` · ${juntos.length} junto` : ''}</p>
      </div>
    </div></Portal>
  )
}
