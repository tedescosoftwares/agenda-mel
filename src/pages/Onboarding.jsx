import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { Check, ArrowLeft, ArrowRight, LogOut, Camera, MapPin, Plus, X, Copy, Download, MoreHorizontal, Link2, Info, Sparkles, MessageCircle, Users, Minus, Eye, Lock, Wand2, CalendarCheck, QrCode, Send, Home, MapPinOff, Search, ImagePlus } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { planoDoNegocio, reais as emDinheiro, PLANOS } from '../lib/planos'
import '../onboarding.css'
import '../onboarding-v2.css'
import { reduzirFoto } from '../lib/imagem'
import { buscarCep, formatarCep, limparCep, minhaPosicao, geocodificar, temPino, arredondar } from '../lib/geo'
import { formatarFone } from '../lib/fone'
import { formatarCnpj, cnpjValido, buscarCnpj, formatarCpf, cpfValido, soDigitos, nomeProprio } from '../lib/cnpj'
import Mapa from '../components/Mapa'
import SenhaNova from '../components/SenhaNova'
import { forcaDaSenha } from '../lib/senha'
import { linkDoCodigo } from '../lib/convite'
import { urlDoAmbiente } from '../lib/ambiente'
import { formatPreco } from '../lib/format'
import { sugestoesPara, primeiroNome, enviarAcesso } from '../lib/equipe'
import { categoriasDoSalao } from '../lib/categorias'
import { REDES, limparRede } from '../components/IconesSociais'
import ProfissionalDrawer, { CartaoProfissional } from '../components/ProfissionalDrawer'
import { FraseDeAceite } from '../components/LinkLegal'
import { useDocumentosLegais, aceitesPara, versaoMaior } from '../lib/legal'
import { EMAIL_CONTATO } from '../conteudo/legal'
import RodapeSocial from '../components/RodapeSocial'

// O onboarding do salão (114, 119): do cadastro à agenda em seis passos, o
// mesmo fluxo no computador e no celular. Cada passo explica por que
// pergunta, mostra o efeito da escolha, grava sozinho (autosave) e a
// conta lembra onde parou; quem sair volta pro mesmo lugar. Serviços,
// equipe e a ativação com o QR ficam pra dentro do painel (Configurar).
// cada passo tem a foto, o bilhete e a frase do painel da esquerda
const PASSOS = [
  { id: 1, rotulo: 'Tipo de conta', foto: 'profissional', bilhete: 'começa por aqui', titulo: 'Como você trabalha?', texto: 'Escolha a opção que mais combina com a sua rotina. Se isso mudar depois, você pode ajustar sem perder seus dados.', roteiro: ['Escolha seu tipo de conta', 'Confira o plano'] },
  { id: 2, rotulo: 'Seus dados', foto: 'agenda-celular', bilhete: 'rapidinho', titulo: 'Agora, seus dados.', texto: 'Precisamos de algumas informações para criar sua conta e identificar o negócio. O que as clientes veem você configura no próximo passo.', roteiro: ['CPF ou CNPJ', 'Endereço de cadastro', 'E-mail, WhatsApp e senha'] },
  { id: 3, rotulo: 'Seu espaço', foto: 'salao', bilhete: 'com a sua cara', titulo: 'Dê cara ao seu salão.', texto: 'Nome, fotos, contatos, endereço e horários. É o que a cliente vê.', roteiro: ['Nome e fotos', 'Contatos e localização', 'Horários e regras'] },
  { id: 4, rotulo: 'Quase lá', foto: 'equipe', bilhete: 'falta pouco', titulo: 'Quase lá.', texto: 'Diga quantas profissionais vão ter agenda. Serviços e equipe você configura já dentro do painel.', roteiro: ['Profissionais com agenda', 'Entrar no painel'] },
]
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0]
const MAX_FOTOS = 8
const hojeIso = () => new Date().toISOString().slice(0, 10)
const idadeEm = (iso) => { const n = new Date(iso + 'T12:00:00'); if (Number.isNaN(n.getTime())) return 0; const h = new Date(); let i = h.getFullYear() - n.getFullYear(); if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) i--; return i }
const iniciaisDe = (nome) => (nome || 'ES').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
const ANTECEDENCIAS = [[0, 'Sem antecedência'], [30, '30 minutos'], [60, '1 hora'], [120, '2 horas'], [240, '4 horas'], [720, '12 horas'], [1440, '24 horas'], [2880, '48 horas']]
const CANCELAMENTO = [['flexivel', '6 horas'], ['moderada', '12 horas'], ['rigorosa', '24 horas']]
const CATEGORIAS_SUGERIDAS = ['Cabelo', 'Unhas', 'Estética', 'Massagem', 'Sobrancelhas', 'Maquiagem', 'Depilação', 'Barba', 'Cílios', 'Podologia', 'Noivas', 'Coloração', 'Tranças', 'Micropigmentação', 'Bronzeamento', 'Spa e terapias', 'Estética corporal', 'Infantil']
const SUGESTOES_A_MOSTRA = 6   // as primeiras; o resto fica atrás do "Ver mais"
// a política que a maioria dos salões usa pra começar; muda depois em Ajustes
const RECOMENDADO = { antecedencia_min_minutos: 60, politica_cancelamento: 'moderada', permite_remarcar: true, sinal_ligado: false }
const SUPORTE = import.meta.env.VITE_SUPORTE_WHATS || ''
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
  const { user, role, salao: salaoAdmin, negocio, recarregarPerfil, loading, signOut } = useAuth()
  const salao = negocio ?? salaoAdmin   // a autônoma não tem 'salao' de admin; o negócio que ela é dona vale pros dois
  const navigate = useNavigate()
  const [s, setS] = useState(publico ? { id: null, tipo: tipoDaURL(), publico: true } : null)   // o salão, como está no banco (com o que a tela mudou por cima)
  const [passo, setPasso] = useState(1)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [pronto, setPronto] = useState(false)
  const [retomado, setRetomado] = useState(false)
  const [estadoAuto, setEstadoAuto] = useState('')
  const [feitos, setFeitos] = useState([])   // os checks do roteiro do passo atual
  useEffect(() => { setFeitos([]) }, [passo])
  const docsLegais = useDocumentosLegais()

  useEffect(() => {
    if (!salao || publico) return
    setS((x) => x ?? { ...salao })
    // retoma de onde parou; quem já concluiu e abriu de novo começa do 1 (revisão)
    setPasso((p) => {
      if (p === 1 && !salao.onboarding_concluido_em && salao.onboarding_passo > 2) { setRetomado(true); return Math.min(4, salao.onboarding_passo) }
      return p
    })
  }, [salao])

  const autonoma = s?.tipo === 'autonoma'
  const passos = PASSOS
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
  const [querSair, setQuerSair] = useState(false)
  function sair() { setQuerSair(true) }
  // grava onde parou e sai da conta; ao entrar de novo, o cadastro continua daqui
  async function sairMesmo() {
    setQuerSair(false)
    try { await gravar({}, passo) } catch { /* o que deu pra guardar já está guardado */ }
    await signOut?.()
    navigate('/pro/entrar', { replace: true })
  }

  if (publico && !loading && user && salao) return <Navigate to="/onboarding" replace />
  if (!s) return <div className="page-center"><p className="muted">Carregando…</p></div>

  const props = { s, setS, salvando, erro, setErro, seguir, voltar, gravar, gravarQuieto, setEstadoAuto, user, role, autonoma, docsLegais, concluir, pronto, publico, recarregarPerfil, navigate, irPara: (n) => { setPasso(n); window.scrollTo({ top: 0 }) } }
  const atual = passos[idx] ?? passos[0]
  const plano = planoDoNegocio(s.tipo, s.equipe_prevista)
  const sairLink = publico ? <Link className="ob-sair" to="/pro/entrar"><LogOut size={14} /> Já tenho conta</Link> : <button type="button" className="ob-sair" onClick={sair}><LogOut size={14} /> Sair do cadastro</button>
  return (
    <div className={"ob ob-v2 ob-step-" + passo}>
      <aside className="ob-painel">
        <div className="ob-painel-topo"><img src="/mimo-logo.svg" alt="MIMO" />{sairLink}</div>
        <div key={atual.id} className="ob-painel-vivo">
          <div className="ob-painel-foto"><img src={`/imagens/${atual.foto}-720.webp`} alt="" /><span className="ob-painel-bilhete">{atual.bilhete} <i>♥</i></span></div>
          <div className="ob-painel-texto"><small>Passo {idx + 1} de {total}</small><h2>{atual.titulo}</h2><p>{atual.texto}</p>
            {atual.roteiro && <ol className="ob-painel-roteiro">{atual.roteiro.map((r, i) => <li key={r} className={feitos[i] ? 'feito' : ''}><i>{feitos[i] ? <Check size={11} /> : i + 1}</i>{r}</li>)}</ol>}
          </div>
        </div>
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
          <span>{autonoma ? 'Uma agenda, sem mensalidade.' : `${s.equipe_prevista || 1} ${(s.equipe_prevista || 1) === 1 ? 'agenda' : 'agendas'} · ajuste no passo 4`}</span>
        </div>
        {SUPORTE && <a className="ob-ajuda" href={`https://wa.me/${SUPORTE.replace(/\D/g, '')}?text=${encodeURIComponent('Oi! Estou fazendo o cadastro do meu salão no MIMO e preciso de ajuda.')}`} target="_blank" rel="noreferrer"><MessageCircle size={18} /><span><strong>Precisa de ajuda?</strong><small>Fale com a gente pelo WhatsApp</small></span></a>}
      </aside>

      <main className="ob-conteudo">
        <div className="ob-topo-m">
          <button type="button" onClick={() => (idx === 0 ? sair() : voltar())} aria-label="Voltar"><ArrowLeft size={20} /></button>
          <div className="ob-barra" aria-label={`Passo ${idx + 1} de ${total}`}><i style={{ width: `${((idx + 1) / total) * 100}%` }} /></div>
          {!(publico && passo === 2) ? <button type="button" onClick={() => (passo === 4 ? concluir() : seguir({}))}>{passo === 4 ? 'Concluir' : 'Pular'}</button> : <span />}
        </div>
        <div className="ob-conteudo-linha"><span className="ob-conteudo-num">Passo {idx + 1} de {total} · {atual.rotulo}</span><EstadoSalvo estado={estadoAuto} /></div>
        {retomado && <div className="ob-retomada"><Wand2 size={15} /><span><strong>Continuando de onde você parou.</strong> O que você já preencheu está guardado; os passos anteriores ficam no menu ao lado.</span><button type="button" onClick={() => setRetomado(false)} aria-label="Fechar"><X size={14} /></button></div>}
        {atual.roteiro && <ol className="ob-roteiro-m" aria-label="Neste passo">{atual.roteiro.map((r, i) => <li key={r} className={feitos[i] ? 'feito' : ''}><b>{feitos[i] ? <Check size={10} /> : i + 1}</b>{r}</li>)}</ol>}
        {erro && <ModalErro texto={erro} onFechar={() => setErro('')} />}
        {querSair && <ModalSair passo={idx + 1} onFicar={() => setQuerSair(false)} onSair={sairMesmo} />}
        <ProximoCtx.Provider value={passos[idx + 1]?.rotulo ?? ''}>
          <RoteiroCtx.Provider value={setFeitos}>
          <div key={passo} className="ob-passo-corpo">
            {passo === 1 && <PassoTipo {...props} />}
            {passo === 2 && <PassoDados {...props} />}
            {passo === 3 && <PassoEstrutura {...props} />}
            {passo === 4 && <PassoQuaseLa {...props} />}
          </div>
          </RoteiroCtx.Provider>
        </ProximoCtx.Provider>
      </main>
    </div>
  )
}

