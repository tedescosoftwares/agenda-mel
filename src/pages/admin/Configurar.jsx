import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Lock, Sparkles, Users, LayoutGrid, Link2, ArrowLeft, ArrowRight, Save } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import ProShell from '../../components/ProShell'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import AtivarSalao from '../../components/AtivarSalao'
import { ModalErro } from '../Onboarding'
import EtapaCategorias from './configuracao/EtapaCategorias'
import EtapaServicos from './configuracao/EtapaServicos'
import EtapaProfissionais from './configuracao/EtapaProfissionais'
import EtapaVinculos from './configuracao/EtapaVinculos'
import EtapaRevisao from './configuracao/EtapaRevisao'
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
  const etapas = useMemo(() => (autonoma ? ETAPAS.filter((e) => e.id !== 'vinculos').map((e) => (e.id === 'profissionais' ? { ...e, rotulo: 'Sua agenda' } : e)) : ETAPAS), [autonoma])
  const chaveLocal = base?.id ? `mimo-config-passo-${base.id}` : null

  // o progresso vem dos dados: primeira etapa não feita é onde a pessoa entra
  const derivar = useCallback(async (salao) => {
    const [r, cb] = await Promise.all([supabase.rpc('primeiros_passos', { salao: salao.id }), autonoma ? Promise.resolve({ data: [] }) : supabase.rpc('cobertura_por_categoria', { salao: salao.id })])
    const n = (k) => Number(r.data?.[k] ?? 0)
    const cobertura = Array.isArray(cb.data) ? cb.data : []
    const f = {
      categorias: (Array.isArray(salao.categorias_escolhidas) && salao.categorias_escolhidas.length > 0) || n('servicos') > 0,
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
      const valido = guardado && (guardado === REVISAO || etapas.some((e) => e.id === guardado))
      const primeira = etapas.find((e) => !f[e.id])?.id ?? REVISAO
      setPasso(valido ? guardado : primeira)
    })
  }, [base]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (passo && chaveLocal) { try { localStorage.setItem(chaveLocal, passo) } catch { /* nada */ } } }, [passo, chaveLocal])
  useEffect(() => { setEstado({ podeContinuar: false, rodape: '' }); if (s) derivar(s) }, [passo]) // eslint-disable-line react-hooks/exhaustive-deps

  async function gravarQuieto(dados) {
    const { error } = await supabase.rpc('onboarding_salvar', { salao: s.id, dados })
    if (error) return false
    setS((x) => ({ ...x, ...dados }))
    return true
  }
  const indice = passo === REVISAO ? etapas.length : etapas.findIndex((e) => e.id === passo)
  const ultimaEtapa = indice === etapas.length - 1
  function ir(id) { setPasso(id); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  async function continuar() {
    if (!estado.podeContinuar) return
    setSalvando(true)
    try { if (estado.aoContinuar) await estado.aoContinuar() } catch (e) { setErro(e?.message || 'Não deu para salvar agora. Tente de novo.'); setSalvando(false); return }
    setSalvando(false)
    ir(ultimaEtapa ? REVISAO : etapas[indice + 1].id)
  }
  function voltar() { ir(passo === REVISAO ? etapas[etapas.length - 1].id : etapas[Math.max(0, indice - 1)].id) }
  async function concluir() {
    if (!estado.podeContinuar) return
    setSalvando(true)
    try { await supabase.rpc('primeiro_passo_feito', { salao: s.id, chave: 'configuracao' }) } catch { /* segue */ }
    try { localStorage.removeItem(chaveLocal) } catch { /* nada */ }
    await recarregarPerfil?.()
    setSalvando(false)
    navigate(para === 'admin' ? '/admin' : '/pro/agenda', { replace: true })
  }
  const onEstado = useCallback((e) => setEstado((atual) => ({ ...atual, aoContinuar: null, aviso: false, ...e })), [])
  const Shell = para === 'admin' ? AdminShell : ProShell

  // ativação pendente: a tela de ativação fica até mandar pro painel (como antes)
  if (!autonoma && acesso?.ativacao_pendente && !base?.ativado_em && !ativandoAqui) setAtivandoAqui(true)
  if (ativandoAqui) return <AtivarSalao s={base} onAtivado={async () => { await recarregarPerfil?.(); navigate('/admin', { replace: true }) }} />

  const total = etapas.length
  const progresso = passo === REVISAO ? 100 : Math.round(((indice + 1) / (total + 1)) * 100)
  const props = { s, setS, gravarQuieto, setErro, autonoma, onEstado, irPara: ir }
  return (
    <Shell>
      <div className="cfg">
        <header className="cfg-cabecalho">
          <div className="cfg-cabecalho-linha">
            <div>
              <span className="cfg-eyebrow">Configuração inicial</span>
              <h1>{passo === REVISAO ? 'Revisão' : `Etapa ${indice + 1} de ${total}`}</h1>
            </div>
            <button type="button" className="btn btn-ghost cfg-depois" onClick={() => navigate(para === 'admin' ? '/admin' : '/pro/agenda')}><Save size={15} /> Salvar e continuar depois</button>
          </div>
          <ol className="cfg-stepper">
            {etapas.map((e, i) => {
              const atual = e.id === passo
              const feita = Boolean(feitas[e.id])
              const liberada = feita || i <= indice || Object.values(feitas).filter(Boolean).length >= i
              return (
                <li key={e.id} className={(atual ? 'atual' : '') + (feita ? ' feita' : '') + (!liberada ? ' travada' : '')}>
                  <button type="button" onClick={() => liberada && ir(e.id)} disabled={!liberada} aria-current={atual ? 'step' : undefined}>
                    <i>{feita && !atual ? <Check size={12} strokeWidth={3} /> : !liberada ? <Lock size={10} /> : i + 1}</i>
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

        {erro && <ModalErro texto={erro} onFechar={() => setErro('')} />}
        {!s || !passo ? <p className="muted">Carregando…</p> : (
          <div key={passo} className="cfg-corpo">
            {passo === 'categorias' && <EtapaCategorias {...props} />}
            {passo === 'servicos' && <EtapaServicos {...props} />}
            {passo === 'profissionais' && <EtapaProfissionais {...props} />}
            {passo === 'vinculos' && <EtapaVinculos {...props} />}
            {passo === REVISAO && <EtapaRevisao {...props} />}
          </div>
        )}

        <footer className="cfg-rodape">
          <span className={'cfg-rodape-info' + (estado.aviso ? ' aviso' : '')}>{estado.rodape}</span>
          <div className="cfg-rodape-acoes">
            {indice > 0 && <button type="button" className="btn btn-ghost" onClick={voltar} disabled={salvando}><ArrowLeft size={16} /> Voltar</button>}
            {passo === REVISAO
              ? <button type="button" className="btn btn-primary cfg-continuar" onClick={concluir} disabled={!estado.podeContinuar || salvando}>{salvando ? 'Concluindo…' : 'Concluir configuração'} <Check size={16} /></button>
              : <button type="button" className="btn btn-primary cfg-continuar" onClick={continuar} disabled={!estado.podeContinuar || salvando}>{salvando ? 'Salvando…' : ultimaEtapa ? 'Revisar' : 'Continuar'} <ArrowRight size={16} /></button>}
          </div>
        </footer>
      </div>
    </Shell>
  )
}
