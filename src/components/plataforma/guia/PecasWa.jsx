import { useEffect, useRef } from 'react'
import { Check, TriangleAlert, Undo2, Save, LoaderCircle } from 'lucide-react'
import { haQuanto } from '../Pecas'

// 3.58/3.59: as peças do layout das abas WhatsApp e Onboarding (o visual .pg-wa-v2 em guia-plataforma.css): o cartão de
// número, o funil, a navegação por seções, o interruptor, o bloco de configuração com índice, a barra de salvar e o chat.
// Ficam aqui para as duas abas serem iguais ponto a ponto.

export const Pilula = ({ par }) => <span className={'pg-wa-pilula ' + (par?.[1] ?? 'cinza')}>{par?.[0] ?? '?'}</span>

// um interruptor (liga/desliga) no lugar da caixinha: o input fica por cima da pista, então o clique e o teste caem nele
export function Chave({ checked, onChange, children, teste, disabled }) {
  return (
    <label className={'pg-wa-chave' + (disabled ? ' off' : '')}>
      <span className="pg-wa-chave-pista"><input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} data-teste={teste} disabled={disabled} /><i /></span>
      <span className="pg-wa-chave-txt">{children}</span>
    </label>
  )
}

// um cartão de número, com ícone (e uma barra, quando há um limite)
export function Tile({ Icon, cor, n, extra, rotulo, teste, barra }) {
  return (
    <div className={'pg-wa-kpi ' + cor} data-teste={teste}>
      <span className={'plat-icone pequeno ' + cor}><Icon /></span>
      <div><b>{n ?? 0}{extra}</b><span>{rotulo}</span>{barra != null && <i className="pg-wa-kpi-barra"><em style={{ width: `${barra}%` }} /></i>}</div>
    </div>
  )
}

// o funil: a primeira linha é a base; as outras mostram a porcentagem sobre ela
export function Funil({ titulo, sub, linhas, teste }) {
  const base = Number(linhas?.[0]?.[1] ?? 0)
  const pct = (v) => (base ? Math.round(((v ?? 0) / base) * 100) : 0)
  const cores = ['a', 'b', 'c', 'd', 'e']
  return (
    <div className="pg-wa-funil" data-teste={teste}>
      <b>{titulo} {sub && <span className="muted">({sub})</span>}</b>
      {(linhas ?? []).map(([r, v], i) => (
        <div key={r} className="pg-wa-funil-linha"><span>{r}</span><i><em className={cores[i % cores.length]} style={{ width: `${i === 0 ? (base ? 100 : 0) : Math.max(pct(v) ? 3 : 0, pct(v))}%` }} /></i><strong>{v ?? 0}{i > 0 && base ? <small> {pct(v)}%</small> : null}</strong></div>
      ))}
    </div>
  )
}

// a navegação por seções (um segmento por seção, com a contagem e o ponto de "mudança sem salvar")
export function Nav({ secoes, secao, onTrocar, contagens = {}, sujo = false, prefixo, rotulo }) {
  return (
    <nav className="pg-seg pg-wa-nav" role="tablist" aria-label={rotulo}>
      {secoes.map(([id, texto, Icon]) => (
        <button key={id} type="button" role="tab" aria-selected={secao === id} className={secao === id ? 'ativo' : ''} onClick={() => onTrocar(id)} data-teste={`${prefixo}-secao-${id}`}>
          <Icon size={14} /> {texto}{contagens[id] > 0 && <span className="pg-wa-nav-n">{contagens[id]}</span>}{id === 'config' && sujo && <span className="pg-wa-nav-ponto" title="Alterações sem salvar" />}
        </button>
      ))}
    </nav>
  )
}

// um bloco da configuração (cartão com ícone, título e descrição); aoMontar registra o elemento para o índice
export function Bloco({ id, aoMontar, Icon, titulo, sub, children, teste }) {
  return (
    <section className="pg-wa-bloco" data-bloco={id} data-teste={teste} ref={(el) => aoMontar(id, el)}>
      <header><span className="plat-icone pequeno rosa"><Icon /></span><div><h4>{titulo}</h4>{sub && <p className="muted">{sub}</p>}</div></header>
      <div className="pg-wa-bloco-corpo">{children}</div>
    </section>
  )
}

// o índice lateral dos blocos (acompanha a rolagem: o pai liga o IntersectionObserver com useIndice, de lib/guiaWa.js)
export function Indice({ blocos, ativo, onIr, rotulo }) {
  return (
    <nav className="pg-wa-indice" aria-label={rotulo}>
      {blocos.map(([id, texto, Icon]) => <button key={id} type="button" className={ativo === id ? 'ativo' : ''} onClick={() => onIr(id)}><Icon size={14} /> {texto}</button>)}
    </nav>
  )
}
// a barra de salvar, fixa embaixo da configuração: diz se há mudança sem salvar
export function BarraSalvar({ sujo, salvando, atualizadoEm, onSalvar, onDescartar, teste }) {
  return (
    <div className={'pg-wa-salvar' + (sujo ? ' sujo' : '')} data-teste={`${teste}-barra`}>
      <span className="pg-wa-salvar-estado">{sujo ? <><TriangleAlert size={14} /> Alterações sem salvar</> : <><Check size={14} /> Tudo salvo{atualizadoEm ? ` · ${haQuanto(atualizadoEm)}` : ''}</>}</span>
      <div>
        {sujo && <button type="button" className="btn btn-ghost" onClick={onDescartar} disabled={salvando}><Undo2 size={15} /> Descartar</button>}
        <button type="button" className="btn btn-primary" onClick={onSalvar} disabled={salvando} data-teste={teste}>{salvando ? <LoaderCircle className="pg-gira" size={15} /> : <Save size={15} />} Salvar</button>
      </div>
    </div>
  )
}

// o chat (a conversa com a Mel ou com o agente), rolando para o fim
export function Chat({ mensagens, fim, teste }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }) }, [mensagens])
  return (
    <div className="pg-wa-chat" ref={ref} data-teste={teste}>
      {(mensagens ?? []).map((m, i) => <div key={i} className={'pg-wa-msg ' + (m.q === 'cliente' ? 'cliente' : 'mel')}>{m.t}</div>)}
      {fim}
    </div>
  )
}
