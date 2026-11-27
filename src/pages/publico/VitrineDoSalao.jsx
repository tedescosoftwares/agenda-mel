import { useEffect, useState } from 'react'
import { CalendarCheck, BellRing, RefreshCw, Compass, X, LogIn, CalendarHeart, Moon, Sun } from 'lucide-react'
import PaginaSalao from '../../components/salao/PaginaSalao'
import BotaoGoogle, { OuLinha } from '../../components/BotaoGoogle'
import { MarcaIcon } from '../../components/icons'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useCategorias } from '../../lib/categorias'
import { guardarConvite } from '../../lib/convite'
import { iniciais } from '../../lib/booking'
import { urlDoAmbiente, urlDoEndereco } from '../../lib/ambiente'
import { chamar } from '../../lib/pagamento'
import { useConfig } from '../../lib/config'
import { formatarFone, foneValido } from '../../lib/fone'
import { lerTema, aplicarTema, trocarTema, ouvirTema } from '../../lib/tema'

// A página pública do salão (3.79), no endereço próprio dele (nome.mimo.com.vc): quem visita vê a página inteira,
// sem conta. Marcar um serviço, falar com o salão ou tocar numa promoção pedem a conta: abre a folha "entre para
// marcar", que leva ao cadastro (ou ao login, ou ao Google) com o código do salão (ela já nasce na agenda dele) e
// com ?depois= (o que ela escolheu); depois de entrar, a Home da cliente segue para lá. Já logada como cliente,
// entra na agenda do salão (se ainda não está) e segue direto para o fluxo de marcar de sempre.
// 4.11: com r.profissional_id a mesma página abre como a página DELA (foco), sempre dentro do salão.
export default function VitrineDoSalao({ r }) {
  const { user, role, vinculos, recarregarVinculos } = useAuth()
  const cats = useCategorias()
  const salaoId = r.salao?.id ?? r.id
  const codigo = r.codigo
  // (quem toca o próprio negócio não tem "salão" acima dela: a página é a do negócio)
  const foco = r.tipo === 'profissional' && r.salao?.tipo !== 'autonoma' ? r.profissional_id : null
  const sub = r.subdominio ?? r.salao?.subdominio ?? null
  const [pg, setPg] = useState(undefined)
  const [folha, setFolha] = useState(null)   // { alvo, destino }
  const [indo, setIndo] = useState(false)
  // 4.25: claro ou escuro, no botão da lua; vale enquanto a página está aberta (mesma escolha guardada do painel)
  const [tema, setTema] = useState(lerTema)
  useEffect(() => {
    aplicarTema(lerTema())
    const parar = ouvirTema(setTema)
    return () => { parar(); aplicarTema('claro') }
  }, [])

  useEffect(() => {
    let vivo = true
    supabase.rpc('pagina_do_salao', { salao: salaoId }).then(({ data }) => { if (vivo) setPg(data ?? null) }, () => { if (vivo) setPg(null) })
    return () => { vivo = false }
  }, [salaoId])
  useEffect(() => { if (codigo) guardarConvite(codigo) }, [codigo])
  useEffect(() => {
    const s = pg?.salao
    if (s) document.title = foco ? `${r.nome}, no ${s.nome} | Agende pela MIMO` : `${s.nome}${s.cidade ? ` · ${s.cidade}` : ''} | Agende pela MIMO`
  }, [pg])

  if (pg === undefined) return <div className="page-center"><p className="muted">Carregando…</p></div>
  if (!pg?.salao) return <div className="page-center"><p className="muted">Não encontramos esse salão.</p></div>
  const s = pg.salao

  // para onde cada ação leva, já dentro do app da cliente
  function destinoDe(alvo) {
    if (alvo.servico) return `/cliente/servico/${alvo.servico.id}?${new URLSearchParams({ ...(alvo.prof ?? foco ? { prof: alvo.prof ?? foco, firme: '1' } : (alvo.servico.quem ?? []).length === 1 ? { prof: alvo.servico.quem[0].id } : {}), de: `salao:${salaoId}` })}`
    if (alvo.promo?.service_id) return `/cliente/servico/${alvo.promo.service_id}?${new URLSearchParams({ ...(alvo.promo.professional_id ? { prof: alvo.promo.professional_id, firme: '1' } : {}), de: `salao:${salaoId}` })}`
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
        <span className="salp-topo-dir">
          <button type="button" className="salp-tema" onClick={trocarTema} aria-label={tema === 'escuro' ? 'Usar tema claro' : 'Usar tema escuro'} title={tema === 'escuro' ? 'Tema claro' : 'Tema escuro'}>{tema === 'escuro' ? <Sun size={17} /> : <Moon size={17} />}</button>
          {conta
            ? <a className="salp-entrar logada" href={urlDoAmbiente('cliente', '/cliente/home')}><CalendarHeart size={15} /> Minha agenda</a>
            : <a className="salp-entrar" href={urlDoAmbiente('cliente', `/login?convite=${codigo}&depois=${encodeURIComponent(`/cliente/salao/${salaoId}`)}`)}>Entrar</a>}
        </span>
      </header>
      {r.saiu && <p className="salp-saiu">{r.saiu} não atende mais no {s.nome}. Veja quem faz esses serviços na equipe da casa.</p>}
      <PaginaSalao
        pg={pg}
        cats={cats}
        modo="publico"
        onAgendar={agir}
        onContato={() => (conta ? agir({ contato: true }) : setFolha({ alvo: { contato: true }, destino: `/cliente/salao/${salaoId}` }))}
        onPromo={(p) => agir({ promo: p })}
        guiaUrl={urlDoAmbiente('cliente', '/saloes')}
        foco={foco}
        salaoUrl={sub ? urlDoEndereco(sub, '/') : null}
        profUrl={(p) => (sub && p.slug ? urlDoEndereco(sub, `/profissionais/${p.slug}`) : null)}
      />
      {indo && <div className="salp-folha-fundo"><p className="salp-indo">Abrindo a agenda…</p></div>}
      {folha && <EntrarParaMarcar salao={s} codigo={codigo} alvo={folha.alvo} destino={folha.destino} equipe={Boolean(user) && role !== 'cliente'} onFechar={() => setFolha(null)} />}
    </div>
  )
}

