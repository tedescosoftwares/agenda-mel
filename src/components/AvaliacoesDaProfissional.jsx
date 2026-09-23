import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Star, MessageSquareQuote } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Avatar from './Avatar'

// As avaliações de uma profissional, num modal aberto pelo quadro: média,
// distribuição, por serviço e os comentários, com filtro por nota e por
// período. É o retorno da cliente virando número, na mão de quem gere.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const hoje = () => new Date()
const PERIODOS = [
  { id: 'mes', rotulo: 'Este mês', calc: () => { const h = hoje(); return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(h)] } },
  { id: '30', rotulo: '30 dias', calc: () => { const h = hoje(); const i = new Date(h); i.setDate(h.getDate() - 29); return [iso(i), iso(h)] } },
  { id: '90', rotulo: '90 dias', calc: () => { const h = hoje(); const i = new Date(h); i.setDate(h.getDate() - 89); return [iso(i), iso(h)] } },
  { id: 'ano', rotulo: 'Este ano', calc: () => { const h = hoje(); return [iso(new Date(h.getFullYear(), 0, 1)), iso(h)] } },
]
const dataCurta = (d) => new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
const media = (m) => (m == null ? '—' : Number(m).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))

export function Estrelas({ nota, tamanho = 14 }) {
  return <span className="av-estrelas" aria-label={`${nota} de 5`}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={tamanho} className={n <= Math.round(Number(nota) || 0) ? 'cheia' : ''} />)}</span>
}

export default function AvaliacoesDaProfissional({ prof, salaoId, onFechar }) {
  const [periodo, setPeriodo] = useState('90')
  const [[de, ate], setFaixa] = useState(() => PERIODOS[2].calc())
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [nota, setNota] = useState(0)

  const carregar = useCallback(async () => {
    if (!salaoId) return
    const { data, error } = await supabase.rpc('avaliacoes_do_periodo', { salao: salaoId, de, ate })
    if (error) { setErro(error.message); return }
    setErro(''); setDados(data)
  }, [salaoId, de, ate])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onFechar?.() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onFechar])

  function escolher(id) { setPeriodo(id); const p = PERIODOS.find((x) => x.id === id); if (p) setFaixa(p.calc()) }

  // só o que é dela
  const minhas = useMemo(() => (dados?.lista ?? []).filter((x) => x.professional_id === prof.id), [dados, prof.id])
  const resumo = useMemo(() => {
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }; minhas.forEach((x) => { dist[x.nota] += 1 })
    const linha = (dados?.por_profissional ?? []).find((p) => p.professional_id === prof.id)
    const servicos = new Map()
    for (const x of minhas) { const s = servicos.get(x.servico) ?? { servico: x.servico, n: 0, soma: 0 }; s.n += 1; s.soma += x.nota; servicos.set(x.servico, s) }
    return { quantas: minhas.length, media: minhas.length ? minhas.reduce((t, x) => t + x.nota, 0) / minhas.length : null, dist, atendimentos: linha?.atendimentos ?? null,
      servicos: [...servicos.values()].map((s) => ({ ...s, media: s.soma / s.n })).sort((a, b) => b.media - a.media || b.n - a.n) }
  }, [minhas, dados, prof.id])
  const maxDist = Math.max(1, ...[1, 2, 3, 4, 5].map((n) => resumo.dist[n]))
  const taxa = resumo.atendimentos ? Math.round((resumo.quantas / resumo.atendimentos) * 100) : null
  const lista = nota ? minhas.filter((x) => x.nota === nota) : minhas
  const posicao = useMemo(() => { const ordem = (dados?.por_profissional ?? []).filter((p) => p.quantas >= 3); const i = ordem.findIndex((p) => p.professional_id === prof.id); return i >= 0 && ordem.length > 1 ? { lugar: i + 1, de: ordem.length } : null }, [dados, prof.id])

  return (
    <div className="modal-fundo av-modal-fundo" onClick={onFechar}>
      <div className="modal-caixa av-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Avaliações de ${prof.name}`}>
        <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        <div className="av-modal-topo">
          <Avatar nome={prof.name} foto={prof.photo_url} />
          <div><h3>{prof.name}</h3><p className="muted">Avaliações das clientes{posicao ? ` · ${posicao.lugar}ª de ${posicao.de} na casa` : ''}</p></div>
        </div>
        <div className="chips av-modal-chips">{PERIODOS.map((p) => <button key={p.id} type="button" className={'chip' + (periodo === p.id ? ' active' : '')} onClick={() => escolher(p.id)}>{p.rotulo}</button>)}</div>

        {erro && <div className="alert alert-error">{erro}</div>}
        {!dados && !erro && <p className="muted">Somando…</p>}

        {dados && (
          <>
            <div className="av-resumo av-resumo-modal">
              <div className="av-media">
                <strong>{media(resumo.media)}</strong>
                <Estrelas nota={resumo.media ?? 0} tamanho={18} />
                <span className="muted">{resumo.quantas} {resumo.quantas === 1 ? 'avaliação' : 'avaliações'}{taxa != null ? ` · ${taxa}% dos atendimentos` : ''}</span>
              </div>
              <div className="av-distribuicao">
                {[5, 4, 3, 2, 1].map((n) => (
                  <button key={n} type="button" className={'av-dist-linha' + (nota === n ? ' ativa' : '')} onClick={() => setNota(nota === n ? 0 : n)} title={`Ver só as de ${n}`}>
                    <span>{n} <Star size={11} className="cheia" /></span>
                    <span className="av-dist-barra"><span style={{ width: `${(resumo.dist[n] / maxDist) * 100}%` }} /></span>
                    <span className="av-dist-n">{resumo.dist[n]}</span>
                  </button>
                ))}
              </div>
            </div>

            {resumo.quantas === 0 && <p className="muted">Nenhuma avaliação entre {dataCurta(de)} e {dataCurta(ate)}.</p>}

            {resumo.servicos.length > 0 && (
              <div className="av-servicos av-servicos-modal">
                {resumo.servicos.map((s) => <div key={s.servico} className="av-servico"><span>{s.servico}</span><span className="av-pessoa-nota"><b>{media(s.media)}</b> <Estrelas nota={s.media} tamanho={11} /></span><span className="muted">{s.n}</span></div>)}
              </div>
            )}

            {minhas.length > 0 && (
              <div className="av-lista av-lista-modal">
                <div className="av-lista-topo"><strong><MessageSquareQuote size={14} /> Comentários e notas{nota ? ` · só ${nota} ★` : ''}</strong>{nota ? <button type="button" className="btn-mini btn-mini-neutro" onClick={() => setNota(0)}>ver todas</button> : null}</div>
                {lista.map((x) => (
                  <div key={x.id} className={'av-item' + (x.nota <= 3 ? ' baixa' : '')}>
                    <div className="av-item-topo"><Estrelas nota={x.nota} /><span className="muted">{dataCurta(x.em)} · {x.cliente} · {x.servico}</span></div>
                    {x.comentario ? <q>{x.comentario}</q> : <span className="muted av-sem">sem comentário</span>}
                  </div>
                ))}
                {lista.length === 0 && <p className="muted">Nada com essa nota.</p>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
