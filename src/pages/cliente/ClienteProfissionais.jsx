import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { SearchIcon, HeartIcon } from '../../components/icons'
import Avatar from '../../components/Avatar'

// Lista de profissionais (tela 04): busca, filtro por serviço e o
// coração de favorita. Os chips são os serviços que o salão oferece —
// não existe "categoria" no banco, e inventar uma tabela para isso seria
// pedir para alguém preencher o que os próprios serviços já dizem.
export default function ClienteProfissionais() {
  const { user } = useAuth()
  const [profissionais, setProfissionais] = useState([])
  const [vinculos, setVinculos] = useState([])
  const [favoritas, setFavoritas] = useState(new Set())
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [pr, vi, fav] = await Promise.all([
        supabase.from('professionals').select('*').eq('active', true).order('name'),
        supabase.from('professional_services').select('professional_id, service_id, services (id, name, active)'),
        supabase.from('client_favorites').select('professional_id').eq('client_id', user.id),
      ])
      if (!vivo) return
      setProfissionais(pr.data ?? [])
      setVinculos(vi.data ?? [])
      setFavoritas(new Set((fav.data ?? []).map((f) => f.professional_id)))
      setLoading(false)
    })()
    return () => { vivo = false }
  }, [user.id])

  const servicos = useMemo(() => {
    const m = new Map()
    for (const v of vinculos) if (v.services?.active) m.set(v.service_id, v.services.name)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [vinculos])

  const faz = (p) => vinculos.filter((v) => v.professional_id === p.id)
  const t = busca.trim().toLowerCase()
  const lista = profissionais.filter((p) => {
    if (filtro && !faz(p).some((v) => v.service_id === filtro)) return false
    if (!t) return true
    return p.name.toLowerCase().includes(t) || faz(p).some((v) => v.services?.name.toLowerCase().includes(t))
  })

  async function alternarFavorita(p) {
    const era = favoritas.has(p.id)
    setFavoritas((s) => { const n = new Set(s); era ? n.delete(p.id) : n.add(p.id); return n })
    if (era) {
      await supabase.from('client_favorites').delete().eq('client_id', user.id).eq('professional_id', p.id)
    } else {
      await supabase.from('client_favorites').insert({ client_id: user.id, professional_id: p.id })
    }
  }

  return (
    <ClienteShell titulo="Profissionais" voltar="/cliente/home">
      <label className="cl-busca">
        <SearchIcon />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar profissional" aria-label="Buscar" />
      </label>

      <div className="filtro-chips rolavel">
        <button className={filtro === '' ? 'chip active' : 'chip'} onClick={() => setFiltro('')}>Todos</button>
        {servicos.map(([id, nome]) => (
          <button key={id} className={filtro === id ? 'chip active' : 'chip'} onClick={() => setFiltro(id)}>{nome}</button>
        ))}
      </div>

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : lista.length === 0 ? (
        <div className="card empty-state"><p>Ninguém por aqui com esse filtro.</p></div>
      ) : (
        <div className="cliente-list">
          {lista.map((p) => (
            <div key={p.id} className="card prof-row prof-row-fav">
              <Link to={`/cliente/profissional/${p.id}`} className="prof-row-link">
                <Avatar nome={p.name} foto={p.photo_url} />
                <span className="cliente-info">
                  <span className="cliente-nome"><span className="nome-txt">{p.name}</span></span>
                  <span className="muted cliente-meta">
                    {faz(p).map((v) => v.services?.name).filter(Boolean).slice(0, 2).join(' · ') || p.bio}
                  </span>
                </span>
              </Link>
              <button
                className={'fav-btn' + (favoritas.has(p.id) ? ' on' : '')}
                onClick={() => alternarFavorita(p)}
                aria-label={favoritas.has(p.id) ? 'Tirar das favoritas' : 'Favoritar'}
                aria-pressed={favoritas.has(p.id)}
              >
                <HeartIcon cheio={favoritas.has(p.id)} />
              </button>
            </div>
          ))}
        </div>
      )}
    </ClienteShell>
  )
}
