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

const RÓTULO_ACAO = {
  confirmado: 'confirmou',
  cancelado: 'cancelou',
  remarcado: 'quer remarcar',
  quer_agendar: 'quer marcar',
  sair: 'pediu para sair',
  fora_de_contexto: 'fora de contexto',
  sem_horario: 'sem horário marcado',
  sem_cadastro: 'número desconhecido',
  nada: 'não entendi',
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
  const [leituras, setLeituras] = useState([])
  const [usaIa, setUsaIa] = useState(false)
  const [usaBot, setUsaBot] = useState(false)
  const [mudando, setMudando] = useState('')
  const [aberta, setAberta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  const salaoId = salao?.id

  const buscar = useCallback(async () => {
    if (!salaoId) return
    setLoading(true)
    const [diag, msgs, lidas, canal] = await Promise.all([
      supabase.rpc('diagnostico_whatsapp', { salao: salaoId }),
      supabase.rpc('fila_do_salao', { salao: salaoId, quantas: 30 }),
      supabase.rpc('leituras_recentes', { salao: salaoId, quantas: 20 }),
      supabase.from('whatsapp_channels').select('usa_ia, usa_bot').eq('salon_id', salaoId).maybeSingle(),
    ])
    const falhou = diag.error || msgs.error || lidas.error
    if (falhou) {
      setErro('Erro ao carregar: ' + falhou.message)
    } else {
      setChecagens(diag.data ?? [])
      setFila(msgs.data ?? [])
      setLeituras(lidas.data ?? [])
      setUsaIa(Boolean(canal.data?.usa_ia))
      setUsaBot(Boolean(canal.data?.usa_bot))
      setErro('')
    }
    setLoading(false)
  }, [salaoId])

  useEffect(() => {
    buscar()
  }, [buscar])

  async function alternar(qual) {
    setMudando(qual)
    const { error } =
      qual === 'ia'
        ? await supabase.rpc('ligar_ia', { salao: salaoId, ligada: !usaIa })
        : await supabase.rpc('ligar_bot', { salao: salaoId, ligado: !usaBot })
    if (error) setErro(error.message)
    else await buscar()
    setMudando('')
  }

  const problemas = checagens.filter((c) => c.situacao !== 'ok').length
  const pelaIa = leituras.filter((l) => l.via === 'ia').length

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

      <div className="wa-ia">
        <div className="wa-ia-topo">
          <div>
            <strong>Entender texto solto</strong>
            <span className="wa-check-detalhe">
              As regras exatas ("1", "sim", "cancelar") funcionam sempre e são de
              graça. Isto liga a leitura do que elas não previram — "pode deixar
              que eu vou", "não vou conseguir dessa vez".
            </span>
          </div>
          <button
            className={'wa-chave' + (usaIa ? ' wa-chave-on' : '')}
            onClick={() => alternar('ia')}
            disabled={mudando === 'ia'}
            aria-pressed={usaIa}
          >
            {usaIa ? 'ligada' : 'desligada'}
          </button>
        </div>
        {usaIa && (
          <p className="wa-check-detalhe" style={{ marginTop: '.6rem' }}>
            A IA nunca decide sozinha: ela só traduz a mensagem para uma das
            respostas que o sistema já conhece. Quando a regra e a IA discordam,
            a regra ganha.
          </p>
        )}
      </div>

      <div className="wa-ia">
        <div className="wa-ia-topo">
          <div>
            <strong>Marcar pela conversa</strong>
            <span className="wa-check-detalhe">
              Quando a cliente pede horário, o bot pergunta serviço, profissional,
              dia e hora — uma coisa de cada vez, sempre com opções numeradas — e
              deixa marcado. Só para quem já é cliente; quem não é recebe o link.
            </span>
          </div>
          <button
            className={'wa-chave' + (usaBot ? ' wa-chave-on' : '')}
            onClick={() => alternar('bot')}
            disabled={mudando === 'bot' || !usaIa}
            aria-pressed={usaBot}
          >
            {usaBot ? 'ligado' : 'desligado'}
          </button>
        </div>
        {!usaIa && (
          <p className="wa-check-detalhe" style={{ marginTop: '.6rem' }}>
            Ligue primeiro "Entender texto solto" — é ela que reconhece que a
            cliente quer marcar.
          </p>
        )}
      </div>

      {leituras.length > 0 && (
        <>
          <div className="page-head" style={{ marginTop: '2rem' }}>
            <h3>O que chegou</h3>
            <p className="muted">
              {pelaIa === 0
                ? 'Todas entendidas pelas regras, sem gastar IA.'
                : `${pelaIa} de ${leituras.length} precisaram da IA.`}
            </p>
          </div>
          <ul className="wa-fila">
            {leituras.map((l, i) => (
              <li key={i} className="wa-lida">
                <span className={'wa-via wa-via-' + l.via}>{l.via}</span>
                <span className="wa-lida-texto">{l.texto || '(sem texto)'}</span>
                <span className="wa-lida-seta" aria-hidden="true">→</span>
                <span className="wa-lida-acao">
                  {RÓTULO_ACAO[l.entendeu] ?? l.entendeu}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

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
