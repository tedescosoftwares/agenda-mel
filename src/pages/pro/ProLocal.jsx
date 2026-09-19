import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import LocalDoSalao from '../../components/LocalDoSalao'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { limparCep, temPino } from '../../lib/geo'

// Onde você atende (100), da autônoma: ela é a dona do próprio "salão de
// uma", então o endereço e o pino são dela. Quem trabalha num salão vê
// que isso é da dona, em Admin › Página do salão.
export default function ProLocal() {
  const { professional } = useAuth()
  const [dona, setDona] = useState(null)   // null = ainda não sei
  const [form, setForm] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState('')
  const salaoId = professional?.salon_id

  useEffect(() => {
    if (!salaoId) { setDona(false); return }
    supabase.rpc('meus_saloes').then(({ data }) => setDona((data ?? []).some((s) => (s.meus_saloes ?? s) === salaoId)))
  }, [salaoId])
  useEffect(() => {
    if (!dona || !salaoId) return
    supabase.from('salons').select('address, city, cep, lat, lng').eq('id', salaoId).maybeSingle().then(({ data }) => {
      setForm({ address: data?.address ?? '', city: data?.city ?? '', cep: data?.cep ?? '', lat: data?.lat ?? null, lng: data?.lng ?? null, pinoMexido: false })
    })
  }, [dona, salaoId])

  if (!professional) return <SemFicha />

  async function salvar(e) {
    e.preventDefault()
    setSalvando(true); setErro(''); setInfo('')
    const pino = temPino(form.lat, form.lng)
    const { error } = await supabase.from('salons').update({
      address: form.address.trim() || null, city: form.city.trim() || null, cep: limparCep(form.cep) || null,
      lat: pino ? form.lat : null, lng: pino ? form.lng : null,
      ...(form.pinoMexido ? { pino_ajustado_em: new Date().toISOString() } : {}),
    }).eq('id', salaoId)
    if (error) setErro(error.message)
    else { setInfo(pino ? 'Salvo. É esse pino que a cliente vê no "Como chegar".' : 'Salvo. Sem pino, a cliente vê só o endereço escrito.'); setForm((f) => ({ ...f, pinoMexido: false })) }
    setSalvando(false)
  }

  return (
    <ProShell titulo="Onde você atende" voltar="/pro/ajustes">
      <div className="page-head">
        <h2>Onde você atende</h2>
        <p className="muted">O endereço e o pino no mapa que a cliente usa para chegar até você.</p>
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}
      {info && <div className="alert alert-info">{info}</div>}
      {dona === null ? <p className="muted">Carregando…</p>
        : !dona ? (
          <div className="card empty-state">
            <p><strong>O endereço é do salão.</strong></p>
            <p className="muted">Você trabalha num salão, então quem define o endereço e o pino no mapa é a dona, em Página do salão. Se quiser, mostre esta tela para ela.</p>
            <Link to="/pro/ajustes" className="btn btn-ghost btn-block">Voltar aos ajustes</Link>
          </div>
        ) : !form ? <p className="muted">Carregando…</p> : (
          <form className="card form" onSubmit={salvar}>
            <LocalDoSalao valor={form} onChange={setForm} />
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </form>
        )}
    </ProShell>
  )
}
