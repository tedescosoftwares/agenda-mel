import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, BookOpen, PauseCircle, Check, CalendarClock, Wrench, Heart } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { planoDoNegocio, precoPara, reais, PLANOS } from '../../lib/planos'
import { LINHA_DO_TESTE, LINK_ASSINAR, REGRAS, dataCurta } from '../../lib/acesso'

// Plano e assinatura (126): em que pé o acesso está, quanto custa, e como
// o teste grátis funciona. A tela de pagamento em si é a parte 2.
export default function AdminAssinatura() {
  const { salao, acesso } = useAuth()
  const [agendas, setAgendas] = useState(null)
  useEffect(() => {
    if (!salao?.id) return
    supabase.rpc('primeiros_passos', { salao: salao.id }).then(({ data }) => setAgendas(Number(data?.equipe ?? 0) || null))
  }, [salao?.id])
  const autonoma = salao?.tipo === 'autonoma'
  const n = Math.max(1, agendas ?? (Number(salao?.equipe_prevista) || 1))
  const plano = planoDoNegocio(salao?.tipo, n)
  const fase = acesso?.fase
  const situacao = autonoma ? { Icone: Heart, tom: 'calmo', titulo: 'Sua agenda é grátis', texto: 'Autônoma não paga mensalidade. Se um dia virar salão com equipe, o plano MIMO Pro entra aí.' }
    : fase === 'configurando' ? { Icone: Wrench, tom: 'calmo', titulo: 'Ainda montando o salão', texto: `Nada está sendo cobrado. Seus ${REGRAS.testeDias} dias grátis começam quando você ativar o link e o QR Code em Configurar.` }
    : fase === 'teste' ? { Icone: Sparkles, tom: 'calmo', titulo: `Teste grátis: ${acesso.dias <= 1 ? 'acaba hoje' : `faltam ${acesso.dias} dias`}`, texto: `Tudo liberado até ${dataCurta(acesso.ate)}, sem cartão. Depois disso o link para de receber agendamento novo até você assinar.` }
    : fase === 'ativa' ? { Icone: Check, tom: 'calmo', titulo: 'Assinatura em dia', texto: acesso.sem_prazo ? 'Sem prazo pra vencer. Qualquer coisa, fale com a gente.' : `Válida até ${dataCurta(acesso.ate)}.` }
    : fase === 'leitura' ? { Icone: BookOpen, tom: 'alerta', titulo: 'Modo leitura', texto: `${acesso.teste ? 'O teste grátis acabou' : 'A assinatura venceu'} em ${dataCurta(acesso.ate)}. Os horários marcados continuam valendo, mas o link não recebe agendamento novo. Assine até ${dataCurta(acesso.tolerancia_ate)} pra não pausar o painel.` }
    : fase === 'bloqueado' ? { Icone: PauseCircle, tom: 'alerta', titulo: 'Painel pausado', texto: 'Passou o prazo pra assinar. Nada foi apagado: assinou, voltou tudo na hora.' }
    : null
  return (
    <AdminShell>
      <div className="page-head"><div><h2>Plano e assinatura</h2><p className="muted">Quanto custa, quando cobra, e como funciona o teste grátis.</p></div></div>

      {situacao && (
        <div className={`card assin-situacao ${situacao.tom}`}>
          <span className="assin-icone"><situacao.Icone size={20} /></span>
          <div><strong>{situacao.titulo}</strong><span className="muted">{situacao.texto}</span></div>
          {!autonoma && fase !== 'ativa' && <a className="btn btn-primary" href={LINK_ASSINAR}>{fase === 'configurando' ? 'Falar com a MIMO' : 'Assinar a MIMO'}</a>}
        </div>
      )}

      {!autonoma && (
        <div className="card assin-plano">
          <div className="assin-plano-topo">
            <div>
              <small className="assin-rotulo">Seu plano</small>
              <strong className="assin-nome">{plano.nome}</strong>
              <span className="muted">{n} {n === 1 ? 'agenda ativa' : 'agendas ativas'} · {plano.extras === 0 ? 'dentro das inclusas' : `${plano.extras} ${plano.extras === 1 ? 'extra' : 'extras'} de ${reais(plano.valorExtra)}`}</span>
            </div>
            <b className="assin-preco">{reais(plano.total)}<small> /mês</small></b>
          </div>
          <ul className="assin-lista">
            <li><Check size={13} /> {reais(plano.base)} com {plano.plano === 'pro' ? PLANOS.pro.inclusas : PLANOS.promais.inclusas} agendas inclusas; cada agenda a mais, {reais(plano.valorExtra)}</li>
            <li><Check size={13} /> O valor acompanha as agendas ativas: tirou uma profissional, o plano cai junto</li>
            <li><Check size={13} /> Sem fidelidade, sem multa: cancela quando quiser e usa até o fim do período pago</li>
            <li><Check size={13} /> Clientes, histórico e cadastro ficam guardados mesmo com o painel pausado</li>
          </ul>
          <div className="assin-planos">
            <div className={'assin-opcao' + (plano.plano === 'pro' ? ' ativa' : '')}><strong>MIMO Pro</strong><span>até {PLANOS.pro.ate} agendas</span><em>{reais(PLANOS.pro.base)} com {PLANOS.pro.inclusas} inclusas · {reais(PLANOS.pro.extra)} por extra</em></div>
            <div className={'assin-opcao' + (plano.plano === 'promais' ? ' ativa' : '')}><strong>MIMO Pro+</strong><span>{PLANOS.pro.ate + 1} agendas ou mais</span><em>{reais(PLANOS.promais.base)} com {PLANOS.promais.inclusas} inclusas · {reais(PLANOS.promais.extra)} por extra</em></div>
          </div>
          <p className="muted assin-nota">Exemplo: com {PLANOS.pro.ate} agendas o MIMO Pro fica em {reais(precoPara(PLANOS.pro.ate).total)}; a partir da {PLANOS.pro.ate + 1}ª agenda o Pro+ passa a valer mais a pena.</p>
        </div>
      )}

      {!autonoma && (
        <div className="card">
          <h3 className="secao-titulo"><CalendarClock size={16} /> Como funciona o teste grátis</h3>
          <ol className="ativar-linha">
            {LINHA_DO_TESTE.map((e) => (
              <li key={e.quando}><span className="ativar-quando">{e.quando}</span><div><strong>{e.titulo}</strong><small className="muted">{e.texto}</small></div></li>
            ))}
          </ol>
          <p className="muted assin-nota">Quem conclui o cadastro e fica {REGRAS.prazoAtivacaoDias} dias sem ativar tem o teste começando sozinho, com aviso.</p>
        </div>
      )}

      <div className="card">
        <h3 className="secao-titulo">Formas de pagar</h3>
        <p className="muted">Em breve direto por aqui: cartão, Pix Automático ou Pix avulso a cada mês. Até lá, a gente acerta com você pelo e-mail ou WhatsApp e libera na hora.</p>
        <div className="assin-acoes">
          <a className="btn btn-primary" href={LINK_ASSINAR}>Falar com a MIMO</a>
          {fase === 'configurando' && <Link to="/admin/configurar" className="btn btn-ghost">Ir pra configuração</Link>}
        </div>
      </div>
    </AdminShell>
  )
}
