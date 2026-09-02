import { useCallback, useEffect, useState } from 'react'
import AdminShell from '../../components/AdminShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// A tela que responde "por que a mensagem não chegou".
//
// Existe porque essa pergunta, sem ela, custa cinco consultas em cinco
// tabelas: o canal está ativo? a regra manda? a profissional tem
// telefone no perfil? o salão já bateu o teto de hoje? a mensagem chegou
// a entrar na fila? O banco já sabe responder tudo isso — aqui é só
// mostrar, com a fila do lado para conferir o texto que saiu.

const CORES = {
  ok: 'ok',
  falta: 'ruim',
  desligado: 'ruim',
  parcial: 'atencao',
  atenção: 'atencao',
}

const RÓTULO_TIPO = {
  novo_agendamento: 'marcaram com ela',
  cancelou_comigo: 'cancelaram com ela',
  lembrete_agendamento: 'lembrete',
  agendamento_confirmado: 'confirmação',
  agendamento_cancelado: 'cancelamento',
  convite_retorno: 'chamar de volta',
  pos_atendimento: 'pós-atendimento',
  vaga_disponivel: 'abriu vaga',
  agenda_adiantada: 'adiantar',
}

function quando(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const hoje = new Date()
  const mesmoDia = d.toDateString() === hoje.toDateString()
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return mesmoDia ? hora : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hora
}

export default function AdminWhatsapp() {
  const { salao } = useAuth()
  const [checagens, setChecagens] = useState([])
  const [fila, setFila] = useState([])
  const [aberta, setAberta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  const salaoId = salao?.id

  const buscar = useCallback(async () => {
    if (!salaoId) return
    setLoading(true)
    const [diag, msgs] = await Promise.all([
      supabase.rpc('diagnostico_whatsapp', { salao: salaoId }),
      supabase.rpc('fila_do_salao', { salao: salaoId, quantas: 30 }),
    ])
    if (diag.error || msgs.error) {
      setErro('Erro ao carregar: ' + (diag.error?.message || msgs.error?.message))
    } else {
      setChecagens(diag.data ?? [])
      setFila(msgs.data ?? [])
      setErro('')
    }
    setLoading(false)
  }, [salaoId])

  useEffect(() => {
    buscar()
  }, [buscar])

  const problemas = checagens.filter((c) => c.situacao !== 'ok').length

  return (
    <AdminShell>
      <div className="page-head">
        <h2>WhatsApp</h2>
        <p className="muted">
          {problemas === 0
            ? 'Tudo no lugar para as mensagens saírem.'
            : problemas === 1
              ? '1 coisa fora do lugar — veja abaixo.'
              : `${problemas} coisas fora do lugar — veja abaixo.`}
        </p>
      </div>

      {erro && <p className="erro">{erro}</p>}

      <div className="wa-acoes">
        <button className="btn-mini btn-mini-neutro" onClick={buscar} disabled={loading}>
          {loading ? 'conferindo…' : 'conferir de novo'}
        </button>
      </div>

      <ul className="wa-check">
        {checagens.map((c) => (
          <li key={c.item} className={'wa-check-item ' + (CORES[c.situacao] ?? 'ok')}>
            <span className="wa-check-ponto" aria-hidden="true" />
            <div>
              <strong>{c.item}</strong>
              <span className="wa-check-detalhe">{c.detalhe}</span>
            </div>
            <span className="wa-check-tag">{c.situacao}</span>
          </li>
        ))}
      </ul>

      <div className="page-head" style={{ marginTop: '2rem' }}>
        <h3>Últimas mensagens</h3>
        <p className="muted">
          Toque em uma para ver o texto exato que a pessoa recebe.
        </p>
      </div>

      {!loading && fila.length === 0 && (
        <p className="vazio">
          Nada na fila ainda. Marque um horário pelo app com uma profissional que
          tenha telefone no perfil — a mensagem aparece aqui na hora.
        </p>
      )}

      <ul className="wa-fila">
        {fila.map((m) => (
          <li key={m.id} className="wa-msg">
            <button
              className="wa-msg-topo"
              onClick={() => setAberta(aberta === m.id ? null : m.id)}
              aria-expanded={aberta === m.id}
            >
              <span className={'wa-status wa-' + m.status}>{m.status}</span>
              <span className="wa-msg-tipo">{RÓTULO_TIPO[m.tipo] ?? m.tipo}</span>
              <span className="wa-msg-para">{m.para}</span>
              <span className="wa-msg-quando">{quando(m.quando)}</span>
            </button>
            {aberta === m.id && (
              <div className="wa-msg-corpo">
                <pre>{m.corpo}</pre>
                <a
                  className="btn-mini"
                  href={m.link_wa}
                  target="_blank"
                  rel="noreferrer"
                >
                  abrir no WhatsApp
                </a>
              </div>
            )}
          </li>
        ))}
      </ul>
    </AdminShell>
  )
}
