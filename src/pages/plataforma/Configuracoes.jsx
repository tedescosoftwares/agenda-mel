import { useEffect, useState } from 'react'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho, Painel, Pilula, Vazio } from '../../components/plataforma/Pecas'
import { supabase } from '../../lib/supabase'
import { useDialogo } from '../../context/DialogoContext'
import { VERSAO, ENTREGA } from '../../lib/versao'
import { EngrenagemIcon, ClockIcon, UsersIcon } from '../../components/icons'

// Configurações da plataforma: o relógio, a versão, e quem mais cuida.
export default function Configuracoes() {
  const { avisar } = useDialogo()
  const [relogio, setRelogio] = useState(null)
  const [email, setEmail] = useState('')
  const [erro, setErro] = useState('')
  useEffect(() => { supabase.rpc('relogio_status').then(({ data }) => setRelogio(data)) }, [])

  async function promover() {
    if (!email.trim()) return
    const { data, error } = await supabase.rpc('promover_plataforma', { email_: email.trim() })
    if (error) setErro(error.message); else { setEmail(''); await avisar({ titulo: 'Feito', texto: String(data) }) }
  }

  return (
    <Shell>
      <Cabecalho titulo="Configurações" sub="O que mantém o MIMO rodando, e quem tem a chave." direita={<span />} />
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="plat-grade-3">
        <Painel Icon={ClockIcon} titulo="Relógio (pg_cron)" sub="Os ponteiros que empurram filas, prazos e lembretes.">
          {!relogio ? <Vazio>Sem resposta — a migração 052 rodou?</Vazio> : !relogio.ligado ? <Vazio>{relogio.motivo}</Vazio> : (relogio.jobs ?? []).map((j) => (
            <div key={j.nome} className="dado-linha"><span className="muted mono">{j.nome} <small>({j.agenda})</small></span><span><Pilula>{j.status === 'succeeded' ? 'ok' : j.status || 'parado'}</Pilula> <small className="muted">{j.ultima ? new Date(j.ultima).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'nunca'}</small></span></div>
          ))}
          <p className="muted plat-nota">Liga e desliga pelo SQL Editor: <code>select public.ligar_relogio(url, chave)</code> / <code>select public.desligar_relogio()</code>.</p>
        </Painel>
        <Painel Icon={UsersIcon} titulo="Quem cuida da plataforma" sub="Promover uma conta a plataforma dá acesso a tudo isto.">
          <div className="form">
            <label>E-mail da conta<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@email.com" /></label>
            <button className="btn btn-primary" onClick={promover} disabled={!email.trim()}>Promover a plataforma</button>
          </div>
          <p className="muted plat-nota">Use com quem cuida do MIMO, não com dona de salão. Tirar o papel é pelo SQL Editor.</p>
        </Painel>
        <Painel Icon={EngrenagemIcon} titulo="Versão">
          <div className="dado-linha"><span className="muted">App</span><strong>v{VERSAO}</strong></div>
          <div className="dado-linha"><span className="muted">Entrega</span><strong className="plat-normal">{ENTREGA}</strong></div>
          <div className="dado-linha"><span className="muted">Site</span><strong>{window.location.host}</strong></div>
          <p className="muted plat-nota">Publicar: opção 2 do Conectar_MIMO_VPS.bat. Banco: atualizacao_040_em_diante.sql no SQL Editor.</p>
        </Painel>
      </div>
    </Shell>
  )
}
