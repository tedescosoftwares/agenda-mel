import { useCallback, useEffect, useState } from 'react'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import BloqueiosEditor from '../../components/BloqueiosEditor'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

// Horários (tela 18): os dias da semana como chips, e para o dia
// escolhido o expediente e o intervalo entre atendimentos. Bloqueios
// (almoço, folga, médico) ficam na segunda aba — são o que corta o
// expediente em pedaços.
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const DIAS_LONGO = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

export default function ProHorarios() {
  const { professional, recarregarProfessional } = useAuth()
  const [aba, setAba] = useState('horarios')
  const [hours, setHours] = useState([])
  const [dia, setDia] = useState(new Date().getDay() || 1)
  const [buffer, setBuffer] = useState(professional?.buffer_minutes ?? 0)
  const [info, setInfo] = useState('')
  const [erro, setErro] = useState('')
  const [saving, setSaving] = useState(false)
  const profId = professional?.id

  const carregar = useCallback(async () => {
    if (!profId) return
    const { data } = await supabase.from('professional_hours').select('*').eq('professional_id', profId).order('weekday')
    setHours((data ?? []).map((h) => ({ ...h, start_time: h.start_time.slice(0, 5), end_time: h.end_time.slice(0, 5) })))
  }, [profId])
  useEffect(() => { carregar() }, [carregar])

  if (!professional) return <SemFicha />

  const h = hours.find((x) => x.weekday === dia)
  const mudar = (patch) => { setHours((p) => p.map((x) => (x.weekday === dia ? { ...x, ...patch } : x))); setInfo('') }

  async function copiarParaTodos() {
    if (!h) return
    setHours((p) => p.map((x) => (x.weekday === 0 ? x : { ...x, open: h.open, start_time: h.start_time, end_time: h.end_time })))
    setInfo('Copiado para segunda a sábado. Toque em Salvar.')
  }

  async function salvar() {
    setErro(''); setInfo('')
    for (const x of hours) if (x.open && x.start_time >= x.end_time) { setErro(`${DIAS_LONGO[x.weekday]}: o fim precisa ser depois do início.`); return }
    setSaving(true)
    const { error: e1 } = await supabase.from('professionals').update({ buffer_minutes: Number(buffer) }).eq('id', profId)
    if (e1) { setErro(e1.message); setSaving(false); return }
    for (const x of hours) {
      const { error } = await supabase.from('professional_hours').update({ open: x.open, start_time: x.start_time, end_time: x.end_time }).eq('professional_id', profId).eq('weekday', x.weekday)
      if (error) { setErro(error.message); setSaving(false); return }
    }
    setSaving(false); setInfo('Horários salvos.'); recarregarProfessional?.()
  }

  return (
    <ProShell titulo="Horários" voltar="/pro/ajustes">
      <div className="abas">
        <button className={aba === 'horarios' ? 'aba active' : 'aba'} onClick={() => setAba('horarios')}>Horários</button>
        <button className={aba === 'bloqueios' ? 'aba active' : 'aba'} onClick={() => setAba('bloqueios')}>Bloqueios</button>
      </div>

      {aba === 'bloqueios' && <BloqueiosEditor professionalId={profId} />}

      {aba === 'horarios' && (
        <>
          <div className="filtro-chips dias-chips">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const x = hours.find((y) => y.weekday === d)
              return (
                <button key={d} className={'chip' + (dia === d ? ' active' : '') + (x && !x.open ? ' fechado' : '')} onClick={() => setDia(d)}>{DIAS[d]}</button>
              )
            })}
          </div>

          {h && (
            <div className="card">
              <div className="cl-ajuste">
                <div className="cliente-info">
                  <span className="cliente-nome"><span className="nome-txt">{DIAS_LONGO[dia]}</span></span>
                  <span className="muted cliente-meta">{h.open ? 'Atende neste dia' : 'Folga'}</span>
                </div>
                <button className={'switch' + (h.open ? ' on' : '')} role="switch" aria-checked={h.open} onClick={() => mudar({ open: !h.open })} aria-label="Atende neste dia" />
              </div>

              {h.open && (
                <div className="intervalo">
                  <label className="campo-solto"><span>Começa</span><input type="time" value={h.start_time} onChange={(e) => mudar({ start_time: e.target.value })} /></label>
                  <span className="intervalo-ate">até</span>
                  <label className="campo-solto"><span>Termina</span><input type="time" value={h.end_time} onChange={(e) => mudar({ end_time: e.target.value })} /></label>
                </div>
              )}

              <button className="btn-mini" onClick={copiarParaTodos} style={{ marginTop: '0.6rem' }}>Copiar para os outros dias</button>
            </div>
          )}

          <div className="card cl-ajuste" style={{ marginTop: '0.8rem' }}>
            <div className="cliente-info">
              <span className="cliente-nome"><span className="nome-txt">Intervalo entre atendimentos</span></span>
              <span className="muted cliente-meta">Tempo para arrumar entre uma cliente e outra</span>
            </div>
            <select className="select-mini" value={buffer} onChange={(e) => setBuffer(e.target.value)}>
              {[0, 5, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </div>

          <p className="muted" style={{ fontSize: '0.82rem' }}>Almoço, médico e folga em data específica ficam na aba <strong>Bloqueios</strong>.</p>

          {erro && <div className="alert alert-error">{erro}</div>}
          {info && <div className="alert alert-info">{info}</div>}

          <div className="rodape-fixo">
            <button className="btn btn-primary btn-block" onClick={salvar} disabled={saving}>{saving ? 'Salvando…' : 'Salvar horários'}</button>
          </div>
        </>
      )}
    </ProShell>
  )
}
