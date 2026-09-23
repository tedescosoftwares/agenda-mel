import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Minus, Plus, ShieldCheck, Lock, CreditCard, Headset, Flag, MessageCircle, CalendarDays, Users, Heart, Clock, RotateCcw, QrCode, Wallet, Receipt, BarChart3, UserRound, LayoutGrid } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatarFone, soDigitos, foneValido } from '../../lib/fone'
import { Foto, Coracao, comecarEm } from './Pecas'
import { PLANOS, precoPara, reais } from '../../lib/planos'

// As seções novas da landing: rotina com recortes de UI, histórias de
// uso, antes × com MIMO, produto real com callouts, tamanhos, simulador
// de preço, captura de lead e a faixa de confiança. Tudo HTML e CSS,
// sem número inventado.

// ---------- a rotina real: quatro cards com um pedaço de tela dentro ----------
export function RotinaCartas() {
  const cartas = [
    { Ic: CalendarDays, t: 'Agenda', d: 'Horários, serviços, bloqueios, encaixes e disponibilidade real.', ui: (
      <div className="rt-agenda"><span className="ok"><b>09:00</b> Escova · Camila</span><span className="livre"><b>10:30</b> livre · 45 min</span><span className="bloq"><b>12:00</b> almoço</span></div>) },
    { Ic: Heart, t: 'Clientes', d: 'Histórico, retorno, preferências e relacionamento.', ui: (
      <div className="rt-cliente"><i>C</i><div><b>Camila Souza</b><small>manutenção em gel · há 32 dias</small></div><em>voltar</em></div>) },
    { Ic: Users, t: 'Equipe', d: 'Cada profissional com serviços, horários e regras próprias.', ui: (
      <div className="rt-equipe"><span className="a">A</span><span className="b">B</span><span className="c">C</span><div><b>3 agendas</b><small>Ana até 18h · Bia folga qua · Carla 9–20</small></div></div>) },
    { Ic: MessageCircle, t: 'Comunicação', d: 'Confirmação, lembretes, reagendamento e retorno conectados à agenda.', ui: (
      <div className="rt-whats"><p>Seu horário é amanhã às 14h. Confirma?</p><span>Confirmar</span><span>Reagendar</span></div>) },
  ]
  return (
    <div className="ld-rotina-cartas">
      {cartas.map(({ Ic, t, d, ui }, i) => (
        <article className="ld-rotina-carta ld-rv" key={t} style={{ transitionDelay: `${i * 70}ms` }}><div className="ld-ico"><Ic size={22} /></div><h3>{t}</h3><p>{d}</p><div className="rt-ui">{ui}</div></article>
      ))}
    </div>
  )
}

