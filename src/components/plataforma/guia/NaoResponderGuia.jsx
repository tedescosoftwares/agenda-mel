import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { Vazio } from '../Pecas'
import { tel, telCanon, telValido, mascararTel, quando } from '../../../lib/guiaWa'
import { BellOff, Plus, TriangleAlert, LoaderCircle } from 'lucide-react'

// 4.42 (migração 274): os números que o WhatsApp do guia não responde. A equipe usa o mesmo número no WhatsApp Web;
// antes de chamar alguém por ele, põe o número aqui e a Mel fica calada com essa pessoa até ele sair da lista.
const PRAZOS = [['', 'Até eu tirar'], ['2', 'Por 2 horas'], ['24', 'Por 24 horas']]
const faltaMigracao = (e) => e?.code === 'PGRST202' || e?.status === 404 || /could not find the function|schema cache/i.test(e?.message ?? '')

export default function NaoResponderGuia() {
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')
  const [numero, setNumero] = useState('')
  const [nome, setNome] = useState('')
  const [prazo, setPrazo] = useState('')
  const [ocupado, setOcupado] = useState('')
  const ler = useCallback(async () => {
    const { data, error } = await supabase.rpc('guia_whats_calados')
    if (error) { setErro(faltaMigracao(error) ? 'Falta a migração 274 no banco (bat, opção B).' : error.message || 'não deu para ler'); setLista([]); return }
    setErro(''); setLista(Array.isArray(data) ? data : [])
  }, [])
  useEffect(() => { const t = setTimeout(ler, 0); return () => clearTimeout(t) }, [ler])
  async function adicionar(e) {
    e.preventDefault()
    if (!telValido(numero)) { setErro('Confira o número: DDD + número.'); return }
    setOcupado('novo')
    const { error } = await supabase.rpc('guia_whats_calar', { tel: telCanon(numero), nome_: nome.trim() || null, horas: prazo ? Number(prazo) : null })
    setOcupado('')
    if (error) { setErro(faltaMigracao(error) ? 'Falta a migração 274 no banco (bat, opção B).' : error.message); return }
    setNumero(''); setNome(''); ler()
  }
  async function tirar(n) {
    setOcupado(n.id)
    const { error } = await supabase.rpc('guia_whats_falar', { id_: n.id })
    setOcupado('')
    if (error) { setErro(error.message); return }
    ler()
  }
  return (
    <section className="pg-wa-secao" data-teste="wa-nao-responder">
      <p className="muted pg-wa-secao-sub">Vai chamar alguém por este número pelo WhatsApp Web ou pelo celular? Ponha o número aqui antes. Enquanto ele estiver na lista, a Mel não responde essa pessoa nem manda lembrete para ela: a mensagem chega só para você. Terminou a conversa, tire da lista.</p>
      <form className="pg-wa-nr-form" onSubmit={adicionar}>
        <label>Número (com DDD)<input type="tel" inputMode="numeric" value={numero} onChange={(e) => setNumero(mascararTel(e.target.value))} placeholder="(11) 98765-4321" data-teste="wa-nr-numero" /></label>
        <label><span>Quem é <span className="muted">(opcional)</span></span><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Carla, do Studio Bela" maxLength={60} /></label>
        <label>Por quanto tempo<select value={prazo} onChange={(e) => setPrazo(e.target.value)}>{PRAZOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></label>
        <button type="submit" className="btn btn-primary" disabled={ocupado === 'novo'} data-teste="wa-nr-adicionar">{ocupado === 'novo' ? <LoaderCircle size={15} className="pg-gira" /> : <Plus size={15} />} Não responder</button>
      </form>
      {erro && <p className="pg-wa-erro"><TriangleAlert size={13} /> {erro}</p>}
      {lista === null ? <Vazio>Carregando…</Vazio> : lista.length === 0 ? <Vazio>Nenhum número na lista: a Mel responde todo mundo.</Vazio> : (
        <ul className="pg-wa-nr-lista" data-teste="wa-nr-lista">
          {lista.map((n) => (
            <li key={n.id}>
              <span className="pg-wa-nr-ic"><BellOff size={15} /></span>
              <div>
                <strong>{n.nome || tel(n.telefone) || n.telefone}</strong>
                <small className="muted">{n.nome ? `${tel(n.telefone) || n.telefone} · ` : ''}{n.ate ? `até ${quando(n.ate)}` : 'até você tirar'}</small>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => tirar(n)} disabled={ocupado === n.id}>Voltar a responder</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
