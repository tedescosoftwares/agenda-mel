import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Star, MessageSquareQuote, Info } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

// Avaliações do período: média e volume da casa, por profissional e por
// serviço, e a lista de comentários com filtro por nota. É o retorno da
// cliente virando número: quem está indo bem, o que precisa de olho.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const hoje = () => new Date()
const PERIODOS = [
  { id: 'semana', rotulo: 'Esta semana', calc: () => { const h = hoje(); const i = new Date(h); i.setDate(h.getDate() - ((h.getDay() + 6) % 7)); return [iso(i), iso(h)] } },
  { id: 'mes', rotulo: 'Este mês', calc: () => { const h = hoje(); return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(h)] } },
  { id: 'mes-passado', rotulo: 'Mês passado', calc: () => { const h = hoje(); return [iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), iso(new Date(h.getFullYear(), h.getMonth(), 0))] } },
  { id: '90', rotulo: '90 dias', calc: () => { const h = hoje(); const i = new Date(h); i.setDate(h.getDate() - 89); return [iso(i), iso(h)] } },
  { id: 'ano', rotulo: 'Este ano', calc: () => { const h = hoje(); return [iso(new Date(h.getFullYear(), 0, 1)), iso(h)] } },
]
const dataCurta = (d) => new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
const media = (m) => (m == null ? '—' : Number(m).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))

function Estrelas({ nota, tamanho = 14 }) {
  return <span className="av-estrelas" aria-label={`${nota} de 5`}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={tamanho} className={n <= Math.round(Number(nota) || 0) ? 'cheia' : ''} />)}</span>
}

