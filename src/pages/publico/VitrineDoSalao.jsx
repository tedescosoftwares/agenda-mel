import { useEffect, useState } from 'react'
import { CalendarCheck, BellRing, RefreshCw, Compass, X, LogIn, CalendarHeart } from 'lucide-react'
import PaginaSalao from '../../components/salao/PaginaSalao'
import BotaoGoogle, { OuLinha } from '../../components/BotaoGoogle'
import { MarcaIcon } from '../../components/icons'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useCategorias } from '../../lib/categorias'
import { guardarConvite } from '../../lib/convite'
import { iniciais } from '../../lib/booking'
import { urlDoAmbiente } from '../../lib/ambiente'

// A página pública do salão (3.79), no endereço próprio dele (nome.mimo.com.vc): quem visita vê a página inteira,
// sem conta. Marcar um serviço, falar com o salão ou tocar numa promoção pedem a conta: abre a folha "entre para
// marcar", que leva ao cadastro (ou ao login, ou ao Google) com o código do salão (ela já nasce na agenda dele) e
// com ?depois= (o que ela escolheu); depois de entrar, a Home da cliente segue para lá. Já logada como cliente,
// entra na agenda do salão (se ainda não está) e segue direto para o fluxo de marcar de sempre.
export default function VitrineDoSalao({ r }) {
  const { user, role, vinculos, recarregarVinculos } = useAuth()
  const cats = useCategorias()
  const salaoId = r.salao?.id ?? r.id
  const codigo = r.codigo
  const [pg, setPg] = useState(undefined)
  const [folha, setFolha] = useState(null)   // { alvo, destino }
  const [indo, setIndo] = useState(false)

  useEffect(() => {
    let vivo = true
    supabase.rpc('pagina_do_salao', { salao: salaoId }).then(({ data }) => { if (vivo) setPg(data ?? null) }, () => { if (vivo) setPg(null) })
    return () => { vivo = false }
  }, [salaoId])
  useEffect(() => { if (codigo) guardarConvite(codigo) }, [codigo])
  useEffect(() => {
    const s = pg?.salao
    if (s) document.title = `${s.nome}${s.cidade ? ` · ${s.cidade}` : ''} | Agende pela MIMO`
  }, [pg])

  if (pg === undefined) return <div className="page-center"><p className="muted">Carregando…</p></div>
  if (!pg?.salao) return <div className="page-center"><p className="muted">Não encontramos esse salão.</p></div>
  const s = pg.salao

  // para onde cada ação leva, já dentro do app da cliente
  function destinoDe(alvo) {
    if (alvo.servico) return `/cliente/servico/${alvo.servico.id}?${new URLSearchParams({ ...(alvo.prof ? { prof: alvo.prof } : (alvo.servico.quem ?? []).length === 1 ? { prof: alvo.servico.quem[0].id } : {}), de: `salao:${salaoId}` })}`
    if (alvo.promo?.service_id) return `/cliente/servico/${alvo.promo.service_id}?${new URLSearchParams({ ...(alvo.promo.professional_id ? { prof: alvo.promo.professional_id } : {}), de: `salao:${salaoId}` })}`
    return `/cliente/salao/${salaoId}`
  }
  async function agir(alvo) {
    if (alvo.promo) supabase.rpc('promocao_clicada', { promo: alvo.promo.id }).then(() => {}, () => {})
    const destino = destinoDe(alvo)
    if (user && role === 'cliente') {
      setIndo(true)
      try {
        const ja = (vinculos ?? []).some((v) => v.salao?.id === salaoId)
        if (!ja && codigo) { await supabase.rpc('vincular', { codigo, jeito: 'link' }); await recarregarVinculos?.() }
      } catch { /* sem vínculo, o app pede o código */ }
      window.location.href = urlDoAmbiente('cliente', destino)
      return
    }
    setFolha({ alvo, destino })
  }

  const conta = user && role === 'cliente'
  return (
    <div className="salp-wrap">
      <header className="salp-topo">
        <a className="salp-marca" href={urlDoAmbiente('cliente', '/')} aria-label="MIMO"><MarcaIcon width={20} height={18} id="salp" /> mimo</a>
        {conta
          ? <a className="salp-entrar logada" href={urlDoAmbiente('cliente', '/cliente/home')}><CalendarHeart size={15} /> Minha agenda</a>
          : <a className="salp-entrar" href={urlDoAmbiente('cliente', `/login?convite=${codigo}&depois=${encodeURIComponent(`/cliente/salao/${salaoId}`)}`)}>Entrar</a>}
      </header>
      <PaginaSalao
        pg={pg}
        cats={cats}
        modo="publico"
        onAgendar={agir}
        onContato={() => (conta ? agir({ contato: true }) : setFolha({ alvo: { contato: true }, destino: `/cliente/salao/${salaoId}` }))}
        onPromo={(p) => agir({ promo: p })}
        guiaUrl={urlDoAmbiente('cliente', '/saloes')}
      />
      {indo && <div className="salp-folha-fundo"><p className="salp-indo">Abrindo a agenda…</p></div>}
      {folha && <EntrarParaMarcar salao={s} codigo={codigo} alvo={folha.alvo} destino={folha.destino} equipe={Boolean(user) && role !== 'cliente'} onFechar={() => setFolha(null)} />}
    </div>
  )
}

