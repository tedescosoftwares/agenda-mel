import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PlataformaShell from '../../components/PlataformaShell'
import { supabase } from '../../lib/supabase'
import { VERSAO, ENTREGA } from '../../lib/versao'
import { useDialogo } from '../../context/DialogoContext'

// Visão geral: os números do MIMO inteiro, o relógio, e a ação rara de
// promover alguém a plataforma.
export default function PlataformaVisao() {
  const { avisar } = useDialogo()
  const [r, setR] = useState(null)
  const [relogio, setRelogio] = useState(null)
  const [email, setEmail] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    supabase.rpc('plataforma_resumo').then(({ data, error }) => { if (error) setErro(error.message); setR(data) })
    supabase.rpc('relogio_status').then(({ data }) => setRelogio(data))
  }, [])

  async function promover() {
    if (!email.trim()) return
    const { data, error } = await supabase.rpc('promover_plataforma', { email_: email.trim() })
    if (error) setErro(error.message); else { setEmail(''); await avisar({ titulo: 'Feito', texto: String(data) }) }
  }

  const fila = (relogio?.jobs ?? []).find((j) => j.nome === 'mimo-fila')
  const ultima = fila?.ultima ? new Date(fila.ultima) : null
  const relogioOk = relogio?.ligado && ultima && Date.now() - ultima.getTime() < 5 * 60 * 1000 && fila?.status !== 'failed'

  return (
    <PlataformaShell>
      <div className="page-head"><div><h2>O MIMO inteiro</h2><p className="muted">v{VERSAO} · {ENTREGA}</p></div></div>
      {erro && <div className="alert alert-error">{erro}</div>}
      {!r ? <p className="muted">Carregando…</p> : (
        <>
          <div className="kpis">
            <Kpi n={r.saloes} r="salões" />
            <Kpi n={r.autonomas} r="autônomas" />
            <Kpi n={r.profissionais} r="profissionais" />
            <Kpi n={r.clientes} r="clientes" />
            <Kpi n={r.vinculos} r="vínculos" />
            <Kpi n={r.clientes_sem_vinculo} r="sem vínculo" alerta={r.clientes_sem_vinculo > 0} />
            <Kpi n={r.atendimentos_mes} r="atendimentos no mês" />
            <Kpi n={r.agendados_futuro} r="marcados à frente" />
            <Kpi n={r.novas_contas_7d} r="contas novas · 7 dias" />
          </div>

          <h3 className="secao-titulo">Hoje nas filas</h3>
          <div className="card">
            <div className="dado-linha"><span className="muted">WhatsApp</span><strong>{r.whats_hoje?.enviadas ?? 0} enviadas · {r.whats_hoje?.na_fila ?? 0} na fila · {r.whats_hoje?.falharam ?? 0} falharam</strong></div>
            <div className="dado-linha"><span className="muted">E-mail (total)</span><strong>{r.emails?.enviados ?? 0} enviados · {r.emails?.na_fila ?? 0} na fila · {r.emails?.falharam ?? 0} falharam</strong></div>
            <Link to="/plataforma/filas" className="link-ver" style={{ marginTop: '0.5rem', display: 'inline-block' }}>Ver as filas</Link>
          </div>

          <h3 className="secao-titulo">Relógio (pg_cron)</h3>
          <div className={'card plat-relogio ' + (relogioOk ? 'ok' : 'ruim')}>
            {!relogio ? <span className="muted">sem resposta — a migração 052 rodou?</span>
              : !relogio.ligado ? <span>{relogio.motivo}</span>
              : (relogio.jobs ?? []).map((j) => (
                <div key={j.nome} className="dado-linha">
                  <span className="muted">{j.nome} <small>({j.agenda})</small></span>
                  <strong>{j.ultima ? new Date(j.ultima).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'nunca'}{j.status === 'failed' ? ' · erro' : ''}</strong>
                </div>
              ))}
          </div>

          <h3 className="secao-titulo">Quem cuida da plataforma</h3>
          <div className="card form">
            <label>Promover uma conta a plataforma<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@email.com" /></label>
            <button className="btn btn-ghost" onClick={promover} disabled={!email.trim()}>Promover</button>
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>A pessoa passa a ver tudo isto. Use com quem cuida do MIMO, não com dona de salão.</p>
          </div>
        </>
      )}
    </PlataformaShell>
  )
}

function Kpi({ n, r, alerta }) {
  return <div className={'kpi' + (alerta ? ' kpi-alerta' : '')}><strong>{n ?? 0}</strong><span className="muted">{r}</span></div>
}
