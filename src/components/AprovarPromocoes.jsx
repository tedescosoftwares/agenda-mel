import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Check, X, Hourglass } from 'lucide-react'

// A fila da dona (086): promoções que as profissionais do salão pediram.
// Aprova ou recusa com um motivo; a profissional é avisada no app.
export default function AprovarPromocoes({ salao, onMudou }) {
  const [lista, setLista] = useState([])
  const [motivo, setMotivo] = useState({})
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    if (!salao) return
    const { data } = await supabase.from('promocoes')
      .select('id, titulo, texto, imagem_url, inicio, fim, desconto_pct, service_id, created_at, professionals (name), services (name)')
      .eq('salon_id', salao).eq('aprovacao', 'pendente').order('created_at')
    setLista(data ?? [])
  }, [salao])
  useEffect(() => { carregar() }, [carregar])

  async function decidir(p, aprovada) {
    setErro('')
    const { error } = await supabase.from('promocoes').update({ aprovacao: aprovada ? 'aprovada' : 'recusada', motivo_recusa: aprovada ? null : (motivo[p.id]?.trim() || null) }).eq('id', p.id)
    if (error) { setErro(error.message); return }
    carregar()
    onMudou?.()
  }

  if (!lista.length) return null
  return (
    <section className="card aprovar-promos">
      <h3><Hourglass size={16} /> Aguardando sua aprovação <span className="badge">{lista.length}</span></h3>
      <p className="muted">Promoções que as profissionais pediram. Valem só para as clientes de cada uma, e só entram no ar depois do seu OK.</p>
      {erro && <div className="alert alert-error">{erro}</div>}
      <ul className="aprovar-lista">
        {lista.map((p) => (
          <li key={p.id} className="aprovar-item">
            <img src={p.imagem_url} alt="" loading="lazy" />
            <div className="aprovar-corpo">
              <strong>{p.titulo}{p.desconto_pct != null && <span className="badge badge-promo">-{p.desconto_pct}%</span>}</strong>
              <span className="muted">{p.professionals?.name}{p.services?.name ? ` · ${p.services.name}` : ''}{p.desconto_pct != null ? ` com ${p.desconto_pct}% de desconto` : ''}</span>
              {p.texto && <span className="muted">{p.texto}</span>}
              <input value={motivo[p.id] ?? ''} maxLength={200} onChange={(e) => setMotivo({ ...motivo, [p.id]: e.target.value })} placeholder="Motivo, se for recusar (opcional)" />
              <div className="aprovar-acoes">
                <button type="button" className="btn btn-ghost btn-mini perigo" onClick={() => decidir(p, false)}><X size={14} /> Recusar</button>
                <button type="button" className="btn btn-primary btn-mini" onClick={() => decidir(p, true)}><Check size={14} /> Aprovar</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
