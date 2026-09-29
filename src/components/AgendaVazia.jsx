import { Link } from 'react-router-dom'
import { Check, Circle, Scissors, Users, BookOpen, CalendarDays, ArrowRight } from 'lucide-react'

// A agenda antes de existir agenda: sem serviço ou sem profissional
// configurada não há o que marcar. Em vez de uma agenda em branco, o
// caminho, com o que já está feito e um atalho pro Guia em cada dúvida.
// `r` é o que primeiros_passos devolve (servicos, equipe, tipo).
export default function AgendaVazia({ r, para = 'admin' }) {
  const autonoma = r?.tipo === 'autonoma'
  const servicos = Number(r?.servicos ?? 0)
  const equipe = Number(r?.equipe ?? 0)
  const base = para === 'admin' ? '/admin' : '/pro'
  const passos = [
    {
      chave: 'servicos', ok: servicos > 0, Icone: Scissors,
      titulo: servicos > 0 ? `${servicos} ${servicos === 1 ? 'serviço cadastrado' : 'serviços cadastrados'}` : 'Cadastre os serviços',
      texto: 'Nome, duração e preço. É o que a cliente escolhe antes do horário.',
      acao: { to: `${base}/servicos`, rotulo: servicos > 0 ? 'Ver serviços' : 'Cadastrar serviço' },
      guia: { to: `${base}/guia?guia=servico`, rotulo: 'Como cadastrar um serviço' },
    },
    ...(!autonoma ? [{
      chave: 'equipe', ok: equipe > 0, Icone: Users,
      titulo: equipe > 0 ? `${equipe} ${equipe === 1 ? 'profissional configurada' : 'profissionais configuradas'}` : 'Monte a equipe',
      texto: 'Cada profissional com os serviços que faz e os dias que atende. Ela recebe o acesso por e-mail.',
      acao: { to: `${base}/equipe`, rotulo: equipe > 0 ? 'Ver equipe' : 'Adicionar profissional' },
      guia: { to: `${base}/guia?guia=profissional`, rotulo: 'Como adicionar uma profissional' },
    }] : []),
  ]
  const falta = passos.filter((p) => !p.ok)
  return (
    <div className="card agv">
      <div className="agv-topo">
        <span className="agv-icone"><CalendarDays size={22} /></span>
        <div>
          <strong>Sua agenda ainda está vazia, e é normal</strong>
          <span className="muted">
            {falta.length === passos.length
              ? (autonoma ? 'Antes de receber horários, cadastre os serviços que você faz.' : 'Antes de receber horários, cadastre os serviços e configure quem atende. Leva poucos minutos.')
              : `Falta só ${falta[0]?.titulo.toLowerCase()}. Depois disso os horários das clientes aparecem aqui.`}
          </span>
        </div>
      </div>
      <ol className="agv-passos">
        {passos.map((p, i) => (
          <li key={p.chave} className={p.ok ? 'ok' : ''}>
            <span className="agv-num">{p.ok ? <Check size={14} /> : i + 1}</span>
            <span className="agv-passo-icone"><p.Icone size={18} /></span>
            <div className="agv-passo-texto">
              <strong>{p.titulo}</strong>
              <small className="muted">{p.texto}</small>
              <span className="agv-passo-acoes">
                <Link to={p.acao.to} className={'btn ' + (p.ok ? 'btn-ghost' : 'btn-primary')}>{p.acao.rotulo} <ArrowRight size={13} /></Link>
                <Link to={p.guia.to} className="agv-guia"><BookOpen size={13} /> {p.guia.rotulo}</Link>
              </span>
            </div>
            {p.ok ? <Check size={16} className="agv-check" /> : <Circle size={16} className="agv-check apagado" />}
          </li>
        ))}
      </ol>
      <p className="muted agv-rodape">Dúvida em qualquer passo? O <Link to={`${base}/guia`}>Guia MIMO</Link> tem vídeos curtos de cada tela, gravados dentro do painel.</p>
    </div>
  )
}
