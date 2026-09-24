import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { Check, Circle, PartyPopper, Users, QrCode, Download, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { urlDoAmbiente } from '../lib/ambiente'
import { ativarPush } from '../lib/push'
import { useAuth } from '../context/AuthContext'

// O onboarding não morre no botão de finalizar (119): o painel mostra os
// primeiros passos até o salão rodar de verdade, a equipe que ainda não
// ativou o acesso, e o QR pronto pra imprimir. Some quando tudo está
// feito (depois de comemorar uma vez).
const CHAVE_FESTA = 'mimo-primeiros-passos-festa'
export default function PrimeirosPassos({ salao, para = 'admin' }) {
  const { user } = useAuth()
  const [r, setR] = useState(null)
  const [festa, setFesta] = useState(false)
  const qr = useRef(null)
  const link = salao?.codigo ? urlDoAmbiente('cliente', `/v/${salao.codigo}`) : ''
  const carregar = useCallback(async () => {
    if (!salao?.id) return
    const { data } = await supabase.rpc('primeiros_passos', { salao: salao.id })
    setR(data ?? null)
  }, [salao?.id])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { if (qr.current && link) QRCode.toCanvas(qr.current, link, { width: 72, margin: 1, color: { dark: '#1f2026', light: '#ffffff' } }).catch(() => {}) }, [link, r])

  if (!r) return null
  const autonoma = r.tipo === 'autonoma'
  const n = (k) => Number(r[k] ?? 0)
  const feitos = r.feitos ?? {}
  async function feito(chave) { try { await supabase.rpc('primeiro_passo_feito', { salao: salao.id, chave }) } catch { /* segue */ } carregar() }
  async function baixar() {
    try { const url = await QRCode.toDataURL(link, { width: 720, margin: 2 }); const a = document.createElement('a'); a.href = url; a.download = `qr-${salao.codigo}.png`; a.click(); feito('qr_baixado') } catch { /* nada */ }
  }
  async function ligarAvisos() { try { if (user?.id) await ativarPush(user.id) } catch { /* a pessoa decide */ } feito('avisos') }
  const passos = [
    { id: 'salao', ok: Boolean(r.dados), texto: autonoma ? 'Configurar sua agenda' : 'Configurar salão', para: para === 'admin' ? '/admin/salao' : '/pro/ajustes' },
    { id: 'servicos', ok: n('servicos') > 0, texto: 'Cadastrar serviços', para: para === 'admin' ? '/admin/servicos' : '/pro/servicos' },
    ...(!autonoma ? [{ id: 'equipe', ok: n('equipe') > 0, texto: 'Adicionar equipe', para: '/admin/equipe' }] : []),
    { id: 'teste', ok: n('agendamentos') > 0 || Boolean(feitos.agendamento_teste), texto: 'Fazer agendamento teste', acao: () => { window.open(link, '_blank', 'noopener'); feito('agendamento_teste') } },
    { id: 'qr', ok: Boolean(feitos.qr_baixado), texto: 'Baixar QR', acao: baixar },
    { id: 'avisos', ok: Boolean(r.avisos) || Boolean(feitos.avisos), texto: 'Ativar notificações', acao: ligarAvisos },
  ]
  const feitosN = passos.filter((p) => p.ok).length
  const tudo = feitosN === passos.length
  let jaComemorou = false
  try { jaComemorou = localStorage.getItem(CHAVE_FESTA) === '1' } catch { /* sem storage */ }
  if (tudo && jaComemorou && !festa) return <EquipePendente r={r} />
  if (tudo && !festa) { try { localStorage.setItem(CHAVE_FESTA, '1') } catch { /* nada */ } }
  return (
    <>
      {tudo ? (
        <div className="card pp-festa"><PartyPopper size={20} /><span>Seu salão está pronto para rodar na MIMO.</span><button type="button" onClick={() => setFesta(true)} aria-label="Fechar"><X size={16} /></button></div>
      ) : (
        <div className="card pp">
          <div className="pp-topo"><strong>Primeiros passos</strong><span className="muted">{feitosN} de {passos.length} concluídos</span></div>
          <div className="pp-barra"><i style={{ width: `${(feitosN / passos.length) * 100}%` }} /></div>
          <ul className="pp-lista">
            {passos.map((p) => (
              <li key={p.id} className={p.ok ? 'ok' : ''}>
                <span className="pp-check">{p.ok ? <Check size={12} /> : <Circle size={12} />}</span>
                {p.ok ? <span>{p.texto}</span> : p.para ? <Link to={p.para}>{p.texto}</Link> : <button type="button" onClick={p.acao}>{p.texto}</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <EquipePendente r={r} />
      {!feitos.qr_baixado && link && (
        <div className="card pp-qr">
          <canvas ref={qr} />
          <span><strong><QrCode size={14} /> Seu QR está pronto</strong><small className="muted">Coloque no balcão ou compartilhe no Instagram.</small></span>
          <button type="button" className="btn-mini" onClick={baixar}><Download size={12} /> Baixar QR</button>
        </div>
      )}
    </>
  )
}

function EquipePendente({ r }) {
  const n = Number(r.equipe_pendente ?? 0) + Number(r.equipe_rascunho ?? 0)
  if (r.tipo === 'autonoma' || n === 0) return null
  return (
    <Link to="/admin/equipe" className="card pp-equipe">
      <Users size={18} />
      <span><strong>Equipe pendente de ativação</strong><small className="muted">{n === 1 ? '1 profissional ainda não acessou.' : `${n} profissionais ainda não acessaram.`}{Number(r.equipe_rascunho ?? 0) > 0 ? ` ${r.equipe_rascunho === 1 ? 'Uma mandou os dados e espera você configurar.' : `${r.equipe_rascunho} mandaram os dados e esperam você configurar.`}` : ''}</small></span>
      <span className="pp-equipe-acao">Ver equipe</span>
    </Link>
  )
}
