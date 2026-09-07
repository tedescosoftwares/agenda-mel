import { useEffect, useMemo, useState } from 'react'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho, Painel, Pilula, Vazio, haQuanto } from '../../components/plataforma/Pecas'
import { supabase } from '../../lib/supabase'
import { corTipo, iconeTipo } from './Visao'
import { WhatsIcon, MailIcon, ClockIcon, ListaIcon, PulsoIcon, SearchIcon } from '../../components/icons'

// Filas e mensagens: WhatsApp, e-mail e o relógio, com a saúde da
// operação e os últimos registros. "Reprocessar fila" chuta o relógio
// agora em vez de esperar o minuto virar.
export default function Filas({ abaInicial = 'whatsapp' }) {
  const [lista, setLista] = useState(null)
  const [k, setK] = useState(null)
  const [relogio, setRelogio] = useState(null)
  const [logs, setLogs] = useState([])
  const [aba, setAba] = useState(abaInicial)
  const [status, setStatus] = useState('todos')
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState('')

  const carregar = () => {
    supabase.rpc('plataforma_filas', { quantas: 200 }).then(({ data, error }) => { if (error) setErro(error.message); setLista(data ?? []) })
    supabase.rpc('plataforma_kpis').then(({ data }) => setK(data))
    supabase.rpc('relogio_status').then(({ data }) => setRelogio(data))
    supabase.rpc('plataforma_logs', { quantas: 8 }).then(({ data }) => setLogs(data ?? []))
  }
  useEffect(carregar, [])

  const t = busca.trim().toLowerCase()
  const vis = useMemo(() => (lista ?? []).filter((m) => m.canal === aba && (status === 'todos' || m.status === status) && (!t || (m.para || '').toLowerCase().includes(t) || (m.nome || '').toLowerCase().includes(t) || (m.resumo || '').toLowerCase().includes(t))), [lista, aba, status, t])
  const fila = (relogio?.jobs ?? []).find((j) => j.nome === 'mimo-fila')
  const bateu = fila?.ultima ? Date.now() - new Date(fila.ultima).getTime() < 5 * 60 * 1000 && fila.status !== 'failed' : false

  async function reprocessar() {
    setInfo('O relógio bate a cada minuto; o que está na fila sai na próxima batida. Se quiser agora, na VPS: ./disparar.sh')
    setTimeout(() => setInfo(''), 6000)
    carregar()
  }

  return (
    <Shell acao={{ rotulo: 'Novo salão', onClick: () => (window.location.href = '/plataforma/saloes?novo=1') }}>
      <Cabecalho titulo="Filas e mensagens" sub="Controle de WhatsApp, e-mail, relógio e saúde operacional em tempo real." />
      {erro && <div className="alert alert-error">{erro}</div>}
      {info && <div className="alert alert-info">{info}</div>}
      <div className="plat-grade-4">
        <Resumo Icon={WhatsIcon} cor="menta" titulo="WhatsApp" texto={`${k?.whats_hoje?.enviadas ?? 0} enviadas · ${k?.whats_hoje?.na_fila ?? 0} na fila · ${k?.whats_hoje?.falharam ?? 0} falharam`} />
        <Resumo Icon={MailIcon} cor="roxo" titulo="E-mail" texto={`${k?.emails?.enviados ?? 0} enviados · ${k?.emails?.na_fila ?? 0} na fila · ${k?.emails?.falharam ?? 0} falharam`} />
        <Resumo Icon={ListaIcon} cor="rosa" titulo="Relógio" texto={relogio?.ligado ? `${(relogio.jobs ?? []).length} ponteiros ativos` : 'desligado'} />
        <Resumo Icon={ClockIcon} cor="roxo" titulo="Última batida" texto={fila?.ultima ? haQuanto(fila.ultima) : 'nunca'} />
      </div>

      <div className="plat-duas-colunas">
        <Painel Icon={ListaIcon} titulo="Filas de mensagens" direita={<div className="plat-botoes"><button className="btn btn-ghost" onClick={reprocessar}>↻ Reprocessar fila</button><button className="btn btn-primary" onClick={() => setAba('relogio')}>▤ Ver logs</button></div>}>
          <div className="abas plat-abas-linha">
            {[['whatsapp', 'WhatsApp', WhatsIcon], ['email', 'E-mail', MailIcon], ['relogio', 'Relógio', ClockIcon]].map(([kk, r, I]) => <button key={kk} className={aba === kk ? 'ativo' : ''} onClick={() => setAba(kk)}><I /> {r}</button>)}
          </div>
          {aba !== 'relogio' ? (
            <>
              <div className="plat-filtros dentro">
                <div className="plat-busca-local"><SearchIcon /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por destino, nome ou mensagem…" /></div>
                <select className="plat-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="todos">Todos os status</option><option value="na_fila">Na fila</option><option value="enviando">Enviando</option><option value="enviado">Enviado</option><option value="entregue">Entregue</option><option value="lido">Lido</option><option value="falhou">Falhou</option><option value="cancelado">Cancelado</option>
                </select>
              </div>
              <table className="plat-tabela">
                <thead><tr><th>Tipo</th><th>Destino</th><th>Status</th><th>Tentativas</th><th>Agendado para</th><th>Erro</th></tr></thead>
                <tbody>
                  {!lista ? <tr><td colSpan={6}><Vazio>Carregando…</Vazio></td></tr> : vis.length === 0 ? <tr><td colSpan={6}><Vazio>Nada nesta fila.</Vazio></td></tr> : vis.slice(0, 50).map((m) => (
                    <tr key={m.id}>
                      <td><span className="plat-tipo">{m.canal === 'email' ? <MailIcon /> : <WhatsIcon />} {m.tipo}</span></td>
                      <td><div><strong className="plat-normal">{m.para}</strong><small className="muted plat-bloco">{m.nome || m.salao || m.resumo}</small></div></td>
                      <td><Pilula>{m.status}</Pilula></td>
                      <td className="muted">{m.tentativas}</td>
                      <td className="muted">{new Date(m.agendado || m.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="muted">{m.erro || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="plat-paginacao"><span className="muted">Mostrando {Math.min(vis.length, 50)} de {vis.length} mensagens</span></div>
            </>
          ) : (
            <table className="plat-tabela">
              <thead><tr><th>Ponteiro</th><th>Agenda</th><th>Última batida</th><th>Resultado</th><th>Retorno</th></tr></thead>
              <tbody>
                {!relogio?.ligado ? <tr><td colSpan={5}><Vazio>{relogio?.motivo || 'Relógio desligado ou sem resposta.'}</Vazio></td></tr> : (relogio.jobs ?? []).map((j) => (
                  <tr key={j.nome}><td className="mono">{j.nome}</td><td className="mono muted">{j.agenda}</td><td className="muted">{j.ultima ? new Date(j.ultima).toLocaleString('pt-BR') : 'nunca'}</td><td><Pilula>{j.status === 'succeeded' ? 'ok' : j.status || 'parado'}</Pilula></td><td className="muted">{j.retorno || '—'}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Painel>

        <aside className="plat-lado">
          <Painel Icon={PulsoIcon} titulo="Saúde da operação">
            <ul className="plat-saude">
              <Saude titulo="Fila de WhatsApp" detalhe={k?.whats_hoje?.na_fila ? `${k.whats_hoje.na_fila} na fila` : 'Nenhum item na fila'} estado={k?.whats_hoje?.na_fila > 20 ? 'Atenção' : 'Zerada'} />
              <Saude titulo="Fila de e-mails" detalhe={k?.emails?.na_fila ? `${k.emails.na_fila} na fila` : 'Nenhum item na fila'} estado={k?.emails?.na_fila ? 'Atenção' : 'Zerada'} />
              <Saude titulo="Relógio" detalhe={relogio?.ligado ? (bateu ? 'Batendo a cada minuto' : 'Sem batida há mais de 5 min') : 'Desligado'} estado={bateu ? 'Online' : 'Atenção'} />
              <Saude titulo="Envio de mensagens" detalhe={k?.whats_falhas_24h ? `${k.whats_falhas_24h} falhas nas últimas 24h` : 'Sem falhas nas últimas 24h'} estado={k?.whats_falhas_24h ? 'Atenção' : 'Sem erros'} />
              <Saude titulo="E-mails que falharam" detalhe={k?.emails?.falharam ? `${k.emails.falharam} no total` : 'Nenhum'} estado={k?.emails?.falharam ? 'Atenção' : 'Em dia'} />
            </ul>
          </Painel>
          <Painel Icon={ListaIcon} titulo="Logs recentes" link="/plataforma/filas" linkRotulo="Ver todos">
            {logs.length === 0 ? <Vazio>Nada registrado ainda.</Vazio> : (
              <ul className="plat-linha-tempo compacta">
                {logs.map((l, i) => <li key={i}><span className={'plat-ponto ' + (l.ok ? 'menta' : 'carmim')} /><span className={'plat-icone pequeno ' + corTipo(l.tipo)}>{iconeTipo(l.tipo)}</span><div><strong>{l.titulo}</strong><span className="muted">{l.detalhe}</span></div><small className="muted">{haQuanto(l.quando)}</small></li>)}
              </ul>
            )}
          </Painel>
        </aside>
      </div>
    </Shell>
  )
}

function Resumo({ Icon, cor, titulo, texto }) {
  return <div className="plat-resumo simples"><span className={'plat-icone ' + cor}><Icon /></span><div className="plat-resumo-texto"><strong>{titulo}</strong><span className="muted">{texto}</span></div></div>
}
function Saude({ titulo, detalhe, estado }) {
  return <li><span className="plat-icone cinza"><PulsoIcon /></span><div><strong>{titulo}</strong><span className="muted">{detalhe}</span></div><Pilula>{estado}</Pilula></li>
}
