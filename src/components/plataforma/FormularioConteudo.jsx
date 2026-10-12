import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'

// Formulário guiado por esquema (src/conteudo/esquemas.js): cada campo diz
// o tipo (texto, área, linhas, escolha, sim, número, data, pares, lista,
// grupo, rota, rotas, artigos) e a tela se monta sozinha. É o que deixa o
// miolo de toda página pública editável na Plataforma sem uma tela por página.
export default function FormularioConteudo({ esquema, valor, onChange, opcoes = {} }) {
  const v = valor || {}
  const set = (chave, novo) => onChange({ ...v, [chave]: novo })
  return (
    <div className="cont-form">
      {esquema.map((c, i) => c.secao ? <h4 className="cont-secao" key={'s' + i}>{c.secao}</h4> : <Campo key={c.chave} campo={c} valor={v[c.chave]} onChange={(novo) => set(c.chave, novo)} opcoes={opcoes} />)}
    </div>
  )
}

const mover = (lista, i, d) => { const n = [...lista]; const j = i + d; if (j < 0 || j >= n.length) return n; [n[i], n[j]] = [n[j], n[i]]; return n }
const semIndice = (lista, i) => lista.filter((_, k) => k !== i)

function Campo({ campo, valor, onChange, opcoes }) {
  const { tipo, rotulo, dica } = campo
  const Dica = dica ? <small className="cont-dica">{dica}</small> : null
  if (tipo === 'texto') return <label className="cont-campo"><span>{rotulo}</span><input value={valor ?? ''} onChange={(e) => onChange(e.target.value)} />{Dica}</label>
  if (tipo === 'numero') return <label className="cont-campo cont-curto"><span>{rotulo}</span><input type="number" value={valor ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />{Dica}</label>
  if (tipo === 'data') return <label className="cont-campo cont-curto"><span>{rotulo}</span><input type="date" value={(valor || '').slice(0, 10)} onChange={(e) => onChange(e.target.value)} />{Dica}</label>
  if (tipo === 'area') return <label className="cont-campo"><span>{rotulo}</span><textarea rows={campo.linhas || 3} value={valor ?? ''} onChange={(e) => onChange(e.target.value)} />{Dica}</label>
  if (tipo === 'linhas') return <label className="cont-campo"><span>{rotulo} <em>(uma por linha)</em></span><textarea rows={Math.max(2, Math.min(8, (Array.isArray(valor) ? valor.length : 0) + 1))} value={Array.isArray(valor) ? valor.join('\n') : (valor ?? '')} onChange={(e) => onChange(e.target.value.split('\n'))} />{Dica}</label>
  if (tipo === 'escolha') return <label className="cont-campo cont-curto"><span>{rotulo}</span><select value={valor ?? ''} onChange={(e) => onChange(e.target.value)}>{(campo.opcoes || []).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>{Dica}</label>
  if (tipo === 'sim') return <label className="cont-campo cont-sim"><input type="checkbox" checked={valor !== false && valor != null ? !!valor : valor === undefined ? campo.padrao !== false : false} onChange={(e) => onChange(e.target.checked)} /> <span>{rotulo}</span>{Dica}</label>
  if (tipo === 'rota') return <label className="cont-campo cont-curto"><span>{rotulo}</span><select value={valor ?? ''} onChange={(e) => onChange(e.target.value || null)}><option value="">nenhuma (página de topo)</option>{(opcoes.rotas || []).map(([r, n]) => <option key={r} value={r}>{n} · {r}</option>)}</select>{Dica}</label>
  if (tipo === 'rotas' || tipo === 'artigos') return <SeletorOrdenado rotulo={rotulo} dica={dica} valor={Array.isArray(valor) ? valor : []} onChange={onChange} opcoes={tipo === 'rotas' ? opcoes.rotas || [] : opcoes.artigos || []} />
  if (tipo === 'pares') return <Pares campo={campo} valor={Array.isArray(valor) ? valor : []} onChange={onChange} />
  if (tipo === 'grupo') {
    const g = valor && typeof valor === 'object' ? valor : {}
    return <fieldset className="cont-grupo"><legend>{rotulo}</legend>{campo.campos.map((c) => <Campo key={c.chave} campo={c} valor={g[c.chave]} onChange={(novo) => onChange({ ...g, [c.chave]: novo })} opcoes={opcoes} />)}{Dica}</fieldset>
  }
  if (tipo === 'lista') return <Lista campo={campo} valor={Array.isArray(valor) ? valor : []} onChange={onChange} opcoes={opcoes} />
  return null
}

function Botoes({ i, total, onMover, onTirar }) {
  return (
    <span className="cont-botoes">
      <button type="button" className="icon-btn" title="Subir" disabled={i === 0} onClick={() => onMover(-1)}><ChevronUp size={15} /></button>
      <button type="button" className="icon-btn" title="Descer" disabled={i === total - 1} onClick={() => onMover(1)}><ChevronDown size={15} /></button>
      <button type="button" className="icon-btn cont-tirar" title="Tirar" onClick={onTirar}><Trash2 size={15} /></button>
    </span>
  )
}

function Lista({ campo, valor, onChange, opcoes }) {
  const vazio = () => Object.fromEntries(campo.campos.map((c) => [c.chave, c.tipo === 'linhas' || c.tipo === 'pares' ? [] : '']))
  return (
    <div className="cont-lista">
      <div className="cont-lista-cabeca"><span>{campo.rotulo}</span>{campo.dica && <small className="cont-dica">{campo.dica}</small>}</div>
      {valor.map((item, i) => (
        <div className="cont-item" key={i}>
          <div className="cont-item-cabeca"><strong>{campo.nome || 'item'} {i + 1}{item?.titulo ? ` · ${String(item.titulo).slice(0, 40)}` : ''}</strong><Botoes i={i} total={valor.length} onMover={(d) => onChange(mover(valor, i, d))} onTirar={() => onChange(semIndice(valor, i))} /></div>
          {campo.campos.map((c) => <Campo key={c.chave} campo={c} valor={item?.[c.chave]} onChange={(novo) => onChange(valor.map((x, k) => (k === i ? { ...x, [c.chave]: novo } : x)))} opcoes={opcoes} />)}
        </div>
      ))}
      <button type="button" className="btn btn-ghost cont-mais" onClick={() => onChange([...valor, vazio()])}><Plus size={15} /> {campo.nome ? `Nova ${campo.nome}` : 'Novo item'}</button>
    </div>
  )
}

function Pares({ campo, valor, onChange }) {
  const [ra, rb] = campo.rotulos || ['A', 'B']
  const [aa, ab] = campo.areas || [false, false]
  const par = (p) => (Array.isArray(p) ? p : ['', ''])
  const Entrada = ({ area, v, ao }) => (area ? <textarea rows={2} value={v} onChange={(e) => ao(e.target.value)} /> : <input value={v} onChange={(e) => ao(e.target.value)} />)
  return (
    <div className="cont-lista">
      <div className="cont-lista-cabeca"><span>{campo.rotulo}</span>{campo.dica && <small className="cont-dica">{campo.dica}</small>}</div>
      {valor.map((p, i) => { const [x, y] = par(p); return (
        <div className="cont-par" key={i}>
          <label><span>{ra}</span><Entrada area={aa} v={x} ao={(nv) => onChange(valor.map((q, k) => (k === i ? [nv, y] : q)))} /></label>
          <label><span>{rb}</span><Entrada area={ab} v={y} ao={(nv) => onChange(valor.map((q, k) => (k === i ? [x, nv] : q)))} /></label>
          <Botoes i={i} total={valor.length} onMover={(d) => onChange(mover(valor, i, d))} onTirar={() => onChange(semIndice(valor, i))} />
        </div>
      ) })}
      <button type="button" className="btn btn-ghost cont-mais" onClick={() => onChange([...valor, ['', '']])}><Plus size={15} /> Nova linha</button>
    </div>
  )
}

// uma lista ordenada de chaves (rotas ou slugs), escolhidas de um cardápio
function SeletorOrdenado({ rotulo, dica, valor, onChange, opcoes }) {
  const nome = (k) => opcoes.find(([c]) => c === k)?.[1] || k
  const sobrando = opcoes.filter(([k]) => !valor.includes(k))
  return (
    <div className="cont-lista">
      <div className="cont-lista-cabeca"><span>{rotulo}</span>{dica && <small className="cont-dica">{dica}</small>}</div>
      {valor.map((k, i) => <div className="cont-par cont-chave" key={k}><span><strong>{nome(k)}</strong> <small className="muted mono">{k}</small></span><Botoes i={i} total={valor.length} onMover={(d) => onChange(mover(valor, i, d))} onTirar={() => onChange(semIndice(valor, i))} /></div>)}
      {sobrando.length > 0 && <select className="cont-mais" value="" onChange={(e) => e.target.value && onChange([...valor, e.target.value])}><option value="">+ adicionar…</option>{sobrando.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>}
    </div>
  )
}
