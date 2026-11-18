import { useEffect, useState } from 'react'
import { Send, Inbox } from 'lucide-react'
import { supabase } from '../lib/supabase'

// 3.96: a aba Mensagens da área WhatsApp do salão. O que saiu (lembretes, confirmações, respostas da assistente) e o
// que chegou das clientes, com o que aconteceu, em palavras da dona. O lado técnico (canal, relógio, a fila crua, o
// que a IA leu) ficou na Plataforma.

const TIPO = {
  lembrete_agendamento: 'Lembrete do horário',
  agendamento_confirmado: 'Horário confirmado',
  agendamento_cancelado: 'Horário cancelado',
  novo_agendamento: 'Novo horário',
  cancelou_comigo: 'Cancelamento',
  convite_retorno: 'Convite para voltar',
  pos_atendimento: 'Depois do atendimento',
  vaga_disponivel: 'Abriu uma vaga',
  agenda_adiantada: 'Convite para adiantar',
  agente: 'Resposta da assistente',
  atendimento_humano: 'Cliente quer falar com a equipe',
}
const STATUS = {
  na_fila: { t: 'esperando para sair', c: 'espera' },
  enviando: { t: 'saindo', c: 'espera' },
  enviado: { t: 'enviada', c: 'ok' },
  entregue: { t: 'entregue', c: 'ok' },
  lido: { t: 'lida', c: 'ok' },
  falhou: { t: 'não saiu', c: 'ruim' },
  cancelado: { t: 'cancelada', c: 'neutro' },
}
function oQueAconteceu(acao) {
  const a = String(acao ?? '')
  if (a === 'confirmado') return 'confirmou o horário'
  if (a === 'cancelado') return 'cancelou o horário'
  if (a === 'remarcado') return 'pediu para remarcar'
  if (a === 'sair') return 'pediu para não receber mais'
  if (a === 'assistente_desligada') return 'ficou para a equipe (assistente desligada)'
  if (a === 'conversa_encerrada') return 'conversa encerrada pela assistente'
  if (a === 'quer_agendar') return 'quis marcar um horário'
  if (a.startsWith('aceite')) return 'resposta da profissional a um pedido'
  if (a.startsWith('bot')) return 'conversa para marcar'
  return 'conversa com a assistente'
}
function quando(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const mesmoDia = d.toDateString() === new Date().toDateString()
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return mesmoDia ? `hoje, ${hora}` : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ', ' + hora
}

export default function MensagensDoSalao({ salaoId }) {
  const [enviadas, setEnviadas] = useState(null)
  const [recebidas, setRecebidas] = useState(null)
  const [aberta, setAberta] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!salaoId) return
    let vivo = true
    Promise.all([
      supabase.rpc('fila_do_salao', { salao: salaoId, quantas: 40 }),
      supabase.rpc('leituras_recentes', { salao: salaoId, quantas: 40 }),
    ]).then(([f, l]) => {
      if (!vivo) return
      if (f.error || l.error) setErro((f.error ?? l.error).message)
      setEnviadas(f.data ?? [])
      setRecebidas(l.data ?? [])
    })
    return () => { vivo = false }
  }, [salaoId])

  return (
    <div className="ms-grade">
      {erro && <div className="alert alert-error">{erro}</div>}
      <section className="card ms-secao">
        <h3><Send size={17} /> O que saiu</h3>
        <p className="muted ms-sub">Lembretes, confirmações e respostas da assistente. Toque para ver o texto.</p>
        {enviadas == null ? <p className="muted">Carregando…</p> : enviadas.length === 0 ? <p className="muted">Nada saiu ainda.</p> : (
          <ul className="ms-lista">
            {enviadas.map((m) => {
              const st = STATUS[m.status] ?? { t: m.status, c: 'neutro' }
              return (
                <li key={m.id}>
                  <button type="button" className="ms-item" onClick={() => setAberta(aberta === m.id ? null : m.id)} aria-expanded={aberta === m.id}>
                    <span className="ms-item-topo"><strong>{TIPO[m.tipo] ?? 'Mensagem'}</strong><span className={'ms-status ' + st.c}>{st.t}</span></span>
                    <span className="ms-item-meta">{[m.para !== 'sem nome' ? m.para : m.telefone, quando(m.quando)].filter(Boolean).join(' · ')}</span>
                  </button>
                  {aberta === m.id && <pre className="ms-corpo">{m.corpo}</pre>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="card ms-secao">
        <h3><Inbox size={17} /> O que chegou</h3>
        <p className="muted ms-sub">O que as clientes escreveram e o que aconteceu com cada mensagem.</p>
        {recebidas == null ? <p className="muted">Carregando…</p> : recebidas.length === 0 ? <p className="muted">Nada chegou ainda.</p> : (
          <ul className="ms-lista">
            {recebidas.map((l, i) => (
              <li key={i} className="ms-recebida">
                <span className="ms-texto">“{l.texto || '(sem texto)'}”</span>
                <span className="ms-item-meta">{[l.telefone, quando(l.quando), oQueAconteceu(l.entendeu)].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
