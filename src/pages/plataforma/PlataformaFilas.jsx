import { useEffect, useState } from 'react'
import PlataformaShell from '../../components/PlataformaShell'
import { supabase } from '../../lib/supabase'

const COR = { na_fila: 'pendente', enviando: 'pendente', enviado: 'confirmado', entregue: 'confirmado', lido: 'confirmado', falhou: 'faltou', cancelado: 'cancelado' }

// As duas filas do sistema inteiro, misturadas por hora: WhatsApp e
// e-mail. É onde se vê se alguma coisa está presa antes de alguém
// reclamar.
export default function PlataformaFilas() {
  const [lista, setLista] = useState(null)
  const [filtro, setFiltro] = useState('tudo')
  const [erro, setErro] = useState('')

  useEffect(() => {
    supabase.rpc('plataforma_filas', { quantas: 80 }).then(({ data, error }) => { if (error) setErro(error.message); setLista(data ?? []) })
  }, [])

  const vis = (lista ?? []).filter((m) => filtro === 'tudo' || (filtro === 'presas' ? ['na_fila', 'enviando', 'falhou'].includes(m.status) : m.canal === filtro))

  return (
    <PlataformaShell>
      <div className="page-head"><div><h2>Filas</h2><p className="muted">WhatsApp e e-mail, do sistema inteiro</p></div></div>
      <div className="filtro-chips">
        {[['tudo', 'Tudo'], ['presas', 'Presas'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail']].map(([k, r]) => (
          <button key={k} className={filtro === k ? 'chip active' : 'chip'} onClick={() => setFiltro(k)}>{r}</button>
        ))}
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}
      {!lista ? <p className="muted">Carregando…</p> : (
        <div className="cliente-list">
          {vis.map((m) => (
            <div key={m.id} className={'card agd-card ' + (COR[m.status] ?? '')}>
              <div className="agd-topo">
                <span className="agd-quando">{m.canal === 'email' ? '✉️' : '💬'} {new Date(m.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                <span className={`badge badge-${COR[m.status] ?? 'pendente'}`}>{m.status}</span>
              </div>
              <strong className="agd-servico" style={{ fontSize: '0.95rem' }}>{m.resumo}</strong>
              <span className="muted agd-meta">{m.tipo} · para {m.para}{m.salao ? ` · ${m.salao}` : ''}</span>
              {m.erro && <span className="agd-troca">{m.erro}</span>}
            </div>
          ))}
          {vis.length === 0 && <div className="card empty-state"><p>Nada por aqui.</p></div>}
        </div>
      )}
    </PlataformaShell>
  )
}
