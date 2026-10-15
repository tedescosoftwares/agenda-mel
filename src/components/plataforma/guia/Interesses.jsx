import { useEffect, useMemo, useState } from 'react'
import { useDialogo } from '../../../context/DialogoContext'
import { supabase } from '../../../lib/supabase'
import { Painel, Pilula, Vazio, haQuanto } from '../Pecas'
import { rotaDoLugar, linkWhatsDoTel, soDigitosTel, ehCelular } from '../../../lib/guia'
import { urlDoAmbiente } from '../../../lib/ambiente'
import { Inbox, Trophy, MessageCircle, ExternalLink, Check, Undo2, Ban, BadgeCheck, Mail, MailCheck, MailWarning, Clock, Images, Link2 } from 'lucide-react'
import '../../../guia-dono.css'

// Quem tocou nos botões das páginas: "Quero marcar aqui pelo app" (gente
// querendo a agenda do salão: é a lista de venda), "Corrigir" e "Remover".
// Pedido de remoção tem atalho para tirar a página do ar de vez (status
// removido: a importação nunca traz de volta).
//
// "É o seu salão?" virou reivindicação (3.12, migração 159) e tem a lista
// dela no alto: quem disse que responde pelo salão, com e-mail, WhatsApp,
// a ligação (dona, sócia, gerente, funcionária), se a confirmação por
// e-mail saiu e o status que a equipe muda (nova, em contato, confirmada,
// recusada). "Nova" é o que entra no número "interesses novos" do topo.

const TIPO = { quero_marcar: 'Quero marcar', sou_dono: 'Reivindicação', corrigir: 'Corrigir', remover: 'Remover' }
const TOM = { quero_marcar: 'rosa', sou_dono: 'roxo', corrigir: 'ambar', remover: 'carmim' }

// a reivindicação
const STATUS = [['nova', 'Nova', 'rosa'], ['em_contato', 'Em contato', 'ambar'], ['confirmada', 'Confirmada', 'menta'], ['recusada', 'Recusada', 'cinza']]
const ROTULO_STATUS = Object.fromEntries(STATUS.map(([k, r]) => [k, r]))
const TOM_STATUS = Object.fromEntries(STATUS.map(([k, , t]) => [k, t]))
const LIGACAO = { dona: 'Dona', socia: 'Sócia', gerente: 'Gerente', funcionaria: 'Funcionária' }
const FILTROS = [['abertas', 'Abertas'], ['nova', 'Novas'], ['em_contato', 'Em contato'], ['confirmada', 'Confirmadas'], ['recusada', 'Recusadas'], ['', 'Todas']]
// pedido antigo (antes da 159) não tem status: aberto é nova, atendido é em contato
const n0 = (v) => Number(v) || 0
const statusDe = (i) => i.status || (i.atendido_em ? 'em_contato' : 'nova')
const aberta = (i) => ['nova', 'em_contato'].includes(statusDe(i))

// como está o e-mail de confirmação (email_outbox, pela RPC guia_confirmacoes)
function Confirmacao({ i, c }) {
  if (!i.email) return <span className="muted">sem e-mail (pedido antigo)</span>
  if (!c) return <span className="muted">{i.email_id ? '—' : 'não saiu'}</span>
  if (c.status === 'enviado') return <span className="pg-reiv-conf" title={c.enviado_em ? new Date(c.enviado_em).toLocaleString('pt-BR') : undefined}><MailCheck size={14} /> enviada{c.enviado_em ? ` ${haQuanto(c.enviado_em)}` : ''}</span>
  if (c.status === 'falhou') return <span className="pg-reiv-conf falhou"><MailWarning size={14} /><span>não chegou{c.erro && <small>{c.erro}</small>}</span></span>
  if (c.status === 'cancelado') return <span className="pg-reiv-conf">cancelada</span>
  return <span className="pg-reiv-conf"><Clock size={14} /> na fila</span>
}

