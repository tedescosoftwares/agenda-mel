import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Lock, Sparkles, Users, QrCode } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import ProShell from '../../components/ProShell'
import MontandoSalao from '../../components/MontandoSalao'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import AtivarSalao from '../../components/AtivarSalao'
import { PassoServicos, PassoEquipe, ModalErro, EstadoSalvo } from '../Onboarding'

// Depois do cadastro vem a parte operacional: Serviços → Equipe → ativação.
// A ativação não é mais um cartão perdido no painel. Quando serviços/equipe
// estão prontos, a MIMO fecha a configuração numa tela cheia, anima o preparo
// e prende o fluxo na decisão inicial: 7 dias grátis OU primeira mensalidade.
export default function Configurar({ para = 'admin' }) {
  const { salao: salaoAdmin, negocio, recarregarPerfil, recarregarAcesso, acesso } = useAuth()
  const [busca] = useSearchParams()
  const base = para === 'admin' ? (salaoAdmin ?? negocio) : (negocio ?? salaoAdmin)
  const autonoma = base?.tipo === 'autonoma'
  const navigate = useNavigate()
  const [s, setS] = useState(null)
  const [passo, setPasso] = useState(busca.get('etapa') === 'ativacao' ? 3 : 1)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [pronto, setPronto] = useState(false)
  const [estadoAuto, setEstadoAuto] = useState('')
  const [resumo, setResumo] = useState(null)
  const [montando, setMontando] = useState(false)
  const [preparoOk, setPreparoOk] = useState(false)
  const [mostrarEscolha, setMostrarEscolha] = useState(false)

  useEffect(() => { if (base && !s) setS({ ...base }) }, [base]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fechou o navegador no meio da escolha? Ao voltar, cai de novo nela.
  useEffect(() => {
    if (!s?.id || autonoma || s.ativado_em) return
    if (acesso?.ativacao_pendente) {
      setPasso(3)
      setMostrarEscolha(true)
      setMontando(false)
      setPreparoOk(true)
    }
  }, [s?.id, s?.ativado_em, autonoma, acesso?.ativacao_pendente])

  const etapas = [
    { id: 1, rotulo: 'Serviços', Icone: Sparkles },
    ...(!autonoma ? [{ id: 2, rotulo: 'Equipe', Icone: Users }] : []),
    { id: 3, rotulo: autonoma ? 'Liberar' : 'Ativar', Icone: QrCode },
  ]

  const carregarResumo = useCallback(async () => {
    if (!s?.id) return null
    const { data } = await supabase.rpc('primeiros_passos', { salao: s.id })
    setResumo(data ?? {})
    return data ?? {}
  }, [s?.id])

  useEffect(() => { carregarResumo() }, [carregarResumo, passo])

  const n = (k, r = resumo) => Number(r?.[k] ?? 0)
  const prontoParaAtivar = (r = resumo) => Boolean(r) && n('servicos', r) > 0 && (autonoma || n('equipe', r) > 0)

  async function gravarQuieto(dados) {
    const { error } = await supabase.rpc('onboarding_salvar', { salao: s.id, dados })
    if (error) return false
    setS((x) => ({ ...x, ...dados }))
    return true
  }

  const indice = etapas.findIndex((e) => e.id === passo)

  async function abrirAtivacao() {
    const r = await carregarResumo()
    if (!prontoParaAtivar(r)) {
      setErro(n('servicos', r) === 0
        ? 'Cadastre pelo menos um serviço antes de ativar: é o que a cliente vai escolher.'
        : 'Configure pelo menos uma profissional antes de ativar: sem agenda, ninguém consegue marcar.')
      return
    }

    setPasso(3)
    setErro('')
    setMostrarEscolha(false)
    setPreparoOk(false)
    setMontando(true)

    // Marca no banco que a pessoa chegou à decisão. Isso faz o fluxo sobreviver
    // a refresh/fechar navegador e não libera link antes de uma escolha válida.
    if (!autonoma) {
      const { error } = await supabase.rpc('ativacao_inicial_preparar', { salao: s.id })
      if (error) {
        setMontando(false)
        setErro(error.message)
        return
      }
      await recarregarAcesso?.()
    }
    setPreparoOk(true)
  }

  async function seguir(dados = {}) {
    if (Object.keys(dados).length) {
      setSalvando(true)
      const ok = await gravarQuieto(dados)
      setSalvando(false)
      if (!ok) { setErro('Não deu para salvar agora. Tente de novo.'); return }
    }

    const prox = etapas[Math.min(etapas.length - 1, indice + 1)].id
    if (prox === 3) return abrirAtivacao()
    setPasso(prox)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function voltar() {
    if (passo === 3) return
    setPasso(etapas[Math.max(0, indice - 1)].id)
    window.scrollTo({ top: 0 })
  }

  const irPara = (k) => {
    const alvo = k === 5 ? 2 : k === 4 ? 1 : k
    if (alvo === 3) return abrirAtivacao()
    setPasso(alvo)
    window.scrollTo({ top: 0 })
  }

  async function concluir() {
    setPronto(true)
    try { await supabase.rpc('primeiro_passo_feito', { salao: s.id, chave: 'configuracao' }) } catch { /* segue */ }
    await Promise.all([recarregarPerfil?.(), recarregarAcesso?.()])
    navigate(para === 'admin' ? '/admin' : '/pro/agenda', { replace: true })
  }

  async function ativado(acessoNovo) {
    setS((x) => ({ ...x, ativado_em: new Date().toISOString() }))
    await concluir()
    return acessoNovo
  }

  const props = { s, setS, seguir, voltar, salvando, setErro, autonoma, gravarQuieto, setEstadoAuto, concluir, pronto, irPara }
  const Shell = para === 'admin' ? AdminShell : ProShell
  const feitos = { 1: n('servicos') > 0, 2: n('equipe') > 0, 3: Boolean(s?.ativado_em) }

  return (
    <Shell>
      <div className="ob ob-embutido">
        <div className="cfg-topo">
          <div>
            <span className="ob-conteudo-num">Conclua a configuração {autonoma ? 'da sua agenda' : 'do seu salão'}</span>
            <h2 className="cfg-titulo">Estamos quase lá</h2>
          </div>
          <EstadoSalvo estado={estadoAuto} />
        </div>

        <ol className="cfg-etapas">
          {etapas.map((e, i) => {
            const travada = e.id === 3 && !prontoParaAtivar()
            const atual = e.id === passo
            return (
              <li key={e.id} className={(atual ? 'atual' : '') + (feitos[e.id] ? ' feita' : '') + (travada ? ' travada' : '')}>
                <button
                  type="button"
                  onClick={() => {
                    if (travada) return
                    if (e.id === 3) abrirAtivacao()
                    else { setPasso(e.id); window.scrollTo({ top: 0 }) }
                  }}
                  disabled={travada}
                  title={travada ? 'Abre quando serviços e equipe estiverem prontos' : undefined}
                >
                  <i>{feitos[e.id] ? <Check size={11} /> : travada ? <Lock size={10} /> : i + 1}</i>{e.rotulo}
                </button>
              </li>
            )
          })}
        </ol>

        {erro && <ModalErro texto={erro} onFechar={() => setErro('')} />}

        {!s ? <p className="muted">Carregando…</p> : (
          <div key={passo} className="ob-passo-corpo">
            {passo === 1 && <PassoServicos {...props} />}
            {passo === 2 && <PassoEquipe {...props} />}
            {passo === 3 && !montando && mostrarEscolha && !s.ativado_em && (
              <AtivarSalao s={s} embutido onAtivado={ativado} />
            )}
            {passo === 3 && s.ativado_em && (
              <div className="cfg-ja-ativo">
                <Check size={18} />
                <strong>{autonoma ? 'Sua agenda já está liberada.' : 'Seu salão já está no ar.'}</strong>
                <button type="button" className="btn btn-primary" onClick={() => concluir()}>Entrar no painel</button>
              </div>
            )}
          </div>
        )}

        {montando && (
          <MontandoSalao
            nome={s?.name}
            autonoma={autonoma}
            pronto={preparoOk}
            erro={Boolean(erro)}
            minimo={6500}
            onFim={() => { setMontando(false); setMostrarEscolha(true) }}
          />
        )}
      </div>
    </Shell>
  )
}
