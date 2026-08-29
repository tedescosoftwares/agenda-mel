import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { toISODate } from '../lib/format'

const JANELAS = [
  { chave: 'qualquer', texto: 'Qualquer horário', de: '00:00', ate: '23:59' },
  { chave: 'manha', texto: 'De manhã', de: '06:00', ate: '12:00' },
  { chave: 'tarde', texto: 'À tarde', de: '12:00', ate: '18:00' },
  { chave: 'noite', texto: 'À noite', de: '18:00', ate: '23:59' },
]

const PERIODOS = [
  { chave: 7, texto: 'Nos próximos 7 dias' },
  { chave: 15, texto: 'Nos próximos 15 dias' },
  { chave: 30, texto: 'Nos próximos 30 dias' },
]

// "Não achei o horário que eu queria" — entra na fila daquela faixa.
export default function ListaEsperaForm({ profissional, servico, diaSugerido, onPronto, onPrecisaLogin }) {
  const [janela, setJanela] = useState('qualquer')
  const [dias, setDias] = useState(15)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)

  async function entrar() {
    const { data: sessao } = await supabase.auth.getSession()
    if (!sessao?.session) {
      onPrecisaLogin?.()
      return
    }

    setEnviando(true)
    setError('')

    const hoje = new Date()
    const inicio = diaSugerido ? new Date(diaSugerido + 'T12:00:00') : hoje
    const fim = new Date(inicio)
    fim.setDate(inicio.getDate() + dias)
    const faixa = JANELAS.find((j) => j.chave === janela)

    const { error } = await supabase.rpc('entrar_lista_espera', {
      prof: profissional.id,
      servico: servico.id,
      dia_de: toISODate(inicio < hoje ? hoje : inicio),
      dia_ate: toISODate(fim),
      hora_de: faixa.de,
      hora_ate: faixa.ate,
    })
    setEnviando(false)

    if (error) {
      setError(error.message)
      return
    }
    setOk(true)
    onPronto?.()
  }

  if (ok) {
    return (
      <div className="card espera-card">
        <span className="convite-selo">✅ Você está na fila</span>
        <p className="convite-texto">
          Assim que abrir uma vaga de <strong>{servico.name}</strong> com{' '}
          {profissional.name} nessa faixa, você recebe um aviso no app.
        </p>
      </div>
    )
  }

  return (
    <div className="card espera-card">
      <span className="convite-selo">🔔 Avise-me</span>
      <p className="convite-texto">
        Não achou o horário que queria? Entre na fila — quando alguém desmarcar,
        avisamos você antes de liberar para o resto.
      </p>

      <div className="espera-campo">
        <span className="img-field-label">Que horário te serve</span>
        <div className="prazo-opcoes">
          {JANELAS.map((j) => (
            <button
              key={j.chave}
              type="button"
              className={janela === j.chave ? 'chip active' : 'chip'}
              onClick={() => setJanela(j.chave)}
            >
              {j.texto}
            </button>
          ))}
        </div>
      </div>

      <div className="espera-campo">
        <span className="img-field-label">Até quando você espera</span>
        <div className="prazo-opcoes">
          {PERIODOS.map((p) => (
            <button
              key={p.chave}
              type="button"
              className={dias === p.chave ? 'chip active' : 'chip'}
              onClick={() => setDias(p.chave)}
            >
              {p.texto}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <button className="btn btn-primary btn-block" onClick={entrar} disabled={enviando}>
        {enviando ? 'Entrando na fila…' : 'Quero ser avisada'}
      </button>
    </div>
  )
}
