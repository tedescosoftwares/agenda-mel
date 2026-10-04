import { useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { useCatalogo, imagemDaCategoria } from '../lib/catalogo'

// A escolha visual das categorias do salão (2.91): as da plataforma como
// cartões com imagem (toca para marcar), as só do salão como pílulas, e
// um campo para criar a sua. Quem guarda a escolha (salons.
// categorias_escolhidas) é quem usa: o passo Categorias da configuração e
// a tela de Serviços. "Outros" não aparece: é só o lugar de quem não
// escolheu categoria. Uma categoria inativa (Barba) só aparece para quem
// já a tinha.

const TONS = [['#ff2d7a', '#aa4cff'], ['#aa4cff', '#ff7baa'], ['#ff7baa', '#ff9a6c'], ['#7c5cff', '#ff2d7a'], ['#ff5c8a', '#c86bff'], ['#f26b8a', '#8a5cff'], ['#3d0c4e', '#ff2d7a'], ['#ff9a6c', '#ff2d7a'], ['#6c4cff', '#ff7baa'], ['#1f2026', '#aa4cff']]
export function tonsDaCategoria(posicao) { return TONS[posicao % TONS.length] }

// a imagem da categoria pela convenção /imagens/catalogo/<slug>.webp; sem
// arquivo, some e o gradiente do cartão aparece
export function ImagemCategoria({ cat, className = '' }) {
  const [falhou, setFalhou] = useState(false)
  return (
    <span className={'cat-figura ' + className} aria-hidden="true">
      {!falhou && !cat.salon_id && <img src={imagemDaCategoria(cat)} alt="" loading="lazy" onError={() => setFalhou(true)} />}
    </span>
  )
}

// galeria (2.95.3): o modo editorial da configuração inicial — foto grande com
// o nome sobre um degradê, descrição em duas linhas, selo de escolha na foto
export default function EscolhaDeCategorias({ categorias, escolhidas = [], onAlternar, minhas = [], onCriar, onTirar, contagens = {}, galeria = false }) {
  const catalogo = useCatalogo()
  const [nova, setNova] = useState('')
  const plataforma = categorias.filter((c) => !c.salon_id && c.slug !== 'outros' && (c.ativa !== false || escolhidas.includes(c.id)))
  const marcadas = plataforma.filter((c) => escolhidas.includes(c.id)).length
  function criar(e) {
    e.preventDefault()
    const n = nova.trim()
    if (!n || !onCriar) return
    onCriar(n); setNova('')
  }
  return (
    <div className={'escolha-cats' + (galeria ? ' escolha-cats-galeria' : '')}>
      <div className="escolha-cats-topo">
        <strong>{marcadas + minhas.length === 0 ? 'Toque nas áreas que fazem parte do seu trabalho' : `${marcadas + minhas.length} ${marcadas + minhas.length === 1 ? 'categoria escolhida' : 'categorias escolhidas'}`}</strong>
        <span className="muted">As sugestões de serviço e a sua página seguem o que estiver marcado aqui.</span>
      </div>
      <div className="escolha-cats-grade">
        {plataforma.map((c, i) => {
          const marcada = escolhidas.includes(c.id)
          const nSv = contagens[c.id] ?? 0
          const nCat = catalogo ? catalogo.servicosDe(c.id).length : 0
          const [a, b] = tonsDaCategoria(i)
          return (
            <button key={c.id} type="button" className={'escolha-cat' + (marcada ? ' marcada' : '') + (c.ativa === false ? ' antiga' : '')} onClick={() => onAlternar(c.id)} aria-pressed={marcada} style={{ '--cat-a': a, '--cat-b': b, '--cat-atraso': `${Math.min(i, 9) * 40}ms` }}>
              {galeria ? (
                <span className="escolha-cat-capa"><ImagemCategoria cat={c} className="escolha-cat-img" /><span className="escolha-cat-nome">{c.nome}</span></span>
              ) : <ImagemCategoria cat={c} className="escolha-cat-img" />}
              <span className="escolha-cat-txt">
                {!galeria && <strong>{c.nome}</strong>}
                {c.descricao && <small>{c.descricao}</small>}
                <em className={nSv > 0 ? 'seus' : ''}>{nSv > 0 ? `${nSv} ${nSv === 1 ? 'serviço seu' : 'serviços seus'}` : nCat > 0 ? (galeria ? `${nCat} sugestões` : `${nCat} sugestões no catálogo`) : c.ativa === false ? 'categoria antiga' : ''}</em>
              </span>
              <span className="escolha-cat-check"><Check size={14} strokeWidth={3} /></span>
            </button>
          )
        })}
      </div>
      {(onCriar || minhas.length > 0) && (
        <div className="escolha-cats-minhas">
          <small className="ob-cat-rotulo">Categorias só suas</small>
          <div className="ob-cats">
            {minhas.map((c) => (
              <span key={c.id} className="ob-cat">{c.nome}{contagens[c.id] > 0 && <i className="escolha-cat-n">{contagens[c.id]}</i>}{onTirar && <button type="button" onClick={() => onTirar(c)} aria-label={`Tirar ${c.nome}`}><X size={12} /></button>}</span>
            ))}
            {minhas.length === 0 && <span className="muted escolha-cats-vazio">Nenhuma ainda. Serve para o que não cabe nas de cima, como “Noivas” ou “Infantil”.</span>}
          </div>
          {onCriar && (
            <form className="escolha-cats-nova" onSubmit={criar}>
              <input value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Criar uma categoria sua" maxLength={40} aria-label="Nome da nova categoria" />
              <button type="submit" className="btn btn-ghost btn-mini" disabled={!nova.trim()}><Plus size={13} /> Criar</button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
