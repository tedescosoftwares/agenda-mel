import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Lock, Sparkles, Users, QrCode } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import ProShell from '../../components/ProShell'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { PassoServicos, PassoEquipe, PassoAtivacao, ModalErro, EstadoSalvo } from '../Onboarding'

// Conclua a configuração (painel): o que saiu do cadastro vem pra cá,
// guiado do mesmo jeito. Serviços → Equipe (salão) → Ativação com o link
// e o QR, que só abre quando serviços e equipe estão prontos.
export default function Configurar({ para = 'admin' }) {
  const { salao: salaoAdmin, negocio, recarregarPerfil } = useAuth()
  const base = para === 'admin' ? (salaoAdmin ?? negocio) : (negocio ?? salaoAdmin)
  const autonoma = base?.tipo === 'autonoma'
  const navigate = useNavigate()
  const [s, setS] = useState(null)
  const [passo, setPasso] = useState(1)   // 1 serviços · 2 equipe (só salão) · 3 ativação
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [pronto, setPronto] = useState(false)
  const [estadoAuto, setEstadoAuto] = useState('')
  const [resumo, setResumo] = useState(null)
  useEffect(() => { if (base && !s) setS({ ...base }) }, [base]) // eslint-disable-line react-hooks/exhaustive-deps

  const etapas = [{ id: 1, rotulo: 'Serviços', Icone: Sparkles }, ...(!autonoma ? [{ id: 2, rotulo: 'Equipe', Icone: Users }] : []), { id: 3, rotulo: 'Ativação', Icone: QrCode }]
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
      if (!prontoParaAtivar(r)) { setErro(n('servicos', r) === 0 ? 'Cadastre pelo menos um serviço antes de ativar: é o que a cliente vai escolher.' : 'Configure pelo menos uma profissional antes de ativar: sem agenda, ninguém consegue marcar.'); return }
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
  const feitos = { 1: n('servicos') > 0, 2: n('equipe') > 0, 3: false }
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
            {passo === 1 && <PassoServicos {...props} />}
            {passo === 2 && <PassoEquipe {...props} />}
            {passo === 3 && <PassoAtivacao {...props} />}
          </div>
        )}
      </div>
    </Shell>
  )
}
