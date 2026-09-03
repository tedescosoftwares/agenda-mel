import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { toISODate } from '../../lib/format'

// Encaixe manual (tela 17): serviço, data, horário e — se quiser — a
// cliente. Virou tela em vez de modal porque um formulário de quatro
// campos num celular precisa da tela inteira, e o teclado come metade.
export default function ProEncaixe() {
  const { professional } = useAuth()
  const navigate = useNavigate()
  const [servicos, setServicos] = useState([])
  const [servicoId, setServicoId] = useState('')
  const [data, setData] = useState(toISODate(new Date()))
  const [hora, setHora] = useState('')
  const [livres, setLivres] = useState([])
  const [nome, setNome] = useState('')
  const [fone, setFone] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const profId = professional?.id

  useEffect(() => {
    if (!profId) return
    supabase.from('professional_services').select('services (*)').eq('professional_id', profId)
      .then(({ data }) => setServicos((data ?? []).map((v) => v.services).filter((s) => s?.active)))
  }, [profId])

  const servico = servicos.find((s) => s.id === servicoId)

  useEffect(() => {
    if (!profId || !servico || !data) { setLivres([]); return }
    supabase.rpc('horarios_livres', { prof: profId, dia: data, duracao: servico.duration_minutes })
      .then(({ data: d }) => setLivres((d ?? []).map((h) => String(h.hora ?? h).slice(0, 5))))
  }, [profId, servico, data])

  if (!professional) return <SemFicha />

  async function salvar(e) {
    e.preventDefault()
    if (!servicoId || !data || !hora) { setErro('Escolha serviço, data e horário.'); return }
    setSalvando(true)
    const { error } = await supabase.rpc('encaixar_atendimento', {
      prof: profId, servico: servicoId, dia: data, inicio: hora,
      nome_cliente: nome.trim() || null, telefone: fone.trim() || null, cliente: null, duracao_min: null,
    })
    setSalvando(false)
    if (error) setErro(error.message)
    else navigate('/pro/agenda')
  }

  return (
    <ProShell titulo="Novo encaixe" voltar="/pro/agenda">
      <form className="form" onSubmit={salvar}>
        <label>Serviço
          <select value={servicoId} onChange={(e) => { setServicoId(e.target.value); setHora('') }}>
            <option value="">Selecione</option>
            {servicos.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.duration_minutes}min</option>)}
          </select>
        </label>
        <label>Data<input type="date" value={data} min={toISODate(new Date())} onChange={(e) => { setData(e.target.value); setHora('') }} /></label>
        <label>Horário
          {servico ? (
            livres.length ? (
              <div className="slots-grid slots-compacto">
                {livres.map((h) => <button key={h} type="button" className={h === hora ? 'slot active' : 'slot'} onClick={() => setHora(h)}>{h}</button>)}
              </div>
            ) : <span className="muted">Nenhum horário livre nesse dia.</span>
          ) : <span className="muted">Escolha o serviço primeiro.</span>}
        </label>
        <label>Cliente (opcional)<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Como você anota na agenda" /></label>
        <label>WhatsApp da cliente (opcional)<input type="tel" value={fone} onChange={(e) => setFone(e.target.value)} placeholder="(13) 99999-9999" /></label>
        {erro && <div className="alert alert-error">{erro}</div>}
        <button className="btn btn-primary btn-block" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar encaixe'}</button>
      </form>
    </ProShell>
  )
}
