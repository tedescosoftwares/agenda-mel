import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { MarcaIcon, Wordmark } from './icons'
import { CalendarX, UserX } from 'lucide-react'

// A página de ciência (077): a cliente faltou, ou cancelou em cima da
// hora. Cobre o app até ela tocar em "Li e concordo". Numa falta, ela
// pode dizer "Eu compareci": a profissional é avisada, a plataforma vê.
export default function CienciaGate() {
  const [lista, setLista] = useState([])
  const [contestando, setContestando] = useState(false)
  const [texto, setTexto] = useState('')
  const [mexendo, setMexendo] = useState(false)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('minhas_ciencias')
    setLista(data ?? [])
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const c = lista[0]
  if (!c) return null
  const falta = c.motivo === 'falta'

  async function concordar() {
    setMexendo(true); setErro('')
    const { error } = await supabase.rpc('aceitar_ciencia', { ciencia: c.id })
    setMexendo(false)
    if (error) { setErro(error.message); return }
    setContestando(false); carregar()
  }
  async function contestar() {
    setMexendo(true); setErro('')
    const { error } = await supabase.rpc('contestar_falta', { ciencia: c.id, texto: texto.trim() || null })
    setMexendo(false)
    if (error) { setErro(error.message); return }
    setContestando(false); setTexto(''); carregar()
  }

  return (
    <div className="ciencia" role="dialog" aria-modal="true" aria-labelledby="ciencia-titulo">
      <div className="ciencia-caixa">
        <span className="brand-inline ciencia-marca"><MarcaIcon className="marca" id="ciencia" /><Wordmark tamanho={1.2} /></span>
        <span className="ciencia-icone">{falta ? <UserX size={26} /> : <CalendarX size={26} />}</span>
        <h2 id="ciencia-titulo">{falta ? 'Sobre o horário que não aconteceu' : 'Sobre o cancelamento em cima da hora'}</h2>
        <p className="ciencia-quando"><strong>{c.servico}</strong> com {c.profissional}, {c.quando}.</p>
        {falta
          ? <p>Esse horário ficou marcado como <strong>não comparecimento</strong>. Quando um horário reservado fica vazio, a profissional perde aquele tempo de trabalho e outra cliente que queria a vaga fica sem ela.</p>
          : <p>Esse horário foi cancelado <strong>com menos de 24 horas</strong> de antecedência. Nesse prazo é difícil a profissional preencher a vaga, e ela perde aquele tempo de trabalho.</p>}
        <p>Não é multa nem bronca: é um pedido. Se não puder ir, cancele ou peça para remarcar com antecedência, pelo app. É assim que a agenda funciona bem para todo mundo.</p>
        {contestando ? (
          <div className="ciencia-contestar">
            <label>Conta o que aconteceu (opcional)<textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: cheguei 10 minutos atrasada e fui atendida" /></label>
            <button className="btn btn-primary btn-block" onClick={contestar} disabled={mexendo}>{mexendo ? 'Enviando…' : 'Enviar: eu compareci'}</button>
            <button className="btn btn-ghost btn-block" onClick={() => setContestando(false)} disabled={mexendo}>Voltar</button>
          </div>
        ) : (
          <>
            <button className="btn btn-primary btn-block" onClick={concordar} disabled={mexendo}>{mexendo ? 'Salvando…' : 'Li e concordo'}</button>
            {falta && <button className="btn btn-ghost btn-block" onClick={() => setContestando(true)} disabled={mexendo}>Eu compareci</button>}
          </>
        )}
        {erro && <div className="alert alert-error">{erro}</div>}
        {lista.length > 1 && <p className="muted ciencia-mais">Mais {lista.length - 1} {lista.length - 1 === 1 ? 'aviso' : 'avisos'} depois deste.</p>}
      </div>
    </div>
  )
}
