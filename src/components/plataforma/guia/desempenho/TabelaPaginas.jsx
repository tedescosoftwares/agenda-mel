import { useMemo, useState } from 'react'
import { Eye, Search, ExternalLink, Send, ChevronUp, ChevronDown, X } from 'lucide-react'
import { Painel, Vazio } from '../../Pecas'
import { categoriaDoGuia, semAcento } from '../../../../lib/guia'
import { urlDoAmbiente } from '../../../../lib/ambiente'
import { nomesDosBairros } from '../../../../lib/guiaColecoes'
import { n0, formatar, taxaTexto, taxaDeContato, contataramDe, nomeDaPagina, podeMandarMensagem } from '../../../../lib/guiaMetricas'

// A tabela por página (3.12): a barra de visitas na própria linha, o
// cabeçalho fica parado ao rolar, 25 linhas por vez ("mostrar mais"),
// busca e ordem por qualquer coluna. Salão no ar sem nenhuma visita também
// aparece (o filtro "Sem visita"). O nome abre a página pública; o botão
// monta a mensagem com os números para o dono do salão.

const FILTROS = [['todas', 'Todas'], ['saloes', 'Salões'], ['cidade', 'Cidade e categorias'], ['zeradas', 'Sem visita']]
const PASSO = 25
const ORDENS = [['visitas', 'Visitas'], ['visitantes', 'Pessoas'], ['pessoasContato', 'Tentaram contato'], ['pedidos', 'Pedidos'], ['tx', 'Taxa'], ['titulo', 'Nome']]
const doFiltro = (id, p) => id === 'todas' || (id === 'saloes' && p.lugar_id) || (id === 'cidade' && !p.lugar_id) || (id === 'zeradas' && !n0(p.visitas))

