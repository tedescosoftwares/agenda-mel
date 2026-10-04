import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Check, Lock, Sparkles, Users, LayoutGrid, Link2, ArrowLeft, ArrowRight, Save, LogOut, HelpCircle } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import ProShell from '../../components/ProShell'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { temCategoria } from '../../lib/categorias'
import AtivarSalao from '../../components/AtivarSalao'
import { ModalErro } from '../Onboarding'
import EtapaCategorias from './configuracao/EtapaCategorias'
import EtapaServicos from './configuracao/EtapaServicos'
import EtapaProfissionais from './configuracao/EtapaProfissionais'
import EtapaVinculos from './configuracao/EtapaVinculos'
import EtapaRevisao from './configuracao/EtapaRevisao'
import useCompacto from './configuracao/useCompacto'
import { ManualDaConfiguracao, dependenciasOk, oQueFalta } from './configuracao/Manual'
import '../../configuracao.css'

// Configuração inicial (2.94): Categorias → Serviços → Profissionais →
// Quem faz o quê → Revisão, no painel, com o espaço do desktop (duas
// colunas, painel sticky, matriz) e o mesmo fluxo no celular.
//
// Cada etapa grava sozinha (categorias em salons, serviços em services,
// equipe pela RPC, vínculos em professional_services); o progresso é
// derivado dos dados reais. Só a "última etapa aberta" fica no navegador.
// A Home de primeiro acesso abre ou retoma daqui; não é este fluxo.
const ETAPAS = [
  { id: 'categorias', rotulo: 'Categorias', Icone: LayoutGrid },
  { id: 'servicos', rotulo: 'Serviços', Icone: Sparkles },
  { id: 'profissionais', rotulo: 'Profissionais', Icone: Users },
  { id: 'vinculos', rotulo: 'Quem faz o quê', Icone: Link2 },
]
const REVISAO = 'revisao'