const ProximoCtx = createContext('')   // o rótulo do próximo passo, pro rodapé dizer o que vem depois
const RoteiroCtx = createContext(() => {})   // o passo conta ao painel quais itens do roteiro já estão feitos
function useRoteiro(feitos) {
  const marcar = useContext(RoteiroCtx)
  const chave = JSON.stringify(feitos.map(Boolean))
  useEffect(() => { marcar(JSON.parse(chave)) }, [chave, marcar])
}
function Rodape({ voltar, avancar, rotulo = 'Continuar', salvando, primeiro = false, icone = <ArrowRight size={16} /> }) {
  const proximo = useContext(ProximoCtx)
  return (
    <div className="ob-rodape">
      {!primeiro ? <button type="button" className="btn btn-ghost" onClick={voltar} disabled={salvando}><ArrowLeft size={16} /> Voltar</button> : <span />}
      {proximo && <small className="ob-depois">Depois: <b>{proximo}</b></small>}
      <button type="button" className="btn btn-primary ob-continuar" onClick={avancar} disabled={salvando}>{salvando ? 'Salvando…' : rotulo} {!salvando && icone}</button>
    </div>
  )
}
const Selo = ({ publico }) => publico
  ? <span className="ob-selo publico" title="Aparece na página do salão e no app da cliente"><Eye size={11} /> Visível para clientes</span>
  : <span className="ob-selo interno" title="Só você e a MIMO veem"><Lock size={11} /> Uso administrativo</span>

// ---------- 1 · Tipo de conta ------------------------------------------------------
function PassoTipo({ s, setS, seguir, salvando, setErro }) {
  const [tipo, setTipo] = useState(s.tipo ?? 'salao')
  useRoteiro([Boolean(tipo), Boolean(tipo)])
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
      <h1 className="ob-titulo">Como você trabalha hoje?</h1>
      <p className="ob-sub">Escolha a opção que mais combina com a sua rotina. Se isso mudar, você pode ajustar depois.</p>
      <div className="ob-tipos">
        {[
          { id: 'salao', foto: 'equipe', pilula: 'Salão · MIMO Pro', titulo: 'Tenho salão e equipe', texto: 'Para quem organiza a agenda de duas ou mais profissionais.', bloco: 'Tudo em um só lugar', itens: ['equipe e agendas', 'serviços e horários', 'clientes', 'permissões', 'rotina do salão'], destaque: 'Você configura tudo primeiro e depois envia o acesso de cada profissional já com a agenda pronta.', preco: emDinheiro(pro.base), sub: `/mês até ${pro.inclusas} profissionais · ${emDinheiro(pro.extra)} por agenda a mais`, promais: <><b>{PLANOS.promais.nome}</b> a partir de {PLANOS.promais.inclusas} profissionais: <strong>{emDinheiro(PLANOS.promais.base)}/mês</strong> + {emDinheiro(PLANOS.promais.extra)} por profissional a partir da {PLANOS.promais.inclusas + 1}ª. O plano se ajusta sozinho pelo número de agendas, no passo 3.</> },
          { id: 'autonoma', foto: 'profissional', pilula: 'Autônoma · grátis', titulo: 'Trabalho por conta própria', texto: 'Uma agenda completa para quem atende sozinha.', bloco: 'Sua rotina, sem complicação', itens: ['sua agenda', 'seus serviços', 'seus horários', 'seus clientes', 'seu link e QR Code'], destaque: 'Sem configurações de equipe. Só o que você realmente precisa.', preco: 'R$ 0', sub: '/mês, sem cartão' },
        ].map((o) => (
          <button key={o.id} type="button" className={'ob-tipo' + (tipo === o.id ? ' ativo' : '')} onClick={() => setTipo(o.id)} aria-pressed={tipo === o.id}>
            <span className="ob-tipo-foto"><img src={`/imagens/${o.foto}-720.webp`} alt="" /><span className="ob-pilula">{o.pilula}</span></span>
            {tipo === o.id && <span className="ob-tipo-check"><Check size={14} /></span>}
            <strong>{o.titulo}</strong>
            <span className="muted">{o.texto}</span>
            <span className="ob-tipo-bloco"><small>{o.bloco}</small><ul>{o.itens.map((i) => <li key={i}><Check size={13} /> {i}</li>)}</ul></span>
            <span className="ob-tipo-destaque">{o.destaque}</span>
            <span className="ob-tipo-preco"><b>{o.preco}</b><small>{o.sub}</small></span>
            {o.promais && <span className="ob-tipo-promais">{o.promais}</span>}
          </button>
        ))}
      </div>
      <Rodape primeiro avancar={avancar} salvando={salvando} />
    </>
  )
}

// ---------- 2 · Dados do salão -----------------------------------------------------
// ---- passo 2: os dados do negócio ----
// A identificação fiscal (122): CNPJ obrigatório, ou CPF de quem ainda
// trabalha informalmente. Com CNPJ, o endereço fiscal vem da Receita e o
// endereço do salão pode ser outro. Telefones e e-mails a mais, e o pino
// no mapa, que a dona arrasta até a porta.
const enderecoDe = (o) => ({ address: o?.address ?? '', bairro: o?.bairro ?? '', city: o?.city ?? '', uf: o?.uf ?? '', cep: limparCep(o?.cep) })
// os contatos guardam de onde vieram: os do cadastro (passo 2) e os do salão (passo 3) não se pisam
const escopoDe = (c) => (c?.escopo === 'cadastro' ? 'cadastro' : 'salao')
const contatosDe = (lista, escopo) => (Array.isArray(lista) ? lista.filter((c) => escopoDe(c) === escopo) : [])
const telefonesDe = (lista, escopo) => { const t = contatosDe(lista, escopo).filter((c) => c.tipo === 'telefone').map((c) => soDigitos(c.valor).slice(0, 11)); return t.length ? t : [''] }
const emailsDe = (lista, escopo) => contatosDe(lista, escopo).filter((c) => c.tipo === 'email').map((c) => String(c.valor ?? ''))
const montarContatos = (telefones, emails, escopo) => [...telefones.filter((t) => t.trim()).map((t) => ({ tipo: 'telefone', valor: soDigitos(t).slice(0, 11), escopo })), ...emails.filter((e) => e.trim()).map((e) => ({ tipo: 'email', valor: e.trim().toLowerCase(), escopo }))]
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? '').trim())

