import { useCallback, useEffect, useState } from 'react'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatPreco, formatDuracao } from '../../lib/format'

// Serviços (tela 19): a lista do salão, e para cada um o switch de
// "eu faço". Preço e duração aparecem mas não se editam aqui — são do
// salão, e mudar num lugar só é o que evita duas tabelas de preço.
export default function ProServicos() {
  const { professional } = useAuth()
  const [servicos, setServicos] = useState([])
  const [meus, setMeus] = useState(new Set())
  const [mudando, setMudando] = useState('')
  const [erro, setErro] = useState('')
  const profId = professional?.id

  const carregar = useCallback(async () => {
    if (!profId) return
    const [s, v] = await Promise.all([
      supabase.from('services').select('*').eq('active', true).order('name'),
      supabase.from('professional_services').select('service_id').eq('professional_id', profId),
    ])
    setServicos(s.data ?? [])
    setMeus(new Set((v.data ?? []).map((x) => x.service_id)))
  }, [profId])
  useEffect(() => { carregar() }, [carregar])

  if (!professional) return <SemFicha />

  async function alternar(s) {
    setMudando(s.id)
    const faz = meus.has(s.id)
    const { error } = faz
      ? await supabase.from('professional_services').delete().eq('professional_id', profId).eq('service_id', s.id)
      : await supabase.from('professional_services').insert({ professional_id: profId, service_id: s.id })
    if (error) setErro(error.message)
    else setMeus((m) => { const n = new Set(m); if (faz) n.delete(s.id); else n.add(s.id); return n })
    setMudando('')
  }

  return (
    <ProShell>
      <div className="page-head"><div><h2>Meus serviços</h2><p className="muted">{meus.size} de {servicos.length} ativos para você</p></div></div>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="cliente-list">
        {servicos.map((s) => (
          <div key={s.id} className={'card servico-linha' + (meus.has(s.id) ? '' : ' apagado')}>
            <span className="servico-linha-foto" aria-hidden="true">{s.images?.[0] ? <img src={s.images[0]} alt="" /> : '✨'}</span>
            <span className="cliente-info">
              <span className="cliente-nome"><span className="nome-txt">{s.name}</span>{s.is_combo && <span className="badge badge-combo">combo</span>}</span>
              <span className="muted cliente-meta">{formatPreco(s.price)} · {formatDuracao(s.duration_minutes)}</span>
            </span>
            <button className={'switch' + (meus.has(s.id) ? ' on' : '')} role="switch" aria-checked={meus.has(s.id)} disabled={mudando === s.id} onClick={() => alternar(s)} aria-label={s.name} />
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: '0.82rem', marginTop: '1rem' }}>Preço e duração são definidos pelo salão, em Admin → Serviços.</p>
    </ProShell>
  )
}
