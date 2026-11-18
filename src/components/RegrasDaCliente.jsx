import { useEffect, useState } from 'react'
import { UserPlus, ShieldCheck, Minus, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'

// 3.98 (migração 242): as regras do salão para a cliente que marca sozinha, pelo app ou pela assistente (o que o salão
// lança não conta). O primeiro horário de cliente nova e os limites (horários futuros e faltas até a casa assumir).
// Fica na aba Pedidos da área WhatsApp, embaixo de "Quem confirma o horário marcado". Grava a cada mudança.
const CLIENTE_NOVA = [
  { id: 'igual', titulo: 'Igual às outras clientes', texto: 'Segue a regra de cima. É o padrão.' },
  { id: 'casa_confirma', titulo: 'A casa confirma o primeiro', texto: 'Vira pedido mesmo se a regra for “entra confirmado”. Do segundo em diante, segue a regra.' },
  { id: 'so_equipe', titulo: 'Só a equipe marca o primeiro', texto: 'A assistente atende e passa para a equipe marcar. Pelo app, vira pedido.' },
]

function Passo({ titulo, texto, valor, onMudar, disabled }) {
  return (
    <div className="rc-limite">
      <div className="rc-limite-txt"><strong>{titulo}</strong><small>{texto}</small></div>
      <div className="rc-passo" role="group" aria-label={titulo}>
        <button type="button" onClick={() => onMudar(valor - 1)} disabled={disabled || valor <= 1} aria-label="Menos"><Minus size={16} /></button>
        <b aria-live="polite">{valor}</b>
        <button type="button" onClick={() => onMudar(valor + 1)} disabled={disabled || valor >= 5} aria-label="Mais"><Plus size={16} /></button>
      </div>
    </div>
  )
}

export default function RegrasDaCliente({ salaoId }) {
  const [regras, setRegras] = useState(null)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!salaoId) return
    let vivo = true
    supabase.rpc('regras_da_cliente', { salao: salaoId }).then(({ data, error }) => {
      if (!vivo) return
      if (error) setErro(/function|does not exist|schema cache/i.test(error.message) ? 'As regras por cliente ainda não estão no banco (falta a atualização 242).' : error.message)
      else setRegras(data)
    })
    return () => { vivo = false }
  }, [salaoId])

  async function mudar(m) {
    const antes = regras
    setRegras({ ...regras, ...m }); setMsg(''); setErro('')
    const { data, error } = await supabase.rpc('salao_regras_cliente', {
      salao: salaoId, cliente_nova_: m.cliente_nova ?? null, limite_futuros_: m.limite_futuros ?? null, limite_faltas_: m.limite_faltas ?? null,
    })
    if (error) { setRegras(antes); setErro(error.message); return }
    setRegras(data); setMsg('Salvo.')
  }

  if (erro && !regras) return <div className="alert alert-error">{erro}</div>
  if (!regras) return null
  return (
    <>
      <section className="card asx-secao wa-pedidos">
        <header className="asx-cab">
          <span className="asx-ico"><UserPlus size={18} /></span>
          <div className="asx-cab-txt"><h3>Primeiro horário de cliente nova</h3><p>Quem nunca marcou no salão: pelo app ou pelo WhatsApp.</p></div>
        </header>
        <div className="as-quando rc-tres" role="radiogroup" aria-label="Primeiro horário de cliente nova">
          {CLIENTE_NOVA.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={regras.cliente_nova === o.id} className={'as-quando-op' + (regras.cliente_nova === o.id ? ' ativa' : '')} onClick={() => mudar({ cliente_nova: o.id })}>
              <span className="as-radio" /><span><strong>{o.titulo}</strong><small>{o.texto}</small></span>
            </button>
          ))}
        </div>
      </section>
      <section className="card asx-secao wa-pedidos">
        <header className="asx-cab">
          <span className="asx-ico"><ShieldCheck size={18} /></span>
          <div className="asx-cab-txt"><h3>Limites por cliente</h3><p>Para ninguém lotar a agenda de brincadeira. Vale para o app e o WhatsApp; o que o salão lança não conta.</p></div>
        </header>
        <Passo titulo="Horários futuros por cliente" texto="Passou disso, ela não marca sozinha: a assistente chama a equipe e o app avisa para falar com o salão."
          valor={regras.limite_futuros} onMudar={(v) => mudar({ limite_futuros: v })} />
        <Passo titulo="Faltas até a casa assumir" texto="Depois de tantas faltas (nos últimos 12 meses), os horários dessa cliente viram pedido para a equipe confirmar."
          valor={regras.limite_faltas} onMudar={(v) => mudar({ limite_faltas: v })} />
        {(msg || erro) && <p className={erro ? 'as-erro-linha' : 'rc-msg'}>{erro || msg}</p>}
      </section>
    </>
  )
}