function mensagemPara(i, l) {
  const salao = l?.nome ?? 'o salão'
  if (i.tipo === 'sou_dono') return `Oi${i.nome ? `, ${i.nome.split(' ')[0]}` : ''}! Aqui é da MIMO, sobre o seu pedido para ser o contato da página do ${salao} no nosso guia de salões. Podemos confirmar alguns dados com você?`
  if (i.tipo === 'quero_marcar') return `Oi${i.nome ? `, ${i.nome}` : ''}! Aqui é da MIMO, sobre o seu pedido para marcar no ${salao} pelo app.`
  return `Oi${i.nome ? `, ${i.nome}` : ''}! Aqui é da MIMO, sobre a página do ${salao} no nosso guia de salões.`
}
const ehTelefone = (c) => !!c && !String(c).includes('@') && soDigitosTel(c).length >= 10

export default function Interesses({ g }) {
  const { confirmar } = useDialogo()
  const [soAbertos, setSoAbertos] = useState(true)
  const [tipo, setTipo] = useState('')
  const [filtroReiv, setFiltroReiv] = useState('abertas')
  const [confirmacoes, setConfirmacoes] = useState({})
  const [mudando, setMudando] = useState(null)
  const porId = useMemo(() => new Map(g.lugares.map((l) => [l.id, l])), [g.lugares])

  // ---- as reivindicações ----
  const reivs = useMemo(() => g.interesses.filter((i) => i.tipo === 'sou_dono').sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em))), [g.interesses])
  const contaReiv = useMemo(() => {
    const c = { abertas: 0, '': reivs.length }
    for (const i of reivs) { const s = statusDe(i); c[s] = (c[s] ?? 0) + 1; if (aberta(i)) c.abertas++ }
    return c
  }, [reivs])
  const listaReiv = useMemo(() => reivs.filter((i) => (filtroReiv === 'abertas' ? aberta(i) : !filtroReiv || statusDe(i) === filtroReiv)), [reivs, filtroReiv])
  // se a confirmação saiu: lê quando a lista muda (sem a 159 a RPC não existe e fica vazio)
  const comEmail = useMemo(() => reivs.filter((i) => i.email_id).map((i) => i.id).join(','), [reivs])
  useEffect(() => {
    if (!comEmail) return
    let vivo = true
    supabase.rpc('guia_confirmacoes').then(({ data, error }) => { if (vivo && !error && data && typeof data === 'object') setConfirmacoes(data) }, () => {})
    return () => { vivo = false }
  }, [comEmail])

  async function mudarStatus(i, novo) {
    if (statusDe(i) === novo || mudando) return
    setMudando(i.id)
    // "nova" = ninguém pegou (conta em "interesses novos"); o resto marca quem pegou. O banco confere o mesmo (gatilho da 159).
    const campos = novo === 'nova'
      ? { status: novo, atendido_em: null, atendido_por: null }
      : { status: novo, atendido_em: i.atendido_em ?? new Date().toISOString(), atendido_por: i.atendido_por ?? g.usuario }
    const r = await g.salvarInteresse(i.id, campos)
    setMudando(null)
    if (!r.ok) { g.avisar({ texto: /status|column/i.test(r.erro ?? '') ? 'Rode a migração 159 (supabase/159_guia_reivindicar.sql) para mudar o status.' : r.erro, tom: 'erro' }); return }
    g.avisar(`${porId.get(i.lugar_id)?.nome ?? 'Reivindicação'}: ${ROTULO_STATUS[novo].toLowerCase()}.`)
  }

  // o ranking de venda: quem mais tem gente querendo marcar pela MIMO
  const ranking = useMemo(() => {
    const m = new Map()
    for (const i of g.interesses) {
      if (i.tipo !== 'quero_marcar') continue
      const r = m.get(i.lugar_id) ?? { lugar_id: i.lugar_id, total: 0, novos: 0, ultimo: null }
      r.total++
      if (!i.atendido_em) r.novos++
      if (!r.ultimo || i.criado_em > r.ultimo) r.ultimo = i.criado_em
      m.set(i.lugar_id, r)
    }
    return [...m.values()].sort((a, b) => b.total - a.total || String(b.ultimo).localeCompare(String(a.ultimo))).slice(0, 8)
  }, [g.interesses])

  // os pedidos de baixo: sem a reivindicação, que tem a lista dela
  const contagem = useMemo(() => {
    const c = { '': 0, quero_marcar: 0, corrigir: 0, remover: 0 }
    for (const i of g.interesses) if (i.tipo !== 'sou_dono' && (!soAbertos || !i.atendido_em)) { c['']++; c[i.tipo] = (c[i.tipo] ?? 0) + 1 }
    return c
  }, [g.interesses, soAbertos])
  const lista = useMemo(() => g.interesses
    .filter((i) => i.tipo !== 'sou_dono' && (!soAbertos || !i.atendido_em) && (!tipo || i.tipo === tipo))
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em))), [g.interesses, soAbertos, tipo])

  async function atender(i, sim) {
    const r = await g.salvarInteresse(i.id, { atendido_em: sim ? new Date().toISOString() : null, atendido_por: sim ? g.usuario : null })
    if (!r.ok) g.avisar({ texto: r.erro, tom: 'erro' })
  }
  async function remover(i, l) {
    const ok = await confirmar({ titulo: `Remover a página de ${l.nome}?`, texto: 'Sai do ar na hora e a importação nunca traz de volta. Use quando o responsável pedir.', ok: 'Remover a página', cancelar: 'Voltar', perigo: true })
    if (!ok) return
    const r = await g.salvarLugar(l.id, { status: 'removido', motivo: 'pedido do dono' })
    if (!r.ok) { g.avisar({ texto: r.erro, tom: 'erro' }); return }
    await atender(i, true)
    g.avisar(`${l.nome}: página removida.`)
  }

  // o link do dono mandar as fotos (165): copia; se venceu, renova
  async function copiarLinkFotos(i) {
    const { data, error } = await supabase.rpc('guia_link_fotos', { interesse_: i.id, renovar_: false })
    if (error) { g.avisar({ texto: /guia_link_fotos|schema cache|does not exist/i.test(error.message) ? 'Rode a migração 165 (supabase/165_fotos_do_dono.sql) para o link das fotos.' : error.message, tom: 'erro' }); return }
    if (!data?.ok) { g.avisar({ texto: data?.motivo || 'não deu para gerar o link', tom: 'erro' }); return }
    try { await navigator.clipboard.writeText(data.url) } catch { /* sem clipboard: mostra */ }
    g.avisar({ texto: `Link das fotos copiado (vale até ${data.expira ? new Date(data.expira).toLocaleDateString('pt-BR') : '30 dias'}). Mande pelo WhatsApp: ${data.url}` })
  }

  if (g.carregando) return <Painel Icon={Inbox} titulo="Interesses"><Vazio>Carregando…</Vazio></Painel>

  return (
    <div className="pg-interesses">
      <Painel Icon={BadgeCheck} titulo="Reivindicações" sub="Quem disse que responde por um salão do guia. A pessoa já recebeu a confirmação por e-mail, que promete contato em até 3 dias úteis.">
        {reivs.length === 0 ? <Vazio>Nenhuma reivindicação ainda. Elas chegam pelo “É o seu salão?” das páginas.</Vazio> : (
          <>
            <div className="pg-chips" role="group" aria-label="Filtrar reivindicações">
              {FILTROS.map(([id, r]) => <button key={id} type="button" className={'plat-chip' + (filtroReiv === id ? ' ativo' : '')} aria-pressed={filtroReiv === id} onClick={() => setFiltroReiv(id)}>{r} · {contaReiv[id] ?? 0}</button>)}
            </div>
            {listaReiv.length === 0 ? <Vazio>{filtroReiv === 'abertas' ? 'Nenhuma reivindicação aberta. Tudo respondido.' : 'Nenhuma reivindicação aqui.'}</Vazio> : (
              <ul className="pg-reiv-lista">
                {listaReiv.map((i) => {
                  const l = porId.get(i.lugar_id)
                  const s = statusDe(i)
                  const zap = ehTelefone(i.contato) ? linkWhatsDoTel(i.contato, mensagemPara(i, l)) : null
                  const correio = i.email ? `mailto:${i.email}?subject=${encodeURIComponent(`Sua página no guia da MIMO: ${l?.nome ?? 'o salão'}`)}` : null
                  return (
                    <li key={i.id} className={'pg-reiv' + (s === 'nova' ? ' pg-reiv-nova' : '')}>
                      <div className="pg-reiv-topo">
                        <Pilula tom={TOM_STATUS[s]}>{ROTULO_STATUS[s]}</Pilula>
                        <b>{l?.nome ?? 'salão fora da lista'}</b>
                        {l && (l.status === 'publicado'
                          ? <a className="plat-link pg-link-peq" href={urlDoAmbiente('cliente', rotaDoLugar(l.cidade_slug, l.slug))} target="_blank" rel="noopener noreferrer">página <ExternalLink size={11} /></a>
                          : <small>{l.status === 'removido' ? 'removido' : 'fora do ar'}</small>)}
                        <small className="pg-reiv-quando" title={new Date(i.criado_em).toLocaleString('pt-BR')}>{haQuanto(i.criado_em)}</small>
                      </div>
                      <dl className="pg-reiv-dados">
                        <div>
                          <dt>Quem</dt>
                          <dd>{i.nome || <span className="muted">sem nome</span>}{i.ligacao && <Pilula tom="roxo">{LIGACAO[i.ligacao] ?? i.ligacao}</Pilula>}</dd>
                          {i.aceite_em && <dd className="pg-reiv-aceite" title={new Date(i.aceite_em).toLocaleString('pt-BR')}><Check size={12} /><span>declarou que responde pelo salão</span></dd>}
                        </div>
                        <div><dt>E-mail</dt><dd>{correio ? <a href={correio}>{i.email}</a> : <span className="muted">—</span>}</dd></div>
                        <div><dt>WhatsApp</dt><dd>{i.contato || <span className="muted">—</span>}{zap && <a className="pg-zap" href={zap} target="_blank" rel="noopener noreferrer" aria-label={`Chamar ${i.nome || 'no WhatsApp'}`} title="Chamar no WhatsApp"><MessageCircle size={13} /></a>}</dd></div>
                        <div><dt>Confirmação</dt><dd><Confirmacao i={i} c={confirmacoes[i.id]} /></dd></div>
                      </dl>
                      {i.mensagem && <p className="pg-reiv-msg">{i.mensagem}</p>}
                      <div className="pg-reiv-pe">
                        <div className="pg-reiv-status" role="group" aria-label={`Status da reivindicação de ${l?.nome ?? 'salão'}`}>
                          {STATUS.map(([k, r]) => (
                            <button key={k} type="button" className={k} aria-pressed={s === k} disabled={mudando === i.id} onClick={() => mudarStatus(i, k)}>{r}</button>
                          ))}
                        </div>
                        <span className="pg-reiv-links">
                          {correio && <a className="plat-link" href={correio}><Mail size={13} /> Escrever</a>}
                          {zap && <a className="plat-link" href={zap} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} /> WhatsApp</a>}
                          {s === 'confirmada' && <button type="button" className="plat-link" onClick={() => copiarLinkFotos(i)} title="O link que a pessoa recebeu por e-mail para mandar as fotos do salão (vale 30 dias)"><Link2 size={13} /> Link das fotos</button>}
                          {n0(i.fotos_enviadas) > 0 && <small className="pg-reiv-fotos" title={i.fotos_enviadas_em ? new Date(i.fotos_enviadas_em).toLocaleString('pt-BR') : undefined}><Images size={13} /> {i.fotos_enviadas} {i.fotos_enviadas === 1 ? 'foto enviada' : 'fotos enviadas'}{i.fotos_enviadas_em ? ` ${haQuanto(i.fotos_enviadas_em)}` : ''}</small>}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </Painel>

      <Painel Icon={Trophy} titulo="Mais pedidos de agenda" sub="Salões com mais gente pedindo para marcar pela MIMO. É a lista de venda: comece por cima.">
        {ranking.length === 0 ? <Vazio>Ninguém pediu ainda. Os pedidos aparecem quando alguém toca em “Quero marcar aqui pelo app” numa página.</Vazio> : (
          <ol className="pg-ranking">
            {ranking.map((r, n) => {
              const l = porId.get(r.lugar_id)
              const zap = l && (l.whatsapp || (ehCelular(l.telefone) && l.telefone))
              const texto = `Oi! Aqui é da MIMO. ${r.total} ${r.total === 1 ? 'pessoa pediu' : 'pessoas pediram'} para marcar horário no ${l?.nome ?? 'salão'} pelo nosso app. Posso te mostrar como ativar a agenda grátis?`
              return (
                <li key={r.lugar_id}>
                  <span className={'pg-rank' + (n === 0 ? ' primeiro' : '')}>{n + 1}</span>
                  <div><b>{l?.nome ?? 'salão fora da lista'}</b><small className="muted">{[l?.bairro, l?.salon_id ? 'já na MIMO' : null].filter(Boolean).join(' · ') || ' '}</small></div>
                  <em><strong>{r.total}</strong><small>{r.total === 1 ? 'pedido' : 'pedidos'}{r.novos ? ` · ${r.novos} ${r.novos === 1 ? 'novo' : 'novos'}` : ''}</small></em>
                  <span className="pg-rank-acoes">
                    {zap && !l.salon_id && <a className="plat-link" href={linkWhatsDoTel(zap, texto)} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} /> Chamar o salão</a>}
                    {l?.status === 'publicado' && <a className="plat-link" href={urlDoAmbiente('cliente', rotaDoLugar(l.cidade_slug, l.slug))} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> página</a>}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </Painel>

      <Painel Icon={Inbox} titulo="Pedidos" sub="Pedidos para marcar, correções e remoções que chegaram pelas páginas do guia." direita={<label className="pg-check"><input type="checkbox" checked={soAbertos} onChange={(e) => setSoAbertos(e.target.checked)} /> <span>Só abertos</span></label>}>
        <div className="pg-chips">
          {[['', 'Todos'], ...Object.entries(TIPO).filter(([id]) => id !== 'sou_dono')].map(([id, r]) => <button key={id} type="button" className={'plat-chip' + (tipo === id ? ' ativo' : '')} onClick={() => setTipo(id)}>{r} · {contagem[id] ?? 0}</button>)}
        </div>
        {lista.length === 0 ? <Vazio>{soAbertos ? 'Nenhum pedido aberto. Tudo atendido.' : 'Nenhum pedido ainda.'}</Vazio> : (
          <div className="pg-tabela-rola">
            <table className="plat-tabela pg-tabela-int">
              <thead><tr><th>Pedido</th><th>Salão</th><th>Quem</th><th>Mensagem</th><th /></tr></thead>
              <tbody>
                {lista.map((i) => {
                  const l = porId.get(i.lugar_id)
                  const zap = ehTelefone(i.contato) ? linkWhatsDoTel(i.contato, mensagemPara(i, l)) : null
                  return (
                    <tr key={i.id} className={i.atendido_em ? 'pg-atendido' : ''}>
                      <td>
                        <Pilula tom={TOM[i.tipo]}>{TIPO[i.tipo] ?? i.tipo}</Pilula>
                        <small className="pg-celula-sub" title={new Date(i.criado_em).toLocaleString('pt-BR')}>{haQuanto(i.criado_em)}</small>
                      </td>
                      <td>
                        <b>{l?.nome ?? 'salão fora da lista'}</b>
                        {l && (l.status === 'publicado'
                          ? <a className="plat-link pg-link-peq" href={urlDoAmbiente('cliente', rotaDoLugar(l.cidade_slug, l.slug))} target="_blank" rel="noopener noreferrer">página <ExternalLink size={11} /></a>
                          : <small className="muted"> · {l.status === 'removido' ? 'removido' : 'fora do ar'}</small>)}
                      </td>
                      <td className="pg-contato">
                        {i.nome ? <b>{i.nome}</b> : (!i.contato && <span className="muted">anônimo</span>)}
                        {i.contato && <span className="pg-celula-sub">{i.contato}{zap && <a className="pg-zap" href={zap} target="_blank" rel="noopener noreferrer" aria-label={`Chamar ${i.nome || 'no WhatsApp'}`} title="Chamar no WhatsApp"><MessageCircle size={13} /></a>}</span>}
                      </td>
                      <td className="pg-msg">{i.mensagem || <span className="muted">—</span>}</td>
                      <td className="pg-acoes-linha"><div className="pg-acoes-col">
                        {i.atendido_em
                          ? <button type="button" className="plat-link" onClick={() => atender(i, false)}><Undo2 size={13} /> Reabrir</button>
                          : <button type="button" className="plat-link" onClick={() => atender(i, true)}><Check size={13} /> Marcar atendido</button>}
                        {i.tipo === 'remover' && l && l.status !== 'removido' && <button type="button" className="plat-link pg-perigo" onClick={() => remover(i, l)}><Ban size={13} /> Remover a página</button>}
                      </div></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Painel>
    </div>
  )
}