export default function Configurar({ para = 'admin' }) {
  const { salao: salaoAdmin, negocio, recarregarPerfil, acesso } = useAuth()
  const base = para === 'admin' ? (salaoAdmin ?? negocio) : (negocio ?? salaoAdmin)
  const autonoma = base?.tipo === 'autonoma'
  const navigate = useNavigate()
  const [s, setS] = useState(null)
  const [passo, setPasso] = useState(null)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [estado, setEstado] = useState({ podeContinuar: false, rodape: '' })
  const [feitas, setFeitas] = useState({})
  const [ativandoAqui, setAtivandoAqui] = useState(false)
  const [manual, setManual] = useState(false)
  const [aviso, setAviso] = useState(null)   // o modal do "por que não dá para continuar"
  const [catsBase, setCatsBase] = useState(null)   // as categorias reais, para validar os ids escolhidos
  const compacto = useCompacto()
  // o rodapé é fixo, colado no fim do miolo que rola (largura e posição
  // medidas do <main>), e publica a própria altura em --rodape-fixo para
  // a Mel nascer em cima dele, nunca por cima
  const [caixa, setCaixa] = useState(null)
  const rodapeRef = useRef(null)
  useEffect(() => {
    const main = document.querySelector('main.admin-content')
    if (!main) return
    const medir = () => {
      const r = main.getBoundingClientRect(); const cs = getComputedStyle(main)
      setCaixa({ left: Math.round(r.left), width: Math.round(r.width), bottom: Math.max(0, Math.round(window.innerHeight - r.bottom)), paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight })
    }
    medir()
    const altura = () => document.documentElement.style.setProperty('--rodape-fixo', `${rodapeRef.current?.offsetHeight ?? 0}px`)
    altura()
    const ro = new ResizeObserver(medir); ro.observe(main)
    const ro2 = new ResizeObserver(altura); if (rodapeRef.current) ro2.observe(rodapeRef.current)
    window.addEventListener('resize', medir)
    return () => { ro.disconnect(); ro2.disconnect(); window.removeEventListener('resize', medir); document.documentElement.style.removeProperty('--rodape-fixo') }
  }, [])
  const etapas = useMemo(() => (autonoma ? ETAPAS.filter((e) => e.id !== 'vinculos').map((e) => (e.id === 'profissionais' ? { ...e, rotulo: 'Sua agenda' } : e)) : ETAPAS), [autonoma])
  const chaveLocal = base?.id ? `mimo-config-passo-${base.id}` : null

  // o progresso vem dos dados: primeira etapa não feita é onde a pessoa entra
  const derivar = useCallback(async (salao) => {
    const [r, cb, ct] = await Promise.all([supabase.rpc('primeiros_passos', { salao: salao.id }), autonoma ? Promise.resolve({ data: [] }) : supabase.rpc('cobertura_por_categoria', { salao: salao.id }), supabase.from('categorias_de_servico').select('id, salon_id, slug').or(`salon_id.eq.${salao.id},salon_id.is.null`)])
    const cats = ct.data ?? []
    setCatsBase(cats)
    const n = (k) => Number(r.data?.[k] ?? 0)
    const cobertura = Array.isArray(cb.data) ? cb.data : []
    const f = {
      categorias: temCategoria(cats, salao.id, salao.categorias_escolhidas),   // ids fantasmas não contam; ter serviço também não
      servicos: n('servicos') > 0,
      profissionais: autonoma || n('equipe') > 0,
      vinculos: n('servicos') > 0 && (autonoma || (cobertura.length > 0 && cobertura.every((c) => Number(c.sem_profissional ?? 0) === 0))),
    }
    setFeitas(f)
    return f
  }, [autonoma])

  useEffect(() => {
    if (!base || s) return
    setS({ ...base })
    derivar(base).then((f) => {
      let guardado = null
      try { guardado = chaveLocal ? localStorage.getItem(chaveLocal) : null } catch { /* nada */ }
      const valido = guardado && (guardado === REVISAO || etapas.some((e) => e.id === guardado)) && dependenciasOk(guardado, f)
      const primeira = etapas.find((e) => !f[e.id])?.id ?? REVISAO
      setPasso(valido ? guardado : primeira)
    })
  }, [base]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (passo && chaveLocal) { try { localStorage.setItem(chaveLocal, passo) } catch { /* nada */ } } }, [passo, chaveLocal])
  useEffect(() => { if (s) derivar(s) }, [passo]) // eslint-disable-line react-hooks/exhaustive-deps

  async function gravarQuieto(dados) {
    const { error } = await supabase.rpc('onboarding_salvar', { salao: s.id, dados })
    if (error) return false
    setS((x) => ({ ...x, ...dados }))
    return true
  }
  const feitasAgora = { ...feitas, categorias: catsBase && s ? temCategoria(catsBase, s.id, s.categorias_escolhidas) : Boolean(feitas.categorias) }
  const liberada = (id) => dependenciasOk(id, feitasAgora)
  const indice = passo === REVISAO ? etapas.length : etapas.findIndex((e) => e.id === passo)
  const ultimaEtapa = indice === etapas.length - 1
  function ir(id) { if (!liberada(id)) { setManual(true); return } setEstado({ podeContinuar: false, rodape: '' }); setPasso(id); document.querySelector('main.admin-content')?.scrollTo({ top: 0, behavior: 'smooth' }) }
  const MOTIVO_PADRAO = { titulo: 'Ainda falta algo nesta etapa', texto: estado.rodape || 'Complete a etapa para seguir.' }
  async function continuar() {
    if (!estado.podeContinuar) { setAviso(estado.motivo ?? MOTIVO_PADRAO); return }
    setSalvando(true)
    try { if (estado.aoContinuar) await estado.aoContinuar() } catch (e) { setErro(e?.message || 'Não deu para salvar agora. Tente de novo.'); setSalvando(false); return }
    setSalvando(false)
    ir(ultimaEtapa ? REVISAO : etapas[indice + 1].id)
  }
  function voltar() { ir(passo === REVISAO ? etapas[etapas.length - 1].id : etapas[Math.max(0, indice - 1)].id) }
  async function concluir() {
    if (!estado.podeContinuar) { setAviso(estado.motivo ?? MOTIVO_PADRAO); return }
    setSalvando(true)
    try { await supabase.rpc('primeiro_passo_feito', { salao: s.id, chave: 'configuracao' }) } catch { /* segue */ }
    try { localStorage.removeItem(chaveLocal) } catch { /* nada */ }
    await recarregarPerfil?.()
    setSalvando(false)
    navigate(para === 'admin' ? '/admin' : '/pro/agenda', { replace: true })
  }
  const onEstado = useCallback((e) => setEstado((atual) => ({ ...atual, aoContinuar: null, aviso: false, acaoRodape: null, motivo: null, ...e })), [])
  const Shell = para === 'admin' ? AdminShell : ProShell

  // ativação pendente: a tela de ativação fica até mandar pro painel (como antes)
  if (!autonoma && acesso?.ativacao_pendente && !base?.ativado_em && !ativandoAqui) setAtivandoAqui(true)
  if (ativandoAqui) return <AtivarSalao s={base} onAtivado={async () => { await recarregarPerfil?.(); navigate('/admin', { replace: true }) }} />

  const total = etapas.length
  const progresso = passo === REVISAO ? 100 : Math.round(((indice + 1) / (total + 1)) * 100)
  const props = { s, setS, gravarQuieto, setErro, autonoma, onEstado, irPara: ir, compacto, abrirManual: () => setManual(true) }
  const rotuloAtual = passo === REVISAO ? 'Revisão' : etapas[indice]?.rotulo
  return (
    <Shell amplo>
      <div className={'cfg' + (compacto ? ' cfg-compacta' : '')}>
        {compacto ? (
          <header className="cfg-cabecalho-mini">
            <button type="button" className="cfg-mini-voltar" onClick={() => (indice > 0 ? voltar() : navigate(para === 'admin' ? '/admin' : '/pro/agenda'))} aria-label={indice > 0 ? 'Voltar' : 'Sair da configuração'}><ArrowLeft size={18} /></button>
            <div className="cfg-mini-meio">
              <div className="cfg-progresso" role="progressbar" aria-valuenow={progresso} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progresso}%` }} /></div>
              <span className="cfg-mini-rotulo"><b>{rotuloAtual}</b> · {passo === REVISAO ? total + 1 : indice + 1}/{total + 1}</span>
            </div>
            <span className="cfg-mini-botoes">
              <button type="button" className="cfg-mini-sair" onClick={() => setManual(true)} aria-label="Como funciona" title="Como funciona"><HelpCircle size={17} /></button>
              <button type="button" className="cfg-mini-sair" onClick={() => navigate(para === 'admin' ? '/admin' : '/pro/agenda')} aria-label="Salvar e continuar depois" title="Salvar e continuar depois"><LogOut size={17} /></button>
            </span>
          </header>
        ) : (
        <header className="cfg-cabecalho">
          <div className="cfg-cabecalho-linha">
            <div>
              <span className="cfg-eyebrow">Configuração inicial</span>
              <h1>{passo === REVISAO ? 'Revisão' : `Etapa ${indice + 1} de ${total}`}</h1>
            </div>
            <div className="cfg-cabecalho-acoes">
              <button type="button" className="btn btn-ghost cfg-manual-btn" onClick={() => setManual(true)}><HelpCircle size={15} /> Como funciona</button>
              <button type="button" className="btn btn-ghost cfg-depois" onClick={() => navigate(para === 'admin' ? '/admin' : '/pro/agenda')}><Save size={15} /> Salvar e continuar depois</button>
            </div>
          </div>
          <ol className="cfg-stepper">
            {etapas.map((e, i) => {
              const atual = e.id === passo
              const feita = Boolean(feitas[e.id])
              const livre = liberada(e.id)
              const falta = livre ? '' : `Precisa de: ${oQueFalta(e.id, feitasAgora, autonoma).join(' e ')}`
              return (
                <li key={e.id} className={(atual ? 'atual' : '') + (feita ? ' feita' : '') + (!livre ? ' travada' : '')}>
                  <button type="button" onClick={() => ir(e.id)} aria-disabled={!livre} title={falta || undefined} aria-current={atual ? 'step' : undefined}>
                    <i>{feita && !atual ? <Check size={12} strokeWidth={3} /> : !livre ? <Lock size={10} /> : i + 1}</i>
                    <span>{e.rotulo}</span>
                  </button>
                  {i < etapas.length - 1 && <em aria-hidden="true" />}
                </li>
              )
            })}
            <li className={'cfg-stepper-revisao' + (passo === REVISAO ? ' atual' : '')}><button type="button" onClick={() => ir(REVISAO)}><i>{passo === REVISAO ? total + 1 : <Check size={12} strokeWidth={3} />}</i><span>Revisão</span></button></li>
          </ol>
          <div className="cfg-progresso" role="progressbar" aria-valuenow={progresso} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progresso}%` }} /></div>
        </header>
        )}

        {erro && <ModalErro texto={erro} onFechar={() => setErro('')} />}
        {manual && <ManualDaConfiguracao atual={passo} feitas={feitasAgora} autonoma={autonoma} onFechar={() => setManual(false)} onIr={ir} />}
        {aviso && createPortal(
          <div className="modal-fundo cfg-aviso-fundo" onClick={() => setAviso(null)} role="presentation">
            <div className="cfg-aviso" role="alertdialog" aria-modal="true" aria-labelledby="cfg-aviso-titulo" onClick={(e) => e.stopPropagation()}>
              <span className="cfg-aviso-icone"><Lock size={20} /></span>
              <h3 id="cfg-aviso-titulo">{aviso.titulo}</h3>
              <p>{aviso.texto}</p>
              {aviso.lista?.length > 0 && <ul>{aviso.lista.map((t) => <li key={t}>{t}</li>)}</ul>}
              <div className="cfg-aviso-acoes">
                {aviso.ir && <button type="button" className="btn btn-primary" onClick={() => { setAviso(null); ir(aviso.ir) }}>{aviso.acao ?? 'Resolver'} <ArrowRight size={15} /></button>}
                <button type="button" className={'btn ' + (aviso.ir ? 'btn-ghost' : 'btn-primary')} onClick={() => setAviso(null)} autoFocus>{aviso.ir ? 'Fechar' : 'Entendi'}</button>
                <button type="button" className="plat-link cfg-aviso-manual" onClick={() => { setAviso(null); setManual(true) }}><HelpCircle size={13} /> Como funciona</button>
              </div>
            </div>
          </div>, document.body)}
        {!s || !passo ? <p className="muted">Carregando…</p> : (
          <div key={passo} className="cfg-corpo">
            {passo === 'categorias' && <EtapaCategorias {...props} />}
            {passo === 'servicos' && <EtapaServicos {...props} />}
            {passo === 'profissionais' && <EtapaProfissionais {...props} />}
            {passo === 'vinculos' && <EtapaVinculos {...props} />}
            {passo === REVISAO && <EtapaRevisao {...props} />}
          </div>
        )}

        {createPortal(
          <footer ref={rodapeRef} className={'cfg-rodape' + (compacto ? ' compacta' : '')} style={caixa ? { left: caixa.left, width: caixa.width, bottom: caixa.bottom, paddingLeft: caixa.paddingLeft, paddingRight: caixa.paddingRight } : undefined}>
            <div className="cfg-rodape-miolo">
              {estado.acaoRodape
                ? <button type="button" className={'cfg-rodape-acao' + (estado.aviso ? ' aviso' : '')} onClick={estado.acaoRodape.onClick}>{estado.acaoRodape.icone}{estado.acaoRodape.rotulo}</button>
                : <span className={'cfg-rodape-info' + (estado.aviso ? ' aviso' : '')}>{estado.rodape}</span>}
              <div className="cfg-rodape-acoes">
                {indice > 0 && !compacto && <button type="button" className="btn btn-ghost" onClick={voltar} disabled={salvando}><ArrowLeft size={16} /> Voltar</button>}
                {passo === REVISAO
                  ? <button type="button" className={'btn btn-primary cfg-continuar' + (!estado.podeContinuar ? ' trancado' : '')} onClick={concluir} aria-disabled={!estado.podeContinuar} disabled={salvando}>{salvando ? 'Concluindo…' : 'Concluir configuração'} <Check size={16} /></button>
                  : <button type="button" className={'btn btn-primary cfg-continuar' + (!estado.podeContinuar ? ' trancado' : '')} onClick={continuar} aria-disabled={!estado.podeContinuar} disabled={salvando}>{salvando ? 'Salvando…' : ultimaEtapa ? 'Revisar' : 'Continuar'} <ArrowRight size={16} /></button>}
              </div>
            </div>
          </footer>, document.body)}
      </div>
    </Shell>
  )
}
