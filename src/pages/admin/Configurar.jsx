import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Lock, Sparkles, Users, QrCode, LayoutGrid } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import ProShell from '../../components/ProShell'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import AtivarSalao from '../../components/AtivarSalao'
import { dataCurta } from '../../lib/acesso'
import { PassoCategorias, PassoServicos, PassoEquipe, PassoAtivacao, ModalErro, EstadoSalvo } from '../Onboarding'

// Conclua a configuração (painel): o que saiu do cadastro vem pra cá,
// guiado do mesmo jeito. Categorias → Serviços → Equipe (salão) → Ativação
// com o link e o QR, que só abre quando serviços e equipe estão prontos.
// Quem ainda não escolheu categoria começa nelas; quem já tem cai nos serviços.
export default function Configurar({ para = 'admin' }) {
  const { salao: salaoAdmin, negocio, recarregarPerfil, acesso } = useAuth()
  const base = para === 'admin' ? (salaoAdmin ?? negocio) : (negocio ?? salaoAdmin)
  const autonoma = base?.tipo === 'autonoma'
  const navigate = useNavigate()
  const [s, setS] = useState(null)
  const [passo, setPasso] = useState(1)   // 0 categorias · 1 serviços · 2 equipe · 3 revisão/link
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [pronto, setPronto] = useState(false)
  const [estadoAuto, setEstadoAuto] = useState('')
  const [resumo, setResumo] = useState(null)
  const [ativandoAqui, setAtivandoAqui] = useState(false)   // a tela de ativação, presa até mandar pro painel
  useEffect(() => { if (base && !s) { setS({ ...base }); if (!(Array.isArray(base.categorias_escolhidas) && base.categorias_escolhidas.length)) setPasso(0) } }, [base]) // eslint-disable-line react-hooks/exhaustive-deps

  const etapas = [{ id: 0, rotulo: 'Categorias', Icone: LayoutGrid }, { id: 1, rotulo: 'Serviços', Icone: Sparkles }, ...(!autonoma ? [{ id: 2, rotulo: 'Equipe', Icone: Users }] : []), { id: 3, rotulo: 'Pronto', Icone: QrCode }]
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
  async function seguir(dados = {}) {
    if (Object.keys(dados).length) { setSalvando(true); const ok = await gravarQuieto(dados); setSalvando(false); if (!ok) { setErro('Não deu para salvar agora. Tente de novo.'); return } }
    const prox = etapas[Math.min(etapas.length - 1, indice + 1)].id
    if (prox === 3) {
      const r = await carregarResumo()
      if (!prontoParaAtivar(r)) { setErro(n('servicos', r) === 0 ? 'Cadastre pelo menos um serviço para continuar.' : 'Configure pelo menos uma profissional para continuar.'); return }
    }
    setPasso(prox); window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function voltar() { setPasso(etapas[Math.max(0, indice - 1)].id); window.scrollTo({ top: 0 }) }
  const irPara = (k) => { setPasso(k === 5 ? 2 : k === 4 ? 1 : k); window.scrollTo({ top: 0 }) }
  async function concluir() {
    setPronto(true)
    try { await supabase.rpc('primeiro_passo_feito', { salao: s.id, chave: 'configuracao' }) } catch { /* segue */ }
    await recarregarPerfil?.()
    navigate(para === 'admin' ? '/admin' : '/pro/agenda', { replace: true })
  }
  const props = { s, setS, seguir, voltar, salvando, setErro, autonoma, gravarQuieto, setEstadoAuto, concluir, pronto, irPara }
  const Shell = para === 'admin' ? AdminShell : ProShell
  const feitos = { 0: (Array.isArray(s?.categorias_escolhidas) && s.categorias_escolhidas.length > 0) || n('servicos') > 0, 1: n('servicos') > 0, 2: n('equipe') > 0, 3: prontoParaAtivar() }

  // Se a pessoa fechou a ativação e voltou, não mostramos serviços/equipe antes
  // da escolha comercial. É só a tela de ativação, em fullscreen. Ela fica
  // até mandar pro painel: o acesso muda no meio (deixa de estar pendente)
  // e, sem segurar, a tela sumia antes do "sucesso" e caía nos serviços.
  if (!autonoma && acesso?.ativacao_pendente && !base?.ativado_em && !ativandoAqui) setAtivandoAqui(true)
  if (ativandoAqui) {
    return <AtivarSalao s={base} onAtivado={async () => { await recarregarPerfil?.(); navigate('/admin', { replace: true }) }} />
  }

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
                <button type="button" onClick={() => { if (!travada) { setPasso(e.id); window.scrollTo({ top: 0 }) } }} disabled={travada} title={travada ? 'Abre quando serviços e equipe estiverem prontos' : undefined}>
                  <i>{feitos[e.id] ? <Check size={11} /> : travada ? <Lock size={10} /> : i + 1}</i>{e.rotulo}
                </button>
              </li>
            )
          })}
        </ol>
        {erro && <ModalErro texto={erro} onFechar={() => setErro('')} />}
        {!s ? <p className="muted">Carregando…</p> : (
          <div key={passo} className="ob-passo-corpo">
            {passo === 0 && <PassoCategorias {...props} />}
            {passo === 1 && <PassoServicos {...props} />}
            {passo === 2 && <PassoEquipe {...props} />}
            {passo === 3 && (
              <>
                {acesso?.fase === 'teste' && <p className="cfg-teste"><Sparkles size={13} /> {acesso.aguardando_configuracao ? 'Seus 7 dias grátis começam a contar quando serviços e equipe estiverem prontos.' : `Seu teste grátis vai até ${dataCurta(acesso.ate)}.`} <a href="/admin/assinatura">Como funciona</a></p>}
                <PassoAtivacao {...props} />
              </>
            )}
          </div>
        )}
      </div>
    </Shell>
  )
}
