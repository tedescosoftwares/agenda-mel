import { useEffect, useState } from 'react'
import PlataformaShell from '../../components/PlataformaShell'
import { supabase } from '../../lib/supabase'
import { SearchIcon } from '../../components/icons'

const PAPEL = { cliente: 'cliente', profissional: 'profissional', admin: 'dona de salão', plataforma: 'plataforma' }

// Todo mundo que tem conta, com papel, salão e uso. A busca vai ao
// banco (nome, e-mail ou telefone) para não trazer a base inteira.
export default function PlataformaPessoas() {
  const [lista, setLista] = useState(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    const t = setTimeout(() => {
      supabase.rpc('plataforma_pessoas', { busca: busca.trim() || null, quantas: 100 })
        .then(({ data, error }) => { if (error) setErro(error.message); setLista(data ?? []) })
    }, 250)
    return () => clearTimeout(t)
  }, [busca])

  return (
    <PlataformaShell>
      <div className="page-head"><div><h2>Pessoas</h2><p className="muted">{lista ? `${lista.length} ${busca ? 'encontradas' : 'mais recentes'}` : ''}</p></div></div>
      <div className="search-box"><SearchIcon /><input type="search" placeholder="Nome, e-mail ou telefone…" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
      {erro && <div className="alert alert-error">{erro}</div>}
      {!lista ? <p className="muted">Carregando…</p> : (
        <div className="cliente-list">
          {lista.map((p) => (
            <div key={p.id} className="card cliente-row cliente-row-vinculo">
              <div className="cliente-info">
                <span className="cliente-nome"><span className="nome-txt">{p.nome || 'Sem nome'}</span><span className={'badge plat-papel ' + p.papel}>{PAPEL[p.papel] ?? p.papel}</span></span>
                <span className="muted cliente-meta">{p.email}{p.telefone ? ` · ${p.telefone}` : ''}</span>
                <span className="muted cliente-meta">
                  {p.saloes ? `${p.saloes} · ` : ''}
                  {p.papel === 'cliente' ? `${p.vinculos} ${p.vinculos === 1 ? 'agenda' : 'agendas'} · ${p.atendimentos} atendimentos · ` : ''}
                  desde {new Date(p.desde + 'T12:00').toLocaleDateString('pt-BR')}
                  {p.ultimo_acesso ? ` · último acesso ${new Date(p.ultimo_acesso).toLocaleDateString('pt-BR')}` : ' · nunca entrou'}
                </span>
              </div>
            </div>
          ))}
          {lista.length === 0 && <div className="card empty-state"><p>Ninguém com esse nome.</p></div>}
        </div>
      )}
    </PlataformaShell>
  )
}
