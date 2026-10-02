import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BookOpen, Search, PlayCircle, Clock3, ChevronRight, Sparkles, CalendarDays, Users, Scissors, QrCode, MessageCircle, CreditCard, Settings2 } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import { MEL_PADRAO } from '../../lib/mel'

const GUIAS = [
  { id:'visao-geral', titulo:'Conheça o painel da MIMO', categoria:'Comece por aqui', duracao:'1:20', descricao:'Entenda onde ficam agenda, clientes, equipe, serviços e configurações.', Icon:Sparkles, destaque:true, passos:['Veja a visão geral do painel','Entenda os atalhos principais','Saiba onde continuar a configuração'] },
  { id:'agenda-dia', titulo:'Como usar a agenda no dia a dia', categoria:'Agenda', duracao:'1:45', descricao:'Veja horários, pedidos, encaixes e o que precisa de atenção.', Icon:CalendarDays, passos:['Abra a agenda','Escolha o dia','Acompanhe pedidos e horários'] },
  { id:'encaixe', titulo:'Como fazer um encaixe', categoria:'Agenda', duracao:'0:55', descricao:'Adicione um atendimento manualmente sem bagunçar a agenda.', Icon:CalendarDays, passos:['Abra Novo encaixe','Escolha profissional e serviço','Confirme o horário'] },
  { id:'servico', titulo:'Como cadastrar um serviço', categoria:'Serviços', duracao:'1:10', descricao:'Cadastre nome, duração, preço e deixe o serviço pronto para agendamento.', Icon:Scissors, passos:['Abra Serviços','Crie o serviço','Defina duração e preço'] },
  { id:'profissional', titulo:'Como adicionar uma profissional', categoria:'Equipe', duracao:'1:30', descricao:'Monte a equipe, configure a agenda e envie o acesso.', Icon:Users, passos:['Abra Equipe','Adicione a profissional','Revise e envie o convite'] },
  { id:'link-qr', titulo:'Como usar seu link e QR Code', categoria:'Link e QR', duracao:'1:05', descricao:'Aprenda a compartilhar sua agenda no balcão, Instagram e WhatsApp.', Icon:QrCode, passos:['Finalize a configuração','Copie o link','Baixe o QR Code'] },
  { id:'whatsapp', titulo:'Como funciona o WhatsApp na MIMO', categoria:'WhatsApp', duracao:'1:25', descricao:'Entenda avisos, mensagens e onde ficam as automações.', Icon:MessageCircle, passos:['Abra WhatsApp','Veja os tipos de mensagem','Configure o que fizer sentido'] },
  { id:'pagamentos', titulo:'Pagamentos, sinal e recebimentos', categoria:'Pagamentos', duracao:'2:00', descricao:'Visão geral de quando usar sinal e como funciona receber pelo app.', Icon:CreditCard, passos:['Entenda o sinal','Veja quando ativar','Configure recebimentos'] },
  { id:'ajustes', titulo:'Horários e configurações do salão', categoria:'Configurações', duracao:'1:35', descricao:'Altere horários, dados do salão e preferências depois do onboarding.', Icon:Settings2, passos:['Abra Ajustes','Escolha a seção','Salve suas alterações'] },
]

const CATEGORIAS = ['Todos','Comece por aqui','Agenda','Serviços','Equipe','Link e QR','WhatsApp','Pagamentos','Configurações']

