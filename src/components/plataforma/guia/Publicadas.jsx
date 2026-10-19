import { useMemo, useState } from 'react'
import { useDialogo } from '../../../context/DialogoContext'
import { Painel, Pilula, Vazio } from '../Pecas'
import EditarLugar from './Editar'
import { GUIA_CATEGORIAS, categoriaDoGuia, rotaDoLugar, semAcento, fotosDoLugar, ordemPublica } from '../../../lib/guia'
import { urlDoAmbiente } from '../../../lib/ambiente'
import { Globe2, Search, ExternalLink, RefreshCw, Pencil, EyeOff, LoaderCircle, TriangleAlert } from 'lucide-react'

// O que está no ar. Daqui dá para abrir a página no site, pedir uma versão
// nova à IA (a página no ar só muda quando a versão nova for aprovada, na
// aba Revisar), editar e tirar do ar.

const dataBr = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')
const norm = (s) => semAcento(s).toLowerCase()
const nFotos = (l) => fotosDoLugar(l).length
// as ordens (3.17): as mais recentes no ar, a ordem que o site usa, pelas fotos, A a Z
const ORDENS = {
  recentes: (a, b) => String(b.publicado_em ?? '').localeCompare(String(a.publicado_em ?? '')) || a.nome.localeCompare(b.nome, 'pt-BR'),
  site: ordemPublica,
  fotos: (a, b) => nFotos(b) - nFotos(a) || ordemPublica(a, b),
  sem_foto: (a, b) => nFotos(a) - nFotos(b) || ordemPublica(a, b),
  nome: (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
}

export default function Publicadas({ g }) {
  const { confirmar } = useDialogo()
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('')
  const [ordem, setOrdem] = useState('recentes')
  const [editando, setEditando] = useState(null)

  const lista = useMemo(() => {
    const t = norm(busca).trim()
    return g.lugares
      .filter((l) => l.status === 'publicado' && (!categoria || l.categoria === categoria) && (!t || norm(`${l.nome} ${l.bairro ?? ''}`).includes(t)))
      .sort(ORDENS[ordem] ?? ORDENS.recentes)
  }, [g.lugares, busca, categoria, ordem])
  const total = g.lugares.filter((l) => l.status === 'publicado').length

  async function novaVersao(l) {
    const r = await g.gerarUm(l.id)
    if (r.ok) g.avisar({ texto: `${l.nome}: versão nova pronta. A página no ar continua igual até você aprovar.`, acao: { rotulo: 'Revisar', onClick: () => g.irPara('revisar', { status: 'nova', selId: l.id }) } })
  }
  async function despublicar(l) {
    const ok = await confirmar({ titulo: `Tirar ${l.nome} do ar?`, texto: 'A página sai do site e da lista da cidade. O texto fica guardado e volta para "Para revisar".', ok: 'Tirar do ar', cancelar: 'Deixar no ar' })
    if (!ok) return
    const r = await g.salvarLugar(l.id, { status: 'gerado' })
    if (!r.ok) { g.avisar({ texto: r.erro, tom: 'erro' }); return }
    g.avisar({ texto: `${l.nome} saiu do ar.`, acao: { rotulo: 'Desfazer', onClick: () => g.salvarLugar(l.id, { status: 'publicado' }) } })
  }

  return (
    <Painel Icon={Globe2} titulo="Publicadas" sub={total ? `${total} ${total === 1 ? 'página no ar' : 'páginas no ar'}. Para mudar o texto, gere uma versão nova: ela espera a sua aprovação em Revisar.` : 'As páginas aprovadas aparecem aqui.'}>
      {g.carregando ? <Vazio>Carregando…</Vazio> : total === 0 ? (
        <div className="pg-lista-vazia">
          <p>Nenhuma página no ar ainda.</p>
          <button type="button" className="plat-link" onClick={() => g.irPara('revisar', {})}>Ir para a revisão</button>
        </div>
      ) : (
        <>
          <div className="pg-filtros-linha">
            <label className="pg-busca"><Search size={15} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou bairro" aria-label="Buscar página" /></label>
            <select className="plat-select" value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria">
              <option value="">Todas as categorias</option>
              {GUIA_CATEGORIAS.map((c) => <option key={c.slug} value={c.slug}>{c.rotulo}</option>)}
            </select>
            <select className="plat-select" value={ordem} onChange={(e) => setOrdem(e.target.value)} aria-label="Ordem da lista">
              <option value="recentes">Mais recentes no ar</option>
              <option value="site">Ordem do site</option>
              <option value="fotos">Mais fotos</option>
              <option value="sem_foto">Sem foto 1º</option>
              <option value="nome">A a Z</option>
            </select>
          </div>
          {lista.length === 0 ? <Vazio>Nada com esses filtros.</Vazio> : (
            <div className="pg-tabela-rola">
              <table className="plat-tabela pg-tabela-pub">
                <thead><tr><th>Salão</th><th>No ar desde</th><th /></tr></thead>
                <tbody>
                  {lista.map((l) => {
                    const ger = g.gerando[l.id]
                    return (
                      <tr key={l.id}>
                        <td>
                          <b>{l.nome}</b>
                          <small className="pg-celula-sub">{[categoriaDoGuia(l.categoria).curto, l.bairro].filter(Boolean).join(' · ')}</small>
                          <div className="pg-celula-selos">
                            {l.selecao && <Pilula tom="rosa">Seleção</Pilula>}
                            {l.salon_id && <Pilula tom="menta">na MIMO</Pilula>}
                            <Pilula tom={nFotos(l) ? 'cinza' : 'ambar'}>{nFotos(l) ? `${nFotos(l)} ${nFotos(l) === 1 ? 'foto' : 'fotos'}` : 'sem foto'}</Pilula>
                            {l.tem_rascunho && <button type="button" className="pg-pilula-botao" onClick={() => g.irPara('revisar', { status: 'nova', selId: l.id })}><Pilula tom="roxo">versão nova esperando</Pilula></button>}
                            {g.falhas[l.id] && <span className="pg-ruim" title={g.falhas[l.id]}><TriangleAlert size={12} /> erro ao gerar</span>}
                          </div>
                        </td>
                        <td>{dataBr(l.publicado_em)}</td>
                        <td className="pg-acoes-linha">
                          <a className="plat-link" href={urlDoAmbiente('cliente', rotaDoLugar(l.cidade_slug, l.slug))} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Ver no site</a>
                          <button type="button" className="plat-link" onClick={() => novaVersao(l)} disabled={!!ger}>{ger ? <><LoaderCircle size={13} className="pg-gira" /> {ger.espera ? `em ${ger.espera} s` : 'gerando…'}</> : <><RefreshCw size={13} /> Nova versão</>}</button>
                          <button type="button" className="plat-link" onClick={() => g.carregarTexto(l.id).catch(() => null).then(() => setEditando(l.id))}><Pencil size={13} /> Editar</button>
                          <button type="button" className="plat-link pg-perigo" onClick={() => despublicar(l)}><EyeOff size={13} /> Despublicar</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {editando && g.lugares.some((l) => l.id === editando) && <EditarLugar lugar={g.lugares.find((l) => l.id === editando)} g={g} onFechar={() => setEditando(null)} />}
    </Painel>
  )
}
