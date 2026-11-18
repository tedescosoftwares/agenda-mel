import { useSearchParams } from 'react-router-dom'
import { Bot, CalendarCheck, MessagesSquare } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import { useAuth } from '../../context/AuthContext'
import RegraDeAceite from '../../components/RegraDeAceite'
import MensagensDoSalao from '../../components/MensagensDoSalao'
import AdminAssistente from './AdminAssistente'
import '../../assistente.css'

// 3.96: a área WhatsApp do salão, tudo num lugar só, em três abas:
//   Assistente          o WhatsApp do salão, ligar/desligar, o jeito dela, o que pode fazer, quando responde, o teste
//   Pedidos de horário  quem confirma o horário marcado pelo app ou pelo WhatsApp (a mesma regra de Ajustes)
//   Mensagens           o que saiu e o que chegou, em palavras da dona
// O diagnóstico técnico (canal, relógio, fila crua, o que a IA leu) saiu daqui: está na Plataforma, na página do
// salão. A aba vem de ?aba= (os links de dentro trocam a aba); ?inicio=1 (fim da configuração) vai junto.
const ABAS = [
  { id: 'assistente', rotulo: 'Assistente', Icone: Bot },
  { id: 'pedidos', rotulo: 'Pedidos de horário', Icone: CalendarCheck },
  { id: 'mensagens', rotulo: 'Mensagens', Icone: MessagesSquare },
]

export default function AdminWhatsapp() {
  const { salao } = useAuth()
  const [params, setParams] = useSearchParams()
  const aba = ABAS.some((a) => a.id === params.get('aba')) ? params.get('aba') : 'assistente'
  const irPara = (id) => setParams((p) => { const n = new URLSearchParams(p); n.set('aba', id); n.delete('inicio'); return n })

  return (
    <AdminShell amplo>
      <div className="page-head">
        <div>
          <h2>WhatsApp</h2>
          <p className="muted">A assistente que responde as suas clientes, quem confirma os horários e o que saiu e chegou pelo WhatsApp do salão.</p>
        </div>
      </div>

      <div className="abas wa-area-abas" role="tablist" aria-label="WhatsApp">
        {ABAS.map(({ id, rotulo, Icone }) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} className={'aba' + (aba === id ? ' active' : '')} onClick={() => irPara(id)}>
            <Icone size={15} /> <span>{rotulo}</span>
          </button>
        ))}
      </div>

      {aba === 'assistente' && <AdminAssistente embutido onAbrirPedidos={() => irPara('pedidos')} onAbrirMensagens={() => irPara('mensagens')} />}
      {aba === 'pedidos' && salao?.id && (
        <section className="card as-secao wa-pedidos">
          <h3><CalendarCheck size={18} /> Quem confirma o horário marcado</h3>
          <p className="as-texto">Vale para o que a cliente marca pelo app e para o que a assistente marca no WhatsApp. Com "Entra confirmado na hora", ela diz à cliente que está confirmado; nos outros, que o pedido foi anotado e que o salão confirma em breve.</p>
          <RegraDeAceite salaoId={salao.id} />
        </section>
      )}
      {aba === 'mensagens' && salao?.id && <MensagensDoSalao salaoId={salao.id} />}
    </AdminShell>
  )
}
