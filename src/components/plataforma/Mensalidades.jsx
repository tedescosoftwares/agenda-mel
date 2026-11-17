import { useEffect, useState } from 'react'
import { Check, Receipt } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useDialogo } from '../../context/DialogoContext'
import { Pilula, Vazio } from './Pecas'

// 3.85 (migração 229): as mensalidades da MIMO e a baixa à mão. Com o Asaas em produção, é por aqui que a
// Plataforma confirma um Pix para testar (ou um que caiu fora do fluxo): "Dar baixa" faz o mesmo que a
// confirmação do Asaas (libera os 30 dias e ativa o salão), e a tela de ativação do salão segue sozinha.
//   salao     o id do salão; sem ele, de todos
//   abertas   só as que esperam pagamento (o quadro da lista de Salões)
const ABERTAS = new Set(['a_criar', 'aguardando', 'falhou', 'expirado'])
const STATUS = { a_criar: 'gerando', aguardando: 'aguardando Pix', pago: 'pago', falhou: 'falhou', cancelado: 'cancelada', expirado: 'expirou' }
const TIPO = { inicial: '1ª mensalidade', avista: 'à vista', primeira: '1ª mensalidade', renovacao: 'renovação' }
const reais = (c) => (Number(c ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const quando = (v) => (v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

export default function Mensalidades({ salao = null, abertas = false, onMudou }) {
  const { confirmar, avisar } = useDialogo()
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState('')
  const carregar = () => supabase.rpc('plataforma_cobrancas', { salao, quantas: abertas ? 200 : 60 })
    .then(({ data, error }) => { if (error) setErro(error.message); setLista(Array.isArray(data) ? data : []) })
  useEffect(() => { carregar() }, [salao]) // eslint-disable-line react-hooks/exhaustive-deps
  // o quadro das abertas se atualiza sozinho (quem está testando gera o Pix e vem aqui dar baixa)
  useEffect(() => {
    if (!abertas) return
    const t = setInterval(carregar, 15000)
    return () => clearInterval(t)
  }, [abertas, salao]) // eslint-disable-line react-hooks/exhaustive-deps

  async function darBaixa(c) {
    const ok = await confirmar({
      titulo: `Dar baixa em ${reais(c.total_cents)}?`,
      texto: `${c.salao} · ${TIPO[c.tipo] ?? c.tipo}. Fica como paga agora: libera os 30 dias e ativa o salão, como se o Pix tivesse caído. A cobrança no Asaas continua aberta até vencer; se pagarem mesmo assim, nada muda.`,
      ok: 'Dar baixa',
    })
    if (!ok) return
    setIndo(c.id); setErro('')
    const { error } = await supabase.rpc('plataforma_dar_baixa', { cobranca: c.id, nota: 'baixa manual pela Plataforma' })
    setIndo('')
    if (error) { setErro(error.message); return }
    await carregar()
    onMudou?.()
    avisar({ titulo: 'Baixa dada', texto: `${c.salao} está pago e ativo. Se a tela de ativação estiver aberta, ela segue sozinha em alguns segundos.` })
  }

  const vis = (lista ?? []).filter((c) => !abertas || ABERTAS.has(c.status))
  if (abertas && lista && vis.length === 0) return <Vazio>Nenhum Pix esperando pagamento.</Vazio>
  return (
    <div className="plat-mens">
      {erro && <div className="alert alert-error">{erro}</div>}
      {!lista ? <Vazio>Carregando…</Vazio> : vis.length === 0 ? <Vazio>Nenhuma mensalidade ainda.</Vazio> : (
        <ul className="plat-mens-lista">
          {vis.map((c) => (
            <li key={c.id} className={'st-' + c.status}>
              <span className="plat-mens-ico"><Receipt size={15} /></span>
              <span className="plat-mens-info">
                <strong>{reais(c.total_cents)} <small>· {TIPO[c.tipo] ?? c.tipo} · {c.metodo === 'cartao' ? 'cartão' : 'Pix'}</small></strong>
                <small className="muted">
                  {!salao && <>{c.salao} · </>}aberta {quando(c.criado_em)}
                  {c.pago_em && <> · paga {quando(c.pago_em)}</>}
                  {c.baixa_manual_em && <> · baixa à mão{c.baixa_manual_quem ? ` por ${c.baixa_manual_quem}` : ''}</>}
                </small>
              </span>
              <Pilula>{STATUS[c.status] ?? c.status}</Pilula>
              {ABERTAS.has(c.status) && (
                <button type="button" className="btn btn-primary btn-mini plat-mens-baixa" onClick={() => darBaixa(c)} disabled={indo === c.id}>
                  <Check size={13} /> {indo === c.id ? 'Dando baixa…' : 'Dar baixa'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