// ancora: um useRef de quem chama, para rolar a tela até a tabela ("ver na tabela" dos destaques)
export default function TabelaPaginas({ dados, contatoTipos, filtro, setFiltro, nomeDaCidade, onMensagem, ancora }) {
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState({ col: 'visitas', desc: true })
  // quantas linhas aparecem; volta a 25 quando o filtro, a busca ou a ordem mudam
  const chave = `${filtro}|${busca}|${ordem.col}|${ordem.desc}`
  const [lim, setLim] = useState({ chave, n: PASSO })
  if (lim.chave !== chave) setLim({ chave, n: PASSO }) // o jeito do React de "resetar quando muda", sem efeito
  const limite = lim.chave === chave ? lim.n : PASSO

  // o nome com acento dos bairros, pelos salões da própria tabela (para as páginas de bairro)
  const bairros = useMemo(() => nomesDosBairros((dados?.paginas ?? []).filter((p) => p.lugar_id)), [dados])
  const todas = useMemo(() => (dados?.paginas ?? []).map((p) => ({
    ...p, titulo: nomeDaPagina(p, nomeDaCidade, (k) => bairros.get(k)), pedidos: n0(p.interesses?.quero_marcar),
    pessoasContato: contataramDe(p.contataram, p.visitantes), tx: p.lugar_id ? taxaDeContato(p.contataram, p.visitantes) : null,
  })), [dados, nomeDaCidade, bairros])
  const contagem = useMemo(() => Object.fromEntries(FILTROS.map(([id]) => [id, todas.filter((p) => doFiltro(id, p)).length])), [todas])
  // 3.39 (187): em todas as cidades o banco manda as 1.000 páginas mais visitadas e os 300 sem visita há mais tempo no ar
  const limitada = dados?.paginas_limite != null && (n0(dados?.paginas_total) > n0(dados?.paginas_limite) || n0(dados?.sem_visita_total) > n0(dados?.sem_visita_limite))
  const linhas = useMemo(() => {
    const termo = semAcento(busca).toLowerCase().trim()
    const valor = (p) => (ordem.col === 'titulo' ? p.titulo : ordem.col === 'tx' ? (p.tx ?? -1) : ordem.col.startsWith('ev:') ? n0(p.eventos?.[ordem.col.slice(3)]) : n0(p[ordem.col]))
    return todas
      .filter((p) => doFiltro(filtro, p) && (!termo || semAcento(`${p.titulo} ${p.bairro ?? ''} ${p.pagina}`).toLowerCase().includes(termo)))
      .sort((a, b) => {
        const va = valor(a), vb = valor(b)
        const c = typeof va === 'string' ? va.localeCompare(vb, 'pt-BR') : va - vb
        return (ordem.desc ? -c : c) || a.titulo.localeCompare(b.titulo, 'pt-BR')
      })
  }, [todas, filtro, busca, ordem])
  const maxVisitas = Math.max(1, ...linhas.map((p) => n0(p.visitas)))
  const vistas = linhas.slice(0, limite)
  const faltam = linhas.length - vistas.length

  const ordenarPor = (col) => setOrdem((o) => (o.col === col ? { col, desc: !o.desc } : { col, desc: col !== 'titulo' }))
  const cab = (col, rotulo, classe = 'pg-num') => (
    <th key={col} className={classe} aria-sort={ordem.col === col ? (ordem.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => ordenarPor(col)}>{rotulo}{ordem.col === col && (ordem.desc ? <ChevronDown size={13} /> : <ChevronUp size={13} />)}</button>
    </th>
  )
  const traco = <span className="pg-des-traco">–</span>

  return (
    <Painel Icon={Eye} className="pg-des-paginas" titulo="Por página" sub="Clique no título de uma coluna para ordenar. O nome abre a página no site.">
      <div ref={ancora} className="pg-des-tabfiltros">
        <div className="pg-seg" role="radiogroup" aria-label="Quais páginas">
          {FILTROS.map(([id, r]) => (
            <button key={id} type="button" role="radio" aria-checked={filtro === id} className={filtro === id ? 'ativo' : ''} onClick={() => setFiltro(id)}>
              {r} <span className="pg-des-conta">{contagem[id]}</span>
            </button>
          ))}
        </div>
        {/* no celular a tabela vira cartões e o cabeçalho some: a ordem vem daqui */}
        <label className="pg-des-ordem">
          <span>Ordenar por</span>
          <select value={ordem.col.startsWith('ev:') ? 'visitas' : ordem.col} onChange={(e) => setOrdem({ col: e.target.value, desc: e.target.value !== 'titulo' })}>
            {ORDENS.map(([col, r]) => <option key={col} value={col}>{r}</option>)}
          </select>
        </label>
        <label className="pg-busca pg-des-busca">
          <Search size={15} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar página, salão ou bairro" aria-label="Buscar página" />
          {busca && <button type="button" onClick={() => setBusca('')} aria-label="Limpar a busca"><X size={14} /></button>}
        </label>
      </div>
      {limitada && (
        <p className="pg-nota pg-des-limitada" data-teste="tabela-limitada">
          Em todas as cidades a tabela mostra as {formatar(Math.min(n0(dados.paginas_total), n0(dados.paginas_limite)))} páginas mais visitadas (de {formatar(dados.paginas_total)} com visita) e os {formatar(Math.min(n0(dados.sem_visita_total), n0(dados.sem_visita_limite)))} salões sem visita há mais tempo no ar (de {formatar(dados.sem_visita_total)}). Os números do topo e o gráfico contam tudo. Escolha uma cidade para ver a lista inteira dela.
        </p>
      )}
      <div className="pg-des-tabela pg-des-tabela-paginas">
        <table className="plat-tabela">
          <thead>
            <tr>
              {cab('titulo', 'Página', 'pg-des-col-pagina')}
              {cab('visitas', 'Visitas', 'pg-num pg-des-col-visitas')}
              {cab('visitantes', 'Pessoas')}
              {cab('pessoasContato', 'Tentaram contato')}
              {contatoTipos.map((x) => cab(`ev:${x.tipo}`, x.rotulo, 'pg-num pg-des-col-tipo'))}
              {cab('pedidos', 'Pedidos')}
              {cab('tx', 'Taxa')}
              <th><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 && <tr><td colSpan={7 + contatoTipos.length}><Vazio>Nenhuma página com esse filtro{busca ? ' e essa busca' : ''}.</Vazio></td></tr>}
            {vistas.map((p) => (
              <tr key={p.pagina} className={n0(p.visitas) ? '' : 'zerada'}>
                <td className="pg-des-col-pagina">
                  <div className="pg-des-pagina">
                    <a className="pg-des-nome" href={urlDoAmbiente('cliente', p.pagina)} target="_blank" rel="noopener noreferrer">{p.titulo} <ExternalLink size={12} /></a>
                    <small>{p.lugar_id ? [p.bairro, p.categoria && categoriaDoGuia(p.categoria).curto, p.status && p.status !== 'publicado' ? 'fora do ar' : null].filter(Boolean).join(' · ') : p.pagina}</small>
                  </div>
                </td>
                <td className="pg-num pg-des-col-visitas" data-rotulo="Visitas">
                  <span className="pg-des-celbarra">
                    <span className="pg-des-celbarra-trilho"><i style={{ width: n0(p.visitas) ? `max(3px, ${(n0(p.visitas) / maxVisitas) * 100}%)` : 0 }} /></span>
                    <b>{formatar(p.visitas)}</b>
                  </span>
                </td>
                <td className="pg-num" data-rotulo="Pessoas">{n0(p.visitantes) ? formatar(p.visitantes) : traco}</td>
                <td className="pg-num" data-rotulo="Contato">{p.pessoasContato ? <b>{formatar(p.pessoasContato)}</b> : traco}</td>
                {contatoTipos.map((x) => <td key={x.tipo} className="pg-num pg-des-col-tipo">{n0(p.eventos?.[x.tipo]) || traco}</td>)}
                <td className="pg-num" data-rotulo="Pedidos">{p.pedidos || traco}</td>
                <td className="pg-num" data-rotulo="Taxa">{p.tx == null ? traco : taxaTexto(p.tx)}</td>
                <td className="pg-num pg-des-col-acao">
                  {podeMandarMensagem(p) && (
                    <button type="button" className="pg-des-dest-acao" onClick={() => onMensagem(p)} title="Mensagem com estes números para o dono do salão" aria-label={`Mensagem para o dono de ${p.titulo}`}>
                      <Send size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {linhas.length > PASSO && (
        <div className="pg-des-mais">
          <span>{faltam ? `Mostrando ${formatar(vistas.length)} de ${formatar(linhas.length)} páginas` : `Todas as ${formatar(linhas.length)} páginas`}</span>
          {faltam > 0 && <button type="button" className="btn btn-ghost pg-btn-peq" onClick={() => setLim({ chave, n: limite + PASSO })}>Mostrar mais {formatar(Math.min(PASSO, faltam))}</button>}
          {faltam > PASSO && <button type="button" className="plat-link" onClick={() => setLim({ chave, n: linhas.length })}>Mostrar todas</button>}
          {!faltam && <button type="button" className="plat-link" onClick={() => setLim({ chave, n: PASSO })}>Mostrar menos</button>}
        </div>
      )}
    </Painel>
  )
}
