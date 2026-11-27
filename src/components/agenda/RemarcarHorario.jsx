import { useState } from 'react'
import { X, CalendarClock } from 'lucide-react'
import Portal from '../Portal'
import { remarcarHorario, pedeAviso } from '../../lib/acoesDoHorario'

// 4.0: remarcar pela casa (mover_horario): outro dia, outra hora ou outra profissional. O horário antigo é
// cancelado e a cliente recebe o aviso do novo. No computador também dá para arrastar o cartão no quadro.
export default function RemarcarHorario({ appt, dia, profs = [], onFechar, onPronto }) {
  const [novoDia, setNovoDia] = useState(dia)
  const [hora, setHora] = useState(String(appt.start_time).slice(0, 5))
  const [prof, setProf] = useState(appt.professional_id)
  const [indo, setIndo] = useState(false)
  const [avisar, setAvisar] = useState(true)   // 4.30: quem move escolhe se avisa
  const [erro, setErro] = useState('')
  const nome = appt.cliente || appt.profiles?.full_name || appt.guest_name || 'a cliente'
  const igual = novoDia === dia && hora === String(appt.start_time).slice(0, 5) && prof === appt.professional_id

  async function mover(e) {
    e.preventDefault()
    if (igual) { onFechar(); return }
    setIndo(true); setErro('')
    const r = await remarcarHorario(appt, { dia: novoDia, hora, prof, avisar })
    setIndo(false)
    if (!r.ok) { setErro(r.erro ?? 'Não deu para mover.'); return }
    onPronto?.()
  }

  return (
    <Portal><div className="modal-fundo" onClick={onFechar}>
      <form className="modal-caixa form ags-remarcar" onClick={(e) => e.stopPropagation()} onSubmit={mover} role="dialog" aria-modal="true" aria-labelledby="ags-remarcar-t">
        <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        <h3 id="ags-remarcar-t"><CalendarClock size={18} /> Remarcar {nome.split(' ')[0]}</h3>
        <p className="muted">{appt.servico || appt.service_name || appt.services?.name} · marcado às {String(appt.start_time).slice(0, 5)}</p>
        <div className="form-row">
          <label>Dia<input type="date" value={novoDia} onChange={(e) => setNovoDia(e.target.value)} required /></label>
          <label>Começa às<input type="time" step="300" value={hora} onChange={(e) => setHora(e.target.value)} required /></label>
        </div>
        {profs.length > 1 && (
          <label>Com
            <select value={prof} onChange={(e) => setProf(e.target.value)}>
              {profs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <p className="muted ags-remarcar-nota">O horário antigo é cancelado e o novo entra no lugar.</p>
        <label className="dialogo-opcao">
          <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} />
          <span><strong>{pedeAviso.rotulo}</strong><small>{pedeAviso.nota}</small></span>
        </label>
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onFechar}>Voltar</button>
          <button type="submit" className="btn btn-primary" disabled={indo}>{indo ? 'Movendo…' : 'Mover horário'}</button>
        </div>
      </form>
    </div></Portal>
  )
}
