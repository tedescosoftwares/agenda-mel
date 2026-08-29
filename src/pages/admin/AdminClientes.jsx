import { useEffect, useMemo, useState } from 'react'
import AdminShell from '../../components/AdminShell'
import { supabase } from '../../lib/supabase'
import { SearchIcon } from '../../components/icons'
import { toISODate } from '../../lib/format'

export default function AdminClientes() {
  const [clientes, setClientes] = useState([])
  const [ultimaVisita, setUltimaVisita] = useState({})
  const [busca, setBusca] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchDados() {
      const { data: perfis, error: e1 } = await supabase
        .from('profiles')
        .select('id, full_name, phone, created_at')
        .eq('role', 'cliente')
        .order('full_name')

      if (e1) {
        setError('Erro ao carregar clientes: ' + e1.message)
        setLoading(false)
        return
      }

      const hoje = toISODate(new Date())
      const { data: visitas } = await supabase
        .from('appointments')
        .select('client_id, date')
        .lte('date', hoje)
        .in('status', ['confirmado', 'concluido'])
        .order('date', { ascending: false })

      const mapa = {}
      for (const v of visitas ?? []) {
        if (!mapa[v.client_id]) mapa[v.client_id] = v.date
      }

      setClientes(perfis)
      setUltimaVisita(mapa)
      setLoading(false)
    }
    fetchDados()
  }, [])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return clientes
    return clientes.filter((c) =>
      (c.full_name || '').toLowerCase().includes(q),
    )
  }, [clientes, busca])

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <h2>Clientes</h2>
          <p className="muted">
            {clientes.length}{' '}
            {clientes.length === 1 ? 'cliente cadastrada' : 'clientes cadastradas'}
          </p>
        </div>
      </div>

      <div className="search-box">
        <SearchIcon />
        <input
          type="search"
          placeholder="Buscar cliente…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : filtradas.length === 0 ? (
        <div className="card empty-state">
          <p>{busca ? 'Nenhuma cliente encontrada.' : 'Nenhuma cliente ainda.'}</p>
          <p className="muted">
            {busca
              ? 'Tente outro nome.'
              : 'Quem criar conta pelo app aparece aqui.'}
          </p>
        </div>
      ) : (
        <div className="cliente-list">
          {filtradas.map((c) => (
            <div key={c.id} className="card cliente-row">
              <div className="avatar-iniciais">{iniciais(c.full_name)}</div>
              <div className="cliente-info">
                <span className="cliente-nome">{c.full_name || 'Sem nome'}</span>
                <span className="muted cliente-meta">
                  {c.phone || 'sem telefone'}
                  {' · '}
                  {ultimaVisita[c.id]
                    ? `última visita ${formatData(ultimaVisita[c.id])}`
                    : 'nunca agendou'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  )
}

function iniciais(nome) {
  if (!nome) return '?'
  const partes = nome.trim().split(/\s+/)
  const primeira = partes[0]?.charAt(0) ?? ''
  const ultima = partes.length > 1 ? partes[partes.length - 1].charAt(0) : ''
  return (primeira + ultima).toUpperCase()
}

function formatData(iso) {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}