export default function AdminGuia() {
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('Todos')
  // /admin/guia?guia=servico abre direto aquele tutorial (a agenda vazia manda pra cá)
  const [busca_] = useSearchParams()
  const [aberto, setAberto] = useState(() => GUIAS.find((g) => g.id === busca_.get('guia')) ?? null)

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return GUIAS.filter((g) => (categoria === 'Todos' || g.categoria === categoria) && (!q || [g.titulo,g.categoria,g.descricao,...g.passos].join(' ').toLowerCase().includes(q)))
  }, [busca,categoria])

  const destaque = GUIAS.find((g) => g.destaque)

  return (
    <AdminShell amplo>
      <div className="guia-mimo">
        <section className="guia-hero">
          <div>
            <span className="guia-selo"><BookOpen size={13}/> Guia MIMO</span>
            <h1>Aprenda quando precisar.<br/><strong>Sem depender de ninguém.</strong></h1>
            <p>Vídeos rápidos, gravados dentro da própria MIMO, para você resolver uma dúvida e voltar ao trabalho.</p>
          </div>
          <div className="guia-lado">
            <div className="guia-mel">
              <span className="guia-mel-balao">Oi! Me diz o que você quer fazer que eu acho o guia. 💗</span>
              <img src={MEL_PADRAO} alt="Mel, assistente da MIMO" />
            </div>
            <div className="guia-busca">
              <Search size={18}/>
              <input value={busca} onChange={(e)=>setBusca(e.target.value)} placeholder="O que você quer aprender?" />
            </div>
          </div>
        </section>

        {destaque && !busca && categoria === 'Todos' && (
          <button type="button" className="guia-destaque" onClick={()=>setAberto(destaque)}>
            <span className="guia-destaque-play"><PlayCircle size={28}/></span>
            <span><em>Comece por aqui</em><strong>{destaque.titulo}</strong><small>{destaque.descricao}</small></span>
            <span className="guia-duracao"><Clock3 size={13}/>{destaque.duracao}</span>
          </button>
        )}

        <div className="guia-categorias">
          {CATEGORIAS.map((c)=><button key={c} type="button" className={categoria===c?'ativa':''} onClick={()=>setCategoria(c)}>{c}</button>)}
        </div>

        <div className="guia-topo-lista">
          <div><span>Biblioteca</span><h2>{categoria === 'Todos' ? 'Todos os guias' : categoria}</h2></div>
          <small>{filtrados.length} {filtrados.length === 1 ? 'guia' : 'guias'}</small>
        </div>

        <div className="guia-grid">
          {filtrados.map((g)=>(
            <button key={g.id} type="button" className="guia-card" onClick={()=>setAberto(g)}>
              <span className="guia-card-icone"><g.Icon size={19}/><i><PlayCircle size={13}/></i></span>
              <span className="guia-card-conteudo"><em>{g.categoria}</em><strong>{g.titulo}</strong><small>{g.descricao}</small></span>
              <span className="guia-card-rodape"><span><Clock3 size={12}/>{g.duracao}</span><span>Assistir <ChevronRight size={13}/></span></span>
            </button>
          ))}
          {filtrados.length === 0 && <div className="guia-vazio"><Search size={22}/><strong>Nada com esse nome.</strong><span>Tente procurar por “agenda”, “profissional”, “QR” ou outra tarefa.</span></div>}
        </div>

        <section className="guia-ajuda card">
          <div><span className="guia-card-icone pequeno"><MessageCircle size={18}/></span><span><strong>Não achou o que precisava?</strong><small>Essa biblioteca vai crescer junto com a MIMO. Enquanto isso, use a busca ou volte para o painel.</small></span></div>
          <Link to="/admin" className="btn btn-ghost">Voltar ao painel</Link>
        </section>

        {aberto && <GuiaModal guia={aberto} fechar={()=>setAberto(null)} />}
      </div>
    </AdminShell>
  )
}

function GuiaModal({ guia, fechar }) {
  return (
    <div className="guia-modal-fundo" onClick={fechar}>
      <div className="guia-modal" onClick={(e)=>e.stopPropagation()}>
        <button type="button" className="guia-modal-fechar" onClick={fechar}>×</button>
        <div className="guia-video-placeholder">
          <span><PlayCircle size={42}/></span>
          <strong>Vídeo em produção</strong>
          <small>Aqui entra a gravação de tela narrada pela voz da MIMO.</small>
        </div>
        <div className="guia-modal-conteudo">
          <span className="guia-selo">{guia.categoria}</span>
          <h2>{guia.titulo}</h2>
          <p>{guia.descricao}</p>
          <div className="guia-modal-meta"><Clock3 size={13}/> {guia.duracao}</div>
          <div className="guia-passos">
            <strong>Em poucos passos</strong>
            <ol>{guia.passos.map((p)=><li key={p}>{p}</li>)}</ol>
          </div>
        </div>
      </div>
    </div>
  )
}
