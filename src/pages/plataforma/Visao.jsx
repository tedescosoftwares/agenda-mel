import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho, Kpi, Painel, Pilula, Vazio, haQuanto } from '../../components/plataforma/Pecas'
import { supabase } from '../../lib/supabase'
import { PredioIcon, UsersIcon, TeamIcon, LinkIcon, ConviteIcon, CalendarIcon, ClockIcon, AlertaIcon, WhatsIcon, MailIcon, ListaIcon, PulsoIcon, SetaIcon } from '../../components/icons'

// Visão geral: os números do MIMO inteiro com variação e tendência, as
// filas de hoje, a atividade recente, a saúde da operação e quem mais
// movimenta. Tudo que aparece aqui é lido do banco; nada é estimado.
export default function Visao() {
  const navigate = useNavigate()
  const [k, setK] = useState(null)
  const [ativ, setAtiv] = useState([])
  const [saloes, setSaloes] = useState([])
  const [relogio, setRelogio] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    supabase.rpc('plataforma_kpis').then(({ data, error }) => { if (error) setErro(error.message); setK(data) })
    supabase.rpc('plataforma_atividade', { quantas: 6 }).then(({ data }) => setAtiv(data ?? []))
    supabase.rpc('plataforma_saloes').then(({ data }) => setSaloes(data ?? []))
    supabase.rpc('relogio_status').then(({ data }) => setRelogio(data))
  }, [])

  const fila = (relogio?.jobs ?? []).find((j) => j.nome === 'mimo-fila')
  const bateu = fila?.ultima ? Date.now() - new Date(fila.ultima).getTime() < 5 * 60 * 1000 && fila.status !== 'failed' : false
  const semVinculo = k?.sem_vinculo?.valor ?? 0
  const top = [...saloes].filter((s) => s.ativo).sort((a, b) => b.atendimentos_mes - a.atendimentos_mes).slice(0, 3)
  const maxMes = Math.max(1, ...top.map((s) => s.atendimentos_mes))

  return (
    <Shell acao={{ rotulo: 'Novo salão', onClick: () => navigate('/plataforma/saloes?novo=1') }}>
      <Cabecalho titulo="O MIMO inteiro" sub="Visão central da plataforma. Acompanhe os principais números, atividades e a saúde da operação em tempo real." />
      {erro && <div className="alert alert-error">{erro}</div>}

      <div className="plat-grade-4">
        <Kpi Icon={PredioIcon} cor="rosa" n={k?.saloes?.valor} anterior={k?.saloes?.anterior} serie={k?.saloes?.serie} rotulo="Salões ativos" />
        <Kpi Icon={TeamIcon} cor="roxo" n={k?.profissionais?.valor} anterior={k?.profissionais?.anterior} serie={k?.profissionais?.serie} rotulo="Profissionais" />
        <Kpi Icon={UsersIcon} cor="rosa" n={k?.clientes?.valor} anterior={k?.clientes?.anterior} serie={k?.clientes?.serie} rotulo="Clientes" />
        <Kpi Icon={LinkIcon} cor="roxo" n={k?.vinculos?.valor} anterior={k?.vinculos?.anterior} serie={k?.vinculos?.serie} rotulo="Vínculos ativos" />
        <Kpi Icon={ConviteIcon} cor="rosa" n={k?.contas_7d?.valor} anterior={k?.contas_7d?.anterior} serie={k?.contas_7d?.serie} rotulo="Contas novas (7 dias)" legenda="vs. período anterior" />
        <Kpi Icon={CalendarIcon} cor="roxo" n={k?.atendimentos_mes?.valor} anterior={k?.atendimentos_mes?.anterior} serie={k?.atendimentos_mes?.serie} rotulo="Atendimentos no mês" />
        <Kpi Icon={ClockIcon} cor="rosa" n={k?.marcados?.valor} anterior={k?.marcados?.anterior} serie={k?.marcados?.serie} rotulo="Marcados à frente" legenda="vs. ontem" />
        <Kpi Icon={AlertaIcon} cor={semVinculo > 0 ? 'carmim' : 'roxo'} n={semVinculo} rotulo="Sem vínculo" sub={semVinculo > 0 ? 'clientes que ainda não entraram em agenda nenhuma' : 'todas as clientes estão em alguma agenda'} />
      </div>

      <div className="plat-grade-4">
        <Resumo Icon={WhatsIcon} cor="menta" titulo="WhatsApp" texto={`${k?.whats_hoje?.enviadas ?? 0} enviadas · ${k?.whats_hoje?.na_fila ?? 0} na fila · ${k?.whats_hoje?.falharam ?? 0} falharam`} pct={pct(k?.whats_hoje?.enviadas, k?.whats_hoje)} link="/plataforma/filas" rotulo="Ver filas" />
        <Resumo Icon={MailIcon} cor="roxo" titulo="E-mail (total)" texto={`${k?.emails?.enviados ?? 0} enviados · ${k?.emails?.na_fila ?? 0} na fila · ${k?.emails?.falharam ?? 0} falharam`} pct={pct(k?.emails?.enviados, k?.emails)} link="/plataforma/mensagens" rotulo="Ver filas" />
        <Resumo Icon={ConviteIcon} cor="rosa" titulo="Sem vínculo" texto={`${semVinculo} ${semVinculo === 1 ? 'cliente aguardando' : 'clientes aguardando'} um código`} pct={semVinculo ? 40 : 100} link="/plataforma/vinculos" rotulo="Gerenciar vínculos" />
        <Resumo Icon={ListaIcon} cor="rosa" titulo="Relógio" texto={relogio?.ligado ? `${(relogio.jobs ?? []).length} ponteiros · última batida ${fila?.ultima ? haQuanto(fila.ultima) : 'nunca'}` : 'desligado'} pct={bateu ? 100 : 10} link="/plataforma/configuracoes" rotulo="Ver tudo" />
      </div>

      <div className="plat-grade-3">
        <Painel Icon={ClockIcon} titulo="Atividade recente" link="/plataforma/vinculos" linkRotulo="Ver todas">
          {ativ.length === 0 ? <Vazio>Nada aconteceu ainda.</Vazio> : (
            <ul className="plat-linha-tempo">
              {ativ.map((a, i) => (
                <li key={i}><span className={'plat-ponto ' + corTipo(a.tipo)} /><span className={'plat-icone pequeno ' + corTipo(a.tipo)}>{iconeTipo(a.tipo)}</span><div><strong>{a.titulo}</strong><span className="muted">{a.detalhe}</span></div><small className="muted">{haQuanto(a.quando)}</small></li>
              ))}
            </ul>
          )}
        </Painel>

        <Painel Icon={PulsoIcon} titulo="Saúde da operação">
          <ul className="plat-saude">
            <Saude titulo="Fila de WhatsApp" detalhe={k?.whats_hoje?.na_fila ? `${k.whats_hoje.na_fila} na fila` : 'Nenhum item na fila'} estado={k?.whats_hoje?.na_fila > 20 ? 'Atenção' : 'Zerada'} />
            <Saude titulo="Fila de e-mails" detalhe={k?.emails?.na_fila ? `${k.emails.na_fila} na fila` : 'Nenhum item na fila'} estado={k?.emails?.na_fila ? 'Atenção' : 'Zerada'} />
            <Saude titulo="Envio de mensagens" detalhe={relogio?.ligado ? (bateu ? 'Relógio batendo' : 'Relógio parado') : 'Relógio desligado'} estado={bateu ? 'Online' : 'Atenção'} />
            <Saude titulo="Clientes sem vínculo" detalhe={semVinculo ? `${semVinculo} aguardando código` : 'Todas em alguma agenda'} estado={semVinculo ? 'Atenção' : 'Em dia'} />
            <Saude titulo="Erros no sistema" detalhe={k?.whats_falhas_24h ? `${k.whats_falhas_24h} envios falharam nas últimas 24h` : 'Nenhum erro nas últimas 24h'} estado={k?.whats_falhas_24h ? 'Atenção' : 'Sem erros'} />
          </ul>
        </Painel>

        <Painel Icon={PredioIcon} titulo="Salões com mais movimento" link="/plataforma/saloes" linkRotulo="Ver todos">
          {top.length === 0 ? <Vazio>Nenhum salão ativo.</Vazio> : (
            <ul className="plat-ranking">
              {top.map((s, i) => (
                <li key={s.id}>
                  <span className={'plat-rank' + (i === 0 ? ' primeiro' : '')}>{i + 1}</span>
                  <span className={'plat-icone ' + (s.tipo === 'autonoma' ? 'roxo' : 'rosa')}>{s.tipo === 'autonoma' ? <UsersIcon /> : <PredioIcon />}</span>
                  <div><Link to={`/plataforma/saloes/${s.id}`}><strong>{s.nome}</strong></Link><span className="muted">{s.clientes} clientes · {s.atendimentos} atendimentos</span><i className="plat-barra"><b style={{ width: `${Math.round((s.atendimentos_mes / maxMes) * 100)}%` }} /></i></div>
                  <em><strong>{s.atendimentos_mes}</strong><small className="muted">atendimentos</small></em>
                </li>
              ))}
            </ul>
          )}
        </Painel>
      </div>
    </Shell>
  )
}