// ---------- histórias de uso: linha do tempo ----------
const HISTORIAS = [
  { id: 'cancelamento', kicker: 'Cancelamento', hora: '14:07', titulo: 'Camila cancelou o horário das 16:30.', Ic: Clock,
    passos: [['A agenda libera o horário.', 'livre'], ['A MIMO identifica clientes compatíveis na lista de espera.', 'Mariana · Carla'], ['O salão chama uma cliente.', 'WhatsApp'], ['16:30 volta a ficar ocupado.', 'Mariana · manicure']] },
  { id: 'retorno', kicker: 'Cliente para retornar', hora: 'há 35 dias', titulo: 'Último atendimento: manutenção em gel.', Ic: RotateCcw,
    passos: [['A cliente entra na lista de retorno.', '35 dias'], ['O salão recebe a sugestão.', 'hoje'], ['Mensagem pelo WhatsApp, com contexto.', 'com a Bia?'], ['Novo agendamento.', 'sáb · 10:00']] },
  { id: 'equipe', kicker: 'Nova profissional', hora: 'quem configura é o salão', titulo: 'O salão adiciona uma profissional.', Ic: Users,
    passos: [['Define o tipo de vínculo.', 'parceira'], ['Seleciona os serviços.', 'escova · cor'], ['Configura os horários.', 'ter–sáb'], ['Define acesso e permissões.', 'só a própria agenda'], ['Agenda pronta. Ela recebe o convite e ativa o acesso.', 'link da equipe']] },
  { id: 'qr', kicker: 'QR Code', hora: 'no balcão', titulo: 'A cliente vê o QR e escaneia.', Ic: QrCode,
    passos: [['Entra no ambiente do salão.', 'Studio Essenza'], ['Escolhe serviço ou profissional.', 'escova · Ana'], ['Agenda.', 'qui · 14:00'], ['A origem do vínculo fica registrada.', 'veio pelo balcão']] },
]
export function Historias() {
  return (
    <div className="hs-lista">
      {HISTORIAS.map((h, i) => (
        <article className="hs ld-rv" key={h.id} style={{ transitionDelay: `${i * 60}ms` }}>
          <header className="hs-topo"><span className="ld-kicker">{h.kicker}</span><div className="hs-gatilho"><i><h.Ic size={16} /></i><div><small>{h.hora}</small><strong>{h.titulo}</strong></div></div></header>
          <ol className="hs-passos">
            {h.passos.map(([t, tag], k) => <li key={k}><span className="hs-n">{k + 1}</span><div><p>{t}</p><em>{tag}</em></div></li>)}
          </ol>
        </article>
      ))}
    </div>
  )
}

// ---------- antes × com MIMO ----------
export function AntesDepois() {
  const antes = ['WhatsApp', 'papel', 'caderno', 'planilha', 'memória', 'grupo da equipe', 'Pix solto', 'agenda separada']
  const depois = ['Agenda', 'Cliente', 'Profissional', 'Mensagem', 'Retorno', 'Pagamento', 'Origem', 'Histórico']
  return (
    <div className="ad">
      <div className="ad-antes ld-rv">
        <span className="ld-kicker">Antes</span>
        <div className="ad-solto">{antes.map((a, i) => <span key={a} style={{ '--g': `${((i * 7) % 11) - 5}deg` }}>{a}</span>)}</div>
        <p>Informação espalhada.</p>
      </div>
      <div className="ad-depois ld-rv">
        <span className="ld-kicker">Com MIMO</span>
        <div className="ad-ligado"><b>Atendimento · qui 14:00 · Camila · escova com Ana</b>{depois.map((d) => <span key={d}><Check size={13} />{d}</span>)}</div>
        <p>Tudo ligado ao mesmo atendimento.</p>
      </div>
    </div>
  )
}

// ---------- produto real: a foto do painel com callouts ----------
export function ProdutoReal() {
  const chamadas = [['Agenda geral', LayoutGrid, 'e1'], ['Agenda por profissional', UserRound, 'e2'], ['Clientes', Heart, 'e3'], ['Equipe', Users, 'e4'], ['Retorno', RotateCcw, 'd1'], ['WhatsApp', MessageCircle, 'd2'], ['Sinal', Wallet, 'd3'], ['Comanda e caixa', Receipt, 'd4'], ['Relatórios', BarChart3, 'd5']]
  return (
    <div className="pr ld-rv">
      <div className="pr-foto"><Foto nome="painel" alt="Painel do salão no notebook e app da cliente no celular, sobre a bancada" /></div>
      <ul className="pr-chamadas">{chamadas.map(([t, Ic, pos]) => <li key={t} className={'pr-' + pos}><Ic size={14} />{t}</li>)}</ul>
    </div>
  )
}

