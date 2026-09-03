import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { formatDataCurta } from '../../lib/booking'

// Fila de espera (tela 10): em que lugar você está, o que está sendo
// esperado, e a porta de saída. "Você está na fila" sem posição é
// ansiedade — por isso a posição vem do banco, e não de uma estimativa.
export default function FilaEspera() {
  const [entradas, setEntradas] = useState([])
  const [posicoes, setPosicoes] = useState({})
  const [loading, setLoading] = useState(true)

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('waitlist_entries').select('*, services (name), professionals (name, photo_url)').eq('status', 'aguardando').order('created_at', { ascending: false })
    const lista = data ?? []
    setEntradas(lista)
    const pos = {}
    await Promise.all(lista.map(async (e) => {
      const { data: p } = await supabase.rpc('posicao_na_fila', { entrada_id: e.id })
      pos[e.id] = p?.[0] ?? null
    }))
    setPosicoes(pos)
    setLoading(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function sair(e) {
    if (!window.confirm('Sair da fila?')) return
    await supabase.rpc('sair_lista_espera', { entrada_id: e.id })
    carregar()
  }

  return (
    <ClienteShell titulo="Fila de espera" voltar="/cliente/meus-agendamentos">
      {loading ? (
        <p className="muted">Carregando…</p>
      ) : entradas.length === 0 ? (
        <div className="card empty-state">
          <p>Você não está em nenhuma fila.</p>
          <p className="muted">Quando um horário que você quer estiver cheio, dá para entrar na fila e ser avisada se abrir vaga.</p>
          <Link to="/cliente/home" className="btn btn-primary">Ver profissionais</Link>
        </div>
      ) : (
        entradas.map((e) => {
          const p = posicoes[e.id]
          return (
            <div key={e.id} className="card fila-card">
              <span className="fila-ilustra" aria-hidden="true">🕐</span>
              <h3>Você está na fila!</h3>
              <p className="muted">{e.services?.name} com {e.professionals?.name}</p>
              {p ? (
                <>
                  <div className="fila-posicao">
                    <span className="muted">Sua posição atual</span>
                    <strong>{p.posicao}ª posição</strong>
                    <span className="muted">{p.na_frente === 0 ? 'Você é a próxima' : `${p.na_frente} ${p.na_frente === 1 ? 'pessoa' : 'pessoas'} na sua frente`}</span>
                  </div>
                  <p className="muted fila-previsao">Previsão: {p.previsao}</p>
                </>
              ) : (
                <p className="muted fila-previsao">Entre {e.window_start.slice(0, 5)} e {e.window_end.slice(0, 5)}, até {formatDataCurta(e.date_to)}</p>
              )}
              <Link to="/cliente/meus-agendamentos" className="btn btn-primary btn-block">Ver meus agendamentos</Link>
              <button className="btn-link-cancelar" onClick={() => sair(e)}>Sair da fila</button>
            </div>
          )
        })
      )}
    </ClienteShell>
  )
}
