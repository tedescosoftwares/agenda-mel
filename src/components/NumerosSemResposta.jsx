import { useEffect, useState } from 'react'
import { MessageCircleOff, Trash2, Plus, Info, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { mascararTel, telValido } from '../lib/guiaWa'

// 3.99 (migração 248): os números que a assistente não responde. A mensagem chega no celular do salão normalmente;
// ela só não responde. A equipe (profissionais e quem manda no salão, pelo WhatsApp cadastrado) fica de fora por
// padrão; os pedidos e avisos delas continuam chegando. Outros números (um celular seu, um fornecedor) entram aqui ou
// pela aba Mensagens ("Não responder este número").

export const telefoneBr = (t) => {
  const n = String(t ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`
  return t ?? ''
}

export default function NumerosSemResposta({ salaoId, ordem }) {
  const [d, setD] = useState(null)
  const [erro, setErro] = useState('')
  const [some, setSome] = useState(false)
  const [tel, setTel] = useState('')
  const [nome, setNome] = useState('')
  const [indo, setIndo] = useState(false)

  useEffect(() => {
    if (!salaoId) return
    let vivo = true
    supabase.rpc('assistente_sem_resposta', { salao: salaoId }).then(({ data, error }) => {
      if (!vivo) return
      if (error) {
        if (/function|does not exist|schema cache/i.test(error.message)) setErro('A lista ainda não está no banco (falta a atualização 248).')
        else setSome(true)   // quem não manda no salão não vê
        return
      }
      setD(data)
    })
    return () => { vivo = false }
  }, [salaoId])

  async function rodar(nomeRpc, args) {
    setIndo(true); setErro('')
    const { data, error } = await supabase.rpc(nomeRpc, { salao: salaoId, ...args })
    setIndo(false)
    if (error) { setErro(error.message); return false }
    setD(data)
    return true
  }
  async function adicionar(e) {
    e.preventDefault()
    if (!telValido(tel)) { setErro('Confira o WhatsApp: DDD e número (ex.: 13 99999-1234).'); return }
    if (await rodar('assistente_sem_resposta_salvar', { tel, nome_: nome.trim() || null })) { setTel(''); setNome('') }
  }

  if (some) return null
  const equipe = d?.equipe ?? []
  const lista = d?.lista ?? []
  return (
    <section className="card asx-secao" style={ordem != null ? { order: ordem } : undefined}>
      <header className="asx-cab">
        <span className="asx-ico"><MessageCircleOff size={18} /></span>
        <div className="asx-cab-txt"><h3>Números que ela não responde</h3><p>A mensagem chega no celular do salão normalmente; ela só não responde. Para a equipe, um fornecedor ou outro número seu.</p></div>
      </header>
      {erro && <div className="alert alert-error">{erro}</div>}
      {!d ? (!erro && <p className="muted">Carregando…</p>) : (
        <>
          <div className="asx-chaves">
            <label className="as-chave">
              <span className="as-chave-texto">
                <strong>A equipe do salão fica de fora</strong>
                <small>Profissionais e quem manda no salão, pelo WhatsApp cadastrado de cada uma. Os pedidos e avisos delas continuam chegando.</small>
              </span>
              <span className="switch"><input type="checkbox" checked={Boolean(d.ignora_equipe)} disabled={indo} onChange={(e) => rodar('salao_ignora_equipe', { liga: e.target.checked })} /><span /></span>
            </label>
          </div>
          {d.ignora_equipe && equipe.length > 0 && (
            <div className="nr-equipe" aria-label="A equipe que ela não responde">
              {equipe.map((p, i) => (
                <span key={p.telefone + i} className="nr-chip">{i === 0 && <Users size={13} />} <b>{p.voce ? `${String(p.nome).split(' ')[0]} (você)` : p.nome}</b> {telefoneBr(p.telefone)}</span>
              ))}
            </div>
          )}
          {!d.ignora_equipe && <p className="lp-vazio">Desligado: quem é da equipe e escreve no WhatsApp do salão recebe resposta da assistente, como uma cliente.</p>}

          <h4 className="lp-h4">Outros números</h4>
          {lista.length === 0 ? <p className="lp-vazio">Nenhum número na lista.</p> : (
            <ul className="nr-lista">
              {lista.map((n) => (
                <li key={n.id}>
                  <div><strong>{n.nome || telefoneBr(n.telefone)}</strong>{n.nome && <small>{telefoneBr(n.telefone)}</small>}</div>
                  <button type="button" className="nr-tirar" aria-label={`Tirar ${n.nome || telefoneBr(n.telefone)} da lista`} title="Tirar da lista" disabled={indo} onClick={() => rodar('assistente_sem_resposta_tirar', { item: n.id })}><Trash2 size={17} /></button>
                </li>
              ))}
            </ul>
          )}
          <form className="nr-add" onSubmit={adicionar}>
            <label>WhatsApp<input inputMode="tel" autoComplete="off" placeholder="(13) 99999-1234" value={tel} onChange={(e) => setTel(mascararTel(e.target.value))} /></label>
            <label><span>Quem é <em>(opcional)</em></span><input maxLength={60} placeholder="Ex.: fornecedor" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
            <button type="submit" className="btn btn-primary" disabled={indo || !telValido(tel)}><Plus size={16} /> Adicionar</button>
          </form>
          <p className="as-nota"><Info size={15} /><span>Também dá para tirar um número direto da conversa, na aba <b>Mensagens</b>: “Não responder este número”.</span></p>
        </>
      )}
    </section>
  )
}
