import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { Store, Check, ArrowLeft, ArrowRight, LogOut, Camera, MapPin, Plus, X, Copy, Download, MoreHorizontal, Link2, CheckCircle2, Info, Crown, Sparkles, MessageCircle, Users, Minus } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { planoDoNegocio, reais as emDinheiro, PLANOS } from '../lib/planos'
import '../onboarding.css'
import { reduzirFoto } from '../lib/imagem'
import { buscarCep, formatarCep, minhaPosicao, geocodificar } from '../lib/geo'
import { formatarFone } from '../lib/fone'
import { linkDoCodigo } from '../lib/convite'
import { urlDoAmbiente } from '../lib/ambiente'
import { formatPreco } from '../lib/format'
import Avatar from '../components/Avatar'
import { TERMOS_VERSAO } from '../lib/termos'
import RodapeSocial from '../components/RodapeSocial'

// O onboarding do salão (114): do cadastro à agenda em seis passos, o
// mesmo fluxo no computador e no celular. Cada passo grava ao continuar
// e a conta lembra onde parou; quem sair volta pro mesmo lugar. A
// autônoma passa por cinco: não tem o passo da equipe.
// cada passo tem a foto, o bilhete e a frase do painel da esquerda
const PASSOS = [
  { id: 1, rotulo: 'Tipo de conta', foto: 'profissional', bilhete: 'bem-vinda', titulo: 'Sua rotina no lugar.', texto: 'Escolha como você trabalha. Autônoma é grátis; salão paga só pelas agendas que usa.' },
  { id: 2, rotulo: 'Dados do salão', foto: 'salao', bilhete: 'é a cara da casa', titulo: 'O que a cliente vê.', texto: 'Nome, foto, WhatsApp e endereço aparecem na página do seu negócio e no app da cliente.' },
  { id: 3, rotulo: 'Estrutura e operação', foto: 'painel', bilhete: 'do seu jeito', titulo: 'Como o dia funciona.', texto: 'Horários, política de agendamento, sinal e quem confirma. Tudo dá pra mudar depois em Ajustes.' },
  { id: 4, rotulo: 'Serviços', foto: 'lifestyle', bilhete: 'preço e tempo', titulo: 'O que você oferece.', texto: 'Cadastre os principais com duração real. É isso que impede a agenda de oferecer um horário que não existe.' },
  { id: 5, rotulo: 'Equipe', foto: 'equipe', bilhete: 'cada uma com a sua agenda', titulo: 'Quem atende.', texto: 'Você configura tudo; a profissional entra pelo link da equipe e já encontra a agenda dela pronta.' },
  { id: 6, rotulo: 'Clientes e ativação', foto: 'qr', bilhete: 'do balcão pra agenda', titulo: 'Pronta pra receber.', texto: 'Imprima o QR, coloque no balcão e na bio. A cliente escaneia e marca sozinha.' },
]
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0]
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
const ANTECEDENCIAS = [[0, 'Sem antecedência'], [30, '30 minutos'], [60, '1 hora'], [120, '2 horas'], [240, '4 horas'], [720, '12 horas'], [1440, '24 horas'], [2880, '48 horas']]
const CANCELAMENTO = [['flexivel', '6 horas'], ['moderada', '12 horas'], ['rigorosa', '24 horas']]
const CATEGORIAS_SUGERIDAS = ['Cabelo', 'Unhas', 'Estética', 'Massagem', 'Sobrancelhas', 'Maquiagem', 'Depilação', 'Barba']
const SUPORTE = import.meta.env.VITE_SUPORTE_WHATS || ''
const CHAVE_LOGO = 'mimo-onboarding-logo'   // a foto escolhida antes de existir conta espera aqui e sobe no primeiro acesso
const blobParaDataUrl = (blob) => new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = erro; r.readAsDataURL(blob) })
const dataUrlParaBlob = async (u) => (await fetch(u)).blob()
const reais = (t) => { const n = Number(String(t ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0 }
const emReais = (c) => (Number(c ?? 0) / 100).toFixed(2).replace('.', ',')

// `publico`: os passos 1 e 2 antes de existir conta (/comecar). O passo 2
// cria a conta com os dados do salão nos metadados; o servidor grava tudo
// e a conta acorda no passo 3, já logada em /onboarding.
// a landing manda ?tipo=autonoma ou ?tipo=salao; sem isso, salão
function tipoDaURL() {
  try { return new URLSearchParams(window.location.search).get('tipo') === 'autonoma' ? 'autonoma' : 'salao' } catch { return 'salao' }
}

export default function Onboarding({ publico = false }) {
  const { user, role, salao: salaoAdmin, negocio, recarregarPerfil, loading } = useAuth()
  const salao = negocio ?? salaoAdmin   // a autônoma não tem 'salao' de admin; o negócio que ela é dona vale pros dois
  const navigate = useNavigate()
  const [s, setS] = useState(publico ? { id: null, tipo: tipoDaURL(), publico: true } : null)   // o salão, como está no banco (com o que a tela mudou por cima)
  const [passo, setPasso] = useState(1)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [pronto, setPronto] = useState(false)

  useEffect(() => {
    if (!salao || publico) return
    setS((x) => x ?? { ...salao })
    // a foto escolhida no cadastro (antes da conta existir) sobe agora
    let guardada = null
    try { guardada = localStorage.getItem(CHAVE_LOGO) } catch { /* sem storage */ }
    if (guardada && !salao.logo_url) {
      ;(async () => {
        try {
          const blob = await dataUrlParaBlob(guardada)
          const path = `${salao.id}/logo/${crypto.randomUUID()}.jpg`
          const { error } = await supabase.storage.from('saloes').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
          if (error) return
          const logo_url = supabase.storage.from('saloes').getPublicUrl(path).data.publicUrl
          await supabase.rpc('onboarding_salvar', { salao: salao.id, dados: { logo_url } })
          setS((x) => (x ? { ...x, logo_url } : x))
        } finally { try { localStorage.removeItem(CHAVE_LOGO) } catch { /* nada */ } }
      })()
    }
    // retoma de onde parou; quem já concluiu e abriu de novo começa do 1 (revisão)
    setPasso((p) => (p === 1 && !salao.onboarding_concluido_em && salao.onboarding_passo > 1 ? Math.min(6, salao.onboarding_passo) : p))
  }, [salao])

  const autonoma = s?.tipo === 'autonoma'
  const passos = useMemo(() => PASSOS.filter((p) => !(autonoma && p.id === 5)), [autonoma])
  const idx = passos.findIndex((p) => p.id === passo)
  const total = passos.length
  const pular = (n) => { const k = passos.findIndex((p) => p.id === n); return passos[Math.min(passos.length - 1, k + 1)]?.id ?? n }
  const voltarDe = (n) => { const k = passos.findIndex((p) => p.id === n); return passos[Math.max(0, k - 1)]?.id ?? n }

  async function gravar(dados, proximo) {
    if (!s?.id) { setS((x) => ({ ...x, ...dados })); return true }
    setSalvando(true); setErro('')
    const { data, error } = await supabase.rpc('onboarding_salvar', { salao: s.id, dados, passo: proximo })
    setSalvando(false)
    if (error) { setErro(error.message); return false }
    setS((x) => ({ ...x, ...dados, onboarding_passo: data?.passo ?? x.onboarding_passo }))
    return true
  }
  async function seguir(dados = {}) {
    const proximo = pular(passo)
    const ok = await gravar(dados, proximo)
    if (ok) { setPasso(proximo); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  }
  function voltar() { setPasso(voltarDe(passo)); window.scrollTo({ top: 0 }) }
  async function concluir() {
    setSalvando(true); setErro('')
    const { error } = await supabase.rpc('onboarding_concluir', { salao: s.id })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setPronto(true)
    // o onboarding já apresentou o app: conta como primeiro acesso feito (e os termos aceitos no cadastro)
    try { await supabase.rpc('aceitar_termos', { versao: TERMOS_VERSAO }) } catch { /* já aceitos */ }
    try { await supabase.rpc('concluir_primeiro_acesso') } catch { /* segue */ }
    await recarregarPerfil?.()
    navigate(autonoma ? '/pro/agenda' : '/admin', { replace: true })
  }
  async function sair() {
    // grava onde parou e vai pro painel (ele volta pra cá enquanto não concluir)
    await gravar({}, passo)
    await recarregarPerfil?.()
    navigate(autonoma ? '/pro/agenda' : '/admin')
  }

  if (publico && !loading && user && salao) return <Navigate to="/onboarding" replace />
  if (!s) return <div className="page-center"><p className="muted">Carregando…</p></div>

  const props = { s, setS, salvando, erro, setErro, seguir, voltar, gravar, user, role, autonoma, concluir, pronto, publico, recarregarPerfil, navigate }
  const atual = passos[idx] ?? passos[0]
  const plano = planoDoNegocio(s.tipo, s.equipe_prevista)
  const sairLink = publico ? <Link className="ob-sair" to="/pro/entrar"><LogOut size={14} /> Já tenho conta</Link> : <button type="button" className="ob-sair" onClick={sair}><LogOut size={14} /> Sair do cadastro</button>
  return (
    <div className="ob">
      <aside className="ob-painel">
        <div className="ob-painel-topo"><img src="/mimo-logo.svg" alt="MIMO" />{sairLink}</div>
        <div className="ob-painel-foto"><img src={`/imagens/${atual.foto}-720.webp`} alt="" /><span className="ob-painel-bilhete">{atual.bilhete} <i>♥</i></span></div>
        <div className="ob-painel-texto"><small>Passo {idx + 1} de {total}</small><h2>{atual.titulo}</h2><p>{atual.texto}</p></div>
        <ol className="ob-passos">
          {passos.map((p, i) => (
            <li key={p.id} className={i < idx ? 'feito' : i === idx ? 'atual' : ''}>
              <button type="button" onClick={() => { if (publico ? p.id <= 2 && i <= idx : (i <= idx || p.id <= (s.onboarding_passo ?? 1))) setPasso(p.id) }}>
                <span className="ob-passo-num">{i < idx ? <Check size={12} /> : i + 1}</span>{p.rotulo}
              </button>
            </li>
          ))}
        </ol>
        <span className="ob-painel-espaco" />
        <div className="ob-plano-painel">
          <small>Seu plano</small>
          <strong>{plano.nome}</strong>
          <b>{plano.total === 0 ? 'Grátis' : emDinheiro(plano.total)}{plano.total > 0 && <small> /mês</small>}</b>
          <span>{autonoma ? 'Uma agenda, sem mensalidade.' : `${s.equipe_prevista || 1} ${(s.equipe_prevista || 1) === 1 ? 'agenda' : 'agendas'} · ajuste no passo 3`}</span>
        </div>
        {SUPORTE && <a className="ob-ajuda" href={`https://wa.me/${SUPORTE.replace(/\D/g, '')}?text=${encodeURIComponent('Oi! Estou fazendo o cadastro do meu salão no MIMO e preciso de ajuda.')}`} target="_blank" rel="noreferrer"><MessageCircle size={18} /><span><strong>Precisa de ajuda?</strong><small>Fale com a gente pelo WhatsApp</small></span></a>}
      </aside>

      <main className="ob-conteudo">
        <div className="ob-topo-m">
          <button type="button" onClick={() => (idx === 0 ? sair() : voltar())} aria-label="Voltar"><ArrowLeft size={20} /></button>
          <div className="ob-barra" aria-label={`Passo ${idx + 1} de ${total}`}><i style={{ width: `${((idx + 1) / total) * 100}%` }} /></div>
          {!(publico && passo === 2) ? <button type="button" onClick={() => (passo === 6 ? concluir() : seguir({}))}>{passo === 6 ? 'Concluir' : 'Pular'}</button> : <span />}
        </div>
        <span className="ob-conteudo-num">Passo {idx + 1} de {total} · {atual.rotulo}</span>
        {passo === 1 && <PassoTipo {...props} />}
        {passo === 2 && <PassoDados {...props} />}
        {passo === 3 && <PassoEstrutura {...props} />}
        {passo === 4 && <PassoServicos {...props} />}
        {passo === 5 && <PassoEquipe {...props} />}
        {passo === 6 && <PassoAtivacao {...props} />}
      </main>
    </div>
  )
}

function Rodape({ voltar, avancar, rotulo = 'Continuar', salvando, primeiro = false, icone = <ArrowRight size={16} /> }) {
  return (
    <div className="ob-rodape">
      {!primeiro ? <button type="button" className="btn btn-ghost" onClick={voltar} disabled={salvando}><ArrowLeft size={16} /> Voltar</button> : <span />}
      <button type="button" className="btn btn-primary ob-continuar" onClick={avancar} disabled={salvando}>{salvando ? 'Salvando…' : rotulo} {!salvando && icone}</button>
    </div>
  )
}

// ---------- 1 · Tipo de conta ------------------------------------------------------
function PassoTipo({ s, setS, seguir, salvando, erro, setErro }) {
  const [tipo, setTipo] = useState(s.tipo ?? 'salao')
  async function avancar() {
    if (tipo !== s.tipo && !s.id) { setS((x) => ({ ...x, tipo })); seguir({}); return }
    if (tipo !== s.tipo) {
      const { data, error } = await supabase.rpc('trocar_tipo_negocio', { salao: s.id, novo: tipo })
      if (error) { setErro(error.message); return }
      setS((x) => ({ ...x, tipo: data?.tipo ?? tipo }))
    }
    seguir({})
  }
  return (
    <>
      <h1 className="ob-titulo">Como você trabalha?</h1>
      <p className="ob-sub">Escolha o tipo de conta. Dá pra mudar depois, sem perder nada.</p>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="ob-tipos">
        {[
          { id: 'salao', foto: 'equipe', pilula: 'Salão · MIMO Pro', titulo: 'Tenho salão, com equipe', texto: 'Agenda geral, uma agenda por profissional, comanda, repasses, lista de espera e WhatsApp.', preco: 'R$ 49,90', sub: '/mês até 3 profissionais · R$ 9,90 por agenda a mais', itens: ['Até 10 agendas no Pro, sem limite no Pro+', 'Você configura; a profissional só entra', 'Comanda e repasse por profissional', 'QR e link do salão'] },
          { id: 'autonoma', foto: 'profissional', pilula: 'Autônoma · grátis', titulo: 'Trabalho sozinha', texto: 'Uma agenda, serviços, clientes, retorno, QR e link próprios. Sem menu de equipe.', preco: 'R$ 0', sub: '/mês, sem cartão', itens: ['Agenda e horários', 'Serviços e preços', 'Clientes e histórico', 'QR e link próprios'] },
        ].map((o) => (
          <button key={o.id} type="button" className={'ob-tipo' + (tipo === o.id ? ' ativo' : '')} onClick={() => setTipo(o.id)} aria-pressed={tipo === o.id}>
            <span className="ob-tipo-foto"><img src={`/imagens/${o.foto}-720.webp`} alt="" /><span className="ob-pilula">{o.pilula}</span></span>
            {tipo === o.id && <span className="ob-tipo-check"><Check size={14} /></span>}
            <strong>{o.titulo}</strong>
            <span className="muted">{o.texto}</span>
            <span className="ob-tipo-preco"><b>{o.preco}</b><small>{o.sub}</small></span>
            <ul>{o.itens.map((i) => <li key={i}><Check size={13} /> {i}</li>)}</ul>
          </button>
        ))}
      </div>
      <div className="ob-nota"><span className="ob-nota-icone"><Crown size={16} /></span><span><strong>Nenhuma cobrança neste cadastro</strong><small>A mensalidade do salão é combinada depois, direto com a MIMO. Autônoma não paga nada.</small></span></div>
      <Rodape primeiro avancar={avancar} salvando={salvando} />
    </>
  )
}

// ---------- 2 · Dados do salão -----------------------------------------------------
function PassoDados({ s, setS, seguir, voltar, salvando, erro, setErro, user, role, autonoma, publico, recarregarPerfil, navigate }) {
  const { signUp } = useAuth()
  const [conta, setConta] = useState({ senha: '', termos: false })
  const [criada, setCriada] = useState(false)
  const [criando, setCriando] = useState(false)
  const [f, setF] = useState({ name: s.name ?? '', cnpj: s.cnpj ?? '', whatsapp: s.whatsapp ?? s.phone ?? '', email: s.email ?? '', responsavel_nome: s.responsavel_nome ?? '', address: s.address ?? '', bairro: s.bairro ?? '', city: s.city ?? '', uf: s.uf ?? '', cep: s.cep ?? '', lat: s.lat ?? null, lng: s.lng ?? null })
  const [logo, setLogo] = useState(s.logo_url ? { url: s.logo_url } : null)
  const [geo, setGeo] = useState('')
  const [buscandoCep, setBuscandoCep] = useState(false)
  const arq = useRef(null)
  const m = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  useEffect(() => { if (!f.responsavel_nome && user && !publico) supabase.from('profiles').select('full_name, email').eq('id', user.id).maybeSingle().then(({ data }) => { if (data) setF((x) => ({ ...x, responsavel_nome: x.responsavel_nome || data.full_name || '', email: x.email || data.email || '' })) }) }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  async function trocarLogo(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setErro('A imagem passa de 5 MB.'); return }
    try { setLogo(await reduzirFoto(file, { max: 512, quadrado: true })) } catch (err) { setErro(err.message) }
  }
  async function porCep(v) {
    setF((x) => ({ ...x, cep: v }))
    if (v.replace(/\D/g, '').length !== 8) return
    setBuscandoCep(true)
    try { const r = await buscarCep(v); setF((x) => ({ ...x, address: x.address || r.rua, bairro: x.bairro || r.bairro, city: r.cidade || x.city, uf: r.uf || x.uf, lat: r.lat ?? x.lat, lng: r.lng ?? x.lng })) } catch (err) { setErro(err.message) } finally { setBuscandoCep(false) }
  }
  async function usarLocalizacao() {
    setGeo('achando…'); setErro('')
    try { const p = await minhaPosicao(); setF((x) => ({ ...x, lat: p.lat, lng: p.lng })); setGeo(`pino marcado (precisão ${p.precisao} m)`) } catch (err) { setGeo(''); setErro(err.message) }
  }
  // no público: cria a conta com tudo isso nos metadados; o servidor abre o negócio e grava os dados
  async function criarConta() {
    if (!f.responsavel_nome.trim()) { setErro('Diga o seu nome.'); return }
    if (!f.whatsapp.trim()) { setErro('Precisamos do WhatsApp: é por ele que os avisos chegam.'); return }
    if (!f.email.trim()) { setErro('Diga o seu e-mail: é com ele que você entra.'); return }
    if (conta.senha.length < 6) { setErro('A senha precisa ter pelo menos 6 caracteres.'); return }
    if (!conta.termos) { setErro('Para criar a conta, é preciso aceitar os Termos e a Política de privacidade.'); return }
    setCriando(true); setErro('')
    try {
      const { data: livre } = await supabase.rpc('telefone_disponivel', { fone: f.whatsapp.trim() })
      if (livre && livre.disponivel === false) { setErro(livre.email ? `Esse WhatsApp já tem conta, no e-mail ${livre.email}. Entre com ela.` : (livre.motivo || 'Confere o WhatsApp.')); return }
      const dadosSalao = { cnpj: f.cnpj, email: f.email.trim(), whatsapp: f.whatsapp.trim(), responsavel_nome: f.responsavel_nome.trim(), address: f.address, bairro: f.bairro, city: f.city, uf: f.uf, cep: f.cep.replace(/\D/g, '') }
      // a foto espera no navegador e sobe assim que a conta entrar no onboarding
      try { if (logo?.blob) localStorage.setItem(CHAVE_LOGO, await blobParaDataUrl(logo.blob)); else localStorage.removeItem(CHAVE_LOGO) } catch { /* sem storage: a foto fica pra depois */ }
      if (user) {
        // já logada como cliente, sem negócio: abre agora e segue
        const { data, error } = await supabase.rpc('abrir_negocio', { tipo: s.tipo, nome_negocio: f.name.trim() || null, cidade: f.city.trim() || null })
        if (error) throw new Error(error.message)
        await supabase.rpc('onboarding_salvar', { salao: data.salao_id, dados: dadosSalao, passo: 3 })
        await recarregarPerfil?.()
        navigate('/onboarding', { replace: true })
        return
      }
      const { error } = await signUp(f.email.trim(), conta.senha, f.responsavel_nome.trim(), f.whatsapp.trim(),
        { termos: TERMOS_VERSAO, papel_desejado: s.tipo, nome_negocio: f.name.trim() || null, cidade: f.city.trim() || null, salao: dadosSalao })
      if (error) { setErro(traduzErro(error.message)); return }
      const { data: sess } = await supabase.auth.getSession()
      if (sess?.session) { await recarregarPerfil?.(); navigate('/onboarding', { replace: true }); return }
      setCriada(true)
    } catch (err) { setErro(err.message) } finally { setCriando(false) }
  }
  async function avancar() {
    if (!f.name.trim()) { setErro(autonoma ? 'Diga o nome da sua agenda.' : 'Diga o nome do salão.'); return }
    if (publico) { await criarConta(); return }
    if (!f.whatsapp.trim()) { setErro('Precisamos do WhatsApp: é por ele que as clientes falam com vocês.'); return }
    if (!f.email.trim()) { setErro('Diga um e-mail de contato.'); return }
    if (!f.city.trim()) { setErro('Diga a cidade.'); return }
    let logo_url = logo?.url ?? null
    if (logo?.blob) {
      const path = `${s.id}/logo/${crypto.randomUUID()}.jpg`
      const { error } = await supabase.storage.from('saloes').upload(path, logo.blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
      if (error) { setErro('Não deu para subir o logo: ' + error.message); return }
      logo_url = supabase.storage.from('saloes').getPublicUrl(path).data.publicUrl
    }
    let lat = f.lat, lng = f.lng
    if ((lat == null || lng == null) && f.address.trim() && f.city.trim()) {
      try { const g = await geocodificar(`${f.address}, ${f.bairro ? f.bairro + ', ' : ''}${f.city} ${f.uf}`); if (g) { lat = g.lat; lng = g.lng } } catch { /* sem pino agora, ajusta depois em Ajustes */ }
    }
    const dados = { ...f, logo_url, cep: f.cep.replace(/\D/g, '') }
    if (lat != null && lng != null) { dados.lat = lat; dados.lng = lng } else { delete dados.lat; delete dados.lng }
    seguir(dados)
  }
  if (criada) {
    return (
      <>
        <h1 className="ob-titulo">Conta criada!</h1>
        <p className="ob-sub">Falta só confirmar o e-mail</p>
        <div className="ob-pronto"><span className="ob-pronto-check"><Check size={18} /></span><span><strong>Mandamos um link para {f.email.trim()}</strong><small>Abra o e-mail, toque em confirmar e entre. Você continua daqui, no passo 3, com tudo o que já preencheu guardado{logo ? ', a foto inclusive (entrando por este mesmo navegador)' : ''}.</small></span></div>
        <div className="ob-rodape"><span /><Link to="/pro/entrar" className="btn btn-primary ob-continuar">Já confirmei, entrar <ArrowRight size={16} /></Link></div>
      </>
    )
  }
  return (
    <>
      <h1 className="ob-titulo">{autonoma ? 'Seus dados' : 'A cara do salão'}</h1>
      <p className="ob-sub">{publico ? 'Preencha as informações principais e crie o seu acesso' : autonoma ? 'As informações que as clientes vão ver' : 'Preencha as informações principais do seu salão'}</p>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="ob-dados">
        <div className="ob-form">
          <label>{autonoma ? 'Nome da agenda' : 'Nome do salão'} <b>*</b><input value={f.name} onChange={m('name')} placeholder="Studio Essenza Hair" /></label>
          {!autonoma && <label>CNPJ <span className="muted">(opcional)</span><input value={f.cnpj} onChange={m('cnpj')} placeholder="12.345.678/0001-90" inputMode="numeric" /></label>}
          <label>WhatsApp <b>*</b><span className="ob-fone"><span className="ob-ddi">🇧🇷 +55</span><input type="tel" inputMode="numeric" value={f.whatsapp} onChange={(e) => setF((x) => ({ ...x, whatsapp: formatarFone(e.target.value) }))} placeholder="(11) 91234-5678" autoComplete="tel" /></span></label>
          <label>E-mail <b>*</b>{publico && <span className="muted">(é com ele que você entra)</span>}<input type="email" value={f.email} onChange={m('email')} placeholder="contato@essenzahair.com.br" autoComplete="email" /></label>
          <label>{publico ? 'Seu nome completo' : 'Nome da responsável'} <b>*</b><input value={f.responsavel_nome} onChange={m('responsavel_nome')} placeholder="Juliana Lima" autoComplete="name" /></label>
          {publico && !user && (
            <>
              <label>Senha <b>*</b><input type="password" value={conta.senha} onChange={(e) => setConta((x) => ({ ...x, senha: e.target.value }))} placeholder="mínimo 6 caracteres" autoComplete="new-password" /></label>
              <label className="ob-termos"><input type="checkbox" checked={conta.termos} onChange={(e) => setConta((x) => ({ ...x, termos: e.target.checked }))} /><span>Li e aceito os <Link to="/termos" target="_blank">Termos de uso</Link> e a <Link to="/privacidade" target="_blank">Política de privacidade</Link>.</span></label>
            </>
          )}
        </div>
        <div className="ob-form">
          <div className="ob-logo-campo">
            <span className="ob-rotulo">{autonoma ? 'Sua foto ou logo' : 'Logo ou foto do salão'}</span>
            <button type="button" className={'ob-logo' + (logo ? ' com' : '')} onClick={() => arq.current?.click()}>
              {logo ? <img src={logo.preview ?? logo.url} alt="" /> : <span className="ob-logo-vazio"><span className="ob-logo-iniciais">{(f.name || 'ES').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}</span><span>{f.name || 'Seu salão'}</span></span>}
              <span className="ob-logo-cam"><Camera size={15} /></span>
            </button>
            <input ref={arq} type="file" accept="image/*" hidden onChange={trocarLogo} />
            <small className="muted">JPG ou PNG. Tamanho máximo de 5 MB.</small>
            {logo && <button type="button" className="link-ver" onClick={() => setLogo(null)}>Remover</button>}
          </div>
          <label>CEP<input value={formatarCep(f.cep)} onChange={(e) => porCep(e.target.value)} placeholder="11060-300" inputMode="numeric" />{buscandoCep && <small className="muted">buscando…</small>}</label>
          <label>Endereço <b>*</b><input value={f.address} onChange={m('address')} placeholder="Rua das Flores, 123" /></label>
          <label>Bairro<input value={f.bairro} onChange={m('bairro')} placeholder="Jardim Paulista" /></label>
          <div className="ob-linha-2">
            <label>Cidade <b>*</b><input value={f.city} onChange={m('city')} placeholder="São Paulo" /></label>
            <label>UF<select value={f.uf} onChange={m('uf')}><option value="">—</option>{UFS.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
          </div>
          <button type="button" className="ob-geo" onClick={usarLocalizacao}><MapPin size={14} /> Usar minha localização atual{geo ? <small className="muted"> · {geo}</small> : f.lat != null ? <small className="muted"> · pino marcado</small> : null}</button>
        </div>
      </div>
      <Rodape voltar={voltar} avancar={avancar} salvando={salvando || criando} rotulo={publico ? (user ? 'Abrir minha agenda' : 'Criar conta e continuar') : 'Continuar'} />
      {publico && <RodapeSocial />}
    </>
  )
}

function traduzErro(msg) {
  const mapa = {
    'User already registered': 'Este e-mail já tem conta. Entre com a senha, ou use "Esqueci a senha".',
    'Password should be at least 6 characters': 'A senha precisa ter pelo menos 6 caracteres.',
    'Failed to fetch': 'Não foi possível conectar. Confira sua internet.',
    'Database error saving new user': 'Não deu para criar a conta: esse WhatsApp já está em uso ou algum dado veio errado.',
  }
  return mapa[msg] || msg
}

// ---------- 3 · Estrutura e operação ------------------------------------------------
function PassoEstrutura({ s, seguir, voltar, salvando, erro, setErro, autonoma }) {
  const [horas, setHoras] = useState(null)
  const [cats, setCats] = useState([])
  const [novaCat, setNovaCat] = useState('')
  const [pol, setPol] = useState({ antecedencia_min_minutos: s.antecedencia_min_minutos ?? 60, politica_cancelamento: s.politica_cancelamento ?? 'moderada', permite_remarcar: s.permite_remarcar ?? true, sinal_ligado: (s.pagamento_modo ?? 'nao') !== 'nao', sinal_modo: s.sinal_modo ?? 'fixo', sinal_fixo: emReais(s.sinal_fixo_cents ?? 5000), sinal_pct: s.sinal_pct ?? 50, equipe_prevista: s.equipe_prevista ?? 4, aceite_modo: s.aceite_modo ?? 'casa', minutos_para_aceitar: s.minutos_para_aceitar ?? 120 })
  const p = (k) => (v) => setPol((x) => ({ ...x, [k]: v }))

  useEffect(() => {
    supabase.from('business_hours').select('weekday, open, start_time, end_time').eq('salon_id', s.id).then(({ data }) => {
      const base = ORDEM_DIAS.map((d) => { const h = (data ?? []).find((x) => x.weekday === d); return h ? { ...h, start_time: String(h.start_time).slice(0, 5), end_time: String(h.end_time).slice(0, 5) } : { weekday: d, open: d >= 1 && d <= 5, start_time: '08:00', end_time: d === 6 ? '18:00' : '19:00' } })
      setHoras(base)
    })
    supabase.from('categorias_de_servico').select('id, salon_id, nome, ordem').or(`salon_id.eq.${s.id},salon_id.is.null`).order('ordem').then(({ data }) => setCats(data ?? []))
  }, [s.id])

  const minhasCats = cats.filter((c) => c.salon_id === s.id)
  async function addCat(nome) {
    const n = nome.trim(); if (!n) return
    if (cats.some((c) => c.nome.toLowerCase() === n.toLowerCase() && c.salon_id === s.id)) { setNovaCat(''); return }
    const { data, error } = await supabase.from('categorias_de_servico').insert({ salon_id: s.id, nome: n, ordem: 500 }).select('id, salon_id, nome, ordem').maybeSingle()
    if (error) { setErro(error.message); return }
    setCats((x) => [...x, data]); setNovaCat('')
  }
  async function tirarCat(c) {
    const { error } = await supabase.from('categorias_de_servico').delete().eq('id', c.id)
    if (error) { setErro('Essa categoria tem serviço: tire os serviços dela primeiro.'); return }
    setCats((x) => x.filter((y) => y.id !== c.id))
  }
  const mudaHora = (d, k, v) => setHoras((x) => x.map((h) => (h.weekday === d ? { ...h, [k]: v } : h)))

  async function avancar() {
    for (const h of horas ?? []) if (h.open && h.start_time >= h.end_time) { setErro(`${DIAS[h.weekday]}: o fim precisa ser depois do início.`); return }
    const { error } = await supabase.rpc('onboarding_horarios', { salao: s.id, horarios: horas })
    if (error) { setErro(error.message); return }
    seguir({ antecedencia_min_minutos: Number(pol.antecedencia_min_minutos), politica_cancelamento: pol.politica_cancelamento, permite_remarcar: pol.permite_remarcar,
      pagamento_modo: pol.sinal_ligado ? (s.pagamento_modo && s.pagamento_modo !== 'nao' ? s.pagamento_modo : 'opcional') : 'nao', sinal_modo: pol.sinal_modo, sinal_fixo_cents: reais(pol.sinal_fixo), sinal_pct: Number(pol.sinal_pct),
      equipe_prevista: Number(pol.equipe_prevista) || null, aceite_modo: pol.aceite_modo, minutos_para_aceitar: Number(pol.minutos_para_aceitar) })
  }
  return (
    <>
      <h1 className="ob-titulo">Como o dia funciona</h1>
      <p className="ob-sub">{autonoma ? 'Defina como você atende no dia a dia' : 'Defina como seu salão funciona no dia a dia'}</p>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="ob-estrutura">
        <div className="ob-card">
          <strong className="ob-card-titulo">Horário de funcionamento</strong>
          {!horas ? <p className="muted">Carregando…</p> : (
            <div className="ob-horas">
              {horas.map((h) => (
                <div key={h.weekday} className={'ob-hora' + (h.open ? '' : ' fechado')}>
                  <span className="ob-hora-dia">{DIAS[h.weekday]}</span>
                  {h.open ? <><input type="time" value={h.start_time} onChange={(e) => mudaHora(h.weekday, 'start_time', e.target.value)} /><span className="muted">–</span><input type="time" value={h.end_time} onChange={(e) => mudaHora(h.weekday, 'end_time', e.target.value)} /></> : <span className="ob-hora-fechado">Fechado</span>}
                  <label className="switch"><input type="checkbox" checked={h.open} onChange={(e) => mudaHora(h.weekday, 'open', e.target.checked)} /><span></span></label>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="ob-card">
          <strong className="ob-card-titulo">Política de agendamento</strong>
          <label className="ob-campo">Antecedência mínima<select value={pol.antecedencia_min_minutos} onChange={(e) => p('antecedencia_min_minutos')(e.target.value)}>{ANTECEDENCIAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></label>
          <label className="ob-campo">Cancelamento gratuito até<select value={pol.politica_cancelamento} onChange={(e) => p('politica_cancelamento')(e.target.value)}>{CANCELAMENTO.map(([v, r]) => <option key={v} value={v}>{r} antes</option>)}</select></label>
          <div className="ob-toggle"><span>Permitir reagendamento</span><label className="switch"><input type="checkbox" checked={pol.permite_remarcar} onChange={(e) => p('permite_remarcar')(e.target.checked)} /><span></span></label></div>
          <div className="ob-toggle"><span>Sinal <span className="muted">(opcional)</span></span><label className="switch"><input type="checkbox" checked={pol.sinal_ligado} onChange={(e) => p('sinal_ligado')(e.target.checked)} /><span></span></label></div>
          {pol.sinal_ligado && (
            <div className="ob-sinal">
              <div className="chips"><button type="button" className={'chip' + (pol.sinal_modo === 'fixo' ? ' active' : '')} onClick={() => p('sinal_modo')('fixo')}>Valor fixo</button><button type="button" className={'chip' + (pol.sinal_modo === 'pct' ? ' active' : '')} onClick={() => p('sinal_modo')('pct')}>% do serviço</button></div>
              {pol.sinal_modo === 'fixo' ? <label className="ob-campo ob-campo-reais"><span>R$</span><input value={pol.sinal_fixo} onChange={(e) => p('sinal_fixo')(e.target.value)} inputMode="decimal" /></label>
                : <div className="chips">{[30, 50, 100].map((v) => <button key={v} type="button" className={'chip' + (Number(pol.sinal_pct) === v ? ' active' : '')} onClick={() => p('sinal_pct')(v)}>{v}%</button>)}</div>}
              <small className="muted">Valor cobrado no momento do agendamento (pode ser abatido do valor final). Só funciona depois de ligar o recebimento pelo app em Ajustes.</small>
            </div>
          )}
          <label className="ob-campo">Quem confirma o horário<select value={pol.aceite_modo} onChange={(e) => p('aceite_modo')(e.target.value)}><option value="automatico">Entra confirmado na hora</option><option value="casa">A casa confirma{pol.aceite_modo === 'casa' ? ` (até ${pol.minutos_para_aceitar} min)` : ''}</option><option value="profissional">Cada profissional decide</option></select></label>
        </div>
        {!autonoma && (
          <div className="ob-card">
            <strong className="ob-card-titulo">Profissionais com agenda</strong>
            <span className="muted">Quantas atendem no salão? Recepção e administração não contam.</span>
            <div className="ob-contador"><button type="button" onClick={() => p('equipe_prevista')(Math.max(1, Number(pol.equipe_prevista) - 1))} aria-label="Menos"><Minus size={14} /></button><strong>{pol.equipe_prevista}</strong><button type="button" onClick={() => p('equipe_prevista')(Number(pol.equipe_prevista) + 1)} aria-label="Mais"><Plus size={14} /></button></div>
            {(() => { const c = planoDoNegocio('salao', pol.equipe_prevista); return (
              <div className="ob-preco-vivo"><small>{c.nome}</small><b>{emDinheiro(c.total)}<small> /mês</small></b><span>{c.extras === 0 ? `Até ${c.plano === 'pro' ? PLANOS.pro.inclusas : PLANOS.promais.inclusas} agendas inclusas.` : `${c.plano === 'pro' ? PLANOS.pro.inclusas : PLANOS.promais.inclusas} inclusas + ${c.extras} × ${emDinheiro(c.valorExtra)}.`} Nenhuma cobrança agora.</span></div>
            ) })()}
          </div>
        )}
        <div className="ob-card">
          <strong className="ob-card-titulo">Categorias de serviços</strong>
          <span className="muted">Quais categorias você oferece?</span>
          <div className="ob-cats">
            {minhasCats.map((c) => <span key={c.id} className="ob-cat">{c.nome}<button type="button" onClick={() => tirarCat(c)} aria-label={`Tirar ${c.nome}`}><X size={12} /></button></span>)}
            {CATEGORIAS_SUGERIDAS.filter((n) => !cats.some((c) => c.nome.toLowerCase() === n.toLowerCase())).map((n) => <button key={n} type="button" className="ob-cat sugerida" onClick={() => addCat(n)}><Plus size={12} /> {n}</button>)}
          </div>
          <div className="ob-add-cat"><input value={novaCat} onChange={(e) => setNovaCat(e.target.value)} placeholder="Adicionar categoria" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCat(novaCat) } }} /><button type="button" className="btn-mini" onClick={() => addCat(novaCat)}><Plus size={12} /> Adicionar categoria</button></div>
          {cats.some((c) => !c.salon_id) && <small className="muted">As categorias gerais do MIMO ({cats.filter((c) => !c.salon_id).map((c) => c.nome).join(', ')}) já valem pra todo mundo.</small>}
        </div>
      </div>
      <Rodape voltar={voltar} avancar={avancar} salvando={salvando} />
    </>
  )
}

// ---------- 4 · Serviços -----------------------------------------------------------
function PassoServicos({ s, seguir, voltar, salvando, erro, setErro, autonoma }) {
  const [servicos, setServicos] = useState(null)
  const [cats, setCats] = useState([])
  const [profs, setProfs] = useState([])
  const [quem, setQuem] = useState({})     // service_id → [professional_id]
  const [filtro, setFiltro] = useState('')
  const [modal, setModal] = useState(null) // null | 'novo' | serviço
  const [menu, setMenu] = useState(null)

  const carregar = useCallback(async () => {
    const [sv, ct, pr, ps] = await Promise.all([
      supabase.from('services').select('id, name, duration_minutes, price, images, categoria_id, active').eq('salon_id', s.id).eq('active', true).order('name'),
      supabase.from('categorias_de_servico').select('id, salon_id, nome, ordem').or(`salon_id.eq.${s.id},salon_id.is.null`).order('ordem'),
      supabase.from('professionals').select('id, name, user_id').eq('salon_id', s.id).eq('active', true).order('name'),
      supabase.from('professional_services').select('professional_id, service_id'),
    ])
    setServicos(sv.data ?? []); setCats(ct.data ?? []); setProfs(pr.data ?? [])
    const q = {}; for (const x of ps.data ?? []) { (q[x.service_id] ??= []).push(x.professional_id) }
    setQuem(q)
  }, [s.id])
  useEffect(() => { carregar() }, [carregar])

  const nomeCat = (id) => cats.find((c) => c.id === id)?.nome ?? 'Outros'
  const lista = (servicos ?? []).filter((x) => !filtro || x.categoria_id === filtro)
  async function remover(sv) {
    const { error } = await supabase.from('services').update({ active: false }).eq('id', sv.id)
    if (error) { setErro(error.message); return }
    setMenu(null); carregar()
  }
  return (
    <>
      <div className="ob-titulo-linha">
        <div><h1 className="ob-titulo">{autonoma ? 'Seus serviços' : 'O que o salão oferece'}</h1><p className="ob-sub">Nome, duração real e preço. Dá pra mudar depois.</p></div>
        <button type="button" className="btn btn-secondary ob-add" onClick={() => setModal('novo')}><Plus size={15} /> Adicionar serviço</button>
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="chips ob-chips">
        <button type="button" className={'chip' + (!filtro ? ' active' : '')} onClick={() => setFiltro('')}>Todos</button>
        {cats.filter((c) => (servicos ?? []).some((x) => x.categoria_id === c.id) || c.salon_id === s.id).map((c) => <button key={c.id} type="button" className={'chip' + (filtro === c.id ? ' active' : '')} onClick={() => setFiltro(c.id)}>{c.nome}</button>)}
      </div>
      <div className="ob-card ob-tabela-card">
        {!servicos ? <p className="muted">Carregando…</p> : lista.length === 0 ? (
          <div className="ob-vazio"><Sparkles size={22} /><strong>Nenhum serviço ainda</strong><span className="muted">Cadastre os principais: nome, duração e preço. Dá pra mudar depois.</span><button type="button" className="btn btn-primary" onClick={() => setModal('novo')}><Plus size={15} /> Adicionar serviço</button></div>
        ) : (
          <table className="ob-tabela">
            <thead><tr><th></th><th>Serviço</th><th>Categoria</th><th>Duração</th><th>Preço</th><th>Profissional</th><th></th></tr></thead>
            <tbody>
              {lista.map((sv) => {
                const q = quem[sv.id] ?? []
                const rotulo = q.length === 0 || q.length === profs.length ? 'Qualquer' : q.map((id) => profs.find((p) => p.id === id)?.name?.split(' ')[0]).filter(Boolean).join(', ')
                return (
                  <tr key={sv.id}>
                    <td className="ob-td-foto">{sv.images?.[0] ? <img src={sv.images[0]} alt="" /> : <span className="ob-foto-vazia"><Sparkles size={14} /></span>}</td>
                    <td><strong>{sv.name}</strong></td>
                    <td><span className="ob-cat-selo">{nomeCat(sv.categoria_id)}</span></td>
                    <td>{sv.duration_minutes} min</td>
                    <td>{formatPreco(sv.price)}</td>
                    <td className="muted">{rotulo}</td>
                    <td className="ob-td-menu">
                      <button type="button" className="ob-menu-btn" onClick={() => setMenu(menu === sv.id ? null : sv.id)} aria-label="Opções"><MoreHorizontal size={16} /></button>
                      {menu === sv.id && <span className="ob-menu"><button type="button" onClick={() => { setMenu(null); setModal(sv) }}>Editar</button><button type="button" className="perigo" onClick={() => remover(sv)}>Remover</button></span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {modal && <ModalServico salaoId={s.id} servico={modal === 'novo' ? null : modal} cats={cats} profs={profs} quem={modal === 'novo' ? [] : (quem[modal.id] ?? [])} onFechar={() => setModal(null)} onSalvo={() => { setModal(null); carregar() }} />}
      <Rodape voltar={voltar} avancar={() => seguir({})} salvando={salvando} />
    </>
  )
}

function ModalServico({ salaoId, servico, cats, profs, quem, onFechar, onSalvo }) {
  const [f, setF] = useState({ name: servico?.name ?? '', categoria_id: servico?.categoria_id ?? '', duration_minutes: servico?.duration_minutes ?? 60, price: servico ? String(Number(servico.price).toFixed(2)).replace('.', ',') : '' })
  const [sel, setSel] = useState(quem.length ? quem : [])   // vazio = qualquer
  const [foto, setFoto] = useState(servico?.images?.[0] ? { url: servico.images[0] } : null)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const arq = useRef(null)
  const m = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  async function trocarFoto(e) { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { setFoto(await reduzirFoto(file, { max: 1200 })) } catch (err) { setErro(err.message) } }
  async function salvar() {
    if (!f.name.trim()) { setErro('Diga o nome do serviço.'); return }
    const preco = reais(f.price) / 100
    if (!(preco > 0)) { setErro('Diga o preço.'); return }
    setSalvando(true); setErro('')
    try {
      let images = foto?.url ? [foto.url] : []
      if (foto?.blob) {
        const path = `${crypto.randomUUID()}.jpg`
        const { error } = await supabase.storage.from('service-images').upload(path, foto.blob, { contentType: 'image/jpeg' })
        if (error) throw new Error('Não deu para subir a foto: ' + error.message)
        images = [supabase.storage.from('service-images').getPublicUrl(path).data.publicUrl]
      }
      const payload = { name: f.name.trim(), duration_minutes: Number(f.duration_minutes) || 30, price: preco, images, categoria_id: f.categoria_id || null }
      const q = servico ? supabase.from('services').update(payload).eq('id', servico.id).select('id').maybeSingle() : supabase.from('services').insert({ ...payload, salon_id: salaoId }).select('id').maybeSingle()
      const { data, error } = await q
      if (error) throw new Error(error.message)
      const id = data?.id ?? servico?.id
      // quem faz: vazio = todas as profissionais ativas
      const alvo = sel.length ? sel : profs.map((p) => p.id)
      await supabase.from('professional_services').delete().eq('service_id', id)
      if (alvo.length) { const { error: ev } = await supabase.from('professional_services').insert(alvo.map((professional_id) => ({ professional_id, service_id: id }))); if (ev) throw new Error(ev.message) }
      onSalvo()
    } catch (err) { setErro(err.message) } finally { setSalvando(false) }
  }
  return (
    <div className="modal-fundo ob-modal-fundo" onClick={onFechar}>
      <div className="modal-caixa ob-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        <h3>{servico ? 'Editar serviço' : 'Adicionar serviço'}</h3>
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className="ob-modal-corpo">
          <button type="button" className={'ob-foto-serv' + (foto ? ' com' : '')} onClick={() => arq.current?.click()}>{foto ? <img src={foto.preview ?? foto.url} alt="" /> : <><Camera size={18} /><span>Foto</span></>}</button>
          <input ref={arq} type="file" accept="image/*" hidden onChange={trocarFoto} />
          <div className="ob-form">
            <label>Nome do serviço<input value={f.name} onChange={m('name')} placeholder="Corte feminino" autoFocus /></label>
            <label>Categoria<select value={f.categoria_id} onChange={m('categoria_id')}><option value="">Outros</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
            <div className="ob-linha-2">
              <label>Duração (min)<input type="number" min="5" step="5" value={f.duration_minutes} onChange={m('duration_minutes')} /></label>
              <label>Preço<span className="ob-campo-reais"><span>R$</span><input value={f.price} onChange={m('price')} inputMode="decimal" placeholder="120,00" /></span></label>
            </div>
            {profs.length > 1 && (
              <div className="ob-quem">
                <span className="ob-rotulo">Quem faz</span>
                <div className="chips"><button type="button" className={'chip' + (sel.length === 0 ? ' active' : '')} onClick={() => setSel([])}>Qualquer</button>{profs.map((p) => <button key={p.id} type="button" className={'chip' + (sel.includes(p.id) ? ' active' : '')} onClick={() => setSel((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id]))}>{p.name.split(' ')[0]}</button>)}</div>
              </div>
            )}
          </div>
        </div>
        <div className="ob-modal-acoes"><button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button><button type="button" className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar serviço'}</button></div>
      </div>
    </div>
  )
}

// ---------- 5 · Equipe e vínculos ---------------------------------------------------
function PassoEquipe({ s, seguir, voltar, salvando, erro, setErro, user }) {
  const [profs, setProfs] = useState(null)
  const [servicos, setServicos] = useState([])
  const [modal, setModal] = useState(false)
  const [menu, setMenu] = useState(null)
  const [copiado, setCopiado] = useState(false)
  const qr = useRef(null)
  const link = urlDoAmbiente('pro', `/equipe/${s.codigo_equipe ?? ''}`)
  const carregar = useCallback(async () => {
    const [pr, sv] = await Promise.all([
      supabase.from('professionals').select('id, name, phone, user_id, photo_url, slug, especialidade, active').eq('salon_id', s.id).eq('active', true).order('created_at'),
      supabase.from('services').select('id, name').eq('salon_id', s.id).eq('active', true).order('name'),
    ])
    setProfs(pr.data ?? []); setServicos(sv.data ?? [])
  }, [s.id])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { if (qr.current && link) QRCode.toCanvas(qr.current, link, { width: 96, margin: 1, color: { dark: '#1f2026', light: '#ffffff' } }).catch(() => {}) }, [link])

  function copiar() { navigator.clipboard?.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 2000) }
  async function remover(p) {
    if (p.user_id === user?.id) { setErro('Você é a dona: não dá pra se tirar da equipe.'); return }
    const { error } = await supabase.from('professionals').update({ active: false }).eq('id', p.id)
    if (error) { setErro(error.message); return }
    setMenu(null); carregar()
  }
  return (
    <>
      <div className="ob-titulo-linha">
        <div><h1 className="ob-titulo">Quem atende</h1><p className="ob-sub">Você configura tudo; elas entram pelo link da equipe.</p></div>
        <button type="button" className="btn btn-primary ob-add" onClick={() => setModal(true)}><Plus size={15} /> Convidar profissional</button>
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="ob-nota ob-nota-roxa"><span className="ob-nota-icone"><Store size={16} /></span><span><strong>Todos no mesmo salão</strong><small>Cada profissional pode ter seu próprio link de agendamento, mas continuará vinculado ao seu salão, compartilhando a agenda e os clientes.</small></span></div>
      <div className="ob-equipe">
        {!profs ? <p className="muted">Carregando…</p> : profs.length === 0 ? <p className="muted ob-equipe-vazia">Ninguém ainda. Convide pelo botão, ou mande o link abaixo pra elas se cadastrarem sozinhas.</p> : profs.map((p) => {
          const dona = p.user_id === user?.id || (p.user_id && p.user_id === s.owner_id)
          return (
            <div key={p.id} className="ob-pessoa">
              <Avatar nome={p.name} foto={p.photo_url} />
              <span className="ob-pessoa-texto">
                <strong>{p.name} <em className={'ob-papel' + (dona ? ' dona' : '')}>{dona ? 'Administradora' : 'Profissional'}</em></strong>
                <span className="muted">{p.especialidade || p.phone || 'sem contato'}</span>
              </span>
              <span className="ob-pessoa-lado">
                {p.user_id ? <em className="ob-vinculo ok"><CheckCircle2 size={12} /> Vinculada ao salão</em> : <em className="ob-vinculo espera"><Info size={12} /> Aguardando ela entrar</em>}
                {p.slug && <a className="ob-ver-link" href={urlDoAmbiente('cliente', `/p/${p.slug}`)} target="_blank" rel="noreferrer"><Link2 size={12} /> Ver link</a>}
              </span>
              <span className="ob-td-menu">
                <button type="button" className="ob-menu-btn" onClick={() => setMenu(menu === p.id ? null : p.id)} aria-label="Opções"><MoreHorizontal size={16} /></button>
                {menu === p.id && <span className="ob-menu">{!dona && <button type="button" className="perigo" onClick={() => remover(p)}>Tirar da equipe</button>}{dona && <span className="muted">Você é a administradora.</span>}</span>}
              </span>
            </div>
          )
        })}
      </div>
      <div className="ob-convite">
        <div className="ob-convite-texto">
          <strong><Link2 size={15} /> Link convite para profissionais</strong>
          <span className="muted">Compartilhe este link para que profissionais se cadastrem e já fiquem vinculados ao seu salão.</span>
          <div className="ob-link"><input readOnly value={link} onFocus={(e) => e.target.select()} /><button type="button" className="btn-mini" onClick={copiar}><Copy size={12} /> {copiado ? 'Copiado!' : 'Copiar link'}</button></div>
        </div>
        <div className="ob-convite-qr"><canvas ref={qr} /><small className="muted">Ou aponte o QR Code</small></div>
      </div>
      {modal && <ModalProfissional salaoId={s.id} servicos={servicos} onFechar={() => setModal(false)} onSalvo={() => { setModal(false); carregar() }} />}
      <Rodape voltar={voltar} avancar={() => seguir({})} salvando={salvando} />
    </>
  )
}

function ModalProfissional({ salaoId, servicos, onFechar, onSalvo }) {
  const [f, setF] = useState({ name: '', phone: '', especialidade: '' })
  const [sel, setSel] = useState([])
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const m = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  async function salvar() {
    if (!f.name.trim()) { setErro('Diga o nome.'); return }
    if (!f.phone.trim()) { setErro('Diga o WhatsApp: é por ele que a conta dela se liga ao salão.'); return }
    setSalvando(true); setErro('')
    try {
      const slug = f.name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.random().toString(36).slice(2, 6)
      const { data, error } = await supabase.from('professionals').insert({ salon_id: salaoId, name: f.name.trim(), phone: f.phone.trim(), especialidade: f.especialidade.trim() || null, slug, active: true }).select('id').maybeSingle()
      if (error) throw new Error(error.message)
      const alvo = sel.length ? sel : servicos.map((x) => x.id)
      if (alvo.length) await supabase.from('professional_services').insert(alvo.map((service_id) => ({ professional_id: data.id, service_id })))
      onSalvo()
    } catch (err) { setErro(err.message) } finally { setSalvando(false) }
  }
  return (
    <div className="modal-fundo ob-modal-fundo" onClick={onFechar}>
      <div className="modal-caixa ob-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        <h3>Convidar profissional</h3>
        <p className="muted">Ela recebe o acesso quando criar a conta com este WhatsApp, ou pelo link de convite.</p>
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className="ob-form">
          <label>Nome<input value={f.name} onChange={m('name')} placeholder="Carla Mendes" autoFocus /></label>
          <label>WhatsApp<input type="tel" inputMode="numeric" value={f.phone} onChange={(e) => setF((x) => ({ ...x, phone: formatarFone(e.target.value) }))} placeholder="(11) 98765-4321" /></label>
          <label>Função <span className="muted">(opcional)</span><input value={f.especialidade} onChange={m('especialidade')} placeholder="Cabeleireira" /></label>
          {servicos.length > 0 && <div className="ob-quem"><span className="ob-rotulo">Serviços que ela faz</span><div className="chips"><button type="button" className={'chip' + (sel.length === 0 ? ' active' : '')} onClick={() => setSel([])}>Todos</button>{servicos.map((x) => <button key={x.id} type="button" className={'chip' + (sel.includes(x.id) ? ' active' : '')} onClick={() => setSel((y) => (y.includes(x.id) ? y.filter((z) => z !== x.id) : [...y, x.id]))}>{x.name}</button>)}</div></div>}
        </div>
        <div className="ob-modal-acoes"><button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button><button type="button" className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Convidar'}</button></div>
      </div>
    </div>
  )
}

// ---------- 6 · Clientes e ativação --------------------------------------------------
function PassoAtivacao({ s, voltar, salvando, erro, concluir, pronto, autonoma }) {
  const [copiado, setCopiado] = useState(false)
  const qr = useRef(null)
  const link = s.codigo ? urlDoAmbiente('cliente', `/v/${s.codigo}`) : linkDoCodigo('')
  useEffect(() => { if (qr.current && s.codigo) QRCode.toCanvas(qr.current, link, { width: 120, margin: 1, color: { dark: '#1f2026', light: '#ffffff' } }).catch(() => {}) }, [link, s.codigo])
  function copiar() { navigator.clipboard?.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 2000) }
  async function baixar() {
    try { const url = await QRCode.toDataURL(link, { width: 720, margin: 2 }); const a = document.createElement('a'); a.href = url; a.download = `qr-${s.codigo}.png`; a.click() } catch { /* nada */ }
  }
  return (
    <>
      <h1 className="ob-titulo">Pronta pra receber</h1>
      <p className="ob-sub">{autonoma ? 'Divulgue sua agenda e comece a receber agendamentos' : 'Divulgue seu salão e comece a receber agendamentos'}</p>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="ob-card ob-ativacao">
        <div>
          <strong className="ob-card-titulo">Link e QR Code {autonoma ? 'da sua agenda' : 'do salão'}</strong>
          <span className="muted">Compartilhe com seus clientes para que eles conheçam seu salão, e façam agendamentos.</span>
          <div className="ob-link"><input readOnly value={link} onFocus={(e) => e.target.select()} /><button type="button" className="btn-mini" onClick={copiar}><Copy size={12} /> {copiado ? 'Copiado!' : 'Copiar link'}</button></div>
          <span className="muted ob-codigo">Ou o código <b>{s.codigo}</b>, digitado no app.</span>
        </div>
        <div className="ob-qr-grande"><canvas ref={qr} /><small className="muted">QR Code do salão</small><button type="button" className="btn-mini btn-mini-neutro" onClick={baixar}><Download size={12} /> Baixar QR Code</button></div>
      </div>
      <div className="ob-duas">
        <div className="ob-card">
          <strong className="ob-card-titulo">Como funciona?</strong>
          <ol className="ob-como">
            <li><span>1</span><span><strong>Cliente acessa o link ou QR Code</strong><small>Ela visualiza seu salão, serviços e profissionais.</small></span></li>
            <li><span>2</span><span><strong>Faz o cadastro</strong><small>O cliente cria uma conta no MIMO.</small></span></li>
            <li><span>3</span><span><strong>Agenda com você ou com um profissional</strong><small>O cliente pode agendar com o salão ou com um profissional vinculado e verá todas as opções disponíveis.</small></span></li>
          </ol>
        </div>
        <div className="ob-card ob-importante">
          <strong className="ob-card-titulo"><Info size={15} /> Importante</strong>
          <span className="muted">Todo cliente ativado pelo link do seu salão ou pelo link de um profissional vinculado, ficará associado ao seu salão e terá acesso às agendas relacionadas.</span>
          <span className="ob-importante-icone"><Users size={34} /></span>
        </div>
      </div>
      {(() => { const c = planoDoNegocio(s.tipo, s.equipe_prevista); return (
        <div className="ob-resumo-plano">
          <div><small>Seu plano</small><strong>{c.nome}</strong><p>{autonoma ? 'Uma agenda, sem mensalidade, sem cartão.' : `${s.equipe_prevista || 1} ${(s.equipe_prevista || 1) === 1 ? 'agenda' : 'agendas'} · ${c.extras === 0 ? 'todas inclusas' : `${c.extras} além das inclusas`}. Nenhuma cobrança agora: a mensalidade é combinada com a MIMO.`}</p></div>
          <b>{c.total === 0 ? 'Grátis' : <>{emDinheiro(c.total)}<small> /mês</small></>}</b>
        </div>
      ) })()}
      <div className="ob-pronto"><span className="ob-pronto-check"><Check size={18} /></span><span><strong>Tudo pronto!</strong><small>{autonoma ? 'Sua agenda está configurada. Agora é só divulgar o link.' : 'Seu salão está configurado. Agora é só começar a receber agendamentos.'}</small></span></div>
      <Rodape voltar={voltar} avancar={concluir} salvando={salvando || pronto} rotulo="Finalizar e entrar no painel" icone={<ArrowRight size={16} />} />
    </>
  )
}