// ---------- feita para cada tamanho ----------
export function Tamanhos() {
  const t = [
    { nome: 'Autônoma', fala: 'Só preciso organizar minha agenda.', itens: ['Agenda', 'Clientes', 'Serviços', 'Horários', 'Retorno', 'QR e link'], tag: 'Plano grátis', tipo: 'autonoma' },
    { nome: 'Salão pequeno', fala: 'Preciso organizar equipe e clientes.', itens: ['Múltiplas agendas', 'Equipe', 'Serviços', 'Clientes', 'WhatsApp', 'Pagamentos'], tag: 'MIMO Pro', tipo: 'salao', quente: true },
    { nome: 'Salão crescendo', fala: 'Preciso de mais controle sem criar mais complicação.', itens: ['Mais de 10 profissionais', 'Permissões', 'Comissões', 'Relatórios', 'Operação mais estruturada'], tag: 'MIMO Pro+', tipo: 'salao' },
  ]
  return (
    <div className="tm">
      {t.map((x, i) => (
        <article className={'tm-carta ld-rv' + (x.quente ? ' quente' : '')} key={x.nome} style={{ transitionDelay: `${i * 60}ms` }}>
          <span className="ld-pilula">{x.nome}</span>
          <blockquote>“{x.fala}”</blockquote>
          <ul className="ld-checks">{x.itens.map((it) => <li key={it}>{it}</li>)}</ul>
          <div className="tm-pe"><b>{x.tag}</b><a className="ld-btn ld-fantasma" href={comecarEm(x.tipo)}>Começar <ArrowRight size={14} /></a></div>
        </article>
      ))}
    </div>
  )
}

// ---------- simulador de preço ----------
const MAX = 30
export function Simulador() {
  const [n, setN] = useState(3)
  const c = precoPara(n)
  return (
    <div className="sm ld-rv">
      <div className="sm-controle">
        <label htmlFor="sm-n">Quantas profissionais usam agenda?</label>
        <div className="sm-passos"><button type="button" aria-label="Menos uma" onClick={() => setN((v) => Math.max(1, v - 1))} disabled={n <= 1}><Minus size={20} /></button><output id="sm-n">{n}</output><button type="button" aria-label="Mais uma" onClick={() => setN((v) => Math.min(MAX, v + 1))} disabled={n >= MAX}><Plus size={20} /></button></div>
        <input type="range" min={1} max={MAX} value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Profissionais com agenda" />
        <div className="sm-faixas" aria-hidden="true"><span className={c.plano === 'pro' ? 'on' : ''}>MIMO Pro · até 10</span><span className={c.plano === 'promais' ? 'on' : ''}>MIMO Pro+ · 11 ou mais</span></div>
        {n >= MAX && <small className="sm-mais">Mais de {MAX}? A conta segue a mesma: R$ {PLANOS.promais.extra.toFixed(2).replace('.', ',')} por agenda. <a href="#quero-ver">Fala com a gente</a>.</small>}
      </div>
      <div className="sm-conta">
        <div><span>{c.nome} <small>até {c.plano === 'pro' ? PLANOS.pro.inclusas : PLANOS.promais.inclusas} agendas inclusas</small></span><b>{reais(c.base)}</b></div>
        <div><span>{c.extras === 0 ? 'Nenhuma agenda a mais' : `${c.extras} ${c.extras === 1 ? 'agenda a mais' : 'agendas a mais'} × ${reais(c.valorExtra)}`}</span><b>{reais(c.extras * c.valorExtra)}</b></div>
        <div className="sm-total"><span>Total</span><b>{reais(c.total)} <small>/mês</small></b></div>
        <p>Você paga apenas pelas agendas profissionais ativas. Recepção, administração e gestão não contam como agenda profissional.</p>
        <a className="ld-btn ld-primario" href={comecarEm('salao')}>Criar meu salão <ArrowRight size={16} /></a>
      </div>
    </div>
  )
}

