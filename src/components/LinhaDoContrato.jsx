import { Check } from 'lucide-react'
import { HOMOLOGACOES } from '../lib/contratoParceria'

// A linha do tempo do contrato (101): rascunho → enviado → assinaturas →
// homologação → vigente. Encerrado vira uma faixa por cima.
export default function LinhaDoContrato({ pc, assinouProf, assinouSalao }) {
  if (!pc) return null
  const ordem = ['rascunho', 'enviado', 'assinado', 'vigente']
  const pos = pc.status === 'encerrado' ? 4 : ordem.indexOf(pc.status)
  const passos = [
    { k: 'rascunho', r: 'Rascunho', s: pc.criado_em ? data(pc.criado_em) : '' },
    { k: 'enviado', r: 'Enviado', s: pc.enviado_em ? data(pc.enviado_em) : 'PDF gerado e enviado' },
    { k: 'assinado', r: 'Assinaturas', s: `${assinouProf ? 'profissional ✓' : 'profissional'} · ${assinouSalao ? 'salão ✓' : 'salão'}` },
    { k: 'vigente', r: 'Homologação', s: HOMOLOGACOES[pc.homologacao] ?? 'Pendente' },
  ]
  return (
    <div className={'linha-contrato' + (pc.status === 'encerrado' ? ' encerrado' : '')}>
      {passos.map((p, i) => {
        const feito = i < pos || (i === pos && (p.k === 'vigente' ? pc.homologacao === 'homologado' : p.k === 'rascunho' ? true : false)) || (p.k === 'assinado' && assinouProf && assinouSalao) || (p.k === 'enviado' && pc.enviado_em)
        const atual = i === pos && !feito
        const alerta = p.k === 'vigente' && (pc.homologacao === 'nao_obtida')
        return (
          <div key={p.k} className={'lc-passo' + (feito ? ' feito' : '') + (atual ? ' atual' : '') + (alerta ? ' alerta' : '')}>
            <span className="lc-bola">{feito ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
            <strong>{p.r}</strong>
            <span className="muted">{p.s}</span>
          </div>
        )
      })}
      {pc.status === 'encerrado' && <div className="lc-encerrado">Encerrado em {data(pc.encerrado_em)}{pc.encerramento_motivo ? ` · ${pc.encerramento_motivo}` : ''}</div>}
    </div>
  )
}
const data = (v) => (v ? new Date(String(v).length === 10 ? v + 'T12:00:00' : v).toLocaleDateString('pt-BR') : '')
