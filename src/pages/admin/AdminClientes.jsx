import { useEffect, useMemo, useState } from 'react'
import AdminShell from '../../components/AdminShell'
import { supabase } from '../../lib/supabase'
import { SearchIcon } from '../../components/icons'
import { useAuth } from '../../context/AuthContext'
import { useDialogo } from '../../context/DialogoContext'

// A carteira do salão (053): quem está vinculada, quem trouxe, por qual
// serviço entrou e com quem faz hoje. A carteira é da casa — a
// profissional que sai não leva ninguém, e isto é o que mostra isso.
export default function AdminClientes() {
  const { salao } = useAuth()
  const { confirmar } = useDialogo()
  const [clientes, setClientes] = useState([])
  const [busca, setBusca] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!salao?.id) return
    supabase.rpc('clientes_do_salao', { salao: salao.id }).then(({ data, error: e }) => {
      if (e) setError('Erro ao carregar clientes: ' + e.message)
      else setClientes(data ?? [])
      setLoading(false)
    })
  }, [salao?.id])

  async function desvincular(c) {
    const ok = await confirmar({ titulo: `Desvincular ${c.nome.split(' ')[0]}?`, texto: 'Ela deixa de ver a agenda do salão. O histórico de atendimentos fica.', ok: 'Desvincular', perigo: true })
    if (!ok) return
    const { error: e } = await supabase.rpc('desvincular_cliente', { salao: salao.id, cliente: c.client_id })
    if (e) setError(e.message)
    else setClientes((l) => l.filter((x) => x.client_id !== c.client_id))
  }

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return clientes
    return clientes.filter((c) =>
      (c.nome || '').toLowerCase().includes(q) || (c.trazida_por || '').toLowerCase().includes(q),
    )
  }, [clientes, busca])

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <h2>Clientes</h2>
          <p className="muted">
            {clientes.length}{' '}
            {clientes.length === 1 ? 'cliente na agenda' : 'clientes na agenda'}
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
              : 'Quem entrar pelo QR, pelo link ou agendar aparece aqui.'}
          </p>
        </div>
      ) : (
        <div className="cliente-list">
          {filtradas.map((c) => (
            <div key={c.client_id} className="card cliente-row cliente-row-vinculo">
              <div className="avatar-iniciais">{iniciais(c.nome)}</div>
              <div className="cliente-info">
                <span className="cliente-nome"><span className="nome-txt">{c.nome}</span></span>
                <span className="muted cliente-meta">
                  {c.telefone || 'sem telefone'}
                  {' · '}
                  {c.ultima_visita ? `última visita ${formatData(c.ultima_visita)}` : 'nunca veio'}
                  {c.atendimentos ? ` · ${c.atendimentos} ${c.atendimentos === 1 ? 'atendimento' : 'atendimentos'}` : ''}
                </span>
                <span className="muted cliente-meta cliente-origem">
                  entrou {formatData(String(c.entrou_em).slice(0, 10))}
                  {c.trazida_por ? ` pela ${c.trazida_por.split(' ')[0]}${c.trazida_por_ativa ? '' : ' (ex-equipe)'}` : ' pelo código do salão'}
                  {c.servico_de_entrada ? ` · ${c.servico_de_entrada}` : ''}
                  {c.com_quem ? ` · faz com ${c.com_quem.split(' ')[0]}` : ''}
                </span>
              </div>
              <button className="btn-mini btn-mini-nao" onClick={() => desvincular(c)} aria-label={`Desvincular ${c.nome}`}>Desvincular</button>
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
