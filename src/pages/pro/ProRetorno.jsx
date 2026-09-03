import { useCallback, useEffect, useState } from 'react'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Avatar from '../../components/Avatar'

// Clientes sumidas (tela 21): quem não volta há mais tempo que o
// combinado, com o último serviço, e um botão para chamar de volta.
export default function ProRetorno() {
  const { professional } = useAuth()
  const [lista, setLista] = useState([])
  const [cfg, setCfg] = useState(null)
  const [enviando, setEnviando] = useState('')
  const [info, setInfo] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(true)
  const profId = professional?.id

  const carregar = useCallback(async () => {
    if (!profId) return
    const [l, c] = await Promise.all([supabase.rpc('clientes_para_retorno', { prof: profId }), supabase.rpc('config_retorno', { prof: profId })])
    setLista(l.data ?? [])
    setCfg(c.data?.[0] ?? null)
    setLoading(false)
  }, [profId])
  useEffect(() => { carregar() }, [carregar])

  if (!professional) return <SemFicha />

  async function chamar(c) {
    setEnviando(c.client_id)
    const { error } = await supabase.rpc('chamar_de_volta', { cliente: c.client_id, prof: profId, recado: null })
    if (error) setErro(error.message); else { setInfo(`Recado enviado para ${c.nome.split(' ')[0]}.`); carregar() }
    setEnviando('')
  }
  async function chamarTodas() {
    if (!window.confirm(`Chamar as ${lista.filter((c) => !c.ja_chamada).length} de uma vez?`)) return
    const { data, error } = await supabase.rpc('chamar_todas_de_volta', { prof: profId })
    if (error) setErro(error.message); else { setInfo(`${data ?? 0} recado(s) enviado(s).`); carregar() }
  }

  return (
    <ProShell>
      <div className="page-head"><div><h2>Clientes sumidas</h2><p className="muted">{cfg ? `Sem vir há mais de ${cfg.winback_after_days} dias` : ''}</p></div></div>
      {erro && <div className="alert alert-error">{erro}</div>}
      {info && <div className="alert alert-info">{info}</div>}
      {loading ? <p className="muted">Carregando…</p> : lista.length === 0 ? (
        <div className="card empty-state"><p>Ninguém sumida. 💛</p></div>
      ) : (
        <>
          <div className="cliente-list">
            {lista.map((c) => (
              <div key={c.client_id} className="card prof-row prof-row-fav">
                <span className="prof-row-link">
                  <Avatar nome={c.nome} />
                  <span className="cliente-info">
                    <span className="cliente-nome"><span className="nome-txt">{c.nome}</span></span>
                    <span className="muted cliente-meta">Último: {c.ultimo_servico} · há {c.dias_sem_vir} dias</span>
                  </span>
                </span>
                {c.ja_chamada ? <span className="muted" style={{ fontSize: '0.78rem' }}>chamada ✓</span> : (
                  <button className="btn-mini btn-mini-rosa" disabled={enviando === c.client_id} onClick={() => chamar(c)}>Enviar</button>
                )}
              </div>
            ))}
          </div>
          {lista.some((c) => !c.ja_chamada) && <button className="btn btn-ghost btn-block" style={{ marginTop: '1rem' }} onClick={chamarTodas}>Chamar todas de volta</button>}
        </>
      )}
    </ProShell>
  )
}