// a folha "entre para marcar": quem é o salão, o que ela ganha com a conta e os três jeitos de entrar
function EntrarParaMarcar({ salao, codigo, alvo, destino, equipe, onFechar }) {
  const [erro, setErro] = useState('')
  // 4.13: marcar sem criar conta (config_publica.agendar_sem_cadastro): nome, sobrenome e WhatsApp, e ela já vê os horários
  const semCadastro = useConfig().agendar_sem_cadastro === 'ligado' && !equipe
  const [comConta, setComConta] = useState(false)   // "já tenho conta": mostra os jeitos de entrar
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
        {semCadastro && !comConta ? (
          <MarcarSemCadastro salao={salao} codigo={codigo} alvo={alvo} destino={destino} onComConta={() => setComConta(true)} />
        ) : (<>
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
        </>)}
      </div>
    </div>
  )
}

// 4.13: a folha de quem marca sem criar conta. Três campos e ela segue para os horários. Um número que já tem conta
// não entra só por digitar: recebe o link no WhatsApp (ou usa a senha).
function MarcarSemCadastro({ salao, codigo, alvo, destino, onComConta }) {
  const [nome, setNome] = useState('')
  const [sobrenome, setSobrenome] = useState('')
  const [fone, setFone] = useState('')
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)
  const [existe, setExiste] = useState(false)
  const [linkPedido, setLinkPedido] = useState('')
  const depois = encodeURIComponent(destino)

  async function seguir(e) {
    e.preventDefault()
    setErro('')
    if (nome.trim().length < 2 || sobrenome.trim().length < 2) { setErro('Digite o nome e o sobrenome.'); return }
    if (!foneValido(fone)) { setErro('Confira o WhatsApp: DDD e número.'); return }
    setIndo(true)
    try {
      const r = await chamar('acesso', { acao: 'visita', nome: nome.trim(), sobrenome: sobrenome.trim(), telefone: fone })
      if (r?.existe) { setExiste(true); return }
      if (!r?.sessao) throw new Error('Não deu para continuar agora. Tente de novo.')
      const h = new URLSearchParams({ a: r.sessao.access_token, r: r.sessao.refresh_token, c: codigo ?? '', d: destino })
      window.location.href = urlDoAmbiente('cliente', `/visita#${h}`)
    } catch (er) {
      setErro(er.message || 'Não deu para continuar agora. Tente de novo.')
    } finally {
      setIndo(false)
    }
  }
  async function pedirLink() {
    setErro(''); setIndo(true)
    try {
      const r = await chamar('acesso', { acao: 'pedir_link', telefone: fone })
      setLinkPedido(r?.mensagem || 'O link chega em instantes no seu WhatsApp.')
    } catch (er) { setErro(er.message || 'Não deu para mandar o link agora.') } finally { setIndo(false) }
  }

  if (existe) return (
    <>
      <h2 id="salp-folha-titulo">Esse WhatsApp já tem cadastro na MIMO</h2>
      <p>Para sua segurança, a gente não abre uma conta só pelo número. Receba um link no seu WhatsApp e entre com um toque, ou use a sua senha.</p>
      {erro && <div className="alert alert-error">{erro}</div>}
      {linkPedido && <div className="alert alert-info">{linkPedido}</div>}
      <div className="salp-folha-botoes">
        <button type="button" className="btn btn-primary btn-block" onClick={pedirLink} disabled={indo || Boolean(linkPedido)} data-teste="salp-link">{indo ? 'Enviando…' : 'Receber link no WhatsApp'}</button>
        <a className="btn btn-ghost btn-block" href={urlDoAmbiente('cliente', `/login?convite=${codigo}&depois=${depois}`)}><LogIn size={16} /> Entrar com a senha</a>
        <button type="button" className="salp-folha-link" onClick={() => { setExiste(false); setLinkPedido('') }}>Usar outro número</button>
      </div>
    </>
  )

  return (
    <form onSubmit={seguir} className="salp-folha-form" noValidate>
      <h2 id="salp-folha-titulo">{alvo.servico ? `Marcar ${alvo.servico.name}` : alvo.contato ? `Falar com o ${salao.nome}` : `Marcar no ${salao.nome}`}</h2>
      <p>Sem criar conta e sem senha. Diga quem é você e já escolha o dia e o horário.</p>
      <div className="salp-folha-dupla">
        <label>Nome<input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="given-name" autoFocus data-teste="salp-nome" /></label>
        <label>Sobrenome<input value={sobrenome} onChange={(e) => setSobrenome(e.target.value)} autoComplete="family-name" data-teste="salp-sobrenome" /></label>
      </div>
      <label>WhatsApp<input value={fone} onChange={(e) => setFone(formatarFone(e.target.value))} inputMode="tel" autoComplete="tel" placeholder="(13) 99999-1234" data-teste="salp-fone" />
        <small>O salão confirma e lembra do horário por aqui.</small>
      </label>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="salp-folha-botoes">
        <button type="submit" className="btn btn-primary btn-block" disabled={indo} data-teste="salp-seguir">{indo ? 'Abrindo…' : 'Ver horários livres'}</button>
        <button type="button" className="salp-folha-link" onClick={onComConta}>Já tenho conta</button>
      </div>
      <p className="salp-folha-pe">Ao continuar, você concorda com os <a href={urlDoAmbiente('cliente', '/termos')}>Termos</a> e a <a href={urlDoAmbiente('cliente', '/privacidade')}>Política de Privacidade</a>.</p>
    </form>
  )
}
