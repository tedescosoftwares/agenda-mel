import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Store, Wallet, Users, Sparkles, Clock, BadgePercent, Megaphone, MessageCircle, BarChart3, QrCode, ChevronRight, Monitor, HandCoins } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import { useAuth } from '../../context/AuthContext'
import { useDialogo } from '../../context/DialogoContext'
import { supabase } from '../../lib/supabase'
import CodigoQr from '../../components/CodigoQr'
import AvisosNoCelular from '../../components/AvisosNoCelular'
import AvisosPorEmail from '../../components/AvisosPorEmail'
import { MODOS } from '../../lib/pagamento'

// Ajustes do salão: o hub. Cada área é um cartão que diz o que faz e em
// que pé está (fotos, pino, PIX, equipe com contrato, horário…), em vez
// de uma lista de botões. O código do balcão fica compacto; o QR grande
// abre só quando vai imprimir. Sair e a conta ficam no menu do avatar.
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export default function AdminAjustes() {
  const { salao, saloes, trocarSalao } = useAuth()
  const { confirmar } = useDialogo()
  const [codigo, setCodigo] = useState(salao?.codigo ?? null)
  const [qr, setQr] = useState(false)
  const [erro, setErro] = useState('')
  const [st, setSt] = useState(null)   // a situação de cada área
  const [pdv, setPdv] = useState(() => { try { return localStorage.getItem('mimo-pdv') === '1' } catch { return false } })
  const desktop = typeof window !== 'undefined' && window.innerWidth >= 900
  const [aceite, setAceite] = useState(null)        // { modo, minutos, no_silencio }
  const [aceiteMsg, setAceiteMsg] = useState('')
  async function salvarAceite(mudanca) {
    const novo = { ...aceite, ...mudanca }
    setAceite(novo); setAceiteMsg('')
    const { data, error } = await supabase.rpc('salao_aceite', { salao: salao.id, modo: novo.modo, minutos: novo.minutos, no_silencio: novo.no_silencio })
    if (error) { setAceiteMsg(error.message); return }
    setAceiteMsg(data?.modo === 'automatico' ? 'Pronto: tudo entra confirmado na hora.' : data?.modo === 'casa' ? `Pronto: a casa confirma em até ${data.minutos} min, ${data.profissionais_ajustadas} ${data.profissionais_ajustadas === 1 ? 'profissional segue' : 'profissionais seguem'} a regra.` : 'Pronto: cada profissional decide nas próprias configurações.')
  }
  function ligarPdv(v) { setPdv(v); try { localStorage.setItem('mimo-pdv', v ? '1' : '0'); sessionStorage.removeItem('mimo-pdv-pausado') } catch { /* sem armazenamento */ } }

  useEffect(() => {
    if (!salao?.id) return
    let vivo = true
    ;(async () => {
      const hoje = new Date().toISOString().slice(0, 10)
      const [s, profs, servs, horas, promos, parc] = await Promise.all([
        supabase.from('salons').select('logo_url, fotos, descricao, lat, lng, pagamento_modo, sinal_pct, politica_cancelamento, city, whatsapp, aceite_modo, minutos_para_aceitar, ao_expirar').eq('id', salao.id).maybeSingle(),
        supabase.from('professionals').select('id, active').eq('salon_id', salao.id),
        supabase.from('services').select('id, active, destaque').eq('salon_id', salao.id),
        supabase.from('business_hours').select('weekday, open, start_time, end_time').eq('salon_id', salao.id),
        supabase.from('promocoes').select('id, fim').eq('salon_id', salao.id),
        supabase.rpc('parcerias_da_equipe', { salao: salao.id }),
      ])
      if (!vivo) return
      const abertos = (horas.data ?? []).filter((h) => h.open).map((h) => h.weekday).sort()
      const ativosP = (profs.data ?? []).filter((p) => p.active).length
      const ativosS = (servs.data ?? []).filter((x) => x.active)
      const promosAtivas = (promos.data ?? []).filter((p) => !p.fim || p.fim >= hoje).length
      const comContrato = (parc.data ?? []).filter((l) => l.status === 'vigente' || l.status === 'assinado').length
      const ex = abertos.length ? faixa(abertos) : ''
      const h0 = (horas.data ?? []).find((h) => h.open)
      setAceite({ modo: s.data?.aceite_modo ?? 'profissional', minutos: s.data?.minutos_para_aceitar ?? 120, no_silencio: s.data?.ao_expirar ?? 'confirma' })
      setSt({
        salao: s.data ?? {},
        profissionais: ativosP, comContrato, semContrato: (parc.data ?? []).filter((l) => l.status === 'sem_contrato').length,
        servicos: ativosS.length, destaques: ativosS.filter((x) => x.destaque).length,
        horario: abertos.length ? `${ex}${h0 ? ` · ${h0.start_time.slice(0, 5)}–${h0.end_time.slice(0, 5)}` : ''}` : '',
        promocoes: promosAtivas,
      })
    })()
    return () => { vivo = false }
  }, [salao?.id])

  async function novoCodigo() {
    const ok = await confirmar({ titulo: 'Gerar um código novo para o salão?', texto: 'O QR do balcão e o link antigos deixam de funcionar. Quem já entrou continua.', ok: 'Gerar novo' })
    if (!ok) return
    const { data, error } = await supabase.rpc('novo_codigo_do_salao', { salao: salao.id })
    if (error) setErro(error.message); else setCodigo(data)
  }
  async function copiarLink() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/v/${codigo ?? salao?.codigo}`); setErro('') } catch { setErro('Não deu para copiar. Toque em "QR e link" e copie por lá.') }
  }

  const s = st?.salao ?? {}
  const cod = codigo ?? salao?.codigo
  const pag = s.pagamento_modo && s.pagamento_modo !== 'nao'
  const fotos = (s.fotos ?? []).length
  const pino = Number.isFinite(Number(s.lat)) && s.lat != null

  // cada área: para onde vai, o que faz e a situação de agora (tom + texto)
  const AREAS = [
    { titulo: 'A casa', cartoes: [
      { to: '/admin/salao', Icon: Store, tom: 'rosa', titulo: 'Página do salão', texto: 'Fotos, descrição, contatos e o pino no mapa que a cliente vê.', situacao: st && (fotos ? `${fotos} ${fotos === 1 ? 'foto' : 'fotos'}` : 'sem fotos') + (st ? (pino ? ' · pino no mapa' : ' · sem pino no mapa') : ''), ok: st ? fotos > 0 && pino : null },
      { to: '/admin/horarios', Icon: Clock, tom: 'roxo', titulo: 'Horário do salão', texto: 'Os dias e as horas em que a casa abre, e o padrão da equipe.', situacao: st && (st.horario || 'sem horário definido'), ok: st ? Boolean(st.horario) : null },
      { to: '/admin/servicos', Icon: Sparkles, tom: 'ambar', titulo: 'Serviços', texto: 'O cardápio: preço, duração, foto, categoria e quem faz.', situacao: st && (st.servicos ? `${st.servicos} ativos · ${st.destaques} em destaque` : 'nenhum serviço ainda'), ok: st ? st.servicos > 0 : null },
      { to: '/admin/equipe', Icon: Users, tom: 'menta', titulo: 'Equipe', texto: 'Quem atende, com quais serviços, e o contrato de parceria.', situacao: st && (st.profissionais ? `${st.profissionais} ${st.profissionais === 1 ? 'ativa' : 'ativas'} · ${st.comContrato} com contrato` : 'ninguém cadastrada'), ok: st ? st.profissionais > 0 && st.semContrato === 0 : null },
    ] },
    { titulo: 'Dinheiro', cartoes: [
      { to: '/admin/receber', Icon: Wallet, tom: 'rosa', titulo: 'Receber pelo app', texto: 'PIX ao marcar, política de cancelamento e o financeiro do mês.', situacao: st && (pag ? `${MODOS[s.pagamento_modo]?.curto ?? s.pagamento_modo} · sinal de ${s.sinal_pct ?? 0}%` : 'desligado'), ok: st ? pag : null },
      { to: '/admin/numeros', Icon: BarChart3, tom: 'roxo', titulo: 'O mês', texto: 'Faturamento, ocupação e atendimentos, por profissional.', situacao: null },
      { to: '/admin/repasses', Icon: HandCoins, tom: 'menta', titulo: 'Repasses', texto: 'O que é de cada profissional no período, já com a cota do contrato.', situacao: st && (st.comContrato ? `${st.comContrato} com cota no contrato` : 'sem contratos ainda'), ok: st ? st.comContrato > 0 : null },
      { to: '/admin/pdv', Icon: Monitor, tom: 'verde', titulo: 'PDV do balcão', texto: 'Quadro, comanda, caixa do dia e projeção da semana, na tela cheia do computador.', situacao: desktop ? (pdv ? 'abre direto ao entrar' : 'pronto para abrir') : 'só no computador', ok: desktop ? true : false },
    ] },
    { titulo: 'Clientes', cartoes: [
      { to: '/admin/promocoes', Icon: BadgePercent, tom: 'ambar', titulo: 'Promoções', texto: 'Um criativo na home das clientes, com desconto ou preço especial.', situacao: st && (st.promocoes ? `${st.promocoes} no ar` : 'nenhuma no ar'), ok: st ? st.promocoes > 0 : null },
      { to: '/admin/recados', Icon: Megaphone, tom: 'menta', titulo: 'Recados', texto: 'Um aviso para a carteira inteira ou para a equipe, no celular.', situacao: null },
      { to: '/admin/whatsapp', Icon: MessageCircle, tom: 'verde', titulo: 'WhatsApp', texto: 'O canal, a IA que responde e o bot que marca sozinho.', situacao: st && (s.whatsapp ? `número ${s.whatsapp}` : 'sem número cadastrado'), ok: st ? Boolean(s.whatsapp) : null },
    ] },
  ]

  return (
    <AdminShell>
      <div className="page-head"><div><h2>Ajustes</h2><p className="muted">Tudo que se configura uma vez e se confere de vez em quando.</p></div></div>
      {erro && <div className="alert alert-error">{erro}</div>}

      {/* o salão em uso */}
      <div className="card aj-salao">
        <span className="aj-salao-logo">{s.logo_url ? <img src={s.logo_url} alt="" /> : <Store size={22} />}</span>
        <div className="aj-salao-quem">
          <strong>{salao?.name ?? 'Meu salão'}</strong>
          <span className="muted">{[s.city, st ? `${st.profissionais} na equipe` : null, st ? `${st.servicos} serviços` : null].filter(Boolean).join(' · ')}</span>
        </div>
        <Link to="/admin/salao" className="icon-btn" aria-label="Editar a página do salão"><ChevronRight size={18} /></Link>
        {saloes?.length > 1 && (
          <div className="aj-salao-troca">
            <span className="muted">Você administra {saloes.length} salões. Tudo que cadastra vai para o escolhido:</span>
            <div className="chips">{saloes.map((x) => <button key={x.id} type="button" className={x.id === salao?.id ? 'chip active' : 'chip'} onClick={() => trocarSalao(x.id)}>{x.name}</button>)}</div>
          </div>
        )}
      </div>

      {/* o código do balcão, compacto */}
      <div className="card aj-codigo">
        <div className="aj-codigo-topo">
          <span className="aj-codigo-icone"><QrCode size={20} /></span>
          <div className="aj-codigo-texto">
            <strong>Código do balcão</strong>
            <span className="muted">A cliente entra na agenda da casa lendo o QR, abrindo o link ou digitando as letras.</span>
          </div>
          <span className="aj-codigo-letras">{cod ?? '——'}</span>
        </div>
        <div className="aj-codigo-acoes">
          <button type="button" className="btn btn-ghost btn-mini" onClick={copiarLink}>Copiar link</button>
          <button type="button" className={'btn btn-mini ' + (qr ? 'btn-ghost' : 'btn-primary')} onClick={() => setQr((v) => !v)}>{qr ? 'Fechar o QR' : 'QR e link'}</button>
        </div>
        {qr && (
          <div className="aj-codigo-qr">
            <CodigoQr codigo={cod} nome={salao?.name} onNovo={salao ? novoCodigo : undefined}
              mensagem={`Entra na agenda do ${salao?.name ?? 'salão'} pelo MIMO: ${window.location.origin}/v/${cod}\nOu digita o código ${cod} no app.`} />
            <p className="muted aj-codigo-dica">Imprima e deixe no balcão. Quem entra por aqui vê todas as profissionais da casa. Cada profissional tem o código dela em Meu link, e a cliente que entra por ele fica registrada como trazida por ela.</p>
          </div>
        )}
      </div>

      {AREAS.map((a) => (
        <section key={a.titulo} className="secao aj-secao">
          <h3 className="secao-titulo">{a.titulo}</h3>
          <div className="aj-grade">
            {a.cartoes.map((c) => (
              <Link key={c.to} to={c.to} className={'card aj-cartao aj-' + c.tom}>
                <span className="aj-cartao-icone"><c.Icon size={20} /></span>
                <strong>{c.titulo}</strong>
                <span className="aj-cartao-texto">{c.texto}</span>
                {c.situacao !== null && (
                  <span className={'aj-cartao-situacao' + (c.ok === true ? ' ok' : c.ok === false ? ' atencao' : '')}>
                    <i />{c.situacao ?? 'conferindo…'}
                  </span>
                )}
                <ChevronRight size={16} className="aj-cartao-seta" />
              </Link>
            ))}
          </div>
        </section>
      ))}

      <section className="secao aj-secao">
        <h3 className="secao-titulo">Pedidos de horário</h3>
        <p className="muted aj-aceite-intro">Quando uma cliente marca pelo app ou pelo WhatsApp, quem confirma?</p>
        <div className="aj-aceite">
          {[
            { id: 'automatico', titulo: 'Entra confirmado na hora', texto: 'A vaga estava livre, ela pegou. Ninguém precisa responder.' },
            { id: 'casa', titulo: 'A casa confirma', texto: 'Vira um pedido; você confirma pelo quadro ou pelo alerta, dentro do prazo.' },
            { id: 'profissional', titulo: 'Cada profissional decide', texto: 'Vale o que cada uma configurou na própria agenda.' },
          ].map((o) => (
            <button key={o.id} type="button" className={'card aj-aceite-opcao' + (aceite?.modo === o.id ? ' ativa' : '')} onClick={() => salvarAceite({ modo: o.id })} disabled={!aceite} aria-pressed={aceite?.modo === o.id}>
              <span className="aj-aceite-marca" />
              <span><strong>{o.titulo}</strong><span className="muted">{o.texto}</span></span>
            </button>
          ))}
        </div>
        {aceite?.modo === 'casa' && (
          <div className="card aj-aceite-prazo">
            <label>Prazo para a casa responder
              <select value={aceite.minutos} onChange={(e) => salvarAceite({ minutos: Number(e.target.value) })}>
                {[15, 30, 60, 120, 240, 480, 1440].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : m < 1440 ? `${m / 60} h` : '1 dia'}</option>)}
              </select>
            </label>
            <label>Se ninguém responder no prazo
              <select value={aceite.no_silencio} onChange={(e) => salvarAceite({ no_silencio: e.target.value })}>
                <option value="confirma">confirma sozinho (a cliente não perde a vaga)</option>
                <option value="cancela">cancela e avisa a cliente</option>
              </select>
            </label>
            <p className="muted">O pedido chega no celular de quem manda no salão e no alerta do PDV, com "Confirmar" e "Recusar". No quadro, o cartão fica marcado "a confirmar" até alguém decidir.</p>
          </div>
        )}
        {aceiteMsg && <p className="muted aj-aceite-msg">{aceiteMsg}</p>}
      </section>

      <section className="secao aj-secao">
        <h3 className="secao-titulo">Modo PDV</h3>
        <div className="card cl-ajuste avisos-celular">
          <div className="cliente-info">
            <span className="cliente-nome"><span className="nome-txt">Abrir no modo PDV pelo computador</span></span>
            <span className="muted cliente-meta">{desktop ? 'Ao entrar no painel por um computador, vai direto para o PDV do balcão. "Sair do PDV" traz o painel de volta.' : 'Você está no celular. Ligue aqui e, quando entrar pelo computador do salão, o painel abre direto no PDV.'}</span>
          </div>
          <label className="switch"><input type="checkbox" checked={pdv} onChange={(e) => ligarPdv(e.target.checked)} /><span></span></label>
        </div>
      </section>

      <section className="secao aj-secao">
        <h3 className="secao-titulo">Avisos para você</h3>
        <AvisosNoCelular />
        <AvisosPorEmail />
      </section>

      <p className="muted aj-rodape">Sua conta e a saída ficam no menu do avatar, lá em cima.</p>
    </AdminShell>
  )
}

// "seg a sex", "ter a sáb", "seg, qua e sex"
function faixa(dias) {
  if (!dias.length) return ''
  const seq = dias.every((d, i) => i === 0 || d === dias[i - 1] + 1)
  if (seq && dias.length > 2) return `${DIAS[dias[0]]} a ${DIAS[dias[dias.length - 1]]}`
  if (dias.length === 7) return 'todos os dias'
  const nomes = dias.map((d) => DIAS[d])
  return nomes.length > 1 ? nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1] : nomes[0]
}
