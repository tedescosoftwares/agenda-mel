import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'

// 3.38: as páginas da lista de "todas as cidades" (500 por vez, filtradas e contadas no banco).
// pg: { pagina, paginas, total, lendo } (g.paginacao); onIr(n) pede a página n.
export default function Paginador({ pg, onIr, nomes = ['salão', 'salões'] }) {
  if (!pg) return null
  const { pagina = 1, paginas = 1, total = 0, lendo = false } = pg
  const n = Number(total) || 0
  return (
    <nav className="pg-paginador" aria-label="Páginas da lista" data-teste="paginador">
      <button type="button" onClick={() => onIr(pagina - 1)} disabled={lendo || pagina <= 1} aria-label="Página anterior" title="Página anterior"><ChevronLeft size={16} /></button>
      {lendo ? <LoaderCircle size={13} className="pg-gira" aria-label="lendo a página" /> : null}
      <span>Página <b>{pagina}</b> de <b>{paginas}</b> · {n.toLocaleString('pt-BR')} {n === 1 ? nomes[0] : nomes[1]}</span>
      <button type="button" onClick={() => onIr(pagina + 1)} disabled={lendo || pagina >= paginas} aria-label="Próxima página" title="Próxima página"><ChevronRight size={16} /></button>
    </nav>
  )
}