// a folha "entre para marcar": quem é o salão, o que ela ganha com a conta e os três jeitos de entrar
function EntrarParaMarcar({ salao, codigo, alvo, destino, equipe, onFechar }) {
  const [erro, setErro] = useState('')
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])
  const depois = encodeURIComponent(destino)
  const titulo = alvo.servico
    ? `Para marcar ${alvo.servico.name}, entre na MIMO`
    : alvo.contato ? `Para falar com o ${salao.nome}, entre na MIMO` : `Crie sua conta para marcar no ${salao.nome}`
  const sub = alvo.contato
    ? 'É grátis e leva um minuto. Com a conta, o WhatsApp do salão aparece e você já marca pelo app.'
    : 'É grátis e leva um minuto. Depois você escolhe o dia e o horário que estão livres.'
  return (
    <div className="salp-folha-fundo" onClick={(e) => { if (e.target === e.currentTarget) onFechar() }} role="presentation">
      <div className="salp-folha" role="dialog" aria-modal="true" aria-labelledby="salp-folha-titulo">
        <span className="salp-folha-alca" aria-hidden="true" />
        <button type="button" className="salp-folha-fechar" onClick={onFechar} aria-label="Fechar"><X size={17} /></button>
        <div className="salp-folha-quem">
          <span className="sal-logo">{salao.logo_url ? <img src={salao.logo_url} alt="" /> : iniciais(salao.nome)}</span>
          <span><strong>{salao.nome}</strong><small>{[salao.bairro, salao.cidade].filter(Boolean).join(', ') || 'agenda pela MIMO'}</small></span>
        </div>
        <h2 id="salp-folha-titulo">{titulo}</h2>
        <p>{sub}</p>
        {equipe ? (
          <div className="alert alert-info">Você está logada como equipe. Saia da conta e entre como cliente para marcar.</div>
        ) : (
          <>
            <ul className="salp-folha-lista">
              <li><CalendarCheck size={20} /> Veja os horários livres e marque em segundos</li>
              <li><BellRing size={20} /> Lembrete antes do horário, no celular</li>
              <li><RefreshCw size={20} /> Remarque ou cancele pelo app, sem precisar ligar</li>
              <li><Compass size={20} /> E ainda o guia de salões da MIMO na sua cidade</li>
            </ul>
            {erro && <div className="alert alert-error">{erro}</div>}
            <div className="salp-folha-botoes">
              <BotaoGoogle convite={codigo} voltar={`/v/${codigo}?depois=${depois}`} onErro={setErro} />
              <OuLinha />
              <a className="btn btn-primary btn-block" href={urlDoAmbiente('cliente', `/cadastro?convite=${codigo}&depois=${depois}`)} data-teste="salp-criar">Criar minha conta grátis</a>
              <a className="btn btn-ghost btn-block" href={urlDoAmbiente('cliente', `/login?convite=${codigo}&depois=${depois}`)} data-teste="salp-entrar"><LogIn size={16} /> Já tenho conta</a>
            </div>
          </>
        )}
        <p className="salp-folha-pe">Ao criar a conta, você entra na agenda do {salao.nome}. Seus dados seguem a <a href={urlDoAmbiente('cliente', '/privacidade')}>Política de Privacidade</a>.</p>
      </div>
    </div>
  )
}