// CEP, rua, bairro, cidade e UF; o CEP preenche o resto
function BlocoEndereco({ valor, onChange, obrigatorio, aoAchar, autoCompleteRua }) {
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState('')
  const set = (p) => onChange((x) => ({ ...x, ...p }))
  async function porCep(v) {
    const d = limparCep(v)
    set({ cep: d }); setErro('')
    if (d.length !== 8) return
    setBuscando(true)
    try {
      const r = await buscarCep(d)
      onChange((x) => ({ ...x, address: x.address || r.rua, bairro: x.bairro || r.bairro, city: r.cidade || x.city, uf: r.uf || x.uf }))
      aoAchar?.(r)
    } catch (e) { setErro(e.message) } finally { setBuscando(false) }
  }
  return (
    <>
      <label>CEP<input value={formatarCep(valor.cep)} onChange={(e) => porCep(e.target.value)} placeholder="11060-300" inputMode="numeric" autoComplete="postal-code" maxLength={9} />{buscando ? <small className="muted">buscando…</small> : erro ? <small className="ob-cnpj-erro">{erro}</small> : null}</label>
      <label>Endereço {obrigatorio && <b>*</b>}<input value={valor.address} onChange={(e) => set({ address: e.target.value })} placeholder="Rua das Flores, 123" autoComplete={autoCompleteRua ? 'street-address' : 'off'} /></label>
      <label>Bairro<input value={valor.bairro} onChange={(e) => set({ bairro: e.target.value })} placeholder="Jardim Paulista" /></label>
      <div className="ob-linha-2">
        <label>Cidade {obrigatorio && <b>*</b>}<input value={valor.city} onChange={(e) => set({ city: e.target.value })} placeholder="São Paulo" autoComplete="address-level2" /></label>
        <label>UF<select value={valor.uf} onChange={(e) => set({ uf: e.target.value })}><option value="">—</option>{UFS.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
      </div>
    </>
  )
}

// "Sair do cadastro": confirma, lembra que está tudo guardado e sai da conta.
function ModalSair({ passo, onFicar, onSair }) {
  return (
    <div className="modal-fundo ob-modal-fundo" onClick={onFicar}>
      <div className="modal-caixa ob-modal ob-modal-erro ob-modal-sair" role="dialog" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-fechar" onClick={onFicar} aria-label="Fechar"><X size={18} /></button>
        <span className="ob-erro-icone"><LogOut size={22} /></span>
        <h3>Quer continuar em outro momento?</h3>
        <p className="ob-erro-texto">Tudo o que você preencheu até o passo {passo} fica guardado. Quando entrar de novo, a gente continua exatamente de onde parou.</p>
        <div className="ob-modal-acoes">
          <button type="button" className="btn btn-ghost" onClick={onSair}>Sair por agora</button>
          <button type="button" className="btn btn-primary" onClick={onFicar} autoFocus>Continuar o cadastro</button>
        </div>
      </div>
    </div>
  )
}

// Qualquer erro dos passos aparece num modalzinho, em vez da faixa
// vermelha no meio do formulário. Quando o recado é "já tem conta",
// o botão leva pra entrar.
function ModalErro({ texto, onFechar }) {
  const emUso = /já está em uso/i.test(texto)
  return (
    <div className="modal-fundo ob-modal-fundo" onClick={onFechar}>
      <div className="modal-caixa ob-modal ob-modal-erro" role="alertdialog" aria-live="assertive" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        <span className="ob-erro-icone"><Info size={22} /></span>
        <h3>{emUso ? 'Esse WhatsApp já está cadastrado' : 'Falta só um detalhe'}</h3>
        <p className="ob-erro-texto">{texto}</p>
        <div className="ob-modal-acoes">
          {emUso && <a href={`mailto:${EMAIL_CONTATO}?subject=${encodeURIComponent('Meu WhatsApp já está cadastrado na MIMO')}`} className="btn btn-ghost">Falar com o suporte</a>}
          <button type="button" className="btn btn-primary" onClick={onFechar} autoFocus>{emUso ? 'Usar outro número' : 'Entendi'}</button>
        </div>
      </div>
    </div>
  )
}

// Depois da consulta do CNPJ: mostra o que a Receita devolveu e explica
// que o nome fantasia fica no cadastro; o nome que a cliente vê é o do passo 3.
function ModalCnpj({ dados, onFechar }) {
  const endereco = [dados.address, dados.bairro, [dados.city, dados.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ')
  return (
    <div className="modal-fundo ob-modal-fundo" onClick={onFechar}>
      <div className="modal-caixa ob-modal ob-modal-cnpj" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        <span className="ob-cnpj-selo"><Check size={14} /> CNPJ ativo na Receita</span>
        <h3>Achamos o seu CNPJ 💗</h3>
        <p className="muted">Já preenchemos o que a Receita nos contou. Dá uma conferida:</p>
        <dl className="ob-cnpj-lista">
          <div><dt>Razão social</dt><dd>{dados.razao_social}</dd></div>
          <div><dt>Nome fantasia</dt><dd>{dados.nome_fantasia || <span className="muted">sem nome fantasia na Receita</span>}</dd></div>
          {endereco && <div><dt>Endereço fiscal</dt><dd>{endereco}</dd></div>}
          {dados.socios?.length > 0 && <div><dt>{dados.socios.length === 1 ? 'Sócia responsável' : 'Quadro de sócios'}</dt><dd>{dados.socios.join(', ')}</dd></div>}
        </dl>
        <p className="ob-cnpj-nota">Só um detalhe: o nome fantasia é o que está na Receita e fica guardado aqui, no cadastro. <strong>O nome que a cliente vê você escolhe no próximo passo</strong>, quando for montar a cara do seu espaço. Pode ser esse mesmo ou outro, do seu jeito.</p>
        <div className="ob-modal-acoes"><button type="button" className="btn btn-primary" onClick={onFechar}>Entendi, vamos seguir <ArrowRight size={16} /></button></div>
      </div>
    </div>
  )
}

function PassoDados({ s, seguir, voltar, salvando, setErro, user, autonoma, publico, recarregarPerfil, navigate, gravarQuieto, setEstadoAuto, docsLegais }) {
  const { signUp } = useAuth()
  const [conta, setConta] = useState({ senha: '', confirma: '', termos: false, marketing: false })
  const [criada, setCriada] = useState(false)
  const [criando, setCriando] = useState(false)
  const [f, setF] = useState({
    documento_tipo: s.documento_tipo === 'cpf' ? 'cpf' : 'cnpj', cnpj: soDigitos(s.cnpj), cpf: soDigitos(s.responsavel_cpf), razao_social: s.razao_social ?? '', nome_fantasia: s.nome_fantasia ?? '', responsavel_nascimento: s.responsavel_nascimento ?? '', responsavel_rg: s.responsavel_rg ?? '', socios: [],
    fiscal: enderecoDe(s.endereco_fiscal ?? (s.endereco_igual !== false ? s : null)),
    whatsapp: s.whatsapp ?? s.phone ?? '', email: s.email ?? '', responsavel_nome: s.responsavel_nome ?? '',
    telefones: telefonesDe(s.contatos, 'cadastro'), emails: emailsDe(s.contatos, 'cadastro'),
  })
  const [cnpjInfo, setCnpjInfo] = useState('')   // o que a Receita disse do CNPJ
  const [cnpjSituacao, setCnpjSituacao] = useState('')   // 'ATIVA', 'BAIXADA'… conferida nesta sessão
  const [modalCnpj, setModalCnpj] = useState(null)   // os dados achados, pra explicar o que vale onde
  const m = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const comCnpj = f.documento_tipo === 'cnpj'
  const setFiscal = (fn) => setF((x) => ({ ...x, fiscal: fn(x.fiscal) }))

  // o que vai pro banco (onboarding_salvar), em qualquer dos jeitos de gravar.
  // Só o cadastral e o fiscal: contatos, endereço e pino do salão são do passo 3.
  function dadosDe(x) {
    return {
      documento_tipo: x.documento_tipo, nome_fantasia: x.nome_fantasia,
      cnpj: x.documento_tipo === 'cnpj' ? x.cnpj : '', responsavel_cpf: x.documento_tipo === 'cpf' ? x.cpf : '',
      razao_social: x.documento_tipo === 'cnpj' ? x.razao_social : '',
      responsavel_nascimento: x.documento_tipo === 'cpf' ? x.responsavel_nascimento : '', responsavel_rg: x.documento_tipo === 'cpf' ? x.responsavel_rg : '',
      endereco_fiscal: { ...x.fiscal, cep: limparCep(x.fiscal.cep) },   // no CPF, o endereço da pessoa
      whatsapp: x.whatsapp, email: x.email, responsavel_nome: x.responsavel_nome,
      contatos: [...contatosDe(s.contatos, 'salao'), ...montarContatos(x.telefones, x.emails, 'cadastro')],
    }
  }
  // telefones e e-mails a mais do cadastro: um campo pra cada, e o + abre outro
  const lista = (k, i, v) => setF((x) => ({ ...x, [k]: x[k].map((y, j) => (j === i ? v : y)) }))
  const maisNa = (k) => setF((x) => ({ ...x, [k]: [...x[k], ''] }))
  const tirarDa = (k, i) => setF((x) => ({ ...x, [k]: x[k].filter((_, j) => j !== i) }))
  const campoContato = (k, i, tipo) => (
    <span key={i} className="ob-fone">
      {tipo === 'telefone' ? <span className="ob-ddi">🇧🇷 +55</span> : null}
      {tipo === 'telefone'
        ? <input type="tel" inputMode="numeric" value={formatarFone(f[k][i])} onChange={(e) => lista(k, i, soDigitos(e.target.value).slice(0, 11))} placeholder={i === 0 ? '(11) 3456-7890' : 'outro telefone'} autoComplete="off" />
        : <input type="email" value={f[k][i]} onChange={(e) => lista(k, i, e.target.value)} placeholder="financeiro@essenzahair.com.br" autoComplete="off" />}
      {(i > 0 || tipo === 'email') && <button type="button" className="ob-menos" onClick={() => tirarDa(k, i)} aria-label="Tirar"><X size={14} /></button>}
      {i === f[k].length - 1 && <button type="button" className="ob-mais" onClick={() => maisNa(k)} aria-label={tipo === 'telefone' ? 'Mais um telefone' : 'Mais um e-mail'}><Plus size={14} /></button>}
    </span>
  )
  // CNPJ: máscara e, com os 14 dígitos certos, busca na Receita e preenche o endereço fiscal
  async function porCnpj(v) {
    const d = soDigitos(v).slice(0, 14)
    setF((x) => ({ ...x, cnpj: d }))
    setCnpjInfo(''); setCnpjSituacao('')
    if (d.length < 14) return
    if (!cnpjValido(d)) { setCnpjInfo('erro:Confere o CNPJ: os dígitos não batem.'); return }
    setCnpjInfo('buscando')
    try {
      const r = await buscarCnpj(d)
      const situacao = String(r.situacao || '').toUpperCase() || 'ATIVA'
      setCnpjSituacao(situacao)
      // só CNPJ ativo entra: baixado, suspenso, inapto ou nulo não dá
      if (situacao !== 'ATIVA') { setCnpjInfo(`erro:Esse CNPJ consta como ${nomeProprio(situacao)} na Receita, e só dá pra cadastrar com CNPJ ativo. Se for engano, confira os números. Se ainda não tem CNPJ, use o seu CPF.`); return }
      setF((x) => ({ ...x, razao_social: r.razao_social, nome_fantasia: x.nome_fantasia || r.nome_fantasia, responsavel_nome: x.responsavel_nome || r.socios[0] || '', socios: r.socios, email: x.email || r.email, fiscal: { address: r.address, bairro: r.bairro, city: r.city, uf: r.uf, cep: r.cep } }))
      setCnpjInfo(`ok:${r.razao_social}`)
      setModalCnpj(r)
    } catch (err) { setCnpjInfo('erro:' + err.message) }
  }
  function trocarDocumento(informal) {
    setCnpjInfo(''); setCnpjSituacao('')
    setF((x) => ({ ...x, documento_tipo: informal ? 'cpf' : 'cnpj' }))
  }
  // quem já tinha o CNPJ gravado sem razão social: consulta a Receita ao abrir
  useEffect(() => { if (comCnpj && cnpjValido(f.cnpj) && !f.razao_social) porCnpj(f.cnpj) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // autosave dos campos de texto e do pino (o pino também)
  const estado = useAutosave(() => gravarQuieto(dadosDe(f)), f, { ativo: Boolean(s.id) && !publico })
  useEffect(() => { setEstadoAuto(estado); return () => setEstadoAuto('') }, [estado, setEstadoAuto])

  useEffect(() => { if (!f.responsavel_nome && user && !publico) supabase.from('profiles').select('full_name, email').eq('id', user.id).maybeSingle().then(({ data }) => { if (data) setF((x) => ({ ...x, responsavel_nome: x.responsavel_nome || data.full_name || '', email: x.email || data.email || '' })) }) }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // o que precisa estar certo antes de seguir (ou de criar a conta)
  function conferir() {
    if (comCnpj && !cnpjValido(f.cnpj)) return f.cnpj ? 'Confere o CNPJ: os dígitos não batem.' : 'Informe o CNPJ. Se ainda não tem, marque "Ainda não tenho CNPJ" e use o seu CPF.'
    if (!comCnpj && !cpfValido(f.cpf)) return f.cpf ? 'Confere o CPF: os dígitos não batem.' : 'Informe o seu CPF.'
    if (comCnpj && cnpjSituacao && cnpjSituacao !== 'ATIVA') return `Esse CNPJ está ${nomeProprio(cnpjSituacao)} na Receita. Só dá pra cadastrar com CNPJ ativo; sem CNPJ, use o seu CPF.`
    if (comCnpj && !f.razao_social.trim()) return 'Diga a razão social (a consulta do CNPJ preenche sozinha).'
    if (!f.responsavel_nome.trim()) return comCnpj ? 'Diga o nome do sócio responsável.' : 'Diga o seu nome completo.'
    if (!comCnpj) {
      if (!f.responsavel_nascimento) return 'Diga a sua data de nascimento.'
      if (idadeEm(f.responsavel_nascimento) < 18) return 'Para responder pelo negócio é preciso ter 18 anos ou mais.'
    }
    for (const t of f.telefones) if (t.trim() && soDigitos(t).length < 10) return `Confere o telefone ${formatarFone(t)}: faltam dígitos.`
    for (const e of f.emails) if (e.trim() && !emailOk(e)) return `Confere o e-mail ${e.trim()}.`
    return ''
  }
  useRoteiro([
    comCnpj ? cnpjValido(f.cnpj) && f.razao_social.trim() && f.responsavel_nome.trim() : cpfValido(f.cpf) && f.responsavel_nome.trim() && f.responsavel_nascimento && idadeEm(f.responsavel_nascimento) >= 18,
    f.fiscal.address.trim() && f.fiscal.city.trim(),
    f.email.trim() && f.whatsapp.trim() && (publico && !user ? forcaDaSenha(conta.senha).ok && conta.confirma === conta.senha && conta.termos : true),
  ])
  // no público: cria a conta com tudo isso nos metadados; o servidor abre o negócio e grava os dados
  async function criarConta() {
    if (!f.whatsapp.trim()) { setErro('Informe seu WhatsApp para receber avisos importantes da conta.'); return }
    if (!f.email.trim()) { setErro('Informe seu e-mail. Ele será usado para entrar na MIMO.'); return }
    if (!forcaDaSenha(conta.senha).ok) { setErro('A senha precisa ser forte: pelo menos 8 caracteres, com maiúscula, minúscula, número e símbolo.'); return }
    if (conta.confirma !== conta.senha) { setErro('As senhas não são iguais. Confira a confirmação.'); return }
    if (!conta.termos) { setErro('Para criar a conta, é preciso aceitar os Termos e a Política de privacidade.'); return }
    setCriando(true); setErro('')
    try {
      const { data: livre } = await supabase.rpc('telefone_disponivel', { fone: f.whatsapp.trim() })
      if (livre && livre.disponivel === false) { setErro(livre.em_uso || livre.email ? 'Esse WhatsApp já está cadastrado na MIMO. Se o número é seu, fale com o suporte para recuperar o acesso.' : (livre.motivo || 'Confira o WhatsApp informado.')); return }
      const dadosSalao = dadosDe(f)
      const nomeInicial = f.nome_fantasia.trim() || f.razao_social.trim()   // o nome que a cliente vê se acerta no passo 3
      dadosSalao.email = f.email.trim(); dadosSalao.whatsapp = f.whatsapp.trim(); dadosSalao.responsavel_nome = f.responsavel_nome.trim()
      if (user) {
        // já logada como cliente, sem negócio: abre agora e segue
        const { data, error } = await supabase.rpc('abrir_negocio', { tipo: s.tipo, nome_negocio: nomeInicial || null, cidade: f.fiscal.city.trim() || null })
        if (error) throw new Error(error.message)
        await supabase.rpc('onboarding_salvar', { salao: data.salao_id, dados: dadosSalao, passo: 3 })
        await supabase.rpc('preferir_marketing', { ok: conta.marketing })
        await recarregarPerfil?.()
        navigate('/onboarding', { replace: true })
        return
      }
      const aceites = aceitesPara(s.tipo, docsLegais)
      const { error } = await signUp(f.email.trim(), conta.senha, f.responsavel_nome.trim(), f.whatsapp.trim(),
        { termos: versaoMaior(aceites), aceites, marketing: conta.marketing, ...(!comCnpj && f.responsavel_nascimento ? { nascimento: f.responsavel_nascimento } : {}), papel_desejado: s.tipo, nome_negocio: nomeInicial || null, cidade: f.fiscal.city.trim() || null, salao: dadosSalao })
      if (error) { setErro(traduzErro(error.message)); return }
      const { data: sess } = await supabase.auth.getSession()
      if (sess?.session) { await recarregarPerfil?.(); navigate('/onboarding', { replace: true }); return }
      setCriada(true)
    } catch (err) { setErro(err.message) } finally { setCriando(false) }
  }
  async function avancar() {
    const falta = conferir()
    if (falta) { setErro(falta); return }
    if (publico) { await criarConta(); return }
    if (!f.whatsapp.trim()) { setErro('Precisamos do seu WhatsApp: é por ele que os avisos chegam.'); return }
    if (!f.email.trim()) { setErro('Informe o e-mail da conta.'); return }
    seguir(dadosDe(f))
  }
  if (criada) {
    return (
      <>
        <h1 className="ob-titulo">Conta criada!</h1>
        <p className="ob-sub">Agora confirme seu e-mail para continuar.</p>
        <div className="ob-pronto"><span className="ob-pronto-check"><Check size={18} /></span><span><strong>Enviamos um link para {f.email.trim()}</strong><small>Abra o e-mail e toque no link de confirmação. Depois você volta direto para continuar o cadastro, com tudo o que já preencheu salvo.</small></span></div>
        <div className="ob-rodape"><span /><Link to="/pro/entrar" className="btn btn-ghost ob-continuar">Já confirmei meu e-mail <ArrowRight size={16} /></Link></div>
      </>
    )
  }
  return (
    <>
      <h1 className="ob-titulo">Seus dados</h1>
      <p className="ob-sub">{publico ? 'Essas informações identificam sua conta e ficam protegidas na MIMO.' : 'Essas informações identificam seu negócio e ficam protegidas na MIMO.'}</p>
      <div className="ob-aviso-etapa"><span className="ob-aviso-etapa-icone"><Info size={16} /></span><span><strong>Aqui ficam apenas os dados de cadastro.</strong> {autonoma ? 'Foto, contatos, localização e o que aparece na sua agenda' : 'Nome, fotos, contatos, localização e o que aparece para as clientes'} você configura na próxima etapa.</span></div>
      <div className="ob-dados">
        <div className="ob-form">
          {/* a identificação fiscal vem primeiro: é por ela que o cadastro começa */}
          <span className="ob-grupo-selo"><Selo /></span>
          <div className="ob-bloco">
            <span className="ob-bloco-titulo">Identificação do negócio <small>não aparece para clientes</small></span>
            {comCnpj ? (
              <>
              <label>CNPJ <b>*</b><span className="muted">(buscamos os dados automaticamente)</span><input value={formatarCnpj(f.cnpj)} onChange={(e) => porCnpj(e.target.value)} placeholder="12.345.678/0001-90" inputMode="numeric" autoComplete="off" autoFocus={!f.cnpj} />{cnpjInfo === 'buscando' ? <small className="muted">consultando a Receita…</small> : cnpjInfo.startsWith('ok:') ? <small className="ob-cnpj-ok">✓ {cnpjInfo.slice(3)}</small> : cnpjInfo.startsWith('erro:') ? <small className="ob-cnpj-erro">{cnpjInfo.slice(5)}</small> : null}</label>
                <label>Razão social <b>*</b><input value={f.razao_social} onChange={m('razao_social')} placeholder="Essenza Cabeleireiros Ltda" autoComplete="organization" /></label>
                <label>Nome fantasia <span className="muted">(como está na Receita)</span><input value={f.nome_fantasia} onChange={m('nome_fantasia')} placeholder="Essenza Hair" /></label>
                <label>Responsável pelo negócio <b>*</b><input value={f.responsavel_nome} onChange={m('responsavel_nome')} placeholder="Juliana Lima" autoComplete="name" list={f.socios.length ? 'ob-socios' : undefined} />{f.socios.length > 1 && <small className="muted">no quadro da Receita: {f.socios.join(', ')}</small>}</label>
                {f.socios.length > 0 && <datalist id="ob-socios">{f.socios.map((n) => <option key={n} value={n} />)}</datalist>}
              </>
            ) : (
              <>
                <p className="ob-humor"><strong>Ainda não tem CNPJ? Tudo bem.</strong>Use seu CPF para continuar. Quando tiver CNPJ, você pode atualizar seus dados por aqui.</p>
                <label>CPF <b>*</b><input value={formatarCpf(f.cpf)} onChange={(e) => setF((x) => ({ ...x, cpf: soDigitos(e.target.value).slice(0, 11) }))} placeholder="123.456.789-09" inputMode="numeric" autoComplete="off" />{f.cpf.length === 11 && !cpfValido(f.cpf) && <small className="ob-cnpj-erro">Confere o CPF: os dígitos não batem.</small>}</label>
                <label>Seu nome completo <b>*</b><input value={f.responsavel_nome} onChange={m('responsavel_nome')} placeholder="Juliana Lima" autoComplete="name" /></label>
                <div className="ob-linha-2 ob-linha-meio">
                  <label>Data de nascimento <b>*</b><input type="date" value={f.responsavel_nascimento} onChange={m('responsavel_nascimento')} max={hojeIso()} autoComplete="bday" /></label>
                  <label>RG <span className="muted">(opcional)</span><input value={f.responsavel_rg} onChange={(e) => setF((x) => ({ ...x, responsavel_rg: e.target.value.replace(/[^0-9A-Za-z.-]/g, '').slice(0, 20) }))} placeholder="12.345.678-9" inputMode="numeric" autoComplete="off" /></label>
                </div>
              </>
            )}
            {!(comCnpj && cnpjSituacao === 'ATIVA') && <label className="ob-termos ob-informal"><input type="checkbox" checked={!comCnpj} onChange={(e) => trocarDocumento(e.target.checked)} /><span>Ainda não tenho CNPJ</span></label>}
          </div>
          <div className="ob-bloco">
            <span className="ob-bloco-titulo">{comCnpj ? 'Endereço fiscal' : 'Seu endereço'} <small>{comCnpj ? 'o que está na Receita' : 'o do cadastro; onde atende vem na próxima etapa'}</small></span>
            <BlocoEndereco valor={f.fiscal} onChange={setFiscal} autoCompleteRua={!comCnpj} />
          </div>
        </div>
        <div className="ob-form">
          <span className="ob-grupo-selo"><Selo /></span>
          <div className="ob-bloco">
            <span className="ob-bloco-titulo">Seu acesso <small>{publico ? 'é com isso que você entra' : 'a conta que administra o negócio'}</small></span>
            <label>E-mail da conta <b>*</b><input type="email" value={f.email} onChange={m('email')} placeholder="contato@essenzahair.com.br" autoComplete="email" /></label>
            <label>Seu WhatsApp <b>*</b><span className="muted">(os avisos chegam por ele)</span><span className="ob-fone"><span className="ob-ddi">🇧🇷 +55</span><input type="tel" inputMode="numeric" value={f.whatsapp} onChange={(e) => setF((x) => ({ ...x, whatsapp: formatarFone(e.target.value) }))} placeholder="(11) 91234-5678" autoComplete="tel" /></span></label>
            <label>Outro telefone <span className="muted">(opcional)</span>{f.telefones.map((_, i) => campoContato('telefones', i, 'telefone'))}</label>
            <label>Outro e-mail <span className="muted">(opcional)</span>{f.emails.length === 0 ? <span className="ob-fone"><button type="button" className="ob-geo" onClick={() => maisNa('emails')}><Plus size={14} /> Adicionar e-mail</button></span> : f.emails.map((_, i) => campoContato('emails', i, 'email'))}</label>
            {publico && !user && (
              <>
                <SenhaNova valor={conta} onChange={(v) => setConta((x) => ({ ...x, ...v }))} />
                <label className="ob-termos"><input type="checkbox" checked={conta.termos} onChange={(e) => setConta((x) => ({ ...x, termos: e.target.checked }))} /><span><FraseDeAceite papel={s.tipo} /></span></label>
                <label className="ob-termos ob-marketing"><input type="checkbox" checked={conta.marketing} onChange={(e) => setConta((x) => ({ ...x, marketing: e.target.checked }))} /><span>Quero receber novidades, ofertas e dicas da MIMO por e-mail e WhatsApp. Dá pra cancelar quando quiser.</span></label>
              </>
            )}
          </div>
        </div>
      </div>
      {modalCnpj && <ModalCnpj dados={modalCnpj} onFechar={() => setModalCnpj(null)} />}
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
    'Database error saving new user': 'Não foi possível criar a conta. Confira os dados informados ou fale com o suporte.',
  }
  return mapa[msg] || msg
}

// ---------- 3 · Estrutura e operação ------------------------------------------------
function PassoEstrutura({ s, setS, seguir, voltar, salvando, setErro, autonoma, gravarQuieto, setEstadoAuto }) {
  const [horas, setHoras] = useState(null)
  // a cara do negócio: o logo e as fotos do espaço sobem na hora e ficam gravadas
  const [nome, setNome] = useState(s.name || s.nome_fantasia || s.razao_social || '')   // o nome que a cliente vê
  const [logo, setLogo] = useState(s.logo_url ?? null)
  const [fotos, setFotos] = useState(Array.isArray(s.fotos) ? s.fotos : [])
  const [subindo, setSubindo] = useState('')   // '' | 'logo' | 'fotos'
  // contatos e endereço do salão (o fiscal ficou no passo 2): WhatsApp comercial, outros telefones e e-mails, onde fica e o pino
  const comCnpj = s.documento_tipo !== 'cpf'
  const fiscal = enderecoDe(s.endereco_fiscal)
  const [loc, setLoc] = useState({
    whatsapp: s.whatsapp ?? s.phone ?? '',
    telefones: telefonesDe(s.contatos, 'salao'), emails: emailsDe(s.contatos, 'salao'),
    endereco_igual: s.endereco_igual !== false,
    ...enderecoDe(s), lat: s.lat ?? null, lng: s.lng ?? null,
    redes: Object.fromEntries(REDES.map((r) => [r.chave, String((s.redes && s.redes[r.chave]) ?? (r.chave === 'instagram' ? s.instagram ?? '' : '') ?? '')])),
  })
  const [redeAberta, setRedeAberta] = useState(null)   // qual rede está com o campo aberto
  const [geo, setGeo] = useState('')          // o que aconteceu com o pino
  const [ocupado, setOcupado] = useState('')  // 'gps' | 'endereco'
  const usaFiscal = loc.endereco_igual   // o endereço do passo 2 (fiscal, ou o da pessoa no CPF)
  // o endereço que vale pro salão: o fiscal, quando é o mesmo, ou o próprio
  const local = usaFiscal ? fiscal : { address: loc.address, bairro: loc.bairro, city: loc.city, uf: loc.uf, cep: loc.cep }
  const pino = temPino(loc.lat, loc.lng)
  const setLocal = (fn) => setLoc((x) => ({ ...x, ...fn({ address: x.address, bairro: x.bairro, city: x.city, uf: x.uf, cep: x.cep }) }))
  const dadosDoLocal = () => {
    const d = {
      whatsapp: loc.whatsapp, endereco_igual: loc.endereco_igual,
      contatos: [...contatosDe(s.contatos, 'cadastro'), ...montarContatos(loc.telefones, loc.emails, 'salao')],
      address: local.address, bairro: local.bairro, city: local.city, uf: local.uf, cep: limparCep(local.cep),
      redes: Object.fromEntries(REDES.map((r) => [r.chave, limparRede(r.chave, loc.redes[r.chave])]).filter(([, v]) => v)), instagram: limparRede('instagram', loc.redes.instagram),
    }
    if (pino) { d.lat = loc.lat; d.lng = loc.lng }
    return d
  }
  // o CEP do endereço sugere o pino, quando ainda não há um
  function pinoDoCep(r) {
    if (r.lat == null) return
    setLoc((x) => (temPino(x.lat, x.lng) ? x : { ...x, lat: r.lat, lng: r.lng }))
    setGeo('pino sugerido pelo CEP: confira e arraste até a porta')
  }
  async function usarLocalizacao() {
    setOcupado('gps'); setErro('')
    try { const p = await minhaPosicao(); setLoc((x) => ({ ...x, lat: p.lat, lng: p.lng })); setGeo(p.precisao > 60 ? `pino na sua posição, mas o sinal está fraco (uns ${p.precisao} m): confira e arraste` : `pino na sua posição (precisão de uns ${p.precisao || 10} m)`) } catch (err) { setErro(err.message) } finally { setOcupado('') }
  }
  async function acharPeloEndereco() {
    setOcupado('endereco'); setErro('')
    try {
      const g = await geocodificar([local.address, local.bairro, local.city, local.uf, 'Brasil'].filter(Boolean).join(', '))
      if (g) { setLoc((x) => ({ ...x, lat: g.lat, lng: g.lng })); setGeo('pino colocado pelo endereço: confira e arraste até a porta'); return }
      const c = local.city.trim() ? await geocodificar(`${local.city} ${local.uf}, Brasil`) : null
      if (c) { setLoc((x) => ({ ...x, lat: c.lat, lng: c.lng })); setGeo(`não achamos a rua, então o pino ficou no centro de ${local.city.trim()}: arraste até o salão`); return }
      setErro('Não achamos esse endereço. Confira a rua e a cidade, ou use a sua localização estando no salão.')
    } catch (err) { setErro(err.message) } finally { setOcupado('') }
  }
  function moverPino(lat, lng) { setLoc((x) => ({ ...x, lat: arredondar(lat), lng: arredondar(lng) })); setGeo('pino ajustado') }
  // telefones e e-mails: um campo pra cada, e o + abre outro
  const lista = (k, i, v) => setLoc((x) => ({ ...x, [k]: x[k].map((y, j) => (j === i ? v : y)) }))
  const maisNa = (k) => setLoc((x) => ({ ...x, [k]: [...x[k], ''] }))
  const tirarDa = (k, i) => setLoc((x) => ({ ...x, [k]: x[k].filter((_, j) => j !== i) }))
  const campoContato = (k, i, tipo) => (
    <span key={i} className="ob-fone">
      {tipo === 'telefone' ? <span className="ob-ddi">🇧🇷 +55</span> : null}
      {tipo === 'telefone'
        ? <input type="tel" inputMode="numeric" value={formatarFone(loc[k][i])} onChange={(e) => lista(k, i, soDigitos(e.target.value).slice(0, 11))} placeholder={i === 0 ? '(11) 3456-7890' : 'outro telefone'} autoComplete="off" />
        : <input type="email" value={loc[k][i]} onChange={(e) => lista(k, i, e.target.value)} placeholder="financeiro@essenzahair.com.br" autoComplete="off" />}
      {(i > 0 || tipo === 'email') && <button type="button" className="ob-menos" onClick={() => tirarDa(k, i)} aria-label="Tirar"><X size={14} /></button>}
    </span>
  )
  const maisLink = (k, rotulo) => <button type="button" className="ob-mais-link" onClick={() => maisNa(k)}><Plus size={13} /> {rotulo}</button>
  const arqLogo = useRef(null)
  const arqFotos = useRef(null)
  async function subirImagem(blob, pasta) {
    const path = `${s.id}/${pasta}/${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage.from('saloes').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
    if (error) throw new Error('Não deu para subir a imagem: ' + error.message)
    return supabase.storage.from('saloes').getPublicUrl(path).data.publicUrl
  }
  async function trocarLogo(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setErro('A imagem passa de 5 MB.'); return }
    setSubindo('logo'); setErro('')
    try { const r = await reduzirFoto(file, { max: 512, quadrado: true }); const url = await subirImagem(r.blob, 'logo'); setLogo(url); await guardarImagens({ logo_url: url }) } catch (err) { setErro(err.message) } finally { setSubindo('') }
  }
  async function tirarLogo() { setLogo(null); await guardarImagens({ logo_url: null }) }
  // logo e fotos gravam na hora. Se o onboarding_salvar não gravar (banco
  // atrasado, por exemplo), escreve direto na tabela; e um erro aparece,
  // em vez de a foto sumir calada quando a pessoa volta ao passo.
  async function guardarImagens(campos) {
    const ok = await gravarQuieto({ ...campos, ...(campos.logo_url === null ? { logo_url: '' } : {}) })
    if (ok) return
    const { error } = await supabase.from('salons').update(campos).eq('id', s.id)
    if (error) { setErro('Não deu para guardar a imagem: ' + error.message); return }
    setS?.((x) => ({ ...x, ...campos }))
  }
  async function addFotos(e) {
    const files = Array.from(e.target.files ?? []); e.target.value = ''
    if (!files.length) return
    const espaco = MAX_FOTOS - fotos.length
    if (files.length > espaco) setErro(`No máximo ${MAX_FOTOS} fotos.`); else setErro('')
    setSubindo('fotos')
    const novas = []
    try {
      for (const file of files.slice(0, espaco)) { const r = await reduzirFoto(file, { max: 1600 }); novas.push(await subirImagem(r.blob, 'fotos')) }
    } catch (err) { setErro(err.message) } finally { setSubindo('') }
    if (novas.length) { const lista = [...fotos, ...novas]; setFotos(lista); await guardarImagens({ fotos: lista }) }
  }
  async function mexerFotos(lista) { setFotos(lista); await guardarImagens({ fotos: lista }) }
  const moverFoto = (i, dir) => { const n = [...fotos]; const j = i + dir; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; mexerFotos(n) }
  const [copiar, setCopiar] = useState(null)   // null | { dias: Set }
  const [tocouSinal, setTocouSinal] = useState(false)   // o recebimento pelo app só muda se a pessoa mexer no botão
  const [pol, setPol] = useState({ antecedencia_min_minutos: s.antecedencia_min_minutos ?? 60, politica_cancelamento: s.politica_cancelamento ?? 'moderada', permite_remarcar: s.permite_remarcar ?? true, sinal_ligado: (s.pagamento_modo ?? 'nao') !== 'nao', sinal_modo: s.sinal_modo ?? 'fixo', sinal_fixo: emReais(s.sinal_fixo_cents ?? 5000), sinal_pct: s.sinal_pct ?? 50, aceite_modo: s.aceite_modo ?? 'casa', minutos_para_aceitar: s.minutos_para_aceitar ?? 120 })
  const p = (k) => (v) => setPol((x) => ({ ...x, [k]: v }))
  // pagamento_modo é o mesmo de Ajustes › Receber pelo app: desligar aqui desliga lá. Só vai no pacote se ela tocou no botão.
  const dadosDaPolitica = () => ({ ...(nome.trim() ? { name: nome.trim() } : {}), ...dadosDoLocal(), antecedencia_min_minutos: Number(pol.antecedencia_min_minutos), politica_cancelamento: pol.politica_cancelamento, permite_remarcar: pol.permite_remarcar,
    ...(tocouSinal ? { pagamento_modo: pol.sinal_ligado ? (s.pagamento_modo && s.pagamento_modo !== 'nao' ? s.pagamento_modo : 'opcional') : 'nao' } : {}), sinal_modo: pol.sinal_modo, sinal_fixo_cents: reais(pol.sinal_fixo), sinal_pct: Number(pol.sinal_pct),
    aceite_modo: pol.aceite_modo, minutos_para_aceitar: Number(pol.minutos_para_aceitar) })
  // autosave: as regras vão pelo onboarding_salvar; os horários, pelo onboarding_horarios
  const estado = useAutosave(async () => {
    const ok = await gravarQuieto(dadosDaPolitica())
    if (!horas || horas.some((h) => h.open && h.start_time >= h.end_time)) return ok
    const { error } = await supabase.rpc('onboarding_horarios', { salao: s.id, horarios: horas })
    return ok && !error
  }, { pol, horas, nome, loc }, { ativo: Boolean(s.id) && horas != null })
  useEffect(() => { setEstadoAuto(estado); return () => setEstadoAuto('') }, [estado, setEstadoAuto])

  useEffect(() => {
    supabase.from('business_hours').select('weekday, open, start_time, end_time').eq('salon_id', s.id).then(({ data }) => {
      const base = ORDEM_DIAS.map((d) => { const h = (data ?? []).find((x) => x.weekday === d); return h ? { ...h, start_time: String(h.start_time).slice(0, 5), end_time: String(h.end_time).slice(0, 5) } : { weekday: d, open: d >= 1 && d <= 5, start_time: '08:00', end_time: d === 6 ? '18:00' : '19:00' } })
      setHoras(base)
    })
  }, [s.id])
  const mudaHora = (d, k, v) => setHoras((x) => x.map((h) => (h.weekday === d ? { ...h, [k]: v } : h)))
  function aplicarSegunda() {
    const seg = horas.find((h) => h.weekday === 1)
    setHoras((x) => x.map((h) => (copiar.dias.has(h.weekday) ? { ...h, open: seg.open, start_time: seg.start_time, end_time: seg.end_time } : h)))
    setCopiar(null)
  }
  useRoteiro([nome.trim() && (logo || fotos.length > 0), loc.whatsapp.trim() && local.city.trim() && pino, horas != null && horas.some((h) => h.open)])
  const recomendadoAtivo = Number(pol.antecedencia_min_minutos) === RECOMENDADO.antecedencia_min_minutos && pol.politica_cancelamento === RECOMENDADO.politica_cancelamento && pol.permite_remarcar === RECOMENDADO.permite_remarcar && pol.sinal_ligado === RECOMENDADO.sinal_ligado

  async function avancar() {
    if (!nome.trim()) { setErro(autonoma ? 'Informe o nome da sua agenda. É esse nome que suas clientes verão.' : 'Informe o nome do salão. É esse nome que suas clientes verão.'); return }
    if (!loc.whatsapp.trim()) { setErro('Informe o WhatsApp comercial que suas clientes poderão usar para falar com o salão.'); return }
    for (const t of loc.telefones) if (t.trim() && soDigitos(t).length < 10) { setErro(`Confere o telefone ${formatarFone(t)}: faltam dígitos.`); return }
    for (const e of loc.emails) if (e.trim() && !emailOk(e)) { setErro(`Confere o e-mail ${e.trim()}.`); return }
    if (!local.city.trim()) { setErro(usaFiscal ? 'Diga a cidade do endereço no passo anterior, ou escolha outro endereço aqui.' : 'Diga a cidade.'); return }
    for (const h of horas ?? []) if (h.open && h.start_time >= h.end_time) { setErro(`${DIAS[h.weekday]}: o fim precisa ser depois do início.`); return }
    const { error } = await supabase.rpc('onboarding_horarios', { salao: s.id, horarios: horas })
    if (error) { setErro(error.message); return }
    const dados = dadosDaPolitica()
    if (!pino && local.address.trim() && local.city.trim()) {
      try { const g = await geocodificar(`${local.address}, ${local.bairro ? local.bairro + ', ' : ''}${local.city} ${local.uf}`); if (g) { dados.lat = g.lat; dados.lng = g.lng } } catch { /* sem pino agora, ajusta depois em Ajustes */ }
    }
    seguir(dados)
  }
  return (
    <>
      <h1 className="ob-titulo">{autonoma ? 'Dê cara à sua agenda' : 'Dê cara ao seu salão'}</h1>
      <p className="ob-sub">{autonoma ? 'Sua foto, contatos e onde você atende: é o que suas clientes vão encontrar na MIMO.' : 'Nome, fotos, contatos e endereço: é o que suas clientes vão encontrar na MIMO.'}</p>
      <div className="ob-estrutura">
        <div className="ob-card ob-card-largo">
          <strong className="ob-card-titulo">{autonoma ? 'Sua imagem e seu espaço' : 'Nome e fotos'}</strong>
          <span className="muted">{autonoma ? 'Sua foto aparece ao lado do nome. As fotos do espaço viram a capa da sua página.' : 'O logo aparece ao lado do nome. As fotos mostram o espaço; a primeira vira a capa.'}</span>
          <div className="ob-cara">
            <div className="ob-cara-esq">
            <label className="ob-cara-nome">{autonoma ? 'Nome da agenda' : 'Nome do salão'} <b>*</b><span className="muted">(como as clientes vão ver)</span><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Studio Essenza Hair" maxLength={60} /></label>
            <div className="ob-cara-imagens">
              <div className="ob-logo-campo">
                <span className="ob-rotulo">{autonoma ? 'Sua foto ou logo' : 'Logo'}</span>
                <button type="button" className={'ob-logo ob-logo-mini' + (logo ? ' com' : '')} onClick={() => arqLogo.current?.click()} disabled={subindo === 'logo'}>
                  {logo ? <img src={logo} alt="" /> : <span className="ob-logo-vazio"><span className="ob-logo-iniciais">{iniciaisDe(nome)}</span></span>}
                  <span className="ob-logo-cam"><Camera size={13} /></span>
                </button>
                <input ref={arqLogo} type="file" accept="image/*" hidden onChange={trocarLogo} />
                {subindo === 'logo' ? <small className="muted">subindo…</small> : logo ? <button type="button" className="link-ver" onClick={tirarLogo}>Remover</button> : <small className="muted">JPG ou PNG</small>}
              </div>
              <div className="ob-fotos-campo">
                <span className="ob-rotulo">{autonoma ? 'Fotos do espaço' : 'Fotos do salão'} <span className="muted">· {fotos.length}/{MAX_FOTOS}</span></span>
                <div className="ob-fotos">
                  {fotos.map((u, i) => (
                    <div key={u} className={'ob-foto' + (i === 0 ? ' capa' : '')}>
                      <img src={u} alt="" />
                      {i === 0 && <span className="ob-foto-capa">capa</span>}
                      <div className="ob-foto-acoes">
                        <button type="button" onClick={() => moverFoto(i, -1)} disabled={i === 0} aria-label="Mover para antes">‹</button>
                        <button type="button" onClick={() => moverFoto(i, 1)} disabled={i === fotos.length - 1} aria-label="Mover para depois">›</button>
                        <button type="button" className="perigo" onClick={() => mexerFotos(fotos.filter((_, k) => k !== i))} aria-label="Tirar foto">×</button>
                      </div>
                    </div>
                  ))}
                  {fotos.length < MAX_FOTOS && <button type="button" className="ob-foto ob-foto-add" onClick={() => arqFotos.current?.click()} disabled={subindo === 'fotos'}><ImagePlus size={18} /><span>{subindo === 'fotos' ? 'subindo…' : 'Adicionar'}</span></button>}
                  <input ref={arqFotos} type="file" accept="image/*" multiple hidden onChange={addFotos} />
                </div>
              </div>
            </div>
            </div>
            {/* como a cliente vai ver a página: capa, logo, nome e onde fica */}
            <div className="ob-previa">
              <small><Eye size={11} /> Assim suas clientes vão ver</small>
              <div className="ob-previa-tela">
                <div className="ob-previa-capa">
                  {fotos[0] ? <img src={fotos[0]} alt="" /> : <span className="ob-previa-capa-vazia"><ImagePlus size={20} /><span>{autonoma ? 'A foto do seu espaço vira a capa' : 'A primeira foto vira a capa'}</span></span>}
                  {fotos.length > 1 && <span className="ob-previa-contador">1/{fotos.length}</span>}
                  <span className="ob-previa-logo">{logo ? <img src={logo} alt="" /> : iniciaisDe(nome)}</span>
                </div>
                <div className="ob-previa-corpo">
                  <strong>{nome || (autonoma ? 'Sua agenda' : 'Seu salão')}</strong>
                  <span>{[s.bairro, s.city].filter(Boolean).join(' • ') || 'Bairro • Cidade'}</span>
                  <div className="ob-previa-botoes"><span className="ob-preview-botao">Ver serviços</span><span className="ob-previa-botao-2"><MapPin size={11} /> Como chegar</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="ob-ponte">
          <span className="ob-ponte-icone"><Sparkles size={16} /></span>
          <span><strong>{nome.trim() ? `${nome.trim()} já tem cara.` : 'Nome e fotos prontos?'}</strong> Agora, como as clientes chegam até {autonoma ? 'você' : 'vocês'}: contatos, endereço e horários.</span>
        </div>
        <div className="ob-coluna">
          <div className="ob-card">
            <strong className="ob-card-titulo">{autonoma ? 'Como as clientes falam com você' : 'Como as clientes falam com vocês'}</strong>
            <div className="ob-form">
              <div className="ob-zap-principal">
                <label>WhatsApp principal <b>*</b><em className="ob-zap-selo"><MessageCircle size={11} /> Número da assistente</em><span className="ob-fone"><span className="ob-ddi">🇧🇷 +55</span><input type="tel" inputMode="numeric" value={loc.whatsapp} onChange={(e) => setLoc((x) => ({ ...x, whatsapp: formatarFone(e.target.value) }))} placeholder="(11) 91234-5678" autoComplete="tel" /></span></label>
                <p className="ob-zap-nota">A MIMO usa esse número para confirmações, lembretes e a assistente. Ele também aparece na sua página. Dá pra trocar depois.</p>
              </div>
              <label>Outro telefone <span className="muted">(opcional)</span>{loc.telefones.map((_, i) => campoContato('telefones', i, 'telefone'))}{maisLink('telefones', 'Adicionar mais um')}</label>
              <label>E-mail de contato <span className="muted">(opcional)</span>{loc.emails.map((_, i) => campoContato('emails', i, 'email'))}{maisLink('emails', loc.emails.length ? 'Adicionar mais um' : 'Adicionar e-mail')}</label>
              {/* redes sociais: um chip por rede; toca, abre o campo; preenchida, fica rosa */}
              <div className="ob-redes">
                <span className="ob-rotulo">Redes sociais <span className="muted">(opcional)</span></span>
                <div className="ob-redes-chips">
                  {REDES.map((r) => { const cheia = Boolean(limparRede(r.chave, loc.redes[r.chave])); const aberta = redeAberta === r.chave; return (
                    <button key={r.chave} type="button" className={'ob-rede-chip' + (cheia ? ' cheia' : '') + (aberta ? ' aberta' : '')} onClick={() => setRedeAberta(aberta ? null : r.chave)} aria-pressed={aberta}><r.Icone size={14} /> {r.nome}{cheia && <Check size={12} />}</button>
                  ) })}
                </div>
                {redeAberta && (() => { const r = REDES.find((x) => x.chave === redeAberta); return (
                  <label className="ob-rede-campo">{r.nome} <span className="muted">({r.dica})</span>
                    <span className="ob-fone"><span className="ob-ddi ob-rede-prefixo"><r.Icone size={13} /> {r.prefixo}</span><input value={loc.redes[r.chave]} onChange={(e) => setLoc((x) => ({ ...x, redes: { ...x.redes, [r.chave]: e.target.value } }))} onBlur={(e) => setLoc((x) => ({ ...x, redes: { ...x.redes, [r.chave]: limparRede(r.chave, e.target.value) } }))} placeholder={r.placeholder} autoComplete="off" autoFocus />{loc.redes[r.chave] && <button type="button" className="ob-menos" onClick={() => setLoc((x) => ({ ...x, redes: { ...x.redes, [r.chave]: '' } }))} aria-label="Tirar"><X size={14} /></button>}</span>
                  </label>
                ) })()}
              </div>
            </div>
          </div>
          <div className="ob-card">
            <strong className="ob-card-titulo">{autonoma ? 'Onde você atende' : 'Localização do salão'}</strong>
            <span className="muted">É o endereço que a cliente usa no “Como chegar”.</span>
            <div className="ob-seg" role="radiogroup" aria-label="Qual endereço">
              <button type="button" role="radio" aria-checked={loc.endereco_igual} className={loc.endereco_igual ? 'ativa' : ''} onClick={() => setLoc((x) => ({ ...x, endereco_igual: true }))}>{comCnpj ? 'Usar o endereço fiscal' : 'Usar o endereço do cadastro'}</button>
              <button type="button" role="radio" aria-checked={!loc.endereco_igual} className={!loc.endereco_igual ? 'ativa' : ''} onClick={() => setLoc((x) => ({ ...x, endereco_igual: false }))}>Outro endereço</button>
            </div>
            {usaFiscal ? (
              <div className="ob-endereco-fixo">
                <MapPin size={15} />
                {fiscal.address.trim() || fiscal.city.trim()
                  ? <span><strong>{fiscal.address}</strong>{fiscal.bairro && <>, {fiscal.bairro}</>}<br />{[fiscal.city, fiscal.uf].filter(Boolean).join(' / ')}{fiscal.cep && <> · CEP {formatarCep(fiscal.cep)}</>}<small>Do passo 2. Pra mudar, volte lá ou escolha “Outro endereço”.</small></span>
                  : <span><strong>O endereço do passo 2 está vazio.</strong><small>Volte lá e preencha, ou escolha “Outro endereço”.</small></span>}
              </div>
            ) : (
              <div className="ob-form"><BlocoEndereco valor={local} onChange={setLocal} obrigatorio aoAchar={pinoDoCep} autoCompleteRua /></div>
            )}
            {/* o pino: é ele que a cliente vê no "Como chegar" */}
            <div className="ob-mapa-campo">
              <span className="ob-rotulo ob-mapa-titulo">Pino no mapa {pino ? <em className="ob-pino-ok"><Check size={11} /> pino marcado</em> : <em className="ob-pino-nao">sem pino</em>}</span>
              {pino
                ? <div className="ob-mapa"><Mapa lat={Number(loc.lat)} lng={Number(loc.lng)} zoom={17} arrastavel altura={220} onMover={moverPino} /></div>
                : <div className="ob-sem-pino"><MapPinOff size={22} /><strong>Ainda sem pino no mapa</strong><span className="muted">Preencha o endereço ou use os botões abaixo.</span></div>}
              {pino && <small className="ob-mapa-nota">Arraste o pino até a porta ou toque no lugar certo.{geo ? ` ${geo.charAt(0).toUpperCase()}${geo.slice(1)}.` : ''}</small>}
              <div className="ob-mapa-acoes">
                <button type="button" className="ob-acao-mini" onClick={usarLocalizacao} disabled={Boolean(ocupado)}><MapPin size={13} /> {ocupado === 'gps' ? 'Achando você…' : 'Usar minha localização'}</button>
                <button type="button" className="ob-acao-mini" onClick={acharPeloEndereco} disabled={Boolean(ocupado) || !(local.address.trim() || local.city.trim())}><Search size={13} /> {ocupado === 'endereco' ? 'Procurando…' : 'Achar pelo endereço'}</button>
                {pino && <button type="button" className="ob-acao-mini neutro" onClick={() => { setLoc((x) => ({ ...x, lat: null, lng: null })); setGeo('') }}><X size={13} /> Tirar o pino</button>}
              </div>
            </div>
          </div>
        </div>
        <div className="ob-coluna">
        <div className="ob-card">
          <strong className="ob-card-titulo">Horário de funcionamento</strong>
          <span className="muted">{autonoma ? 'Horário padrão da sua agenda. Folgas você marca depois, em Bloqueios.' : 'Horário padrão do salão. Depois você ajusta por profissional.'}</span>
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
                <button type="button" className="link-ver" onClick={() => setCopiar(copiar ? null : { dias: new Set([2, 3, 4, 5]) })}><Copy size={12} /> Copiar segunda para outros dias</button>
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
          <span className="ob-card-linha"><strong className="ob-card-titulo">Regras da agenda</strong>{recomendadoAtivo && <em className="ob-badge">Configuração recomendada</em>}</span>
          {!recomendadoAtivo && (
            <div className="ob-recomendado">
              <small><Wand2 size={12} /> Sugestão para começar</small>
              <span className="muted">Agendar até 1 h antes · cancelar grátis até 12 h antes · reagendar liberado · sem sinal.</span>
              <button type="button" className="btn-mini" onClick={() => setPol((x) => ({ ...x, ...RECOMENDADO }))}>Usar essa</button>
            </div>
          )}
          <label className="ob-campo">Com quanto tempo de antecedência a cliente pode agendar?<select value={pol.antecedencia_min_minutos} onChange={(e) => p('antecedencia_min_minutos')(e.target.value)}>{ANTECEDENCIAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select><small className="muted">Com 1 hora, um horário das 15h pode ser marcado até as 14h.</small></label>
          <label className="ob-campo">Cancelamento gratuito até<select value={pol.politica_cancelamento} onChange={(e) => p('politica_cancelamento')(e.target.value)}>{CANCELAMENTO.map(([v, r]) => <option key={v} value={v}>{r} antes</option>)}</select></label>
          <div className="ob-toggle"><span>Permitir que a cliente reagende</span><label className="switch"><input type="checkbox" checked={pol.permite_remarcar} onChange={(e) => p('permite_remarcar')(e.target.checked)} /><span></span></label></div>
          <div className="ob-toggle"><span>Cobrar sinal na reserva <span className="muted">(opcional)</span></span><label className="switch"><input type="checkbox" checked={pol.sinal_ligado} onChange={(e) => { setTocouSinal(true); p('sinal_ligado')(e.target.checked) }} /><span></span></label></div>
          {tocouSinal && !pol.sinal_ligado && (s.pagamento_modo ?? 'nao') !== 'nao' && <small className="ob-aviso-sinal">Desligar aqui desliga o recebimento pelo app do salão inteiro, o mesmo de Ajustes › Receber pelo app.</small>}
          {pol.sinal_ligado && (
            <div className="ob-sinal">
              <div className="chips"><button type="button" className={'chip' + (pol.sinal_modo === 'fixo' ? ' active' : '')} onClick={() => p('sinal_modo')('fixo')}>Valor fixo</button><button type="button" className={'chip' + (pol.sinal_modo === 'pct' ? ' active' : '')} onClick={() => p('sinal_modo')('pct')}>% do serviço</button></div>
              {pol.sinal_modo === 'fixo' ? <label className="ob-campo ob-campo-reais"><span>R$</span><input value={pol.sinal_fixo} onChange={(e) => p('sinal_fixo')(e.target.value)} inputMode="decimal" /></label>
                : <div className="chips">{[30, 50, 100].map((v) => <button key={v} type="button" className={'chip' + (Number(pol.sinal_pct) === v ? ' active' : '')} onClick={() => p('sinal_pct')(v)}>{v}%</button>)}</div>}
              <small className="muted">Cobrado na reserva e abatido do valor final.</small>
            </div>
          )}
          <label className="ob-campo">Como os agendamentos serão confirmados?<select value={pol.aceite_modo} onChange={(e) => p('aceite_modo')(e.target.value)}><option value="automatico">Confirmar automaticamente</option><option value="casa">O salão confirma{pol.aceite_modo === 'casa' ? ` (até ${pol.minutos_para_aceitar} min)` : ''}</option><option value="profissional">Cada profissional confirma</option></select></label>
          <small className="muted">Tudo isso pode mudar depois, em Ajustes.</small>
        </div>
        </div>
      </div>
      <Rodape voltar={voltar} avancar={avancar} salvando={salvando} />
    </>
  )
}


// ---------- 4 · Quase lá ------------------------------------------------------------
// O cadastro termina aqui: quantas agendas (define o plano) e o aviso de que
// serviços, equipe e o QR vêm no painel, guiados.
function PassoQuaseLa({ s, voltar, salvando, concluir, pronto, autonoma, gravarQuieto, setEstadoAuto }) {
  const [n, setNum] = useState(Math.max(1, Number(s.equipe_prevista) || 4))
  const setN = (v) => setNum(Math.max(1, Math.round(v)))
  const c = planoDoNegocio(autonoma ? 'autonoma' : 'salao', n)
  const inclusas = c.plano === 'pro' ? PLANOS.pro.inclusas : PLANOS.promais.inclusas
  const estado = useAutosave(() => gravarQuieto({ equipe_prevista: n }), { n }, { ativo: Boolean(s.id) && !autonoma })
  useEffect(() => { setEstadoAuto(estado); return () => setEstadoAuto('') }, [estado, setEstadoAuto])
  useRoteiro([autonoma || n >= 1, false])
  return (
    <>
      <h1 className="ob-titulo">Quase lá</h1>
      <p className="ob-sub">{autonoma ? 'Sua agenda já tem cara. Falta só entrar no painel e montar os serviços.' : 'Seu salão já tem cara. Falta dizer quantas agendas e entrar no painel.'}</p>
      <div className="ob-estrutura">
        {!autonoma && (
            <div className="ob-card ob-card-largo ob-plano-card">
              <div className="ob-plano-grade">
                <div className="ob-plano-esq">
                  <strong className="ob-card-titulo">Profissionais com agenda própria</strong>
                  <span className="muted">Conte só quem atende clientes e precisa de agenda própria.</span>
                  <div className="ob-contador ob-contador-grande"><button type="button" onClick={() => setN(n - 1)} aria-label="Menos"><Minus size={16} /></button><strong>{n}</strong><button type="button" onClick={() => setN(n + 1)} aria-label="Mais"><Plus size={16} /></button></div>
                  <span className="ob-plano-agendas">{n === 1 ? '1 agenda' : `${n} agendas`} · {c.extras === 0 ? `dentro das ${inclusas} inclusas` : `${inclusas} inclusas + ${c.extras} ${c.extras === 1 ? 'extra' : 'extras'}`}</span>
                  <div className="ob-plano-barra" aria-hidden="true">{Array.from({ length: Math.max(n, inclusas) }, (_, i) => <i key={i} className={i < n ? (i < inclusas ? 'inclusa' : 'extra') : ''} />)}</div>
                  <small className="muted">É uma previsão. A equipe você monta no painel, e o plano acompanha as agendas ativas. Sem fidelidade.</small>
                </div>
                <div className="ob-plano-dir">
                  <div className="ob-plano-resumo">
                    <small>Seu plano</small>
                    <strong>{c.nome}</strong>
                    <b>{emDinheiro(c.total)}<small> /mês</small></b>
                    <span>{emDinheiro(c.base)} com {inclusas} agendas inclusas{c.extras > 0 && ` + ${c.extras} × ${emDinheiro(c.valorExtra)}`}</span>
                  </div>
                  <div className="ob-plano-gratis">
                    <strong>7 dias grátis, sem cartão</strong>
                    <span>Você não paga nada agora. O teste começa quando você ativar o link e o QR no painel. Depois, {emDinheiro(c.total)}/mês, sem fidelidade.</span>
                  </div>
                  <ul className="ob-plano-beneficios">
                    <li><Check size={13} /> Agenda online 24h, com link e QR do salão</li>
                    <li><Check size={13} /> Uma agenda pra cada profissional, com permissões</li>
                    <li><Check size={13} /> Lista de espera, confirmações e lembretes pelo WhatsApp</li>
                    <li><Check size={13} /> Sinal, comanda e repasses</li>
                  </ul>
                  <div className="ob-plano-comparar">
                    <button type="button" className={'ob-plano-opcao' + (c.plano === 'pro' ? ' ativa' : '')} onClick={() => { if (n > PLANOS.pro.ate) setN(PLANOS.pro.ate) }}>
                      <strong>MIMO Pro</strong><span>até {PLANOS.pro.ate} agendas</span><em>{emDinheiro(PLANOS.pro.base)} com {PLANOS.pro.inclusas} inclusas · {emDinheiro(PLANOS.pro.extra)} por extra</em>
                    </button>
                    <button type="button" className={'ob-plano-opcao' + (c.plano === 'promais' ? ' ativa' : '')} onClick={() => { if (n <= PLANOS.pro.ate) setN(PLANOS.promais.inclusas) }}>
                      <strong>MIMO Pro+</strong><span>{PLANOS.pro.ate + 1} agendas ou mais, sem limite</span><em>{emDinheiro(PLANOS.promais.base)} com {PLANOS.promais.inclusas} inclusas · {emDinheiro(PLANOS.promais.extra)} por extra</em>
                    </button>
                  </div>
                </div>
              </div>
            </div>
        )}
        <div className="ob-card ob-card-largo ob-depois-painel">
          <span className="ob-depois-selo"><Sparkles size={13} /> Continua no painel</span>
          <strong className="ob-card-titulo">{autonoma ? 'Os serviços você monta já dentro do painel' : 'Serviços e equipe você monta já dentro do painel'}</strong>
          <span className="muted">Com calma, do seu jeito, e com a gente guiando. O painel abre com a configuração pronta pra continuar.</span>
          <div className="ob-depois-lista">
            <div className="ob-depois-item"><span className="ob-depois-icone"><Sparkles size={18} /></span><strong>Serviços</strong><small>Nome, duração e preço. Com sugestões por categoria pra ir rápido.</small></div>
            {!autonoma && <div className="ob-depois-item"><span className="ob-depois-icone"><Users size={18} /></span><strong>Equipe</strong><small>Cada profissional com os seus serviços e horários. Ela recebe um link e entra com tudo pronto.</small></div>}
            <div className="ob-depois-item apagado"><span className="ob-depois-icone"><QrCode size={18} /></span><strong>Link e QR Code</strong><small>Aparecem assim que {autonoma ? 'os serviços estiverem prontos. Sua agenda é grátis, sem prazo.' : 'serviços e equipe estiverem prontos. Ativar libera o link e começa seus 7 dias grátis.'}</small></div>
          </div>
        </div>
      </div>
      <Rodape voltar={voltar} avancar={concluir} salvando={salvando || pronto} rotulo="Entrar no painel" icone={<ArrowRight size={16} />} />
    </>
  )
}

// ---------- Serviços, equipe e ativação: vivem no painel, em Configurar ----------
function PassoServicos({ s, seguir, voltar, salvando, setErro, autonoma, gravarQuieto }) {
  const [servicos, setServicos] = useState(null)
  const [catsTodas, setCatsTodas] = useState([])   // as da plataforma e as do salão
  const [novaCat, setNovaCat] = useState('')
  const [verMaisCats, setVerMaisCats] = useState(false)
  const [escolhidas, setEscolhidas] = useState(Array.isArray(s.categorias_escolhidas) ? s.categorias_escolhidas : [])   // as da plataforma que o salão usa
  const escolher = (id) => setEscolhidas((x) => (x.includes(id) ? x : [...x, id]))
  const desescolher = (id) => setEscolhidas((x) => x.filter((y) => y !== id))
  const cats = useMemo(() => categoriasDoSalao(catsTodas, s.id, escolhidas), [catsTodas, s.id, escolhidas])
  // as escolhidas gravam sozinhas
  const primeiraEscolha = useRef(true)
  useEffect(() => { if (primeiraEscolha.current) { primeiraEscolha.current = false; return } gravarQuieto?.({ categorias_escolhidas: escolhidas }) }, [escolhidas]) // eslint-disable-line react-hooks/exhaustive-deps
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
    setServicos(sv.data ?? []); setCatsTodas(ct.data ?? []); setProfs(pr.data ?? [])
    const q = {}; for (const x of ps.data ?? []) { (q[x.service_id] ??= []).push(x.professional_id) }
    setQuem(q)
  }, [s.id])
  useEffect(() => { carregar() }, [carregar])
  const minhasCats = catsTodas.filter((c) => c.salon_id === s.id)
  useRoteiro([escolhidas.length > 0 || minhasCats.length > 0, (servicos?.length ?? 0) > 0, (servicos?.length ?? 0) > 0 && servicos.every((x) => Number(x.price) > 0 && Number(x.duration_minutes) > 0)])
  async function addCat(nome) {
    const n = nome.trim(); if (!n) return
    if (catsTodas.some((c) => c.nome.toLowerCase() === n.toLowerCase())) { setNovaCat(''); return }
    const { data, error } = await supabase.from('categorias_de_servico').insert({ salon_id: s.id, nome: n, ordem: 500 }).select('id, salon_id, nome, ordem').maybeSingle()
    if (error) { setErro(error.message); return }
    setCatsTodas((x) => [...x, data]); setNovaCat('')
  }
  async function tirarCat(c) {
    const { error } = await supabase.from('categorias_de_servico').delete().eq('id', c.id)
    if (error) { setErro('Essa categoria tem serviço: tire os serviços dela primeiro.'); return }
    setCatsTodas((x) => x.filter((y) => y.id !== c.id))
  }

  const nomeCat = (id) => cats.find((c) => c.id === id)?.nome ?? 'Outros'
  const lista = (servicos ?? []).filter((x) => !filtro || x.categoria_id === filtro)
  // sugestões rápidas pelas categorias do salão (nome + duração de referência; preço nunca é inventado)
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
        <div><h1 className="ob-titulo">{vazio ? 'Cadastre seus primeiros serviços' : 'Seus serviços'}</h1><p className="ob-sub">{vazio ? 'Comece com os 3 a 5 serviços mais procurados. Depois você pode adicionar quantos quiser.' : 'Defina preço e duração para a MIMO mostrar os horários disponíveis corretamente.'}</p></div>
        {!vazio && <button type="button" className="btn btn-secondary ob-add" onClick={() => setModal('novo')}><Plus size={15} /> Adicionar serviço</button>}
      </div>
      <div className="ob-card ob-card-cats">
          <strong className="ob-card-titulo">Categorias dos serviços</strong>
          <span className="muted">Escolha as áreas que fazem parte {autonoma ? 'do seu trabalho' : 'do seu salão'}. As sugestões de serviço abaixo seguem o que você escolher aqui.</span>
          {(() => {
            const busca = novaCat.trim()
            const igual = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()
            const existente = busca ? catsTodas.find((c) => igual(c.nome, busca)) : null
            const padrao = catsTodas.filter((c) => !c.salon_id)
            const usadas = padrao.filter((c) => escolhidas.includes(c.id))
            // sugestões: as da plataforma ainda não escolhidas e os nomes da lista que não existem
            const sugeridas = [
              ...padrao.filter((c) => !escolhidas.includes(c.id)).map((c) => ({ chave: c.id, nome: c.nome, escolherId: c.id })),
              ...CATEGORIAS_SUGERIDAS.filter((n) => !catsTodas.some((c) => igual(c.nome, n))).map((n) => ({ chave: 'nova:' + n, nome: n })),
            ]
            const filtradas = busca ? sugeridas.filter((x) => x.nome.toLowerCase().includes(busca.toLowerCase())) : sugeridas
            const visiveis = busca || verMaisCats ? filtradas : filtradas.slice(0, SUGESTOES_A_MOSTRA)
            const escondidas = filtradas.length - visiveis.length
            const jaEsta = existente && (existente.salon_id || escolhidas.includes(existente.id))
            return (
              <>
                <div className="ob-cat-grupo">
                  <small className="ob-cat-rotulo">Suas categorias</small>
                  <div className="ob-cats">
                    {usadas.map((c) => <span key={c.id} className={'ob-cat' + (existente?.id === c.id ? ' realce' : '')}>{c.nome}<button type="button" onClick={() => desescolher(c.id)} aria-label={`Tirar ${c.nome}`}><X size={12} /></button></span>)}
                    {minhasCats.map((c) => <span key={c.id} className={'ob-cat' + (existente?.id === c.id ? ' realce' : '')}>{c.nome}<button type="button" onClick={() => tirarCat(c)} aria-label={`Tirar ${c.nome}`}><X size={12} /></button></span>)}
                  </div>
                </div>
                <div className="ob-cat-grupo">
                  <small className="ob-cat-rotulo">Adicionar categorias</small>
                  <div className="ob-cats">
                    {visiveis.map((x) => <button key={x.chave} type="button" className="ob-cat sugerida" onClick={() => { if (x.escolherId) escolher(x.escolherId); else addCat(x.nome); setNovaCat('') }}><Plus size={12} /> {x.nome}</button>)}
                    {escondidas > 0 && <button type="button" className="ob-cat mais" onClick={() => setVerMaisCats(true)}>Ver mais ({escondidas})</button>}
                    {busca && !visiveis.length && jaEsta && <small className="muted">“{existente.nome}” já está nas suas.</small>}
                  </div>
                </div>
                <div className="ob-add-cat">
                  <input value={novaCat} onChange={(e) => setNovaCat(e.target.value)} placeholder="Buscar ou criar categoria…" maxLength={40} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!busca || jaEsta) return; if (existente) escolher(existente.id); else addCat(busca); setNovaCat('') } }} />
                  {busca && !jaEsta && <button type="button" className="btn-mini" onClick={() => { if (existente) escolher(existente.id); else addCat(busca); setNovaCat('') }}><Plus size={12} /> {existente ? `Adicionar “${existente.nome}”` : `Criar “${busca}”`}</button>}
                </div>
                <small className="muted">Não encontrou a sua? Digite e dê Enter pra criar. Pode seguir sem escolher nenhuma.</small>
              </>
            )
          })()}
        </div>
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
          <small><Sparkles size={12} /> Sugestões pelas suas categorias · toque para preencher nome e categoria; você define o preço</small>
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
    if (!f.name.trim()) { setErro('Informe o nome do serviço.'); return }
    const preco = reais(f.price) / 100
    if (!(preco > 0)) { setErro('Informe o preço do serviço.'); return }
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
        {sugestao && <p className="muted">Nome e categoria já preenchidos. Confira a duração sugerida e defina o seu preço.</p>}
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
                <span className="ob-rotulo">Quem realiza este serviço?</span>
                <div className="chips"><button type="button" className={'chip' + (sel.length === 0 ? ' active' : '')} onClick={() => setSel([])}>Toda a equipe</button>{profs.map((p) => <button key={p.id} type="button" className={'chip' + (sel.includes(p.id) ? ' active' : '')} onClick={() => setSel((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id]))}>{p.name.split(' ')[0]}</button>)}</div>
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
function PassoEquipe({ s, seguir, voltar, salvando, setErro }) {
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
    if (qual === 'enviar') {
      if (!p.email) { setAviso(`Cadastre o e-mail de ${primeiroNome(p.name)}: é por ele que o acesso chega.`); setGaveta(p); return }
      try { const r = await enviarAcesso(supabase, p); setAviso(`Acesso enviado para ${r.email}. Se quiser, avisa no WhatsApp pra ela olhar o e-mail.`) } catch (e) { setErro(e.message) }
      carregar(); return
    }
    if (qual === 'copiado') { setAviso(`Link de acesso de ${primeiroNome(p.name)} copiado.`); try { await supabase.rpc('equipe_acesso_enviado', { prof: p.id }) } catch { /* segue */ } carregar(); return }
    if (qual === 'remover' && !window.confirm(`Remover ${p.name} do salão? O histórico de atendimentos dela fica guardado.`)) return
    const { error } = await supabase.rpc('equipe_situacao', { prof: p.id, acao: qual })
    if (error) { setErro(error.message); return }
    carregar()
  }
  const pendentes = (equipe ?? []).filter((p) => p.situacao === 'configurada' && !p.user_id)
  useRoteiro([(equipe?.length ?? 0) > 0, (equipe?.length ?? 0) > 0 && equipe.every((p) => p.situacao !== 'rascunho'), (equipe?.length ?? 0) > 0 && equipe.every((p) => p.user_id || p.situacao === 'ativa' || p.enviado_em || p.acesso_enviado_em)])
  const lista = equipe ?? []
  return (
    <>
      <div className="ob-titulo-linha">
        <div><h1 className="ob-titulo">Configure sua equipe</h1><p className="ob-sub">Adicione cada profissional e deixe serviços, horários e repasses preparados antes de enviar o acesso.</p></div>
        <button type="button" className="btn btn-primary ob-add" onClick={() => setGaveta('nova')}><Plus size={15} /> Adicionar profissional</button>
      </div>
      {aviso && <div className="alert alert-info">{aviso}</div>}
      <div className="eq-bloco">
        <span className="eq-bloco-icone"><Home size={17} /></span>
        <div>
          <strong>Cada profissional tem sua própria agenda</strong>
          <p>Ela continua vinculada ao salão, enquanto você define serviços, horários, repasses e permissões. Quando estiver tudo pronto, é só enviar o acesso.</p>
        </div>
      </div>
      <div className="eq-lista">
        {!equipe ? <p className="muted">Carregando…</p> : lista.length === 0 ? (
          <div className="ob-vazio"><Users size={22} /><strong>Sua equipe ainda está vazia</strong><span className="muted">Adicione a primeira profissional e configure a agenda dela.</span><button type="button" className="btn btn-primary" onClick={() => setGaveta('nova')}><Plus size={15} /> Adicionar profissional</button></div>
        ) : lista.map((p) => <CartaoProfissional key={p.id} p={p} salao={s} onConfigurar={(x) => setGaveta(x)} onAcao={acao} menuAberto={menu} setMenu={setMenu} />)}
      </div>
      {pendentes.length > 0 && <p className="ob-dica"><Info size={13} /> {pendentes.length === 1 ? `${primeiroNome(pendentes[0].name)} ainda não ativou o acesso.` : `${pendentes.length} profissionais ainda não ativaram o acesso.`} Mande o link pelo WhatsApp: ela confirma o número, cria a senha e entra.</p>}
      <div className="eq-coletar">
        <div>
          <strong><Link2 size={14} /> Deixe a profissional preencher os dados básicos</strong>
          <p>Compartilhe este link para ela informar nome e WhatsApp. Depois você revisa os dados, configura a agenda e libera o acesso.</p>
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
function PassoAtivacao({ s, voltar, salvando, concluir, pronto, autonoma, irPara }) {
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
  useRoteiro([resumo != null && checklist.every((c) => c.ok), Boolean(s.codigo), false])
  const pendentes = n('equipe_pendente')
  return (
    <>
      <h1 className="ob-titulo">Sua agenda está pronta 🎉</h1>
      <p className="ob-sub">{autonoma ? 'Sua agenda já pode receber agendamentos. Faça um teste e depois compartilhe seu link ou QR Code.' : 'Seu salão já pode receber agendamentos. Faça um teste e depois compartilhe o link ou QR Code com suas clientes.'}</p>
      <div className="ob-duas ob-duas-final">
        <div className="ob-card ob-checklist">
          <strong className="ob-card-titulo">O que já está pronto</strong>
          <ul>{checklist.map((c) => <li key={c.texto} className={c.ok ? 'ok' : ''}><span>{c.ok ? <Check size={13} /> : <Minus size={13} />}</span>{c.texto}</li>)}</ul>
        </div>
        <div className="ob-card ob-ativacao">
          <div>
            <strong className="ob-card-titulo">Link e QR Code {autonoma ? 'da sua agenda' : 'do salão'}</strong>
            <span className="muted">Compartilhe com suas clientes. Elas abrem {autonoma ? 'sua agenda' : 'a página do salão'}, escolhem o serviço e encontram um horário disponível.</span>
            <div className="ob-link"><input readOnly value={link} onFocus={(e) => e.target.select()} /><button type="button" className="btn-mini" onClick={copiar}><Copy size={12} /> {copiado ? 'Copiado!' : 'Copiar link'}</button></div>
            <span className="muted ob-codigo">Ou o código <b>{s.codigo}</b>, digitado no app.</span>
          </div>
          <div className="ob-qr-grande"><canvas ref={qr} /><small className="muted">QR Code {autonoma ? 'da agenda' : 'do salão'}</small></div>
        </div>
      </div>
      <strong className="ob-secao">Próximos passos</strong>
      <div className="ob-proximos">
        <div className="ob-proximo"><span className="ob-proximo-icone"><CalendarCheck size={18} /></span><strong>Faça um agendamento de teste</strong><p>Abra sua página como cliente e confira serviços, horários e disponibilidade antes de divulgar.</p><button type="button" className="btn-mini" onClick={testar}>{resumo?.feitos?.agendamento_teste ? <><Check size={12} /> Página aberta</> : 'Fazer agendamento teste'}</button></div>
        <div className="ob-proximo"><span className="ob-proximo-icone"><QrCode size={18} /></span><strong>Divulgue seu QR Code</strong><p>Coloque no balcão, espelho ou recepção. No Instagram e no WhatsApp, compartilhe o link.</p><button type="button" className="btn-mini" onClick={baixar}>{resumo?.feitos?.qr_baixado ? <><Check size={12} /> QR baixado</> : <><Download size={12} /> Baixar QR Code</>}</button></div>
        {!autonoma && (
          <div className="ob-proximo"><span className="ob-proximo-icone"><Send size={18} /></span><strong>Envie o acesso da equipe</strong>
            {pendentes > 0 ? <><p>{pendentes === 1 ? '1 profissional ainda não ativou o acesso.' : `${pendentes} profissionais ainda não ativaram o acesso.`}</p><button type="button" className="btn-mini" onClick={() => irPara(5)}>Enviar acessos</button></>
              : n('equipe') > 0 ? <p className="ob-proximo-ok"><Check size={13} /> Sua equipe está ativa.</p>
              : <><p>Ninguém na equipe ainda. Dá pra adicionar agora ou depois, em Equipe.</p><button type="button" className="btn-mini" onClick={() => irPara(5)}>Adicionar profissional</button></>}
          </div>
        )}
      </div>
      <div className="ob-card ob-importante">
        <strong className="ob-card-titulo"><Info size={15} /> Como as clientes ficam vinculadas</strong>
        <span className="muted">Quem entrar pelo link ou QR {autonoma ? 'da sua agenda' : 'do salão'} poderá voltar depois para agendar com {autonoma ? 'você' : 'esse salão'}. Se a cliente entrar pelo link de uma profissional, ela também ficará vinculada a essa profissional dentro do salão.</span>
        <span className="ob-importante-icone"><Users size={34} /></span>
      </div>
      {(() => { const c = planoDoNegocio(s.tipo, s.equipe_prevista); return (
        <div className="ob-resumo-plano">
          <div><small>Seu plano</small><strong>{c.nome}</strong><p>{autonoma ? 'Uma agenda, sem mensalidade, sem cartão.' : `${s.equipe_prevista || 1} ${(s.equipe_prevista || 1) === 1 ? 'agenda' : 'agendas'} · ${c.extras === 0 ? 'todas inclusas' : `${c.extras} além das inclusas`}.`}</p></div>
          <b>{c.total === 0 ? 'Grátis' : <>{emDinheiro(c.total)}<small> /mês</small></>}</b>
        </div>
      ) })()}
      <Rodape voltar={voltar} avancar={concluir} salvando={salvando || pronto} rotulo="Finalizar e entrar no painel" icone={<ArrowRight size={16} />} />
    </>
  )
}

export { PassoServicos, PassoEquipe, PassoAtivacao, ModalErro, useAutosave, EstadoSalvo }
