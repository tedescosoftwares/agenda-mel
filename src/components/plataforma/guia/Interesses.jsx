import { useMemo, useState } from 'react'
import { useDialogo } from '../../../context/DialogoContext'
import { Painel, Pilula, Vazio, haQuanto } from '../Pecas'
import { rotaDoLugar, linkWhatsDoTel, soDigitosTel, ehCelular } from '../../../lib/guia'
import { urlDoAmbiente } from '../../../lib/ambiente'
import { Inbox, Trophy, MessageCircle, ExternalLink, Check, Undo2, Ban } from 'lucide-react'

// Quem tocou nos botões das páginas: "Quero marcar aqui pelo app" (gente
// querendo a agenda do salão: é a lista de venda), "É o seu salão?",
// "Corrigir" e "Remover". Pedido de remoção tem atalho para tirar a página
// do ar de vez (status removido: a importação nunca traz de volta).

const TIPO = { quero_marcar: 'Quero marcar', sou_dono: 'É o dono', corrigir: 'Corrigir', remover: 'Remover' }
const TOM = { quero_marcar: 'rosa', sou_dono: 'roxo', corrigir: 'ambar', remover: 'carmim' }

function mensagemPara(i, l) {
  const salao = l?.nome ?? 'o salão'
  if (i.tipo === 'sou_dono') return `Oi${i.nome ? `, ${i.nome}` : ''}! Aqui é da MIMO. Vi que você cuida do ${salao}. Posso te mostrar como ativar a agenda grátis?`
  if (i.tipo === 'quero_marcar') return `Oi${i.nome ? `, ${i.nome}` : ''}! Aqui é da MIMO, sobre o seu pedido para marcar no ${salao} pelo app.`
  return `Oi${i.nome ? `, ${i.nome}` : ''}! Aqui é da MIMO, sobre a página do ${salao} no nosso guia de salões.`
}
const ehTelefone = (c) => !!c && !String(c).includes('@') && soDigitosTel(c).length >= 10

export default function Interesses({ g }) {
  const { confirmar } = useDialogo()
  const [soAbertos, setSoAbertos] = useState(true)
  const [tipo, setTipo] = useState('')
  const porId = useMemo(() => new Map(g.lugares.map((l) => [l.id, l])), [g.lugares])

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

  const contagem = useMemo(() => {
    const c = { '': 0, quero_marcar: 0, sou_dono: 0, corrigir: 0, remover: 0 }
    for (const i of g.interesses) if (!soAbertos || !i.atendido_em) { c['']++; c[i.tipo] = (c[i.tipo] ?? 0) + 1 }
    return c
  }, [g.interesses, soAbertos])
  const lista = useMemo(() => g.interesses
    .filter((i) => (!soAbertos || !i.atendido_em) && (!tipo || i.tipo === tipo))
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

  if (g.carregando) return <Painel Icon={Inbox} titulo="Interesses"><Vazio>Carregando…</Vazio></Painel>

  return (
    <div className="pg-interesses">
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

      <Painel Icon={Inbox} titulo="Pedidos" sub="Tudo o que chegou pelas páginas do guia." direita={<label className="pg-check"><input type="checkbox" checked={soAbertos} onChange={(e) => setSoAbertos(e.target.checked)} /> <span>Só abertos</span></label>}>
        <div className="pg-chips">
          {[['', 'Todos'], ...Object.entries(TIPO)].map(([id, r]) => <button key={id} type="button" className={'plat-chip' + (tipo === id ? ' ativo' : '')} onClick={() => setTipo(id)}>{r} · {contagem[id] ?? 0}</button>)}
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
