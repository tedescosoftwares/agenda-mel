import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Receipt, Share2, Store } from 'lucide-react'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { formatCents } from '../../lib/pagamento'

// O comprovante do atendimento (105): o cupom que o balcão fechou, com
// os serviços, desconto, sinal pago pelo app, como pagou o resto e o troco.
const ROTULO = { dinheiro: 'Dinheiro', debito: 'Cartão de débito', credito: 'Cartão de crédito', pix: 'PIX', app: 'Pago pelo app', outro: 'Outro' }

export default function ClienteComanda() {
  const { id } = useParams()
  const [busca] = useSearchParams()
  const veioDe = busca.get('de')   // o horário que trouxe a cliente até aqui (numa visita com vários, não é sempre o principal)
  const [c, setC] = useState(undefined)
  useEffect(() => { supabase.rpc('comprovante_da_comanda', { comanda: id }).then(({ data }) => setC(data ?? null)) }, [id])

  async function compartilhar() {
    if (!c) return
    const texto = `Comprovante · ${c.salao?.nome}\n${(c.itens ?? []).map((i) => `${i.nome} ${formatCents(i.preco_cents * (i.qtd ?? 1))}`).join('\n')}\nTotal ${formatCents(c.total_cents)}`
    try { if (navigator.share) await navigator.share({ title: 'Comprovante', text: texto }); else await navigator.clipboard.writeText(texto) } catch { /* cancelou */ }
  }

  const voltar = veioDe ? `/cliente/agendamento/${veioDe}` : c?.appointment_id ? `/cliente/agendamento/${c.appointment_id}` : '/cliente/meus-agendamentos'
  if (c === undefined) return <ClienteShell titulo="Comprovante" voltar="/cliente/meus-agendamentos"><p className="carregando">Carregando…</p></ClienteShell>
  if (!c) return <ClienteShell titulo="Comprovante" voltar="/cliente/meus-agendamentos"><div className="card empty-state"><p>Não encontramos esse comprovante.</p></div></ClienteShell>
  const quando = c.dia ? new Date(c.dia + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) : new Date(c.fechada_em).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <ClienteShell titulo="Comprovante" voltar={voltar}>
      <div className="card pag-comprovante cupom-app">
        <div className="pag-comprovante-topo"><Receipt size={18} /><strong>Comprovante do atendimento</strong></div>
        <div className="cupom-salao">
          <span className="cupom-salao-logo">{c.salao?.logo_url ? <img src={c.salao.logo_url} alt="" /> : <Store size={18} />}</span>
          <span><strong>{c.salao?.nome}</strong><span className="muted">{quando}{c.hora ? ` às ${String(c.hora).slice(0, 5)}` : ''}{c.atendida_por ? ` · com ${c.atendida_por}` : ''}</span></span>
        </div>
        {(c.itens ?? []).map((x, k) => (
          <div key={k} className="resumo-linha pag-item"><span>{x.nome}{(x.qtd ?? 1) > 1 ? ` × ${x.qtd}` : ''}</span><span>{formatCents(x.preco_cents * (x.qtd ?? 1))}</span></div>
        ))}
        {c.desconto_cents > 0 && <div className="resumo-linha"><span className="muted">Desconto</span><strong>− {formatCents(c.desconto_cents)}</strong></div>}
        <div className="resumo-linha resumo-total"><span>Total</span><strong>{formatCents(c.total_cents)}</strong></div>
        <div className="cupom-pagamentos">
          {(c.pagamentos ?? []).map((p, k) => (
            <div key={k} className="resumo-linha"><span className="muted">{ROTULO[p.forma] ?? p.forma}{p.parcelas > 1 ? ` em ${p.parcelas}x` : ''}{p.detalhe && p.forma !== 'app' ? ` · ${p.detalhe}` : ''}{p.troco_cents > 0 ? ` · entregue ${formatCents(p.recebido_cents)}, troco ${formatCents(p.troco_cents)}` : ''}</span><strong>{formatCents(p.valor_cents)}</strong></div>
          ))}
        </div>
        {c.salao?.endereco && <p className="muted pag-comprovante-id">{c.salao.nome}{c.salao.cnpj ? ` · CNPJ ${c.salao.cnpj}` : ''} · {c.salao.endereco}{c.salao.cidade ? ` · ${c.salao.cidade}` : ''}</p>}
        <p className="muted pag-comprovante-id">Comprovante nº {String(c.id).slice(0, 8)} · emitido pelo MIMO. Não é documento fiscal.</p>
        {c.status === 'estornada' && <div className="alert alert-error">Esta comanda foi estornada pelo salão.</div>}
      </div>
      <button type="button" className="btn btn-ghost btn-block" onClick={compartilhar}><Share2 size={15} /> Compartilhar</button>
      {c.appointment_id && <Link to={`/cliente/agendamento/${c.appointment_id}`} className="btn btn-ghost btn-block">Ver o horário</Link>}
    </ClienteShell>
  )
}
