import { useEffect, useState } from 'react'
import { Send, Inbox, Bell, CalendarCheck, CalendarX, CalendarPlus, Bot, HandHelping, Heart, RotateCcw, Sparkles, FastForward, MessageCircle, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'

// 3.96: a aba Mensagens da área WhatsApp do salão. O que saiu (lembretes, confirmações, respostas da assistente) e o
// que chegou das clientes, com o que aconteceu, em palavras da dona. O lado técnico (canal, relógio, a fila crua, o
// que a IA leu) ficou na Plataforma.
// 3.96.1: cada tipo com o seu ícone, a situação numa etiqueta à direita, o texto que saiu e o que chegou em balão
// (como no WhatsApp) e listas vazias que explicam o que vai aparecer ali.

const TIPO = {
  lembrete_agendamento: ['Lembrete do horário', Bell],
  agendamento_confirmado: ['Horário confirmado', CalendarCheck],
  agendamento_cancelado: ['Horário cancelado', CalendarX],
  novo_agendamento: ['Novo horário', CalendarPlus],
  cancelou_comigo: ['Cancelamento', CalendarX],
  convite_retorno: ['Convite para voltar', RotateCcw],
  pos_atendimento: ['Depois do atendimento', Heart],
  vaga_disponivel: ['Abriu uma vaga', Sparkles],
  agenda_adiantada: ['Convite para adiantar', FastForward],
  agente: ['Resposta da assistente', Bot],
  atendimento_humano: ['Cliente quer falar com a equipe', HandHelping],
}
const STATUS = {
  na_fila: { t: 'na fila', c: 'espera' },
  enviando: { t: 'saindo', c: 'espera' },
  enviado: { t: 'enviada', c: 'ok' },
  entregue: { t: 'entregue', c: 'ok' },
  lido: { t: 'lida', c: 'ok' },
  falhou: { t: 'não saiu', c: 'ruim' },
  cancelado: { t: 'cancelada', c: 'neutro' },
}
function oQueAconteceu(acao) {
  const a = String(acao ?? '')
  if (a === 'confirmado') return ['confirmou o horário', 'ok']
  if (a === 'cancelado') return ['cancelou o horário', 'ruim']
  if (a === 'remarcado') return ['pediu para remarcar', 'espera']
  if (a === 'sair') return ['pediu para não receber mais', 'neutro']
  if (a === 'assistente_desligada') return ['ficou para a equipe', 'neutro']
  if (a === 'conversa_encerrada') return ['conversa encerrada', 'neutro']
  if (a === 'quer_agendar') return ['quis marcar um horário', 'espera']
  if (a.startsWith('aceite')) return ['resposta da profissional', 'neutro']
  if (a.startsWith('bot')) return ['conversa para marcar', 'espera']
  return ['conversa com a assistente', 'neutro']
}
function quando(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const mesmoDia = d.toDateString() === new Date().toDateString()
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return mesmoDia ? `hoje, ${hora}` : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ', ' + hora
}
// 5513999998888 → (13) 99999-8888
function telefone(t) {
  const n = String(t ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`
  return t ?? ''
}

function Vazio({ Icone, titulo, texto }) {
  return (
    <div className="ms-vazio">
      <span><Icone size={20} /></span>
      <strong>{titulo}</strong>
      <small>{texto}</small>
    </div>
  )
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
      <section className="card asx-secao ms-secao">
        <header className="asx-cab">
          <span className="asx-ico"><Send size={18} /></span>
          <div className="asx-cab-txt"><h3>O que saiu</h3><p>Lembretes, confirmações e respostas da assistente. Toque para ver o texto.</p></div>
        </header>
        {enviadas == null ? <p className="muted ms-carregando">Carregando…</p> : enviadas.length === 0 ? (
          <Vazio Icone={Send} titulo="Nada saiu ainda" texto="Quando um lembrete ou uma confirmação sair pelo WhatsApp do salão, aparece aqui." />
        ) : (
          <ul className="ms-lista">
            {enviadas.map((m) => {
              const st = STATUS[m.status] ?? { t: m.status, c: 'neutro' }
              const [titulo, Icone] = TIPO[m.tipo] ?? ['Mensagem', MessageCircle]
              const aberto = aberta === m.id
              return (
                <li key={m.id} className={aberto ? 'aberta' : ''}>
                  <button type="button" className="ms-item" onClick={() => setAberta(aberto ? null : m.id)} aria-expanded={aberto}>
                    <span className="ms-item-ico"><Icone size={16} /></span>
                    <span className="ms-item-txt">
                      <strong>{titulo}</strong>
                      <small>{[m.para && m.para !== 'sem nome' ? m.para : telefone(m.telefone), quando(m.quando)].filter(Boolean).join(' · ')}</small>
                    </span>
                    <span className={'ms-status ' + st.c}>{st.t}</span>
                    <ChevronDown size={16} className="ms-seta" aria-hidden="true" />
                  </button>
                  {aberto && <div className="ms-corpo"><p>{m.corpo}</p></div>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="card asx-secao ms-secao">
        <header className="asx-cab">
          <span className="asx-ico"><Inbox size={18} /></span>
          <div className="asx-cab-txt"><h3>O que chegou</h3><p>O que as clientes escreveram e o que aconteceu com cada mensagem.</p></div>
        </header>
        {recebidas == null ? <p className="muted ms-carregando">Carregando…</p> : recebidas.length === 0 ? (
          <Vazio Icone={Inbox} titulo="Nada chegou ainda" texto="Quando uma cliente escrever no WhatsApp do salão, a mensagem aparece aqui." />
        ) : (
          <ul className="ms-lista ms-chegou">
            {recebidas.map((l, i) => {
              const [resultado, cor] = oQueAconteceu(l.entendeu)
              return (
                <li key={i} className="ms-recebida">
                  <div className="ms-recebida-topo">
                    <strong>{telefone(l.telefone)}</strong>
                    <small>{quando(l.quando)}</small>
                  </div>
                  <p className="ms-balao">{l.texto || '(sem texto)'}</p>
                  <span className={'ms-status ' + cor}>{resultado}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
