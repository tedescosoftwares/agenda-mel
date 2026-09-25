import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { Check, ArrowLeft, ArrowRight, LogOut, Camera, MapPin, Plus, X, Copy, Download, MoreHorizontal, Link2, Info, Crown, Sparkles, MessageCircle, Users, Minus, Eye, Lock, Wand2, CalendarCheck, QrCode, Send, Home } from 'lucide-react'
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
import { sugestoesPara, primeiroNome } from '../lib/equipe'
import ProfissionalDrawer, { CartaoProfissional } from '../components/ProfissionalDrawer'
import { FraseDeAceite } from '../components/LinkLegal'
import { useDocumentosLegais, aceitesPara, versaoMaior } from '../lib/legal'
import RodapeSocial from '../components/RodapeSocial'

// O onboarding do salão (114, 119): do cadastro à agenda em seis passos, o
// mesmo fluxo no computador e no celular. Cada passo explica por que
// pergunta, mostra o efeito da escolha, grava sozinho (autosave) e a
// conta lembra onde parou; quem sair volta pro mesmo lugar. A autônoma
// passa por cinco: não tem o passo da equipe.
// cada passo tem a foto, o bilhete e a frase do painel da esquerda
const PASSOS = [
  { id: 1, rotulo: 'Tipo de conta', foto: 'profissional', bilhete: 'bem-vinda', titulo: 'Sua rotina no lugar.', texto: 'Escolha como você trabalha. Autônoma é grátis; salão paga só pelas agendas que usa.' },
  { id: 2, rotulo: 'Dados do salão', foto: 'salao', bilhete: 'é a cara da casa', titulo: 'O que a cliente vê.', texto: 'Nome, foto, WhatsApp e endereço aparecem na página do seu negócio e no app da cliente.' },
  { id: 3, rotulo: 'Estrutura e operação', foto: 'agenda-celular', bilhete: 'do seu jeito', titulo: 'Como o dia funciona.', texto: 'Horário, regras de agendamento e quantas agendas. Tudo muda depois em Ajustes.' },
  { id: 4, rotulo: 'Serviços', foto: 'lifestyle', bilhete: 'o que você faz', titulo: 'O cardápio da casa.', texto: 'Nome, duração real e preço. A duração é o que a agenda usa pra achar horário livre.' },
  { id: 5, rotulo: 'Equipe', foto: 'equipe', bilhete: 'quem atende', titulo: 'Monte sua operação.', texto: 'Você configura cada profissional. Ela recebe um link e entra com a agenda pronta.' },
  { id: 6, rotulo: 'Clientes e ativação', foto: 'qr', bilhete: 'do balcão pra agenda', titulo: 'Pronta pra receber.', texto: 'Imprima o QR, coloque no balcão e na bio. A cliente escaneia e marca sozinha.' },
]
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0]
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
const ANTECEDENCIAS = [[0, 'Sem antecedência'], [30, '30 minutos'], [60, '1 hora'], [120, '2 horas'], [240, '4 horas'], [720, '12 horas'], [1440, '24 horas'], [2880, '48 horas']]
const CANCELAMENTO = [['flexivel', '6 horas'], ['moderada', '12 horas'], ['rigorosa', '24 horas']]
const CATEGORIAS_SUGERIDAS = ['Cabelo', 'Unhas', 'Estética', 'Massagem', 'Sobrancelhas', 'Maquiagem', 'Depilação', 'Barba']
// a política que a maioria dos salões usa pra começar; muda depois em Ajustes
const RECOMENDADO = { antecedencia_min_minutos: 60, politica_cancelamento: 'moderada', permite_remarcar: true, sinal_ligado: false }
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