function pct(a, obj) { const t = (obj?.enviadas ?? obj?.enviados ?? 0) + (obj?.na_fila ?? 0) + (obj?.falharam ?? 0); return t ? Math.round(((a ?? 0) / t) * 100) : 0 }
function Resumo({ Icon, cor, titulo, texto, pct, link, rotulo }) {
  return (
    <div className="plat-resumo">
      <span className={'plat-icone ' + cor}><Icon /></span>
      <div className="plat-resumo-texto"><strong>{titulo}</strong><span className="muted">{texto}</span><i className="plat-barra"><b style={{ width: `${pct}%` }} /></i></div>
      <Link to={link} className="plat-link">{rotulo} <SetaIcon /></Link>
    </div>
  )
}
function Saude({ titulo, detalhe, estado }) {
  return <li><span className="plat-icone cinza"><PulsoIcon /></span><div><strong>{titulo}</strong><span className="muted">{detalhe}</span></div><Pilula>{estado}</Pilula></li>
}
export function corTipo(t) { return { salao: 'rosa', profissional: 'roxo', cliente: 'menta', vinculo: 'roxo', atendimento: 'menta', whatsapp: 'menta', email: 'roxo', relogio: 'azul' }[t] ?? 'cinza' }
export function iconeTipo(t) { const I = { salao: PredioIcon, profissional: TeamIcon, cliente: UsersIcon, vinculo: LinkIcon, atendimento: CalendarIcon, whatsapp: WhatsIcon, email: MailIcon, relogio: ClockIcon }[t] ?? ClockIcon; return <I /> }
