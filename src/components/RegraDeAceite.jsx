import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// 3.95.6: "Pedidos de horário" (quem confirma o horário que a cliente marca pelo app ou pelo WhatsApp) num bloco só,
// usado em Ajustes e na tela Assistente do WhatsApp. A regra é uma só (salons.aceite_modo, salao_aceite); mudar em
// um lugar muda no outro. Sem `inicial`, lê do banco.
const MODOS_DE_ACEITE = [
  { id: 'automatico', titulo: 'Entra confirmado na hora', texto: 'A vaga estava livre, ela pegou. Ninguém precisa responder.' },
  { id: 'casa', titulo: 'A casa confirma', texto: 'Vira um pedido só para a casa; você confirma pelo quadro ou pelo alerta, dentro do prazo.' },
  { id: 'profissional', titulo: 'Cada profissional decide', texto: 'Vale o que cada uma configurou na própria agenda.' },
]

function textoDoPrazo(m) {
  return m < 60 ? `${m} min` : m < 1440 ? `${m / 60} h` : '1 dia'
}

export default function RegraDeAceite({ salaoId, inicial = null, onMudou, pergunta = 'Quando uma cliente marca pelo app ou pelo WhatsApp, quem confirma?' }) {
  const [aceite, setAceite] = useState(inicial)
  const [msg, setMsg] = useState('')
  // 3.98.3 (migração 245): no "a casa confirma", a profissional só fica sabendo depois de confirmado, se o salão quiser.
  // null = ainda lendo, ou o banco sem a 245 (aí o seletor nem aparece)
  const [avisa, setAvisa] = useState(null)

  useEffect(() => {
    if (!salaoId) return
    let vivo = true
    supabase.rpc('salao_avisa_profissional', { salao: salaoId, avisa: null }).then(({ data, error }) => {
      if (vivo && !error && typeof data === 'boolean') setAvisa(data)
    })
    return () => { vivo = false }
  }, [salaoId])

  async function mudarAviso(valor) {
    const antes = avisa
    setAvisa(valor); setMsg('')
    const { data, error } = await supabase.rpc('salao_avisa_profissional', { salao: salaoId, avisa: valor })
    if (error) { setAvisa(antes); setMsg(error.message); return }
    setAvisa(Boolean(data))
    setMsg(data ? 'Pronto: depois que a casa confirmar, a profissional fica sabendo.' : 'Pronto: a profissional não recebe aviso; o horário aparece na agenda dela.')
  }

  useEffect(() => {
    if (inicial || !salaoId) return
    let vivo = true
    supabase.from('salons').select('aceite_modo, minutos_para_aceitar, ao_expirar').eq('id', salaoId).maybeSingle().then(({ data }) => {
      if (vivo) setAceite({ modo: data?.aceite_modo ?? 'casa', minutos: data?.minutos_para_aceitar ?? 120, no_silencio: data?.ao_expirar ?? 'confirma' })
    })
    return () => { vivo = false }
  }, [salaoId, inicial])

  async function salvar(mudanca) {
    const novo = { ...aceite, ...mudanca }
    setAceite(novo); setMsg('')
    const { data, error } = await supabase.rpc('salao_aceite', { salao: salaoId, modo: novo.modo, minutos: novo.minutos, no_silencio: novo.no_silencio })
    if (error) { setMsg(error.message); return }
    setMsg(data?.modo === 'automatico' ? 'Pronto: tudo entra confirmado na hora.' : data?.modo === 'casa' ? `Pronto: a casa confirma em até ${textoDoPrazo(data.minutos)}, ${data.profissionais_ajustadas} ${data.profissionais_ajustadas === 1 ? 'profissional segue' : 'profissionais seguem'} a regra.` : 'Pronto: cada profissional decide nas próprias configurações.')
    onMudou?.(novo)
  }

  return (
    <div className="regra-aceite">
      {pergunta && <p className="muted aj-aceite-intro">{pergunta}</p>}
      <div className="aj-aceite">
        {MODOS_DE_ACEITE.map((o) => (
          <button key={o.id} type="button" className={'card aj-aceite-opcao' + (aceite?.modo === o.id ? ' ativa' : '')} onClick={() => salvar({ modo: o.id })} disabled={!aceite} aria-pressed={aceite?.modo === o.id}>
            <span className="aj-aceite-marca" />
            <span><strong>{o.titulo}</strong><span className="muted">{o.texto}</span></span>
          </button>
        ))}
      </div>
      {aceite?.modo === 'casa' && (
        <div className="card aj-aceite-prazo">
          <label>Prazo para a casa responder
            <select value={aceite.minutos} onChange={(e) => salvar({ minutos: Number(e.target.value) })}>
              {[15, 30, 60, 120, 240, 480, 1440].map((m) => <option key={m} value={m}>{textoDoPrazo(m)}</option>)}
            </select>
          </label>
          <label>Se ninguém responder no prazo
            <select value={aceite.no_silencio} onChange={(e) => salvar({ no_silencio: e.target.value })}>
              <option value="confirma">confirma sozinho (a cliente não perde a vaga)</option>
              <option value="cancela">cancela e avisa a cliente</option>
            </select>
          </label>
          {avisa !== null && (
            <label>Depois que a casa confirmar
              <select value={avisa ? 'sim' : 'nao'} onChange={(e) => mudarAviso(e.target.value === 'sim')}>
                <option value="sim">avisar a profissional</option>
                <option value="nao">não avisar (ela vê na agenda)</option>
              </select>
            </label>
          )}
          <p className="muted">O pedido chega só para quem manda no salão (no celular e no alerta do PDV), com "Confirmar" e "Recusar". A profissional não recebe o pedido{avisa === false ? '; o horário aparece na agenda dela.' : ': fica sabendo depois de confirmado.'} No quadro, o cartão fica marcado "a confirmar" até alguém decidir.</p>
        </div>
      )}
      {msg && <p className="muted aj-aceite-msg">{msg}</p>}
    </div>
  )
}