// Autosave: a tela muda um campo, espera um instante, grava e avisa
// baixinho ("Salvando… / Salvo / Erro ao salvar"). Nada de toast por campo.
function useAutosave(gravar, dados, { ativo = true, espera = 900 } = {}) {
  const [estado, setEstado] = useState('')   // '' | 'salvando' | 'salvo' | 'erro'
  const primeiro = useRef(true)
  const ultimo = useRef(JSON.stringify(dados))
  useEffect(() => {
    if (!ativo) return
    const agora = JSON.stringify(dados)
    if (primeiro.current) { primeiro.current = false; ultimo.current = agora; return }
    if (agora === ultimo.current) return
    ultimo.current = agora
    setEstado('salvando')
    const t = setTimeout(async () => {
      try { const ok = await gravar(); setEstado(ok === false ? 'erro' : 'salvo') } catch { setEstado('erro') }
    }, espera)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(dados), ativo])
  return estado
}
function EstadoSalvo({ estado }) {
  if (!estado) return null
  return <span className={'ob-salvo ' + estado} aria-live="polite">{estado === 'salvando' ? 'Salvando…' : estado === 'salvo' ? <><Check size={12} /> Salvo</> : 'Erro ao salvar'}</span>
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
  const [retomado, setRetomado] = useState(false)
  const [estadoAuto, setEstadoAuto] = useState('')
  const docsLegais = useDocumentosLegais()

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
    setPasso((p) => {
      if (p === 1 && !salao.onboarding_concluido_em && salao.onboarding_passo > 2) { setRetomado(true); return Math.min(6, salao.onboarding_passo) }
      return p
    })
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
  // o autosave grava sem mexer no passo e sem o "Salvando…" do botão
  async function gravarQuieto(dados) {
    if (!s?.id) { setS((x) => ({ ...x, ...dados })); return true }
    const { error } = await supabase.rpc('onboarding_salvar', { salao: s.id, dados })
    if (error) return false
    setS((x) => ({ ...x, ...dados }))
    return true
  }
  async function seguir(dados = {}) {
    const proximo = pular(passo)
    const ok = await gravar(dados, proximo)
    if (ok) { setPasso(proximo); setRetomado(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  }
  function voltar() { setPasso(voltarDe(passo)); setRetomado(false); window.scrollTo({ top: 0 }) }
  async function concluir() {
    setSalvando(true); setErro('')
    const { error } = await supabase.rpc('onboarding_concluir', { salao: s.id })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setPronto(true)
    // o onboarding já apresentou o app: conta como primeiro acesso feito (e os termos aceitos no cadastro)
    try { await supabase.rpc('aceitar_documentos', { aceites: aceitesPara(autonoma ? 'profissional' : 'salao', docsLegais), contexto: 'onboarding' }) } catch { /* já aceitos */ }
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

  const props = { s, setS, salvando, erro, setErro, seguir, voltar, gravar, gravarQuieto, setEstadoAuto, user, role, autonoma, docsLegais, concluir, pronto, publico, recarregarPerfil, navigate, irPara: (n) => { setPasso(n); window.scrollTo({ top: 0 }) } }
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
              <button type="button" onClick={() => { if (publico ? p.id <= 2 && i <= idx : (i <= idx || p.id <= (s.onboarding_passo ?? 1))) { setPasso(p.id); setRetomado(false) } }}>
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
        <div className="ob-conteudo-linha"><span className="ob-conteudo-num">Passo {idx + 1} de {total} · {atual.rotulo}</span><EstadoSalvo estado={estadoAuto} /></div>
        {retomado && <div className="ob-retomada"><Wand2 size={15} /><span><strong>Continuando de onde você parou.</strong> O que você já preencheu está guardado; os passos anteriores ficam no menu ao lado.</span><button type="button" onClick={() => setRetomado(false)} aria-label="Fechar"><X size={14} /></button></div>}
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
const Selo = ({ publico }) => publico
  ? <span className="ob-selo publico" title="Aparece na página do salão e no app da cliente"><Eye size={11} /> Visível para clientes</span>
  : <span className="ob-selo interno" title="Só você e a MIMO veem"><Lock size={11} /> Uso administrativo</span>

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
  const pro = PLANOS.pro
  return (
    <>
      <h1 className="ob-titulo">Como você trabalha?</h1>
      <p className="ob-sub">Escolha o tipo de conta. Você poderá mudar depois, sem perder seus dados.</p>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="ob-tipos">
        {[
          { id: 'salao', foto: 'equipe', pilula: 'Salão · MIMO Pro', titulo: 'Tenho salão, com equipe', texto: 'Para salões com duas ou mais profissionais.', bloco: 'Você controla a operação', itens: ['cadastra sua equipe', 'define serviços e horários', 'organiza agendas', 'configura permissões', 'acompanha a operação do salão'], destaque: 'Você configura tudo primeiro. Cada profissional recebe o acesso depois, com a agenda pronta.', preco: emDinheiro(pro.base), sub: `/mês até ${pro.inclusas} profissionais · ${emDinheiro(pro.extra)} por agenda a mais` },
          { id: 'autonoma', foto: 'profissional', pilula: 'Autônoma · grátis', titulo: 'Trabalho sozinha', texto: 'Para quem atende por conta própria.', bloco: 'Tudo seu, sem equipe', itens: ['sua agenda', 'seus serviços', 'seus horários', 'seus clientes', 'seu QR e link'], destaque: 'Sem menus ou configurações de equipe.', preco: 'R$ 0', sub: '/mês, sem cartão' },
        ].map((o) => (
          <button key={o.id} type="button" className={'ob-tipo' + (tipo === o.id ? ' ativo' : '')} onClick={() => setTipo(o.id)} aria-pressed={tipo === o.id}>
            <span className="ob-tipo-foto"><img src={`/imagens/${o.foto}-720.webp`} alt="" /><span className="ob-pilula">{o.pilula}</span></span>
            {tipo === o.id && <span className="ob-tipo-check"><Check size={14} /></span>}
            <strong>{o.titulo}</strong>
            <span className="muted">{o.texto}</span>
            <span className="ob-tipo-bloco"><small>{o.bloco}</small><ul>{o.itens.map((i) => <li key={i}><Check size={13} /> {i}</li>)}</ul></span>
            <span className="ob-tipo-destaque">{o.destaque}</span>
            <span className="ob-tipo-preco"><b>{o.preco}</b><small>{o.sub}</small></span>
          </button>
        ))}
      </div>
      <div className="ob-nota"><span className="ob-nota-icone"><Crown size={16} /></span><span><strong>Nenhuma cobrança neste cadastro</strong><small>A mensalidade do salão é combinada depois, direto com a MIMO. Autônoma não paga nada.</small></span></div>
      <Rodape primeiro avancar={avancar} salvando={salvando} />
    </>
  )
}

// ---------- 2 · Dados do salão -----------------------------------------------------
function PassoDados({ s, seguir, voltar, salvando, erro, setErro, user, autonoma, publico, recarregarPerfil, navigate, gravarQuieto, setEstadoAuto, docsLegais }) {
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
  // autosave dos campos de texto (a foto e o pino vão no Continuar)
  const estado = useAutosave(() => gravarQuieto({ name: f.name, cnpj: f.cnpj, whatsapp: f.whatsapp, email: f.email, responsavel_nome: f.responsavel_nome, address: f.address, bairro: f.bairro, city: f.city, uf: f.uf, cep: f.cep.replace(/\D/g, '') }), f, { ativo: Boolean(s.id) && !publico })
  useEffect(() => { setEstadoAuto(estado); return () => setEstadoAuto('') }, [estado, setEstadoAuto])

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
      const aceites = aceitesPara(s.tipo, docsLegais)
      const { error } = await signUp(f.email.trim(), conta.senha, f.responsavel_nome.trim(), f.whatsapp.trim(),
        { termos: versaoMaior(aceites), aceites, papel_desejado: s.tipo, nome_negocio: f.name.trim() || null, cidade: f.city.trim() || null, salao: dadosSalao })
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
        <div className="ob-pronto"><span className="ob-pronto-check"><Check size={18} /></span><span><strong>Mandamos um link para {f.email.trim()}</strong><small>Toque no link do e-mail e você volta pra cá já dentro do cadastro, no passo 3, sem precisar entrar de novo. Tudo o que preencheu está guardado{logo ? ' (a foto sobe quando abrir por este mesmo navegador)' : ''}.</small></span></div>
        <div className="ob-rodape"><span /><Link to="/pro/entrar" className="btn btn-ghost ob-continuar">Abri o link e não entrou? Entrar <ArrowRight size={16} /></Link></div>
      </>
    )
  }
  const iniciais = (f.name || 'ES').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()
  return (
    <>
      <h1 className="ob-titulo">{autonoma ? 'Seus dados' : 'A cara do salão'}</h1>
      <p className="ob-sub">{publico ? 'Essas informações formam a identidade do seu negócio na MIMO. Preencha e crie o seu acesso.' : autonoma ? 'Essas informações formam a sua identidade na MIMO: é o que as clientes veem.' : 'Essas informações formam a identidade do seu salão na MIMO.'}</p>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="ob-dados">
        <div className="ob-form">
          <span className="ob-grupo-selo"><Selo publico /></span>
          <label>{autonoma ? 'Nome da agenda' : 'Nome do salão'} <b>*</b><input value={f.name} onChange={m('name')} placeholder="Studio Essenza Hair" /></label>
          <label>WhatsApp {autonoma ? 'de contato' : 'comercial'} <b>*</b><span className="ob-fone"><span className="ob-ddi">🇧🇷 +55</span><input type="tel" inputMode="numeric" value={f.whatsapp} onChange={(e) => setF((x) => ({ ...x, whatsapp: formatarFone(e.target.value) }))} placeholder="(11) 91234-5678" autoComplete="tel" /></span></label>
          <span className="ob-grupo-selo ob-grupo-selo-2"><Selo /></span>
          {!autonoma && <label>CNPJ <span className="muted">(opcional)</span><input value={f.cnpj} onChange={m('cnpj')} placeholder="12.345.678/0001-90" inputMode="numeric" /></label>}
          <label>E-mail da conta <b>*</b>{publico && <span className="muted">(é com ele que você entra)</span>}<input type="email" value={f.email} onChange={m('email')} placeholder="contato@essenzahair.com.br" autoComplete="email" /></label>
          <label>{publico ? 'Seu nome completo' : 'Nome da responsável'} <b>*</b><input value={f.responsavel_nome} onChange={m('responsavel_nome')} placeholder="Juliana Lima" autoComplete="name" /></label>
          {publico && !user && (
            <>
              <label>Senha <b>*</b><input type="password" value={conta.senha} onChange={(e) => setConta((x) => ({ ...x, senha: e.target.value }))} placeholder="mínimo 6 caracteres" autoComplete="new-password" /></label>
              <label className="ob-termos"><input type="checkbox" checked={conta.termos} onChange={(e) => setConta((x) => ({ ...x, termos: e.target.checked }))} /><span><FraseDeAceite papel={s.tipo} /></span></label>
            </>
          )}
        </div>
        <div className="ob-form">
          <span className="ob-grupo-selo"><Selo publico /></span>
          <div className="ob-logo-campo">
            <span className="ob-rotulo">{autonoma ? 'Sua foto ou logo' : 'Logo ou foto do salão'}</span>
            <button type="button" className={'ob-logo' + (logo ? ' com' : '')} onClick={() => arq.current?.click()}>
              {logo ? <img src={logo.preview ?? logo.url} alt="" /> : <span className="ob-logo-vazio"><span className="ob-logo-iniciais">{iniciais}</span><span>{f.name || 'Seu salão'}</span></span>}
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
          {/* como a cliente vai ver: atualiza ao vivo */}
          <div className="ob-preview">
            <small><Eye size={11} /> Como sua cliente verá</small>
            <div className="ob-preview-cartao">
              <span className="ob-preview-logo">{logo ? <img src={logo.preview ?? logo.url} alt="" /> : iniciais}</span>
              <span className="ob-preview-texto"><strong>{f.name || (autonoma ? 'Sua agenda' : 'Seu salão')}</strong><span>{[f.bairro, f.city].filter(Boolean).join(' • ') || 'Bairro • Cidade'}</span></span>
              <span className="ob-preview-botao">Ver serviços</span>
            </div>
          </div>
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
function PassoEstrutura({ s, seguir, voltar, salvando, erro, setErro, autonoma, gravarQuieto, setEstadoAuto }) {
  const [horas, setHoras] = useState(null)
  const [cats, setCats] = useState([])
  const [novaCat, setNovaCat] = useState('')
  const [copiar, setCopiar] = useState(null)   // null | { dias: Set }
  const [tocouSinal, setTocouSinal] = useState(false)   // o recebimento pelo app só muda se a pessoa mexer no botão
  const [pol, setPol] = useState({ antecedencia_min_minutos: s.antecedencia_min_minutos ?? 60, politica_cancelamento: s.politica_cancelamento ?? 'moderada', permite_remarcar: s.permite_remarcar ?? true, sinal_ligado: (s.pagamento_modo ?? 'nao') !== 'nao', sinal_modo: s.sinal_modo ?? 'fixo', sinal_fixo: emReais(s.sinal_fixo_cents ?? 5000), sinal_pct: s.sinal_pct ?? 50, equipe_prevista: s.equipe_prevista ?? 4, aceite_modo: s.aceite_modo ?? 'casa', minutos_para_aceitar: s.minutos_para_aceitar ?? 120 })
  const p = (k) => (v) => setPol((x) => ({ ...x, [k]: v }))
  // pagamento_modo é o mesmo de Ajustes › Receber pelo app: desligar aqui desliga lá. Só vai no pacote se ela tocou no botão.
  const dadosDaPolitica = () => ({ antecedencia_min_minutos: Number(pol.antecedencia_min_minutos), politica_cancelamento: pol.politica_cancelamento, permite_remarcar: pol.permite_remarcar,
    ...(tocouSinal ? { pagamento_modo: pol.sinal_ligado ? (s.pagamento_modo && s.pagamento_modo !== 'nao' ? s.pagamento_modo : 'opcional') : 'nao' } : {}), sinal_modo: pol.sinal_modo, sinal_fixo_cents: reais(pol.sinal_fixo), sinal_pct: Number(pol.sinal_pct),
    equipe_prevista: Number(pol.equipe_prevista) || null, aceite_modo: pol.aceite_modo, minutos_para_aceitar: Number(pol.minutos_para_aceitar) })
  // autosave: as regras vão pelo onboarding_salvar; os horários, pelo onboarding_horarios
  const estado = useAutosave(async () => {
    const ok = await gravarQuieto(dadosDaPolitica())
    if (!horas || horas.some((h) => h.open && h.start_time >= h.end_time)) return ok
    const { error } = await supabase.rpc('onboarding_horarios', { salao: s.id, horarios: horas })
    return ok && !error
  }, { pol, horas }, { ativo: Boolean(s.id) && horas != null })
  useEffect(() => { setEstadoAuto(estado); return () => setEstadoAuto('') }, [estado, setEstadoAuto])

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
  function aplicarSegunda() {
    const seg = horas.find((h) => h.weekday === 1)
    setHoras((x) => x.map((h) => (copiar.dias.has(h.weekday) ? { ...h, open: seg.open, start_time: seg.start_time, end_time: seg.end_time } : h)))
    setCopiar(null)
  }
  const recomendadoAtivo = Number(pol.antecedencia_min_minutos) === RECOMENDADO.antecedencia_min_minutos && pol.politica_cancelamento === RECOMENDADO.politica_cancelamento && pol.permite_remarcar === RECOMENDADO.permite_remarcar && pol.sinal_ligado === RECOMENDADO.sinal_ligado

  async function avancar() {
    for (const h of horas ?? []) if (h.open && h.start_time >= h.end_time) { setErro(`${DIAS[h.weekday]}: o fim precisa ser depois do início.`); return }
    const { error } = await supabase.rpc('onboarding_horarios', { salao: s.id, horarios: horas })
    if (error) { setErro(error.message); return }
    seguir(dadosDaPolitica())
  }
  return (
    <>
      <h1 className="ob-titulo">Como o dia funciona</h1>
      <p className="ob-sub">{autonoma ? 'Defina como você atende no dia a dia. Tudo pode mudar depois em Ajustes.' : 'Defina como seu salão funciona no dia a dia. Tudo pode mudar depois em Ajustes.'}</p>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="ob-estrutura">
        <div className="ob-card">
          <strong className="ob-card-titulo">Horário de funcionamento</strong>
          <span className="muted">{autonoma ? 'O horário padrão da sua agenda. Folgas e feriados você marca depois, em Bloqueios.' : 'Defina o horário padrão do salão. Depois você personaliza os dias e horários de cada profissional.'}</span>
          {!horas ? <p className="muted">Carregando…</p> : (
            <div className="ob-horas">
              {horas.map((h) => (
                <div key={h.weekday} className={'ob-hora' + (h.open ? '' : ' fechado')}>
                  <span className="ob-hora-dia">{DIAS[h.weekday]}</span>
                  {h.open ? <><input type="time" value={h.start_time} onChange={(e) => mudaHora(h.weekday, 'start_time', e.target.value)} /><span className="muted">–</span><input type="time" value={h.end_time} onChange={(e) => mudaHora(h.weekday, 'end_time', e.target.value)} /></> : <span className="ob-hora-fechado">Fechado</span>}
                  <label className="switch"><input type="checkbox" checked={h.open} onChange={(e) => mudaHora(h.weekday, 'open', e.target.checked)} /><span></span></label>
                </div>
              ))}
              <div className="ob-copiar">
                <button type="button" className="link-ver" onClick={() => setCopiar(copiar ? null : { dias: new Set([2, 3, 4, 5]) })}><Copy size={12} /> Copiar segunda para os demais dias</button>
                {copiar && (
                  <div className="ob-copiar-caixa">
                    <small>Aplicar para:</small>
                    {[2, 3, 4, 5, 6, 0].map((d) => <label key={d}><input type="checkbox" checked={copiar.dias.has(d)} onChange={(e) => setCopiar((c) => { const dias = new Set(c.dias); if (e.target.checked) dias.add(d); else dias.delete(d); return { dias } })} /> {DIAS[d]}</label>)}
                    <button type="button" className="btn-mini" onClick={aplicarSegunda}>Aplicar</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="ob-card">
          <span className="ob-card-linha"><strong className="ob-card-titulo">Política de agendamento</strong>{recomendadoAtivo && <em className="ob-badge">Recomendado para começar</em>}</span>
          {!recomendadoAtivo && (
            <div className="ob-recomendado">
              <small><Wand2 size={12} /> Configuração recomendada</small>
              <span className="muted">Antecedência mínima 1 hora · cancelamento até 12 h antes · reagendamento permitido · sinal desligado · confirmação como está.</span>
              <button type="button" className="btn-mini" onClick={() => setPol((x) => ({ ...x, ...RECOMENDADO }))}>Usar recomendado</button>
            </div>
          )}
          <label className="ob-campo">Antecedência mínima<select value={pol.antecedencia_min_minutos} onChange={(e) => p('antecedencia_min_minutos')(e.target.value)}>{ANTECEDENCIAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select><small className="muted">Quanto antes do horário a cliente ainda consegue marcar.</small></label>
          <label className="ob-campo">Cancelamento gratuito até<select value={pol.politica_cancelamento} onChange={(e) => p('politica_cancelamento')(e.target.value)}>{CANCELAMENTO.map(([v, r]) => <option key={v} value={v}>{r} antes</option>)}</select></label>
          <div className="ob-toggle"><span>Permitir reagendamento</span><label className="switch"><input type="checkbox" checked={pol.permite_remarcar} onChange={(e) => p('permite_remarcar')(e.target.checked)} /><span></span></label></div>
          <div className="ob-toggle"><span>Sinal pelo app <span className="muted">(opcional)</span></span><label className="switch"><input type="checkbox" checked={pol.sinal_ligado} onChange={(e) => { setTocouSinal(true); p('sinal_ligado')(e.target.checked) }} /><span></span></label></div>
          {tocouSinal && !pol.sinal_ligado && (s.pagamento_modo ?? 'nao') !== 'nao' && <small className="ob-aviso-sinal">Desligar aqui desliga o recebimento pelo app do salão inteiro (sinal e pagamento), o mesmo de Ajustes › Receber pelo app.</small>}
          {pol.sinal_ligado && (
            <div className="ob-sinal">
              <div className="chips"><button type="button" className={'chip' + (pol.sinal_modo === 'fixo' ? ' active' : '')} onClick={() => p('sinal_modo')('fixo')}>Valor fixo</button><button type="button" className={'chip' + (pol.sinal_modo === 'pct' ? ' active' : '')} onClick={() => p('sinal_modo')('pct')}>% do serviço</button></div>
              {pol.sinal_modo === 'fixo' ? <label className="ob-campo ob-campo-reais"><span>R$</span><input value={pol.sinal_fixo} onChange={(e) => p('sinal_fixo')(e.target.value)} inputMode="decimal" /></label>
                : <div className="chips">{[30, 50, 100].map((v) => <button key={v} type="button" className={'chip' + (Number(pol.sinal_pct) === v ? ' active' : '')} onClick={() => p('sinal_pct')(v)}>{v}%</button>)}</div>}
              <small className="muted">Valor cobrado no momento do agendamento (pode ser abatido do valor final). Só funciona depois de ligar o recebimento pelo app em Ajustes.</small>
            </div>
          )}
          <label className="ob-campo">Quem confirma o horário<select value={pol.aceite_modo} onChange={(e) => p('aceite_modo')(e.target.value)}><option value="automatico">Entra confirmado na hora</option><option value="casa">A casa confirma{pol.aceite_modo === 'casa' ? ` (até ${pol.minutos_para_aceitar} min)` : ''}</option><option value="profissional">Cada profissional decide</option></select></label>
          <small className="muted">Você poderá mudar essas regras a qualquer momento em Ajustes.</small>
        </div>
        {!autonoma && (
          <div className="ob-card">
            <strong className="ob-card-titulo">Profissionais com agenda</strong>
            <span className="muted">Quantas pessoas atendem clientes e precisam de agenda própria? Recepção, administração e pessoas sem agenda não contam.</span>
            <div className="ob-contador"><button type="button" onClick={() => p('equipe_prevista')(Math.max(1, Number(pol.equipe_prevista) - 1))} aria-label="Menos"><Minus size={14} /></button><strong>{pol.equipe_prevista}</strong><button type="button" onClick={() => p('equipe_prevista')(Number(pol.equipe_prevista) + 1)} aria-label="Mais"><Plus size={14} /></button></div>
            {(() => { const c = planoDoNegocio('salao', pol.equipe_prevista); return (
              <div className="ob-preco-vivo"><small>{c.nome}</small><b>{emDinheiro(c.total)}<small> /mês</small></b><span>{c.extras === 0 ? `Até ${c.plano === 'pro' ? PLANOS.pro.inclusas : PLANOS.promais.inclusas} agendas inclusas.` : `${c.plano === 'pro' ? PLANOS.pro.inclusas : PLANOS.promais.inclusas} inclusas + ${c.extras} × ${emDinheiro(c.valorExtra)}.`} Nenhuma cobrança agora.</span></div>
            ) })()}
          </div>
        )}
        <div className="ob-card">
          <strong className="ob-card-titulo">Categorias de serviços</strong>
          <span className="muted">Escolha apenas as categorias que fazem sentido para {autonoma ? 'você' : 'o salão'}. Elas organizam o cadastro dos serviços no próximo passo.</span>
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
  const [modal, setModal] = useState(null) // null | 'novo' | serviço | { sugestao }
  const [menu, setMenu] = useState(null)
  const [exemplos, setExemplos] = useState(false)

  const carregar = useCallback(async () => {
    const [sv, ct, pr, ps] = await Promise.all([
      supabase.from('services').select('id, name, description, duration_minutes, price, a_partir, images, categoria_id, active').eq('salon_id', s.id).eq('active', true).order('name'),
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
  // sugestões rápidas pelas categorias do salão (nome + duração de referência; preço nunca é inventado)
  const minhasCats = cats.filter((c) => c.salon_id === s.id)
  const sugestoes = useMemo(() => {
    const vistos = new Set((servicos ?? []).map((x) => x.name.toLowerCase()))
    const out = []
    for (const c of (minhasCats.length ? minhasCats : cats)) for (const [nome, min] of sugestoesPara(c.nome)) if (!vistos.has(nome.toLowerCase()) && !out.some((o) => o.nome === nome)) out.push({ nome, min, categoria_id: c.id })
    return out.slice(0, 14)
  }, [cats, minhasCats, servicos])
  async function remover(sv) {
    const { error } = await supabase.from('services').update({ active: false }).eq('id', sv.id)
    if (error) { setErro(error.message); return }
    setMenu(null); carregar()
  }
  const vazio = (servicos ?? []).length === 0
  return (
    <>
      <div className="ob-titulo-linha">
        <div><h1 className="ob-titulo">{vazio ? 'Comece pelos serviços mais importantes' : autonoma ? 'Seus serviços' : 'O que o salão oferece'}</h1><p className="ob-sub">{vazio ? 'Você não precisa cadastrar tudo agora. Adicione de 3 a 5 serviços principais para começar a usar a agenda.' : 'Nome, duração real e preço. A duração é o que a agenda usa pra achar horário livre.'}</p></div>
        {!vazio && <button type="button" className="btn btn-secondary ob-add" onClick={() => setModal('novo')}><Plus size={15} /> Adicionar serviço</button>}
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}
      {!vazio && (
        <div className="chips ob-chips">
          <button type="button" className={'chip' + (!filtro ? ' active' : '')} onClick={() => setFiltro('')}>Todos</button>
          {cats.filter((c) => (servicos ?? []).some((x) => x.categoria_id === c.id) || c.salon_id === s.id).map((c) => <button key={c.id} type="button" className={'chip' + (filtro === c.id ? ' active' : '')} onClick={() => setFiltro(c.id)}>{c.nome}</button>)}
        </div>
      )}
      <div className="ob-card ob-tabela-card">
        {!servicos ? <p className="muted">Carregando…</p> : lista.length === 0 ? (
          <div className="ob-vazio"><Sparkles size={22} /><strong>{vazio ? 'Nenhum serviço ainda' : 'Nada nessa categoria'}</strong><span className="muted">Nome, duração e preço. Dá pra mudar depois, e a cliente só vê o que está aqui.</span><span className="ob-vazio-acoes"><button type="button" className="btn btn-primary" onClick={() => setModal('novo')}><Plus size={15} /> Adicionar serviço</button>{sugestoes.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => setExemplos((x) => !x)}>{exemplos ? 'Esconder exemplos' : 'Ver exemplos'}</button>}</span></div>
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
                    <td>{sv.a_partir ? <span className="muted">a partir de </span> : null}{formatPreco(sv.price)}</td>
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
      {sugestoes.length > 0 && (exemplos || !vazio) && (
        <div className="ob-sugestoes">
          <small><Sparkles size={12} /> Sugestões rápidas pelas suas categorias · toque pra preencher nome e categoria; o preço é seu</small>
          <div className="chips">{sugestoes.map((x) => <button key={x.nome} type="button" className="chip" onClick={() => setModal({ sugestao: x })}><Plus size={12} /> {x.nome}</button>)}</div>
        </div>
      )}
      {modal && <ModalServico salaoId={s.id} servico={modal === 'novo' || modal.sugestao ? null : modal} sugestao={modal.sugestao} cats={cats} profs={profs} quem={modal === 'novo' || modal.sugestao ? [] : (quem[modal.id] ?? [])} onFechar={() => setModal(null)} onSalvo={() => { setModal(null); carregar() }} />}
      <Rodape voltar={voltar} avancar={() => seguir({})} salvando={salvando} />
    </>
  )
}

function ModalServico({ salaoId, servico, sugestao, cats, profs, quem, onFechar, onSalvo }) {
  const [f, setF] = useState({ name: servico?.name ?? sugestao?.nome ?? '', categoria_id: servico?.categoria_id ?? sugestao?.categoria_id ?? '', duration_minutes: servico?.duration_minutes ?? sugestao?.min ?? 60, price: servico ? String(Number(servico.price).toFixed(2)).replace('.', ',') : '', a_partir: Boolean(servico?.a_partir), description: servico?.description ?? '' })
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
      const payload = { name: f.name.trim(), duration_minutes: Number(f.duration_minutes) || 30, price: preco, images, categoria_id: f.categoria_id || null, a_partir: f.a_partir, description: f.description.trim() || null }
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
        {sugestao && <p className="muted">Nome e categoria já preenchidos. A duração é só uma referência; confira, e o preço é o seu.</p>}
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className="ob-modal-corpo">
          <button type="button" className={'ob-foto-serv' + (foto ? ' com' : '')} onClick={() => arq.current?.click()}>{foto ? <img src={foto.preview ?? foto.url} alt="" /> : <><Camera size={18} /><span>Foto</span></>}</button>
          <input ref={arq} type="file" accept="image/*" hidden onChange={trocarFoto} />
          <div className="ob-form">
            <label>Nome do serviço<input value={f.name} onChange={m('name')} placeholder="Corte feminino" autoFocus /></label>
            <label>Categoria<select value={f.categoria_id} onChange={m('categoria_id')}><option value="">Outros</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
            <div className="ob-linha-2">
              <label>Duração (min)<input type="number" min="5" step="5" value={f.duration_minutes} onChange={m('duration_minutes')} /><small className="muted">A agenda usa a duração para calcular os horários disponíveis.</small></label>
              <label>Preço<span className="ob-campo-reais"><span>R$</span><input value={f.price} onChange={m('price')} inputMode="decimal" placeholder="120,00" /></span><small className="muted">Esse valor é exibido para a cliente.</small></label>
            </div>
            <label className="ob-termos"><input type="checkbox" checked={f.a_partir} onChange={(e) => setF((x) => ({ ...x, a_partir: e.target.checked }))} /><span>Exibir como "a partir de"{f.price ? ` — A partir de ${formatPreco(reais(f.price) / 100)}` : ''}<small className="muted"> · pra progressiva, coloração e o que depende de tamanho ou volume</small></span></label>
            <label>Descrição para a cliente <span className="muted">(opcional)</span><input value={f.description} onChange={m('description')} placeholder="inclui lavagem e finalização" /></label>
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

// ---------- 5 · Equipe --------------------------------------------------------------
// O salão configura a profissional; ela só ativa o acesso. A lista vem da
// equipe_da_casa (situação, serviços, dias, token); a gaveta salva tudo.
function PassoEquipe({ s, seguir, voltar, salvando, erro, setErro }) {
  const [equipe, setEquipe] = useState(null)
  const [servicos, setServicos] = useState([])
  const [cats, setCats] = useState([])
  const [gaveta, setGaveta] = useState(null)   // null | 'nova' | profissional
  const [menu, setMenu] = useState(null)
  const [aviso, setAviso] = useState('')
  const [coletar, setColetar] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const qr = useRef(null)
  const link = urlDoAmbiente('pro', `/equipe/${s.codigo_equipe ?? ''}`)
  const carregar = useCallback(async () => {
    const [eq, sv, ct] = await Promise.all([
      supabase.rpc('equipe_da_casa', { salao: s.id }),
      supabase.from('services').select('id, name, price, duration_minutes, categoria_id').eq('salon_id', s.id).eq('active', true).order('name'),
      supabase.from('categorias_de_servico').select('id, salon_id, nome').or(`salon_id.eq.${s.id},salon_id.is.null`),
    ])
    setEquipe(Array.isArray(eq.data) ? eq.data : []); setServicos(sv.data ?? []); setCats(ct.data ?? [])
  }, [s.id])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { if (coletar && qr.current && link) QRCode.toCanvas(qr.current, link, { width: 88, margin: 1, color: { dark: '#1f2026', light: '#ffffff' } }).catch(() => {}) }, [link, coletar])

  function copiar() { navigator.clipboard?.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 2000) }
  async function acao(qual, p) {
    setErro(''); setAviso('')
    if (qual === 'enviado') { try { await supabase.rpc('equipe_acesso_enviado', { prof: p.id }) } catch { /* segue */ } carregar(); return }
    if (qual === 'copiado') { setAviso(`Link de acesso de ${primeiroNome(p.name)} copiado.`); try { await supabase.rpc('equipe_acesso_enviado', { prof: p.id }) } catch { /* segue */ } carregar(); return }
    if (qual === 'remover' && !window.confirm(`Remover ${p.name} do salão? O histórico de atendimentos dela fica guardado.`)) return
    const { error } = await supabase.rpc('equipe_situacao', { prof: p.id, acao: qual })
    if (error) { setErro(error.message); return }
    carregar()
  }
  const pendentes = (equipe ?? []).filter((p) => p.situacao === 'configurada' && !p.user_id)
  const lista = equipe ?? []
  return (
    <>
      <div className="ob-titulo-linha">
        <div><h1 className="ob-titulo">Monte sua equipe</h1><p className="ob-sub">Você configura cada profissional. Depois ela recebe um link e entra com a agenda pronta.</p></div>
        <button type="button" className="btn btn-primary ob-add" onClick={() => setGaveta('nova')}><Plus size={15} /> Adicionar profissional</button>
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}
      {aviso && <div className="alert alert-info">{aviso}</div>}
      <div className="eq-bloco">
        <span className="eq-bloco-icone"><Home size={17} /></span>
        <div>
          <strong>Tudo continua dentro do salão</strong>
          <p>Cada profissional tem a própria agenda, mas continua vinculada ao salão. Você define como ela trabalha, quais serviços faz, horários, repasse e permissões. Depois ela recebe apenas o acesso.</p>
        </div>
      </div>
      <div className="eq-lista">
        {!equipe ? <p className="muted">Carregando…</p> : lista.length === 0 ? (
          <div className="ob-vazio"><Users size={22} /><strong>Ninguém na equipe ainda</strong><span className="muted">Adicione a primeira profissional: leva um minuto e ela já entra com tudo pronto.</span><button type="button" className="btn btn-primary" onClick={() => setGaveta('nova')}><Plus size={15} /> Adicionar profissional</button></div>
        ) : lista.map((p) => <CartaoProfissional key={p.id} p={p} salao={s} onConfigurar={(x) => setGaveta(x)} onAcao={acao} menuAberto={menu} setMenu={setMenu} />)}
      </div>
      {pendentes.length > 0 && <p className="ob-dica"><Info size={13} /> {pendentes.length === 1 ? `${primeiroNome(pendentes[0].name)} ainda não ativou o acesso.` : `${pendentes.length} profissionais ainda não ativaram o acesso.`} Mande o link pelo WhatsApp: ela confirma o número, cria a senha e entra.</p>}
      <div className="eq-coletar">
        <div>
          <strong><Link2 size={14} /> Coletar dados da equipe por link</strong>
          <p>Salão grande? Compartilhe este link para a profissional informar nome e WhatsApp. Você conclui a configuração dela antes de liberar o acesso.</p>
          {coletar ? <div className="ob-link"><input readOnly value={link} onFocus={(e) => e.target.select()} /><button type="button" className="btn-mini" onClick={copiar}><Copy size={12} /> {copiado ? 'Copiado!' : 'Copiar link'}</button></div> : <button type="button" className="btn-mini btn-mini-neutro" onClick={() => setColetar(true)}>Mostrar link</button>}
        </div>
        {coletar && <div className="eq-coletar-qr"><canvas ref={qr} /><span>ou o QR</span></div>}
      </div>
      {gaveta && <ProfissionalDrawer salao={s} profissional={gaveta === 'nova' ? null : gaveta} servicos={servicos} cats={cats} onFechar={() => { setGaveta(null); carregar() }} onSalvo={() => carregar()} />}
      <Rodape voltar={voltar} avancar={() => seguir({})} salvando={salvando} />
    </>
  )
}

// ---------- 6 · Clientes e ativação --------------------------------------------------
function PassoAtivacao({ s, voltar, salvando, erro, concluir, pronto, autonoma, irPara }) {
  const [copiado, setCopiado] = useState(false)
  const [resumo, setResumo] = useState(null)
  const qr = useRef(null)
  const link = s.codigo ? urlDoAmbiente('cliente', `/v/${s.codigo}`) : linkDoCodigo('')
  useEffect(() => { if (qr.current && s.codigo) QRCode.toCanvas(qr.current, link, { width: 120, margin: 1, color: { dark: '#1f2026', light: '#ffffff' } }).catch(() => {}) }, [link, s.codigo])
  useEffect(() => { supabase.rpc('primeiros_passos', { salao: s.id }).then(({ data }) => setResumo(data ?? {})) }, [s.id])
  function copiar() { navigator.clipboard?.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 2000) }
  async function feito(chave) { try { await supabase.rpc('primeiro_passo_feito', { salao: s.id, chave }); setResumo((r) => ({ ...r, feitos: { ...(r?.feitos ?? {}), [chave]: new Date().toISOString() } })) } catch { /* segue */ } }
  async function baixar() {
    try { const url = await QRCode.toDataURL(link, { width: 720, margin: 2 }); const a = document.createElement('a'); a.href = url; a.download = `qr-${s.codigo}.png`; a.click(); feito('qr_baixado') } catch { /* nada */ }
  }
  function testar() { window.open(link, '_blank', 'noopener'); feito('agendamento_teste') }
  const n = (k) => Number(resumo?.[k] ?? 0)
  const checklist = [
    { ok: Boolean(resumo?.dados), texto: autonoma ? 'Seus dados' : 'Dados do salão' },
    { ok: Boolean(resumo?.horarios), texto: 'Horários configurados' },
    { ok: n('servicos') > 0, texto: n('servicos') > 0 ? `${n('servicos')} ${n('servicos') === 1 ? 'serviço cadastrado' : 'serviços cadastrados'}` : 'Nenhum serviço cadastrado' },
    ...(!autonoma ? [{ ok: n('equipe') > 0, texto: n('equipe') > 0 ? `${n('equipe')} ${n('equipe') === 1 ? 'profissional configurada' : 'profissionais configuradas'}` : 'Equipe ainda vazia' }] : []),
    { ok: Boolean(s.codigo), texto: `Link ${autonoma ? 'da agenda' : 'do salão'} criado` },
  ]
  const pendentes = n('equipe_pendente')
  return (
    <>
      <h1 className="ob-titulo">Pronta pra receber</h1>
      <p className="ob-sub">{autonoma ? 'Sua agenda está montada. Agora é divulgar e começar a receber agendamentos.' : 'Seu salão está montado. Agora é divulgar e começar a receber agendamentos.'}</p>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="ob-duas ob-duas-final">
        <div className="ob-card ob-checklist">
          <strong className="ob-card-titulo">O que já está pronto</strong>
          <ul>{checklist.map((c) => <li key={c.texto} className={c.ok ? 'ok' : ''}><span>{c.ok ? <Check size={13} /> : <Minus size={13} />}</span>{c.texto}</li>)}</ul>
        </div>
        <div className="ob-card ob-ativacao">
          <div>
            <strong className="ob-card-titulo">Link e QR Code {autonoma ? 'da sua agenda' : 'do salão'}</strong>
            <span className="muted">Compartilhe com as clientes: elas veem {autonoma ? 'sua agenda' : 'o salão, os serviços e a equipe'} e marcam sozinhas.</span>
            <div className="ob-link"><input readOnly value={link} onFocus={(e) => e.target.select()} /><button type="button" className="btn-mini" onClick={copiar}><Copy size={12} /> {copiado ? 'Copiado!' : 'Copiar link'}</button></div>
            <span className="muted ob-codigo">Ou o código <b>{s.codigo}</b>, digitado no app.</span>
          </div>
          <div className="ob-qr-grande"><canvas ref={qr} /><small className="muted">QR Code {autonoma ? 'da agenda' : 'do salão'}</small></div>
        </div>
      </div>
      <strong className="ob-secao">Próximos passos</strong>
      <div className="ob-proximos">
        <div className="ob-proximo"><span className="ob-proximo-icone"><CalendarCheck size={18} /></span><strong>Faça um agendamento de teste</strong><p>Veja exatamente como sua cliente vai enxergar {autonoma ? 'sua agenda' : 'o salão e a disponibilidade da equipe'}.</p><button type="button" className="btn-mini" onClick={testar}>{resumo?.feitos?.agendamento_teste ? <><Check size={12} /> Página aberta</> : 'Fazer agendamento teste'}</button></div>
        <div className="ob-proximo"><span className="ob-proximo-icone"><QrCode size={18} /></span><strong>Coloque o QR no salão</strong><p>Imprima o QR e coloque no balcão, no espelho ou na recepção. Na bio do Instagram vai o link.</p><button type="button" className="btn-mini" onClick={baixar}>{resumo?.feitos?.qr_baixado ? <><Check size={12} /> QR baixado</> : <><Download size={12} /> Baixar QR Code</>}</button></div>
        {!autonoma && (
          <div className="ob-proximo"><span className="ob-proximo-icone"><Send size={18} /></span><strong>Ative sua equipe</strong>
            {pendentes > 0 ? <><p>{pendentes === 1 ? '1 profissional ainda não ativou o acesso.' : `${pendentes} profissionais ainda não ativaram o acesso.`}</p><button type="button" className="btn-mini" onClick={() => irPara(5)}>Enviar acessos</button></>
              : n('equipe') > 0 ? <p className="ob-proximo-ok"><Check size={13} /> Sua equipe está ativa.</p>
              : <><p>Ninguém na equipe ainda. Dá pra adicionar agora ou depois, em Equipe.</p><button type="button" className="btn-mini" onClick={() => irPara(5)}>Adicionar profissional</button></>}
          </div>
        )}
      </div>
      <div className="ob-card ob-importante">
        <strong className="ob-card-titulo"><Info size={15} /> Importante</strong>
        <span className="muted">Clientes que entrarem pelo link ou QR {autonoma ? 'da sua agenda' : 'do salão'} passam a ter relacionamento com {autonoma ? 'você' : 'esse salão'} na MIMO e podem agendar os serviços e profissionais vinculados a ele. Quem vem pelo link de uma profissional fica ligada ao salão e a ela.</span>
        <span className="ob-importante-icone"><Users size={34} /></span>
      </div>
      {(() => { const c = planoDoNegocio(s.tipo, s.equipe_prevista); return (
        <div className="ob-resumo-plano">
          <div><small>Seu plano</small><strong>{c.nome}</strong><p>{autonoma ? 'Uma agenda, sem mensalidade, sem cartão.' : `${s.equipe_prevista || 1} ${(s.equipe_prevista || 1) === 1 ? 'agenda' : 'agendas'} · ${c.extras === 0 ? 'todas inclusas' : `${c.extras} além das inclusas`}. Nenhuma cobrança agora: a mensalidade é combinada com a MIMO.`}</p></div>
          <b>{c.total === 0 ? 'Grátis' : <>{emDinheiro(c.total)}<small> /mês</small></>}</b>
        </div>
      ) })()}
      <Rodape voltar={voltar} avancar={concluir} salvando={salvando || pronto} rotulo="Finalizar e entrar no painel" icone={<ArrowRight size={16} />} />
    </>
  )
}