export default function AdminAvaliacoes() {
  const { salao } = useAuth()
  const [periodo, setPeriodo] = useState('mes')
  const [[de, ate], setFaixa] = useState(() => PERIODOS[1].calc())
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [nota, setNota] = useState(0)        // filtro da lista: 0 = todas
  const [prof, setProf] = useState('')       // filtro da lista por profissional

  const carregar = useCallback(async () => {
    if (!salao?.id || !de || !ate) return
    const { data, error } = await supabase.rpc('avaliacoes_do_periodo', { salao: salao.id, de, ate })
    if (error) { setErro(error.message); return }
    setErro(''); setDados(data)
  }, [salao?.id, de, ate])
  useEffect(() => { carregar() }, [carregar])

  function escolher(id) { setPeriodo(id); const p = PERIODOS.find((x) => x.id === id); if (p) setFaixa(p.calc()) }
  function mudarData(qual, v) { setPeriodo('custom'); setFaixa(([a, b]) => (qual === 'de' ? [v, b] : [a, v])) }

  const t = dados?.total
  const dist = t?.distribuicao ?? {}
  const maxDist = Math.max(1, ...[1, 2, 3, 4, 5].map((n) => Number(dist[n] ?? 0)))
  const taxa = t && t.atendimentos > 0 ? Math.round((t.quantas / t.atendimentos) * 100) : null
  const lista = useMemo(() => (dados?.lista ?? []).filter((x) => (!nota || x.nota === nota) && (!prof || x.professional_id === prof)), [dados, nota, prof])

  return (
    <AdminShell>
      <div className="page-head">
        <div><h2>Avaliações</h2><p className="muted">O que as clientes disseram no período.</p></div>
      </div>

      <div className="rp-periodo">
        <div className="chips">{PERIODOS.map((p) => <button key={p.id} type="button" className={'chip' + (periodo === p.id ? ' active' : '')} onClick={() => escolher(p.id)}>{p.rotulo}</button>)}</div>
        <div className="rp-datas">
          <label>de <input type="date" value={de} max={ate} onChange={(e) => mudarData('de', e.target.value)} /></label>
          <label>até <input type="date" value={ate} min={de} onChange={(e) => mudarData('ate', e.target.value)} /></label>
        </div>
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}
      {!dados && !erro && <p className="muted">Somando…</p>}

      {t && (
        <div className="card av-resumo">
          <div className="av-media">
            <strong>{media(t.media)}</strong>
            <Estrelas nota={t.media ?? 0} tamanho={18} />
            <span className="muted">{t.quantas} {t.quantas === 1 ? 'avaliação' : 'avaliações'}{taxa != null ? ` · ${taxa}% dos atendimentos` : ''}</span>
          </div>
          <div className="av-distribuicao">
            {[5, 4, 3, 2, 1].map((n) => (
              <button key={n} type="button" className={'av-dist-linha' + (nota === n ? ' ativa' : '')} onClick={() => setNota(nota === n ? 0 : n)} title={`Ver só as de ${n}`}>
                <span>{n} <Star size={11} className="cheia" /></span>
                <span className="av-dist-barra"><span style={{ width: `${(Number(dist[n] ?? 0) / maxDist) * 100}%` }} /></span>
                <span className="av-dist-n">{dist[n] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {dados && t?.quantas === 0 && <p className="muted">Nenhuma avaliação entre {dataCurta(de)} e {dataCurta(ate)}.</p>}

      {(dados?.por_profissional ?? []).length > 0 && (
        <section className="secao">
          <h3 className="secao-titulo">Por profissional</h3>
          <div className="av-grade">
            {dados.por_profissional.map((p, i) => (
              <button key={p.professional_id ?? 'sem'} type="button" className={'card av-pessoa' + (prof === p.professional_id ? ' ativa' : '') + (i === 0 && dados.por_profissional.length > 1 && p.quantas >= 3 ? ' destaque' : '')} onClick={() => setProf(prof === p.professional_id ? '' : p.professional_id)}>
                <span className="rp-avatar">{(p.nome ?? '?').charAt(0)}</span>
                <span className="av-pessoa-texto">
                  <strong>{p.nome}</strong>
                  <span className="av-pessoa-nota"><b>{media(p.media)}</b> <Estrelas nota={p.media} tamanho={12} /></span>
                  <span className="muted">{p.quantas} {p.quantas === 1 ? 'avaliação' : 'avaliações'}{p.atendimentos ? ` em ${p.atendimentos} atendimentos` : ''}{p.cinco ? ` · ${p.cinco} cinco estrelas` : ''}{p.baixas ? ` · ${p.baixas} ${p.baixas === 1 ? 'baixa' : 'baixas'}` : ''}</span>
                </span>
                {i === 0 && dados.por_profissional.length > 1 && p.quantas >= 3 && <em className="av-selo">mais bem avaliada</em>}
              </button>
            ))}
          </div>
        </section>
      )}

      {(dados?.por_servico ?? []).length > 0 && (
        <section className="secao">
          <h3 className="secao-titulo">Por serviço</h3>
          <div className="card av-servicos">
            {dados.por_servico.map((s) => (
              <div key={s.servico} className="av-servico"><span>{s.servico}</span><span className="av-pessoa-nota"><b>{media(s.media)}</b> <Estrelas nota={s.media} tamanho={11} /></span><span className="muted">{s.quantas}</span></div>
            ))}
          </div>
        </section>
      )}

      {(dados?.lista ?? []).length > 0 && (
        <section className="secao">
          <h3 className="secao-titulo">Comentários e notas{nota ? ` · só ${nota} ★` : ''}{prof ? ` · ${dados.por_profissional.find((p) => p.professional_id === prof)?.nome?.split(' ')[0] ?? ''}` : ''}{(nota || prof) ? <button type="button" className="btn-mini btn-mini-neutro av-limpar" onClick={() => { setNota(0); setProf('') }}>ver todas</button> : null}</h3>
          <div className="av-lista">
            {lista.map((x) => (
              <div key={x.id} className={'card av-item' + (x.nota <= 3 ? ' baixa' : '')}>
                <div className="av-item-topo">
                  <Estrelas nota={x.nota} />
                  <span className="muted">{dataCurta(x.em)} · {x.cliente} · {x.servico}{x.profissional ? ` com ${x.profissional.split(' ')[0]}` : ''}</span>
                </div>
                {x.comentario ? <q>{x.comentario}</q> : <span className="muted av-sem">sem comentário</span>}
                {x.appointment_id && <Link to="/admin/pdv" className="av-ver muted">ver no PDV</Link>}
              </div>
            ))}
            {lista.length === 0 && <p className="muted">Nada com esse filtro.</p>}
          </div>
        </section>
      )}

      <div className="card rp-como">
        <p><Info size={15} /> <strong>Como é contado.</strong> Entram as avaliações que a cliente deu no período (pela data em que avaliou). Cada horário é avaliado separado, então numa visita com duas profissionais cada uma recebe a sua nota. "Baixas" são notas de 1 a 3.</p>
        <p className="muted"><MessageSquareQuote size={14} /> Uma nota baixa com comentário vale mais que dez sem: é ali que está o que consertar.</p>
      </div>
    </AdminShell>
  )
}