// ---------- captura de lead ----------
const FAIXAS = [['1', 'Só eu'], ['2-3', '2 a 3'], ['4-6', '4 a 6'], ['7-10', '7 a 10'], ['11+', 'Mais de 10']]
function utmsDaUrl() {
  try {
    const q = new URLSearchParams(window.location.search)
    const u = { utm_source: q.get('utm_source'), utm_medium: q.get('utm_medium'), utm_campaign: q.get('utm_campaign') }
    if (u.utm_source || u.utm_medium || u.utm_campaign) { sessionStorage.setItem('mimo-utm', JSON.stringify(u)); return u }
    return JSON.parse(sessionStorage.getItem('mimo-utm') || '{}')
  } catch { return {} }
}
export function CapturaLead() {
  const [v, setV] = useState({ salon_name: '', professionals_count: '2-3', whatsapp: '' })
  const [estado, setEstado] = useState('') // '' | enviando | ok | erro
  useEffect(() => { utmsDaUrl() }, [])
  async function enviar(e) {
    e.preventDefault()
    if (!v.salon_name.trim() || !foneValido(v.whatsapp)) { setEstado('erro'); return }
    setEstado('enviando')
    const { error } = await supabase.from('landing_leads').insert({ salon_name: v.salon_name.trim(), professionals_count: v.professionals_count, whatsapp: soDigitos(v.whatsapp), origem: window.location.pathname, ...utmsDaUrl() })
    setEstado(error ? 'erro' : 'ok')
  }
  if (estado === 'ok') return <div className="ld-forma ld-forma-ok ld-rv"><Check size={28} /><strong>Recebemos. A gente te chama no WhatsApp.</strong><p>Enquanto isso, dá para criar a conta e já ver a MIMO por dentro.</p><a className="ld-btn ld-primario" href={comecarEm()}>Começar agora <ArrowRight size={16} /></a></div>
  return (
    <form className="ld-forma ld-rv" onSubmit={enviar}>
      <label>Nome do salão<input value={v.salon_name} onChange={(e) => setV({ ...v, salon_name: e.target.value })} placeholder="Studio Essenza" required /></label>
      <label>Número de profissionais<select value={v.professionals_count} onChange={(e) => setV({ ...v, professionals_count: e.target.value })}>{FAIXAS.map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></label>
      <label>WhatsApp<input type="tel" inputMode="tel" value={v.whatsapp} onChange={(e) => setV({ ...v, whatsapp: formatarFone(e.target.value) })} placeholder="(13) 99999-0000" required /></label>
      <button className="ld-btn ld-primario ld-grande" type="submit" disabled={estado === 'enviando'}>{estado === 'enviando' ? 'Enviando…' : 'Quero conhecer a MIMO'}</button>
      {estado === 'erro' && <small className="ld-forma-erro">Confere o nome do salão e o WhatsApp com DDD.</small>}
      <small className="ld-forma-nota">Só usamos para falar com você sobre a MIMO. <Link to="/privacidade">Privacidade</Link>.</small>
    </form>
  )
}

// ---------- faixa de confiança ----------
export function Confianca() {
  const itens = [[ShieldCheck, 'Dados protegidos'], [Lock, 'LGPD'], [CreditCard, 'Pagamento seguro'], [Headset, 'Suporte humano'], [Flag, 'Empresa brasileira']]
  return <ul className="cf">{itens.map(([Ic, t]) => <li key={t}><Ic size={18} />{t}</li>)}</ul>
}

// ---------- por que a MIMO existe ----------
export function PorQue() {
  return (
    <div className="pq ld-rv">
      <div className="pq-foto"><Foto nome="equipe" alt="Dona do salão e duas profissionais olhando a agenda no tablet" /><Coracao className="pq-coracao" /></div>
      <div className="pq-texto">
        <p>A MIMO não começou tentando construir um ERP.</p>
        <p>Começou tentando organizar a rotina de quem atende clientes de verdade.</p>
        <p>Agenda, serviços, profissionais, mensagens, retorno e pagamento foram entrando porque a rotina pediu.</p>
        <p>Por isso a MIMO cresce a partir do que acontece no salão, não a partir de uma lista de funcionalidades.</p>
        <blockquote>Primeiro a rotina.<br />Depois o software.</blockquote>
      </div>
    </div>
  )
}
