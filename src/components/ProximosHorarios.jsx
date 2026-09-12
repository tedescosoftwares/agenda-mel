import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { toISODate } from '../lib/format'
import { CalendarCheck, Hourglass, ChevronRight } from 'lucide-react'

// Os próximos horários da cliente, discretos, na tela inicial. Cada um
// leva para a página do agendamento; o título leva para a lista.
export default function ProximosHorarios({ maximo = 2 }) {
  const { user } = useAuth()
  const [lista, setLista] = useState(null)
  useEffect(() => {
    let vivo = true
    // "próximo" é o que ainda não terminou: um horário de hoje às 17h,
    // às 22h já passou, mesmo que a data seja de hoje
    supabase.from('appointments').select('id, date, start_time, end_time, status, remarca_de, services (name), professionals (name)')
      .eq('client_id', user.id).gte('date', toISODate(new Date())).in('status', ['pendente', 'confirmado'])
      .order('date').order('start_time').limit(maximo + 4)
      .then(({ data }) => { if (vivo) setLista((data ?? []).filter((a) => !a.remarca_de && aindaVem(a)).slice(0, maximo)) })
    return () => { vivo = false }
  }, [user.id, maximo])

  if (!lista || lista.length === 0) return null
  return (
    <section className="proximos">
      <div className="secao-cabeca">
        <h3>Seus próximos horários</h3>
        <Link to="/cliente/meus-agendamentos" className="link-ver">Ver todos</Link>
      </div>
      <div className="proximos-lista">
        {lista.map((a) => {
          const Icone = a.status === 'confirmado' ? CalendarCheck : Hourglass
          return (
            <Link key={a.id} to={`/cliente/agendamento/${a.id}`} className={'proximo ' + a.status}>
              <span className="proximo-dia"><strong>{diaCurto(a.date)}</strong><span>{a.start_time.slice(0, 5)}</span></span>
              <span className="proximo-texto">
                <strong>{a.services?.name}</strong>
                <span className="muted">{a.professionals?.name}{a.status === 'pendente' ? ' · aguardando confirmação' : ''}</span>
              </span>
              <span className="proximo-estado"><Icone size={16} /><ChevronRight size={16} /></span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

function aindaVem(a) {
  return new Date(`${a.date}T${a.end_time || a.start_time}`) > new Date()
}

function diaCurto(iso) {
  const d = new Date(iso + 'T12:00:00')
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0)
  const dif = Math.round((d - hoje) / 86400e3)
  if (dif === 0) return 'Hoje'
  if (dif === 1) return 'Amanhã'
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '')
}
