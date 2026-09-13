import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { SearchIcon, HeartIcon } from '../../components/icons'
import Avatar from '../../components/Avatar'
import { useCategorias } from '../../lib/categorias'

// Lista de profissionais (tela 04): busca, filtro por categoria e o
// coração de favorita. Os chips são as categorias (082) em que alguém
// do salão atende; 300 serviços em chips não cabiam em lugar nenhum.
export default function ClienteProfissionais() {
  const { user } = useAuth()
  const [profissionais, setProfissionais] = useState([])
  const [vinculos, setVinculos] = useState([])
  const [favoritas, setFavoritas] = useState(new Set())
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('')
  const [loading, setLoading] = useState(true)
  const cats = useCategorias()

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [pr, vi, fav] = await Promise.all([
        supabase.from('professionals').select('*').eq('active', true).order('name'),
        supabase.from('professional_services').select('professional_id, service_id, services (id, name, active, categoria_id)'),
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

  // as categorias em que alguém atende ('' = sem categoria)
  const categorias = useMemo(() => {
    const usadas = new Set(vinculos.filter((v) => v.services?.active).map((v) => v.services.categoria_id || ''))
    const lista = cats.filter((c) => usadas.has(c.id)).map((c) => [c.id, c.nome, c.ordem])
    if (usadas.has('')) lista.push(['', 'Outros', 999])
    return lista.sort((a, b) => a[2] - b[2] || a[1].localeCompare(b[1]))
  }, [vinculos, cats])

  const faz = (p) => vinculos.filter((v) => v.professional_id === p.id)
  const t = busca.trim().toLowerCase()
  const lista = profissionais.filter((p) => {
    if (filtro && !faz(p).some((v) => v.services?.active && (v.services.categoria_id || '') === (filtro === 'outros' ? '' : filtro))) return false
    if (!t) return true
    return p.name.toLowerCase().includes(t) || faz(p).some((v) => v.services?.name.toLowerCase().includes(t))
  })

  async function alternarFavorita(p) {
    const era = favoritas.has(p.id)
    setFavoritas((s) => { const n = new Set(s); if (era) n.delete(p.id); else n.add(p.id); return n })
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
        {categorias.map(([id, nome]) => (
          <button key={id || 'outros'} className={filtro === (id || 'outros') ? 'chip active' : 'chip'} onClick={() => setFiltro(id || 'outros')}>{nome}</button>
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
